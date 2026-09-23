import test from "node:test";
import assert from "node:assert/strict";
import { buildBackfillTasks, classifyRetry, enumerateDates, selectDueTask } from "./scheduler.mjs";

test("enumerates an inclusive date range without timezone drift", () => {
  assert.deepEqual(enumerateDates("2026-09-18", "2026-09-20"), ["2026-09-18", "2026-09-19", "2026-09-20"]);
});

test("backfill tasks are queued one date at a time", () => {
  const tasks = buildBackfillTasks({ from: "2026-01-01", through: "2026-01-03", now: "2026-09-20T00:00:00Z", priority: -1 });
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].state, "queued");
  assert.equal(tasks[0].priority, -1);
  assert.equal(tasks[2].raceDate, "2026-01-03");
});

test("Retry-After is respected for rate limits", () => {
  const result = classifyRetry({ code: "fetch_429", attemptCount: 0, retryAfterSeconds: 37, now: "2026-09-20T00:00:00Z" });
  assert.deepEqual(result, { state: "retry", nextAttemptAt: "2026-09-20T00:00:37.000Z", errorCode: "fetch_429" });
});

test("transient failures use staged backoff and then quarantine", () => {
  assert.equal(classifyRetry({ code: "fetch_5xx", attemptCount: 0, now: "2026-09-20T00:00:00Z" }).nextAttemptAt, "2026-09-20T00:05:00.000Z");
  assert.equal(classifyRetry({ code: "fetch_5xx", attemptCount: 2, now: "2026-09-20T00:00:00Z" }).nextAttemptAt, "2026-09-20T01:00:00.000Z");
  assert.equal(classifyRetry({ code: "fetch_5xx", attemptCount: 5 }).state, "quarantined");
  assert.equal(classifyRetry({ code: "invalid_json", attemptCount: 0 }).state, "quarantined");
});

test("a recent 404 is retried with a bounded backoff", () => {
  const result = classifyRetry({ code: "fetch_404", raceDate: "2026-09-22", attemptCount: 0, now: "2026-09-22T00:00:00Z" });
  assert.equal(result.state, "retry");
  assert.equal(result.nextAttemptAt, "2026-09-22T00:05:00.000Z");
  assert.equal(classifyRetry({ code: "fetch_404", raceDate: "2026-09-22", attemptCount: 3, now: "2026-09-22T00:00:00Z" }).state, "quarantined");
});

test("an old 404 is quarantined and is not retried forever", () => {
  const result = classifyRetry({ code: "fetch_404", raceDate: "2026-09-20", attemptCount: 0, now: "2026-09-22T00:00:00Z" });
  assert.equal(result.state, "quarantined");
});

test("due selection honors priority and one-task budget", () => {
  const tasks = [
    { raceDate: "2026-09-18", state: "queued", priority: -1, nextAttemptAt: "2026-09-19T00:00:00Z" },
    { raceDate: "2026-09-20", state: "queued", priority: 10, nextAttemptAt: "2026-09-19T00:00:00Z" },
    { raceDate: "2026-09-19", state: "succeeded", priority: 100, nextAttemptAt: "2026-09-19T00:00:00Z" },
  ];
  assert.deepEqual(selectDueTask(tasks, { now: "2026-09-20T00:00:00Z" }), [tasks[1]]);
});
