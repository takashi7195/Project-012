#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="${AI_DB_SMOKE_CONTAINER:-project012-ai-db-smoke-$$}"
test_database="postgres"
created_database=0
result_dir="$(mktemp -d)"
docker_config_dir="$(mktemp -d)"
chmod 700 "$docker_config_dir"
export DOCKER_CONFIG="$docker_config_dir"
cleanup() {
  if [[ "$created_database" == 1 ]]; then
    docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "drop database if exists \"$test_database\" with (force)" >/dev/null 2>&1 || true
  fi
  if [[ -z "${AI_DB_SMOKE_CONTAINER:-}" ]]; then
    docker rm --force "$container_name" >/dev/null 2>&1 || true
  fi
  rm -rf "$docker_config_dir" "$result_dir"
}
trap cleanup EXIT INT TERM

docker info >/dev/null
if [[ -n "${AI_DB_SMOKE_CONTAINER:-}" ]]; then
  if [[ ! "$container_name" =~ ^[a-zA-Z0-9_.-]+$ ]]; then echo "FAIL: invalid container name" >&2; exit 1; fi
  test_database="project012_ai_smoke_$$"
  docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null
  docker exec "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "create database \"$test_database\" template template0" >/dev/null
  created_database=1
else
  docker pull postgres:17-alpine
  docker run --detach --rm --network none --name "$container_name" \
    --env POSTGRES_PASSWORD=local_test_only postgres:17-alpine >/dev/null

  ready=0
  for attempt in $(seq 1 45); do
    if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then echo "FAIL: isolated PostgreSQL did not become ready" >&2; exit 1; fi
fi

# Minimal fixture for the existing race-data schema used by the migration.
if [[ -n "${AI_DB_SMOKE_CONTAINER:-}" ]]; then
  echo "Running against a disposable database in Supabase container: $container_name"
else
  echo "Running against an isolated PostgreSQL container: $container_name"
fi
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" <<'SQL'
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then execute 'create role anon nologin'; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then execute 'create role authenticated nologin'; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then execute 'create role service_role nologin bypassrls'; end if;
end $roles$;
create schema if not exists extensions;
create schema race_data;
create table race_data.sources (id uuid primary key, code text not null);
create table race_data.races (id uuid primary key, race_date date not null, stadium_code smallint not null, race_number smallint not null);
create table race_data.normalization_batches (id uuid primary key, state text not null);
create table race_data.race_components (id uuid primary key, kind text not null, raw_json jsonb);
create table race_data.component_projections (id uuid primary key);
create table race_data.race_programs (projection_id uuid primary key, closed_at timestamptz);
create table race_data.snapshot_races (
  batch_id uuid not null, race_id uuid not null, program_component_id uuid, preview_component_id uuid,
  program_projection_id uuid, program_presence text not null, preview_presence text not null
);
create table race_data.ingestion_runs (id uuid primary key, fetched_at timestamptz);
create table race_data.day_heads (
  source_id uuid not null, race_date date not null, current_batch_id uuid, last_success_at timestamptz, current_run_id uuid
);
SQL

docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" \
  < "$repo_root/supabase/migrations/20260926000000_ai_prediction_bundle_v0_1_19.sql"
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" \
  < "$repo_root/supabase/migrations/20260927000000_ai_prediction_result_filter_v0_1_19.sql"

docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" <<'SQL'
do $seed$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Tokyo')::date;
begin
  insert into race_data.sources values ('00000000-0000-0000-0000-000000000001','boatraceopenapi-v1');
  insert into race_data.races values ('00000000-0000-0000-0000-000000000002',v_today,1,1);
  insert into race_data.normalization_batches values ('00000000-0000-0000-0000-000000000003','ready');
  insert into race_data.race_components values ('00000000-0000-0000-0000-000000000004','program',
    jsonb_build_object('date',v_today::text,'stadium_number',1,'race_number',1,
      'racers',jsonb_build_object('1',jsonb_build_object('entry_number',1),'2',jsonb_build_object('entry_number',2),
        '3',jsonb_build_object('entry_number',3),'4',jsonb_build_object('entry_number',4),
        '5',jsonb_build_object('entry_number',5),'6',jsonb_build_object('entry_number',6)),
      'result',jsonb_build_object('place_number',1,'payouts',jsonb_build_array(1000),'racers',jsonb_build_array(jsonb_build_object('actual_course',2,'actual_start_timing',0.12,'finish_position',1,'place_number_source','official'))),
      'existing_prediction',jsonb_build_object('main',jsonb_build_array(1,2,3)),'ai_prediction',jsonb_build_object('narrative','old'),'prediction_snapshot',jsonb_build_object('legacy',true)));
  insert into race_data.component_projections values ('00000000-0000-0000-0000-000000000005');
  insert into race_data.race_programs values ('00000000-0000-0000-0000-000000000005',clock_timestamp()+interval '2 hours');
  insert into race_data.snapshot_races values ('00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004',null,
    '00000000-0000-0000-0000-000000000005','value','missing');
  insert into race_data.day_heads values ('00000000-0000-0000-0000-000000000001',v_today,
    '00000000-0000-0000-0000-000000000003',clock_timestamp(),null);
end $seed$;

begin;
set local role service_role;
do $test$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Tokyo')::date;
  v_input jsonb;
  v_claim jsonb;
  v_job uuid;
  v_owner uuid;
  v_result jsonb;
  v_bad_pick jsonb;
  v_second_claim jsonb;
  v_third_claim jsonb;
  v_output jsonb := '{"main":[1,2,3],"counter":[2,3,4],"hole":[6,5,4],"narrative":"fixture narrative"}'::jsonb;
  v_meta jsonb := '{"provider":"gemini","model":"fixture","requestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","promptHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","requestPayload":{"model":"fixture"}}'::jsonb;
