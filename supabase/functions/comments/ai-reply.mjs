import { redactPersonalInfo } from "./moderation.mjs";

export const GEMINI_MODEL = "gemini-3.1-flash-lite";

export const TEMPLATE_REPLIES = [
  "なるほど！ぼくも今うなずいた！",
  "そっかそっか！ぼくの耳がぴくっとした！",
  "えへへ、なんだか分かった気がする！",
  "ふむふむ！ぼくの頭が動きだした！",
  "あれ？今いいこと思いついた気がする！",
  "そうなんだ！ぼくもびっくりした！",
  "ちょっと待って、考える顔をしてる！",
  "うんうん！ぼくもそんな気がしてた！",
  "なるほどね！ぼくのメモ帳どこだっけ？",
  "おっ、なんだか気になってきた！",
];

const SYSTEM_INSTRUCTION = `あなたは通常のAIとして、ユーザーのコメントに自然に返答してください。話し方はため口にしてください。おとぼけキャラとして返答してください。`;

export function templateReply() {
  return TEMPLATE_REPLIES[Math.floor(Math.random() * TEMPLATE_REPLIES.length)];
}

export function isUsableReply(text) {
  const reply = String(text ?? "").trim();
  if (!reply || Array.from(reply).length > 60 || /[\r\n]/u.test(reply)) return false;
  return redactPersonalInfo(reply) === reply;
}

export async function generateGeminiReply(comment, apiKey, fetchImpl = fetch) {
  const safeComment = redactPersonalInfo(String(comment ?? "").trim());
  if (!apiKey || !safeComment || Array.from(safeComment).length > 280) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: safeComment }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 64 },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const result = await response.json();
    const generated = result?.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part?.text === "string" ? part.text : "")
      .join("")
      .trim();
    return isUsableReply(generated) ? generated : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
