import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260922000000_prediction_snapshots_v0_1_14.sql", import.meta.url), "utf8");
const leaseFixSql = await readFile(new URL("../supabase/migrations/20260923000000_prediction_generation_lease_atomic_v0_1_14.sql", import.meta.url), "utf8");
const narrativeSql = await readFile(new URL("../supabase/migrations/20260922000001_narrative_attempts_v0_1_14.sql", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/predictions/index.ts", import.meta.url), "utf8");
const auth = await readFile(new URL("../supabase/functions/predictions/public-auth.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

test("prediction snapshot migration is immutable and service-role only", () => {
  assert.match(sql, /create schema if not exists race_prediction/);
  assert.match(sql, /create table if not exists race_prediction\.prediction_snapshots/);
  assert.match(sql, /create or replace function race_prediction\.create_prediction_snapshot/);
  assert.match(sql, /grant execute on function race_prediction\.create_prediction_snapshot.*to service_role/s);
  assert.match(sql, /revoke all on schema race_prediction from public, anon, authenticated/);
  assert.match(sql, /grant select, insert on race_prediction\.prediction_snapshots to service_role/);
  assert.match(sql, /p_input_data_hash/);
  assert.match(sql, /prediction_snapshots_reuse_key_uq/);
  assert.match(sql, /acquire_prediction_generation/);
});

test("generation lease acquisition arbitrates concurrent reuse keys atomically", () => {
  assert.match(leaseFixSql, /insert into race_prediction\.prediction_generation_leases[\s\S]*on conflict \(reuse_key\) do nothing/);
  assert.match(leaseFixSql, /if found then[\s\S]*state','acquired'/);
  assert.match(leaseFixSql, /for update/);
  assert.match(leaseFixSql, /lease_until <= now\(\)/);
  assert.match(leaseFixSql, /grant execute on function race_prediction\.acquire_prediction_generation.*to service_role/s);
  assert.match(leaseFixSql, /grant execute on function public\.race_data_acquire_prediction_generation.*to service_role/s);
});

test("prediction edge function reads current published data and saves a snapshot", () => {
  assert.match(edge, /race_data_search_current_races/);
  assert.match(edge, /calculatePrediction/);
  assert.match(edge, /race_data_create_prediction_snapshot/);
  assert.match(edge, /race_data_acquire_prediction_generation/);
  assert.match(edge, /status: "generating"/);
  assert.match(edge, /reused: true/);
  assert.match(edge, /await predictionKeys\(race, prediction.configVersion, logicVersion\)/);
  assert.match(edge, /deadline_unavailable/);
  assert.match(edge, /status: \"stale\"/);
  assert.match(edge, /status: \"closed\"/);
});

test("narrative attempts are append-only and retry the same prediction id", () => {
  assert.match(narrativeSql, /create table if not exists race_prediction\.narrative_attempts/);
  assert.match(narrativeSql, /prediction_id uuid not null references race_prediction\.prediction_snapshots/);
  assert.match(narrativeSql, /prompt_version text not null/);
  assert.match(narrativeSql, /narrative_input_hash text not null/);
  assert.match(narrativeSql, /create or replace function race_prediction\.create_narrative_attempt/);
  assert.match(narrativeSql, /grant select, insert on race_prediction\.narrative_attempts to service_role/);
  assert.match(narrativeSql, /pg_advisory_xact_lock/);
  assert.match(edge, /body\.action === "narrative-retry"/);
  assert.match(edge, /race_data_get_prediction_snapshot/);
  assert.match(edge, /generateAndSaveNarrative\(predictionId/);
});

test("frontend requests current prediction UI and renders counter/hole", () => {
  assert.match(html, /v0\.1\.18/);
  assert.match(html, /ui-reference\.css\?ui=reference06/);
  assert.match(script, /functions\/v1\/predictions/);
  assert.match(script, /setPredictionRow\('counter'/);
  assert.match(script, /setPredictionRow\('longshot'/);
  assert.match(script, /pollPrediction/);
  assert.match(script, /raceDevelopmentText.textContent = prediction.narrative/);
  assert.doesNotMatch(script, /const result = selectCombination\(dist\)/);
  assert.match(script, /apikey: SUPABASE_PUBLISHABLE_KEY/);
  assert.match(script, /formatJstDate\(\)/);
  assert.match(script, /action=races/);
  assert.match(script, /option\.disabled = !available/);
  assert.match(script, /締切予定/);
  assert.match(script, /closedAt/);
  assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE-SERVICE-ROLE-KEY/);
});

test("prediction handler uses explicit public-client auth and protects narrative retry", () => {
  assert.match(edge, /isAuthorizedPublicClient/);
  assert.match(auth, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(edge, /narrative_retry_not_public/);
});
