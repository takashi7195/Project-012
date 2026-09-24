-- v0.1.16: requeue only today's fetch_404 quarantine while the upstream feed may still publish.
-- Other quarantine causes and historical dates remain untouched.

create or replace function race_data.enqueue_date_tasks(
  p_source_code text,
  p_from date,
  p_through date,
  p_reason text default 'backfill',
  p_priority integer default 0
) returns integer
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_source_id uuid;
  v_date date;
  v_count integer := 0;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'invalid_date_range';
  end if;
  select id into v_source_id from race_data.sources where code = p_source_code and enabled;
  if v_source_id is null then raise exception 'source_disabled_or_unknown'; end if;

  v_date := p_from;
  while v_date <= p_through loop
    insert into race_data.sync_tasks(source_id, race_date, reason, priority, state, next_attempt_at)
    values (v_source_id, v_date, p_reason, p_priority::smallint, 'queued', now())
    on conflict (source_id, race_date) do update
      set reason = coalesce(excluded.reason, race_data.sync_tasks.reason),
          priority = greatest(race_data.sync_tasks.priority, excluded.priority),
          state = case
            when excluded.reason in ('today', 'yesterday') and race_data.sync_tasks.state = 'succeeded' then 'queued'
            when excluded.reason = 'today'
              and race_data.sync_tasks.race_date = v_today
              and race_data.sync_tasks.state = 'quarantined'
              and race_data.sync_tasks.last_error_code = 'fetch_404' then 'queued'
            else race_data.sync_tasks.state
          end,
          next_attempt_at = case
            when excluded.reason in ('today', 'yesterday') and race_data.sync_tasks.state = 'succeeded' then excluded.next_attempt_at
            when excluded.reason = 'today'
              and race_data.sync_tasks.race_date = v_today
              and race_data.sync_tasks.state = 'quarantined'
              and race_data.sync_tasks.last_error_code = 'fetch_404' then excluded.next_attempt_at
            when race_data.sync_tasks.state in ('queued', 'retry', 'disabled') then least(race_data.sync_tasks.next_attempt_at, excluded.next_attempt_at)
            else race_data.sync_tasks.next_attempt_at
          end,
          lease_token = case
            when excluded.reason = 'today'
              and race_data.sync_tasks.race_date = v_today
              and race_data.sync_tasks.state = 'quarantined'
              and race_data.sync_tasks.last_error_code = 'fetch_404' then null
            else race_data.sync_tasks.lease_token
          end,
          lease_until = case
            when excluded.reason = 'today'
              and race_data.sync_tasks.race_date = v_today
              and race_data.sync_tasks.state = 'quarantined'
              and race_data.sync_tasks.last_error_code = 'fetch_404' then null
            else race_data.sync_tasks.lease_until
          end,
          updated_at = now();
    v_count := v_count + 1;
    v_date := v_date + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function race_data.enqueue_date_tasks(text,date,date,text,integer) from public, anon, authenticated;
grant execute on function race_data.enqueue_date_tasks(text,date,date,text,integer) to service_role;

create or replace function public.race_data_enqueue_date_tasks(
  p_source_code text, p_from date, p_through date, p_reason text default 'backfill', p_priority integer default 0
) returns integer
language sql security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select race_data.enqueue_date_tasks($1, $2, $3, $4, $5); $$;

revoke all on function public.race_data_enqueue_date_tasks(text,date,date,text,integer) from public, anon, authenticated;
grant execute on function public.race_data_enqueue_date_tasks(text,date,date,text,integer) to service_role;
