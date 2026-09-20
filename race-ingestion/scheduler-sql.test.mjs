import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20260921000000_race_data_scheduler.sql", import.meta.url), "utf8");

test("scheduler migration exposes bounded queue operations", () => {
  assert.match(sql, /create or replace function race_data\.enqueue_date_tasks/);
  assert.match(sql, /create or replace function race_data\.claim_next_task/);
  assert.match(sql, /create or replace function race_data\.finish_task/);
  assert.match(sql, /for update of t skip locked/);
  assert.match(sql, /expired\.lease_until is not null/);
});

test("scheduler migration denies browser roles and grants only service_role", () => {
  assert.equal((sql.match(/revoke all on function/g) ?? []).length, 7);
  assert.equal((sql.match(/grant execute on function/g) ?? []).length, 7);
  assert.doesNotMatch(sql, /grant execute on function race_data\.(enqueue_date_tasks|claim_next_task|finish_task).*anon/);
});
