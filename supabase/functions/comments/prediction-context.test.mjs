import test from "node:test";
import assert from "node:assert/strict";
import { predictionReadiness, scoreRaceForComment, toPredictionContext } from "./prediction-context.mjs";

const race = (overrides = {}) => ({ last_success_at: "2026-09-24T00:00:00Z", presence: { preview: "value", result: "missing" }, program: { closed_at: "2026-09-24T06:00:00Z" }, entries: [], preview_entries: [], result_entries: [], ...overrides });
test("open and fresh race is available", () => assert.equal(predictionReadiness(race(), Date.parse("2026-09-24T00:05:00Z")).status, "available"));
test("closed and invalid deadlines are not scoreable", () => { assert.equal(predictionReadiness(race(), Date.parse("2026-09-24T07:00:00Z")).status, "closed"); assert.equal(predictionReadiness(race({ program: { closed_at: "bad" } })).status, "deadline_unavailable"); });
test("result takes priority over prediction", () => assert.equal(predictionReadiness(race({ presence: { preview: "value", result: "value" } }), Date.parse("2026-09-24T01:00:00Z")).status, "result_available"));
test("preview and program freshness use the prediction limits", () => { const now = Date.parse("2026-09-24T01:00:00Z"); assert.equal(predictionReadiness(race({ last_success_at: "2026-09-23T23:00:00Z" }), now).status, "stale"); assert.equal(predictionReadiness(race({ presence: { preview: "missing", result: "missing" }, preview_entries: [], last_success_at: "2026-09-24T00:45:00Z" }), now).status, "available"); });
test("prediction context preserves picks and removes generation internals", () => { const context = toPredictionContext({ main: [1, 2, 3], counter: [2, 1, 4], hole: [5, 1, 2], configVersion: "v0.1.14-score-3", boats: [{ entryNumber: 1, rank: 1, totalScore: 90, componentScores: { course: 18 }, internal: "drop" }] }); assert.deepEqual(context.main, [1, 2, 3]); assert.equal(context.boats[0].internal, undefined); });
test("prediction unavailable does not call scoring for closed race", () => { const result = scoreRaceForComment(race({ program: { closed_at: "2026-09-24T00:00:00Z" } }), Date.parse("2026-09-24T01:00:00Z")); assert.equal(result.prediction.status, "closed"); });
test("open six-boat race uses the existing calculatePrediction contract", () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({ entry_number: index + 1, name: `選手${index + 1}`, rank_code: "A1", average_st: 0.14, national_win_rate: 6, local_win_rate: 6, motor_top2_percent: 35, motor_top3_percent: 50, hull_top2_percent: 35, hull_top3_percent: 50 }));
  const preview_entries = entries.map((entry) => ({ entry_number: entry.entry_number, course: entry.entry_number, start_timing: 0.14, time: 6.7 }));
  const result = scoreRaceForComment(race({ entries, preview_entries, last_success_at: "2026-09-24T00:00:00Z" }), Date.parse("2026-09-24T00:05:00Z"));
  assert.equal(result.readiness.status, "available");
  assert.ok(["available", "partial"].includes(result.prediction.status));
  assert.deepEqual(result.prediction.main.length, 3);
});
