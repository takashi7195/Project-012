import test from "node:test";
import assert from "node:assert/strict";
import { waitForLocalFunction } from "./ai-edge-readiness.mjs";

function fixture(statuses, overrides = {}) {
  let clock = 0;
  let index = 0;
  let cancellations = 0;
  const requests = [];
  const progress = [];
  const options = {
    endpoint: "http://127.0.0.1/function",
    isRunnerStopped: () => false,
    diagnostics: () => "edgeContainer=created|false|0",
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    onProgress: (message) => progress.push(message),
    fetchImpl: async (_url, init) => {
      requests.push(init.method);
      const status = statuses[Math.min(index++, statuses.length - 1)];
      if (status === "network_error") throw new Error("connection refused");
      return { status, body: { cancel: async () => { cancellations++; } } };
    },
    ...overrides,
  };
  return { options, requests, progress, elapsed: () => clock, cancellations: () => cancellations };
}

test("startup tolerates connection failure, 502, 503, and 404 until 204", async () => {
  const f = fixture(["network_error", 502, 503, 404, 204]);
  await waitForLocalFunction(f.options);
  assert.equal(f.requests.length, 5);
  assert.ok(f.requests.every((method) => method === "OPTIONS"));
  assert.equal(f.cancellations(), 4);
  assert.equal(f.elapsed(), 2000);
});

test("persistent 503 stops at the fixed deadline with diagnostics and no task start", async () => {
  const f = fixture([503]);
  let taskStarted = false;
  await assert.rejects(async () => {
    await waitForLocalFunction(f.options);
    taskStarted = true;
  }, /timed out after 60000ms; last=503; no task POST sent; edgeContainer=created/);
  assert.equal(taskStarted, false);
  assert.equal(f.elapsed(), 60000);
  assert.deepEqual(f.progress.map((message) => message.match(/\((\d+)s/)[1]), ["15", "30", "45"]);
  assert.ok(f.requests.every((method) => method === "OPTIONS"));
  assert.equal(f.cancellations(), f.requests.length);
});

test("runner exit during startup stops probing promptly", async () => {
  const f = fixture([503]);
  f.options.isRunnerStopped = () => f.requests.length > 0;
  await assert.rejects(waitForLocalFunction(f.options), /runner stopped during startup/);
  assert.equal(f.requests.length, 1);
});

test("authentication errors fail immediately instead of waiting out startup", async () => {
  const f = fixture([401]);
  await assert.rejects(waitForLocalFunction(f.options), /readiness returned 401/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.cancellations(), 1);
  assert.equal(f.elapsed(), 0);
});
