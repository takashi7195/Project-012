export function displayResult(data) {
  return { main: data.main ?? null, counter: data.counter ?? null, hole: data.hole ?? null,
    narrative: data.narrativeStatus === "success" && data.narrative ? data.narrative : "レース展開を生成できませんでした" };
}

export class PredictionRequestError extends Error {
  constructor(code, message) { super(message); this.name = "PredictionRequestError"; this.code = code; }
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
