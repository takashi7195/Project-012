import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_LIMITS, createRaceContextClient, toRaceContext } from "./race-context.mjs";

const race = (overrides = {}) => ({ race_id: "secret-id", race_date: "2026-09-24", stadium_code: 12, race_number: 12, batch_id: "secret-batch", last_success_at: "2026-09-24T00:00:00Z", presence: { program: true }, program: { closed_at: "2026-09-24T06:00:00Z", title: "一般", raw: "drop" }, entries: [{ entry_number: 1, name: "選手", average_st: 0.14, raw: "drop" }], preview_entries: [{ entry_number: 1, time: 6.7 }], result_entries: [{ entry_number: 1, finish_position: 1 }], payouts: [{ bet_type: "trifecta", amount_yen: 1000 }], ...overrides });
const payload = (data, extra = {}) => ({ data, coverage: { matched: data.length, returned: data.length, truncated: false }, warnings: [], aggregates: {}, ...extra });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const q = (overrides = {}) => ({ type: "race_search", from: "2026-09-24", to: "2026-09-24", stadium: "住之江", stadiumCode: 12, raceNumber: 12, entryNumber: null, racerName: null, limit: 20, ...overrides });

test("context removes internal ids and preserves approved fields", () => { const c = toRaceContext(payload([race()])); assert.equal(c.races[0].race_id, undefined); assert.equal(c.races[0].batch_id, undefined); assert.equal(c.races[0].program.raw, undefined); assert.equal(c.races[0].stadium_name, "住之江"); });
test("rpc success, no_match, truncated and error are classified", async () => { const success = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => response(payload([race()])) }); assert.equal((await success.search([q()])).status, "success"); const none = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => response(payload([])) }); assert.equal((await none.search([q()])).status, "no_match"); const trunc = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => response(payload([race()], { coverage: { truncated: true } })) }); assert.equal((await trunc.search([q()])).status, "truncated"); const err = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => response({}, 500) }); assert.equal((await err.search([q()])).status, "error"); });
test("basic search maps typed RPC arguments and keeps its race context", async () => { let request; const client = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async (url, init) => { request = { url, body: JSON.parse(init.body) }; return response(payload([race()])); } }); const result = await client.search([q()]); assert.match(request.url, /race_data_search_current_races$/); assert.equal(request.body.p_stadium_code, 12); assert.equal(request.body.p_entry_number, null); assert.equal(result.context.races.length, 1); assert.equal(result.context.races[0].race_id, undefined); });
test("filtered search detail keeps result context after two RPC calls", async () => {
  const calls = [];
  const resultRace = race({
    race_id: "internal-race-id",
    presence: { program: "value", preview: "value", result: "value" },
    result: { result_state: "available", technique_code: "差し", raw_json: "drop" },
    result_entries: [{ entry_number: 1, finish_position: 1, place_code: "1", raw_json: "drop" }],
  });
  const client = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return calls.length === 1
      ? response(payload([{ race_id: "candidate-internal-id", race_date: "2026-09-24", stadium_code: 12, race_number: 12 }]))
      : response(payload([resultRace]));
  } });
  const result = await client.search([{ ...q(), type: "race_search_filtered", racerName: "峰竜太" }]);
  assert.equal(result.status, "success");
  assert.equal(result.rpcCallCount, 2);
  assert.equal(result.filteredCandidateCount, 1);
  assert.equal(result.detailFetchCount, 1);
  assert.equal(result.context.races.length, 1);
  assert.equal(result.context.races[0].result.result_state, "available");
  assert.equal(result.context.races[0].result_entries[0].finish_position, 1);
  assert.equal(result.context.races[0].race_id, undefined);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /race_data_search_current_races$/);
});
test("filtered search with zero candidates remains no_match", async () => {
  let calls = 0;
  const client = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => { calls += 1; return response(payload([])); } });
  const result = await client.search([{ ...q(), type: "race_search_filtered", racerName: "存在しない選手" }]);
  assert.equal(result.status, "no_match");
  assert.equal(result.context.races.length, 0);
  assert.equal(result.rpcCallCount, 1);
  assert.equal(result.filteredCandidateCount, 0);
  assert.equal(result.detailFetchCount, 0);
  assert.equal(calls, 1);
});
test("duplicates are executed once and four calls are refused", async () => { let calls = 0; const client = createRaceContextClient({ projectUrl: "https://x", serviceRoleKey: "secret", fetchImpl: async () => { calls += 1; return response(payload([race()])); } }); const result = await client.search([q(), q()]); assert.equal(calls, 1); assert.equal(result.rpcCallCount, 1); const four = await client.search([q({ raceNumber: 1 }), q({ raceNumber: 2 }), q({ raceNumber: 3 }), q({ raceNumber: 4 })]); assert.equal(four.status, "error"); });
test("context limits are bounded", () => { const big = Array.from({ length: 50 }, (_, i) => ({ ...race(), race_number: i + 1, entries: Array(10).fill(race().entries[0]), preview_entries: Array(10).fill({ entry_number: 1 }), result_entries: Array(10).fill({ entry_number: 1 }), payouts: Array(30).fill({ bet_type: "trifecta" }) })); const c = toRaceContext(payload(big)); assert.equal(c.races.length, CONTEXT_LIMITS.races); assert.equal(c.races[0].entries.length, 6); assert.equal(c.races[0].payouts.length, 20); });
