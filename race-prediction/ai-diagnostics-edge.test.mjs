import test from 'node:test';
import assert from 'node:assert/strict';

const jobId = '77777777-7777-4777-8777-777777777777';
const owner = '88888888-8888-4888-8888-888888888888';
const secret = 'EDGE_SECRET_NEVER_LOG';
const identity = { raceDate: '2099-12-31', stadiumCode: 1, raceNumber: 1 };
const output = { main: [1,2,3], counter: [2,3,4], hole: [6,5,4], narrative: secret };
const programRaw = { date: identity.raceDate, stadium_number: 1, race_number: 1,
  racers: Object.fromEntries([1,2,3,4,5,6].map(n => [n, { entry_number: n }])) };
const vars = { SUPABASE_URL: 'https://diagnostic.invalid', SUPABASE_SERVICE_ROLE_KEY: secret + '_SERVICE',
  SUPABASE_PUBLISHABLE_KEY: secret + '_PUBLIC', GEMINI_API_KEY: secret + '_GEMINI', PREDICTION_MODE: 'ai_bundle',
  RACE_AI_DIAGNOSTIC_RUN_ID: '99999999-9999-4999-8999-999999999999', RACE_AI_DIAGNOSTIC_CASE_ID: 'L01' };

test('L01/L04/L05 Edge response correlation and safe RPC/worker failure boundaries', async t => {
  const previous = { fetch: globalThis.fetch, Deno: globalThis.Deno, EdgeRuntime: globalThis.EdgeRuntime, info: console.info };
  let handler, worker, mode = 'success', lines = [], sent = 0, failedWrites = 0;
  console.info = line => lines.push(line);
  globalThis.Deno = { env: { get: key => vars[key], toObject: () => ({ ...vars }) }, serve: fn => { handler = fn; } };
  globalThis.EdgeRuntime = { waitUntil: promise => { worker = promise; } };
  globalThis.fetch = async url => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      sent++;
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] });
    }
    const rpc = String(url).split('/').at(-1);
    if (mode === 'rpc_fail' && rpc === 'race_prediction_get_ai_input') return new Response(secret, { status: 502 });
    if (mode === 'save_fail' && rpc === 'race_prediction_finish_ai_job') throw Object.assign(new Error(secret), { cause: { code: 'ECONNRESET' } });
    if (rpc === 'race_prediction_fail_ai_job') failedWrites++;
    return Response.json({
      race_prediction_get_ai_input: { identity, programRaw, previewRaw: null, presence: {}, provenance: {}, closedAt: new Date(Date.now() + 60000).toISOString() },
      race_prediction_claim_ai_job: { state: 'created', jobId, ownerToken: owner, expiresAt: new Date(Date.now() + 60000).toISOString() },
      race_prediction_begin_ai_attempt: { sendAuthorized: true }, race_prediction_finish_ai_job: { saved: true },
      race_prediction_read_ai_job: { state: 'succeeded', prediction: output },
    }[rpc] ?? null);
  };
  const headers = { apikey: vars.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json', 'x-request-id': owner };
  const start = () => handler(new Request('https://diagnostic.invalid/', { method: 'POST', headers,
    body: JSON.stringify({ action: 'generate', contractVersion: 'ai-bundle-v1', ...identity }) }));
  const records = () => lines.map(JSON.parse);
  try {
    await import(`../supabase/functions/predictions/index.ts?diagnostics=${Date.now()}`);
    await t.test('L01 POST and background share ID; GET joins by job with new request ID', async () => {
      const response = await start(); assert.equal(response.status, 202); await worker;
      const id = response.headers.get('x-request-id'); assert.match(id, /^[a-f0-9-]{36}$/); assert.notEqual(id, owner);
      assert.equal(response.headers.get('access-control-expose-headers'), 'X-Request-ID');
      assert.ok(records().every(r => r.requestId === id && r.runId === vars.RACE_AI_DIAGNOSTIC_RUN_ID && r.caseId === 'L01'));
      assert.ok(records().some(r => r.event === 'save.finished' && r.jobId === jobId));
      const read = await handler(new Request(`https://diagnostic.invalid/?action=prediction-job&jobId=${jobId}`, { headers }));
      assert.notEqual(read.headers.get('x-request-id'), id);
      assert.ok(records().some(r => r.event === 'job.read' && r.jobId === jobId && r.requestId === read.headers.get('x-request-id')));
      assert.equal(lines.join('').includes(secret), false); assert.equal(lines.join('').includes(owner), false);
    });
    await t.test('L04/L05 raw DB error body never reaches public response or logs', async () => {
      mode = 'rpc_fail'; lines = []; sent = 0;
      const response = await start(); assert.equal(response.status, 503);
      assert.equal((await response.text()).includes(secret), false); assert.equal(lines.join('').includes(secret), false);
      assert.ok(records().some(r => r.event === 'rpc.failed' && r.operation === 'get_ai_input' && r.httpStatus === 502));
      assert.equal(sent, 0);
    });
    await t.test('L04 waitUntil catches ambiguous save failure without extra request or failure write', async () => {
      mode = 'save_fail'; lines = []; sent = 0; failedWrites = 0;
      const response = await start(); assert.equal(response.status, 202); await assert.doesNotReject(worker);
      assert.equal(sent, 1); assert.equal(failedWrites, 0);
      assert.ok(records().some(r => r.event === 'worker.failed' && r.stage === 'save' && r.transport === 'connection'));
      assert.equal(lines.join('').includes(secret), false);
    });
    await t.test('L06 operational off switch retains response ID and result without logs', async () => {
      mode = 'success'; lines = []; vars.RACE_AI_DIAGNOSTICS = 'off';
      const response = await start(); await worker;
      assert.equal(response.status, 202); assert.ok(response.headers.get('x-request-id')); assert.deepEqual(lines, []);
      delete vars.RACE_AI_DIAGNOSTICS;
    });
  } finally {
    globalThis.fetch = previous.fetch; globalThis.Deno = previous.Deno; globalThis.EdgeRuntime = previous.EdgeRuntime; console.info = previous.info;
    delete vars.RACE_AI_DIAGNOSTICS;
  }
});
