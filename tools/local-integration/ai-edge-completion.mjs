// Observe completion without making further requests to the Edge worker.
export async function waitForCompletion({ marker, durationMs, capturedLogs, dockerLogs,
  isStopped, progress = () => {}, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const started = now();
  const deadline = started + durationMs + 30_000;
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`AI_WAITUNTIL_SMOKE_COMPLETED:${escaped}:(\\d+)`);
  let nextDocker = started + 15_000;
  let lastDocker = "not_checked";
  while (now() < deadline) {
    if (isStopped()) throw new Error("local Edge process exited before completion");
    let match = capturedLogs().match(pattern);
    if (!match && now() >= nextDocker) {
      try {
        match = dockerLogs().match(pattern);
        lastDocker = "available";
      } catch {
        lastDocker = "unavailable";
      }
      nextDocker = now() + 15_000;
      if (!match) progress(`INFO: background wait ${Math.floor((now() - started) / 1000)}s; Docker logs=${lastDocker}; observing CLI output`);
    }
    if (match) {
      const elapsed = Number(match[1]);
      if (elapsed < durationMs - 5_000 || elapsed > durationMs + 10_000) {
        throw new Error(`unexpected background duration ${elapsed}ms`);
      }
      return elapsed;
    }
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  }
  throw new Error(`completion evidence unavailable before deadline; Docker logs=${lastDocker}; background completion remains unverified`);
}
