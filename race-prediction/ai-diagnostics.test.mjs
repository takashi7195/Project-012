import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDiagnosticLogger, diagnosticError, sanitizeDiagnosticRecord, DIAGNOSTIC_SCHEMA } from './ai-diagnostics.mjs';
import { generateGemini } from './providers/gemini.mjs';
import { runAiGeneration } from './ai-generation.mjs';
import { DEFAULT_AI_CONFIG } from './ai-config.mjs';
import { extractDiagnostic, collectDiagnostics } from '../tools/local-integration/ai-diagnostics-summary.mjs';

const requestId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const secret = 'SENTINEL_SECRET_NEVER_LOG';
const good = { main: [1,2,3], counter: [2,3,4], hole: [6,5,4], narrative: secret };
const input = { identity: {}, facts: { sensitive: secret }, provenance: {} };
const success = (value = good, finishReason = 'STOP') => Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } }, { headers: { 'x-request-id': secret } });
function harness({ responses = [success()], sink, store = {}, id = jobId, expires = 90000 } = {}) {
  let clock = 0, sent = 0, saves = 0, failures = 0;
  const lines = [];
  const logger = createDiagnosticLogger({ requestId, jobId: id, model: DEFAULT_AI_CONFIG.model }, { secrets: [secret], sink: sink ?? (line => lines.push(line)), now: () => clock });
  const run = () => runAiGeneration({ job: { id, ownerToken: secret, expiresAt: new Date(expires).toISOString(), inputBundle: input },
    config: DEFAULT_AI_CONFIG, apiKey: secret, diagnostics: logger, now: () => clock, sleep: async ms => { clock += ms; },
    fetchImpl: async () => { const value = responses[sent++]; assert.ok(value, 'extra provider request'); return typeof value === 'function' ? value(ms => { clock += ms; }) : value; },
    store: { beginAttempt: async () => ({ sendAuthorized: true }), finishAttempt: async () => ({ recorded: true }),
      finishPrediction: async () => { saves++; return { saved: true }; }, failPrediction: async () => { failures++; }, ...store } });
  return { run, lines, records: () => lines.map(JSON.parse), counts: () => ({ sent, saves, failures }) };
}

test('L01 generation, provider, validation and save share request/job IDs without contents', async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.counts(), { sent: 1, saves: 1, failures: 0 });
  const records = h.records();
  assert.deepEqual(records.map(r => r.event), ['worker.started','attempt.started','provider.finished','output.validated','save.started','save.finished','worker.finished']);
  assert.ok(records.every(r => r.requestId === requestId && r.jobId === jobId));
  const provider = records.find(r => r.event === 'provider.finished');
  assert.match(provider.promptHash, /^[a-f0-9]{64}$/); assert.equal(provider.httpStatus, 200); assert.equal(provider.totalTokens, 30);
  assert.match(provider.providerRequestIdHash, /^[a-f0-9]{64}$/);
  assert.equal(h.lines.join('').includes(secret), false);
});

