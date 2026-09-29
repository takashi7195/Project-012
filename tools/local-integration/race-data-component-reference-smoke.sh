#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="${RACE_COMPONENT_TEST_CONTAINER:-supabase_db_project-012}"
test_database="race_component_fix_$$_$RANDOM"
created=0
cleanup() { if [[ "$created" == 1 ]]; then docker exec "$container_name" dropdb -U postgres --if-exists --force "$test_database" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT INT TERM
docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null
docker exec "$container_name" createdb -U postgres --template=template0 "$test_database"
created=1
docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" -c "create schema extensions" >/dev/null
for migration in 20260920000000_race_data_ingestion.sql 20260921000003_conditional_fetch_metadata.sql 20260924000000_closed_at_contract_v0_1_14.sql; do
  docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" < "$repo_root/supabase/migrations/$migration" >/dev/null
done
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" <<'SQL'
do $fixture$ begin insert into race_data.sources(code,base_url,settings) values ('boatraceopenapi-v1','https://fixture.invalid','{}') on conflict(code) do nothing; end $fixture$;
do $seed$
declare v_payload jsonb; v_entries jsonb; v_preview jsonb; v_race uuid; v_batch uuid; v_result record;
begin
  select jsonb_agg(jsonb_build_object('entryNumber',n,'registrationNumber',10000+n,'name','選手'||n,'rank','A1','age',30,'weightKg',52,'averageStartTiming',0.15,'nationalWinRate',6.5,'localWinRate',6.0,'motorNumber',n,'hullNumber',n,'raw',jsonb_build_object('marker','program-'||n)) order by n) into v_entries from generate_series(1,6) n;
  select jsonb_agg(jsonb_build_object('entryNumber',n,'course',n,'startTiming',0.12,'weightKg',52,'weightAdjustmentKg',0,'exhibitionTime',6.8,'tilt',0,'propeller',null,'parts','[]'::jsonb,'raw',jsonb_build_object('marker','preview-'||n)) order by n) into v_preview from generate_series(1,6) n;
  v_payload := jsonb_build_object('raceCount',1,'records',jsonb_build_array(jsonb_build_object('race',jsonb_build_object('sourceCode','boatraceopenapi-v1','raceDate','2026-09-29','stadiumCode',1,'raceNumber',1),'components',jsonb_build_array(jsonb_build_object('kind','program','rawHash',repeat('a',64),'presence','value','rawJson',jsonb_build_object('marker','raw-program')),jsonb_build_object('kind','preview','rawHash',repeat('b',64),'presence','value','rawJson',jsonb_build_object('marker','raw-preview')),jsonb_build_object('kind','result','rawHash',repeat('c',64),'presence','value','rawJson',jsonb_build_object('marker','raw-result'))),'program',jsonb_build_object('presence','value','common',jsonb_build_object('closedAtSource','2026-09-29 23:59:00','distanceM',1800,'dayNumber',1),'entries',v_entries),'preview',jsonb_build_object('presence','value','common',jsonb_build_object(),'entries',v_preview),'result',jsonb_build_object('presence','value','common',jsonb_build_object(),'entries','[]'::jsonb,'payouts','[]'::jsonb,'refunds','[]'::jsonb),'qualityFlags','[]'::jsonb)));
  select * into v_result from race_data.ingest_snapshot('boatraceopenapi-v1','2026-09-29',repeat('d',64),v_payload,clock_timestamp(),'v0.1.11-normalizer-1','v0.1.11-rules-1',true);
  v_batch:=v_result.out_batch_id; select sr.race_id into v_race from race_data.snapshot_races sr where sr.batch_id=v_batch;
  if not exists(select 1 from race_data.snapshot_races sr join race_data.race_components pc on pc.id=sr.program_component_id where sr.batch_id=v_batch and pc.kind='result') then raise exception 'legacy defect was not reproduced'; end if;
  raise notice 'PASS: old ingest function reproduced wrong result pointer';
end $seed$;
SQL
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" < "$repo_root/supabase/migrations/20260929000000_race_data_component_reference_fix.sql" >/dev/null
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" <<'SQL'
do $repair$
declare v_payload jsonb; v_entries jsonb; v_preview jsonb; v_race uuid; v_old uuid; v_new uuid; v_result record;
begin
  select jsonb_agg(jsonb_build_object('entryNumber',n,'registrationNumber',10000+n,'name','選手'||n,'rank','A1','age',30,'weightKg',52,'averageStartTiming',0.15,'nationalWinRate',6.5,'localWinRate',6.0,'motorNumber',n,'hullNumber',n,'raw',jsonb_build_object('marker','program-'||n)) order by n) into v_entries from generate_series(1,6) n;
  select jsonb_agg(jsonb_build_object('entryNumber',n,'course',n,'startTiming',0.12,'weightKg',52,'weightAdjustmentKg',0,'exhibitionTime',6.8,'tilt',0,'propeller',null,'parts','[]'::jsonb,'raw',jsonb_build_object('marker','preview-'||n)) order by n) into v_preview from generate_series(1,6) n;
  v_payload := jsonb_build_object('raceCount',1,'records',jsonb_build_array(jsonb_build_object('race',jsonb_build_object('sourceCode','boatraceopenapi-v1','raceDate','2026-09-29','stadiumCode',1,'raceNumber',1),'components',jsonb_build_array(jsonb_build_object('kind','program','rawHash',repeat('a',64),'presence','value','rawJson',jsonb_build_object('marker','raw-program')),jsonb_build_object('kind','preview','rawHash',repeat('b',64),'presence','value','rawJson',jsonb_build_object('marker','raw-preview')),jsonb_build_object('kind','result','rawHash',repeat('c',64),'presence','value','rawJson',jsonb_build_object('marker','raw-result'))),'program',jsonb_build_object('presence','value','common',jsonb_build_object('closedAtSource','2026-09-29 23:59:00','distanceM',1800,'dayNumber',1),'entries',v_entries),'preview',jsonb_build_object('presence','value','common',jsonb_build_object(),'entries',v_preview),'result',jsonb_build_object('presence','value','common',jsonb_build_object(),'entries','[]'::jsonb,'payouts','[]'::jsonb,'refunds','[]'::jsonb),'qualityFlags','[]'::jsonb)));
  select id into v_race from race_data.races where race_date='2026-09-29' and stadium_code=1 and race_number=1;
  select id into v_old from race_data.normalization_batches where parser_version='v0.1.11-normalizer-1';
  select * into v_result from race_data.ingest_snapshot('boatraceopenapi-v1','2026-09-29',repeat('d',64),v_payload,clock_timestamp(),'v0.1.11-normalizer-2','v0.1.11-rules-1',true);
  v_new:=v_result.out_batch_id;
  if v_new=v_old then raise exception 'new parser failed to create a new immutable batch'; end if;
  if not exists(select 1 from race_data.snapshot_races sr join race_data.race_components pc on pc.id=sr.program_component_id and pc.kind='program' join race_data.race_components vc on vc.id=sr.preview_component_id and vc.kind='preview' join race_data.race_components rc on rc.id=sr.result_component_id and rc.kind='result' join race_data.component_projections pp on pp.id=sr.program_projection_id and pp.component_id=pc.id join race_data.component_projections vp on vp.id=sr.preview_projection_id and vp.component_id=vc.id join race_data.component_projections rp on rp.id=sr.result_projection_id and rp.component_id=rc.id where sr.batch_id=v_new and sr.race_id=v_race and sr.program_presence='value' and sr.preview_presence='value') then raise exception 'correct batch has invalid component/projection mapping'; end if;
  if (select count(*) from race_data.race_entries re join race_data.snapshot_races sr on sr.program_projection_id=re.projection_id where sr.batch_id=v_new and sr.race_id=v_race)<>6 then raise exception 'program entries were not written to the program projection'; end if;
  if (select count(*) from race_data.preview_entries pe join race_data.snapshot_races sr on sr.preview_projection_id=pe.projection_id where sr.batch_id=v_new and sr.race_id=v_race)<>6 then raise exception 'preview entries were not written to the preview projection'; end if;
  if not exists(select 1 from race_data.snapshot_races sr join race_data.race_components pc on pc.id=sr.program_component_id where sr.batch_id=v_old and sr.race_id=v_race and pc.kind='result') then raise exception 'old batch was modified'; end if;
  raise notice 'PASS: new parser created correct kind links and projections; old batch stayed unchanged';
  update race_data.snapshot_races set program_component_id=result_component_id,program_projection_id=result_projection_id where batch_id=v_new and race_id=v_race;
  select * into v_result from race_data.ingest_snapshot('boatraceopenapi-v1','2026-09-29',repeat('d',64),v_payload,clock_timestamp(),'v0.1.11-normalizer-2','v0.1.11-rules-1',true);
  if v_result.out_batch_id<>v_new or not exists(select 1 from race_data.snapshot_races sr join race_data.race_components pc on pc.id=sr.program_component_id and pc.kind='program' join race_data.race_components vc on vc.id=sr.preview_component_id and vc.kind='preview' join race_data.race_components rc on rc.id=sr.result_component_id and rc.kind='result' where sr.batch_id=v_new and sr.race_id=v_race) then raise exception 'same-batch replay did not repair references'; end if;
  if not exists(select 1 from race_data.race_programs rp join race_data.snapshot_races sr on sr.program_projection_id=rp.projection_id where sr.batch_id=v_new and sr.race_id=v_race and rp.closed_at is not null) then raise exception 'closed_at wrapper was not preserved'; end if;
  raise notice 'PASS: repeated ingest refreshed every pointer and preserved closed_at wrapper';
end $repair$;
SQL

echo 'PASS: component-reference database smoke completed; temporary database will be removed'
