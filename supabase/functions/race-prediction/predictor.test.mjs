import test from "node:test";
import assert from "node:assert/strict";
import { rankPredictions, predictRace } from "./predictor.mjs";

function fixture() {
  const racers = {};
  const preview = { racers: {} };
  for (let boat = 1; boat <= 6; boat += 1) {
    racers[String(boat)] = {
      entry_number: boat,
      national_top_3_percent: boat === 1 ? 80 : 35,
      local_top_3_percent: boat === 1 ? 75 : 35,
      motor_top_3_percent: boat === 1 ? 70 : 35,
      boat_top_3_percent: boat === 1 ? 65 : 35,
      rank_number: boat === 1 ? 1 : 3,
      average_start_timing: boat === 1 ? 0.12 : 0.2,
      flying_count: 0,
    };
    preview.racers[String(boat)] = { course_number: boat, start_timing: boat === 1 ? 0.1 : 0.2, exhibition_time: boat === 1 ? 6.7 : 6.9 };
  }
  return { racers, preview };
}

test("ranks exactly 120 unique trifecta combinations", () => {
  const ranked = rankPredictions(fixture());
  assert.equal(ranked.length, 120);
  assert.equal(new Set(ranked.map((item) => item.combination.join("-"))).size, 120);
  assert.deepEqual(ranked[0].combination, [1, 2, 3]);
});

test("returns a single main prediction with metadata", () => {
  const result = predictRace(fixture(), { informationStatus: "ready_preview", sourceHash: "abc", fetchedAt: "2026-09-17T00:00:00.000Z", sourceUrl: "https://example.test" });
  assert.deepEqual(result.prediction, [1, 2, 3]);
  assert.equal(result.modelVersion, "race-v1");
  assert.equal(result.candidates.length, 3);
});
