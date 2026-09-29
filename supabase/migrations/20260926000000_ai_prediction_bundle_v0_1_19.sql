create schema if not exists race_prediction;
revoke all on schema race_prediction from public, anon, authenticated;

create or replace function race_prediction.valid_pick(p_pick smallint[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(p_pick)=3 and array_ndims(p_pick)=1 and array_lower(p_pick,1)=1
    and array_position(p_pick,null) is null and p_pick <@ array[1,2,3,4,5,6]::smallint[]
    and (select count(distinct item)=3 from unnest(p_pick) item), false)
$$;

create or replace function race_prediction.strip_result_fields(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare v_result jsonb;
begin
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(race_prediction.strip_result_fields(value) order by ordinality), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
    return v_result;
  elsif jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(key, race_prediction.strip_result_fields(value)), '{}'::jsonb)
      into v_result from jsonb_each(p_value)
     where key not in ('result','payouts','refunds','actual_course','actual_start_timing','finish_position','place_number','place_number_source');
    return v_result;
  end if;
  return p_value;
end $$;

create table race_prediction.ai_generation_keys (
  reuse_key text primary key check (reuse_key ~ '^[0-9a-f]{64}$'),
  current_job_id uuid,
  completed_prediction_id uuid,
  created_at timestamptz not null default clock_timestamp()
);

create table race_prediction.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  reuse_key text not null references race_prediction.ai_generation_keys(reuse_key) on delete restrict,
  race_id uuid not null references race_data.races(id) on delete restrict,
  identity jsonb not null,
  state text not null check (state in ('generating','succeeded','failed','expired')),
  owner_token uuid not null,
  admitted_at timestamptz not null,
  expires_at timestamptz not null,
  closed_at_at_admission timestamptz not null,
  facts_hash text not null check (facts_hash ~ '^[0-9a-f]{64}$'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  input_bundle jsonb not null,
  config_snapshot jsonb not null,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 2),
  prediction_id uuid,
  finished_at timestamptz,
  error_code text,
  retryable boolean,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, reuse_key),
  check ((state = 'succeeded' and prediction_id is not null and finished_at is not null)
      or (state <> 'succeeded' and prediction_id is null)),
  check (state <> 'failed' or retryable is not null)
);

create table race_prediction.ai_prediction_bundles (
  id uuid primary key default gen_random_uuid(),
  reuse_key text not null unique references race_prediction.ai_generation_keys(reuse_key) on delete restrict,
  job_id uuid not null unique,
  race_id uuid not null references race_data.races(id) on delete restrict,
  main smallint[] not null,
  counter smallint[] not null,
  hole smallint[] not null,
  narrative text not null,
  generated_at timestamptz not null,
  saved_at timestamptz not null default clock_timestamp(),
  provider text not null,
  model text not null,
  provider_model_version text,
  input_bundle jsonb not null,
  config_snapshot jsonb not null,
  facts_hash text not null,
  config_hash text not null,
  request_hash text not null,
  winning_attempt smallint not null check (winning_attempt between 1 and 2),
  usage jsonb,
  foreign key (job_id, reuse_key) references race_prediction.ai_generation_jobs(id, reuse_key) on delete restrict,
  check (race_prediction.valid_pick(main)),
  check (race_prediction.valid_pick(counter)),
  check (race_prediction.valid_pick(hole)),
  check (main <> counter and main <> hole and counter <> hole),
  check (length(btrim(narrative)) > 0)
);

create table race_prediction.ai_generation_attempts (
  job_id uuid not null references race_prediction.ai_generation_jobs(id) on delete restrict,
  sequence smallint not null check (sequence between 1 and 2),
  state text not null check (state in ('started','succeeded','failed','unknown')),
  model text not null,
  prompt_hash text,
  request_hash text,
  request_payload jsonb,
  candidate jsonb,
  validation_codes jsonb not null default '[]'::jsonb,
  http_status integer,
  usage jsonb,
  duration_ms integer,
  error_code text,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  primary key (job_id, sequence)
);

alter table race_prediction.ai_generation_keys add constraint ai_generation_keys_job_fk
  foreign key (current_job_id) references race_prediction.ai_generation_jobs(id) on delete restrict;
alter table race_prediction.ai_generation_keys add constraint ai_generation_keys_prediction_fk
  foreign key (completed_prediction_id) references race_prediction.ai_prediction_bundles(id) on delete restrict;
