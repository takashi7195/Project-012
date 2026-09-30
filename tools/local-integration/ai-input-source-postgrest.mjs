// Verifies one public, historical API race through the local input RPC. The
// temporary local fixture is removed in finally. No generation job is created.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalizeSnapshot } from '../../race-ingestion/normalize.mjs';
import { buildAiInput, canonicalJson, separateProgram } from '../../race-prediction/ai-input.mjs';

const sourceUrl = 'https://boatraceopenapi.github.io/api/v1/2026/20260101.json';
const envText = readFileSync(new URL('../../supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env', import.meta.url), 'utf8');
const envValue = name => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
if (!serviceKey) throw new Error('Local service role key unavailable; value withheld');
const container = 'supabase_db_project-012';
const fixture = { program: 'a1900000-0000-4000-8000-000000000013', preview: 'a1900000-0000-4000-8000-000000000014' };
const forbidden = new Set(['result', 'payouts', 'refunds', 'actual_course', 'actual_start_timing', 'finish_position', 'place_number', 'place_number_source', 'existing_prediction', 'ai_prediction', 'prediction_snapshot']);
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.has(key)).map(([key, child]) => [key, strip(child)])) : value;
const psql = sql => {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('local source fixture SQL failed; output withheld');
};
const sqlJson = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
let seeded = false;
try {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`public source returned HTTP ${response.status}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const source = JSON.parse(bytes.toString('utf8'));
  const snapshot = normalizeSnapshot(source, { fetchedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(snapshot.accepted, true, 'public source snapshot must normalize');
  const race = snapshot.races.find(item => item.program.presence === 'value' && item.program.rows.length === 6 && item.identity.date === '2026-01-01');
  assert.ok(race, 'source must contain a six-entry program race');
  const selector = race.identity;
  let seedSql = readFileSync(new URL('./seed-ai-input-fixture.sql', import.meta.url), 'utf8');
  seedSql = seedSql.replace("v_date date := (clock_timestamp() at time zone 'Asia/Tokyo')::date;", "v_date date := date '2026-01-01';")
    .replaceAll('stadium_code=24 and race_number=12', `stadium_code=${selector.stadiumNumber} and race_number=${selector.raceNumber}`)
    .replace("'stadium_number',24,'race_number',12", `'stadium_number',${selector.stadiumNumber},'race_number',${selector.raceNumber}`)
    .replace("values(v_race,v_source,v_date,24,12)", `values(v_race,v_source,v_date,${selector.stadiumNumber},${selector.raceNumber})`);
  psql(seedSql);
  seeded = true;
  psql(`update race_data.race_components set raw_json=${sqlJson(race.raw.program)} where id='${fixture.program}'; update race_data.race_components set raw_json=${sqlJson(race.raw.preview ?? null)} where id='${fixture.preview}';`);

  const rpc = await fetch('http://127.0.0.1:54321/rest/v1/rpc/race_prediction_get_ai_input', {
    method: 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_race_date: selector.date, p_stadium_code: selector.stadiumNumber, p_race_number: selector.raceNumber }),
    signal: AbortSignal.timeout(15000),
  });
  if (!rpc.ok) { await rpc.body?.cancel(); throw new Error(`local input RPC returned HTTP ${rpc.status}`); }
  const rpcInput = await rpc.json();
  const expectedRaw = strip(race.raw.program);
  assert.equal(canonicalJson(rpcInput.programRaw), canonicalJson(expectedRaw), 'RPC raw program must equal the source after only result-field filtering');
  assert.equal(canonicalJson(rpcInput.previewRaw), canonicalJson(race.raw.preview ?? null), 'RPC preview must preserve source values');
  const assembled = await buildAiInput({ identity: rpcInput.identity, programRaw: rpcInput.programRaw, previewRaw: rpcInput.previewRaw, presence: rpcInput.presence, provenance: rpcInput.provenance, closedAt: rpcInput.closedAt });
  const { program } = separateProgram(expectedRaw);
  assert.equal(canonicalJson(assembled.facts.program), canonicalJson(program), 'AI input program must retain source pre-race values');
  assert.equal(Object.keys(assembled.facts.program.racers).length, 6);
  assert.equal(assembled.facts.program.result, undefined);
  console.log('PASS: one six-entry public source race passed through local PostgREST and AI input assembly; all pre-race fields matched');
  console.log('PASS: embedded preview matched its source; result facts were filtered; no generation job or provider call');
  console.log(`INFO: source=${sourceUrl} raceCount=${snapshot.raceCount} selected=${selector.stadiumNumber}/${selector.raceNumber} sha256=${createHash('sha256').update(bytes).digest('hex')}`);
} finally {
  if (seeded) psql(readFileSync(new URL('./cleanup-ai-input-fixture.sql', import.meta.url), 'utf8'));
}
