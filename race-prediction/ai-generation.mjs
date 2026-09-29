import { createDiagnosticLogger, emitDiagnostic, diagnosticError } from "./ai-diagnostics.mjs";
import { buildPrompt } from "./ai-prompt.mjs";
import { validateAiOutput } from "./ai-output.mjs";
import { buildGeminiPayload, generateGemini } from "./providers/gemini.mjs";

export async function runAiGeneration({ job, config, apiKey, store, fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), diagnostics }) {
  const logger = diagnostics ?? createDiagnosticLogger({ requestId: crypto.randomUUID(), jobId: job.id, model: config.model }, { secrets: [apiKey, job.ownerToken] });
  const log = (event, fields = {}) => emitDiagnostic(logger, event, fields);
  let stage = "worker";
  const startedAt = now();
  log("worker.started");
  try {
    const expiresAt = Math.min(Date.parse(job.expiresAt), startedAt + config.totalTimeoutMs);
    let lastError = "generation_failed";
    let lastRetryable = true;
    for (let sequence = 1; sequence <= config.maxAttempts; sequence++) {
      const remainingMs = expiresAt - now();
      if (remainingMs <= config.saveReserveMs) { log("retry.stopped", { reason: "deadline", remainingMs }); break; }
      stage = "begin_attempt";
      let begun;
      const beginStartedAt = now();
      try {
        begun = await store.beginAttempt(job.id, job.ownerToken, sequence);
      } catch (error) {
        // The RPC may have committed before its response was lost. Since the
        // worker never received send authorization, it must not call the provider.
        log("attempt.authorization_unknown", { attempt: sequence, ...diagnosticError(error) });
        try {
          await store.finishAttempt({ jobId: job.id, ownerToken: job.ownerToken, sequence,
            errorCode: "attempt_authorization_unknown", validationCodes: ["attempt_authorization_unknown"],
            retryable: true, unknown: true, durationMs: now() - beginStartedAt, requestPayload: null });
        } catch (finishError) {
          log("attempt.unknown_record_failed", { attempt: sequence, ...diagnosticError(finishError) });
        }
        try {
          await store.failPrediction(job.id, job.ownerToken, "attempt_authorization_unknown", true);
        } catch (failError) {
          log("attempt.unknown_job_close_failed", { attempt: sequence, ...diagnosticError(failError) });
        }
        return;
      }
      if (!begun?.sendAuthorized) { log("attempt.blocked", { attempt: sequence, reason: "not_authorized" }); return; }
      log("attempt.started", { attempt: sequence, remainingMs });
      const requestPrompt = buildPrompt(job.inputBundle, config.styleText, sequence === 1 ? null : job.repair);
      const attemptStartedAt = now();
      const requestPayload = { model: config.model, apiVersion: config.apiVersion,
        body: buildGeminiPayload({ prompt: requestPrompt, input: job.inputBundle, settings: config }) };
      const attemptBudgetMs = expiresAt - attemptStartedAt - config.saveReserveMs;
      if (attemptBudgetMs <= 0) {
        log("retry.stopped", { attempt: sequence, reason: "deadline" });
        stage = "finish_attempt";
        await store.finishAttempt({ jobId: job.id, ownerToken: job.ownerToken, sequence, errorCode: "deadline_expired",
          validationCodes: ["deadline_expired"], retryable: false, durationMs: 0, requestPayload: null });
        lastError = "deadline_expired";
        break;
      }
      const promptHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestPrompt)).then((bytes) => [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join(""));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptBudgetMs);
      stage = "provider";
      let response;
      try { response = await generateGemini({ model: config.model, prompt: requestPrompt, input: job.inputBundle, apiVersion: config.apiVersion, apiKey, settings: config, signal: controller.signal, fetchImpl }); }
      finally { clearTimeout(timer); }
      log("provider.finished", { attempt: sequence, promptHash, ...response.diagnostics, ok: response.ok, errorCode: response.errorCode,
        retryable: response.retryable, incomplete: response.incomplete, retryAfterMs: response.retryAfterMs,
        durationMs: now() - attemptStartedAt, inputTokens: response.usage?.promptTokenCount,
        outputTokens: response.usage?.candidatesTokenCount, totalTokens: response.usage?.totalTokenCount });
      if (now() >= expiresAt || controller.signal.aborted) {
        log("retry.stopped", { attempt: sequence, reason: "deadline" });
        stage = "finish_attempt";
        await store.finishAttempt({ jobId: job.id, ownerToken: job.ownerToken, sequence,
          errorCode: "deadline_expired", validationCodes: ["deadline_expired"], unknown: true,
          durationMs: now() - attemptStartedAt, promptHash, requestPayload, requestHash: await hash(requestPayload) });
        lastError = "deadline_expired";
        break;
      }
      stage = "validation";
      const validation = response.ok ? validateAiOutput(response.candidate) : { valid: false, errors: [response.errorCode ?? "provider_error"] };
      log("output.validated", { attempt: sequence, ok: validation.valid && !response.incomplete,
        validationCodes: [...(validation.errors ?? []), ...(response.incomplete ? ["provider_incomplete_response"] : [])] });
      if (validation.valid && !response.incomplete) {
        stage = "save";
        log("save.started", { attempt: sequence });
        const saved = await store.finishPrediction({
          job, ownerToken: job.ownerToken, sequence, output: validation.value,
          model: config.model, provider: config.provider, providerModelVersion: response.modelVersion,
          usage: response.usage, requestPrompt, promptHash, durationMs: now() - attemptStartedAt,
          requestPayload, requestHash: await hash(requestPayload),
        });
        log("save.finished", { attempt: sequence, saved: saved?.saved === true, reason: saved?.saved ? "saved" : "save_refused" });
        if (saved?.saved) return;
        return;
      }
      const validationCodes = [...(validation.errors ?? []), ...(response.incomplete ? ["provider_incomplete_response"] : [])];
      lastError = response.dailyLimit ? "provider_daily_limit" : response.errorCode || validationCodes.join(",") || "output_invalid";
      lastRetryable = response.retryable === true;
      stage = "finish_attempt";
      const failed = await store.finishAttempt({ jobId: job.id, ownerToken: job.ownerToken, sequence,
        errorCode: lastError, validationCodes, retryable: response.retryable, usage: response.usage,
        httpStatus: response.httpStatus, unknown: response.errorCode === "provider_network_error" || response.errorCode === "provider_empty_response",
        durationMs: now() - attemptStartedAt, promptHash, requestHash: await hash(requestPayload),
        candidate: response.candidate ?? null, requestPayload });
      if (!failed?.recorded || !response.retryable || sequence === config.maxAttempts) {
        log("retry.stopped", { attempt: sequence, recorded: failed?.recorded === true,
          reason: !failed?.recorded ? "unrecorded" : !response.retryable ? "not_retryable" : "attempt_limit" });
        break;
      }
      const waitMs = response.retryAfterMs ?? 1000;
      if (now() + waitMs + config.saveReserveMs >= expiresAt) { log("retry.stopped", { reason: "insufficient_time", retryAfterMs: waitMs }); break; }
      stage = "retry";
      log("retry.scheduled", { attempt: sequence, reason: "retry", retryAfterMs: waitMs });
      await sleep(waitMs);
      job.repair = response.ok ? { errors: validationCodes, candidate: response.candidate } : null;
    }
    stage = "fail_job";
    await store.failPrediction(job.id, job.ownerToken, lastError, lastRetryable);
  } catch (error) {
    log("worker.failed", { stage, ...diagnosticError(error) });
    throw error;
  } finally {
    log("worker.finished", { stage, durationMs: now() - startedAt });
  }
}

async function hash(value) {
  const data = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const result = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
