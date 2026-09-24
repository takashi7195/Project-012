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

export function normalizeRacerName(name) {
  return String(name ?? "").replace(/[\s\u3000]+/g, "");
}

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
      racerName: normalizeRacerName(boat.name),
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

const METRIC_DEFINITIONS = [
  { name: "averageST", label: "平均ST", field: "averageST" },
  { name: "exhibitionST", label: "展示ST", field: "exhibitionST" },
  { name: "exhibitionTime", label: "展示タイム", field: "exhibitionTime" },
];

const STYLE_RULES = [
  ["unsupported_ability", /機動力/],
  ["unsupported_performance", /(?:旋回後の伸び|伸び|出足|回り足|ターン力|旋回力|加速力|行き足|レース足)(?:が|を|で|の|に|は)/],
  ["abstract_attack", /(?:展開|流れ|隙)を突(?:く|き|いて|いた|ける)/],
  ["abstract_formation", /隊列が変化/],
  ["readout_start", /スタートに向か(?:う|い|って|った)/],
  ["readout_mark", /1マークへ向か(?:う|い|って|った)/],
  ["readout_back", /バックストレッチへ向か(?:う|い|って|った)/],
  ["abstract_distance", /各艇の距離感/],
  ["numeric_preface", /数値を踏まえ(?:て|た)?/],
];

function detectStyleViolations(text) {
  return STYLE_RULES.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
}

function styleRetryInstruction(ruleIds) {
  const guidance = {
    unsupported_ability: "平均STはスタートの先行条件としてだけ扱い、別の能力や性質を表す言葉へ置き換えない。",
    unsupported_performance: "入力JSONに対応する項目がない艇の性能名や状態を補完・推測しない。根拠があるスタート条件、進入、艇同士の連争いだけを具体的に書く。",
    abstract_attack: "抽象的な動詞や曖昧な隙の説明を使わず、内側が競る・先行できる等の条件、対象艇、差し・まくり差し・連争いを具体的な一文で結び付ける。再生成指示の語句自体は本文に引用しない。",
    abstract_formation: "隊列の説明ではなく、1マーク後に誰と誰が2・3着争いをするかを書く。",
    readout_start: "データの読み上げを避け、コースを根拠に先マイや差しなどの条件付き展開を書く。",
    readout_mark: "1マークへ向かう説明をせず、誰が主導権を握る条件かを書く。",
    readout_back: "バックへ向かう説明をせず、バックで誰が追走・連争いする条件かを書く。",
    abstract_distance: "距離の抽象説明をせず、具体的な艇同士の2・3着争いを書く。",
    numeric_preface: "数値を踏まえてという前置きを使わず、数値とスタート条件を直接結び付ける。",
  };
  return ruleIds.map((id) => guidance[id]).filter(Boolean).join("\n");
}

function retryInstruction(reason, charCount, styleRules) {
  if (reason === "too_long") {
    return `前回の出力は${charCount}文字で上限650文字を超えました。内容の重複、一般論、コース番号の重複説明、全艇の数値列挙を削り、重要な根拠と条件は残してください。3段落構成を維持し、第1〜3段落を各150〜180文字程度、全体500〜550文字を目標に書き直してください。600文字以内を強く目指し、650文字を絶対に超えないでください。文章を途中で切らず、入力JSONだけを根拠にしてください。`;
  }
  return styleRetryInstruction(styleRules);
}

