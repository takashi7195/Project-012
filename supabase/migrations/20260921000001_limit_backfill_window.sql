-- Keep the historical ingestion queue within the rolling 30-day retention window.
create or replace function race_data.disable_tasks_before(p_cutoff date)
returns integer
language plpgsql
security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_count integer;
begin
  if p_cutoff is null then raise exception 'cutoff_required'; end if;
  update race_data.sync_tasks
     set state = 'disabled', lease_until = null, lease_token = null, updated_at = now()
   where race_date < p_cutoff
     and state in ('queued', 'retry', 'disabled');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function race_data.disable_tasks_before(date) from public, anon, authenticated;
grant execute on function race_data.disable_tasks_before(date) to service_role;

create or replace function public.race_data_disable_tasks_before(p_cutoff date)
returns integer
language sql
security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select race_data.disable_tasks_before($1); $$;

revoke all on function public.race_data_disable_tasks_before(date) from public, anon, authenticated;
grant execute on function public.race_data_disable_tasks_before(date) to service_role;
