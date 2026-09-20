select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = 2
order by start_time desc
limit 5;