alter table race_prediction.ai_generation_jobs add constraint ai_generation_jobs_prediction_fk
  foreign key (prediction_id) references race_prediction.ai_prediction_bundles(id) on delete restrict;

alter table race_prediction.ai_prediction_bundles enable row level security;
alter table race_prediction.ai_generation_jobs enable row level security;
alter table race_prediction.ai_generation_attempts enable row level security;
alter table race_prediction.ai_generation_keys enable row level security;
revoke all on all tables in schema race_prediction from public, anon, authenticated;
grant usage on schema race_prediction to service_role;
grant all on all tables in schema race_prediction to service_role;

create or replace function race_prediction.get_input(p_race_date date, p_stadium_code smallint, p_race_number smallint)
returns jsonb language plpgsql security definer set search_path = race_prediction, race_data, pg_catalog as $$
declare v_row record; v_program jsonb; v_preview jsonb;
begin
  select r.id race_id, r.race_date, r.stadium_code, r.race_number, h.current_batch_id batch_id,
         h.last_success_at, ir.fetched_at, sc.code source_code, sr.program_component_id, sr.preview_component_id,
         sr.program_presence, sr.preview_presence, pc.raw_json program_raw, vc.raw_json preview_raw, rp.closed_at
    into v_row
    from race_data.sources sc
    join race_data.day_heads h on h.source_id = sc.id and h.race_date = p_race_date
    join race_data.normalization_batches nb on nb.id = h.current_batch_id and nb.state in ('ready','published')
    join race_data.snapshot_races sr on sr.batch_id = nb.id
    join race_data.races r on r.id = sr.race_id and r.race_date = p_race_date and r.stadium_code = p_stadium_code and r.race_number = p_race_number
    join race_data.race_components pc on pc.id = sr.program_component_id and pc.kind = 'program'
    left join race_data.race_components vc on vc.id = sr.preview_component_id and vc.kind = 'preview'
    left join race_data.component_projections pp on pp.id = sr.program_projection_id
    left join race_data.race_programs rp on rp.projection_id = pp.id
    left join race_data.ingestion_runs ir on ir.id = h.current_run_id
   where sc.code = 'boatraceopenapi-v1' and sr.program_presence = 'value'
   limit 1;
  if not found then return null; end if;
  v_program := race_prediction.strip_result_fields(coalesce(v_row.program_raw, '{}'::jsonb));
  v_preview := case when v_row.preview_presence in ('missing','null') then null else v_row.preview_raw end;
  return jsonb_build_object(
    'raceId',v_row.race_id,
    'identity',jsonb_build_object('raceDate',v_row.race_date,'stadiumCode',v_row.stadium_code,'raceNumber',v_row.race_number),
    'programRaw',v_program,'previewRaw',v_preview,
    'presence',jsonb_build_object('program',v_row.program_presence,'preview',v_row.preview_presence),
    'closedAt',v_row.closed_at,
    'provenance',jsonb_build_object('sourceCode',v_row.source_code,'fetchedAt',v_row.fetched_at,'lastConfirmedAt',v_row.last_success_at,
      'batchId',v_row.batch_id,'programComponentId',v_row.program_component_id,'previewComponentId',v_row.preview_component_id,'readAt',clock_timestamp())
  );
end $$;

create or replace function race_prediction.claim_job(p_reuse_key text, p_race_id uuid, p_identity jsonb,
  p_closed_at timestamptz, p_facts_hash text, p_config_hash text, p_input_bundle jsonb, p_config jsonb, p_timeout_ms integer)
