import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiGeneration } from './ai-generation.mjs';
import { DEFAULT_AI_CONFIG } from './ai-config.mjs';

const good = { main: [1,2,3], counter: [2,3,4], hole: [6,5,4], narrative: '展開の説明' };
const success = (value = good, reason = 'STOP') => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: reason }] }));
const failure = (status, headers = {}, error = 'temporary') => new Response(JSON.stringify({ error }), { status, headers });
function harness(responses, options = {}) {
  let clock = 0;
  const sent = [], saved = [], failed = [], attempts = [], waits = [];
  const job = { id: 'job', ownerToken: 'owner', expiresAt: new Date(90000).toISOString(), inputBundle: { identity: {}, facts: { program: { name: '固定データ' } }, provenance: { sourceCode: 'fixture', fetchedAt: null } } };
  const run = () => runAiGeneration({ job, config: { ...DEFAULT_AI_CONFIG }, apiKey: 'fake-key', now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
    fetchImpl: async (_url, request) => { sent.push(JSON.parse(request.body)); const response = responses[sent.length - 1]; assert.ok(response, 'unexpected extra AI request'); return typeof response === 'function' ? response({ advance: ms => { clock += ms; } }) : response; },
    store: {
      beginAttempt: async () => { if (options.beginThrows) throw new Error('begin unavailable'); return { sendAuthorized: options.authorized ?? true }; },
      finishAttempt: async value => { attempts.push(value); return { recorded: options.recorded ?? true }; },
      finishPrediction: async value => { saved.push(value); if (options.saveThrows) throw new Error('save unavailable'); return { saved: options.saveResult ?? true }; },
      failPrediction: async (...args) => { failed.push(args); },
    },
  });
  return { run, sent, saved, failed, attempts, waits, get clock() { return clock; } };
}

