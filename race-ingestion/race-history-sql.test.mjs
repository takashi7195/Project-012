import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260921000009_race_history.sql', import.meta.url), 'utf8');

test('race history lookup is bounded and service-role-only', () => {
  assert.match(sql, /create or replace function race_data\.list_race_versions/);
  assert.match(sql, /row_number\(\) over \(order by b\.created_at desc\)/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(sql, /semantic_hash/);
  assert.match(sql, /projection_ids/);
  assert.match(sql, /run_error_code/);
  assert.match(sql, /grant execute on function race_data\.list_race_versions\(date,smallint,smallint,integer\) to service_role/);
  assert.match(sql, /public\.race_data_list_race_versions/);
});