returns jsonb language plpgsql security definer set search_path = race_prediction, race_data, pg_catalog as $$
declare v_key race_prediction.ai_generation_keys; v_job race_prediction.ai_generation_jobs; v_now timestamptz := clock_timestamp(); v_owner uuid := gen_random_uuid(); v_id uuid := gen_random_uuid(); v_expires timestamptz; v_admitted_at timestamptz;
begin
  v_admitted_at := v_now;
  if p_timeout_ms < 1 or p_timeout_ms > 90000 or p_identity->>'raceDate' <> to_char(v_now at time zone 'Asia/Tokyo','YYYY-MM-DD') or p_closed_at <= v_now then
    return jsonb_build_object('state','rejected');
  end if;
  perform set_config('statement_timeout', p_timeout_ms::text || 'ms', true);
  perform set_config('lock_timeout', least(p_timeout_ms,5000)::text || 'ms', true);
  if not exists(select 1 from race_data.races where id=p_race_id and race_date=(p_identity->>'raceDate')::date and stadium_code=(p_identity->>'stadiumCode')::smallint and race_number=(p_identity->>'raceNumber')::smallint) then
    return jsonb_build_object('state','rejected');
  end if;
  insert into race_prediction.ai_generation_keys(reuse_key) values(p_reuse_key) on conflict do nothing;
  select * into v_key from race_prediction.ai_generation_keys where reuse_key=p_reuse_key for update;
  v_now := clock_timestamp(); v_expires := v_admitted_at + make_interval(secs => p_timeout_ms::numeric / 1000);
  if p_identity->>'raceDate' <> to_char(v_now at time zone 'Asia/Tokyo','YYYY-MM-DD') or p_closed_at <= v_now or v_expires <= v_now then
    return jsonb_build_object('state','rejected');
  end if;
  if v_key.completed_prediction_id is not null then
    return jsonb_build_object('state','existing','prediction', (select to_jsonb(b) from race_prediction.ai_prediction_bundles b where b.id=v_key.completed_prediction_id));
  end if;
  if v_key.current_job_id is not null then
    select * into v_job from race_prediction.ai_generation_jobs where id=v_key.current_job_id for update;
    if v_job.state='generating' and v_job.expires_at > v_now then
      return jsonb_build_object('state','busy','jobId',v_job.id,'expiresAt',v_job.expires_at,'retryAfterMs',2000);
    end if;
    if v_job.state='generating' then update race_prediction.ai_generation_jobs set state='expired',finished_at=v_now,error_code='deadline_expired' where id=v_job.id; end if;
  end if;
  insert into race_prediction.ai_generation_jobs(id,reuse_key,race_id,identity,state,owner_token,admitted_at,expires_at,closed_at_at_admission,facts_hash,config_hash,input_bundle,config_snapshot)
  values(v_id,p_reuse_key,p_race_id,p_identity,'generating',v_owner,v_admitted_at,v_expires,p_closed_at,p_facts_hash,p_config_hash,p_input_bundle,p_config);
  update race_prediction.ai_generation_keys set current_job_id=v_id where reuse_key=p_reuse_key;
  return jsonb_build_object('state','created','jobId',v_id,'ownerToken',v_owner,'expiresAt',v_expires);
end $$;

create or replace function race_prediction.begin_attempt(p_job_id uuid, p_owner uuid, p_sequence smallint, p_model text)
returns jsonb language plpgsql security definer set search_path = race_prediction, pg_catalog as $$
declare v_job race_prediction.ai_generation_jobs;
begin
  select * into v_job from race_prediction.ai_generation_jobs where id=p_job_id for update;
  if not found or v_job.owner_token<>p_owner or v_job.state<>'generating' or v_job.expires_at<=clock_timestamp() or p_sequence <> v_job.attempt_count+1 or p_sequence>2 then return jsonb_build_object('sendAuthorized',false); end if;
  insert into race_prediction.ai_generation_attempts(job_id,sequence,state,model) values(p_job_id,p_sequence,'started',p_model) on conflict do nothing;
  if not found then return jsonb_build_object('sendAuthorized',false); end if;
  update race_prediction.ai_generation_jobs set attempt_count=p_sequence where id=p_job_id;
  return jsonb_build_object('sendAuthorized',true);
end $$;

create or replace function race_prediction.finish_attempt(p_job_id uuid, p_owner uuid, p_sequence smallint, p_details jsonb)
returns boolean language plpgsql security definer set search_path = race_prediction, pg_catalog as $$
begin
  if not exists(select 1 from race_prediction.ai_generation_jobs where id=p_job_id and owner_token=p_owner and state='generating') then return false; end if;
  update race_prediction.ai_generation_attempts set state=case when coalesce((p_details->>'unknown')::boolean,false) then 'unknown' else 'failed' end,
    prompt_hash=p_details->>'promptHash',request_hash=p_details->>'requestHash',request_payload=p_details->'requestPayload',
    validation_codes=coalesce(p_details->'validationCodes','[]'::jsonb),http_status=nullif(p_details->>'httpStatus','')::integer,
    usage=p_details->'usage',candidate=p_details->'candidate',duration_ms=nullif(p_details->>'durationMs','')::integer,error_code=p_details->>'errorCode',finished_at=clock_timestamp()
  where job_id=p_job_id and sequence=p_sequence and state='started';
  return found;
