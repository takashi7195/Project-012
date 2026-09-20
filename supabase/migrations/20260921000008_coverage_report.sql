-- Administrative coverage report for the rolling ingestion window.
create or replace function race_data.coverage_report(
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_from date := coalesce(p_from, current_date - 29);
  v_to date := coalesce(p_to, current_date);
begin
  if v_from > v_to then
    return jsonb_build_object('data','[]'::jsonb,'summary',jsonb_build_object(),
      'warnings',jsonb_build_array('invalid_date_range'));
  end if;
  return (
    with dates as (
      select gs::date as race_date from generate_series(v_from, v_to, interval '1 day') gs
    ), rows as (
      select d.race_date, s.code source_code,
             t.state task_state, coalesce(t.attempt_count,0) attempt_count,
             t.next_attempt_at, t.last_error_code,
             dh.current_batch_id, b.state batch_state, dh.last_success_at,
             coalesce((select count(*) from race_data.snapshot_races sr where sr.batch_id=dh.current_batch_id),0) race_count,
             coalesce((select count(*) from race_data.snapshot_races sr where sr.batch_id=dh.current_batch_id and sr.program_projection_id is not null),0) program_count,
             coalesce((select count(*) from race_data.snapshot_races sr where sr.batch_id=dh.current_batch_id and sr.preview_projection_id is not null),0) preview_count,
             coalesce((select count(*) from race_data.snapshot_races sr where sr.batch_id=dh.current_batch_id and sr.result_projection_id is not null),0) result_count
        from dates d
        cross join race_data.sources s
        left join race_data.sync_tasks t on t.source_id=s.id and t.race_date=d.race_date
        left join race_data.day_heads dh on dh.source_id=s.id and dh.race_date=d.race_date
        left join race_data.normalization_batches b on b.id=dh.current_batch_id
       where s.enabled or t.id is not null or dh.current_batch_id is not null
    ), report as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'race_date',r.race_date,'source',r.source_code,'task_state',r.task_state,
        'attempt_count',r.attempt_count,'next_attempt_at',r.next_attempt_at,
        'last_error_code',r.last_error_code,'current_batch_id',r.current_batch_id,
        'batch_state',r.batch_state,'last_success_at',r.last_success_at,
        'race_count',r.race_count,'program_count',r.program_count,
        'preview_count',r.preview_count,'result_count',r.result_count,
        'status',case when r.current_batch_id is null and r.task_state in ('queued','retry','leased','running') then 'pending'
          when r.current_batch_id is null and r.task_state in ('quarantined','disabled') then 'failed'
          when r.current_batch_id is null and r.task_state is null then 'untracked'
          when r.current_batch_id is null and r.task_state='succeeded' then 'no_head_after_success'
          when r.current_batch_id is null then 'missing_head'
          when r.batch_state not in ('ready','published') then 'not_published'
          when r.result_count < r.race_count then 'result_incomplete'
          else 'ok' end
      ) order by r.race_date,r.source_code),'[]'::jsonb) as data
      from rows r
    )
    select jsonb_build_object(
      'data',(select data from report),
      'summary',jsonb_build_object(
        'from',v_from::text,'to',v_to::text,
        'dates',(select count(*) from rows),
        'ok_dates',(select count(*) from rows where current_batch_id is not null and batch_state in ('ready','published') and result_count>=race_count),
        'missing_head_dates',(select count(*) from rows where current_batch_id is null),
        'pending_dates',(select count(*) from rows where current_batch_id is null and task_state in ('queued','retry','leased','running')),
        'failed_dates',(select count(*) from rows where current_batch_id is null and task_state in ('quarantined','disabled')),
        'incomplete_result_dates',(select count(*) from rows where current_batch_id is not null and result_count<race_count)
      ),
      'warnings',coalesce((select jsonb_agg(distinct status order by status) from (
        select case when current_batch_id is null and task_state in ('queued','retry','leased','running') then 'pending' when current_batch_id is null and task_state in ('quarantined','disabled') then 'failed' when current_batch_id is null and task_state is null then 'untracked' when current_batch_id is null and task_state='succeeded' then 'no_head_after_success' when current_batch_id is null then 'missing_head' when batch_state not in ('ready','published') then 'not_published' when result_count<race_count then 'result_incomplete' else null end status from rows
      ) w where status is not null),'[]'::jsonb)
    )
  );
end;
$$;

revoke all on function race_data.coverage_report(date,date) from public,anon,authenticated;
grant execute on function race_data.coverage_report(date,date) to service_role;

create or replace function public.race_data_coverage_report(p_from date default null,p_to date default null)
returns jsonb language sql security definer
set search_path=public,race_data,extensions,pg_catalog as $$
  select race_data.coverage_report($1,$2);
$$;
revoke all on function public.race_data_coverage_report(date,date) from public,anon,authenticated;
grant execute on function public.race_data_coverage_report(date,date) to service_role;
