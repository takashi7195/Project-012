select state, count(*) from race_data.sync_tasks group by state order by state;
select min(race_date) as min_queued, max(race_date) as max_queued, count(*) as queued_backfill
from race_data.sync_tasks where state in ('queued','retry') and priority < 0;
