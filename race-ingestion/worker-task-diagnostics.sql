select s.code, t.race_date, t.state, t.priority, t.attempt_count, t.last_error_code, t.next_attempt_at, t.lease_until
from race_data.sync_tasks t join race_data.sources s on s.id=t.source_id
where t.race_date >= date '2026-09-19'
order by t.updated_at desc
limit 20;
