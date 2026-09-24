export const NARRATIVE_CONFIG = Object.freeze({
  model: "gemini-3.1-flash-lite",
  promptVersion: "v0.1.16-narrative-3",
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

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function validateNarrative(value, allowedFactorIds, maxChars = NARRATIVE_CONFIG.maxChars, minChars = NARRATIVE_CONFIG.minChars, racerMentions = []) {
  if (!value || typeof value !== "object") return { ok: false, reason: "shape", charCount: 0, paragraphCount: 0, invalidFactorIdCount: 0 };
  const rawText = typeof value.text === "string" ? value.text : "";
  const normalized = rawText.replace(/\r\n?/g, "\n").trim();
  const paragraphs = normalized ? normalized.split(/\n+/).map((paragraph) => paragraph.trim()) : [];
  const text = paragraphs.join("\n");
  const cited = Array.isArray(value.citedFactorIds) ? value.citedFactorIds : null;
  const invalidFactorIdCount = cited
    ? cited.filter((id) => typeof id !== "string" || !allowedFactorIds.has(id)).length
    : 1;
  const diagnostics = { charCount: text.length, paragraphCount: paragraphs.length, invalidFactorIdCount };
  if (!text) return { ok: false, reason: "shape", ...diagnostics };
  if (paragraphs.length !== 3) return { ok: false, reason: "paragraph_count", ...diagnostics };
  if (paragraphs.some((paragraph) => !paragraph)) return { ok: false, reason: "empty_paragraph", ...diagnostics };
  if (text.length < minChars) return { ok: false, reason: "too_short", ...diagnostics };
  if (text.length > maxChars) return { ok: false, reason: "too_long", ...diagnostics };
  if (!cited || invalidFactorIdCount > 0) return { ok: false, reason: "invalid_factor_id", ...diagnostics };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: "unsafe_url", ...diagnostics };
  // Narrative text is not a betting slip. Keep concrete trifecta combinations
  // in the structured picks/UI only.
  if (/\b[1-6](?:号艇)?\s*[-－−]\s*[1-6](?:号艇)?\s*[-－−]\s*[1-6](?:号艇)?\b/.test(text)) {
    return { ok: false, reason: "bet_combination", ...diagnostics };
  }
  // Whenever a racer is mentioned, require the stable, unambiguous boat label
  // supplied by the input. This catches bare forms such as "1 山田太郎".
  for (const mention of racerMentions) {
    if (!mention || !Number.isInteger(Number(mention.boat)) || typeof mention.name !== "string" || !mention.name) continue;
    const name = mention.name.trim();
    if (!text.includes(name)) continue;
    const required = `${Number(mention.boat)}号艇 ${name}`;
    if (!text.includes(required)) return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    const bare = new RegExp(`(?:^|[^0-9])${Number(mention.boat)}\\s+${escapeRegExp(name)}`);
    if (bare.test(text)) return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    const surname = name.split(/\s+/)[0];
    if (surname && surname !== name && text.includes(surname) && !text.includes(required)) {
      return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    }
  }
  return { ok: true, text, citedFactorIds: cited, ...diagnostics };
}

export async function generateNarrative(input, apiKey, fetchImpl = fetch, options = {}, onDiagnostic = () => {}) {
  const config = { ...NARRATIVE_CONFIG, ...options };
  if (!apiKey) { report(onDiagnostic, "config_missing", { stage: "config" }); return { result: null, errorCode: "config_missing", config }; }
  const allowedFactorIds = new Set((input.boats ?? []).flatMap((boat) => (boat.keyFactors ?? []).map((factor) => factor.id)));
  const racerMentions = (input.boats ?? []).map((boat) => ({ boat: boat.boat, name: boat.racerName }));
  const task = [
    "次の構造化JSONだけを根拠に、競艇専門紙のような展開ストーリーを日本語で作成してください。原則3段落、各段落は時間の流れに沿ってください。",
    "第1段落はスタートから1マーク、第2段落は1マーク後からバックと2・3着争い、第3段落は本線展開と波乱条件を説明してください。",
    "目標は500〜550文字、450〜650文字以内です。文字数合わせの冗長な水増しはしないでください。",
    "選手に言及するときは必ず「号艇＋半角スペース＋入力されたracerNameのフルネーム」で表記し、敬称や苗字への省略をしないでください。選手名を推測・創作しないでください。",
    "選手の表記例は「1号艇 山田太郎」です。数字だけの艇番表記や苗字だけの省略は使わないでください。",
    "3連単の具体的な買い目（例: 1-2-3、1号艇-2号艇-3号艇）や配当の列挙はしないでください。本線・対抗・穴が浮上する条件を文章で説明してください。",
    "本命・対抗・穴、順位、総合点は変更・再計算せず、文章に自然に反映するだけにしてください。",
    "JSONにない選手の特徴、得意戦法、天候、展開、数値を推測・断定しないでください。除外項目は根拠に使わないでください。",
    `textは450〜${config.maxChars}文字の3段落で、段落の区切りには改行を使用してください。citedFactorIdsは入力にあるfactor idだけを配列で返してください。`,
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
    const validated = validateNarrative(parsed, allowedFactorIds, Number(config.maxChars), Number(config.minChars), racerMentions);
    if (!validated.ok) {
      const errorCode = `gemini_narrative_${validated.reason}`;
      report(onDiagnostic, errorCode, { stage: "validation", elapsedMs: Date.now() - startedAt, charCount: validated.charCount, paragraphCount: validated.paragraphCount, invalidFactorIdCount: validated.invalidFactorIdCount, validationReason: validated.reason });
      return { result: null, errorCode, config, diagnostics: { charCount: validated.charCount, paragraphCount: validated.paragraphCount, invalidFactorIdCount: validated.invalidFactorIdCount, validationReason: validated.reason } };
    }
    report(onDiagnostic, "gemini_narrative_succeeded", { stage: "validated", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: validated, errorCode: null, config };
  } catch (error) {
    const errorCode = error?.name === "AbortError" ? "gemini_timeout" : "gemini_network_error";
    report(onDiagnostic, errorCode, { stage: "request", model: config.model, elapsedMs: Date.now() - startedAt });
    return { result: null, errorCode, config };
  } finally { clearTimeout(timeout); }
}
