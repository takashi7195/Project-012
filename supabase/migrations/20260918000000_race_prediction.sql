begin;

create table if not exists public.race_data_cache (
  cache_key text primary key check (cache_key ~ '^[0-9]{8}:[0-9]{2}:[0-9]{1,2}$'),
  race_date date not null,
  stadium_code smallint not null check (stadium_code between 1 and 24),
  race_number smallint not null check (race_number between 1 and 12),
  payload jsonb not null,
  source_hash text not null,
  information_status text not null check (information_status in ('ready_preview', 'ready_entry')),
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists race_data_cache_lookup_idx
  on public.race_data_cache (race_date, stadium_code, race_number);

create table if not exists public.race_fetch_state (
  fetch_date date primary key,
  locked_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  fetch_count integer not null default 0 check (fetch_count >= 0),
  response_bytes integer not null default 0 check (response_bytes >= 0)
);

alter table public.race_data_cache enable row level security;
alter table public.race_fetch_state enable row level security;
revoke all on public.race_data_cache from public, anon, authenticated;
revoke all on public.race_fetch_state from public, anon, authenticated;
grant all on public.race_data_cache to service_role;
grant all on public.race_fetch_state to service_role;

create or replace function public.claim_race_fetch(p_fetch_date date, p_min_interval_seconds integer default 180)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.race_fetch_state (fetch_date, locked_until, last_attempt_at, fetch_count)
  values (p_fetch_date, pg_catalog.now() + interval '30 seconds', pg_catalog.now(), 1)
  on conflict (fetch_date) do update
    set locked_until = pg_catalog.now() + interval '30 seconds',
        last_attempt_at = pg_catalog.now(),
        fetch_count = public.race_fetch_state.fetch_count + 1
    where (public.race_fetch_state.locked_until is null or public.race_fetch_state.locked_until < pg_catalog.now())
      and (public.race_fetch_state.last_success_at is null or public.race_fetch_state.last_success_at <= pg_catalog.now() - make_interval(secs => greatest(p_min_interval_seconds, 1)));
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_race_fetch(date, integer) from public, anon, authenticated;
grant execute on function public.claim_race_fetch(date, integer) to service_role;

create or replace function public.finish_race_fetch(p_fetch_date date, p_success boolean, p_error_code text default null, p_response_bytes integer default 0)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.race_fetch_state
  set locked_until = null,
      last_success_at = case when p_success then pg_catalog.now() else last_success_at end,
      last_error_code = case when p_success then null else left(p_error_code, 80) end,
      response_bytes = greatest(coalesce(p_response_bytes, 0), 0)
  where fetch_date = p_fetch_date;
$$;

revoke all on function public.finish_race_fetch(date, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.finish_race_fetch(date, boolean, text, integer) to service_role;

commit;
