export const NARRATIVE_CONFIG = Object.freeze({
  model: "gemini-3.1-flash-lite",
  promptVersion: "v0.1.14-narrative-1",
  timeoutMs: 15_000,
  maxOutputTokens: 512,
  maxChars: 240,
});

const report = (onDiagnostic, code, details = {}) => {
  try { onDiagnostic(code, details); } catch { /* diagnostics must not affect prediction */ }
};

export function buildNarrativeInput(race, prediction) {
  const excludedItems = (prediction.components?.excluded ?? []).map((item) => ({ name: item.name, reason: item.reason }));
  const boats = (prediction.boats ?? []).map((boat) => {
    const factors = [];
    if (boat.componentScores?.course !== undefined) factors.push({ id: `boat-${boat.entryNumber}-course`, text: "進入コースの採点値を使用" });
    if (boat.componentScores?.motor !== undefined) factors.push({ id: `boat-${boat.entryNumber}-motor`, text: "モーター成績の艇内比較を使用" });
    if (boat.componentScores?.exhibitionTime !== undefined) factors.push({ id: `boat-${boat.entryNumber}-exhibition-time`, text: "展示タイムの艇内比較を使用" });
    if (boat.componentScores?.exhibitionSt !== undefined) factors.push({ id: `boat-${boat.entryNumber}-exhibition-st`, text: "展示STの艇内比較を使用" });
    if (boat.componentScores?.st !== undefined) factors.push({ id: `boat-${boat.entryNumber}-average-st`, text: "平均STの採点値を使用" });
    return {
      boat: boat.entryNumber,
      racerName: boat.name,
      rank: boat.rank,
      totalScore: boat.totalScore,
      course: boat.course ?? null,
      exhibitionTime: boat.time ?? null,
      exhibitionST: boat.start_timing ?? null,
      averageST: boat.average_st ?? null,
      motorScore: boat.componentScores?.motor ?? null,
      keyFactors: factors,
      weakFactors: boat.weakFactors ?? [],
    };
  });
  return {
    race: {
      date: race.race_date ?? null,
      stadiumCode: race.stadium_code ?? null,
      raceNumber: race.race_number ?? null,
      scoreAsOf: prediction.scoreAsOf ?? null,
    },
    picks: { main: prediction.main, counter: prediction.counter, hole: prediction.hole },
    boats,
    excludedItems,
    coverage: { scoreStatus: prediction.status, availableMax: prediction.components?.maximum ?? null },
  };
}

function providerErrorSummary(text) {
  const raw = String(text ?? "").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]").slice(0, 1200);
  try {
    const error = JSON.parse(raw)?.error;
    return { providerStatus: error?.status ?? null, providerMessage: String(error?.message ?? raw).slice(0, 800) };
  } catch { return { providerStatus: null, providerMessage: raw.slice(0, 800) }; }
}

export function validateNarrative(value, allowedFactorIds, maxChars = NARRATIVE_CONFIG.maxChars) {
  if (!value || typeof value !== "object") return { ok: false, reason: "shape" };
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const cited = Array.isArray(value.citedFactorIds) ? value.citedFactorIds : null;
  if (!text || text.length > maxChars || !cited || cited.some((id) => typeof id !== "string" || !allowedFactorIds.has(id))) return { ok: false, reason: "validation" };
  if (/https?:\/\//i.test(text) || /\n/.test(text)) return { ok: false, reason: "unsafe_text" };
  return { ok: true, text, citedFactorIds: cited };
}

export async function generateNarrative(input, apiKey, fetchImpl = fetch, options = {}, onDiagnostic = () => {}) {
  const config = { ...NARRATIVE_CONFIG, ...options };
  if (!apiKey) { report(onDiagnostic, "config_missing", { stage: "config" }); return { result: null, errorCode: "config_missing", config }; }
  const allowedFactorIds = new Set((input.boats ?? []).flatMap((boat) => (boat.keyFactors ?? []).map((factor) => factor.id)));
  const task = [
    "次の構造化JSONだけを根拠に、競艇レースの展開を日本語1行で作成してください。",
    "本命・対抗・穴、順位、総合点は変更・再計算せず、文章に自然に反映するだけにしてください。",
    "JSONにない選手の特徴、得意戦法、天候、展開、数値を推測・断定しないでください。除外項目は根拠に使わないでください。",
    `textは${config.maxChars}文字以内の1行、citedFactorIdsは入力にあるfactor idだけを配列で返してください。`,
    "JSON以外の文字を返さないでください。",
    `入力JSON: ${JSON.stringify(input)}`,
  ].join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs));
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "あなたは競艇の展開文だけを書く補助役です。与えられた事実を越えて断定しません。" }] },
        contents: [{ role: "user", parts: [{ text: task }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: Number(config.maxOutputTokens),
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object", additionalProperties: false,
            properties: { text: { type: "string" }, citedFactorIds: { type: "array", items: { type: "string" } } },
            required: ["text", "citedFactorIds"],
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const provider = providerErrorSummary(await response.text());
      const errorCode = response.status === 429 ? "gemini_http_429" : response.status === 401 || response.status === 403 ? "gemini_http_401_403" : response.status >= 500 ? "gemini_http_5xx" : "gemini_http_error";
      report(onDiagnostic, errorCode, { stage: "http", status: response.status, model: config.model, elapsedMs: Date.now() - startedAt, ...provider });
      return { result: null, errorCode, config };
    }
    const payload = await response.json();
    const candidate = payload?.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;
    if (finishReason === "MAX_TOKENS") { report(onDiagnostic, "gemini_max_tokens", { stage: "finish_reason", elapsedMs: Date.now() - startedAt }); return { result: null, errorCode: "gemini_max_tokens", config }; }
    const generated = candidate?.content?.parts?.map((part) => part?.text ?? "").join("") ?? "";
    let parsed;
    try { parsed = JSON.parse(generated.trim()); } catch { report(onDiagnostic, "gemini_invalid_json", { stage: "response_json", elapsedMs: Date.now() - startedAt }); return { result: null, errorCode: "gemini_invalid_json", config }; }
    const validated = validateNarrative(parsed, allowedFactorIds, Number(config.maxChars));
    if (!validated.ok) { report(onDiagnostic, `gemini_narrative_${validated.reason}`, { stage: "validation", elapsedMs: Date.now() - startedAt }); return { result: null, errorCode: `gemini_narrative_${validated.reason}`, config }; }
    report(onDiagnostic, "gemini_narrative_succeeded", { stage: "validated", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: validated, errorCode: null, config };
  } catch (error) {
    const errorCode = error?.name === "AbortError" ? "gemini_timeout" : "gemini_network_error";
    report(onDiagnostic, errorCode, { stage: "request", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: null, errorCode, config };
  } finally { clearTimeout(timeout); }
}
