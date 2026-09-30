// Repeatedly reads one race while its day_head switches between two ready
// batches. Every response must contain one internally consistent batch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const container = "supabase_db_project-012";
const envText = readFileSync(new URL("../../supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env", import.meta.url), "utf8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
if (!serviceKey) throw new Error("local service role unavailable; value withheld");
const url = "http://127.0.0.1:54321/rest/v1/rpc/race_prediction_get_ai_input";
const raceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const originalBatch = "a1900000-0000-4000-8000-000000000011";
const alternateBatch = "a1900000-0000-4000-8000-000000000018";
let seeded = false;

function sql(input) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error("local fixture SQL failed; output withheld");
}
function cleanup() {
  sql(`begin;
    update race_data.day_heads set current_batch_id='${originalBatch}' where current_batch_id='${alternateBatch}';
    delete from race_data.coverage where batch_id='${alternateBatch}';
    delete from race_data.snapshot_races where batch_id='${alternateBatch}';
    delete from race_data.race_programs where projection_id='a1900000-0000-4000-8000-000000000021';
    delete from race_data.component_projections where id in ('a1900000-0000-4000-8000-000000000021','a1900000-0000-4000-8000-000000000022');
    delete from race_data.race_components where id in ('a1900000-0000-4000-8000-000000000019','a1900000-0000-4000-8000-000000000020');
    delete from race_data.normalization_batches where id='${alternateBatch}';
  commit;`);
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: readFileSync(new URL("./cleanup-ai-input-fixture.sql", import.meta.url), "utf8"), encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Error("local fixture cleanup failed; output withheld");
}

try {
  const seed = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: readFileSync(new URL("./seed-ai-input-fixture.sql", import.meta.url), "utf8"), encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (seed.error || seed.status !== 0) throw new Error("local fixture seed failed; output withheld");
  seeded = true;
  sql(`begin;
    insert into race_data.normalization_batches(id,snapshot_id,parser_version,rules_version,state,quality_summary,published_at)
    values('${alternateBatch}','a1900000-0000-4000-8000-000000000010','codex-alt-v1','codex-alt-v1','ready','{}'::jsonb,clock_timestamp());
    insert into race_data.race_components(id,race_id,kind,raw_hash,raw_json,presence)
    select 'a1900000-0000-4000-8000-000000000019',race_id,'program',repeat('c',64),jsonb_set(raw_json,'{title}','"alternate batch"'::jsonb),'value'
    from race_data.race_components where id='a1900000-0000-4000-8000-000000000013';
    insert into race_data.race_components(id,race_id,kind,raw_hash,raw_json,presence)
    select 'a1900000-0000-4000-8000-000000000020',race_id,'preview',repeat('d',64),jsonb_set(raw_json,'{racers,1,start_timing}','"F.99"'::jsonb),'value'
    from race_data.race_components where id='a1900000-0000-4000-8000-000000000014';
    insert into race_data.component_projections(id,component_id,parser_version,rules_version,quality_state,quality_flags)
    values('a1900000-0000-4000-8000-000000000021','a1900000-0000-4000-8000-000000000019','codex-alt-v1','codex-alt-v1','accepted','[]'::jsonb),
          ('a1900000-0000-4000-8000-000000000022','a1900000-0000-4000-8000-000000000020','codex-alt-v1','codex-alt-v1','accepted','[]'::jsonb);
    insert into race_data.race_programs(projection_id,closed_at,title,distance_m,day_number)
    select 'a1900000-0000-4000-8000-000000000021',closed_at,'alternate batch',1800,1 from race_data.race_programs where projection_id='a1900000-0000-4000-8000-000000000015';
    insert into race_data.snapshot_races(batch_id,race_id,program_component_id,preview_component_id,program_projection_id,preview_projection_id,program_presence,preview_presence,result_presence,quality_flags)
    values('${alternateBatch}','a1900000-0000-4000-8000-000000000012','a1900000-0000-4000-8000-000000000019','a1900000-0000-4000-8000-000000000020','a1900000-0000-4000-8000-000000000021','a1900000-0000-4000-8000-000000000022','value','value','missing','[]'::jsonb);
  commit;`);

  const readOne = async () => {
    const response = await fetch(url, { method: "POST", headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ p_race_date: raceDate, p_stadium_code: 24, p_race_number: 12 }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("local input RPC failed; response withheld"); }
    return response.json();
  };
  const toggleSql = Array.from({ length: 120 }, (_, i) => `update race_data.day_heads set current_batch_id='${i % 2 ? originalBatch : alternateBatch}' where source_id=(select id from race_data.sources where code='boatraceopenapi-v1') and race_date='${raceDate}'; select pg_sleep(0.003);`).join("\n");
  const toggler = spawn("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
  toggler.stdin.end(toggleSql);
  const results = await Promise.all(Array.from({ length: 120 }, () => readOne()));
  await new Promise((resolve, reject) => { toggler.once("error", reject); toggler.once("exit", code => code === 0 ? resolve() : reject(new Error("batch toggler failed"))); });
  for (const input of results) {
    const batch = input.provenance.batchId;
    if (batch === originalBatch) {
      assert.equal(input.provenance.programComponentId, "a1900000-0000-4000-8000-000000000013");
      assert.equal(input.provenance.previewComponentId, "a1900000-0000-4000-8000-000000000014");
      assert.notEqual(input.programRaw.title, "alternate batch");
      assert.notEqual(input.previewRaw.racers["1"].start_timing, "F.99");
    } else if (batch === alternateBatch) {
      assert.equal(input.provenance.programComponentId, "a1900000-0000-4000-8000-000000000019");
      assert.equal(input.provenance.previewComponentId, "a1900000-0000-4000-8000-000000000020");
      assert.equal(input.programRaw.title, "alternate batch");
      assert.equal(input.previewRaw.racers["1"].start_timing, "F.99");
    } else assert.fail("RPC returned an unexpected batch id");
  }
  console.log("PASS: 120 concurrent RPC reads during 120 day_heads switches returned program, preview, component IDs and batchId from one consistent batch");
  console.log("INFO: local synthetic fixture only; no generation job/provider call; cleanup restores original day_head and removes all fixture rows");
} finally {
  if (seeded) cleanup();
}
