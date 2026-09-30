import test from 'node:test';
import assert from 'node:assert/strict';
import { pollAiBundlePrediction } from './client.mjs';
const bundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', main: [1,2,3], counter: [2,3,4], hole: [6,5,4], narrative: '展開' };
const pending = remainingMs => ({ status: 202, body: { status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', jobId: 'job', remainingMs } });
const complete = () => ({ status: 200, body: bundle });
for (const phase of ['POST', 'GET']) test(`late success from ${phase} is rejected`, async () => {
  let clock = 0;
  await assert.rejects(() => pollAiBundlePrediction(async () => { if (phase === 'POST') { clock = 90001; return complete(); } return pending(5000); }, async () => { clock = 5001; return complete(); }, { now: () => clock, sleep: async ms => { clock += ms; } }), { code: 'retryable_failure' });
});
test('transient GET failure recovers without repeating POST', async () => {
  let clock = 0, starts = 0, reads = 0;
  const result = await pollAiBundlePrediction(async () => { starts++; return pending(20000); }, async () => { if (++reads === 1) throw new Error('network'); return complete(); }, { now: () => clock, sleep: async ms => { clock += ms; } });
  assert.equal(starts, 1); assert.equal(reads, 2); assert.equal(result.narrative, bundle.narrative);
});
test('later remainingMs cannot extend the shared deadline', async () => {
  let clock = 0, reads = 0;
  await assert.rejects(() => pollAiBundlePrediction(async () => pending(3000), async () => { reads++; clock += 500; return pending(90000); }, { now: () => clock, sleep: async ms => { clock += ms; } }), { code: 'retryable_failure' });
  assert.ok(reads <= 2);
});
test('T08 wall-clock jumps do not move the monotonic client deadline', async () => {
  let monotonic = 0;
  const realDateNow = Date.now;
  let wallOffset = 0;
  Date.now = () => realDateNow() + wallOffset;
  try {
    const result = await pollAiBundlePrediction(async () => {
      wallOffset = 24 * 60 * 60 * 1000;
      return pending(3000);
    }, async () => {
      wallOffset = -24 * 60 * 60 * 1000;
      return complete();
    }, { timeoutMs: 2000, now: () => monotonic, sleep: async ms => { monotonic += ms; } });
    assert.deepEqual(result, { main: bundle.main, counter: bundle.counter, hole: bundle.hole, narrative: bundle.narrative });
    assert.ok(monotonic > 0 && monotonic < 2000);
  } finally { Date.now = realDateNow; }
});
test('cancellation during response prevents adopting a result', async () => {
  const controller = new AbortController();
  await assert.rejects(() => pollAiBundlePrediction(async () => { controller.abort(); return complete(); }, async () => complete(), { signal: controller.signal }), { code: 'aborted' });
});
test('nonretryable failure keeps the no-retry classification', async () => {
  await assert.rejects(() => pollAiBundlePrediction(async () => ({ status: 503, body: { retryable: false } }), async () => complete()), { code: 'not_retryable' });
});
test('T11 performs a final job GET when only two seconds remain and respects nonretryable failure', async () => {
  let clock = 0, reads = 0, starts = 0;
  await assert.rejects(() => pollAiBundlePrediction(async () => { starts++; return pending(2000); }, async () => {
    reads++; return { status: 503, body: { status: 'failed', retryable: false } };
  }, { timeoutMs: 5000, now: () => clock, sleep: async ms => { clock += ms; } }), { code: 'not_retryable' });
  assert.equal(starts, 1);
  assert.equal(reads, 1);
  assert.ok(clock >= 1700 && clock <= 2000, `final GET should occur near the 2s server deadline, clock=${clock}`);
});
test('a request ignoring AbortSignal still ends at the client timeout', { timeout: 2000 }, async () => {
  await assert.rejects(() => pollAiBundlePrediction(async () => new Promise(() => {}), async () => complete(), { timeoutMs: 20 }), { code: 'retryable_failure' });
});
test('a pending request ignoring AbortSignal still ends when user cancels', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  await assert.rejects(() => pollAiBundlePrediction(async () => { controller.abort(); return new Promise(() => {}); }, async () => complete(), { signal: controller.signal }), { code: 'aborted' });
});
