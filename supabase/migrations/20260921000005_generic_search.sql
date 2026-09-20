-- v0.1.11: bounded, read-only search over the currently published race data.
-- This is an administrative/service-role RPC. It is deliberately not exposed to
-- browser roles; Gemini integration is a later phase.
create or replace function race_data.search_current_races(
  p_from date default null,
  p_to date default null,
  p_stadium_code smallint default null,
  p_race_number smallint default null,
  p_entry_number smallint default null,
  p_racer_name text default null,
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_from date := coalesce(p_from, date '1900-01-01');
  v_to date := coalesce(p_to, date '9999-12-31');
  v_name text := nullif(lower(regexp_replace(coalesce(p_racer_name, ''), '\s+', '', 'g')), '');
  v_result jsonb;
begin
  if v_from > v_to then
    return jsonb_build_object(
      'data', '[]'::jsonb,
      'aggregates', jsonb_build_object(),
      'coverage', jsonb_build_object('matched_races', 0, 'truncated', false),
      'warnings', jsonb_build_array('invalid_date_range')
    );
  end if;

  with current_races as (
    select r.id as race_id, r.race_date, r.stadium_code, r.race_number,
           dh.current_batch_id as batch_id, dh.last_success_at,
           sr.program_projection_id, sr.preview_projection_id, sr.result_projection_id,
           sr.program_presence, sr.preview_presence, sr.result_presence,
           row_number() over (order by r.race_date desc, r.stadium_code, r.race_number) as rn
      from race_data.day_heads dh
      -- The v0.1.11 ingest writer marks an atomically accepted head as
      -- `ready`; `published` is retained for a future explicit publication
      -- phase. Both are safe because the day_heads pointer is authoritative.
      join race_data.normalization_batches b on b.id = dh.current_batch_id and b.state in ('ready','published')
      join race_data.snapshot_races sr on sr.batch_id = b.id
      join race_data.races r on r.id = sr.race_id
     where r.race_date between v_from and v_to
       and (p_stadium_code is null or r.stadium_code = p_stadium_code)
       and (p_race_number is null or r.race_number = p_race_number)
       and (p_entry_number is null or exists (
          select 1 from race_data.race_entries e
           where e.projection_id = sr.program_projection_id and e.entry_number = p_entry_number
       ))
       and (v_name is null or exists (
          select 1 from race_data.race_entries e
           where e.projection_id = sr.program_projection_id
             and coalesce(e.name_search, lower(regexp_replace(coalesce(e.name, ''), '\s+', '', 'g'))) ilike '%' || v_name || '%'
       ))
  ), limited as (
    select * from current_races where rn <= v_limit
  ), rows_json as (
    select l.race_id, l.race_date, l.stadium_code, l.race_number, l.batch_id,
           l.last_success_at, l.program_presence, l.preview_presence, l.result_presence,
           coalesce((select jsonb_agg(jsonb_build_object(
             'entry_number', e.entry_number, 'racer_registration_number', e.racer_registration_number,
             'name', e.name, 'rank_code', e.rank_code, 'age_at_race', e.age_at_race,
             'average_st', e.average_st, 'national_win_rate', e.national_win_rate,
             'national_top2_percent', e.national_top2_percent, 'national_top3_percent', e.national_top3_percent,
             'local_win_rate', e.local_win_rate, 'local_top2_percent', e.local_top2_percent,
             'local_top3_percent', e.local_top3_percent, 'motor_number', e.motor_number,
             'motor_top2_percent', e.motor_top2_percent, 'motor_top3_percent', e.motor_top3_percent,
             'hull_number', e.hull_number, 'hull_top2_percent', e.hull_top2_percent,
             'hull_top3_percent', e.hull_top3_percent
           ) order by e.entry_number) from race_data.race_entries e where e.projection_id = l.program_projection_id), '[]'::jsonb) as entries,
           coalesce((select jsonb_agg(jsonb_build_object(
             'entry_number', pe.entry_number, 'course', pe.exhibition_course,
             'start_timing', pe.exhibition_st, 'time', pe.exhibition_time_s, 'tilt', pe.tilt
           ) order by pe.entry_number) from race_data.preview_entries pe where pe.projection_id = l.preview_projection_id), '[]'::jsonb) as preview_entries,
           coalesce((select jsonb_agg(jsonb_build_object(
             'entry_number', re.entry_number, 'name', re.name, 'actual_course', re.actual_course,
             'actual_st', re.actual_st, 'place_code', re.place_code, 'finish_position', re.finish_position
           ) order by re.entry_number) from race_data.result_entries re where re.projection_id = l.result_projection_id), '[]'::jsonb) as result_entries,
           coalesce((select jsonb_agg(jsonb_build_object(
             'bet_type', p.bet_type, 'item_index', p.item_index, 'combination_entries', p.combination_entries,
             'amount_yen', p.amount_yen, 'label', p.label, 'payout_kind', p.payout_kind
           ) order by p.bet_type, p.item_index) from race_data.payouts p where p.projection_id = l.result_projection_id), '[]'::jsonb) as payouts
      from limited l
  ), payout_max as (
    select max(p.amount_yen) as amount_yen
      from race_data.payouts p join current_races l on l.result_projection_id = p.projection_id
     where p.payout_kind = 'normal' and p.amount_yen is not null
  ), payout_winners as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'race_date', l.race_date, 'stadium_code', l.stadium_code, 'race_number', l.race_number,
      'bet_type', p.bet_type, 'combination_entries', p.combination_entries,
      'amount_yen', p.amount_yen, 'label', p.label
    ) order by l.race_date, l.stadium_code, l.race_number, p.bet_type, p.item_index), '[]'::jsonb) as winners
      from race_data.payouts p
      join current_races l on l.result_projection_id = p.projection_id
      cross join payout_max m
     where p.payout_kind = 'normal' and p.amount_yen = m.amount_yen
  ), entry_age_min as (
    select min(e.age_at_race) as age_at_race
      from race_data.race_entries e
      join current_races l on l.program_projection_id = e.projection_id
     where e.age_at_race is not null
  ), youngest_entries as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'race_date', l.race_date, 'stadium_code', l.stadium_code, 'race_number', l.race_number,
      'entry_number', e.entry_number, 'racer_registration_number', e.racer_registration_number,
      'name', e.name, 'age_at_race', e.age_at_race
    ) order by l.race_date, l.stadium_code, l.race_number, e.entry_number), '[]'::jsonb) as entries
      from race_data.race_entries e
      join current_races l on l.program_projection_id = e.projection_id
      cross join entry_age_min m
     where e.age_at_race = m.age_at_race
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(jsonb_build_object(
      'race_id', r.race_id, 'race_date', r.race_date, 'stadium_code', r.stadium_code,
      'race_number', r.race_number, 'batch_id', r.batch_id, 'last_success_at', r.last_success_at,
      'presence', jsonb_build_object('program', r.program_presence, 'preview', r.preview_presence, 'result', r.result_presence),
      'entries', r.entries, 'preview_entries', r.preview_entries, 'result_entries', r.result_entries, 'payouts', r.payouts
    ) order by r.race_date desc, r.stadium_code, r.race_number) from rows_json r), '[]'::jsonb),
    'aggregates', jsonb_build_object(
      'matched_races', (select count(*) from current_races),
      'returned_races', (select count(*) from limited),
      'max_normal_payout_yen', (select amount_yen from payout_max),
      'max_normal_payout_rows', (select winners from payout_winners),
      'min_entry_age', (select age_at_race from entry_age_min),
      'youngest_entries', (select entries from youngest_entries),
      'races_with_completed_result', (select count(*) from current_races l where exists (
        select 1 from race_data.result_entries re
         where re.projection_id = l.result_projection_id and re.finish_position is not null
      ))
    ),
    'coverage', jsonb_build_object(
      'from', case when p_from is null then null else p_from::text end,
      'to', case when p_to is null then null else p_to::text end,
      'source', 'boatraceopenapi-v1',
      'published_only', true,
      'truncated', (select count(*) > v_limit from current_races)
    ),
    'warnings', case when (select count(*) from limited) = 0 then jsonb_build_array('no_match') else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function race_data.search_current_races(date,date,smallint,smallint,smallint,text,integer) from public, anon, authenticated;
grant execute on function race_data.search_current_races(date,date,smallint,smallint,smallint,text,integer) to service_role;

create or replace function public.race_data_search_current_races(
  p_from date default null, p_to date default null, p_stadium_code smallint default null,
  p_race_number smallint default null, p_entry_number smallint default null,
  p_racer_name text default null, p_limit integer default 100
) returns jsonb
language sql security definer
set search_path = public, race_data, extensions, pg_catalog
as $$
  select race_data.search_current_races($1,$2,$3,$4,$5,$6,$7);
$$;

revoke all on function public.race_data_search_current_races(date,date,smallint,smallint,smallint,text,integer) from public, anon, authenticated;
grant execute on function public.race_data_search_current_races(date,date,smallint,smallint,smallint,text,integer) to service_role;
