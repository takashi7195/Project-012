begin;
select race_data.enqueue_date_tasks('boatraceopenapi-v1', date '2099-12-28', date '2099-12-28', 'today', 100);
update race_data.sync_tasks set state='succeeded' where race_date=date '2099-12-28';
select race_data.enqueue_date_tasks('boatraceopenapi-v1', date '2099-12-28', date '2099-12-28', 'today', 100);
select race_date, state, priority from race_data.sync_tasks where race_date=date '2099-12-28';
delete from race_data.sync_tasks where race_date=date '2099-12-28';
commit;
