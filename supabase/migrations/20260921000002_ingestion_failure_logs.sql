-- Record failed HTTP/normalization attempts without making failure logging
-- part of the snapshot publication transaction.
create or replace function race_data.record_ingestion_failure(
  p_task_id uuid,
  p_source_code text,
  p_race_date date,
  p_request_started_at timestamptz,
  p_http_status integer default null,
  p_elapsed_ms integer default null,
  p_bytes integer default null,
  p_etag text default null,
  p_last_modified text default null,
  p_status text default 'failed',
  p_error_code text default null,
  p_error_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_source_id uuid;
  v_id uuid;
begin
  if p_status not in ('failed', 'warning', 'not_modified') then raise exception 'invalid_ingestion_status'; end if;
  select id into v_source_id from race_data.sources where code = p_source_code;
  if v_source_id is null then raise exception 'source_unknown'; end if;
  insert into race_data.ingestion_runs(
    task_id, source_id, race_date, request_started_at, fetched_at,
    http_status, elapsed_ms, bytes, etag, last_modified, status,
    error_code, error_detail, stage
  ) values (
    p_task_id, v_source_id, p_race_date, coalesce(p_request_started_at, now()), now(),
    p_http_status, p_elapsed_ms, p_bytes, p_etag, p_last_modified, p_status,
    p_error_code, coalesce(p_error_detail, '{}'::jsonb), 'fetch'
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function race_data.record_ingestion_failure(uuid,text,date,timestamptz,integer,integer,integer,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function race_data.record_ingestion_failure(uuid,text,date,timestamptz,integer,integer,integer,text,text,text,text,jsonb) to service_role;

create or replace function public.race_data_record_ingestion_failure(
  p_task_id uuid,
  p_source_code text,
  p_race_date date,
  p_request_started_at timestamptz,
  p_http_status integer default null,
  p_elapsed_ms integer default null,
  p_bytes integer default null,
  p_etag text default null,
  p_last_modified text default null,
  p_status text default 'failed',
  p_error_code text default null,
  p_error_detail jsonb default '{}'::jsonb
) returns uuid
language sql
security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select race_data.record_ingestion_failure($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;

revoke all on function public.race_data_record_ingestion_failure(uuid,text,date,timestamptz,integer,integer,integer,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.race_data_record_ingestion_failure(uuid,text,date,timestamptz,integer,integer,integer,text,text,text,text,jsonb) to service_role;