for (const [code, transport] of [['ENOTFOUND','dns'],['EAI_AGAIN','dns'],['ECONNREFUSED','connection'],['ECONNRESET','connection'],['CERT_HAS_EXPIRED','tls'],['UND_ERR_CONNECT_TIMEOUT','timeout'],['UND_ERR_INVALID_ARG','invalid_argument'],['EPERM','permission']]) {
  test(`L02 ${code} classification reaches provider diagnostics`, async () => {
    const error = Object.assign(new TypeError(secret), { cause: { code, message: secret } });
    const response = await generateGemini({ model: DEFAULT_AI_CONFIG.model, prompt: secret, input, apiKey: secret, settings: DEFAULT_AI_CONFIG,
      fetchImpl: async () => { throw error; } });
    assert.equal(response.errorCode, 'provider_network_error'); assert.equal(response.diagnostics.transport, transport);
    assert.equal(response.diagnostics.transportCode, code); assert.equal(JSON.stringify(response).includes(secret), false);
  });
}
test('L02 abort and deadline stop are observable without post-deadline save', async () => {
  assert.equal(diagnosticError(new DOMException(secret, 'AbortError')).transport, 'aborted');
  assert.equal(diagnosticError(new DOMException(secret, 'TimeoutError')).transport, 'timeout');
  const h = harness({ responses: [advance => { advance(90001); return success(); }] }); await h.run();
  assert.equal(h.counts().saves, 0); assert.equal(h.counts().sent, 1);
  assert.ok(h.records().some(r => r.reason === 'deadline'));
});
for (const status of [401,403,429,503]) test(`L03 HTTP ${status} safe status and retry diagnostics`, async () => {
  const response = Response.json({ error: { status: status === 503 ? 'UNAVAILABLE' : 'PERMISSION_DENIED', message: secret, details: [secret] } }, { status });
  const h = harness({ responses: status === 401 || status === 403 ? [response] : [response, success()] }); await h.run();
  const provider = h.records().find(r => r.event === 'provider.finished');
  assert.equal(provider.httpStatus, status); assert.equal(provider.retryable, status === 429 || status === 503);
  assert.equal(h.lines.join('').includes(secret), false);
  assert.equal(h.counts().sent, status === 401 || status === 403 ? 1 : 2);
});
test('L03 invalid provider JSON differs from interrupted body reception', async () => {
  const base = { model: DEFAULT_AI_CONFIG.model, prompt: secret, input, apiKey: secret, settings: DEFAULT_AI_CONFIG };
  const invalid = await generateGemini({ ...base, fetchImpl: async () => new Response(secret) });
  assert.equal(invalid.diagnostics.responseFormat, 'json_invalid');
  const interrupted = await generateGemini({ ...base, fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw Object.assign(new TypeError(secret), { cause: { code: 'ECONNRESET' } }); } }) });
  assert.equal(interrupted.diagnostics.responseFormat, 'body_error'); assert.equal(interrupted.diagnostics.transport, 'connection');
});
test('L03 truncation and invalid tickets are logged and repaired once', async () => {
  for (const response of [success(good, 'MAX_TOKENS'), success({ ...good, main: [1,1,3] })]) {
    const h = harness({ responses: [response, success()] }); await h.run();
    assert.equal(h.counts().sent, 2); assert.equal(h.counts().saves, 1);
    const record = h.records().find(r => r.event === 'output.validated');
    assert.equal(record.ok, false); assert.equal(record.validationCodes.length, 1);
  }
});
for (const operation of ['beginAttempt','finishAttempt','finishPrediction','failPrediction']) test(`L04 ${operation} failure does not add provider requests`, async () => {
  const h = harness({ responses: operation === 'finishAttempt' || operation === 'failPrediction' ? [Response.json({}, { status: 403 })] : [success()],
    store: { [operation]: async () => { throw new Error(secret); } } });
  if (operation === 'beginAttempt') {
    await assert.doesNotReject(h.run);
    assert.equal(h.counts().failures, 1);
    assert.ok(h.records().some(r => r.event === 'attempt.authorization_unknown'));
  } else {
    await assert.rejects(h.run, /SENTINEL/);
    assert.ok(h.records().some(r => r.event === 'worker.failed'));
  }
  assert.equal(h.counts().sent, operation === 'beginAttempt' ? 0 : 1);
  assert.equal(h.lines.join('').includes(secret), false);
  // An ambiguous successful-save RPC must not be followed by a failed-state write.
  if (operation === 'finishPrediction') assert.equal(h.counts().failures, 0);
});
test('L04 throwing, rejected and pending sinks do not block successful prediction', async () => {
  for (const sink of [() => { throw new Error(secret); }, () => Promise.reject(new Error(secret)), () => new Promise(() => {})]) {
    const h = harness({ sink }); await h.run(); assert.deepEqual(h.counts(), { sent: 1, saves: 1, failures: 0 });
  }
  await new Promise(resolve => setImmediate(resolve));
});
test('L05 only allowlisted fields survive hostile content and secret-like allowed fields', () => {
  const raw = { schema: DIAGNOSTIC_SCHEMA, event: 'provider.finished', message: secret, stack: secret, body: secret, headers: { authorization: secret },
    candidate: good, ownerToken: secret, input, errorName: secret, transportCode: secret, providerStatus: secret,
    model: 'gemini-secret', jobId, validationCodes: ['main_shape', secret], totalTokens: secret, httpStatus: 200 };
  const safe = sanitizeDiagnosticRecord(raw, ['gemini-secret', jobId, secret]);
  assert.deepEqual(safe, { schema: DIAGNOSTIC_SCHEMA, event: 'provider.finished', validationCodes: ['main_shape'], httpStatus: 200 });
  assert.equal(diagnosticError({ get name() { throw new Error(secret); } }).transport, 'unknown');
  assert.equal(sanitizeDiagnosticRecord({ get schema() { throw new Error(secret); } }), null);
});
test('L06 children share 64-line limit, each record bounded; disabled logger is quiet', () => {
  const lines = [], root = createDiagnosticLogger({ requestId }, { sink: line => lines.push(line) });
  const child = root.child({ jobId });
  for (let i = 0; i < 200; i++) (i % 2 ? child : root).emit('provider.finished', { model: 'gemini-' + 'a'.repeat(64), message: secret.repeat(10000) });
  assert.equal(lines.length, 64); assert.equal(JSON.parse(lines.at(-1)).event, 'diagnostic.limit');
  assert.ok(lines.every(line => Buffer.byteLength(line) <= 2048));
  createDiagnosticLogger({}, { enabled: false, sink: () => assert.fail('disabled') }).emit('worker.started');
});
test('L06 concurrent jobs keep their own correlation and stale worker sends nothing', async () => {
  const secondId = '33333333-3333-4333-8333-333333333333';
  const a = harness(), b = harness({ id: secondId }), denied = harness({ store: { beginAttempt: async () => ({ sendAuthorized: false }) } });
  await Promise.all([a.run(), b.run(), denied.run()]);
  assert.ok(a.records().every(r => r.jobId === jobId)); assert.ok(b.records().every(r => r.jobId === secondId));
  assert.equal(denied.counts().sent, 0); assert.ok(denied.records().some(r => r.event === 'attempt.blocked'));
});
test('L06 collector filters IDs, sanitizes twice and drops oversized/raw/split input', async () => {
  const record = JSON.stringify({ schema: DIAGNOSTIC_SCHEMA, event: 'worker.started', requestId, jobId, message: secret });
  assert.equal(extractDiagnostic(secret), null);
  assert.equal(extractDiagnostic(record, { jobId: requestId }), null);
  assert.equal(extractDiagnostic('x'.repeat(16385) + record), null);
  const chunks = [secret + '\n[Info] ' + record.slice(0,30), record.slice(30) + '\n', 'x'.repeat(9000), 'x'.repeat(9000), record + '\n', record];
  const lines = [];
  await collectDiagnostics(Readable.from(chunks), { write: line => lines.push(line) }, { jobId });
  assert.equal(lines.length, 2); assert.equal(lines.join('').includes(secret), false);
  assert.ok(lines.every(line => JSON.parse(line).jobId === jobId));
});
