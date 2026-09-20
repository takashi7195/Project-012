-- Read the latest HTTP validators for a date without exposing race_data tables.
create or replace function race_data.latest_http_metadata(p_source_code text, p_race_date date)
returns table(etag text, last_modified text)
language sql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
  select r.etag, r.last_modified
    from race_data.ingestion_runs r
    join race_data.sources s on s.id = r.source_id
   where s.code = p_source_code
     and r.race_date = p_race_date
     and (r.etag is not null or r.last_modified is not null)
   order by r.request_started_at desc
   limit 1;
$$;

revoke all on function race_data.latest_http_metadata(text,date) from public, anon, authenticated;
grant execute on function race_data.latest_http_metadata(text,date) to service_role;

create or replace function public.race_data_latest_http_metadata(p_source_code text, p_race_date date)
returns table(etag text, last_modified text)
language sql
security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select * from race_data.latest_http_metadata($1,$2); $$;

revoke all on function public.race_data_latest_http_metadata(text,date) from public, anon, authenticated;
grant execute on function public.race_data_latest_http_metadata(text,date) to service_role;

-- Add HTTP metadata to the run created by the existing atomic snapshot writer.
create or replace function public.race_data_ingest_snapshot_with_metadata(
  p_source_code text, p_race_date date, p_body_hash text, p_snapshot jsonb,
  p_fetched_at timestamptz, p_parser_version text, p_rules_version text, p_publish boolean,
  p_http_status integer default null, p_elapsed_ms integer default null, p_bytes integer default null,
  p_etag text default null, p_last_modified text default null
) returns table(out_run_id uuid, out_snapshot_id uuid, out_batch_id uuid, out_race_count integer)
language plpgsql security definer
set search_path = public, race_data, extensions, pg_catalog
as $$
declare
  v_result record;
begin
  select * into v_result from race_data.ingest_snapshot(
    p_source_code, p_race_date, p_body_hash, p_snapshot, p_fetched_at,
    p_parser_version, p_rules_version, p_publish
  );
  update race_data.ingestion_runs
     set http_status = coalesce(p_http_status, http_status),
         elapsed_ms = coalesce(p_elapsed_ms, elapsed_ms),
         bytes = coalesce(p_bytes, bytes),
         etag = coalesce(p_etag, etag),
         last_modified = coalesce(p_last_modified, last_modified)
   where id = v_result.out_run_id;
  return query select v_result.out_run_id, v_result.out_snapshot_id, v_result.out_batch_id, v_result.out_race_count;
end;
$$;

revoke all on function public.race_data_ingest_snapshot_with_metadata(text,date,text,jsonb,timestamptz,text,text,boolean,integer,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.race_data_ingest_snapshot_with_metadata(text,date,text,jsonb,timestamptz,text,text,boolean,integer,integer,integer,text,text) to service_role;
