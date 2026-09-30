import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackState, startCallbackReceiver } from './ai-edge-callback.mjs';

test('callback records same-run worker and host elapsed time', () => {
  let time = 0;
  const r = callbackState('test-run', () => time);
  assert.equal(r.accept({ marker: 'test-run', event: 'started' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'worker_started' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_setup_begin' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_registered' }), 204);
  time = 90015;
  assert.equal(r.accept({ marker: 'test-run', event: 'completed', elapsedMs: 90001 }), 204);
  assert.deepEqual(r.state.completed, { elapsedMs: 90001, observedMs: 90015 });
});
test('wrong run, completion before start, duplicates and invalid elapsed are rejected', () => {
  const r = callbackState('test-run');
  assert.equal(r.accept({ marker: 'wrong', event: 'started' }), 403);
  assert.equal(r.accept({ marker: 'test-run', event: 'completed', elapsedMs: 90000 }), 409);
  assert.equal(r.accept({ marker: 'test-run', event: 'started' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'started' }), 409);
  assert.equal(r.accept({ marker: 'test-run', event: 'worker_started' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_setup_begin' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_registered' }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'worker_started' }), 409);
  assert.equal(r.accept({ marker: 'test-run', event: 'completed', elapsedMs: '90000' }), 400);
  assert.equal(r.state.completed, null);
});
test('shutdown is recorded with an allowlisted reason and prevents later success', () => {
  const r = callbackState('test-run');
  r.accept({ marker: 'test-run', event: 'started' });
  r.accept({ marker: 'test-run', event: 'shutdown', reason: 'private-value' });
  assert.equal(r.state.shutdown, 'unknown');
  assert.equal(r.accept({ marker: 'test-run', event: 'completed', elapsedMs: 90000 }), 409);
});
test('heartbeat progress is strictly increasing and visible without raw logs', () => {
  const r = callbackState('test-run');
  r.accept({ marker: 'test-run', event: 'started' });
  r.accept({ marker: 'test-run', event: 'worker_started' });
  r.accept({ marker: 'test-run', event: 'timer_setup_begin' });
  r.accept({ marker: 'test-run', event: 'timer_registered' });
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_wakeup', elapsedMs: 900 }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_tick', elapsedMs: 1000 }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'timer_tick', elapsedMs: 1000 }), 409);
  assert.equal(r.accept({ marker: 'test-run', event: 'heartbeat', elapsedMs: 15000 }), 204);
  assert.equal(r.accept({ marker: 'test-run', event: 'heartbeat', elapsedMs: 15000 }), 409);
  assert.equal(r.accept({ marker: 'test-run', event: 'heartbeat', elapsedMs: 12000 }), 409);
  assert.equal(r.state.heartbeats.at(-1), 15000);
});
test('HTTP receiver accepts local callback and rejects malformed data and wrong route', async () => {
  const r = await startCallbackReceiver('test-run');
  const url = r.url.replace('host.docker.internal', '127.0.0.1');
  try {
    const send = (body, target = url) => fetch(target, { method: 'POST', body });
    assert.equal((await send('{')).status, 400);
    assert.equal((await send('{}', url + '-wrong')).status, 404);
    assert.equal((await send(JSON.stringify({ marker: 'test-run', event: 'started' }))).status, 204);
    assert.notEqual(r.state.startedAt, null);
    assert.equal((await send(JSON.stringify({ marker: 'test-run', event: 'worker_started' }))).status, 204);
    assert.equal((await send(JSON.stringify({ marker: 'test-run', event: 'timer_setup_begin' }))).status, 204);
    assert.equal((await send(JSON.stringify({ marker: 'test-run', event: 'timer_registered' }))).status, 204);
    assert.equal((await send(JSON.stringify({ marker: 'test-run', event: 'completed', elapsedMs: 90000 }))).status, 204);
    assert.equal(r.state.completed.elapsedMs, 90000);
  } finally { await r.close(); }
});
