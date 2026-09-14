import test from "node:test";
import assert from "node:assert/strict";
import {
  empatheticReply,
  generateGeminiReply,
  GEMINI_MODEL,
  isSafeGeneratedReply,
  isSeriousComment,
} from "./ai-reply.mjs";

test("ordinary comments use a small Gemini request and accept a short response", async () => {
  let request;
  const reply = await generateGeminiReply("外れたじゃねーか", "test-key", async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ごめんなさい、おなかが痛かったです。" }] } }] }), { status: 200 });
  });

  assert.equal(reply, "ごめんなさい、おなかが痛かったです。");
  assert.match(request.url, new RegExp(GEMINI_MODEL));
  assert.equal(request.init.headers["x-goog-api-key"], "test-key");
  assert.deepEqual(request.body.contents, [{ role: "user", parts: [{ text: "外れたじゃねーか" }] }]);
  assert.equal(request.body.contents[0].parts[0].text.includes("nickname"), false);
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

test("serious comments get compassionate canned replies and are not sent to Gemini", async () => {
  let called = false;
  const comment = "家族を亡くしてつらいです";
  const reply = await generateGeminiReply(comment, "test-key", async () => {
    called = true;
    throw new Error("must not call provider");
  });

  assert.equal(isSeriousComment(comment), true);
  assert.equal(reply, null);
  assert.equal(called, false);
  assert.match(empatheticReply(comment), /話して|つら|大変|明るく/u);
});

test("provider errors and unsafe or malformed output use the template fallback", async () => {
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => new Response("{}", { status: 429 })), null);
  assert.equal(await generateGeminiReply("当たりました", "test-key", async () => new Response("{}", { status: 200 })), null);
  assert.equal(isSafeGeneratedReply("絶対当たります"), false);
  assert.equal(isSafeGeneratedReply("090-1234-5678です"), false);
  assert.equal(isSafeGeneratedReply("スタートから目が離せませんね。"), true);
});
