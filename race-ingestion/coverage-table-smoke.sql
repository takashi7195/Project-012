select jsonb_build_object(
  'coverage_rows',(select count(*) from race_data.coverage),
  'all_scope_rows',(select count(*) from race_data.coverage where scope='all' and stadium_code=0),
  'batch_rows',(select count(*) from race_data.normalization_batches),
  'missing_batch_coverage',(select count(*) from race_data.normalization_batches b where not exists(select 1 from race_data.coverage c where c.batch_id=b.id and c.scope='all' and c.stadium_code=0))
) as smoke;
