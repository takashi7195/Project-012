import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSnapshot } from "./normalize.mjs";
import { toIngestionRecords, toRpcPayload } from "./records.mjs";
import { ingestDate } from "./ingest-date.mjs";

test("record payload keeps race identity and separates payout kinds", () => {
  const raw = { programs: { stadiums: { "1": { races: { "1": {
    date: "2026-09-20", stadium_number: 1, race_number: 1, racers: { "1": { entry_number: 1, number: 1234 } },
    result: { date: "2026-09-20", stadium_number: 1, race_number: 1, racers: { "1": { entry_number: 1, place_number: 1, place_number_source: "1" } }, payouts: { trifecta: [{ combination: null, amount: 70, label: "特払" }] }, refunds: [1] },
  } } } } } };
  const snapshot = normalizeSnapshot(raw, { fetchedAt: "2026-09-20T00:00:00Z" });
  const payload = toIngestionRecords(snapshot);
  assert.equal(payload.records.length, 1);
  assert.deepEqual(payload.records[0].race, { sourceCode: "boatraceopenapi-v1", raceDate: "2026-09-20", stadiumCode: 1, raceNumber: 1 });
  assert.equal(payload.records[0].result.payouts[0].payoutKind, "special");
  assert.equal(payload.records[0].result.refunds[0].entryNumber, 1);
  assert.equal(toRpcPayload(snapshot).p_source_code, "boatraceopenapi-v1");
});

test("ingestion worker refuses the v0.1.10 production project", async () => {
  await assert.rejects(() => ingestDate("2026-09-20", { supabaseUrl: "https://example.supabase.co", serviceRoleKey: "test", projectRef: "jxjxqfrtvdpvrifktxsf" }), /refusing to ingest/);
});