end $$;

create or replace function race_prediction.finish_prediction(p_job_id uuid, p_owner uuid, p_sequence smallint, p_output jsonb, p_meta jsonb, p_timeout_ms integer)
returns jsonb language plpgsql security definer set search_path = race_prediction, pg_catalog as $$
declare v_job race_prediction.ai_generation_jobs; v_key race_prediction.ai_generation_keys; v_bundle uuid; v_now timestamptz := clock_timestamp(); v_reuse_key text;
begin
  if p_timeout_ms < 1 or p_timeout_ms > 90000 then return jsonb_build_object('saved',false); end if;
  perform set_config('statement_timeout', p_timeout_ms::text || 'ms', true);
  perform set_config('lock_timeout', least(p_timeout_ms,5000)::text || 'ms', true);
  select reuse_key into v_reuse_key from race_prediction.ai_generation_jobs where id=p_job_id;
  if v_reuse_key is null then return jsonb_build_object('saved',false); end if;
  select * into v_key from race_prediction.ai_generation_keys where reuse_key=v_reuse_key for update;
  select * into v_job from race_prediction.ai_generation_jobs where id=p_job_id for update;
  v_now := clock_timestamp();
  if not found or v_job.owner_token<>p_owner then return jsonb_build_object('saved',false); end if;
  if v_job.state='succeeded' and v_job.prediction_id is not null then return jsonb_build_object('saved',true,'predictionId',v_job.prediction_id); end if;
  if v_job.state<>'generating' or v_job.expires_at<=v_now then return jsonb_build_object('saved',false); end if;
  if v_key.current_job_id<>p_job_id then return jsonb_build_object('saved',false); end if;
  if p_sequence<>v_job.attempt_count or not exists (
    select 1 from race_prediction.ai_generation_attempts
     where job_id=p_job_id and sequence=p_sequence and state='started'
  ) then return jsonb_build_object('saved',false); end if;
  insert into race_prediction.ai_prediction_bundles(reuse_key,job_id,race_id,main,counter,hole,narrative,generated_at,provider,model,provider_model_version,input_bundle,config_snapshot,facts_hash,config_hash,request_hash,winning_attempt,usage)
  values(v_job.reuse_key,v_job.id,v_job.race_id,array(select jsonb_array_elements_text(p_output->'main')::smallint),array(select jsonb_array_elements_text(p_output->'counter')::smallint),array(select jsonb_array_elements_text(p_output->'hole')::smallint),p_output->>'narrative',v_now,p_meta->>'provider',p_meta->>'model',p_meta->>'providerModelVersion',v_job.input_bundle,v_job.config_snapshot,v_job.facts_hash,v_job.config_hash,p_meta->>'requestHash',p_sequence,p_meta->'usage') returning id into v_bundle;
  update race_prediction.ai_generation_attempts set state='succeeded',prompt_hash=p_meta->>'promptHash',request_hash=p_meta->>'requestHash',request_payload=p_meta->'requestPayload',candidate=p_output,usage=p_meta->'usage',duration_ms=nullif(p_meta->>'durationMs','')::integer,finished_at=v_now where job_id=p_job_id and sequence=p_sequence and state='started';
  update race_prediction.ai_generation_jobs set state='succeeded',prediction_id=v_bundle,finished_at=v_now where id=p_job_id;
  update race_prediction.ai_generation_keys set completed_prediction_id=v_bundle where reuse_key=v_job.reuse_key;
  return jsonb_build_object('saved',true,'predictionId',v_bundle);
end $$;

create or replace function race_prediction.fail_job(p_job_id uuid, p_owner uuid, p_error text, p_retryable boolean)
returns boolean language plpgsql security definer set search_path = race_prediction, pg_catalog as $$
begin
  update race_prediction.ai_generation_jobs set state='failed',finished_at=clock_timestamp(),error_code=left(p_error,80),retryable=p_retryable
   where id=p_job_id and owner_token=p_owner and state='generating';
  return found;
end $$;

