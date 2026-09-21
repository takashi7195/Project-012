import test from "node:test";
import assert from "node:assert/strict";
import { buildNarrativeInput, generateNarrative, validateNarrative } from "./narrative.mjs";

const prediction = {
  status: "partial", main: [1, 2, 3], counter: [2, 1, 4], hole: [4, 1, 2], scoreAsOf: "2026-09-21T00:00:00Z",
  components: { maximum: 66, excluded: [{ name: "recent", reason: "not configured" }] },
  boats: [{ entryNumber: 1, name: "山田太郎", rank: 1, totalScore: 80.2, course: 1, time: 6.7, start_timing: 0.08, average_st: 0.14, componentScores: { course: 18, exhibitionTime: 6.6 }, weakFactors: [] }],
};
const race = { race_date: "2026-09-21", stadium_code: 5, race_number: 1 };

test("structured narrative input includes only calculated factors and exclusions", () => {
  const input = buildNarrativeInput(race, prediction);
  assert.deepEqual(input.picks.main, [1, 2, 3]);
  assert.equal(input.boats[0].racerName, "山田太郎");
  assert.deepEqual(input.boats[0].keyFactors.map((factor) => factor.id), ["boat-1-course", "boat-1-exhibition-time"]);
  assert.equal(input.excludedItems[0].name, "recent");
});

test("valid narrative accepts only cited factor ids", () => {
  const valid = validateNarrative({ text: "1号艇を中心にした展開を想定。", citedFactorIds: ["boat-1-course"] }, new Set(["boat-1-course"]));
  assert.equal(valid.ok, true);
  assert.equal(validateNarrative({ text: "事実外", citedFactorIds: ["unknown"] }, new Set(["known"])).ok, false);
});

function response(body, status = 200) { return new Response(JSON.stringify(body), { status }); }

test("Gemini success is parsed without changing picks", async () => {
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "1号艇を中心にした展開を想定。", citedFactorIds: ["boat-1-course"] }) }] } }] }));
  assert.equal(result.errorCode, null);
  assert.equal(result.result.text, "1号艇を中心にした展開を想定。");
  assert.deepEqual(prediction.main, [1, 2, 3]);
});

test("quota, timeout, MAX_TOKENS and invalid citation fail without a narrative", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({}, 429))).errorCode, "gemini_http_429");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => { throw Object.assign(new Error("timeout"), { name: "AbortError" }); })).errorCode, "gemini_timeout");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ finishReason: "MAX_TOKENS" }] }))).errorCode, "gemini_max_tokens");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ content: { parts: [{ text: '{"text":"x","citedFactorIds":["nope"]}' }] } }] }))).errorCode, "gemini_narrative_validation");
});

test("missing API key is configurable failure", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "")).errorCode, "config_missing");
});
