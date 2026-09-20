import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260921000008_coverage_report.sql', import.meta.url), 'utf8');

test('coverage report is service-role-only and distinguishes missing heads', () => {
  assert.match(sql, /create or replace function race_data\.coverage_report/);
  assert.match(sql, /generate_series\(v_from, v_to, interval '1 day'\)/);
  assert.match(sql, /'missing_head'/);
  assert.match(sql, /'pending'/);
  assert.match(sql, /'failed'/);
  assert.match(sql, /'untracked'/);
  assert.match(sql, /'result_incomplete'/);
  assert.match(sql, /revoke all on function race_data\.coverage_report\(date,date\)/);
  assert.match(sql, /grant execute on function race_data\.coverage_report\(date,date\) to service_role/);
  assert.match(sql, /public\.race_data_coverage_report/);
});
