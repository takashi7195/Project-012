import { predictionKeys, deadlineState } from "../../../race-prediction/input-contract.mjs";
// v0.1.14 roulette prediction endpoint. It reads the published race snapshot,
// runs deterministic scoring, and stores an immutable prediction snapshot.
import { calculatePrediction } from "../../../race-prediction/scoring.mjs";
import { buildNarrativeInput, generateNarrative, NARRATIVE_CONFIG } from "../../../race-prediction/narrative.mjs";
import { isAuthorizedPublicClient, resolvePublicClientKey } from "./public-auth.mjs";
import { AI_CONTRACT_VERSION, resolveAiConfig, hashAiConfig } from "../../../race-prediction/ai-config.mjs";
import { buildAiInput } from "../../../race-prediction/ai-input.mjs";
import { runAiGeneration } from "../../../race-prediction/ai-generation.mjs";
import { createDiagnosticLogger, emitDiagnostic, diagnosticError } from "../../../race-prediction/ai-diagnostics.mjs";
import { BASE_PROMPT_TEXT } from "../../../race-prediction/ai-prompt.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicClientKey = resolvePublicClientKey(Deno.env.toObject());
const narrativeRetryToken = Deno.env.get("NARRATIVE_RETRY_TOKEN") ?? "";
const logicVersion = "v0.1.14-roulette-1";
const narrativeOptions = {
  model: Deno.env.get("RACE_NARRATIVE_MODEL") || NARRATIVE_CONFIG.model,
  promptVersion: Deno.env.get("RACE_NARRATIVE_PROMPT_VERSION") || NARRATIVE_CONFIG.promptVersion,
  timeoutMs: Number(Deno.env.get("RACE_NARRATIVE_TIMEOUT_MS") || NARRATIVE_CONFIG.timeoutMs),
  maxOutputTokens: Number(Deno.env.get("RACE_NARRATIVE_MAX_OUTPUT_TOKENS") || NARRATIVE_CONFIG.maxOutputTokens),
  maxChars: Number(Deno.env.get("RACE_NARRATIVE_MAX_CHARS") || NARRATIVE_CONFIG.maxChars),
};
const predictionMode = Deno.env.get("PREDICTION_MODE") === "ai_bundle" ? "ai_bundle" : "legacy";

