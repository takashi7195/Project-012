import test from "node:test";
import assert from "node:assert/strict";
import { buildNarrativeInput, generateNarrative, validateNarrative, normalizeRacerName, NARRATIVE_CONFIG } from "./narrative.mjs";

const prediction = {
  status: "partial", main: [1, 2, 3], counter: [2, 1, 4], hole: [4, 1, 2], scoreAsOf: "2026-09-21T00:00:00Z",
  components: { maximum: 66, included: [{ name: "course" }, { name: "exhibitionTime" }], excluded: [{ name: "recent", reason: "not configured" }] },
  boats: [{ entryNumber: 1, name: "山田太郎", rank: 1, totalScore: 80.2, course: 1, time: 6.7, start_timing: 0.08, average_st: 0.14, componentScores: { course: 18, exhibitionTime: 6.6 }, keyFactors: ["進入コース有利"], factorEvidence: [{ id: "boat-1-course", component: "course", text: "進入コース有利" }, { id: "boat-1-exhibition-time", component: "exhibitionTime", text: "展示タイム良好" }], weakFactors: [] }],
};
const race = { race_date: "2026-09-21", stadium_code: 5, race_number: 1 };
const paragraphText = [
  "スタートでは1号艇 山田太郎がインの進入を生かして先マイを狙う。3号艇 鈴木一郎はセンターから攻める余地があり、2号艇 佐藤健一は差し構えで続く形を中心に見る。展示の数値と進入コースを踏まえると、1マークまでの主導権争いが最初のポイントになりそうだ。",
  "1マーク後は1号艇 山田太郎が先行できれば隊形を作り、3号艇 鈴木一郎の攻めに連動して2号艇 佐藤健一が差し残る展開が本線になる。5号艇と6号艇は展開待ち。センター勢の仕掛けが届くかどうかでバックの位置関係が変わり、2着と3着の争いは内側の差し残りを中心に見る。",
  "本線は1号艇 山田太郎が押し切る形。3号艇 鈴木一郎がスタートで先行できればまくり差しから浮上し、2号艇 佐藤健一までの接戦になる展開を警戒したい。4号艇は攻めの連動が条件となり、5号艇と6号艇は前が競り合う場合に展開を拾う余地がある。各艇の評価と採用された根拠を踏まえ、無理な断定は避けて本線から波乱までを整理する。進入と直前情報の範囲で、変化する隊形を丁寧に見極めたい。十分に確認する。"
].join("\n");
const canonicalParagraphText = paragraphText.replace(/\n/g, "\n\n");

test("structured narrative input includes only calculated factors and exclusions", () => {
  const input = buildNarrativeInput(race, prediction);
  assert.deepEqual(input.picks.main, [1, 2, 3]);
  assert.equal(input.boats[0].racerName, "山田太郎");
  assert.deepEqual(input.boats[0].keyFactors.map((factor) => factor.id), ["boat-1-course", "boat-1-exhibition-time"]);
  assert.equal(input.excludedItems[0].name, "recent");
  assert.deepEqual(prediction.boats[0].keyFactors, ["進入コース有利"]);
});

test("racer display names remove half/full-width spaces before narrative input", () => {
  assert.equal(normalizeRacerName("菊池 峰晴"), "菊池峰晴");
  assert.equal(normalizeRacerName("菊池　峰晴"), "菊池峰晴");
  const input = buildNarrativeInput(race, { ...prediction, boats: [{ ...prediction.boats[0], name: "菊池　峰晴" }] });
  assert.equal(input.boats[0].racerName, "菊池峰晴");
});

test("excluded factors are not forwarded to Gemini and IDs are stable", () => {
  const input = buildNarrativeInput(race, { ...prediction, components: { included: [{ name: "course" }], excluded: [{ name: "motor" }] } });
  assert.deepEqual(input.boats[0].keyFactors, [{ id: "boat-1-course", text: "進入コース有利" }]);
  assert.equal(input.boats[0].keyFactors.some((factor) => factor.id === "boat-1-motor"), false);
});

