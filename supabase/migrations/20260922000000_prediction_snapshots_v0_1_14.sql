-- v0.1.14: immutable roulette prediction snapshots.
-- The browser never writes this table directly; the prediction Edge Function
-- uses the service-role wrapper after calculating a result.
create schema if not exists race_prediction;
comment on schema race_prediction is 'Prediction snapshots and Gemini narrative attempts; source data remains in race_data.';
revoke all on schema race_prediction from public, anon, authenticated;
grant usage on schema race_prediction to service_role;

create table if not exists race_prediction.prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references race_data.races(id),
  generated_at timestamptz not null default now(),
  score_as_of timestamptz not null,
  status text not null check (status in ('success','partial','gemini_error','stale','api_error','closed')),
  config_version text not null,
  logic_version text not null,
  reuse_key text not null,
  input_data_hash text not null,
  main smallint[] check (main is null or cardinality(main)=3),
  counter smallint[] check (counter is null or cardinality(counter)=3),
  hole smallint[] check (hole is null or cardinality(hole)=3),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists prediction_snapshots_reuse_key_uq
  on race_prediction.prediction_snapshots (reuse_key);
create index if not exists prediction_snapshots_race_time_idx
  on race_prediction.prediction_snapshots (race_id, generated_at desc);
revoke all on race_prediction.prediction_snapshots from public, anon, authenticated;
  grant select, insert on race_prediction.prediction_snapshots to service_role;

create table if not exists race_prediction.prediction_generation_leases (
  reuse_key text primary key,
  lease_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
revoke all on race_prediction.prediction_generation_leases from public, anon, authenticated;
grant select, insert, update, delete on race_prediction.prediction_generation_leases to service_role;

create or replace function race_prediction.acquire_prediction_generation(
  p_reuse_key text, p_lease_seconds integer default 30
) returns jsonb language plpgsql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
declare v_lease race_prediction.prediction_generation_leases%rowtype; v_prediction uuid; v_token uuid := gen_random_uuid();
begin
  select id into v_prediction from race_prediction.prediction_snapshots where reuse_key = p_reuse_key;
  if v_prediction is not null then
    return jsonb_build_object('state','existing','prediction_id',v_prediction);
  end if;
  select * into v_lease from race_prediction.prediction_generation_leases where reuse_key = p_reuse_key for update;
  if not found then
    insert into race_prediction.prediction_generation_leases(reuse_key,lease_token,lease_until)
      values (p_reuse_key,v_token,now()+make_interval(secs=>greatest(coalesce(p_lease_seconds,30),5)));
    return jsonb_build_object('state','acquired','lease_token',v_token);
  end if;
  if v_lease.lease_until <= now() then
    update race_prediction.prediction_generation_leases
      set lease_token=v_token, lease_until=now()+make_interval(secs=>greatest(coalesce(p_lease_seconds,30),5))
      where reuse_key=p_reuse_key;
    return jsonb_build_object('state','acquired','lease_token',v_token);
  end if;
  return jsonb_build_object('state','busy','retry_after',greatest(1,ceil(extract(epoch from (v_lease.lease_until-now())))::integer));
end;
$$;
revoke all on function race_prediction.acquire_prediction_generation(text,integer) from public,anon,authenticated;
grant execute on function race_prediction.acquire_prediction_generation(text,integer) to service_role;

create or replace function race_prediction.create_prediction_snapshot(
  p_race_id uuid, p_generated_at timestamptz, p_score_as_of timestamptz,
  p_status text, p_config_version text, p_logic_version text,
  p_reuse_key text, p_input_data_hash text, p_main smallint[], p_counter smallint[],
  p_hole smallint[], p_payload jsonb
) returns uuid
language plpgsql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
declare v_id uuid;
begin
  insert into race_prediction.prediction_snapshots(
    race_id, generated_at, score_as_of, status, config_version, logic_version, reuse_key,
    input_data_hash, main, counter, hole, payload
  ) values (
    p_race_id, coalesce(p_generated_at, now()), coalesce(p_score_as_of, now()),
    p_status, p_config_version, p_logic_version, p_reuse_key, p_input_data_hash,
    p_main, p_counter, p_hole, coalesce(p_payload, '{}'::jsonb)
  ) on conflict (reuse_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from race_prediction.prediction_snapshots where reuse_key=p_reuse_key; end if;
  return v_id;
end;
$$;
revoke all on function race_prediction.create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,text,smallint[],smallint[],smallint[],jsonb) from public,anon,authenticated;
grant execute on function race_prediction.create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,text,smallint[],smallint[],smallint[],jsonb) to service_role;

create or replace function public.race_data_create_prediction_snapshot(
  p_race_id uuid, p_generated_at timestamptz, p_score_as_of timestamptz,
  p_status text, p_config_version text, p_logic_version text,
  p_reuse_key text, p_input_data_hash text, p_main smallint[], p_counter smallint[],
  p_hole smallint[], p_payload jsonb
) returns uuid language sql security definer
set search_path = public, race_prediction, race_data, extensions, pg_catalog
as $$ select race_prediction.create_prediction_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;
revoke all on function public.race_data_create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,text,smallint[],smallint[],smallint[],jsonb) from public,anon,authenticated;
grant execute on function public.race_data_create_prediction_snapshot(uuid,timestamptz,timestamptz,text,text,text,text,text,smallint[],smallint[],smallint[],jsonb) to service_role;

create or replace function public.race_data_acquire_prediction_generation(p_reuse_key text,p_lease_seconds integer default 30)
returns jsonb language sql security definer set search_path=public,race_prediction,race_data,extensions,pg_catalog
as $$ select race_prediction.acquire_prediction_generation($1,$2); $$;
revoke all on function public.race_data_acquire_prediction_generation(text,integer) from public,anon,authenticated;
grant execute on function public.race_data_acquire_prediction_generation(text,integer) to service_role;
