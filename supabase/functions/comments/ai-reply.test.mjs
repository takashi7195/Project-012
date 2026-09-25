import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseReply,
  generateGeminiReply,
  GEMINI_MODEL,
  isUsableReply,
  TEMPLATE_REPLIES,
  templateReply,
  GEMINI_TIMEOUT_MS,
  generateGroundedReply,
} from "./ai-reply.mjs";

const regularReply = "ごめん！予想が水しぶきで見えなくなった！";
const tipReply = "当たった！あれ、ぼくのおなかが鳴ったかも！";

function candidates(overrides = {}) {
  return {
    sentiment: "positive",
    seriousDistressOrFinancialHardship: false,
    regularReply,
    tipReply,
    ...overrides,
  };
}

function geminiResponse(payload) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }), { status: 200 });
}

test("one Gemini request returns classification and both short reply candidates", async () => {
  let request;
  const replyCandidates = await generateGeminiReply("外れたじゃねーか", "test-key", async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return geminiResponse({
      sentiment: "negative",
      serious_distress_or_financial_hardship: false,
      regular_reply: regularReply,
      tip_reply: tipReply,
    });
  });

  assert.deepEqual(replyCandidates, candidates({ sentiment: "negative" }));
  assert.match(request.url, new RegExp(GEMINI_MODEL));
  assert.equal(request.init.headers["x-goog-api-key"], "test-key");
  assert.equal(request.body.contents.length, 1);
  assert.equal(request.body.tools, undefined);
  assert.match(request.body.contents[0].parts[0].text, /外れたじゃねーか/u);
  assert.match(request.body.contents[0].parts[0].text, /コメントへの返信文/u);
  assert.match(request.body.contents[0].parts[0].text, /軽いおねだり/u);
  assert.equal(request.body.system_instruction.parts[0].text, "酔っ払いでぼんやりした、少し呂律のゆるいアホっぽい口調で、ため口でなれなれしく返答してください。競艇に関する内容には、専門的かつ正確に回答してください。不確かな情報は断定しないでください。疑問形や質問で終わらず、返信の中で内容を完結させてください。");
  assert.equal(request.body.generationConfig.temperature, 0.9);
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.equal(request.body.generationConfig.responseJsonSchema.properties.sentiment.enum.includes("mixed"), true);
  assert.equal(request.body.generationConfig.responseJsonSchema.properties.serious_distress_or_financial_hardship.type, "boolean");
  assert.equal(request.body.generationConfig.maxOutputTokens, 512);
  assert.equal(GEMINI_TIMEOUT_MS, 15_000);
});

test("positive comments request a tip for 30 percent of server-side random draws", () => {
  assert.deepEqual(chooseReply(candidates(), () => 0.299999), { reply: tipReply, tipRequested: true });
  assert.deepEqual(chooseReply(candidates(), () => 0.3), { reply: regularReply, tipRequested: false });
});

test("negative comments do not request a tip", () => {
  assert.deepEqual(chooseReply(candidates({ sentiment: "negative" }), () => 0), { reply: regularReply, tipRequested: false });
});

test("neutral, mixed, uncertain, and serious hardship comments never request a tip", () => {
  for (const sentiment of ["neutral", "mixed", "uncertain"]) {
    assert.deepEqual(chooseReply(candidates({ sentiment }), () => 0), { reply: regularReply, tipRequested: false });
  }
  for (const sentiment of ["positive", "negative"]) {
    assert.deepEqual(chooseReply(candidates({ sentiment, seriousDistressOrFinancialHardship: true }), () => 0), {
      reply: regularReply,
      tipRequested: false,
    });
  }
});

test("invalid generated tip text, random draw, or candidates fail closed to an ordinary reply", () => {
  assert.deepEqual(chooseReply(candidates({ seriousDistressOrFinancialHardship: "false" }), () => 0), {
    reply: regularReply,
    tipRequested: false,
  });
  assert.deepEqual(chooseReply(candidates(), () => Number.NaN), { reply: regularReply, tipRequested: false });
  assert.equal(chooseReply({}), null);
});

test("a tip reply can hint indirectly without saying chip", async () => {
  const result = await generateGeminiReply("ありがとう！", "test-key", async () => geminiResponse({
    sentiment: "positive",
    serious_distress_or_financial_hardship: false,
    regular_reply: regularReply,
    tip_reply: "ありがとう！あれ、ぼくのおやつが見つからないな？",
  }));

  assert.equal(result.tipReply, "ありがとう！あれ、ぼくのおやつが見つからないな？");
  assert.deepEqual(chooseReply(result, () => 0), { reply: result.tipReply, tipRequested: true });
});

test("the existing ten casual fallback replies remain available", () => {
  assert.equal(TEMPLATE_REPLIES.length, 10);
  for (const reply of TEMPLATE_REPLIES) {
    assert.equal(isUsableReply(reply), true, reply);
  }
  for (let index = 0; index < 100; index += 1) assert.ok(TEMPLATE_REPLIES.includes(templateReply()));
});

