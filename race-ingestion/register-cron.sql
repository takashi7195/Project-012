select cron.unschedule(jobid) from cron.job where jobname in (
  'race-ingest-every-5-min', 'race-ingest-today-every-5-min',
  'race-ingest-backfill-every-5-min', 'race-ingest-yesterday-daily'
);

select cron.schedule('race-ingest-today-every-5-min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/race-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select token from race_data.scheduler_secrets where name = 'race_ingest_worker')),
    body := '{"mode":"today"}'::jsonb
  ) as request_id;
$$);

select cron.schedule('race-ingest-backfill-every-5-min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/race-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select token from race_data.scheduler_secrets where name = 'race_ingest_worker')),
    body := '{"mode":"backfill"}'::jsonb
  ) as request_id;
$$);

-- 06:10 JST is 21:10 UTC on the previous calendar day.
select cron.schedule('race-ingest-yesterday-daily', '10 21 * * *', $$
  select net.http_post(
    url := 'https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/race-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select token from race_data.scheduler_secrets where name = 'race_ingest_worker')),
    body := '{"mode":"yesterday"}'::jsonb
  ) as request_id;
$$);
