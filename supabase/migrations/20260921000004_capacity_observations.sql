create table if not exists race_data.capacity_observations (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  database_size_bytes bigint not null,
  race_data_bytes bigint not null,
  race_count bigint not null,
  snapshot_count bigint not null,
  ingestion_run_count bigint not null
);

create index if not exists capacity_observations_time_idx
  on race_data.capacity_observations (observed_at desc);

revoke all on race_data.capacity_observations from public, anon, authenticated, service_role;

create or replace function race_data.capture_capacity_observation()
returns uuid
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_id uuid;
  v_race_bytes bigint;
begin
  select coalesce(sum(pg_total_relation_size(relid)), 0)::bigint into v_race_bytes
    from pg_catalog.pg_statio_user_tables
   where schemaname = 'race_data';
  insert into race_data.capacity_observations(
    database_size_bytes, race_data_bytes, race_count, snapshot_count, ingestion_run_count
  ) values (
    pg_database_size(current_database()),
    v_race_bytes,
    (select count(*) from race_data.races),
    (select count(*) from race_data.source_snapshots),
    (select count(*) from race_data.ingestion_runs)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function race_data.capture_capacity_observation() from public, anon, authenticated;
grant execute on function race_data.capture_capacity_observation() to service_role;

create or replace function public.race_data_capture_capacity_observation()
returns uuid
language sql security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select race_data.capture_capacity_observation(); $$;

revoke all on function public.race_data_capture_capacity_observation() from public, anon, authenticated;
grant execute on function public.race_data_capture_capacity_observation() to service_role;
