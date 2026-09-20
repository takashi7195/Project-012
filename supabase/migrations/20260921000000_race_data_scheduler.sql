-- v0.1.11: guarded date queue and lease operations for race-data ingestion.
-- This migration does not start a schedule by itself.

create or replace function race_data.enqueue_date_tasks(
  p_source_code text,
  p_from date,
  p_through date,
  p_reason text default 'backfill',
  p_priority smallint default 0
) returns integer
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_source_id uuid;
  v_date date;
  v_count integer := 0;
begin
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'invalid_date_range';
  end if;
  select id into v_source_id from race_data.sources where code = p_source_code and enabled;
  if v_source_id is null then raise exception 'source_disabled_or_unknown'; end if;

  v_date := p_from;
  while v_date <= p_through loop
    insert into race_data.sync_tasks(source_id, race_date, reason, priority, state, next_attempt_at)
    values (v_source_id, v_date, p_reason, p_priority, 'queued', now())
    on conflict (source_id, race_date) do update
      set reason = coalesce(excluded.reason, race_data.sync_tasks.reason),
          priority = greatest(race_data.sync_tasks.priority, excluded.priority),
          next_attempt_at = case
            when race_data.sync_tasks.state in ('queued', 'retry', 'disabled') then least(race_data.sync_tasks.next_attempt_at, excluded.next_attempt_at)
            else race_data.sync_tasks.next_attempt_at
          end,
          updated_at = now();
    v_count := v_count + 1;
    v_date := v_date + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function race_data.claim_next_task(
  p_worker_id text,
  p_lease_seconds integer default 90
) returns table(
  task_id uuid,
  source_code text,
  base_url text,
  race_date date,
  reason text,
  priority smallint,
  attempt_count integer,
  lease_token uuid,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
begin
  if nullif(trim(coalesce(p_worker_id, '')), '') is null then raise exception 'worker_id_required'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'invalid_lease_seconds'; end if;

  update race_data.sync_tasks as expired
     set state = 'retry', lease_until = null, lease_token = null, next_attempt_at = now(), updated_at = now()
   where expired.state in ('leased', 'running')
     and expired.lease_until is not null
     and expired.lease_until < now();

  return query
  with candidate as (
    select t.id
      from race_data.sync_tasks t
      join race_data.sources s on s.id = t.source_id and s.enabled
     where t.state in ('queued', 'retry')
       and t.next_attempt_at <= now()
     order by t.priority desc, t.race_date asc
     for update of t skip locked
     limit 1
  ), updated as (
    update race_data.sync_tasks t
       set state = 'leased', attempt_count = t.attempt_count + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(), updated_at = now()
      from candidate c
     where t.id = c.id
     returning t.*
  )
  select u.id, s.code, s.base_url, u.race_date, u.reason, u.priority,
         u.attempt_count, u.lease_token, u.lease_until
    from updated u
    join race_data.sources s on s.id = u.source_id;
end;
$$;

create or replace function race_data.finish_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_state text,
  p_next_attempt_at timestamptz default null,
  p_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_updated integer;
begin
  if p_state not in ('queued', 'retry', 'succeeded', 'quarantined', 'disabled') then raise exception 'invalid_task_state'; end if;
  update race_data.sync_tasks
     set state = p_state,
         next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
         last_error_code = p_error_code,
         lease_until = null,
         lease_token = null,
         updated_at = now()
   where id = p_task_id and lease_token = p_lease_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function race_data.enqueue_date_tasks(text,date,date,text,smallint) from public, anon, authenticated;
revoke all on function race_data.claim_next_task(text,integer) from public, anon, authenticated;
revoke all on function race_data.finish_task(uuid,uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function race_data.enqueue_date_tasks(text,date,date,text,smallint) to service_role;
grant execute on function race_data.claim_next_task(text,integer) to service_role;
grant execute on function race_data.finish_task(uuid,uuid,text,timestamptz,text) to service_role;
