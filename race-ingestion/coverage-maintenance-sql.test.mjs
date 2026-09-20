import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260921000011_coverage_maintenance.sql', import.meta.url), 'utf8');

test('coverage table is maintained from snapshot races and backfilled', () => {
  assert.match(sql, /refresh_coverage_for_snapshot_race/);
  assert.match(sql, /create trigger snapshot_races_coverage_trigger/);
  assert.match(sql, /program_count/);
  assert.match(sql, /preview_count/);
  assert.match(sql, /result_count/);
  assert.match(sql, /unknown_count/);
  assert.match(sql, /select sr\.batch_id,'all',0/);
  assert.match(sql, /grant execute on function race_data\.refresh_coverage_for_snapshot_race\(\) to service_role/);
});
