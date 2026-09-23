-- Normalize BOAT RACE local closing timestamps without changing migration history.
-- The source API value is a Japan-local wall clock: YYYY-MM-DD HH:MM:SS.

create or replace function race_data.parse_closed_at_source(p_source text)
returns timestamptz
language plpgsql immutable
set search_path = race_data, pg_catalog
as $$
begin
  if p_source is null or p_source !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' then
    return null;
  end if;
  begin
    return (p_source::timestamp without time zone at time zone 'Asia/Tokyo');
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function race_data.parse_closed_at_source(text) from public, anon, authenticated;
grant execute on function race_data.parse_closed_at_source(text) to service_role;

-- Backfill only missing typed values. Existing typed values are authoritative.
update race_data.race_programs
   set closed_at = race_data.parse_closed_at_source(closed_at_source)
 where closed_at is null
   and race_data.parse_closed_at_source(closed_at_source) is not null;

-- Keep the already-applied ingest implementation intact and wrap it so both
-- source text and typed JST value are updated on insert and conflict updates.
alter function race_data.ingest_snapshot(text,date,text,jsonb,timestamptz,text,text,boolean)
  rename to ingest_snapshot_legacy_v0_1_14;

create or replace function race_data.ingest_snapshot(
  p_source_code text,
  p_race_date date,
  p_body_hash text,
  p_snapshot jsonb,
  p_fetched_at timestamptz,
  p_parser_version text,
  p_rules_version text,
  p_publish boolean
) returns table (out_run_id uuid, out_snapshot_id uuid, out_batch_id uuid, out_race_count integer)
language plpgsql security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_result record;
begin
  select * into v_result from race_data.ingest_snapshot_legacy_v0_1_14(
    p_source_code, p_race_date, p_body_hash, p_snapshot, p_fetched_at,
    p_parser_version, p_rules_version, p_publish
  );

  update race_data.race_programs rp
     set closed_at_source = rec.record->'program'->'common'->>'closedAtSource',
         closed_at = race_data.parse_closed_at_source(rec.record->'program'->'common'->>'closedAtSource')
    from jsonb_array_elements(coalesce(p_snapshot->'records', '[]'::jsonb)) rec(record)
    join race_data.races r
      on r.source_id = (select id from race_data.sources where code = p_source_code)
     and r.race_date = (rec.record->'race'->>'raceDate')::date
     and r.stadium_code = (rec.record->'race'->>'stadiumCode')::smallint
     and r.race_number = (rec.record->'race'->>'raceNumber')::smallint
    join race_data.snapshot_races sr
      on sr.batch_id = v_result.out_batch_id and sr.race_id = r.id
   where rp.projection_id = sr.program_projection_id;

  return query select v_result.out_run_id, v_result.out_snapshot_id,
                       v_result.out_batch_id, v_result.out_race_count;
end;
$$;

revoke all on function race_data.ingest_snapshot_legacy_v0_1_14(text,date,text,jsonb,timestamptz,text,text,boolean) from public, anon, authenticated, service_role;
revoke all on function race_data.ingest_snapshot(text,date,text,jsonb,timestamptz,text,text,boolean) from public, anon, authenticated;
grant execute on function race_data.ingest_snapshot(text,date,text,jsonb,timestamptz,text,text,boolean) to service_role;
