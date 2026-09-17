import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseReply,
  generateGeminiReply,
  GEMINI_MODEL,
  isUsableReply,
  TEMPLATE_REPLIES,
  templateReply,
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
  assert.match(request.body.contents[0].parts[0].text, /外れたじゃねーか/u);
  assert.match(request.body.contents[0].parts[0].text, /コメントへの返信文/u);
  assert.match(request.body.contents[0].parts[0].text, /軽いおねだり/u);
  assert.equal(request.body.system_instruction.parts[0].text, "通常はほろ酔いでぼんやりした、少し呂律のゆるいアホっぽい口調で、ため口でなれなれしく返答してください。競艇に関する内容には非常に詳しく答えてください。疑問形や質問で終わらず、返信の中で内容を完結させてください。");
  assert.equal(request.body.generationConfig.temperature, 0.9);
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.equal(request.body.generationConfig.responseJsonSchema.properties.sentiment.enum.includes("mixed"), true);
  assert.equal(request.body.generationConfig.responseJsonSchema.properties.serious_distress_or_financial_hardship.type, "boolean");
  assert.ok(request.body.generationConfig.maxOutputTokens >= 128);
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
  assert.equal(await generateGeminiReply("確認", "test-key", async () => new Response("{}", { status: 429 }), (value) => { code = value; }), null);
  assert.equal(code, "gemini_http_429");
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