test("valid narrative accepts only cited factor ids", () => {
  const valid = validateNarrative({ text: paragraphText, citedFactorIds: ["boat-1-course"] }, new Set(["boat-1-course"]));
  assert.equal(valid.ok, true);
  assert.equal(valid.text, canonicalParagraphText);
  assert.equal(validateNarrative({ text: paragraphText.slice(0, 200), citedFactorIds: ["boat-1-course"] }, new Set(["boat-1-course"])).ok, false);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: ["unknown"] }, new Set(["known"])).ok, false);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: ["boat-1-course", "unknown"] }, new Set(["boat-1-course"])).ok, false);
});

test("narrative validation accepts three paragraphs from 450 to 650 chars only", () => {
  assert.equal(paragraphText.length >= 450 && paragraphText.length <= 650, true);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: [] }, new Set()).ok, true);
  const blankLine = validateNarrative({ text: paragraphText.replace(/\n/g, "\n\n"), citedFactorIds: [] }, new Set());
  assert.equal(blankLine.ok, true);
  assert.equal(blankLine.text, canonicalParagraphText);
  assert.equal(validateNarrative({ text: `${paragraphText}${'あ'.repeat(250)}`, citedFactorIds: [] }, new Set()).ok, false);
});

test("narrative line endings normalize to three stable paragraphs", () => {
  const crlf = validateNarrative({ text: `\r\n${paragraphText.replace(/\n/g, "\r\n")}\r\n`, citedFactorIds: [] }, new Set());
  assert.equal(crlf.ok, true);
  assert.equal(crlf.text, canonicalParagraphText);
  assert.equal(validateNarrative({ text: paragraphText.split("\n").slice(0, 2).join("\n"), citedFactorIds: [] }, new Set()).reason, "paragraph_count");
  assert.equal(validateNarrative({ text: `${paragraphText}\n第4段落`, citedFactorIds: [] }, new Set()).reason, "paragraph_count");
  assert.equal(validateNarrative({ text: "x\n\ny", citedFactorIds: [] }, new Set(), 650, 1).reason, "paragraph_count");
  assert.equal(validateNarrative({ text: "a\nb\nc", citedFactorIds: [] }, new Set()).reason, "too_short");
  assert.equal(validateNarrative({ text: `${paragraphText}${"あ".repeat(250)}`, citedFactorIds: [] }).reason, "too_long");
  assert.equal(validateNarrative({ text: paragraphText.replace("スタートでは", "https://example.com では"), citedFactorIds: [] }).reason, "unsafe_url");
});

