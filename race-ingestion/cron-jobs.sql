select jobid, jobname, schedule, active from cron.job where jobname like 'race-ingest%' order by jobname;
