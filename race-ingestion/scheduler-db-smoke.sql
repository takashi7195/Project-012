begin;
delete from race_data.sync_tasks where race_date = date '2099-12-30';
do $$
declare
  first_claim record;
  recovered_claim record;
  finished boolean;
  queued_count integer;
begin
  perform race_data.enqueue_date_tasks('boatraceopenapi-v1', date '2099-12-30', date '2099-12-30', 'scheduler-smoke', 1000::smallint);
  select * into first_claim from race_data.claim_next_task('scheduler-smoke-a', 90);
  if first_claim.task_id is null then raise exception 'claim did not return a task'; end if;

  update race_data.sync_tasks set lease_until = now() - interval '1 second' where id = first_claim.task_id;
  select * into recovered_claim from race_data.claim_next_task('scheduler-smoke-b', 90);
  if recovered_claim.task_id <> first_claim.task_id then raise exception 'expired lease was not recovered'; end if;

  finished := race_data.finish_task(recovered_claim.task_id, recovered_claim.lease_token, 'succeeded');
  if not finished then raise exception 'finish_task rejected the active lease'; end if;

  select count(*) into queued_count from race_data.sync_tasks where race_date = date '2099-12-30' and state in ('queued', 'retry', 'leased', 'running');
  if queued_count <> 0 then raise exception 'task remained due after success'; end if;
  delete from race_data.sync_tasks where race_date = date '2099-12-30';
end;
$$;
commit;
