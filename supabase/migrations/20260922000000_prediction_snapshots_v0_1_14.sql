-- v0.1.14: immutable roulette prediction snapshots.
-- The browser never writes this table directly; the prediction Edge Function
-- uses the service-role wrapper after calculating a result.
create table if not exists race_data.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_data.races(id),
  generated_at timestamptz not null default now(),
  score_as_of timestamptz not null,
  status text not null check (status in ('success','partial','gemini_error','stale','api_error','closed')),
  config_version text not null,
  logic_version text not null,
  input_data_hash text not null,
  main smallint[] check (main is null or cardinality(main)=3),
  counter smallint[] check (counter is null or cardinality(counter)=3),
  hole smallint[] check (hole is null or cardinality(hole)=3),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists prediction_snapshots_race_time_idx
  on race_data.prediction_snapshots (race_id, generated_at desc);

create or replace function race_data.create_prediction_snapshot(
  p_race_id uuid, p_generated_at timestamptz, p_score_as_of timestamptz,
  p_status text, p_config_version text, p_logic_version text,
  p_input_data_hash text, p_main smallint[], p_counter smallint[],
  p_hole smallint[], p_payload jsonb
) returns uuid
language plpgsql security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare v_id uuid;
begin
  insert into race_data.prediction_snapshots(
    race_id, generated_at, score_as_of, status, config_version, logic_version,
    input_data_hash, main, counter, hole, payload
  ) values (
    p_race_id, coalesce(p_generated_at, now()), coalesce(p_score_as_of, now()),
    p_status, p_config_version, p_logic_version, p_input_data_hash,
    p_main, p_counter, p_hole, coalesce(p_payload, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function race_data.create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,smallint[],smallint[],smallint[],jsonb) from public,anon,authenticated;
grant execute on function race_data.create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,smallint[],smallint[],smallint[],jsonb) to service_role;

create or replace function public.race_data_create_prediction_snapshot(
  p_race_id uuid, p_generated_at timestamptz, p_score_as_of timestamptz,
  p_status text, p_config_version text, p_logic_version text,
  p_input_data_hash text, p_main smallint[], p_counter smallint[],
  p_hole smallint[], p_payload jsonb
) returns uuid language sql security definer
set search_path = public, race_data, extensions, pg_catalog
as $$ select race_data.create_prediction_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
revoke all on function public.race_data_create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,smallint[],smallint[],smallint[],jsonb) from public,anon,authenticated;
grant execute on function public.race_data_create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,smallint[],smallint[],smallint[],jsonb) to service_role;