test('valid first response is saved as one bundle without another AI request', async () => {
  const h = harness([success()]); await h.run(); assert.equal(h.sent.length, 1); assert.deepEqual(h.saved[0].output, good); assert.equal(h.failed.length, 0);
  assert.match(h.sent[0].systemInstruction.parts[0].text, /読みやすいまとまりごとに、空行を1行入れてください。/);
  assert.equal(JSON.stringify(h.saved[0].requestPayload).includes('fake-key'), false);
});
test('invalid first response is repaired once using the same facts', async () => {
  const h = harness([success({ ...good, main: [1,1,3] }), success()]); await h.run();
  assert.equal(h.sent.length, 2); assert.deepEqual(h.waits, [1000]); assert.equal(h.saved[0].sequence, 2);
  assert.deepEqual(h.sent[0].contents, h.sent[1].contents); assert.match(h.sent[1].systemInstruction.parts[0].text, /main_duplicate_boat/);
});
test('two invalid responses stop without saving or a third request', async () => {
  const h = harness([success({ ...good, narrative: '' }), success({ ...good, narrative: '' })]); await h.run();
  assert.equal(h.sent.length, 2); assert.equal(h.saved.length, 0); assert.equal(h.failed.length, 1);
});
for (const status of [408, 429, 500, 502, 503, 504]) test(`HTTP ${status} without Retry-After waits one second before retry`, async () => {
  const h = harness([failure(status), success()]); await h.run(); assert.deepEqual(h.waits, [1000]); assert.equal(h.saved.length, 1);
});
for (const status of [400, 401, 403, 404]) test(`HTTP ${status} ends without retry`, async () => {
  const h = harness([failure(status)]); await h.run(); assert.equal(h.sent.length, 1); assert.equal(h.failed[0][3], false);
});
test('daily quota exhaustion ends without retry', async () => {
  const h = harness([failure(429, {}, 'RequestsPerDay exhausted')]); await h.run(); assert.equal(h.sent.length, 1); assert.equal(h.failed[0][3], false);
});
test('Retry-After is respected and excessive wait prevents retry', async () => {
  const h = harness([failure(429, { 'retry-after': '3' }), success()]); await h.run(); assert.deepEqual(h.waits, [3000]);
  const long = harness([failure(429, { 'retry-after': '90' })]); await long.run(); assert.equal(long.sent.length, 1); assert.equal(long.saved.length, 0);
});
test('invalid Retry-After falls back to one second', async () => {
  const h = harness([failure(503, { 'retry-after': 'invalid' }), success()]); await h.run(); assert.deepEqual(h.waits, [1000]);
});
test('network exception retries once and records uncertain first attempt', async () => {
  const h = harness([() => { throw new Error('network'); }, success()]); await h.run(); assert.equal(h.sent.length, 2); assert.equal(h.attempts[0].unknown, true);
});
test('truncated output is regenerated even when its JSON is valid', async () => {
  const h = harness([success(good, 'MAX_TOKENS'), success()]); await h.run(); assert.equal(h.saved[0].sequence, 2);
});
test('first response taking 50 or 70 seconds is accepted without arbitrary early retry', async () => {
  for (const duration of [50000, 70000]) {
    const h = harness([({ advance }) => { advance(duration); return success(); }]); await h.run();
    assert.equal(h.sent.length, 1, `${duration}ms should use one provider request`); assert.equal(h.saved.length, 1, `${duration}ms should save`);
  }
});
test('T09 real wall-clock provider waits of 50 and 70 seconds save once within the shared deadline', async () => {
  for (const delayMs of [50_000, 70_000]) {
    let providerCalls = 0;
    let saved = 0;
    const startedAt = Date.now();
    await runAiGeneration({
      job: { id: `t09-${delayMs}`, ownerToken: 'fixture-owner', expiresAt: new Date(startedAt + 90_000).toISOString(),
        inputBundle: { identity: {}, facts: { program: {} }, provenance: { sourceCode: 'fixture', fetchedAt: null } } },
      config: { ...DEFAULT_AI_CONFIG }, apiKey: 'synthetic-test-key',
      store: {
        beginAttempt: async () => ({ sendAuthorized: true }),
        finishAttempt: async () => ({ recorded: true }),
        finishPrediction: async () => { saved++; return { saved: true }; },
        failPrediction: async () => assert.fail('real-time mock response should finish before the deadline'),
      },
      fetchImpl: async () => {
        providerCalls++;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return success();
      },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(providerCalls, 1, `${delayMs}ms response should use one provider request`);
    assert.equal(saved, 1, `${delayMs}ms response should save one complete bundle`);
    assert.ok(elapsedMs >= delayMs && elapsedMs < 90_000, `${delayMs}ms response should finish inside the original deadline; elapsed=${elapsedMs}`);
  }
});
test('T02 two delayed provider responses cannot extend the shared deadline', async () => {
  const h = harness([
    ({ advance }) => { advance(40000); return failure(503); },
    ({ advance }) => { advance(50000); return success(); },
  ]);
  await h.run();
  assert.equal(h.sent.length, 2); assert.equal(h.saved.length, 0); assert.equal(h.failed.length, 1);
  assert.ok(h.clock > 90000, 'the simulated responses should cross the original deadline');
});
test('exhausted generation budget prevents another AI request', async () => {
  const h = harness([({ advance }) => { advance(85000); return failure(503); }]); await h.run(); assert.equal(h.sent.length, 1); assert.equal(h.saved.length, 0);
});
test('response arriving after deadline is not submitted for saving', async () => {
  const h = harness([({ advance }) => { advance(90001); return success(); }]); await h.run(); assert.equal(h.saved.length, 0); assert.equal(h.sent.length, 1);
});
test('missing send authorization or failure log prevents additional requests', async () => {
  const denied = harness([], { authorized: false }); await denied.run(); assert.equal(denied.sent.length, 0);
  const unrecorded = harness([failure(503)], { recorded: false }); await unrecorded.run(); assert.equal(unrecorded.sent.length, 1);
});
test('D15 authorization response loss records unknown attempt and closes the job without calling provider', async () => {
  const h = harness([], { beginThrows: true });
  await h.run();
  assert.equal(h.sent.length, 0);
  assert.equal(h.attempts.length, 1);
  assert.equal(h.attempts[0].unknown, true);
  assert.equal(h.attempts[0].errorCode, 'attempt_authorization_unknown');
  assert.equal(h.failed.length, 1);
  assert.equal(h.failed[0][2], 'attempt_authorization_unknown');
  assert.equal(h.failed[0][3], true);
});
test('save refusal or ambiguous save exception never regenerates the prediction', async () => {
  const refused = harness([success()], { saveResult: false }); await refused.run(); assert.equal(refused.sent.length, 1);
  const uncertain = harness([success()], { saveThrows: true }); await assert.rejects(uncertain.run, /save unavailable/); assert.equal(uncertain.sent.length, 1);
});