begin
  if has_function_privilege('anon','public.race_prediction_read_ai_job(uuid)','EXECUTE') then raise exception 'anon can execute private RPC'; end if;
  if not has_function_privilege('service_role','public.race_prediction_read_ai_job(uuid)','EXECUTE') then raise exception 'service_role cannot execute RPC'; end if;
  if not (select rolbypassrls from pg_roles where rolname='service_role') then raise exception 'test fixture service_role must emulate Supabase BYPASSRLS'; end if;
  v_input := race_prediction_get_ai_input(v_today,1::smallint,1::smallint);
  if (select count(*) from jsonb_object_keys(v_input->'programRaw'->'racers')) <> 6 then raise exception 'get_input did not preserve all entries'; end if;
  if v_input->'programRaw' ? 'result' then raise exception 'result data leaked into AI program input'; end if;
  if v_input->'programRaw'->'result' is not null then raise exception 'unexpected result value'; end if;
  if (v_input->'programRaw')::text ~ '"(result|payouts|refunds|actual_course|actual_start_timing|finish_position|place_number|place_number_source|existing_prediction|ai_prediction|prediction_snapshot)"' then raise exception 'deep result field leaked into AI input'; end if;
  v_claim := race_prediction_claim_ai_job(repeat('d',64),'00000000-0000-0000-0000-000000000002',
    jsonb_set(v_input->'identity','{raceDate}',to_jsonb((v_today-1)::text)),(v_input->>'closedAt')::timestamptz,
    repeat('e',64),repeat('f',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_claim->>'state' <> 'rejected' then raise exception 'historical race was admitted'; end if;
  v_input := jsonb_set(v_input,'{provenance,fetchedAt}','"2000-01-01T00:00:00Z"'::jsonb);

  v_claim := race_prediction_claim_ai_job(
    repeat('a',64),'00000000-0000-0000-0000-000000000002',v_input->'identity',(v_input->>'closedAt')::timestamptz,
    repeat('b',64),repeat('c',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_claim->>'state' <> 'created' then raise exception 'job claim failed: %',v_claim; end if;
  v_job := (v_claim->>'jobId')::uuid; v_owner := (v_claim->>'ownerToken')::uuid;
  v_result := race_prediction_finish_ai_job(v_job,v_owner,1::smallint,v_output,v_meta,5000);
  if coalesce((v_result->>'saved')::boolean,false) then raise exception 'unstarted attempt was saved'; end if;
  if race_prediction_read_ai_job(v_job)->>'state' <> 'generating' then raise exception 'unstarted attempt changed job state'; end if;
  if not (race_prediction_begin_ai_attempt(v_job,v_owner,1::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'first attempt was not authorized'; end if;
  if (race_prediction_begin_ai_attempt(v_job,v_owner,1::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'duplicate attempt was authorized'; end if;

  for v_bad_pick in select value from jsonb_array_elements('[ [1,1,2], [1,null,2], [1,2,7], [1,2], [1,2,3,4], [] ]'::jsonb) loop
    begin
      perform race_prediction_finish_ai_job(v_job,v_owner,1::smallint,
        jsonb_set(v_output,'{main}',v_bad_pick),v_meta,5000);
      raise exception 'invalid pick unexpectedly saved: %',v_bad_pick;
    exception when check_violation then null;
    end;
    if exists(select 1 from race_prediction.ai_prediction_bundles) then raise exception 'invalid pick left a partial bundle: %',v_bad_pick; end if;
  end loop;
  for v_bad_pick in select value from jsonb_array_elements('[{"path":"counter","value":[1,2,3]},{"path":"hole","value":[1,2,3]},{"path":"hole","value":[2,3,4]}]'::jsonb) loop
    begin
      perform race_prediction_finish_ai_job(v_job,v_owner,1::smallint,
        jsonb_set(v_output,array[v_bad_pick->>'path'],v_bad_pick->'value'),v_meta,5000);
      raise exception 'duplicate ticket groups unexpectedly saved: %',v_bad_pick;
    exception when check_violation then null;
    end;
    if exists(select 1 from race_prediction.ai_prediction_bundles) then raise exception 'duplicate ticket groups left a partial bundle'; end if;
  end loop;
  begin
    perform race_prediction_finish_ai_job(v_job,v_owner,1::smallint,
      jsonb_set(v_output,'{narrative}','"   "'::jsonb),v_meta,5000);
    raise exception 'empty narrative unexpectedly saved';
  exception when check_violation then null;
  end;
  if (race_prediction_read_ai_job(v_job)->>'state') <> 'generating' then raise exception 'failed save changed job state'; end if;
  if exists(select 1 from race_prediction.ai_prediction_bundles) then raise exception 'failed save left partial bundle'; end if;

  v_result := race_prediction_finish_ai_job(v_job,v_owner,1::smallint,v_output,v_meta,5000);
  if (v_result->>'saved')::boolean is not true then raise exception 'valid bundle was not saved'; end if;
  if (race_prediction_finish_ai_job(v_job,v_owner,1::smallint,v_output,v_meta,5000)->>'predictionId') <> v_result->>'predictionId' then raise exception 'idempotent save returned a different prediction'; end if;
  if race_prediction_read_ai_job(v_job)->>'state' <> 'succeeded' then raise exception 'saved job is not succeeded'; end if;
  if (select count(*) from race_prediction.ai_prediction_bundles) <> 1 then raise exception 'expected exactly one saved bundle'; end if;
  v_claim := race_prediction_claim_ai_job(repeat('a',64),'00000000-0000-0000-0000-000000000002',
    v_input->'identity',(v_input->>'closedAt')::timestamptz,repeat('b',64),repeat('c',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_claim->>'state' <> 'existing' then raise exception 'successful result was not reused: %',v_claim; end if;
  v_claim := race_prediction_claim_ai_job(repeat('a',64),'00000000-0000-0000-0000-000000000002',
    v_input->'identity',clock_timestamp()-interval '1 second',repeat('b',64),repeat('c',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_claim->>'state' <> 'rejected' then raise exception 'closed race returned cached result: %',v_claim; end if;
  begin
    insert into race_prediction.ai_generation_keys(reuse_key) values ('invalid-key');
    raise exception 'invalid reuse key was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into race_prediction.ai_generation_keys(reuse_key) values (repeat('a',64));
    raise exception 'duplicate generation reuse key was accepted';
  exception when unique_violation then null;
  end;
  v_second_claim := race_prediction_claim_ai_job(repeat('2',64),'00000000-0000-0000-0000-000000000002',
    v_input->'identity',(v_input->>'closedAt')::timestamptz,repeat('b',64),repeat('c',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_second_claim->>'state' <> 'created' then raise exception 'second key fixture job was not created'; end if;
  v_third_claim := race_prediction_claim_ai_job(repeat('3',64),'00000000-0000-0000-0000-000000000002',
    v_input->'identity',(v_input->>'closedAt')::timestamptz,repeat('b',64),repeat('c',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_third_claim->>'state' <> 'created' then raise exception 'third key fixture job was not created'; end if;
  begin
    insert into race_prediction.ai_prediction_bundles(
      reuse_key,job_id,race_id,main,counter,hole,narrative,generated_at,provider,model,input_bundle,config_snapshot,
      facts_hash,config_hash,request_hash,winning_attempt)
    select repeat('4',64),(v_second_claim->>'jobId')::uuid,b.race_id,b.main,b.counter,b.hole,b.narrative,b.generated_at,b.provider,b.model,
      b.input_bundle,b.config_snapshot,b.facts_hash,b.config_hash,b.request_hash,b.winning_attempt
    from race_prediction.ai_prediction_bundles b where b.job_id=v_job;
    raise exception 'bundle with missing generation key was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into race_prediction.ai_prediction_bundles(
      reuse_key,job_id,race_id,main,counter,hole,narrative,generated_at,provider,model,input_bundle,config_snapshot,
      facts_hash,config_hash,request_hash,winning_attempt)
    select repeat('3',64),(v_second_claim->>'jobId')::uuid,b.race_id,b.main,b.counter,b.hole,b.narrative,b.generated_at,b.provider,b.model,
      b.input_bundle,b.config_snapshot,b.facts_hash,b.config_hash,b.request_hash,b.winning_attempt
    from race_prediction.ai_prediction_bundles b where b.job_id=v_job;
    raise exception 'bundle with mismatched job/key pair was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into race_prediction.ai_generation_jobs(
      reuse_key,race_id,identity,state,owner_token,admitted_at,expires_at,closed_at_at_admission,facts_hash,config_hash,input_bundle,config_snapshot)
    values(repeat('4',64),'00000000-0000-0000-0000-000000000002','{}','generating',gen_random_uuid(),clock_timestamp(),
      clock_timestamp()+interval '90 seconds',clock_timestamp()+interval '1 hour',repeat('b',64),repeat('c',64),'{}','{}');
    raise exception 'job with missing generation key was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update race_prediction.ai_generation_keys set current_job_id=gen_random_uuid() where reuse_key=repeat('a',64);
    raise exception 'generation key with missing current job reference was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update race_prediction.ai_generation_keys set completed_prediction_id=gen_random_uuid() where reuse_key=repeat('a',64);
    raise exception 'generation key with missing completed bundle reference was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update race_prediction.ai_generation_jobs set prediction_id=gen_random_uuid() where id=v_job;
    raise exception 'job with missing bundle reference was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into race_prediction.ai_prediction_bundles(
      reuse_key,job_id,race_id,main,counter,hole,narrative,generated_at,provider,model,input_bundle,config_snapshot,
      facts_hash,config_hash,request_hash,winning_attempt)
    select b.reuse_key,b.job_id,b.race_id,b.main,b.counter,b.hole,b.narrative,b.generated_at,b.provider,b.model,
      b.input_bundle,b.config_snapshot,b.facts_hash,b.config_hash,b.request_hash,b.winning_attempt
    from race_prediction.ai_prediction_bundles b where b.job_id=v_job;
    raise exception 'duplicate saved bundle reference was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into race_prediction.ai_generation_attempts(job_id,sequence,state,model)
      values(gen_random_uuid(),1,'started','fixture');
    raise exception 'attempt with missing job reference was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into race_prediction.ai_prediction_bundles(
      reuse_key,job_id,race_id,main,counter,hole,narrative,generated_at,provider,model,input_bundle,config_snapshot,
      facts_hash,config_hash,request_hash,winning_attempt)
    select repeat('2',64),(v_second_claim->>'jobId')::uuid,gen_random_uuid(),b.main,b.counter,b.hole,b.narrative,b.generated_at,b.provider,b.model,
      b.input_bundle,b.config_snapshot,b.facts_hash,b.config_hash,b.request_hash,b.winning_attempt
    from race_prediction.ai_prediction_bundles b where b.job_id=v_job;
    raise exception 'bundle with missing race reference was accepted';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from race_prediction.ai_prediction_bundles where reuse_key=repeat('3',64)) then raise exception 'invalid cross-key bundle remained'; end if;
  raise notice 'PASS: invalid key shape, all key/job/attempt/bundle missing references, and mismatched job/reuse-key composite foreign key rejected';
  if not race_prediction.valid_pick(array[1,2,3]::smallint[]) then raise exception 'valid ticket rejected'; end if;
  if race_prediction.valid_pick(array[1,1,3]::smallint[]) is distinct from false then raise exception 'duplicate boat ticket accepted'; end if;
  if race_prediction.valid_pick(array[1,null,3]::smallint[]) is distinct from false then raise exception 'null boat ticket accepted'; end if;
  if race_prediction.valid_pick(null::smallint[]) is distinct from false then raise exception 'null ticket array accepted'; end if;
  if race_prediction.valid_pick(array[[1,2,3],[4,5,6]]::smallint[]) is distinct from false then raise exception 'multidimensional ticket accepted'; end if;
  if race_prediction.valid_pick(array[]::smallint[]) is distinct from false then raise exception 'empty ticket accepted'; end if;
  if race_prediction.valid_pick(array[0,2,3]::smallint[]) is distinct from false then raise exception 'out-of-range ticket accepted'; end if;
  raise notice 'PASS: migration, recursive input filtering, historical admission fence, RPC privileges, duplicate-attempt fence, invalid array/narrative rollback, atomic success save';
end $test$;
commit;
SQL


docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" <<'SQL'
begin;
set local role service_role;
do $fence$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Tokyo')::date;
  v_input jsonb;
  v_old jsonb;
  v_new jsonb;
  v_old_job uuid;
  v_old_owner uuid;
  v_new_job uuid;
  v_result jsonb;
  v_retry jsonb;
  v_retry_job uuid;
  v_retry_owner uuid;
  v_state jsonb;
begin
  v_input := public.race_prediction_get_ai_input(v_today,1::smallint,1::smallint);
  v_old := race_prediction_claim_ai_job(repeat('e',64),(v_input->>'raceId')::uuid,v_input->'identity',
    (v_input->>'closedAt')::timestamptz,repeat('f',64),repeat('1',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_old->>'state' <> 'created' then raise exception 'initial fenced job was not created: %',v_old; end if;
  v_old_job := (v_old->>'jobId')::uuid; v_old_owner := (v_old->>'ownerToken')::uuid;
  if not (race_prediction_begin_ai_attempt(v_old_job,v_old_owner,1::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'old owner could not start first attempt'; end if;
  update race_prediction.ai_generation_jobs set expires_at=clock_timestamp()-interval '1 second' where id=v_old_job;
  v_new := race_prediction_claim_ai_job(repeat('e',64),(v_input->>'raceId')::uuid,v_input->'identity',
    (v_input->>'closedAt')::timestamptz,repeat('f',64),repeat('1',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  if v_new->>'state' <> 'created' then raise exception 'expired job was not replaced: %',v_new; end if;
  v_new_job := (v_new->>'jobId')::uuid;
  if v_old_job=v_new_job then raise exception 'replacement reused old job id'; end if;
  v_result := race_prediction_finish_ai_job(v_old_job,v_old_owner,1::smallint,
    '{"main":[1,2,3],"counter":[2,3,4],"hole":[6,5,4],"narrative":"stale"}'::jsonb,
    '{"provider":"gemini","model":"fixture","requestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,5000);
  if coalesce((v_result->>'saved')::boolean,false) then raise exception 'stale worker overwrote replacement job'; end if;
  if (select current_job_id from race_prediction.ai_generation_keys where reuse_key=repeat('e',64))<>v_new_job then raise exception 'current key pointer changed after stale finish'; end if;
  raise notice 'PASS: expired owner was replaced and stale worker was fenced';

  v_retry := race_prediction_claim_ai_job(repeat('8',64),(v_input->>'raceId')::uuid,v_input->'identity',
    (v_input->>'closedAt')::timestamptz,repeat('7',64),repeat('6',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  v_retry_job := (v_retry->>'jobId')::uuid; v_retry_owner := (v_retry->>'ownerToken')::uuid;
  if not (race_prediction_begin_ai_attempt(v_retry_job,v_retry_owner,1::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'attempt one was not authorized'; end if;
  if not race_prediction_finish_ai_attempt(v_retry_job,v_retry_owner,1::smallint,'{"errorCode":"test_retry","unknown":false,"durationMs":1}'::jsonb) then raise exception 'attempt one failure was not recorded'; end if;
  if (race_prediction_begin_ai_attempt(v_retry_job,v_retry_owner,1::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'attempt one was authorized twice'; end if;
  if not (race_prediction_begin_ai_attempt(v_retry_job,v_retry_owner,2::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'attempt two was not authorized'; end if;
  if (race_prediction_begin_ai_attempt(v_retry_job,v_retry_owner,3::smallint,'fixture')->>'sendAuthorized')::boolean then raise exception 'attempt three exceeded the limit'; end if;
  if not race_prediction_finish_ai_attempt(v_retry_job,v_retry_owner,2::smallint,'{"errorCode":"test_done","unknown":false,"durationMs":1}'::jsonb) then raise exception 'attempt two failure was not recorded'; end if;
  if not race_prediction_fail_ai_job(v_retry_job,v_retry_owner,'test_retryable',true) then raise exception 'retryable failure was not saved'; end if;
  v_state := race_prediction_read_ai_job(v_retry_job);
  if v_state->>'state'<>'failed' or (v_state->>'retryable')::boolean is not true then raise exception 'retryable failure state is wrong: %',v_state; end if;
  raise notice 'PASS: maximum two attempts and retryable failure state';

  v_retry := race_prediction_claim_ai_job(repeat('9',64),(v_input->>'raceId')::uuid,v_input->'identity',
    (v_input->>'closedAt')::timestamptz,repeat('7',64),repeat('6',64),v_input,'{"model":"fixture"}'::jsonb,90000);
  v_retry_job := (v_retry->>'jobId')::uuid; v_retry_owner := (v_retry->>'ownerToken')::uuid;
  if not race_prediction_fail_ai_job(v_retry_job,v_retry_owner,'test_nonretryable',false) then raise exception 'nonretryable failure was not saved'; end if;
  v_state := race_prediction_read_ai_job(v_retry_job);
  if v_state->>'state'<>'failed' or (v_state->>'retryable')::boolean is not false then raise exception 'nonretryable failure state is wrong: %',v_state; end if;
  raise notice 'PASS: nonretryable failure state';
end $fence$;
commit;
SQL

pids=()
for index in $(seq 1 20); do
  docker exec -i "$container_name" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d "$test_database" \
    >"$result_dir/$index" 2>&1 <<'SQL' &
set role service_role;
with input as (
  select public.race_prediction_get_ai_input(
    (clock_timestamp() at time zone 'Asia/Tokyo')::date,1::smallint,1::smallint
  ) as value
)
select public.race_prediction_claim_ai_job(
  repeat('d',64),(value->>'raceId')::uuid,value->'identity',(value->>'closedAt')::timestamptz,
  repeat('b',64),repeat('c',64),value,'{"model":"fixture"}'::jsonb,90000
) from input;
SQL
  pids+=("$!")
done

workers_failed=0
for pid in "${pids[@]}"; do wait "$pid" || workers_failed=1; done
if [[ "$workers_failed" != 0 ]]; then cat "$result_dir"/* >&2; exit 1; fi
python3 - "$result_dir" <<'PYTHON'
import json
import pathlib
import sys
results=[]
for path in pathlib.Path(sys.argv[1]).iterdir():
    raw=path.read_text().strip()
    try:
        results.append(json.loads(raw))
    except Exception as error:
        raise SystemExit(f"FAIL: invalid result from concurrent caller {path.name}: {raw!r}: {error}")
created=[result for result in results if result.get('state') == 'created']
busy=[result for result in results if result.get('state') == 'busy']
job_ids={result.get('jobId') for result in results}
if len(results) != 20 or len(created) != 1 or len(busy) != 19 or len(job_ids) != 1:
    raise SystemExit(f"FAIL: expected 1 created + 19 busy sharing one job, got {results!r}")
print('PASS: 20 concurrent START requests shared exactly one job (one owner, nineteen joiners)')
PYTHON

echo "PASS: isolated PostgreSQL migration and bundle smoke tests completed"
