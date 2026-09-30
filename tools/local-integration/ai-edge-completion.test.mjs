import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCompletion } from './ai-edge-completion.mjs';

function fixture(overrides = {}) {
  let time = 0;
  let reads = 0;
  const options = {
    marker: 'test-marker', durationMs: 90_000,
    capturedLogs: () => time >= 90_000 ? 'AI_WAITUNTIL_SMOKE_COMPLETED:test-marker:90001' : '',
    dockerLogs: () => { reads++; throw new Error('Docker unavailable'); },
    isStopped: () => false, now: () => time,
    sleep: async (ms) => { time += ms; }, ...overrides,
  };
  return { options, time: () => time, reads: () => reads };
}
test('Docker failure does not interrupt completion observed in CLI output', async () => {
  const f = fixture();
  assert.equal(await waitForCompletion(f.options), 90001);
  assert.equal(f.time(), 90000);
  assert.equal(f.reads(), 5);
});
test('Docker fallback supplies completion when CLI lacks the marker', async () => {
  const f = fixture({ capturedLogs: () => '' });
  f.options.dockerLogs = () => f.time() >= 90000 ? 'AI_WAITUNTIL_SMOKE_COMPLETED:test-marker:90002' : '';
  assert.equal(await waitForCompletion(f.options), 90002);
});
test('missing evidence or another run marker never yields success', async () => {
  const f = fixture({ capturedLogs: () => 'AI_WAITUNTIL_SMOKE_COMPLETED:another-run:90000' });
  await assert.rejects(waitForCompletion(f.options), /remains unverified/);
  assert.equal(f.time(), 120000);
});
test('early worker exit and invalid duration cannot pass', async () => {
  const f = fixture({ isStopped: () => true });
  await assert.rejects(waitForCompletion(f.options), /process exited/);
  const bad = fixture({ capturedLogs: () => 'AI_WAITUNTIL_SMOKE_COMPLETED:test-marker:1000' });
  await assert.rejects(waitForCompletion(bad.options), /unexpected background duration/);
});
