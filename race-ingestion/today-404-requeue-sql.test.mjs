import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260924010000_race_data_today_404_requeue_v0_1_16.sql", import.meta.url), "utf8");

test("today fetch_404 quarantine is the only quarantine requeue path", () => {
  assert.match(sql, /race_data\.sync_tasks\.state = 'quarantined'/);
  assert.match(sql, /race_data\.sync_tasks\.last_error_code = 'fetch_404'/);
  assert.match(sql, /race_data\.sync_tasks\.race_date = v_today/);
  assert.match(sql, /now\(\) at time zone 'Asia\/Tokyo'/);
  assert.doesNotMatch(sql, /state = 'quarantined' then 'queued'/);
});
