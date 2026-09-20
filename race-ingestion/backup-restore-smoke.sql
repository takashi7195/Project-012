-- Logical backup/restore smoke test. All objects are temporary and rolled back.
begin;
create temporary table backup_races as select * from race_data.races;
create temporary table backup_entries as select * from race_data.race_entries;
create temporary table backup_payouts as select * from race_data.payouts;
create temporary table backup_snapshots as select * from race_data.source_snapshots;
create temporary table backup_programs as select * from race_data.race_programs;
create temporary table backup_previews as select * from race_data.race_previews;
create temporary table backup_preview_entries as select * from race_data.preview_entries;
create temporary table backup_results as select * from race_data.race_results;
create temporary table backup_result_entries as select * from race_data.result_entries;
create temporary table backup_refunds as select * from race_data.refunds;
create temporary table backup_components as select * from race_data.race_components;
create temporary table backup_projections as select * from race_data.component_projections;
create temporary table backup_snapshot_races as select * from race_data.snapshot_races;
create temporary table backup_observations as select * from race_data.snapshot_observations;

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
  programs_live bigint;
  programs_copy bigint;
  previews_live bigint;
  previews_copy bigint;
  preview_entries_live bigint;
  preview_entries_copy bigint;
  results_live bigint;
  results_copy bigint;
  result_entries_live bigint;
  result_entries_copy bigint;
  refunds_live bigint;
  refunds_copy bigint;
  components_live bigint;
  components_copy bigint;
  projections_live bigint;
  projections_copy bigint;
  snapshot_races_live bigint;
  snapshot_races_copy bigint;
  observations_live bigint;
  observations_copy bigint;
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
  select count(*) into programs_live from race_data.race_programs;
  select count(*) into programs_copy from backup_programs;
  select count(*) into previews_live from race_data.race_previews;
  select count(*) into previews_copy from backup_previews;
  select count(*) into preview_entries_live from race_data.preview_entries;
  select count(*) into preview_entries_copy from backup_preview_entries;
  select count(*) into results_live from race_data.race_results;
  select count(*) into results_copy from backup_results;
  select count(*) into result_entries_live from race_data.result_entries;
  select count(*) into result_entries_copy from backup_result_entries;
  select count(*) into refunds_live from race_data.refunds;
  select count(*) into refunds_copy from backup_refunds;
  select count(*) into components_live from race_data.race_components;
  select count(*) into components_copy from backup_components;
  select count(*) into projections_live from race_data.component_projections;
  select count(*) into projections_copy from backup_projections;
  select count(*) into snapshot_races_live from race_data.snapshot_races;
  select count(*) into snapshot_races_copy from backup_snapshot_races;
  select count(*) into observations_live from race_data.snapshot_observations;
  select count(*) into observations_copy from backup_observations;
  if races_live <> races_copy or entries_live <> entries_copy or payouts_live <> payouts_copy or snapshots_live <> snapshots_copy
     or programs_live <> programs_copy
     or previews_live <> previews_copy or preview_entries_live <> preview_entries_copy
     or results_live <> results_copy or result_entries_live <> result_entries_copy
     or refunds_live <> refunds_copy or components_live <> components_copy
     or projections_live <> projections_copy or snapshot_races_live <> snapshot_races_copy
     or observations_live <> observations_copy then
    raise exception 'backup row counts differ';
  end if;
  if live_min is distinct from copy_min or live_max is distinct from copy_max then
    raise exception 'backup date range differs';
  end if;
end;
$$;
rollback;
