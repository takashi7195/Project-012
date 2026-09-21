// v0.1.14 roulette prediction endpoint. It reads the published race snapshot,
// runs deterministic scoring, and stores an immutable prediction snapshot.
import { calculatePrediction } from "../../../race-prediction/scoring.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const logicVersion = "v0.1.14-roulette-1";

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const body = await request.json();
    const raceDate = String(body.raceDate ?? new Date().toISOString().slice(0, 10));
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
    const closedAt = race.program?.closed_at ? Date.parse(race.program.closed_at) : NaN;
    if (Number.isFinite(closedAt) && closedAt <= now) return json(200, { status: "closed", main: null, counter: null, hole: null, race });
    const fetchedAt = Date.parse(race.last_success_at ?? "");
    const previewPresent = race.presence?.preview === "value";
    const freshnessLimit = previewPresent ? 10 * 60_000 : 30 * 60_000;
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > freshnessLimit) return json(200, { status: "stale", main: null, counter: null, hole: null, race, lastSuccessAt: race.last_success_at });
    const prediction = calculatePrediction(race, { generatedAt: new Date(now).toISOString(), scoreAsOf: new Date(now).toISOString() });
    const inputDataHash = await hash({ race, configVersion: prediction.configVersion, logicVersion });
    const snapshotId = await rpc("race_data_create_prediction_snapshot", {
      p_race_id: race.race_id, p_generated_at: prediction.generatedAt, p_score_as_of: prediction.scoreAsOf,
      p_status: prediction.status, p_config_version: prediction.configVersion, p_logic_version: logicVersion,
      p_input_data_hash: inputDataHash, p_main: prediction.main, p_counter: prediction.counter,
      p_hole: prediction.hole, p_payload: { prediction, race: { raceDate, stadiumCode, raceNumber } },
    });
    return json(200, { ...prediction, snapshotId, inputDataHash });
  } catch (error) {
    return json(500, { status: "api_error", errorCode: "prediction_failed", message: String(error?.message ?? error) });
  }
});
