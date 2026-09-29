import { diagnosticError, providerDiagnostics } from "../ai-diagnostics.mjs";
import { RESPONSE_SCHEMA } from "../ai-prompt.mjs";

export function buildGeminiPayload({ prompt, input, settings }) {
  return {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ identity: input.identity, facts: input.facts,
      sourceCode: input.provenance.sourceCode, fetchedAt: input.provenance.fetchedAt }) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: settings.maxOutputTokens,
      thinkingConfig: { thinkingLevel: settings.thinkingLevel },
    },
  };
}

export async function generateGemini({ model, prompt, input, apiVersion = "v1beta", apiKey, settings, signal, fetchImpl = fetch }) {
  if (!apiKey) return { ok: false, retryable: false, errorCode: "provider_not_configured" };
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiPayload({ prompt, input, settings })),
    });
  } catch (error) {
    return { ok: false, retryable: true, errorCode: "provider_network_error", diagnostics: diagnosticError(error, signal) };
  }
  const retryHeader = response.headers.get("retry-after");
  let retryAfter = null;
  if (retryHeader?.trim()) {
    const value = retryHeader.trim();
    const milliseconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(milliseconds)) retryAfter = Math.max(0, milliseconds);
  }
  let body;
  let responseFormat = "json";
  let bodyDiagnostics = {};
  try { body = await response.json(); } catch (error) {
    body = null;
    responseFormat = error instanceof SyntaxError ? "json_invalid" : "body_error";
    bodyDiagnostics = diagnosticError(error, signal);
  }
  const diagnostics = { ...await providerDiagnostics(response, body, responseFormat), ...bodyDiagnostics };
  if (!response.ok) {
    const status = response.status;
    const dailyLimit = status === 429 && /daily|per[_ ]day|requests?[_ ]per[_ ]day|requestsperday|perday/i.test(JSON.stringify(body?.error ?? ""));
    return { ok: false, retryable: [408, 429, 500, 502, 503, 504].includes(status) && !dailyLimit, dailyLimit, retryAfterMs: retryAfter,
      errorCode: status === 401 || status === 403 ? "provider_auth_error" : status === 429 ? "provider_rate_limited" : `provider_http_${status}`, httpStatus: status, diagnostics };
  }
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((part) => typeof part?.text === "string" ? part.text : "").join("") : "";
  const finishReason = candidate?.finishReason ?? null;
  return {
    ok: Boolean(text),
    diagnostics,
    retryable: true,
    errorCode: text ? null : "provider_empty_response",
    incomplete: finishReason !== "STOP",
    candidate: text,
    usage: body?.usageMetadata ?? null,
    providerRequestId: response.headers.get("x-request-id"),
    modelVersion: candidate?.modelVersion ?? null,
  };
}
