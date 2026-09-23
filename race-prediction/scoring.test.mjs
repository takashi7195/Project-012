import test from "node:test";
import assert from "node:assert/strict";
import { averageStScore, calculatePrediction, calculateUpsideScore, inverseRankScore, rateScore, SCORE_CONFIG, selectHole } from "./scoring.mjs";

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

test("scoring config version identifies the current scoring rules", () => {
  assert.equal(SCORE_CONFIG.version, "v0.1.14-score-3");
});

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

test("component diagnostics average available boats per component", () => {
  const result = calculatePrediction(race(), { generatedAt: "2026-09-21T00:00:00Z" });
  const course = result.components.included.find((item) => item.name === "course");
  assert.equal(course.earned, 10.2);
  assert.equal(course.maximum, 18);
  assert.ok(result.components.included.every((item) => item.earned <= item.maximum));
  assert.ok(result.components.earned <= result.components.maximum);
});

test("diagnostic metadata does not change boat scores, ranks, or picks", () => {
  const result = calculatePrediction(race(), { generatedAt: "2026-09-21T00:00:00Z" });
  assert.deepEqual(result.main, [1, 2, 3]);
  assert.deepEqual(result.counter, [2, 1, 4]);
  assert.deepEqual(result.hole, [4, 1, 2]);
  assert.deepEqual(result.boats.map((boat) => ({ entryNumber: boat.entryNumber, totalScore: boat.totalScore, rank: boat.rank })), [
    { entryNumber: 1, totalScore: 98.09090909090911, rank: 1 },
    { entryNumber: 2, totalScore: 75.43939393939395, rank: 2 },
    { entryNumber: 3, totalScore: 62.681818181818194, rank: 3 },
    { entryNumber: 4, totalScore: 46.01515151515152, rank: 4 },
    { entryNumber: 5, totalScore: 30.363636363636363, rank: 5 },
    { entryNumber: 6, totalScore: 15.06060606060606, rank: 6 },
  ]);
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

test("structured factor evidence has stable IDs while public keyFactors remain text", () => {
  const first = calculatePrediction(race(), { generatedAt: "2026-09-21T00:00:00Z" });
  const second = calculatePrediction(race(), { generatedAt: "2026-09-21T00:00:00Z" });
  assert.ok(first.boats[0].keyFactors.every((factor) => typeof factor === "string"));
  assert.deepEqual(first.boats[0].factorEvidence, second.boats[0].factorEvidence);
  assert.ok(first.boats[0].factorEvidence.every((factor) => /^boat-1-[a-z-]+$/.test(factor.id)));
});

test("average ST uses fixed stage bands at every boundary", () => {
  assert.equal(averageStScore(0.12), 100);
  assert.equal(averageStScore(0.1201), 80);
  assert.equal(averageStScore(0.14), 80);
  assert.equal(averageStScore(0.1401), 60);
  assert.equal(averageStScore(0.16), 60);
  assert.equal(averageStScore(0.1601), 40);
  assert.equal(averageStScore(0.18), 40);
  assert.equal(averageStScore(0.1801), 20);
});

test("average ST score does not depend on the other five boats", () => {
  const first = calculatePrediction(race()).boats.find((boat) => boat.entryNumber === 1);
  const changed = race();
  changed.entries = changed.entries.map((entry, index) => ({ ...entry, average_st: index === 0 ? entry.average_st : 0.30 + index }));
  const second = calculatePrediction(changed).boats.find((boat) => boat.entryNumber === 1);
  assert.equal(first.componentScores.st, second.componentScores.st);
});

test("class scores use the approved A1/A2/B1/B2 bands", () => {
  const result = calculatePrediction(race());
  const scores = Object.fromEntries(result.boats.map((boat) => [boat.entryNumber, boat.componentScores.class]));
  assert.equal(scores[1], 5);
  assert.equal(scores[2], 3.75);
  assert.equal(scores[3], 2.25);
  assert.equal(scores[5], 1);
});

test("one missing class excludes only that boat's five point maximum", () => {
  const r = race();
  r.entries[2].rank_code = null;
  const result = calculatePrediction(r);
  const missing = result.boats.find((boat) => boat.entryNumber === 3);
  const present = result.boats.find((boat) => boat.entryNumber === 1);
  assert.equal(missing.componentScores.class, undefined);
  assert.equal(present.componentScores.class, 5);
  assert.equal(missing.effectiveMaximum, present.effectiveMaximum - 5);
});

test("national/local ability uses 60/40 and rescales a single available side", () => {
  const both = calculatePrediction(race()).boats.find((boat) => boat.entryNumber === 1);
  assert.equal(both.componentScores.ability, 4.74);

  const nationalOnly = race();
  nationalOnly.entries[0].local_win_rate = null;
  const nationalBoat = calculatePrediction(nationalOnly).boats.find((boat) => boat.entryNumber === 1);
  assert.equal(nationalBoat.componentScores.ability, 5.1);

  const localOnly = race();
  localOnly.entries[0].national_win_rate = null;
  const localBoat = calculatePrediction(localOnly).boats.find((boat) => boat.entryNumber === 1);
  assert.ok(Math.abs(localBoat.componentScores.ability - 4.2) < 1e-9);
});

test("both ability rates missing exclude only that boat's six point maximum", () => {
  const r = race();
  r.entries[0].national_win_rate = null;
  r.entries[0].local_win_rate = null;
  const result = calculatePrediction(r);
  const missing = result.boats.find((boat) => boat.entryNumber === 1);
  const present = result.boats.find((boat) => boat.entryNumber === 2);
  const baseline = calculatePrediction(race()).boats.find((boat) => boat.entryNumber === 2);
  assert.equal(missing.componentScores.ability, undefined);
  assert.equal(present.componentScores.ability, baseline.componentScores.ability);
  assert.equal(missing.effectiveMaximum, present.effectiveMaximum - 6);
});

test("excluded components do not produce narrative factor evidence", () => {
  const r = race();
  r.entries[0].motor_top2_percent = null;
  const result = calculatePrediction(r);
  assert.equal(result.components.included.some((item) => item.name === "motor"), false);
  assert.ok(result.boats.every((boat) => !boat.factorEvidence.some((factor) => factor.component === "motor")));
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

test("national and local win rates use the win-rate bands", () => {
  assert.equal(rateScore(7), 100);
  assert.equal(rateScore(6.5), 85);
  assert.equal(rateScore(6), 70);
  assert.equal(rateScore(5.5), 55);
  assert.equal(rateScore(5), 40);
  assert.equal(rateScore(4.99), 25);
});

test("missing exhibition course falls back to the entry frame, never a result course", () => {
  const r = race({
    preview_entries: Array.from({ length: 6 }, (_, index) => ({ entry_number: index + 1, course: null, time: 6.7, start_timing: 0.1 })),
    result_entries: Array.from({ length: 6 }, (_, index) => ({ entry_number: index + 1, actual_course: 6 - index })),
  });
  const result = calculatePrediction(r);
  assert.ok(result.components.included.some((item) => item.name === "course"));
  assert.deepEqual(result.boats.map((boat) => boat.course), [1, 2, 3, 4, 5, 6]);
});

test("relative ties receive the average of the occupied rank points", () => {
  assert.equal(inverseRankScore(10, [10, 10, 5, 1, 0, 0]), 90);
  assert.equal(inverseRankScore(0, [10, 10, 5, 1, 0, 0]), 10);
});

test("excluded exhibition data is not used as a tie breaker", () => {
  const r = race();
  r.preview_entries[0].time = null;
  r.preview_entries[1].time = 6.9;
  r.entries.forEach((entry) => {
    entry.average_st = 0.15;
    entry.national_win_rate = 5;
    entry.local_win_rate = 5;
    entry.rank_code = "B1";
    entry.motor_top2_percent = null;
    entry.motor_top3_percent = null;
    entry.hull_top2_percent = null;
    entry.hull_top3_percent = null;
  });
  const result = calculatePrediction(r);
  assert.equal(result.boats[0].entryNumber, 1);
  assert.ok(result.components.excluded.some((item) => item.name === "exhibitionTime"));
});

function rankedBoat(rank, entryNumber, values) {
  return {
    rank,
    entryNumber,
    componentScores: {
      exhibitionTime: values.time,
      exhibitionSt: values.exhibitionSt,
      motor: values.motor,
      st: values.st,
    },
  };
}

test("hole upside uses the specified weighted score, not a simple mean", () => {
  const boat = rankedBoat(4, 4, { time: 6.6, exhibitionSt: 0, motor: 0, st: 0 });
  assert.equal(calculateUpsideScore(boat), 30);
  assert.notEqual(calculateUpsideScore(boat), 25);
});

test("hole average ST contribution uses the same stage score", () => {
  const boat = rankedBoat(4, 4, { time: 0, exhibitionSt: 0, motor: 0, st: 9.6 });
  assert.equal(calculateUpsideScore(boat, ["st"]), 100);
});

test("hole considers only overall ranks 4 through 6 and keeps the best upside first", () => {
  const ranked = [
    rankedBoat(1, 1, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(2, 2, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(3, 3, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(4, 4, { time: 6.6, exhibitionSt: 4.8, motor: 14, st: 9.6 }),
    rankedBoat(5, 5, { time: 3.3, exhibitionSt: 2.4, motor: 7, st: 4.8 }),
    rankedBoat(6, 6, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
  ];
  assert.deepEqual(selectHole(ranked, new Set(["exhibitionTime", "exhibitionSt", "motor", "st"])), [4, 1, 2]);
});

test("hole reuses only common available factors and proportionally renormalizes weights", () => {
  const ranked = [
    rankedBoat(1, 1, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(2, 2, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(3, 3, { time: 0, exhibitionSt: 0, motor: 0, st: 0 }),
    rankedBoat(4, 4, { time: 6.6, exhibitionSt: null, motor: 14, st: 9.6 }),
    rankedBoat(5, 5, { time: 3.3, exhibitionSt: null, motor: 7, st: 4.8 }),
    rankedBoat(6, 6, { time: 0, exhibitionSt: null, motor: 0, st: 0 }),
  ];
  assert.deepEqual(selectHole(ranked, new Set(["exhibitionTime", "exhibitionSt", "motor", "st"])), [4, 1, 2]);
  assert.equal(selectHole(ranked, new Set(["exhibitionSt"])), null);
});

test("hole selection is deterministic for identical input", () => {
  const ranked = [4, 5, 6].map((rank) => rankedBoat(rank, rank, { time: 3.3, exhibitionSt: 2.4, motor: 7, st: 4.8 }));
  assert.deepEqual(selectHole(ranked, new Set(["exhibitionTime", "exhibitionSt", "motor", "st"])), [4, 5, 6]);
  assert.deepEqual(selectHole(ranked, new Set(["exhibitionTime", "exhibitionSt", "motor", "st"])), [4, 5, 6]);
});
