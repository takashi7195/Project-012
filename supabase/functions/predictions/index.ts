import { predictionKeys, deadlineState } from "../../../race-prediction/input-contract.mjs";
// v0.1.14 roulette prediction endpoint. It reads the published race snapshot,
// runs deterministic scoring, and stores an immutable prediction snapshot.
import { calculatePrediction } from "../../../race-prediction/scoring.mjs";
import { buildNarrativeInput, generateNarrative, NARRATIVE_CONFIG } from "../../../race-prediction/narrative.mjs";
import { isAuthorizedPublicClient, resolvePublicClientKey } from "./public-auth.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${projectUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}:${await response.text()}`);
  return response.json();
}

async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function saveNarrativeAttempt(predictionId: string, input: any, result: any, startedAt: string, finishedAt: string, durationMs: number, inputHash: string, promptHash: string) {
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
    p_sanitized_error: result.errorCode,
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isAuthorizedPublicClient(request, { publishableKey: publicClientKey })) {
    return json(401, { error: "invalid_public_client" });
  }
  try {
    const body = await request.json();
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
    return json(500, { status: "api_error", errorCode: "prediction_failed", message: String(error?.message ?? error) });
  }
});