function detectMetricMismatches(text, racerMentions) {
  const mismatches = [];
  const sentences = String(text).split(/[。！？\n]/).filter(Boolean);
  for (const sentence of sentences) {
    for (const mention of racerMentions) {
      const boat = Number(mention?.boat);
      const name = normalizeRacerName(mention?.name);
      if (!Number.isInteger(boat) || !name) continue;
      const label = `${boat}号艇\\s+${escapeRegExp(name)}`;
      for (const metric of METRIC_DEFINITIONS) {
        const allowed = Number(mention[metric.field]);
        if (!Number.isFinite(allowed)) continue;
        const direct = new RegExp(`${label}(?:(?![1-6]号艇)[^。！？\\n]){0,40}?${metric.label}(?:は|:|：)?\\s*([0-9]+(?:\\.[0-9]+)?)`);
        const inverse = new RegExp(`${metric.label}(?:は|:|：)?\\s*${label}(?:(?![1-6]号艇)[^。！？\\n]){0,25}?(?:は|が|:|：)?\\s*([0-9]+(?:\\.[0-9]+)?)`);
        for (const pattern of [direct, inverse]) {
          const match = sentence.match(pattern);
          if (!match) continue;
          const actual = Number(match[1]);
          if (!Number.isFinite(actual) || Math.abs(actual - allowed) > 1e-9) {
            mismatches.push({ metric: metric.name, boat });
          }
        }
      }
    }
  }
  return mismatches;
}

export function validateNarrative(value, allowedFactorIds, maxChars = NARRATIVE_CONFIG.maxChars, minChars = NARRATIVE_CONFIG.minChars, racerMentions = []) {
  if (!value || typeof value !== "object") return { ok: false, reason: "shape", charCount: 0, paragraphCount: 0, invalidFactorIdCount: 0 };
  const rawText = typeof value.text === "string" ? value.text : "";
  const normalized = rawText.replace(/\r\n?/g, "\n").trim();
  const paragraphs = normalized ? normalized.split(/\n+/).map((paragraph) => paragraph.trim()) : [];
  const text = paragraphs.join("\n\n");
  const contentLength = paragraphs.join("").length;
  const cited = Array.isArray(value.citedFactorIds) ? value.citedFactorIds : null;
  const invalidFactorIdCount = cited
    ? cited.filter((id) => typeof id !== "string" || !allowedFactorIds.has(id)).length
    : 1;
  const diagnostics = { charCount: contentLength, paragraphCount: paragraphs.length, invalidFactorIdCount };
  if (!text) return { ok: false, reason: "shape", ...diagnostics };
  if (paragraphs.length !== 3) return { ok: false, reason: "paragraph_count", ...diagnostics };
  if (paragraphs.some((paragraph) => !paragraph)) return { ok: false, reason: "empty_paragraph", ...diagnostics };
  if (contentLength < minChars) return { ok: false, reason: "too_short", ...diagnostics };
  if (contentLength > maxChars) return { ok: false, reason: "too_long", ...diagnostics };
  if (!cited || invalidFactorIdCount > 0) return { ok: false, reason: "invalid_factor_id", ...diagnostics };
  const metricMismatches = detectMetricMismatches(text, racerMentions);
  if (metricMismatches.length) return { ok: false, reason: "metric_mismatch", ...diagnostics, metricMismatchCount: metricMismatches.length, metricMismatches };
  const styleViolationRules = detectStyleViolations(text);
  if (styleViolationRules.length) return { ok: false, reason: "style_violation", ...diagnostics, styleViolationCount: styleViolationRules.length, styleViolationRules };
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
    const name = normalizeRacerName(mention.name);
    const required = `${Number(mention.boat)}号艇 ${name}`;
    const spacedName = name.split("").join(String.raw`[\s\u3000]*`);
    const anyLabeledName = new RegExp(`${Number(mention.boat)}(?:号艇)?\\s+${spacedName}`);
    for (let split = 1; split < name.length; split += 1) {
      const spacedVariant = `${escapeRegExp(name.slice(0, split))}[\\s\\u3000]+${escapeRegExp(name.slice(split))}`;
      if (new RegExp(`${Number(mention.boat)}(?:号艇)?\\s+${spacedVariant}`).test(text)) {
        return { ok: false, reason: "invalid_racer_format", ...diagnostics };
      }
    }
    if (anyLabeledName.test(text) && !text.includes(required)) {
      return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    }
    if (!text.includes(name)) continue;
    if (!text.includes(required)) return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    const bare = new RegExp(`(?:^|[^0-9])${Number(mention.boat)}\\s+${escapeRegExp(name)}`);
    if (bare.test(text)) return { ok: false, reason: "invalid_racer_format", ...diagnostics };
    if (new RegExp(`${spacedName}(?:選手|さん)`).test(text)) return { ok: false, reason: "invalid_racer_format", ...diagnostics };
  }
  return { ok: true, text, citedFactorIds: cited, ...diagnostics };
}

