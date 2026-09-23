export function displayResult(data) {
  return { main: data.main ?? null, counter: data.counter ?? null, hole: data.hole ?? null,
    narrative: data.narrativeStatus === "success" && data.narrative ? data.narrative : "レース展開文を生成できませんでした。" };
}
export async function pollPrediction(send, { signal, onGenerating = () => {}, maxRequests = 5, timeoutMs = 60000, sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new Error("予想取得を中止しました")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
}) } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("予想取得が中断またはタイムアウトしました。再度お試しください。")), { once: true });
  });
  try {
    for (let i = 0; i < maxRequests; i++) {
      if (controller.signal.aborted) throw new Error("予想取得を中止しました");
      const { status, body } = await Promise.race([send(controller.signal), interrupted]);
      if (status === 202 && body.status === "generating") {
        onGenerating();
        if (i + 1 === maxRequests) break;
        const seconds = Number(body.retryAfter);
        await Promise.race([sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 2) * 1000, controller.signal), interrupted]);
        continue;
      }
      if (status !== 200 || !Array.isArray(body.main) || body.main.length !== 3 || ["api_error", "stale", "closed"].includes(body.status)) {
        throw new Error(body.status === "closed" ? "締切済みです" : body.status === "stale" ? "データ更新待ちです" : "予想データを取得できません");
      }
      return displayResult(body);
    }
    throw new Error("生成中です。時間をおいて再度お試しください。");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
