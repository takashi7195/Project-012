// Makes exactly one real Gemini request using the configured model. It uses a
// synthetic six-boat fixture, does not access Supabase, and never prints the key
// or generated narrative.
import assert from "node:assert/strict";
import { DEFAULT_AI_CONFIG } from "../../race-prediction/ai-config.mjs";
import { buildPrompt } from "../../race-prediction/ai-prompt.mjs";
import { validateAiOutput } from "../../race-prediction/ai-output.mjs";
import { generateGemini } from "../../race-prediction/providers/gemini.mjs";

const apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) throw new Error("GEMINI_API_KEY is not set; enter it in the local shell without pasting it into chat");

const identity = { raceDate: "2026-09-27", stadiumCode: 1, raceNumber: 1 };
const racers = Object.fromEntries([1, 2, 3, 4, 5, 6].map((entry_number) => [String(entry_number), {
  entry_number,
  name: `試験選手${entry_number}`,
  racer_class: ["A1", "A2", "B1", "B1", "B2", "B2"][entry_number - 1],
  national_win_rate: [7.1, 6.4, 5.3, 4.8, 4.1, 3.7][entry_number - 1],
  motor_number: entry_number + 10,
  motor_second_rate: [42, 38, 35, 32, 29, 25][entry_number - 1],
} ]));
const input = {
  identity,
  facts: {
    program: { date: identity.raceDate, stadium_number: identity.stadiumCode, race_number: identity.raceNumber, racers },
    preview: { racers: { 1: { course_number: 1, start_timing: "0.12" }, 2: { course_number: 2, start_timing: "0.15" } } },
    presence: { program: "value", preview: "value" },
  },
  provenance: { sourceCode: "local-live-fixture", fetchedAt: null },
};

const startedAt = Date.now();
const response = await generateGemini({
  model: DEFAULT_AI_CONFIG.model,
  prompt: buildPrompt(input, DEFAULT_AI_CONFIG.styleText),
  input,
  apiVersion: DEFAULT_AI_CONFIG.apiVersion,
  apiKey,
  settings: DEFAULT_AI_CONFIG,
  signal: AbortSignal.timeout(DEFAULT_AI_CONFIG.totalTimeoutMs),
});
assert.equal(response.ok, true, `Gemini request failed (${response.errorCode ?? "unknown"}, HTTP ${response.httpStatus ?? "n/a"})`);
assert.equal(response.incomplete, false, "Gemini returned a truncated or incomplete response");
const checked = validateAiOutput(response.candidate);
assert.equal(checked.valid, true, `Gemini output failed the application contract (${checked.errors?.join(",") ?? "unknown"})`);

console.log(`PASS: one ${DEFAULT_AI_CONFIG.model} request returned a complete, valid four-field prediction`);
console.log(JSON.stringify({
  model: DEFAULT_AI_CONFIG.model,
  providerModelVersion: response.modelVersion,
  durationMs: Date.now() - startedAt,
  usage: response.usage,
  outputValid: checked.valid,
  narrativeCharacters: [...checked.value.narrative].length,
}, null, 2));
