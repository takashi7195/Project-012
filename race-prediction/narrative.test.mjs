import test from "node:test";
import assert from "node:assert/strict";
import { buildNarrativeInput, generateNarrative, validateNarrative, NARRATIVE_CONFIG } from "./narrative.mjs";

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

test("structured narrative input includes only calculated factors and exclusions", () => {
  const input = buildNarrativeInput(race, prediction);
  assert.deepEqual(input.picks.main, [1, 2, 3]);
  assert.equal(input.boats[0].racerName, "山田太郎");
  assert.deepEqual(input.boats[0].keyFactors.map((factor) => factor.id), ["boat-1-course", "boat-1-exhibition-time"]);
  assert.equal(input.excludedItems[0].name, "recent");
  assert.deepEqual(prediction.boats[0].keyFactors, ["進入コース有利"]);
});

test("excluded factors are not forwarded to Gemini and IDs are stable", () => {
  const input = buildNarrativeInput(race, { ...prediction, components: { included: [{ name: "course" }], excluded: [{ name: "motor" }] } });
  assert.deepEqual(input.boats[0].keyFactors, [{ id: "boat-1-course", text: "進入コース有利" }]);
  assert.equal(input.boats[0].keyFactors.some((factor) => factor.id === "boat-1-motor"), false);
});

test("valid narrative accepts only cited factor ids", () => {
  const valid = validateNarrative({ text: paragraphText, citedFactorIds: ["boat-1-course"] }, new Set(["boat-1-course"]));
  assert.equal(valid.ok, true);
  assert.equal(validateNarrative({ text: paragraphText.slice(0, 200), citedFactorIds: ["boat-1-course"] }, new Set(["boat-1-course"])).ok, false);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: ["unknown"] }, new Set(["known"])).ok, false);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: ["boat-1-course", "unknown"] }, new Set(["boat-1-course"])).ok, false);
});

test("narrative validation accepts three paragraphs from 450 to 650 chars only", () => {
  assert.equal(paragraphText.length >= 450 && paragraphText.length <= 650, true);
  assert.equal(validateNarrative({ text: paragraphText, citedFactorIds: [] }, new Set()).ok, true);
  assert.equal(validateNarrative({ text: paragraphText.replace(/\n/, "\n\n"), citedFactorIds: [] }, new Set()).ok, false);
  assert.equal(validateNarrative({ text: `${paragraphText}${'あ'.repeat(250)}`, citedFactorIds: [] }, new Set()).ok, false);
});

test("narrative config and prompt require the long three-paragraph grounded format", async () => {
  assert.equal(NARRATIVE_CONFIG.promptVersion, "v0.1.15-narrative-2");
  assert.equal(NARRATIVE_CONFIG.maxChars, 650);
  assert.equal(NARRATIVE_CONFIG.maxOutputTokens, 1024);
  let requestBody;
  await generateNarrative(buildNarrativeInput(race, prediction), "key", async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText, citedFactorIds: ["boat-1-course"] }) }] } }] });
  });
  const prompt = requestBody.contents[0].parts[0].text;
  assert.match(prompt, /3段落/);
  assert.match(prompt, /450〜650文字/);
  assert.match(prompt, /号艇.*フルネーム/);
});

function response(body, status = 200) { return new Response(JSON.stringify(body), { status }); }

test("Gemini success is parsed without changing picks", async () => {
  const before = JSON.stringify({ main: prediction.main, counter: prediction.counter, hole: prediction.hole, boats: prediction.boats });
  const result = await generateNarrative(buildNarrativeInput(race, prediction), "test-key", async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: paragraphText, citedFactorIds: ["boat-1-course"] }) }] } }] }));
  assert.equal(result.errorCode, null);
  assert.equal(result.result.text, paragraphText);
  assert.deepEqual(prediction.main, [1, 2, 3]);
  assert.equal(JSON.stringify({ main: prediction.main, counter: prediction.counter, hole: prediction.hole, boats: prediction.boats }), before);
});

test("quota, timeout, MAX_TOKENS and invalid citation fail without a narrative", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({}, 429))).errorCode, "gemini_http_429");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => { throw Object.assign(new Error("timeout"), { name: "AbortError" }); })).errorCode, "gemini_timeout");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ finishReason: "MAX_TOKENS" }] }))).errorCode, "gemini_max_tokens");
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "key", async () => response({ candidates: [{ content: { parts: [{ text: '{"text":"x","citedFactorIds":["nope"]}' }] } }] }))).errorCode, "gemini_narrative_validation");
});

test("missing API key is configurable failure", async () => {
  assert.equal((await generateNarrative(buildNarrativeInput(race, prediction), "")).errorCode, "config_missing");
});
