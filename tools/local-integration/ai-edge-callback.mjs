import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

export function callbackState(marker, now = () => performance.now()) {
  const state = { startedAt: null, workerStartedAt: null, timerSetupAt: null, timerRegisteredAt: null,
    timerWakeups: [], timerTicks: [], heartbeats: [], completed: null, shutdown: null };
  return { state, accept(body) {
    if (!body || body.marker !== marker) return 403;
    if (body.event === 'started') {
      if (state.startedAt !== null) return 409;
      state.startedAt = now();
    } else if (body.event === 'worker_started') {
      if (state.startedAt === null || state.workerStartedAt !== null || state.completed || state.shutdown) return 409;
      state.workerStartedAt = now();
    } else if (body.event === 'timer_setup_begin') {
      if (state.workerStartedAt === null || state.timerSetupAt !== null || state.completed || state.shutdown) return 409;
      state.timerSetupAt = now();
    } else if (body.event === 'timer_registered') {
      if (state.timerSetupAt === null || state.timerRegisteredAt !== null || state.completed || state.shutdown) return 409;
      state.timerRegisteredAt = now();
    } else if (body.event === 'timer_wakeup') {
      if (state.timerRegisteredAt === null || state.completed || state.shutdown) return 409;
      if (!Number.isFinite(body.elapsedMs) || body.elapsedMs < 0) return 400;
      state.timerWakeups.push(body.elapsedMs);
    } else if (body.event === 'timer_tick') {
      if (state.timerRegisteredAt === null || state.completed || state.shutdown) return 409;
      if (!Number.isFinite(body.elapsedMs) || body.elapsedMs < 0) return 400;
      const previous = state.timerTicks.at(-1) ?? 0;
      if (body.elapsedMs <= previous) return 409;
      state.timerTicks.push(body.elapsedMs);
    } else if (body.event === 'heartbeat') {
      if (state.timerRegisteredAt === null || state.completed || state.shutdown) return 409;
      if (!Number.isFinite(body.elapsedMs) || body.elapsedMs < 0) return 400;
      if (state.timerTicks.length <= state.heartbeats.length) return 409;
      const previous = state.heartbeats.at(-1) ?? 0;
      if (body.elapsedMs <= previous) return 409;
      state.heartbeats.push(body.elapsedMs);
    } else if (body.event === 'completed') {
      if (state.workerStartedAt === null || state.completed || state.shutdown) return 409;
      if (!Number.isFinite(body.elapsedMs) || body.elapsedMs < 0) return 400;
      state.completed = { elapsedMs: body.elapsedMs, observedMs: now() - state.startedAt };
    } else if (body.event === 'shutdown') {
      if (state.startedAt === null) return 409;
      const known = ['WallClockTime', 'CPUTime', 'Memory', 'EarlyDrop', 'TerminationRequested'];
      state.shutdown = known.includes(body.reason) ? body.reason : 'unknown';
    } else return 400;
    return 204;
  } };
}

export async function startCallbackReceiver(marker) {
  const receiver = callbackState(marker);
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== `/${marker}`) {
      req.resume(); res.writeHead(404).end(); return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) { res.writeHead(413).end(); req.destroy(); return; }
        chunks.push(chunk);
      }
      const status = receiver.accept(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(status).end();
    } catch { if (!res.destroyed) res.writeHead(400).end(); }
  });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  return {
    state: receiver.state,
    url: `http://host.docker.internal:${server.address().port}/${marker}`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
