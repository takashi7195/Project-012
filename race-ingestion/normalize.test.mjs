import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSnapshot, sha256Json } from "./normalize.mjs";

function fixture({ result = {}, preview = {}, extras = {} } = {}) {
  const race = {
    date: "2026-09-20", stadium_number: 1, race_number: 1,
    closed_at: "2026-09-20 10:28:00", title: "試験レース", subtitle: "予選", ...extras,
    racers: { "1": { entry_number: 1, name: "選手 一", number: 1001, rank_number_source: "A1", age: 30, weight: 52, average_start_timing: 0.14, national_win_rate: 6.2, boat_number: 10 } },
    preview: { date: "2026-09-20", stadium_number: 1, race_number: 1, racers: { "1": { entry_number: 1, course_number: 1, start_timing: 0.12, exhibition_time: 6.7, ...preview } }, ...preview.weather },
    result: { date: "2026-09-20", stadium_number: 1, race_number: 1, racers: { "1": { entry_number: 1, place_number_source: "1", place_number: 1, ...result } }, payouts: { trifecta: [{ combination: "1-2-3", amount: 1000 }] } },
  };
  return { programs: { stadiums: { "1": { races: { "1": race } } } } };
}

test("normalizes a race and keeps unknown raw fields", () => {
  const normalized = normalizeSnapshot(fixture({ extras: { future_field: { keep: true } } }), { fetchedAt: "2026-09-20T00:00:00Z" });
  assert.equal(normalized.accepted, true);
  assert.equal(normalized.raceCount, 1);
  assert.equal(normalized.races[0].program.rows[0].registrationNumber, 1001);
  assert.equal(normalized.races[0].raw.program.future_field.keep, true);
  assert.equal(normalized.races[0].result.payouts.rows[0].amountYen, 1000);
});

test("does not treat an empty result as available", () => {
  const raw = fixture();
  raw.programs.stadiums["1"].races["1"].result = { date: "2026-09-20", stadium_number: 1, race_number: 1, racers: { "1": { entry_number: 1, place_number: null } }, payouts: { trifecta: [] } };
  const normalized = normalizeSnapshot(raw);
  assert.equal(normalized.accepted, true);
  assert.equal(normalized.resultRaceCount, 0);
  assert.equal(normalized.races[0].result.presence, "value");
  assert.equal(normalized.races[0].result.rows[0].placeNumber, null);
});

test("preserves negative ST, special place codes, refunds, and payout labels", () => {
  const raw = fixture({ result: { place_number_source: "F", place_number: 14, start_timing_source: "F.03", start_timing: -0.03 } });
  raw.programs.stadiums["1"].races["1"].result.refunds = [1];
  raw.programs.stadiums["1"].races["1"].result.payouts.trifecta = [{ combination: null, amount: 70, label: "特払" }];
  const row = normalizeSnapshot(raw).races[0];
  assert.equal(row.result.rows[0].placeCode, "F");
  assert.equal(row.result.rows[0].placeNumber, 14);
  assert.equal(row.result.rows[0].startTiming, -0.03);
  assert.deepEqual(row.result.refunds.rows[0].entryNumber, 1);
  assert.equal(row.result.payouts.rows[0].label, "特払");
  assert.equal(row.result.payouts.rows[0].combination, null);
});

test("rejects identity mismatch rather than merging a wrong race", () => {
  const raw = fixture();
  raw.programs.stadiums["1"].races["1"].result.race_number = 2;
  const normalized = normalizeSnapshot(raw);
  assert.equal(normalized.accepted, false);
  assert.ok(normalized.issues.some((item) => item.code === "identity_mismatch"));
});

test("canonical hash is independent of object key order", () => {
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
});
