-- Read-only history lookup for one race identity. This does not change the
-- current-head search; it exposes the observed snapshot lineage for audits.
create or replace function race_data.list_race_versions(
  p_race_date date,
  p_stadium_code smallint,
  p_race_number smallint,
  p_limit integer default 50
) returns jsonb
language sql security definer
set search_path = race_data, extensions, pg_catalog
as $$
  with versions as (
    select r.id race_id, r.race_date, r.stadium_code, r.race_number,
           ss.id snapshot_id, ss.semantic_hash, ss.hash_version, ss.created_at snapshot_created_at,
           b.id batch_id, b.state batch_state, b.parser_version, b.rules_version, b.created_at batch_created_at, b.published_at,
           sr.program_presence, sr.preview_presence, sr.result_presence,
           sr.program_projection_id, sr.preview_projection_id, sr.result_projection_id,
           run.id run_id, run.status run_status, run.error_code run_error_code,
           run.request_started_at, run.fetched_at, run.http_status, run.bytes,
           row_number() over (order by b.created_at desc) rn
      from race_data.races r
      join race_data.snapshot_races sr on sr.race_id=r.id
      join race_data.normalization_batches b on b.id=sr.batch_id
      join race_data.source_snapshots ss on ss.id=b.snapshot_id
      left join lateral (
        select ir.* from race_data.ingestion_runs ir
         where ir.snapshot_id=ss.id
         order by ir.request_started_at desc limit 1
      ) run on true
     where r.race_date=p_race_date and r.stadium_code=p_stadium_code and r.race_number=p_race_number
  ), limited as (select * from versions where rn<=least(greatest(coalesce(p_limit,50),1),100))
  select jsonb_build_object(
    'data',coalesce((select jsonb_agg(jsonb_build_object(
      'race_id',v.race_id,'race_date',v.race_date,'stadium_code',v.stadium_code,'race_number',v.race_number,
      'snapshot_id',v.snapshot_id,'semantic_hash',v.semantic_hash,'hash_version',v.hash_version,'snapshot_created_at',v.snapshot_created_at,
      'batch_id',v.batch_id,'batch_state',v.batch_state,'parser_version',v.parser_version,'rules_version',v.rules_version,
      'batch_created_at',v.batch_created_at,'published_at',v.published_at,
      'presence',jsonb_build_object('program',v.program_presence,'preview',v.preview_presence,'result',v.result_presence),
      'projection_ids',jsonb_build_object('program',v.program_projection_id,'preview',v.preview_projection_id,'result',v.result_projection_id),
      'run',jsonb_build_object('id',v.run_id,'status',v.run_status,'error_code',v.run_error_code,'request_started_at',v.request_started_at,'fetched_at',v.fetched_at,'http_status',v.http_status,'bytes',v.bytes)
    ) order by v.batch_created_at desc) from limited v),'[]'::jsonb),
    'summary',jsonb_build_object('race_date',p_race_date::text,'stadium_code',p_stadium_code,'race_number',p_race_number,'matched_versions',(select count(*) from versions),'returned_versions',(select count(*) from limited),'truncated',(select count(*)>least(greatest(coalesce(p_limit,50),1),100) from versions)),
    'warnings',case when (select count(*) from limited)=0 then jsonb_build_array('no_match') else '[]'::jsonb end
  );
$$;

revoke all on function race_data.list_race_versions(date,smallint,smallint,integer) from public,anon,authenticated;
grant execute on function race_data.list_race_versions(date,smallint,smallint,integer) to service_role;

create or replace function public.race_data_list_race_versions(p_race_date date,p_stadium_code smallint,p_race_number smallint,p_limit integer default 50)
returns jsonb language sql security definer
set search_path=public,race_data,extensions,pg_catalog as $$
  select race_data.list_race_versions($1,$2,$3,$4);
$$;
revoke all on function public.race_data_list_race_versions(date,smallint,smallint,integer) from public,anon,authenticated;
grant execute on function public.race_data_list_race_versions(date,smallint,smallint,integer) to service_role;
