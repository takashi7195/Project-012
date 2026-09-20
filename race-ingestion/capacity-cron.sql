select cron.unschedule(jobid)
from cron.job
where jobname = 'race-data-capacity-daily';

-- 09:15 JST daily (00:15 UTC).
select cron.schedule('race-data-capacity-daily', '15 0 * * *', $$
  select public.race_data_capture_capacity_observation();
$$);
