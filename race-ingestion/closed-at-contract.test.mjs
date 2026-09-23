import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260924000000_closed_at_contract_v0_1_14.sql", import.meta.url), "utf8");
const fixture = await readFile(new URL("../tools/local-integration/seed-prediction-fixture.sql", import.meta.url), "utf8");

test("closed_at contract explicitly interprets source as Asia/Tokyo", () => {
  assert.match(migration, /timestamp without time zone at time zone 'Asia\/Tokyo'/);
  assert.match(migration, /closed_at is null/);
  assert.match(migration, /closed_at_source !~|p_source !~/);
  assert.match(migration, /exception when others then/);
});

test("ingest wrapper updates source and typed value on conflict", () => {
  assert.match(migration, /ingest_snapshot_legacy_v0_1_14/);
  assert.match(migration, /set closed_at_source =/);
  assert.match(migration, /closed_at = race_data\.parse_closed_at_source/);
  assert.match(migration, /snapshot_races/);
});

test("local prediction fixture uses the typed contract source format", () => {
  assert.match(fixture, /closedAtSource','2099-12-31 23:00:00/);
  assert.doesNotMatch(fixture, /closedAtSource','2099-12-31T23:00:00Z/);
});

test("JST conversion reference is deterministic", () => {
  const value = new Date("2026-09-23T14:35:00+09:00");
  assert.equal(value.toISOString(), "2026-09-23T05:35:00.000Z");
});
