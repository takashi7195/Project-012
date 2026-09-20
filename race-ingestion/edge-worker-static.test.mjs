import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const edge = async (name) => readFile(new URL(`supabase/functions/race-ingest/${name}`, root), "utf8");
const source = async (name) => readFile(new URL(`race-ingestion/${name}`, root), "utf8");

test("edge worker is authenticated and bound to the known API host", async () => {
  const index = await edge("index.ts");
  assert.match(index, /RACE_INGEST_WORKER_TOKEN/);
  assert.match(index, /return json\(\{ error: "unauthorized" \}, 401\)/);
  assert.match(index, /https:\/\/boatraceopenapi\.github\.io\/api\/v1/);
  assert.match(index, /16 \* 1024 \* 1024/);
  assert.match(index, /Deno\.serve/);
  assert.match(index, /race_data_enqueue_date_tasks/);
  assert.match(index, /race_data_disable_tasks_before/);
  assert.match(index, /race_data_record_ingestion_failure/);
  assert.match(index, /race_data_latest_http_metadata/);
  assert.match(index, /if-none-match/);
  assert.match(index, /race_data_ingest_snapshot_with_metadata/);
  assert.match(index, /rollingStart/);
  assert.match(index, /race_data_claim_next_task/);
  assert.match(index, /race_data_ingest_snapshot/);
  assert.match(index, /race_data_finish_task/);
  assert.match(index, /mode === "yesterday"/);
  assert.match(index, /mode === "backfill"/);
});

test("edge worker copies the tested normalizer and worker core", async () => {
  for (const name of ["normalize.mjs", "records.mjs", "scheduler.mjs", "worker.mjs"]) {
    assert.equal(await edge(name), await source(name), `${name} drifted from the tested core`);
  }
});
