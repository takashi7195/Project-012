// One real selected-model request through the production prediction handler
// and local PostgREST. It seeds only the existing synthetic fixture and cleans
// the fixture plus generated rows in finally. It never calls hosted Supabase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateAiOutput } from "../../race-prediction/ai-output.mjs";
import { DEFAULT_AI_CONFIG } from "../../race-prediction/ai-config.mjs";

const apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) throw new Error("GEMINI_API_KEY is missing; no test request was sent");
const missingPreview = process.env.AI_LIVE_MISSING_PREVIEW === "1";
const container = "supabase_db_project-012";
const localEnvPath = new URL("../../supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env", import.meta.url);
const localEnv = readFileSync(localEnvPath, "utf8");
const envValue = (name) => localEnv.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const publicKey = envValue("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || envValue("SUPABASE_ANON_KEY");
if (!serviceKey || !publicKey) throw new Error("local Supabase credentials unavailable; no values are printed");

function psql(sql, json = false) {
  const args = ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
  if (json) args.splice(5, 0, "-A", "-t");
  const result = spawnSync("docker", args, { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("local database fixture operation failed; output withheld");
  return result.stdout.trim();
}
function runFixture(path) { psql(readFileSync(new URL(path, import.meta.url), "utf8")); }

let fixtureSeeded = false;
let priorFetch;
let priorDeno;
let priorRuntime;
let priorConsoleInfo;
const workers = [];
const providerStatuses = [];
const safeDiagnostics = [];
try {
  runFixture("./seed-ai-input-fixture.sql");
  fixtureSeeded = true;
  psql("update race_data.race_programs set closed_at=clock_timestamp()+interval '2 hours' where projection_id='a1900000-0000-4000-8000-000000000015'; update race_data.ingestion_runs set fetched_at=clock_timestamp() where id='a1900000-0000-4000-8000-000000000017';");
  if (missingPreview) psql("update race_data.snapshot_races set preview_presence='missing' where preview_component_id='a1900000-0000-4000-8000-000000000014'; update race_data.race_components set raw_json='null'::jsonb where id='a1900000-0000-4000-8000-000000000014';");

  const vars = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
    PREDICTION_MODE: "ai_bundle",
    GEMINI_API_KEY: apiKey,
  };
  priorFetch = globalThis.fetch;
  priorDeno = globalThis.Deno;
  priorRuntime = globalThis.EdgeRuntime;
  priorConsoleInfo = console.info;
  console.info = (line) => safeDiagnostics.push(String(line));
  globalThis.Deno = { env: { get: (name) => vars[name], toObject: () => ({ ...vars }) }, serve: (handler) => { globalThis.__v019LiveHandler = handler; } };
  globalThis.EdgeRuntime = { waitUntil: (promise) => { workers.push(promise); } };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      const response = await priorFetch(url, options);
      providerStatuses.push(response.status);
      return response;
    }
    return priorFetch(url, options);
  };

  await import(`../../supabase/functions/predictions/index.ts?live-postgrest=${Date.now()}`);
  const handler = globalThis.__v019LiveHandler;
  assert.equal(typeof handler, "function", "production handler did not start");
  const headers = { apikey: publicKey, "content-type": "application/json" };
  const raceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = await handler(new Request("http://local.test/functions/v1/predictions", {
    method: "POST", headers,
    body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate, stadiumCode: 24, raceNumber: 12 }),
  }));
  assert.equal(start.status, 202, "production handler did not admit the synthetic race");
  const startBody = await start.json();
  assert.match(startBody.jobId ?? "", /^[0-9a-f-]{36}$/i, "production handler did not return a job ID");
  assert.equal(workers.length, 1, "exactly one background worker should be registered");

  let timeoutId;
  try {
    await Promise.race([
      workers[0],
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("local live job exceeded the 100-second test cap")), 100_000); }),
    ]);
  } finally { clearTimeout(timeoutId); }

  const read = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${startBody.jobId}`, { method: "GET", headers }));
  assert.equal(read.status, 200, "saved job could not be read through the production handler");
  const result = await read.json();
  assert.equal(result.status, "success");
  assert.equal(result.mode, "ai_bundle");
  assert.equal(result.reused, false);
  assert.equal(providerStatuses.length, 1, "the live worker must make exactly one provider request for this success");
  assert.equal(providerStatuses[0], 200, "provider did not return HTTP 200");
  assert.equal(validateAiOutput({ main: result.main, counter: result.counter, hole: result.hole, narrative: result.narrative }).valid, true,
    "the saved public bundle failed the application output contract");

  const jobId = String(startBody.jobId).replaceAll("'", "''");
  const metadataText = psql(`begin read only; select jsonb_build_object(
    'bundleCount',(select count(*) from race_prediction.ai_prediction_bundles where job_id='${jobId}'),
    'attemptCount',(select count(*) from race_prediction.ai_generation_attempts where job_id='${jobId}'),
    'model',(select min(model) from race_prediction.ai_prediction_bundles where job_id='${jobId}'),
    'provider',(select min(provider) from race_prediction.ai_prediction_bundles where job_id='${jobId}'),
    'winningAttempt',(select min(winning_attempt) from race_prediction.ai_prediction_bundles where job_id='${jobId}'),
    'savedTokens',(select max((usage->>'totalTokenCount')::integer) from race_prediction.ai_prediction_bundles where job_id='${jobId}')
  ); rollback;`, true);
  const metadata = JSON.parse(metadataText);
  assert.equal(metadata.bundleCount, 1, "successful job must have exactly one saved bundle");
  assert.equal(metadata.attemptCount, 1, "successful single-response run must save exactly one attempt");
  assert.equal(metadata.model, DEFAULT_AI_CONFIG.model, "saved model does not match selected default");
  assert.equal(metadata.provider, "gemini");
  assert.equal(Number(metadata.winningAttempt), 1);
  assert.equal(Number(metadata.savedTokens) > 0, true, "saved bundle must retain provider token usage");
  console.log(`PASS: production handler + local PostgREST + ${DEFAULT_AI_CONFIG.model} completed one real generation (${missingPreview ? "missing" : "normal"} preview), contract validation, atomic save and GET`);
  console.log(JSON.stringify({ httpStatus: providerStatuses[0], durationMs: safeDiagnostics.map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((event) => event?.event === "provider.finished")?.durationMs ?? null,
    model: metadata.model, inputCase: missingPreview ? "missing-preview" : "normal-preview", attemptCount: Number(metadata.attemptCount), bundleCount: Number(metadata.bundleCount), totalTokens: Number(metadata.savedTokens), outputValid: true }, null, 2));
} finally {
  if (priorFetch) globalThis.fetch = priorFetch;
  if (priorDeno === undefined) delete globalThis.Deno; else globalThis.Deno = priorDeno;
  if (priorRuntime === undefined) delete globalThis.EdgeRuntime; else globalThis.EdgeRuntime = priorRuntime;
  if (priorConsoleInfo) console.info = priorConsoleInfo;
  delete globalThis.__v019LiveHandler;
  if (fixtureSeeded) runFixture("./cleanup-ai-generation-fixture.sql");
}
