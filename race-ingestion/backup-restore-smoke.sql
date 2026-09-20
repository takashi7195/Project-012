-- Logical backup/restore smoke test. All objects are temporary and rolled back.
begin;
create temporary table backup_races as select * from race_data.races;
create temporary table backup_entries as select * from race_data.race_entries;
create temporary table backup_payouts as select * from race_data.payouts;
create temporary table backup_snapshots as select * from race_data.source_snapshots;

do $$
declare
  races_live bigint;
  entries_live bigint;
  payouts_live bigint;
  snapshots_live bigint;
  races_copy bigint;
  entries_copy bigint;
  payouts_copy bigint;
  snapshots_copy bigint;
  live_min date;
  copy_min date;
  live_max date;
  copy_max date;
begin
  select count(*), min(race_date), max(race_date) into races_live, live_min, live_max from race_data.races;
  select count(*) into entries_live from race_data.race_entries;
  select count(*) into payouts_live from race_data.payouts;
  select count(*) into snapshots_live from race_data.source_snapshots;
  select count(*), min(race_date), max(race_date) into races_copy, copy_min, copy_max from backup_races;
  select count(*) into entries_copy from backup_entries;
  select count(*) into payouts_copy from backup_payouts;
  select count(*) into snapshots_copy from backup_snapshots;
  if races_live <> races_copy or entries_live <> entries_copy or payouts_live <> payouts_copy or snapshots_live <> snapshots_copy then
    raise exception 'backup row counts differ';
  end if;
  if live_min is distinct from copy_min or live_max is distinct from copy_max then
    raise exception 'backup date range differs';
  end if;
end;
$$;
rollback;
