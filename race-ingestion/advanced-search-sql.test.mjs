import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260921000006_advanced_search.sql', import.meta.url), 'utf8');

test('advanced search exposes bounded typed filters without changing the original RPC', () => {
  assert.match(sql, /create or replace function race_data\.search_current_races_filtered/);
  for (const field of ['p_racer_registration integer','p_rank_code text','p_min_age smallint','p_max_age smallint','p_bet_type text','p_min_amount_yen bigint','p_max_amount_yen bigint']) {
    assert.match(sql, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\)/);
  assert.match(sql, /b\.state in \('ready','published'\)/);
  assert.match(sql, /grant execute on function race_data\.search_current_races_filtered.*service_role/s);
  assert.match(sql, /public\.race_data_search_current_races_filtered/);
});
