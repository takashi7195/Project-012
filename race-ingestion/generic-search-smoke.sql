-- Read-only smoke checks for the published generic search RPC.
with all_rows as (
  select public.race_data_search_current_races(null::date, null::date, null::smallint, null::smallint, null::smallint, null::text, 5) as payload
), filtered as (
  select public.race_data_search_current_races(null::date, null::date, null::smallint, 1::smallint, 1::smallint, null::text, 5) as payload
), invalid as (
  select public.race_data_search_current_races('2026-09-21'::date, '2026-09-20'::date, null::smallint, null::smallint, null::smallint, null::text, 5) as payload
)
select jsonb_build_object(
  'all_rows', (select payload->'aggregates' from all_rows),
  'all_data_count', (select jsonb_array_length(payload->'data') from all_rows),
  'filtered_data_count', (select jsonb_array_length(payload->'data') from filtered),
  'invalid_warnings', (select payload->'warnings' from invalid),
  'all_has_coverage', ((select payload ? 'coverage' from all_rows))
) as smoke;