test("only the redacted comment is sent to Gemini", async () => {
  let sentText = "";
  const result = await generateGeminiReply("連絡先はtaro@example.comです。", "test-key", async (_url, init) => {
    const request = JSON.parse(init.body);
    sentText = request.contents[0].parts[0].text;
    return geminiResponse({
      sentiment: "neutral",
      serious_distress_or_financial_hardship: false,
      regular_reply: "連絡先は書かないでね！ぼくも気をつける！",
      tip_reply: tipReply,
    });
  });

  assert.match(sentText, /連絡先は\[メールアドレス\]です/u);
  assert.equal(sentText.includes("taro@example.com"), false);
  assert.equal(result.sentiment, "neutral");
});

test("invalid structured output, provider errors, and unusable replies return null", async () => {
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => new Response("{}", { status: 429 })), null);
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => geminiResponse({ sentiment: "happy" })), null);
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => geminiResponse({
    sentiment: "positive",
    serious_distress_or_financial_hardship: false,
    regular_reply: "090-1234-5678です",
    tip_reply: tipReply,
  })), null);
  assert.equal(isUsableReply("短い返信\nもう一文"), true);
});

test("diagnostics classify Gemini quota, token, and timeout failures", async () => {
  let code;
  let details;
  assert.equal(await generateGeminiReply("確認", "test-key", async () => new Response("{}", { status: 429 }), (value, info) => { code = value; details = info; }), null);
  assert.equal(code, "gemini_http_429");
  assert.equal(details.stage, "http");
  assert.equal(typeof details.elapsedMs, "number");
  code = undefined;
  assert.equal(await generateGeminiReply("確認", "test-key", async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "MAX_TOKENS" }],
  }), { status: 200 }), (value) => { code = value; }), null);
  assert.equal(code, "gemini_max_tokens");
  code = undefined;
  const abort = new DOMException("aborted", "AbortError");
  assert.equal(await generateGeminiReply("確認", "test-key", async () => { throw abort; }, (value) => { code = value; }), null);
  assert.equal(code, "gemini_timeout");
});

test("grounded Gemini diagnostics retain safe HTTP status and stage", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const diagnostics = [];
    const result = await generateGroundedReply("結果を教えて", { action: "race_db", queries: [] }, { races: [] }, "test-key", async () => new Response("{}", { status }), (_code, details) => diagnostics.push(details));
    assert.equal(result, null);
    assert.equal(diagnostics.at(-1).stage, "grounded_http");
    assert.equal(diagnostics.at(-1).status, status);
  }
});

test("diagnostics distinguish provider JSON, response shape, and schema failures", async () => {
  const diagnostics = [];
  const run = async (response) => generateGeminiReply("確認", "test-key", async () => response, (code, details) => diagnostics.push({ code, details }));
  await run(new Response("not-json", { status: 200 }));
  await run(new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }), { status: 200 }));
  await run(geminiResponse({ sentiment: "unknown", serious_distress_or_financial_hardship: false }));
  assert.deepEqual(diagnostics.map((item) => item.code), ["gemini_invalid_response_json", "gemini_response_shape_invalid", "gemini_invalid_json"]);
  assert.equal(diagnostics[0].details.stage, "response_json");
  assert.equal(diagnostics[1].details.stage, "response_shape");
  assert.equal(diagnostics[2].details.stage, "schema_validation");
});

test("search-disabled responses still use the existing JSON contract", async () => {
  const result = await generateGeminiReply("今日の多摩川8Rの結果は？", "test-key", async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.tools, undefined);
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({
          sentiment: "neutral",
          serious_distress_or_financial_hardship: false,
          regular_reply: "検索してみたけど、結果はまだ確認できないみたいだよ。",
          tip_reply: tipReply,
        }) }] },
        groundingMetadata: { webSearchQueries: ["今日 多摩川 8R 結果"] },
      }],
    }), { status: 200 });
  });
  assert.equal(result.sentiment, "neutral");
  assert.equal(result.regularReply, "検索してみたけど、結果はまだ確認できないみたいだよ。");
});

test("grounded reply uses facts without exposing database internals", async () => {
  let prompt = "";
  const result = await generateGroundedReply("今日の住之江12Rの展示は？", { action: "race_db", prediction_requested: false }, {
    races: [{ race_date: "2026-09-24", stadium_name: "住之江", race_number: 12, entries: [{ entry_number: 1, name: "選手", average_st: 0.14 }] }],
    coverage: { truncated: false }, warnings: [],
  }, "test-key", async (_url, init) => { prompt = JSON.parse(init.body).contents[0].parts[0].text; return geminiResponse({ sentiment: "neutral", serious_distress_or_financial_hardship: false, regular_reply: "1号艇の平均STは0.14だよ〜。", tip_reply: tipReply }); }, () => {}, { status: "available", main: [1, 2, 3], counter: [2, 1, 4], hole: [5, 1, 2] });
  assert.equal(result.regularReply, "1号艇の平均STは0.14だよ〜。");
  assert.match(prompt, /raceContext/u);
  assert.match(prompt, /DB、RPC、SQL/u);
  assert.match(prompt, /predictionContext/u);
});

test("grounded no-match response remains a normal reply", async () => {
  const result = await generateGroundedReply("明日の住之江12Rどう？", { action: "race_db" }, { races: [], coverage: { truncated: false }, warnings: ["no_match"] }, "test-key", async () => geminiResponse({ sentiment: "neutral", serious_distress_or_financial_hardship: false, regular_reply: "まだ確認できる材料がないわ〜。", tip_reply: null }));
  assert.equal(result.regularReply, "まだ確認できる材料がないわ〜。");
});
