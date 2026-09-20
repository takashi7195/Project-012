import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { fetchDailyJson } from "./api-client.mjs";
import { runWorker } from "./worker.mjs";
import { summarizeCapacityObservations } from "./capacity-acceptance.mjs";

function payload() {
  return { sourceCode: "acceptance", rawHash: "acceptance-hash", records: [{ race: { raceNumber: 1 } }] };
}

test("simulated concurrent workers publish one snapshot", async () => {
  const task = { taskId: "same-task", raceDate: "2026-09-20", attemptCount: 0 };
  let claimed = false;
  let writes = 0;
  const claimTask = async () => {
    // This models the database claim RPC's atomic row lock. Both workers can
    // start at once, but only the first transaction receives the lease.
    if (claimed) return null;
    claimed = true;
    return { ...task, leaseToken: "lease-1" };
  };
  const run = (workerId) => runWorker({
    workerId,
    claimTask,
    fetchDaily: async () => ({ status: "fetched", json: { ok: true } }),
    normalize: async () => ({ accepted: true, records: [], raceCount: 1 }),
    buildPayload: async () => payload(),
    writeSnapshotChunk: async (_chunk, meta) => { writes += 1; return { publish: meta.publish }; },
    finishTask: async () => true,
  });
  const results = await Promise.all([run("worker-a"), run("worker-b")]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["idle", "succeeded"]);
  assert.equal(writes, 1);
});

test("simulated upstream 429 and timeout retain distinct retry causes", async () => {
  const server = createServer((request, response) => {
    if (request.url.endsWith("/429")) {
      response.writeHead(429, { "retry-after": "3" });
      response.end("rate limited");
      return;
    }
    setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); }, 50);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const localFetch = (path, timeoutMs = 100) => fetchDailyJson("2026-09-20", {
      timeoutMs,
      fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${port}${path}`, options),
    });
    await assert.rejects(() => localFetch("/429"), (error) => error.code === "fetch_429" && error.retryAfter === "3");
    await assert.rejects(() => localFetch("/timeout", 10), (error) => error.code === "fetch_timeout");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("capacity acceptance stays pending until seven observation dates exist", () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    observation_date: `2026-09-${String(index + 15).padStart(2, "0")}`,
    observed_at: `2026-09-${String(index + 15).padStart(2, "0")}T00:00:00Z`,
    database_bytes: 100 + index,
    race_data_bytes: 50 + index,
  }));
  assert.equal(summarizeCapacityObservations(rows).status, "pending");
  rows.push({ observation_date: "2026-09-21", observed_at: "2026-09-21T00:00:00Z", database_bytes: 107, race_data_bytes: 57 });
  const result = summarizeCapacityObservations(rows);
  assert.equal(result.status, "ready");
  assert.equal(result.distinctDates.length, 7);
  assert.equal(result.totalRaceDataBytes, 372);
});
