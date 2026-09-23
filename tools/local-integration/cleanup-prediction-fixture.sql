-- Local integration fixture cleanup only. Deletes rows identified by the fixture.
begin;
do $$
declare
  v_race_ids uuid[];
  v_projection_ids uuid[];
  v_component_ids uuid[];
  v_batch_ids uuid[];
  v_snapshot_ids uuid[];
begin
  select coalesce(array_agg(id),'{}') into v_race_ids
    from race_data.races where race_date=date '2099-12-31' and stadium_code=99 and race_number=1;
  select coalesce(array_agg(rc.id),'{}') into v_component_ids
    from race_data.race_components rc where rc.race_id = any(v_race_ids);
  select coalesce(array_agg(sr.batch_id),'{}') into v_batch_ids
    from race_data.snapshot_races sr where sr.race_id = any(v_race_ids);
  select coalesce(array_agg(distinct cp.id),'{}') into v_projection_ids
    from race_data.component_projections cp
    where cp.component_id = any(v_component_ids);
  select coalesce(array_agg(ps.id),'{}') into v_snapshot_ids
    from race_prediction.prediction_snapshots ps
    where ps.payload->'race'->>'raceDate'='2099-12-31'
      and ps.payload->'race'->>'stadiumCode'='99'
      and ps.payload->'race'->>'raceNumber'='1';
  delete from race_prediction.narrative_attempts where prediction_id=any(v_snapshot_ids);
  delete from race_prediction.prediction_snapshots where id=any(v_snapshot_ids);
  delete from race_data.snapshot_races where race_id=any(v_race_ids);
  delete from race_data.preview_entries where projection_id=any(v_projection_ids);
  delete from race_data.race_entries where projection_id=any(v_projection_ids);
  delete from race_data.race_previews where projection_id=any(v_projection_ids);
  delete from race_data.race_programs where projection_id=any(v_projection_ids);
  delete from race_data.race_results where projection_id=any(v_projection_ids);
  delete from race_data.result_entries where projection_id=any(v_projection_ids);
  delete from race_data.payouts where projection_id=any(v_projection_ids);
  delete from race_data.refunds where projection_id=any(v_projection_ids);
  delete from race_data.component_projections where id=any(v_projection_ids);
  delete from race_data.race_components where id=any(v_component_ids);
  delete from race_data.day_heads where race_date=date '2099-12-31' and source_id in (select id from race_data.sources where code='boatraceopenapi-v1');
  delete from race_data.snapshot_observations where race_date=date '2099-12-31';
  delete from race_data.ingestion_runs where race_date=date '2099-12-31';
  delete from race_data.coverage where batch_id=any(v_batch_ids);
  delete from race_data.normalization_batches where id=any(v_batch_ids);
  delete from race_data.source_snapshots where race_date=date '2099-12-31' and semantic_hash='local-v0.1.14-prediction-fixture';
  delete from race_data.races where id=any(v_race_ids);
end $$;
commit;
