import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260921000005_generic_search.sql', import.meta.url), 'utf8');

test('generic search is bounded, read-only and uses current published heads', () => {
  assert.match(sql, /create or replace function race_data\.search_current_races/);
  assert.match(sql, /b\.state in \('ready','published'\)/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\)/);
  assert.match(sql, /p_from date/);
  assert.match(sql, /p_stadium_code smallint/);
  assert.match(sql, /p_race_number smallint/);
  assert.match(sql, /p_entry_number smallint/);
  assert.match(sql, /p_racer_name text/);
  assert.match(sql, /max_normal_payout_yen/);
  assert.match(sql, /revoke all on function race_data\.search_current_races/);
  assert.match(sql, /grant execute on function race_data\.search_current_races.*service_role/s);
  assert.match(sql, /public\.race_data_search_current_races/);
});
