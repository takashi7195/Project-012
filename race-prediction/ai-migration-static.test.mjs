import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260926000000_ai_prediction_bundle_v0_1_19.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/predictions/index.ts', import.meta.url), 'utf8');

test('migration defines isolated tables, primary/foreign keys, retention protection and RLS', () => {
  for (const table of ['ai_generation_keys', 'ai_generation_jobs', 'ai_prediction_bundles', 'ai_generation_attempts']) {
    assert.match(migration, new RegExp(`create table race_prediction\\.${table} \\(`));
    assert.match(migration, new RegExp(`alter table race_prediction\\.${table} enable row level security`));
  }
  assert.match(migration, /on delete restrict/g);
  assert.match(migration, /revoke all on all tables in schema race_prediction from public, anon, authenticated/);
  assert.match(migration, /grant all on all tables in schema race_prediction to service_role/);
});

test('DB checks constrain ticket shape, uniqueness, narrative and at most two attempts', () => {
  assert.match(migration, /array_lower\(p_pick,1\)=1/);
  assert.match(migration, /array_position\(p_pick,null\) is null/);
  assert.match(migration, /array\[1,2,3,4,5,6\]::smallint\[\]/);
  assert.match(migration, /check \(attempt_count between 0 and 2\)/);
  assert.match(migration, /check \(main <> counter and main <> hole and counter <> hole\)/);
  assert.match(migration, /check \(length\(btrim\(narrative\)\) > 0\)/);
});

test('each public RPC wrapper calls its matching internal function and stays service-role only', () => {
  const mappings = [
    ['get_ai_input', 'get_input'], ['claim_ai_job', 'claim_job'], ['begin_ai_attempt', 'begin_attempt'],
    ['finish_ai_attempt', 'finish_attempt'], ['finish_ai_job', 'finish_prediction'], ['fail_ai_job', 'fail_job'], ['read_ai_job', 'read_job'],
  ];
  for (const [publicName, internalName] of mappings) {
    assert.match(migration, new RegExp(`create function public\\.race_prediction_${publicName}\\(`));
    assert.match(migration, new RegExp(`select race_prediction\\.${internalName}\\(`));
  }
  assert.match(migration, /revoke all on function public\.race_prediction_get_ai_input[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.race_prediction_get_ai_input[\s\S]*to service_role/);
});

test('job admission and finish paths enforce the fixed expiry and reuse-key owner', () => {
  assert.match(migration, /v_admitted_at \+ make_interval\(secs => p_timeout_ms::numeric \/ 1000\)/);
  assert.match(migration, /v_expires <= v_now/);
  assert.match(migration, /v_job\.expires_at<=clock_timestamp\(\)/);
  assert.match(migration, /v_key\.current_job_id<>p_job_id/);
  assert.match(migration, /where reuse_key=p_reuse_key/);
});

test('result stripping is recursive and success is saved in one transaction function', () => {
  assert.match(migration, /race_prediction\.strip_result_fields\(value\)/);
  assert.match(migration, /where key not in \('result','payouts','refunds'/);
  assert.match(migration, /insert into race_prediction\.ai_prediction_bundles/);
  assert.match(migration, /update race_prediction\.ai_generation_jobs set state='succeeded'/);
  assert.match(migration, /update race_prediction\.ai_generation_keys set completed_prediction_id/);
});

test('edge adapter maps RPC names and never puts the Gemini key in the request payload', () => {
  for (const name of ['get_ai_input', 'claim_ai_job', 'begin_ai_attempt', 'finish_ai_attempt', 'finish_ai_job', 'fail_ai_job', 'read_ai_job']) {
    assert.ok(migration.includes(`public.race_prediction_${name}`), `missing migration RPC ${name}`);
    assert.ok(edge.includes(`"${name}"`), `missing edge RPC ${name}`);
  }
  assert.match(edge, /GEMINI_API_KEY/);
  assert.match(edge, /race_prediction_\$\{name\}/);
  assert.doesNotMatch(edge, /requestPayload[^\n]*apiKey|p_meta:[^\n]*apiKey/);
});
