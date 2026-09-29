export const AI_CONTRACT_VERSION = "ai-bundle-v1";
export const OUTPUT_SCHEMA_VERSION = "ai-bundle-output-v1";
export const DEFAULT_AI_CONFIG = Object.freeze({
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  apiVersion: "v1beta",
  promptVersion: "ai-bundle-prompt-1",
  styleVersion: "none-1",
  styleText: "",
  outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
  adapterVersion: "gemini-generate-content-v1",
  totalTimeoutMs: 90_000,
  maxAttempts: 2,
  saveReserveMs: 5_000,
  maxOutputTokens: 8192,
  thinkingLevel: "MEDIUM",
});

export function resolveAiConfig(env) {
  const number = (key, fallback) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`invalid_${key.toLowerCase()}`);
    return value;
  };
  const config = {
    ...DEFAULT_AI_CONFIG,
    provider: env.RACE_AI_PROVIDER ?? DEFAULT_AI_CONFIG.provider,
    model: env.RACE_AI_MODEL ?? DEFAULT_AI_CONFIG.model,
    promptVersion: env.RACE_AI_PROMPT_VERSION ?? DEFAULT_AI_CONFIG.promptVersion,
    styleVersion: env.RACE_AI_STYLE_VERSION ?? DEFAULT_AI_CONFIG.styleVersion,
    styleText: env.RACE_AI_STYLE_TEXT ?? DEFAULT_AI_CONFIG.styleText,
    totalTimeoutMs: number("RACE_AI_TOTAL_TIMEOUT_MS", DEFAULT_AI_CONFIG.totalTimeoutMs),
    maxAttempts: number("RACE_AI_MAX_ATTEMPTS", DEFAULT_AI_CONFIG.maxAttempts),
    saveReserveMs: number("RACE_AI_SAVE_RESERVE_MS", DEFAULT_AI_CONFIG.saveReserveMs),
    maxOutputTokens: number("RACE_AI_MAX_OUTPUT_TOKENS", DEFAULT_AI_CONFIG.maxOutputTokens),
    thinkingLevel: env.RACE_AI_THINKING_LEVEL ?? DEFAULT_AI_CONFIG.thinkingLevel,
  };
  if (config.provider !== "gemini" || !config.model || config.totalTimeoutMs < 1 || config.totalTimeoutMs > 90_000 ||
      config.maxAttempts !== 2 || config.saveReserveMs < 1000 || config.saveReserveMs >= config.totalTimeoutMs ||
      !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || !["LOW", "MEDIUM", "HIGH"].includes(config.thinkingLevel)) {
    throw new Error("invalid_ai_config");
  }
  return config;
}

export async function hashAiConfig(config, promptText) {
  const { sha256 } = await import("./ai-input.mjs");
  return sha256({ ...config, promptTextHash: await sha256(promptText) });
}
