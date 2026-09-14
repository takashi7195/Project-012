import test from "node:test";
import assert from "node:assert/strict";
import { generateGeminiReply, GEMINI_MODEL, isUsableReply, TEMPLATE_REPLIES, templateReply } from "./ai-reply.mjs";

test("ordinary comments use a small Gemini request and accept a short response", async () => {
  let request;
  const reply = await generateGeminiReply("外れたじゃねーか", "test-key", async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ごめん！予想が水しぶきで見えなくなった！" }] } }] }), { status: 200 });
  });

  assert.equal(reply, "ごめん！予想が水しぶきで見えなくなった！");
  assert.match(request.url, new RegExp(GEMINI_MODEL));
  assert.equal(request.init.headers["x-goog-api-key"], "test-key");
  assert.deepEqual(request.body.contents, [{ role: "user", parts: [{ text: "外れたじゃねーか" }] }]);
  assert.equal(request.body.contents[0].parts[0].text.includes("nickname"), false);
  assert.match(request.body.system_instruction.parts[0].text, /通常のAI/u);
  assert.match(request.body.system_instruction.parts[0].text, /ため口/u);
  assert.match(request.body.system_instruction.parts[0].text, /おとぼけキャラ/u);
  assert.doesNotMatch(request.body.system_instruction.parts[0].text, /深刻|危険|禁止|安全|empathetic/u);
  assert.equal(request.body.generationConfig.temperature, 0.9);
});

test("the ten casual fallback replies fit the existing response size limit", () => {
  assert.equal(TEMPLATE_REPLIES.length, 10);
  for (const reply of TEMPLATE_REPLIES) {
    assert.ok(Array.from(reply).length <= 60, reply);
    assert.equal(isUsableReply(reply), true, reply);
  }

  for (let index = 0; index < 100; index += 1) {
    assert.ok(TEMPLATE_REPLIES.includes(templateReply()));
  }
});

test("the helper redacts personal information before sending a comment", async () => {
  let sentText = "";
  await generateGeminiReply("連絡先はtaro@example.comです。", "test-key", async (_url, init) => {
    sentText = JSON.parse(init.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "連絡先は書かないでくださいね。" }] } }] }), { status: 200 });
  });
  assert.equal(sentText, "連絡先は[メールアドレス]です。");
  assert.equal(sentText.includes("taro@example.com"), false);
});

test("all comments use the normal Gemini reply path after personal information redaction", async () => {
  let sentText = "";
  const reply = await generateGeminiReply("家族を亡くしてつらいです。連絡先はtaro@example.com", "test-key", async (_url, init) => {
    sentText = JSON.parse(init.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "そうなんだ。ぼく、今うなずいてた！" }] } }] }), { status: 200 });
  });

  assert.equal(sentText, "家族を亡くしてつらいです。連絡先は[メールアドレス]");
  assert.equal(reply, "そうなんだ。ぼく、今うなずいてた！");
});

test("provider errors and unusable output use the template fallback", async () => {
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => new Response("{}", { status: 429 })), null);
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => new Response("{}", { status: 200 })), null);
  assert.equal(isUsableReply("絶対当たります"), true);
  assert.equal(isUsableReply("それは悔しいですね。"), true);
  assert.equal(isUsableReply("090-1234-5678です"), false);
  assert.equal(isUsableReply("短い返信\nもう一文"), false);
});