create or replace function race_prediction.read_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = race_prediction, pg_catalog as $$
declare v_job race_prediction.ai_generation_jobs; v_bundle race_prediction.ai_prediction_bundles;
begin
  select * into v_job from race_prediction.ai_generation_jobs where id=p_job_id for update;
  if not found then return null; end if;
  if v_job.state='generating' and v_job.expires_at<=clock_timestamp() then update race_prediction.ai_generation_jobs set state='expired',finished_at=clock_timestamp(),error_code='deadline_expired' where id=p_job_id returning * into v_job; end if;
  if v_job.state='succeeded' then
    select * into v_bundle from race_prediction.ai_prediction_bundles where id=v_job.prediction_id;
    return jsonb_build_object('state','succeeded','prediction',jsonb_build_object('snapshotId',v_bundle.id,'main',v_bundle.main,'counter',v_bundle.counter,'hole',v_bundle.hole,'narrative',v_bundle.narrative,'narrativeStatus','success'));
  end if;
  return jsonb_build_object('state',v_job.state,'expiresAt',v_job.expires_at,
    'retryable',(v_job.state='expired' or (v_job.state='failed' and v_job.retryable is true))
      and v_job.closed_at_at_admission>clock_timestamp()
      and v_job.identity->>'raceDate'=to_char(clock_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD'));
end $$;

create function public.race_prediction_get_ai_input(p_race_date date,p_stadium_code smallint,p_race_number smallint) returns jsonb language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.get_input($1,$2,$3) $$;
create function public.race_prediction_claim_ai_job(p_reuse_key text,p_race_id uuid,p_identity jsonb,p_closed_at timestamptz,p_facts_hash text,p_config_hash text,p_input_bundle jsonb,p_config jsonb,p_timeout_ms integer) returns jsonb language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.claim_job($1,$2,$3,$4,$5,$6,$7,$8,$9) $$;
create function public.race_prediction_begin_ai_attempt(p_job_id uuid,p_owner uuid,p_sequence smallint,p_model text) returns jsonb language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.begin_attempt($1,$2,$3,$4) $$;
create function public.race_prediction_finish_ai_attempt(p_job_id uuid,p_owner uuid,p_sequence smallint,p_details jsonb) returns boolean language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.finish_attempt($1,$2,$3,$4) $$;
create function public.race_prediction_finish_ai_job(p_job_id uuid,p_owner uuid,p_sequence smallint,p_output jsonb,p_meta jsonb,p_timeout_ms integer) returns jsonb language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.finish_prediction($1,$2,$3,$4,$5,$6) $$;
create function public.race_prediction_fail_ai_job(p_job_id uuid,p_owner uuid,p_error text,p_retryable boolean) returns boolean language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.fail_job($1,$2,$3,$4) $$;
create function public.race_prediction_read_ai_job(p_job_id uuid) returns jsonb language sql security definer set search_path=race_prediction,pg_catalog as $$ select race_prediction.read_job($1) $$;

revoke all on all functions in schema race_prediction from public, anon, authenticated;
grant execute on function race_prediction.valid_pick(smallint[]) to service_role;
revoke all on function public.race_prediction_get_ai_input(date,smallint,smallint),public.race_prediction_claim_ai_job(text,uuid,jsonb,timestamptz,text,text,jsonb,jsonb,integer),public.race_prediction_begin_ai_attempt(uuid,uuid,smallint,text),public.race_prediction_finish_ai_attempt(uuid,uuid,smallint,jsonb),public.race_prediction_finish_ai_job(uuid,uuid,smallint,jsonb,jsonb,integer),public.race_prediction_fail_ai_job(uuid,uuid,text,boolean),public.race_prediction_read_ai_job(uuid) from public,anon,authenticated;
grant execute on function public.race_prediction_get_ai_input(date,smallint,smallint),public.race_prediction_claim_ai_job(text,uuid,jsonb,timestamptz,text,text,jsonb,jsonb,integer),public.race_prediction_begin_ai_attempt(uuid,uuid,smallint,text),public.race_prediction_finish_ai_attempt(uuid,uuid,smallint,jsonb),public.race_prediction_finish_ai_job(uuid,uuid,smallint,jsonb,jsonb,integer),public.race_prediction_fail_ai_job(uuid,uuid,text,boolean),public.race_prediction_read_ai_job(uuid) to service_role;
