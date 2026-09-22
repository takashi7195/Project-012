-- v0.1.14: immutable Gemini narrative attempts. Prediction snapshots are never updated.
create table if not exists race_prediction.narrative_attempts (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references race_prediction.prediction_snapshots(id),
  attempt_sequence integer not null,
  model text not null,
  prompt_version text not null,
  prompt_hash text not null,
  narrative_input_hash text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('success','error')),
  text text,
  validated_facts jsonb not null default '[]'::jsonb,
  error_code text,
  sanitized_error text,
  error_at timestamptz,
  token_usage jsonb,
  duration_ms integer,
  created_at timestamptz not null default now(),
  unique (prediction_id, attempt_sequence)
);
create index if not exists narrative_attempts_prediction_time_idx
  on race_prediction.narrative_attempts (prediction_id, created_at desc);
revoke all on race_prediction.narrative_attempts from public, anon, authenticated;
grant select, insert on race_prediction.narrative_attempts to service_role;

create or replace function race_prediction.get_prediction_snapshot(p_prediction_id uuid)
returns jsonb language sql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id, 'race_id', p.race_id, 'generated_at', p.generated_at,
    'score_as_of', p.score_as_of, 'status', p.status,
    'config_version', p.config_version, 'logic_version', p.logic_version,
    'input_data_hash', p.input_data_hash, 'main', p.main,
    'counter', p.counter, 'hole', p.hole, 'payload', p.payload
  ) from race_prediction.prediction_snapshots p where p.id = p_prediction_id;
$$;
revoke all on function race_prediction.get_prediction_snapshot(uuid) from public,anon,authenticated;
grant execute on function race_prediction.get_prediction_snapshot(uuid) to service_role;

create or replace function race_prediction.create_narrative_attempt(
  p_prediction_id uuid, p_model text, p_prompt_version text, p_prompt_hash text,
  p_narrative_input_hash text, p_started_at timestamptz, p_finished_at timestamptz,
  p_status text, p_text text, p_validated_facts jsonb, p_error_code text,
  p_sanitized_error text, p_error_at timestamptz, p_token_usage jsonb, p_duration_ms integer
) returns uuid language plpgsql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
declare v_id uuid; v_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_prediction_id::text));
  select coalesce(max(attempt_sequence), 0) + 1 into v_sequence
    from race_prediction.narrative_attempts where prediction_id = p_prediction_id;
  insert into race_prediction.narrative_attempts(
    prediction_id, attempt_sequence, model, prompt_version, prompt_hash,
    narrative_input_hash, started_at, finished_at, status, text, validated_facts,
    error_code, sanitized_error, error_at, token_usage, duration_ms
  ) values (
    p_prediction_id, v_sequence, p_model, p_prompt_version, p_prompt_hash,
    p_narrative_input_hash, p_started_at, p_finished_at, p_status, p_text,
    coalesce(p_validated_facts, '[]'::jsonb), p_error_code,
    left(p_sanitized_error, 1200), p_error_at, p_token_usage, p_duration_ms
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function race_prediction.create_narrative_attempt(uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,text,text,timestamptz,jsonb,integer) from public,anon,authenticated;
grant execute on function race_prediction.create_narrative_attempt(uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,text,text,timestamptz,jsonb,integer) to service_role;

-- Replace the base reader after narrative_attempts exists so a reused
-- prediction can return its latest successful narrative without changing the
-- immutable prediction payload.
create or replace function race_prediction.get_prediction_snapshot(p_prediction_id uuid)
returns jsonb language sql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id, 'race_id', p.race_id, 'generated_at', p.generated_at,
    'score_as_of', p.score_as_of, 'status', p.status,
    'config_version', p.config_version, 'logic_version', p.logic_version,
    'input_data_hash', p.input_data_hash, 'main', p.main,
    'counter', p.counter, 'hole', p.hole, 'payload', p.payload,
    'narrative', coalesce((select jsonb_build_object('status', a.status, 'text', a.text, 'error_code', a.error_code)
      from race_prediction.narrative_attempts a where a.prediction_id=p.id and a.status='success'
      order by a.attempt_sequence desc limit 1), '{}'::jsonb)
  ) from race_prediction.prediction_snapshots p where p.id = p_prediction_id;
$$;

create or replace function public.race_data_get_prediction_snapshot(p_prediction_id uuid)
returns jsonb language sql security definer
set search_path = public, race_prediction, race_data, extensions, pg_catalog
as $$ select race_prediction.get_prediction_snapshot($1); $$;
revoke all on function public.race_data_get_prediction_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.race_data_get_prediction_snapshot(uuid) to service_role;

create or replace function public.race_data_create_narrative_attempt(
  p_prediction_id uuid, p_model text, p_prompt_version text, p_prompt_hash text,
  p_narrative_input_hash text, p_started_at timestamptz, p_finished_at timestamptz,
  p_status text, p_text text, p_validated_facts jsonb, p_error_code text,
  p_sanitized_error text, p_error_at timestamptz, p_token_usage jsonb, p_duration_ms integer
) returns uuid language sql security definer
set search_path = public, race_prediction, race_data, extensions, pg_catalog
as $$ select race_prediction.create_narrative_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15); $$;
revoke all on function public.race_data_create_narrative_attempt(uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,text,text,timestamptz,jsonb,integer) from public,anon,authenticated;
grant execute on function public.race_data_create_narrative_attempt(uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,text,text,timestamptz,jsonb,integer) to service_role;
