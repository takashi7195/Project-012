-- Preserve the already-applied ingest RPC wrappers and repair kind-specific references.
-- A new parser version creates an immutable normalization batch during re-ingest.

create or replace function race_data.ingest_snapshot_legacy_v0_1_14(
  p_source_code text,
  p_race_date date,
  p_body_hash text,
  p_snapshot jsonb,
  p_fetched_at timestamptz,
  p_parser_version text,
  p_rules_version text,
  p_publish boolean
) returns table (out_run_id uuid, out_snapshot_id uuid, out_batch_id uuid, out_race_count integer)
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_source_id uuid;
  v_snapshot_id uuid;
  v_batch_id uuid;
  v_race_id uuid;
  v_program_component uuid;
  v_preview_component uuid;
  v_result_component uuid;
  v_component_id uuid;
  v_program_projection uuid;
  v_preview_projection uuid;
  v_result_projection uuid;
  v_record jsonb;
  v_component jsonb;
  v_entry jsonb;
  v_payout jsonb;
  v_refund jsonb;
  v_index integer;
  v_count integer := 0;
  v_run_id uuid := gen_random_uuid();
begin
  select id into v_source_id from race_data.sources where code = p_source_code and enabled;
  if v_source_id is null then raise exception 'source_disabled_or_unknown'; end if;

  insert into race_data.source_snapshots(source_id, race_date, semantic_hash, hash_version, envelope)
  values (v_source_id, p_race_date, p_body_hash, 'sha256-canonical-v1', p_snapshot - 'records')
  on conflict (source_id, race_date, semantic_hash) do update set envelope = excluded.envelope
  returning id into v_snapshot_id;
  if v_snapshot_id is null then select id into v_snapshot_id from race_data.source_snapshots where source_id = v_source_id and race_date = p_race_date and semantic_hash = p_body_hash; end if;

  insert into race_data.normalization_batches(snapshot_id, parser_version, rules_version, state, quality_summary)
  values (v_snapshot_id, p_parser_version, p_rules_version, 'staging', jsonb_build_object('race_count', p_snapshot->'raceCount'))
  on conflict (snapshot_id, parser_version, rules_version) do update set quality_summary = excluded.quality_summary
  returning id into v_batch_id;
  if v_batch_id is null then select id into v_batch_id from race_data.normalization_batches where snapshot_id = v_snapshot_id and parser_version = p_parser_version and rules_version = p_rules_version; end if;

  insert into race_data.ingestion_runs(id, source_id, race_date, fetched_at, body_hash, snapshot_id, status, stage, counts)
  values (v_run_id, v_source_id, p_race_date, p_fetched_at, p_body_hash, v_snapshot_id, 'running', 'rpc_ingest', jsonb_build_object('race_count', p_snapshot->'raceCount'));

  for v_record in select value from jsonb_array_elements(coalesce(p_snapshot->'records', '[]'::jsonb)) loop
    v_program_component := null;
    v_preview_component := null;
    v_result_component := null;
    v_program_projection := null;
    v_preview_projection := null;
    v_result_projection := null;
    insert into race_data.races(source_id, race_date, stadium_code, race_number)
    values (v_source_id, (v_record->'race'->>'raceDate')::date, (v_record->'race'->>'stadiumCode')::smallint, (v_record->'race'->>'raceNumber')::smallint)
    on conflict (source_id, race_date, stadium_code, race_number) do update set race_date = excluded.race_date
    returning id into v_race_id;
    if v_race_id is null then select id into v_race_id from race_data.races where source_id=v_source_id and race_date=(v_record->'race'->>'raceDate')::date and stadium_code=(v_record->'race'->>'stadiumCode')::smallint and race_number=(v_record->'race'->>'raceNumber')::smallint; end if;

    for v_component in select value from jsonb_array_elements(v_record->'components') loop
      insert into race_data.race_components(race_id, kind, raw_hash, raw_json, presence)
      values (v_race_id, v_component->>'kind', v_component->>'rawHash', v_component->'rawJson', v_component->>'presence')
      on conflict (race_id, kind, raw_hash) do update set raw_json = excluded.raw_json
      returning id into v_component_id;
      if v_component->>'kind' = 'program' then v_program_component := v_component_id; end if;
      if v_component->>'kind' = 'preview' then v_preview_component := v_component_id; end if;
      if v_component->>'kind' = 'result' then v_result_component := v_component_id; end if;
    end loop;

    insert into race_data.component_projections(component_id, parser_version, rules_version)
    values (v_program_component, p_parser_version, p_rules_version)
    on conflict (component_id, parser_version, rules_version) do update set quality_state = excluded.quality_state
    returning id into v_program_projection;
    insert into race_data.component_projections(component_id, parser_version, rules_version)
    values (v_preview_component, p_parser_version, p_rules_version)
    on conflict (component_id, parser_version, rules_version) do update set quality_state = excluded.quality_state
    returning id into v_preview_projection;
    insert into race_data.component_projections(component_id, parser_version, rules_version)
    values (v_result_component, p_parser_version, p_rules_version)
    on conflict (component_id, parser_version, rules_version) do update set quality_state = excluded.quality_state
    returning id into v_result_projection;

    insert into race_data.race_programs(projection_id, closed_at_source, title, subtitle, grade_code, distance_m, day_number)
    values (v_program_projection, v_record->'program'->'common'->>'closedAtSource', v_record->'program'->'common'->>'title', v_record->'program'->'common'->>'subtitle', v_record->'program'->'common'->>'grade', (v_record->'program'->'common'->>'distanceM')::smallint, (v_record->'program'->'common'->>'dayNumber')::smallint)
    on conflict (projection_id) do update set title=excluded.title;
    for v_entry in select value from jsonb_array_elements(coalesce(v_record->'program'->'entries','[]'::jsonb)) loop
      insert into race_data.race_entries(projection_id, entry_number, racer_registration_number, name, rank_code, age_at_race, weight_kg, average_st, national_win_rate, local_win_rate, motor_number, hull_number, raw_json)
      values (v_program_projection, (v_entry->>'entryNumber')::smallint, (v_entry->>'registrationNumber')::integer, v_entry->>'name', v_entry->>'rank', (v_entry->>'age')::smallint, (v_entry->>'weightKg')::numeric, (v_entry->>'averageStartTiming')::numeric, (v_entry->>'nationalWinRate')::numeric, (v_entry->>'localWinRate')::numeric, (v_entry->>'motorNumber')::smallint, (v_entry->>'hullNumber')::smallint, coalesce(v_entry->'raw','{}'::jsonb))
      on conflict (projection_id, entry_number) do update set raw_json=excluded.raw_json;
    end loop;

    insert into race_data.race_previews(projection_id, weather_code, wind_direction_code, wind_speed, wave_height, air_temperature, water_temperature)
    values (v_preview_projection, (v_record->'preview'->'common'->>'weather')::smallint, (v_record->'preview'->'common'->>'windDirection')::smallint, (v_record->'preview'->'common'->>'windSpeed')::numeric, (v_record->'preview'->'common'->>'waveHeight')::numeric, (v_record->'preview'->'common'->>'airTemperature')::numeric, (v_record->'preview'->'common'->>'waterTemperature')::numeric)
    on conflict (projection_id) do update set wind_speed=excluded.wind_speed;
    for v_entry in select value from jsonb_array_elements(coalesce(v_record->'preview'->'entries','[]'::jsonb)) loop
      insert into race_data.preview_entries(projection_id, entry_number, exhibition_course, exhibition_st, weight_kg, weight_adjustment_kg, exhibition_time_s, tilt, propeller, parts, raw_json)
      values (v_preview_projection, (v_entry->>'entryNumber')::smallint, (v_entry->>'course')::smallint, (v_entry->>'startTiming')::numeric, (v_entry->>'weightKg')::numeric, (v_entry->>'weightAdjustmentKg')::numeric, (v_entry->>'exhibitionTime')::numeric, (v_entry->>'tilt')::numeric, v_entry->'propeller', v_entry->'parts', coalesce(v_entry->'raw','{}'::jsonb))
      on conflict (projection_id, entry_number) do update set raw_json=excluded.raw_json;
    end loop;

    insert into race_data.race_results(projection_id, technique_code, remarks, weather_code, wind_direction_code, wind_speed, wave_height, air_temperature, water_temperature, result_state)
    values (v_result_projection, v_record->'result'->'common'->>'technique', v_record->'result'->'common'->'remarks', (v_record->'result'->'common'->>'weather')::smallint, (v_record->'result'->'common'->>'windDirection')::smallint, (v_record->'result'->'common'->>'windSpeed')::numeric, (v_record->'result'->'common'->>'waveHeight')::numeric, (v_record->'result'->'common'->>'airTemperature')::numeric, (v_record->'result'->'common'->>'waterTemperature')::numeric, case when jsonb_array_length(coalesce(v_record->'result'->'entries','[]'::jsonb)) > 0 then 'available' else 'unknown' end)
    on conflict (projection_id) do update set result_state=excluded.result_state;
    for v_entry in select value from jsonb_array_elements(coalesce(v_record->'result'->'entries','[]'::jsonb)) loop
      insert into race_data.result_entries(projection_id, entry_number, racer_registration_number, name, actual_course, actual_st, place_code, finish_position, raw_json)
      values (v_result_projection, (v_entry->>'entryNumber')::smallint, (v_entry->>'registrationNumber')::integer, v_entry->>'name', (v_entry->>'course')::smallint, (v_entry->>'startTiming')::numeric, v_entry->>'placeCode', case when (v_entry->>'placeNumber')::integer between 1 and 6 then (v_entry->>'placeNumber')::smallint end, coalesce(v_entry->'raw','{}'::jsonb))
      on conflict (projection_id, entry_number) do update set raw_json=excluded.raw_json;
    end loop;
    v_index := 0;
    for v_payout in select value from jsonb_array_elements(coalesce(v_record->'result'->'payouts','[]'::jsonb)) loop
      insert into race_data.payouts(projection_id, bet_type, item_index, combination_source, combination_entries, amount_yen, label, payout_kind, raw_json)
      values (v_result_projection, v_payout->>'betType', v_index, v_payout->>'combination', case when jsonb_typeof(v_payout->'combinationEntries')='array' then array(select jsonb_array_elements_text(v_payout->'combinationEntries'))::smallint[] end, (v_payout->>'amountYen')::bigint, v_payout->>'label', coalesce(v_payout->>'payoutKind','unknown'), coalesce(v_payout->'raw','{}'::jsonb))
      on conflict (projection_id, bet_type, item_index) do update set raw_json=excluded.raw_json;
      v_index := v_index + 1;
    end loop;
    v_index := 0;
    for v_refund in select value from jsonb_array_elements(coalesce(v_record->'result'->'refunds','[]'::jsonb)) loop
      insert into race_data.refunds(projection_id, item_index, entry_number, raw_item) values (v_result_projection, v_index, (v_refund->>'entryNumber')::smallint, v_refund->'raw') on conflict (projection_id,item_index) do update set raw_item=excluded.raw_item;
      v_index := v_index + 1;
    end loop;
    insert into race_data.snapshot_races(batch_id, race_id, program_component_id, preview_component_id, result_component_id, program_projection_id, preview_projection_id, result_projection_id, program_presence, preview_presence, result_presence)
    values (v_batch_id, v_race_id, v_program_component, v_preview_component, v_result_component, v_program_projection, v_preview_projection, v_result_projection, v_record->'program'->>'presence', v_record->'preview'->>'presence', v_record->'result'->>'presence')
    on conflict (batch_id,race_id) do update set
      program_component_id=excluded.program_component_id,
      preview_component_id=excluded.preview_component_id,
      result_component_id=excluded.result_component_id,
      program_projection_id=excluded.program_projection_id,
      preview_projection_id=excluded.preview_projection_id,
      result_projection_id=excluded.result_projection_id,
      program_presence=excluded.program_presence,
      preview_presence=excluded.preview_presence,
      result_presence=excluded.result_presence,
      quality_flags=excluded.quality_flags;
    v_count := v_count + 1;
  end loop;
  if p_publish then
    update race_data.normalization_batches set state='ready', published_at=now() where id=v_batch_id;
    insert into race_data.snapshot_observations(source_id,race_date,snapshot_id,batch_id,run_id,fetched_at,published_at,request_body_hash,outcome) values (v_source_id,p_race_date,v_snapshot_id,v_batch_id,v_run_id,p_fetched_at,now(),p_body_hash,'adopted');
    insert into race_data.day_heads(source_id,race_date,current_batch_id,current_run_id,generation,latest_attempt_at,last_success_at) values(v_source_id,p_race_date,v_batch_id,v_run_id,1,now(),now()) on conflict(source_id,race_date) do update set current_batch_id=excluded.current_batch_id,current_run_id=excluded.current_run_id,generation=race_data.day_heads.generation+1,latest_attempt_at=now(),last_success_at=now();
    update race_data.ingestion_runs set status='succeeded',stage='published',counts=jsonb_build_object('race_count',v_count) where id=v_run_id;
  else
    update race_data.ingestion_runs set status='staged',stage='staged',counts=jsonb_build_object('race_count',v_count) where id=v_run_id;
  end if;
  return query select v_run_id,v_snapshot_id,v_batch_id,v_count;
end;
$$;

-- Keep the internal implementation unavailable to API roles; the existing wrapper remains service_role-only.
revoke all on function race_data.ingest_snapshot_legacy_v0_1_14(text,date,text,jsonb,timestamptz,text,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function race_data.ingest_snapshot(text,date,text,jsonb,timestamptz,text,text,boolean)
  from public, anon, authenticated;
grant execute on function race_data.ingest_snapshot(text,date,text,jsonb,timestamptz,text,text,boolean)
  to service_role;
