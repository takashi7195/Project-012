export function displayResult(data) {
  return { main: data.main ?? null, counter: data.counter ?? null, hole: data.hole ?? null,
    narrative: data.narrativeStatus === "success" && data.narrative ? data.narrative : "レース展開を生成できませんでした" };
}

export class PredictionRequestError extends Error {
  constructor(code, message) { super(message); this.name = "PredictionRequestError"; this.code = code; }
}

export function validateAiBundle(data) {
  const validPicks = (value) => Array.isArray(value) && value.length === 3 && value.every((boat) => Number.isInteger(boat) && boat >= 1 && boat <= 6) && new Set(value).size === 3;
  if (data?.status !== "success" || data?.mode !== "ai_bundle" || data?.contractVersion !== "ai-bundle-v1" ||
      !validPicks(data.main) || !validPicks(data.counter) || !validPicks(data.hole) ||
      new Set([data.main.join(","), data.counter.join(","), data.hole.join(",")]).size !== 3 ||
      typeof data.narrative !== "string" || data.narrative.trim().length === 0) return null;
  return { main: data.main, counter: data.counter, hole: data.hole, narrative: data.narrative };
}

export async function pollAiBundlePrediction(start, read, { signal, timeoutMs = 90_000, now = () => performance.now(), sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new PredictionRequestError("aborted", "予想取得を中止しました")); };
  signal?.addEventListener("abort", abort, { once: true });
}) } = {}) {
  const expiresAt = now() + timeoutMs;
  const request = async (send, absoluteDeadline = expiresAt) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    let rejectInterrupted;
    const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
    const onAbort = () => rejectInterrupted(new PredictionRequestError(signal?.aborted ? "aborted" : "retryable_failure", "予想取得を中止またはタイムアウトしました"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.max(1, absoluteDeadline - now()));
    try {
      const result = await Promise.race([Promise.resolve().then(() => {
        if (signal?.aborted || now() >= absoluteDeadline) { abort(); return; }
        return send(controller.signal);
      }), interrupted]);
      if (signal?.aborted) throw new PredictionRequestError("aborted", "予想取得を中止しました");
      if (controller.signal.aborted || now() >= absoluteDeadline) throw new PredictionRequestError("retryable_failure", "予想取得がタイムアウトしました");
      return result;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", onAbort); }
  };
  return (async () => {
    if (signal?.aborted) throw new PredictionRequestError("aborted", "予想取得を中止しました");
    let response;
    const startSentAt = now();
    try { response = await request(start); }
    catch (error) { throw signal?.aborted ? new PredictionRequestError("aborted", "予想取得を中止しました") : new PredictionRequestError("retryable_failure", "予想を取得できませんでした"); }
    let body = response?.body;
    let jobId = body?.jobId;
    let serverDeadline = expiresAt;
    if (response?.status === 200 && validateAiBundle(body)) return validateAiBundle(body);
    if (response?.status !== 202 || body?.status !== "generating" || body?.mode !== "ai_bundle" || body?.contractVersion !== "ai-bundle-v1" || !jobId) {
      throw new PredictionRequestError(body?.status === "closed" ? "closed" : body?.retryable === false ? "not_retryable" : "retryable_failure", "予想を取得できませんでした");
    }
    serverDeadline = Math.min(serverDeadline, startSentAt + Math.max(0, Number(body.remainingMs) || 0));
    while (!signal?.aborted && now() < serverDeadline) {
      const remainingBeforeRead = serverDeadline - now();
      const retryAfterMs = Math.min(2000, Number(body.retryAfterMs) || 2000, Math.max(0, remainingBeforeRead - 250));
      if (retryAfterMs > 0) await sleep(retryAfterMs, signal);
      if (signal?.aborted || now() >= serverDeadline) break;
      let next;
      const readSentAt = now();
      try { next = await request((innerSignal) => read(jobId, innerSignal), serverDeadline); }
      catch { if (signal?.aborted) throw new PredictionRequestError("aborted", "予想取得を中止しました"); continue; }
      body = next?.body;
      if (next?.status === 200) {
        const result = validateAiBundle(body);
        if (result) return result;
        throw new PredictionRequestError("retryable_failure", "予想を取得できませんでした");
      }
      if (next?.status === 202 && body?.status === "generating" && body?.jobId === jobId && body?.mode === "ai_bundle" && body?.contractVersion === "ai-bundle-v1") {
        serverDeadline = Math.min(serverDeadline, readSentAt + Math.max(0, Number(body.remainingMs) || 0));
        continue;
      }
      throw new PredictionRequestError(body?.retryable === false ? "not_retryable" : "retryable_failure", "予想を取得できませんでした");
    }
    throw new PredictionRequestError("retryable_failure", "予想取得がタイムアウトしました");
  })();
}

export async function pollPrediction(send, { signal, onGenerating = () => {}, maxRequests = 5, timeoutMs = 60000, sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new PredictionRequestError("aborted", "予想取得を中止しました")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
}) } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new PredictionRequestError("aborted", "予想取得を中止しました")), { once: true });
  });
  try {
    for (let i = 0; i < maxRequests; i++) {
      if (controller.signal.aborted) throw new PredictionRequestError("aborted", "予想取得を中止しました");
      const { status, body } = await Promise.race([send(controller.signal), interrupted]);
      if (status === 202 && body.status === "generating") {
        onGenerating();
        if (i + 1 === maxRequests) break;
        const seconds = Number(body.retryAfter);
        await Promise.race([sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 2) * 1000, controller.signal), interrupted]);
        continue;
      }
      if (status !== 200 || !Array.isArray(body.main) || body.main.length !== 3 || ["api_error", "stale", "closed"].includes(body.status)) {
        throw new PredictionRequestError(body.status === "closed" ? "closed" : body.status === "stale" ? "stale" : "api_error", "予想を取得できませんでした");
      }
      return displayResult(body);
    }
    throw new PredictionRequestError("generating_limit", "予想を取得できませんでした");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