async function rpc(name: string, body: Record<string, unknown>, signal?: AbortSignal, diagnosticMode = false) {
  const response = await fetch(`${projectUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    signal,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (diagnosticMode) {
      try { await response.body?.cancel(); } catch { /* no raw DB body in diagnostics */ }
      throw Object.assign(new Error("rpc_http_error"), { rpcHttpStatus: response.status });
    }
    throw new Error(`rpc_${name}_${response.status}:${await response.text()}`);
  }
  return response.json();
}

async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Cache-Control": "no-store", "Content-Type": "application/json" } });
}

async function aiRpc(name: string, body: Record<string, unknown>, deadlineAt?: number, diagnostics?: any) {
  const startedAt = Date.now();
  const fields = { operation: name, jobId: body.p_job_id };
  emitDiagnostic(diagnostics, "rpc.started", fields);
  const controller = deadlineAt === undefined ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, deadlineAt! - Date.now())) : null;
  try {
    const result = await rpc(`race_prediction_${name}`, body, controller?.signal, true);
    emitDiagnostic(diagnostics, "rpc.finished", { ...fields, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    emitDiagnostic(diagnostics, "rpc.failed", { ...fields, ...diagnosticError(error, controller?.signal), durationMs: Date.now() - startedAt });
    throw error;
  } finally { if (timer !== null) clearTimeout(timer); }
}

function publicBundle(bundle: any, reused = false) {
  return { status: "success", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION,
    snapshotId: bundle.id ?? bundle.snapshotId, main: bundle.main, counter: bundle.counter, hole: bundle.hole,
    narrative: bundle.narrative, narrativeStatus: "success", reused };
}

function attachBackgroundWorker(job: any, config: any, diagnostics: any) {
  const store = {
    beginAttempt: async (jobId: string, ownerToken: string, sequence: number) => {
      const result = await aiRpc("begin_ai_attempt", { p_job_id: jobId, p_owner: ownerToken, p_sequence: sequence, p_model: config.model }, Date.parse(job.expiresAt), diagnostics);
      return { sendAuthorized: result?.sendAuthorized === true };
    },
    finishAttempt: async (details: any) => {
      const result = await aiRpc("finish_ai_attempt", { p_job_id: details.jobId, p_owner: details.ownerToken, p_sequence: details.sequence,
        p_details: { ...details, durationMs: details.durationMs } }, Date.parse(job.expiresAt), diagnostics);
      return { recorded: result === true };
    },
    finishPrediction: (details: any) => aiRpc("finish_ai_job", { p_job_id: details.job.id, p_owner: details.ownerToken, p_sequence: details.sequence,
      p_output: details.output, p_meta: { provider: details.provider, model: details.model, providerModelVersion: details.providerModelVersion,
        usage: details.usage, durationMs: details.durationMs, promptHash: details.promptHash, requestHash: details.requestHash,
        requestPayload: details.requestPayload }, p_timeout_ms: Math.max(1, Math.min(5000, Date.parse(job.expiresAt) - Date.now())) }, Date.parse(job.expiresAt), diagnostics),
    failPrediction: (jobId: string, ownerToken: string, errorCode: string, retryable: boolean) => aiRpc("fail_ai_job", { p_job_id: jobId, p_owner: ownerToken, p_error: errorCode, p_retryable: retryable }, Date.parse(job.expiresAt), diagnostics),
  };
  const runtime = (globalThis as any).EdgeRuntime;
  if (typeof runtime?.waitUntil !== "function") return false;
  // Supabase Edge Runtime owns the shared job after the initiating browser returns.
  runtime.waitUntil(runAiGeneration({ job, config, apiKey: Deno.env.get("GEMINI_API_KEY") ?? "", store, diagnostics }).catch(() => { /* worker logs safe diagnostics; ambiguous DB commits must not be retried here */ }));
  return true;
}

async function startAiPrediction(body: any, diagnostics: any) {
  if (body.contractVersion !== AI_CONTRACT_VERSION) return json(409, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  const raceDate = String(body.raceDate ?? "");
  const stadiumCode = Number(body.stadiumCode);
  const raceNumber = Number(body.raceNumber);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || !Number.isInteger(stadiumCode) || stadiumCode < 1 || stadiumCode > 24 || !Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12) {
    return json(400, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  }
  const startedAt = Date.now();
  let config: any;
  try { config = resolveAiConfig(Deno.env.toObject()); }
  catch { emitDiagnostic(diagnostics, "input.rejected", { stage: "config", errorCode: "config_invalid" }); return json(503, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION }); }
  const deadlineAt = startedAt + config.totalTimeoutMs;
  const source = await aiRpc("get_ai_input", { p_race_date: raceDate, p_stadium_code: stadiumCode, p_race_number: raceNumber }, deadlineAt, diagnostics);
  if (!source) return json(404, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  let input: any;
  try {
    if (source.identity.raceDate !== raceDate || Number(source.identity.stadiumCode) !== stadiumCode || Number(source.identity.raceNumber) !== raceNumber) throw new Error("identity_mismatch");
    input = await buildAiInput({ identity: source.identity, programRaw: source.programRaw, previewRaw: source.previewRaw,
      presence: source.presence, provenance: source.provenance, closedAt: source.closedAt });
  } catch {
    emitDiagnostic(diagnostics, "input.rejected", { stage: "input", errorCode: "input_invalid" });
    return json(422, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  }
  const now = Date.now();
  if (!input.closedAt || !Number.isFinite(Date.parse(input.closedAt)) || Date.parse(input.closedAt) <= now) return json(200, { status: "closed", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  let configHash: string;
  try { configHash = await hashAiConfig(config, BASE_PROMPT_TEXT); }
  catch { emitDiagnostic(diagnostics, "input.rejected", { stage: "config", errorCode: "config_invalid" }); return json(503, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION }); }
  diagnostics = diagnostics?.child({ model: config.model, factsHash: input.factsHash, configHash });
  emitDiagnostic(diagnostics, "input.validated", { ok: true });
  const reuseKey = await hash({ mode: AI_CONTRACT_VERSION, factsHash: input.factsHash, configHash });
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const claim = await aiRpc("claim_ai_job", { p_reuse_key: reuseKey, p_race_id: source.raceId, p_identity: input.identity,
    p_closed_at: input.closedAt, p_facts_hash: input.factsHash, p_config_hash: configHash,
    p_input_bundle: input, p_config: config, p_timeout_ms: remainingMs }, deadlineAt, diagnostics);
  diagnostics = diagnostics?.child({ jobId: claim?.jobId });
  emitDiagnostic(diagnostics, "job.claimed", { state: claim?.state });
  if (claim?.state === "rejected") return json(200, { status: "closed", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  if (claim?.state === "existing") return json(200, publicBundle(claim.prediction, true));
  if (claim?.state === "busy") return json(202, { status: "generating", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION,
    jobId: claim.jobId, retryAfterMs: claim.retryAfterMs ?? 2000, remainingMs: Math.max(0, Date.parse(claim.expiresAt) - Date.now()) });
  if (claim?.state !== "created" || !claim.jobId || !claim.ownerToken) return json(503, { status: "failed", retryable: true, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  const job = { id: claim.jobId, ownerToken: claim.ownerToken, expiresAt: claim.expiresAt, inputBundle: input };
  if (!attachBackgroundWorker(job, config, diagnostics)) {
    await aiRpc("fail_ai_job", { p_job_id: job.id, p_owner: job.ownerToken, p_error: "background_runtime_unavailable", p_retryable: true }, Date.parse(job.expiresAt), diagnostics);
    return json(503, { status: "failed", retryable: true, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  }
  return json(202, { status: "generating", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION, jobId: claim.jobId,
    retryAfterMs: 2000, remainingMs: Math.max(0, Date.parse(claim.expiresAt) - Date.now()) });
}

async function readAiJob(jobId: string, diagnostics: any) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  diagnostics = diagnostics?.child({ jobId });
  const result = await aiRpc("read_ai_job", { p_job_id: jobId }, undefined, diagnostics);
  emitDiagnostic(diagnostics, "job.read", { state: result?.state ?? "missing" });
  if (!result) return json(404, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
  if (result.state === "succeeded") return json(200, { status: "success", ...result.prediction, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION, reused: false });
  if (result.state === "generating") return json(202, { status: "generating", mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION, jobId,
    retryAfterMs: 2000, remainingMs: Math.max(0, Date.parse(result.expiresAt) - Date.now()) });
  return json(503, { status: "failed", retryable: result.retryable === true, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
}

async function currentRacesFor(raceDate: string, stadiumCode: number) {
  return rpc("race_data_search_current_races", {
    p_from: raceDate, p_to: raceDate, p_stadium_code: stadiumCode,
    p_race_number: null, p_entry_number: null, p_racer_name: null, p_limit: 100,
  });
}

async function saveNarrativeAttempt(predictionId: string, input: any, result: any, startedAt: string, finishedAt: string, durationMs: number, inputHash: string, promptHash: string) {
  const sanitizedError = result.diagnostics
    ? JSON.stringify({ code: result.errorCode, ...result.diagnostics })
    : result.errorCode;
  await rpc("race_data_create_narrative_attempt", {
    p_prediction_id: predictionId,
    p_model: result.config.model,
    p_prompt_version: result.config.promptVersion,
    p_prompt_hash: promptHash,
    p_narrative_input_hash: inputHash,
    p_started_at: startedAt,
    p_finished_at: finishedAt,
    p_status: result.result ? "success" : "error",
    p_text: result.result?.text ?? null,
    p_validated_facts: result.result?.citedFactorIds ?? [],
    p_error_code: result.errorCode,
    p_sanitized_error: sanitizedError,
    p_error_at: result.result ? null : finishedAt,
    p_token_usage: null,
    p_duration_ms: durationMs,
  });
  return {
    narrativeStatus: result.result ? "success" : "gemini_error",
    narrative: result.result?.text ?? null,
    narrativeErrorCode: result.errorCode ?? null,
    narrativeInputHash: inputHash,
  };
}

async function generateAndSaveNarrative(predictionId: string, race: any, prediction: any) {
  const input = buildNarrativeInput(race, prediction);
  const inputHash = await hash(input);
  const promptHash = await hash({ promptVersion: narrativeOptions.promptVersion, input });
  const started = new Date().toISOString();
  const startedMs = Date.now();
  const result = await generateNarrative(input, Deno.env.get("GEMINI_API_KEY") ?? "", fetch, narrativeOptions);
  const finished = new Date().toISOString();
  return saveNarrativeAttempt(predictionId, input, result, started, finished, Date.now() - startedMs, inputHash, promptHash);
}

async function handlePredictionRequest(request: Request, diagnostics: any) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!isAuthorizedPublicClient(request, { publishableKey: publicClientKey })) {
    return json(401, { error: "invalid_public_client" });
  }
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("action") === "prediction-job") {
        return await readAiJob(url.searchParams.get("jobId") ?? "", diagnostics);
      }
      if (url.searchParams.get("action") !== "races") return json(400, { error: "invalid_action" });
      const raceDate = url.searchParams.get("raceDate") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return json(400, { error: "invalid_race_date" });
      const stadiums = await Promise.all(Array.from({ length: 24 }, (_, index) => index + 1).map(async (stadiumCode) => {
        const result = await currentRacesFor(raceDate, stadiumCode);
        const races = Array.isArray(result?.data) ? result.data : [];
        return {
          stadiumCode,
          hasRaces: races.length > 0,
          races: races.map((race: any) => ({
            raceNumber: race.race_number,
            closedAt: race.program?.closed_at ?? null,
            lastSuccessAt: race.last_success_at ?? null,
          })),
        };
      }));
      return json(200, { raceDate, stadiums, predictionMode, predictionContractVersion: predictionMode === "ai_bundle" ? AI_CONTRACT_VERSION : null });
    }
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const body = await request.json();
    if (predictionMode === "ai_bundle") {
      if (body.action !== "generate") return json(409, { status: "failed", retryable: false, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
      return await startAiPrediction(body, diagnostics);
    }
    if (body.action === "generate") return json(409, { status: "failed", retryable: false, mode: "legacy", contractVersion: AI_CONTRACT_VERSION });
    if (body.action === "narrative-retry") {
      if (!narrativeRetryToken || request.headers.get("x-narrative-retry-token") !== narrativeRetryToken) {
        return json(403, { error: "narrative_retry_not_public" });
      }
      const predictionId = String(body.predictionId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(predictionId)) return json(400, { error: "invalid_prediction_id" });
      const stored = await rpc("race_data_get_prediction_snapshot", { p_prediction_id: predictionId });
      if (!stored?.payload?.prediction) return json(404, { status: "api_error", errorCode: "prediction_not_found" });
      const storedRace = {
        race_date: stored.payload.race?.raceDate,
        stadium_code: stored.payload.race?.stadiumCode,
        race_number: stored.payload.race?.raceNumber,
      };
      return json(200, { predictionId, ...stored.payload.prediction, ...(await generateAndSaveNarrative(predictionId, storedRace, stored.payload.prediction)) });
    }
    const raceDate = String(body.raceDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    const stadiumCode = Number(body.stadiumCode);
    const raceNumber = Number(body.raceNumber);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || !Number.isInteger(stadiumCode) || !Number.isInteger(raceNumber)) {
      return json(400, { error: "invalid_race_selector" });
    }
    const result = await rpc("race_data_search_current_races", {
      p_from: raceDate, p_to: raceDate, p_stadium_code: stadiumCode,
      p_race_number: raceNumber, p_entry_number: null, p_racer_name: null, p_limit: 1,
    });
    const race = result?.data?.[0];
    if (!race) return json(404, { status: "api_error", errorCode: "race_not_found" });
    const now = Date.now();
    const deadline = deadlineState(race.program?.closed_at, now);
    if (deadline === "invalid") return json(422, { status: "api_error", errorCode: "deadline_unavailable" });
    if (deadline === "closed") return json(200, { status: "closed", main: null, counter: null, hole: null, race });
    const fetchedAt = Date.parse(race.last_success_at ?? "");
    const previewPresent = race.presence?.preview === "value";
    const freshnessLimit = previewPresent ? 10 * 60_000 : 30 * 60_000;
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > freshnessLimit) return json(200, { status: "stale", main: null, counter: null, hole: null, race, lastSuccessAt: race.last_success_at });
    const prediction = calculatePrediction(race, { generatedAt: new Date(now).toISOString(), scoreAsOf: new Date(now).toISOString() });
    const { inputDataHash, reuseKey } = await predictionKeys(race, prediction.configVersion, logicVersion);
    const generation = await rpc("race_data_acquire_prediction_generation", { p_reuse_key: reuseKey, p_lease_seconds: 45 });
    if (generation?.state === "busy") {
      return json(202, { status: "generating", retryAfter: generation.retry_after ?? 2, reuseKey });
    }
    if (generation?.state === "existing" && generation.prediction_id) {
      const existing = await rpc("race_data_get_prediction_snapshot", { p_prediction_id: generation.prediction_id });
      const existingPrediction = existing?.payload?.prediction;
      if (existingPrediction) return json(200, {
        ...existingPrediction,
        snapshotId: generation.prediction_id,
        inputDataHash,
        reused: true,
        narrativeStatus: existing.narrative?.status ?? null,
        narrative: existing.narrative?.text ?? null,
      });
    }
    const snapshotId = await rpc("race_data_create_prediction_snapshot", {
      p_race_id: race.race_id, p_generated_at: prediction.generatedAt, p_score_as_of: prediction.scoreAsOf,
      p_status: prediction.status, p_config_version: prediction.configVersion, p_logic_version: logicVersion,
      p_reuse_key: reuseKey, p_input_data_hash: inputDataHash, p_main: prediction.main, p_counter: prediction.counter,
      p_hole: prediction.hole, p_payload: { prediction, race: { raceDate, stadiumCode, raceNumber } },
    });
    const narrative = await generateAndSaveNarrative(snapshotId, race, prediction);
    return json(200, { ...prediction, snapshotId, inputDataHash, ...narrative });
  } catch (error) {
    if (predictionMode === "ai_bundle" || new URL(request.url).searchParams.get("action") === "prediction-job") {
      emitDiagnostic(diagnostics, "request.failed", { stage: "request", ...diagnosticError(error) });
      return json(503, { status: "failed", retryable: true, mode: "ai_bundle", contractVersion: AI_CONTRACT_VERSION });
    }
    return json(500, { status: "api_error", errorCode: "prediction_failed", message: error instanceof Error ? error.message : String(error) });
  }
}

Deno.serve(async (request) => {
  const aiRoute = (predictionMode === "ai_bundle" && request.method === "POST") ||
    new URL(request.url).searchParams.get("action") === "prediction-job";
  if (!aiRoute) return handlePredictionRequest(request, null);
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const diagnostics = createDiagnosticLogger({ requestId,
    runId: Deno.env.get("RACE_AI_DIAGNOSTIC_RUN_ID"), caseId: Deno.env.get("RACE_AI_DIAGNOSTIC_CASE_ID") }, {
    enabled: Deno.env.get("RACE_AI_DIAGNOSTICS") !== "off",
    secrets: [Deno.env.get("GEMINI_API_KEY") ?? "", serviceKey, publicClientKey ?? "", narrativeRetryToken],
  });
  emitDiagnostic(diagnostics, "request.started");
  const response = await handlePredictionRequest(request, diagnostics);
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("Access-Control-Expose-Headers", "X-Request-ID");
  emitDiagnostic(diagnostics, "request.finished", { httpStatus: response.status, durationMs: Date.now() - startedAt });
  return response;
});
