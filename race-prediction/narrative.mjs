export const NARRATIVE_CONFIG = Object.freeze({
  model: "gemini-3.1-flash-lite",
  promptVersion: "v0.1.15-narrative-2",
  timeoutMs: 15_000,
  maxOutputTokens: 1024,
  maxChars: 650,
  minChars: 450,
});

const report = (onDiagnostic, code, details = {}) => {
  try { onDiagnostic(code, details); } catch { /* diagnostics must not affect prediction */ }
};

export function buildNarrativeInput(race, prediction) {
  const excludedItems = (prediction.components?.excluded ?? []).map((item) => ({ name: item.name, reason: item.reason }));
  const included = new Set((prediction.components?.included ?? []).map((item) => item.name));
  const excluded = new Set(excludedItems.map((item) => item.name));
  const boats = (prediction.boats ?? []).map((boat) => {
    // factorEvidence is produced by scoring and is the canonical, structured
    // source. Keep a component-score fallback for older snapshots.
    const fallback = [
      ["course", "course", "進入コースの採点値を使用"],
      ["motor", "motor", "モーター成績の艇内比較を使用"],
      ["exhibitionTime", "exhibition-time", "展示タイムの艇内比較を使用"],
      ["exhibitionSt", "exhibition-st", "展示STの艇内比較を使用"],
      ["st", "average-st", "平均STの採点値を使用"],
    ];
    const rawFactors = Array.isArray(boat.factorEvidence) && boat.factorEvidence.length
      ? boat.factorEvidence
      : fallback
        .filter(([component]) => boat.componentScores?.[component] !== undefined)
        .map(([component, suffix, text]) => ({ component, id: `boat-${boat.entryNumber}-${suffix}`, text }));
    const factors = rawFactors
      .filter((factor) => factor && typeof factor === "object")
      .filter((factor) => typeof factor.id === "string" && typeof factor.text === "string")
      .filter((factor) => !excluded.has(factor.component))
      .filter((factor) => !included.size || included.has(factor.component))
      .map(({ id, text }) => ({ id, text }));
    const adopted = (name) => !excluded.has(name) && included.has(name) && Number.isFinite(boat.componentScores?.[name]);
    return {
      boat: boat.entryNumber,
      racerName: boat.name,
      rank: boat.rank,
      totalScore: boat.totalScore,
      course: boat.course ?? null,
      exhibitionTime: adopted("exhibitionTime") ? boat.time ?? null : null,
      exhibitionST: adopted("exhibitionSt") && Number(boat.start_timing) >= 0 ? boat.start_timing ?? null : null,
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

export function validateNarrative(value, allowedFactorIds, maxChars = NARRATIVE_CONFIG.maxChars, minChars = NARRATIVE_CONFIG.minChars) {
  if (!value || typeof value !== "object") return { ok: false, reason: "shape" };
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const cited = Array.isArray(value.citedFactorIds) ? value.citedFactorIds : null;
  const paragraphs = text.split("\n");
  if (!text || text.length < minChars || text.length > maxChars || paragraphs.length !== 3 || paragraphs.some((paragraph) => !paragraph.trim()) || !cited || cited.some((id) => typeof id !== "string" || !allowedFactorIds.has(id))) return { ok: false, reason: "validation" };
  if (/https?:\/\//i.test(text) || /\r|\n{2,}/.test(text)) return { ok: false, reason: "unsafe_text" };
  return { ok: true, text, citedFactorIds: cited };
}

export async function generateNarrative(input, apiKey, fetchImpl = fetch, options = {}, onDiagnostic = () => {}) {
  const config = { ...NARRATIVE_CONFIG, ...options };
  if (!apiKey) { report(onDiagnostic, "config_missing", { stage: "config" }); return { result: null, errorCode: "config_missing", config }; }
  const allowedFactorIds = new Set((input.boats ?? []).flatMap((boat) => (boat.keyFactors ?? []).map((factor) => factor.id)));
  const task = [
    "次の構造化JSONだけを根拠に、競艇専門紙のような展開ストーリーを日本語で作成してください。原則3段落、各段落は時間の流れに沿ってください。",
    "第1段落はスタートから1マーク、第2段落は1マーク後からバックと2・3着争い、第3段落は本線展開と波乱条件を説明してください。",
    "目標は500〜550文字、450〜650文字以内です。文字数合わせの冗長な水増しはしないでください。",
    "選手に言及するときは必ず「号艇＋半角スペース＋入力されたracerNameのフルネーム」で表記し、敬称や苗字への省略をしないでください。選手名を推測・創作しないでください。",
    "本命・対抗・穴、順位、総合点は変更・再計算せず、文章に自然に反映するだけにしてください。",
    "JSONにない選手の特徴、得意戦法、天候、展開、数値を推測・断定しないでください。除外項目は根拠に使わないでください。",
    `textは450〜${config.maxChars}文字の3段落（改行は段落間の2つだけ）、citedFactorIdsは入力にあるfactor idだけを配列で返してください。`,
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
    const validated = validateNarrative(parsed, allowedFactorIds, Number(config.maxChars), Number(config.minChars));
    if (!validated.ok) { report(onDiagnostic, `gemini_narrative_${validated.reason}`, { stage: "validation", elapsedMs: Date.now() - startedAt }); return { result: null, errorCode: `gemini_narrative_${validated.reason}`, config }; }
    report(onDiagnostic, "gemini_narrative_succeeded", { stage: "validated", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: validated, errorCode: null, config };
  } catch (error) {
    const errorCode = error?.name === "AbortError" ? "gemini_timeout" : "gemini_network_error";
    report(onDiagnostic, errorCode, { stage: "request", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: null, errorCode, config };
  } finally { clearTimeout(timeout); }
}
