import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrediction } from "./scoring.mjs";

function race(overrides = {}) {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    entry_number: index + 1,
    name: `選手${index + 1}`,
    rank_code: ["A1", "A2", "B1", "B1", "B2", "B2"][index],
    average_st: 0.12 + index * 0.01,
    national_win_rate: 6.5 - index * 0.4,
    local_win_rate: 6.2 - index * 0.35,
    motor_top2_percent: 45 - index,
    motor_top3_percent: 65 - index,
    hull_top2_percent: 40 - index,
    hull_top3_percent: 60 - index,
  }));
  const preview_entries = Array.from({ length: 6 }, (_, index) => ({
    entry_number: index + 1,
    course: index + 1,
    start_timing: (0.08 + index * 0.01).toFixed(2),
    time: 6.65 + index * 0.02,
    tilt: 0,
  }));
  return { entries, preview_entries, ...overrides };
}

test("full usable inputs produce three picks and ranked six boats", () => {
  const result = calculatePrediction(race(), { generatedAt: "2026-09-21T00:00:00Z" });
  assert.equal(result.boats.length, 6);
  assert.equal(result.main.length, 3);
  assert.equal(result.counter.length, 3);
  assert.equal(result.hole.length, 3);
  assert.equal(result.status, "partial"); // unresolved D03/conditions remain excluded by design
  assert.equal(result.main[0], 1);
  assert.ok(result.components.maximum < 100);
});

test("fewer than six boats stops all picks", () => {
  const result = calculatePrediction(race({ entries: race().entries.slice(0, 5) }));
  assert.equal(result.status, "api_error");
  assert.equal(result.main, null);
  assert.equal(result.counter, null);
  assert.equal(result.hole, null);
});

test("missing one motor value excludes motor category for every boat", () => {
  const r = race();
  r.entries[2].motor_top2_percent = null;
  const result = calculatePrediction(r);
  assert.ok(result.components.excluded.some((item) => item.name === "motor"));
  assert.ok(result.boats.every((boat) => boat.componentScores.motor === undefined));
});

test("F/L exhibition notation excludes exhibition ST without treating F as fastest", () => {
  const r = race();
  r.preview_entries[0].start_timing = "F.01";
  const result = calculatePrediction(r);
  assert.ok(result.components.excluded.some((item) => item.name === "exhibitionSt"));
  assert.ok(result.boats.every((boat) => boat.componentScores.exhibitionSt === undefined));
});

test("missing exhibition time excludes only that subitem", () => {
  const r = race();
  r.preview_entries[4].time = null;
  const result = calculatePrediction(r);
  assert.ok(result.components.excluded.some((item) => item.name === "exhibitionTime"));
  assert.ok(result.components.included.some((item) => item.name === "exhibitionSt"));
});

test("hole is omitted when all upside factors are unavailable", () => {
  const r = race();
  r.preview_entries = r.preview_entries.map((entry) => ({ ...entry, time: null, start_timing: null }));
  r.entries = r.entries.map((entry) => ({ ...entry, average_st: null, motor_top2_percent: null, motor_top3_percent: null }));
  const result = calculatePrediction(r);
  assert.equal(result.hole, null);
});