test("narrative config and prompt require the long three-paragraph grounded format", async () => {
  assert.equal(NARRATIVE_CONFIG.promptVersion, "v0.1.16-narrative-3");
  assert.equal(NARRATIVE_CONFIG.maxChars, 650);
  assert.equal(NARRATIVE_CONFIG.maxOutputTokens, 1024);
  let requestBody;
  await generateNarrative(buildNarrativeInput(race, prediction), "key", async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText, citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  const prompt = requestBody.contents[0].parts[0].text;
  assert.match(requestBody.system_instruction.parts[0].text, /競艇専門紙/);
  assert.match(requestBody.system_instruction.parts[0].text, /具体的な2・3着争い/);
  assert.match(prompt, /3段落/);
  assert.match(prompt, /450〜650文字/);
  assert.match(prompt, /号艇.*フルネーム/);
  assert.match(prompt, /具体的な買い目/);
  assert.match(prompt, /1号艇/);
  assert.match(prompt, /機動力・旋回力・安定感/);
  assert.match(prompt, /未来の展開は必ず条件付き/);
  assert.match(prompt, /コース適性/);
  assert.match(prompt, /進入コース有利/);
  assert.match(prompt, /激しくなるだろう/);
  assert.match(prompt, /まくり差し/);
  assert.match(prompt, /買い目のように列挙/);
  assert.match(prompt, /入力にない能力/);
  assert.match(prompt, /必ず620文字以内/);
  assert.match(prompt, /各段落は目安150〜180文字/);
  assert.match(prompt, /一般的な展開表現/);
  assert.match(prompt, /別の艇の数値を流用しない/);
  assert.match(prompt, /具体的に誰と誰が2・3着争い/);
  assert.match(prompt, /誰が1マークの主導権を握るか/);
  assert.match(prompt, /2・3着争い/);
  assert.match(prompt, /データの読み上げ/);
  assert.match(prompt, /曖昧な動詞/);
});

test("narrative rejects trifecta listings and bare racer labels", () => {
  const mentions = [{ boat: 1, name: "山田太郎" }];
  assert.equal(validateNarrative({ text: paragraphText.replace("1号艇 山田太郎", "1-2-3"), citedFactorIds: [] }, new Set(), 650, 1, mentions).reason, "bet_combination");
  assert.equal(validateNarrative({ text: paragraphText.replace("1号艇 山田太郎", "1 山田太郎"), citedFactorIds: [] }, new Set(), 650, 1, mentions).reason, "invalid_racer_format");
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: [] }, new Set(), 650, 450, mentions).ok, true);
  assert.equal(validateNarrative({ text: paragraphText.replace("1号艇 山田太郎", "1号艇 山田 太郎"), citedFactorIds: [] }, new Set(), 650, 1, mentions).reason, "invalid_racer_format");
  assert.equal(validateNarrative({ text: paragraphText.replace("1号艇 山田太郎", "1号艇 山田太郎選手"), citedFactorIds: [] }, new Set(), 650, 1, mentions).reason, "invalid_racer_format");
});

test("metric labels accept only the matching boat values", () => {
  const mentions = [{ boat: 1, name: "山田太郎", averageST: 0.14, exhibitionST: 0.08, exhibitionTime: 6.7 }];
  const valid = paragraphText.replace("1号艇 山田太郎がインの進入を生かして", "1号艇 山田太郎は平均ST0.14、展示ST0.08、展示タイム6.7でインの進入を生かして");
  assert.equal(validateNarrative({ text: valid, citedFactorIds: [] }, new Set(), 650, 1, mentions).ok, true);
  const wrongAverage = paragraphText.replace("1号艇 山田太郎がインの進入を生かして", "1号艇 山田太郎は平均ST0.08でインの進入を生かして");
  const invalid = validateNarrative({ text: wrongAverage, citedFactorIds: [] }, new Set(), 650, 1, mentions);
  assert.equal(invalid.reason, "metric_mismatch");
  assert.equal(invalid.metricMismatchCount, 1);
  assert.equal(invalid.metricMismatches[0].metric, "averageST");
  assert.equal(invalid.metricMismatches[0].boat, 1);
  const noNumbers = paragraphText.replace("1号艇 山田太郎がインの進入を生かして", "1号艇 山田太郎がインの進入を生かして");
  assert.equal(validateNarrative({ text: noNumbers, citedFactorIds: [] }, new Set(), 650, 1, mentions).ok, true);
});

test("style violations are classified with stable rule ids", () => {
  const cases = [
    ["機動力", "unsupported_ability"],
    ["旋回後の伸びが", "unsupported_performance"],
    ["展開を突いて", "abstract_attack"],
    ["隙を突いて", "abstract_attack"],
    ["隊列が変化", "abstract_formation"],
  ];
  for (const [phrase, rule] of cases) {
    const result = validateNarrative({ text: paragraphText.replace("隊形を作り", `${phrase}、隊形を作り`), citedFactorIds: [] }, new Set(), 650, 1);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "style_violation");
    assert.equal(result.styleViolationCount, 1);
    assert.deepEqual(result.styleViolationRules, [rule]);
  }
  const clean = validateNarrative({ text: paragraphText.replace("隊形を作り", "先マイして"), citedFactorIds: [] }, new Set(), 650, 1);
  assert.equal(clean.ok, true);
});

function response(body, status = 200) { return new Response(JSON.stringify(body), { status }); }

