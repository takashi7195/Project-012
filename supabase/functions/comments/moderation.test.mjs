import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { moderationDecision, normalizeComment, normalizeNickname, redactPersonalInfo } from "./moderation.mjs";

const require = createRequire(import.meta.url);
require("../../../comment-safety.js");
const clientSafety = globalThis.ProjectCommentSafety;

test("redacts contact details and keeps their categories visible", () => {
  assert.equal(redactPersonalInfo("電話は090-1234-3245です。"), "電話は[電話番号]です。");
  assert.equal(redactPersonalInfo("連絡先はtaro@example.comです。"), "連絡先は[メールアドレス]です。");
  assert.equal(redactPersonalInfo("東京都杉並区○○町1-2-3から応援しています。"), "[住所]から応援しています。");
  assert.equal(redactPersonalInfo("LINE IDはsample123です。"), "LINE IDは[SNSアカウント]です。");
  assert.equal(redactPersonalInfo("@boatfan_12 にDMしてね"), "[SNSアカウント] にDMしてね");
});

test("browser redaction matches the server before transmitting form values", () => {
  const examples = [
    "電話は090-1234-3245です。",
    "連絡先はtaro@example.comです。",
    "東京都杉並区○○町1-2-3から応援しています。",
    "LINE IDはsample123です。",
    "@boatfan_12 にDMしてね",
  ];
  for (const value of examples) {
    assert.equal(clientSafety.redactPersonalInfo(value), redactPersonalInfo(value));
  }
});

test("does not block strong words without a concrete threat or solicitation", () => {
  assert.equal(moderationDecision("死ぬほどドキドキするレースでした。"), "allow");
  assert.equal(moderationDecision("殺す気で応援したい！"), "allow");
  assert.equal(moderationDecision("この予想は絶対当たると思う。"), "allow");
  assert.equal(moderationDecision("有料予想には気をつけよう。"), "allow");
});

test("blocks explicit threats and payment/contact solicitations", () => {
  assert.equal(moderationDecision("お前を殺す"), "block");
  assert.equal(moderationDecision("自殺しろ"), "block");
  assert.equal(moderationDecision("死ね！"), "block");
  assert.equal(moderationDecision("舟券予想を有料販売中。LINEで連絡ください"), "block");
  assert.equal(moderationDecision("口座に振り込んでください"), "block");
});

test("checks redacted length and nickname privacy", () => {
  assert.equal(normalizeComment("  090-1234-3245  "), "[電話番号]");
  assert.equal(normalizeComment("　"), null);
  assert.equal(normalizeComment("あ".repeat(301)), null);
  assert.equal(normalizeNickname("taro@example.com"), "[メールアドレス]");
});
