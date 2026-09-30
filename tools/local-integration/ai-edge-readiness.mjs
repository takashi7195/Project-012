// Readiness probes never start a background task. A running gateway may return
// 502/503 while the CLI is still creating the Edge Runtime container.
export async function waitForLocalFunction({
  endpoint, isRunnerStopped, diagnostics, onProgress = () => {},
  timeoutMs = 60_000, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetchImpl = fetch,
}) {
  const started = now();
  const deadline = started + timeoutMs;
  let nextProgress = started + 15_000;
  let lastStatus = "no_response";
  while (now() < deadline) {
    if (isRunnerStopped()) throw new Error(`local function runner stopped during startup; ${diagnostics()}`);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - now()))),
      });
    } catch {
      lastStatus = "connection_error";
    }
    if (response) {
      lastStatus = response.status;
      await response.body?.cancel();
      if (lastStatus === 204 && now() < deadline) {
        if (isRunnerStopped()) throw new Error(`local function runner stopped during startup; ${diagnostics()}`);
        return;
      }
      if (![204, 404, 502, 503].includes(lastStatus)) {
        throw new Error(`test function readiness returned ${lastStatus}; ${diagnostics()}`);
      }
    }
    if (now() >= nextProgress && now() < deadline) {
      onProgress(`INFO: waiting for local Edge startup (${Math.floor((now() - started) / 1000)}s, last=${lastStatus}); no task POST sent`);
      nextProgress = now() + 15_000;
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(500, remaining));
  }
  throw new Error(`local Edge startup timed out after ${timeoutMs}ms; last=${lastStatus}; no task POST sent; ${diagnostics()}`);
}