export async function generateNarrative(input, apiKey, fetchImpl = fetch, options = {}, onDiagnostic = () => {}) {
  const config = { ...NARRATIVE_CONFIG, ...options };
  if (!apiKey) { report(onDiagnostic, "config_missing", { stage: "config" }); return { result: null, errorCode: "config_missing", config }; }
  const allowedFactorIds = new Set((input.boats ?? []).flatMap((boat) => (boat.keyFactors ?? []).map((factor) => factor.id)));
  const racerMentions = (input.boats ?? []).map((boat) => ({ boat: boat.boat, name: boat.racerName, averageST: boat.averageST, exhibitionST: boat.exhibitionST, exhibitionTime: boat.exhibitionTime }));
  const baseTask = [
    "次の構造化JSONだけを根拠に、競艇専門紙のような展開ストーリーを日本語で作成してください。原則3段落、各段落は時間の流れに沿ってください。",
    "第1段落はスタートから1マーク、第2段落は1マーク後からバックと2・3着争い、第3段落は本線展開と波乱条件を説明してください。",
    "目標は500〜550文字、450〜650文字以内です。文字数合わせの冗長な水増しはしないでください。",
    "選手に言及するときは必ず「号艇＋半角スペース＋空白を除去した入力racerNameのフルネーム」で表記し、敬称や苗字への省略をしないでください。選手名を推測・創作しないでください。",
    "選手の表記例は「1号艇 山田太郎」です。数字だけの艇番表記、姓名間の空白、苗字だけの省略は使わないでください。",
    "3連単の具体的な買い目（例: 1-2-3、1号艇-2号艇-3号艇）や配当の列挙はしないでください。本線・対抗・穴が浮上する条件を文章で説明してください。",
    "平均ST・展示ST・展示タイム・モーターScore・course・rank・totalScore等は、入力にある数値と項目名の範囲だけを説明してください。averageSTは必ず「平均ST」、exhibitionSTは必ず「展示ST」、exhibitionTimeは必ず「展示タイム」と対応づけ、別の指標名へ置き換えないでください。同じ艇の同じフィールドにある数値だけをそのまま転記し、別の艇の数値を流用しないでください。不確かな数値は書かずに省略してください。平均STを機動力・旋回力・安定感・攻撃力・得意戦法へ言い換えないでください。",
    "入力にない「コース適性」や選手固有の能力を作らないでください。「進入コース有利」「進入コース有利の利」のような評価語は使わず、「1コースから先マイを狙う形」のようにcourseの事実だけを簡潔に書いてください。",
    "未来の展開は必ず条件付きで書いてください。「先マイできれば」「スタートで先行すれば」「差し場が生まれれば」「余地がある」などを使い、結果を確定した「後続を突き放す」「激しく競り合う」「激しくなるだろう」「鋭く切り込む」「果敢に攻め込む」「虎視眈々」「先手必勝」「プレッシャーをかける」などの表現は使わないでください。",
    "「優位に立つ」「追随する」「先頭で駆け抜ける」などの断定も避け、必ず「〜なら」「〜場合は」「〜可能性がある」「〜余地がある」と条件付きで書いてください。",
    "入力にない戦法を選手の得意戦法として断定しないでください。差し・まくり・まくり差し・センターから攻める等の一般的な展開表現は、コースと条件を示す場合に限り使用できます。複数の艇番や選手名を買い目のように列挙せず、各艇が浮上する条件を文章で説明してください。未来の動きを断定せず、必ず「〜なら」「〜場合は」「〜可能性がある」「〜余地がある」などの条件付きで書いてください。第1段落は誰が1マークの主導権を握るか、第2段落は1マーク後に具体的に誰と誰が2・3着争いをするか、第3段落は本線と本命が崩れる条件を具体的に書いてください。データの読み上げや抽象的な一般論、曖昧な動詞を避け、内側が競れば差し場が生まれる、先攻めできれば連争いへ加わる、外枠が仕掛けに乗れば浮上する、のように「何が起きたら、どの艇が、どう浮上するか」を書いてください。入力にない能力・性能・状態（機動力、旋回力、出足、回り足、伸び等）や得意戦法は作らないでください。",
    "本命・対抗・穴、順位、総合点は変更・再計算せず、文章に自然に反映するだけにしてください。",
    "JSONにない選手の特徴、得意戦法、天候、展開、数値を推測・断定しないでください。除外項目は根拠に使わないでください。",
    `textは目標500〜550文字、必ず450〜${config.maxChars}文字以内の3段落で、段落の区切りには空行を1行入れた改行を使用してください。各段落は目安150〜180文字とし、冗長な数値列挙や同じ内容の言い換えを避けてください。長くなった場合は説明や文を削って短くすることを優先し、必ず620文字以内に収めてください。文字数は段落本文の実質文字数で守ってください。citedFactorIdsは入力にあるfactor idだけを配列で返してください。`,
    "JSON以外の文字を返さないでください。",
    `入力JSON: ${JSON.stringify(input)}`,
  ].join("\n");
  let retryReason = null;
  let retryCharCount = 0;
  let styleRules = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const task = attempt === 1 ? `${baseTask}\n前回の出力を修正するため、以下の指示で一度だけ書き直してください。\n${retryInstruction(retryReason, retryCharCount, styleRules)}` : baseTask;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs));
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: "あなたは競艇専門紙の展開予想を書く補助役です。入力JSONの事実だけを使い、根拠→条件→1マークの主導権→バックの具体的な2・3着争い→本線と崩れる条件の順で、3段落の自然な文章を書いてください。データの単純な読み上げや抽象的な一般論を避け、艇同士の具体的な争いと条件を書いてください。差し・まくり・まくり差し・先マイは条件付きで使えます。平均ST、展示ST、展示タイムの数値と艇番号を絶対に取り違えず、不確かな数値は省略してください。" }] },
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
        const validationDetails = { stage: "validation", elapsedMs: Date.now() - startedAt, charCount: validated.charCount, paragraphCount: validated.paragraphCount, invalidFactorIdCount: validated.invalidFactorIdCount, validationReason: validated.reason, metricMismatchCount: validated.metricMismatchCount ?? 0, metricMismatches: validated.metricMismatches ?? [], styleViolationCount: validated.styleViolationCount ?? 0, styleViolationRules: validated.styleViolationRules ?? [] };
        if ((validated.reason === "style_violation" || validated.reason === "too_long") && attempt === 0) {
          retryReason = validated.reason;
          retryCharCount = validated.charCount ?? 0;
          styleRules = validated.styleViolationRules ?? [];
          continue;
        }
        report(onDiagnostic, errorCode, validationDetails);
        return { result: null, errorCode, config, diagnostics: { charCount: validated.charCount, paragraphCount: validated.paragraphCount, invalidFactorIdCount: validated.invalidFactorIdCount, validationReason: validated.reason, metricMismatchCount: validated.metricMismatchCount ?? 0, metricMismatches: validated.metricMismatches ?? [], styleViolationCount: validated.styleViolationCount ?? 0, styleViolationRules: validated.styleViolationRules ?? [] } };
      }
      report(onDiagnostic, "gemini_narrative_succeeded", { stage: "validated", model: config.model, elapsedMs: Date.now() - startedAt, attempt: attempt + 1 });
      return { result: validated, errorCode: null, config };
    } catch (error) {
      const errorCode = error?.name === "AbortError" ? "gemini_timeout" : "gemini_network_error";
      report(onDiagnostic, errorCode, { stage: "request", model: config.model, elapsedMs: Date.now() - startedAt });
      return { result: null, errorCode, config };
    } finally { clearTimeout(timeout); }
  }
  return { result: null, errorCode: "gemini_narrative_style_violation", config };
}
