import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260922000000_prediction_snapshots_v0_1_14.sql", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/predictions/index.ts", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

test("prediction snapshot migration is immutable and service-role only", () => {
  assert.match(sql, /create table if not exists race_data\.prediction_snapshots/);
  assert.match(sql, /create or replace function race_data\.create_prediction_snapshot/);
  assert.match(sql, /grant execute on function race_data\.create_prediction_snapshot.*to service_role/s);
  assert.match(sql, /p_input_data_hash/);
});

test("prediction edge function reads current published data and saves a snapshot", () => {
  assert.match(edge, /race_data_search_current_races/);
  assert.match(edge, /calculatePrediction/);
  assert.match(edge, /race_data_create_prediction_snapshot/);
  assert.match(edge, /status: \"stale\"/);
  assert.match(edge, /status: \"closed\"/);
});

test("frontend requests v0.1.14 prediction and renders counter/hole", () => {
  assert.match(html, /v0\.1\.14/);
  assert.match(script, /functions\/v1\/predictions/);
  assert.match(script, /setPredictionRow\('counter'/);
  assert.match(script, /setPredictionRow\('longshot'/);
  assert.doesNotMatch(script, /const result = selectCombination\(dist\)/);
});

