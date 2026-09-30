import test from "node:test";
import assert from "node:assert/strict";
import { buildAiInput, canonicalJson } from "./ai-input.mjs";
import { DEFAULT_AI_CONFIG, resolveAiConfig } from "./ai-config.mjs";
import { validateAiOutput } from "./ai-output.mjs";
import { buildPrompt } from "./ai-prompt.mjs";
import { generateGemini } from "./providers/gemini.mjs";
import { pollAiBundlePrediction } from "./client.mjs";

const entries = Object.fromEntries([1, 2, 3, 4, 5, 6].map((entry_number) => [String(entry_number), { entry_number, name: `選手${entry_number}`, motor_number: entry_number }]));
const identity = { raceDate: "2026-09-26", stadiumCode: 1, raceNumber: 1 };
const preview = { racers: { 1: { course_number: 2, start_timing: "F.03" } } };
const program = { ...identity, date: identity.raceDate, stadium_number: 1, race_number: 1, racers: entries, preview,
  result: { racers: { 1: { place_number: 1 } }, payouts: { trifecta: [1000] } } };

test("input retains full pre-race raw facts and removes result data", async () => {
  const input = await buildAiInput({ identity, programRaw: program, previewRaw: preview,
    presence: { program: "value", preview: "value" }, provenance: { sourceCode: "api", fetchedAt: "2026-09-26T00:00:00Z" }, closedAt: "2026-09-26T12:00:00Z" });
  assert.deepEqual(input.facts.program.racers, entries);
  assert.equal("preview" in input.facts.program, false);
  assert.equal("result" in input.facts.program, false);
  assert.equal(input.facts.preview.racers[1].start_timing, "F.03");
  assert.match(input.factsHash, /^[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("input rejects malformed or contradictory boat identities, not missing names", async () => {
  const nameless = structuredClone(program);
  delete nameless.racers["1"].name;
  await assert.doesNotReject(() => buildAiInput({ identity, programRaw: nameless, previewRaw: preview, closedAt: "2026-09-26T12:00:00Z" }));
  const conflict = structuredClone(program);
  conflict.racers["1"].entry_number = 2;
  await assert.rejects(() => buildAiInput({ identity, programRaw: conflict, previewRaw: preview, closedAt: "2026-09-26T12:00:00Z" }), /entries_invalid/);
});

test("output checks structure and distinct tickets without narrative length rules", () => {
  assert.equal(validateAiOutput({ main: [1, 2, 3], counter: [2, 3, 4], hole: [6, 5, 4], narrative: "展開".repeat(700) }).valid, true);
  assert.deepEqual(validateAiOutput({ main: [1, 1, 3], counter: [2, 3, 4], hole: [6, 5, 4], narrative: "有効" }).errors, ["main_duplicate_boat"]);
  assert.deepEqual(validateAiOutput({ main: [1, 2, 3], counter: [1, 2, 3], hole: [6, 5, 4], narrative: "有効" }).errors, ["bets_duplicate"]);
  assert.equal(validateAiOutput({ main: ["1", 2, 3], counter: [2, 3, 4], hole: [6, 5, 4], narrative: "有効" }).valid, false);
});

test("default model and settings are configurable within the designed limits", () => {
  assert.equal(DEFAULT_AI_CONFIG.model, "gemini-3.5-flash-lite");
  assert.equal(resolveAiConfig({}).maxAttempts, 2);
  assert.throws(() => resolveAiConfig({ RACE_AI_TOTAL_TIMEOUT_MS: "90001" }), /invalid_ai_config/);
});

test("Gemini receives instruction and race facts in separate request fields", async () => {
  let payload;
  let requestUrl;
  const response = await generateGemini({ model: DEFAULT_AI_CONFIG.model, prompt: "instruction", input: {
    identity, facts: { program: { title: "race fact" }, preview: null }, provenance: { sourceCode: "api", fetchedAt: null },
  }, apiKey: "test-key", settings: DEFAULT_AI_CONFIG, fetchImpl: async (url, options) => {
    requestUrl = url;
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"main\":[1,2,3]}" }] }, finishReason: "STOP" }] }), { status: 200 });
  } });
  assert.match(requestUrl, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(payload.systemInstruction.parts[0].text, "instruction");
  assert.match(payload.contents[0].parts[0].text, /race fact/);
  assert.equal(response.ok, true);
});

test("bundle client starts once, polls the shared job and validates the whole result", async () => {
  let clock = 0;
  let reads = 0;
  const output = { status: "success", mode: "ai_bundle", contractVersion: "ai-bundle-v1", main: [1, 2, 3], counter: [2, 3, 4], hole: [6, 5, 4], narrative: "展開" };
  const result = await pollAiBundlePrediction(async () => ({ status: 202, body: { status: "generating", mode: "ai_bundle", contractVersion: "ai-bundle-v1", jobId: "job-1", remainingMs: 5000 } }),
    async () => ({ status: ++reads === 1 ? 202 : 200, body: reads === 1 ? { status: "generating", mode: "ai_bundle", contractVersion: "ai-bundle-v1", jobId: "job-1", remainingMs: 4000 } : output }),
    { now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(reads, 2);
  assert.deepEqual(result, { main: output.main, counter: output.counter, hole: output.hole, narrative: output.narrative });
});

test("prompt leaves paragraphs, tone and narrative lengths unconstrained", () => {
  const prompt = buildPrompt({ identity, facts: {}, provenance: {} });
  assert.match(prompt, /500文字前後/);
  assert.doesNotMatch(prompt, /段落数|必ず.*文|文字数.*以内/);
});
