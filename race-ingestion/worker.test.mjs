import test from "node:test";
import assert from "node:assert/strict";
import { chunkRecords, runWorker } from "./worker.mjs";

function payload(count) {
  return { sourceCode: "test", rawHash: "hash", records: Array.from({ length: count }, (_, i) => ({ race: { raceNumber: i + 1 } })) };
}

test("chunkRecords preserves metadata and bounds each write", () => {
  const chunks = chunkRecords(payload(17), 8);
  assert.deepEqual(chunks.map((chunk) => chunk.records.length), [8, 8, 1]);
  assert.equal(chunks[2].rawHash, "hash");
  assert.equal(chunks[0].records[0].race.raceNumber, 1);
});

test("worker publishes only the last chunk and finishes once", async () => {
  const calls = [];
  const result = await runWorker({
    workerId: "test-worker",
    claimTask: async () => ({ taskId: "task", raceDate: "2026-09-20", attemptCount: 0 }),
    fetchDaily: async () => ({ status: "fetched", json: { ok: true } }),
    normalize: async () => ({ accepted: true, records: [], raceCount: 17 }),
    buildPayload: async () => payload(17),
    writeSnapshotChunk: async (chunk, meta) => { calls.push({ size: chunk.records.length, publish: meta.publish }); return { size: chunk.records.length }; },
    finishTask: async (_task, state) => { calls.push({ finish: state }); return true; },
    chunkSize: 8,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, [{ size: 8, publish: false }, { size: 8, publish: false }, { size: 1, publish: true }, { finish: { state: "succeeded", nextAttemptAt: null, errorCode: null } }]);
});

test("worker is idle without claiming or writing", async () => {
  let writes = 0;
  const result = await runWorker({ workerId: "test-worker", claimTask: async () => null, writeSnapshotChunk: async () => { writes += 1; }, finishTask: async () => true });
  assert.deepEqual(result, { status: "idle" });
  assert.equal(writes, 0);
});

test("not-modified completes without normalization or write", async () => {
  let normalized = 0;
  let writes = 0;
  const result = await runWorker({
    workerId: "test-worker",
    claimTask: async () => ({ taskId: "task", raceDate: "2026-09-20", attemptCount: 0 }),
    fetchDaily: async () => ({ status: "not_modified" }),
    normalize: async () => { normalized += 1; },
    writeSnapshotChunk: async () => { writes += 1; },
    finishTask: async (_task, state) => state.state === "succeeded",
  });
  assert.deepEqual(result, { status: "not_modified", raceDate: "2026-09-20" });
  assert.equal(normalized, 0);
  assert.equal(writes, 0);
});

test("transient API failure schedules retry and permanent parse failure quarantines", async () => {
  const outcomes = [];
  const run = (code, attemptCount) => runWorker({
    workerId: "test-worker",
    claimTask: async () => ({ taskId: code, raceDate: "2026-09-20", attemptCount }),
    fetchDaily: async () => { throw Object.assign(new Error(code), { code }); },
    finishTask: async (_task, state) => { outcomes.push(state); return true; },
    now: "2026-09-20T00:00:00Z",
  });
  const retry = await run("fetch_5xx", 0);
  const quarantine = await run("invalid_json", 0);
  assert.equal(retry.status, "retry");
  assert.equal(quarantine.status, "quarantined");
  assert.equal(outcomes[0].state, "retry");
  assert.equal(outcomes[1].state, "quarantined");
});

test("worker passes Retry-After from a 429 failure to the retry scheduler", async () => {
  const finished = [];
  const now = new Date("2026-09-20T00:00:00.000Z");
  const result = await runWorker({
    workerId: "worker-429",
    claimTask: async () => ({ taskId: "task-429", raceDate: "2026-09-20", attemptCount: 1, leaseToken: "lease-429" }),
    fetchDaily: async () => { throw Object.assign(new Error("rate limited"), { code: "fetch_429", retryAfterSeconds: 37 }); },
    writeSnapshotChunk: async () => { throw new Error("must not write"); },
    finishTask: async (_task, state) => { finished.push(state); return true; },
    now,
  });
  assert.equal(result.status, "retry");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].nextAttemptAt, "2026-09-20T00:00:37.000Z");
});

test("worker records failure metadata before releasing the lease", async () => {
  const events = [];
  const result = await runWorker({
    workerId: "worker-log",
    claimTask: async () => ({ taskId: "task-log", raceDate: "2026-09-20", attemptCount: 1, leaseToken: "lease-log" }),
    fetchDaily: async () => { throw Object.assign(new Error("server error"), { code: "fetch_5xx", metadata: { httpStatus: 503, elapsedMs: 1234, bytes: 456 } }); },
    recordFailure: async (task, metadata, decision) => { events.push({ task, metadata, decision }); },
    writeSnapshotChunk: async () => { throw new Error("must not write"); },
    finishTask: async () => true,
    now: new Date("2026-09-20T00:00:00.000Z"),
  });
  assert.equal(result.status, "retry");
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.httpStatus, 503);
  assert.equal(events[0].metadata.elapsedMs, 1234);
  assert.equal(events[0].metadata.bytes, 456);
  assert.equal(events[0].decision.state, "retry");
});

test("worker records a not-modified observation before finishing", async () => {
  const observations = [];
  const result = await runWorker({
    workerId: "worker-304",
    claimTask: async () => ({ taskId: "task-304", raceDate: "2026-09-20", attemptCount: 1, leaseToken: "lease-304" }),
    fetchDaily: async () => ({ status: "not_modified", meta: { httpStatus: 304, etag: '"abc"', elapsedMs: 12 } }),
    recordObservation: async (task, metadata) => { observations.push({ task, metadata }); },
    writeSnapshotChunk: async () => { throw new Error("must not write"); },
    finishTask: async () => true,
  });
  assert.equal(result.status, "not_modified");
  assert.equal(observations.length, 1);
  assert.equal(observations[0].metadata.httpStatus, 304);
  assert.equal(observations[0].metadata.etag, '"abc"');
});

test("the first leased attempt uses the five-minute retry delay", async () => {
  let finished;
  const result = await runWorker({
    workerId: "test-worker",
    claimTask: async () => ({ taskId: "task", raceDate: "2026-09-20", attemptCount: 1 }),
    fetchDaily: async () => { throw Object.assign(new Error("temporary"), { code: "fetch_5xx" }); },
    finishTask: async (_task, state) => { finished = state; return true; },
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(result.status, "retry");
  assert.equal(finished.nextAttemptAt, "2026-09-20T00:05:00.000Z");
});

test("lease loss is surfaced instead of reported as success", async () => {
  await assert.rejects(() => runWorker({
    workerId: "test-worker",
    claimTask: async () => ({ taskId: "task", raceDate: "2026-09-20", attemptCount: 0 }),
    fetchDaily: async () => ({ status: "not_modified" }),
    finishTask: async () => false,
  }), /lease_lost/);
});