test("Gemini success is parsed without changing picks", async () => {
  const before = JSON.stringify({ main: prediction.main, counter: prediction.counter, hole: prediction.hole, boats: prediction.boats });
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText, citedFactorIds: ["boat-1-course"] }) }] } }] }));
  assert.equal(result.errorCode, null);
  assert.equal(result.result.text, canonicalParagraphText);
  assert.deepEqual(prediction.main, [1, 2, 3]);
  assert.equal(JSON.stringify({ main: prediction.main, counter: prediction.counter, hole: prediction.hole, boats: prediction.boats }), before);
});

test("style violation triggers exactly one retry and succeeds", async () => {
  let calls = 0;
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async (_url, request) => {
    calls += 1;
    const task = JSON.parse(request.body).contents[0].parts[0].text;
    const text = calls === 1 ? paragraphText.replace("隊形を作り", "機動力で隊形を作り") : paragraphText.replace("隊形を作り", "先マイして");
    if (calls === 2) assert.match(task, /前回の出力を修正するため/);
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text, citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.errorCode, null);
  assert.equal(result.result.text, canonicalParagraphText.replace("隊形を作り", "先マイして"));
});

test("too-long output triggers one shortening retry and succeeds", async () => {
  let calls = 0;
  const longText = `${paragraphText}${"あ".repeat(200)}`;
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async (_url, request) => {
    calls += 1;
    const task = JSON.parse(request.body).contents[0].parts[0].text;
    if (calls === 2) assert.match(task, /758文字|前回の出力は/);
    const text = calls === 1 ? longText : paragraphText;
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text, citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.errorCode, null);
  assert.equal(result.result.charCount <= 650, true);
});

test("second too-long output fails without truncation or a third call", async () => {
  let calls = 0;
  const longText = `${paragraphText}${"あ".repeat(200)}`;
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async () => {
    calls += 1;
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: longText, citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.errorCode, "gemini_narrative_too_long");
  assert.equal(result.diagnostics.charCount > 650, true);
});

test("second style violation fails and never exceeds two Gemini calls", async () => {
  let calls = 0;
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async () => {
    calls += 1;
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText.replace("隊形を作り", "展開を突く隊形を作り"), citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.errorCode, "gemini_narrative_style_violation");
  assert.equal(result.diagnostics.styleViolationCount, 1);
  assert.deepEqual(result.diagnostics.styleViolationRules, ["abstract_attack"]);
});

test("quota, timeout, MAX_TOKENS and invalid citation fail without a narrative", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({}, 429))).errorCode, "gemini_http_429");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => { throw Object.assign(new Error("timeout"), { name: "AbortError" }); })).errorCode, "gemini_timeout");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ finishReason: "MAX_TOKENS" }] }))).errorCode, "gemini_max_tokens");
  const invalid = await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText, citedFactorIds: ["nope"] }) }] } }] }));
  assert.equal(invalid.errorCode, "gemini_narrative_invalid_factor_id");
});

test("validation diagnostics classify the failure without storing generated text", async () => {
  const diagnostics = [];
  const shortText = "短い本文";
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: shortText, citedFactorIds: ["boat-1-course"] }) }] } }] }), {}, (code, details) => diagnostics.push({ code, details }));
  assert.equal(result.errorCode, "gemini_narrative_paragraph_count");
  assert.deepEqual(result.diagnostics, { charCount: shortText.length, paragraphCount: 1, invalidFactorIdCount: 0, validationReason: "paragraph_count", metricMismatchCount: 0, metricMismatches: [], styleViolationCount: 0, styleViolationRules: [] });
  assert.equal(diagnostics[0].code, "gemini_narrative_paragraph_count");
  assert.equal(diagnostics[0].details.charCount, shortText.length);
  assert.equal(diagnostics[0].details.paragraphCount, 1);
  assert.equal(diagnostics[0].details.invalidFactorIdCount, 0);
  assert.equal(diagnostics[0].details.validationReason, "paragraph_count");
});

test("missing API key is configurable failure", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "")).errorCode, "config_missing");
});
