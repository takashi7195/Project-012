-- Fix concurrent generation acquisition without changing the public RPC contract.
-- This migration is intentionally additive: the original v0.1.14 migration is
-- left unchanged so hosted migration history remains reproducible.
create or replace function race_prediction.acquire_prediction_generation(
  p_reuse_key text, p_lease_seconds integer default 30
) returns jsonb language plpgsql security definer
set search_path = race_prediction, race_data, extensions, pg_catalog
as $$
declare
  v_lease race_prediction.prediction_generation_leases%rowtype;
  v_prediction uuid;
  v_token uuid := gen_random_uuid();
  v_until timestamptz := now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 30), 5));
begin
  select id into v_prediction
    from race_prediction.prediction_snapshots
   where reuse_key = p_reuse_key;
  if v_prediction is not null then
    return jsonb_build_object('state','existing','prediction_id',v_prediction);
  end if;

  -- INSERT ... ON CONFLICT is the atomic arbitration point. A concurrent
  -- loser waits for the winner's unique-key decision, then observes the lease
  -- row below instead of leaking a 23505 to the caller.
  insert into race_prediction.prediction_generation_leases(reuse_key, lease_token, lease_until)
    values (p_reuse_key, v_token, v_until)
    on conflict (reuse_key) do nothing;
  if found then
    return jsonb_build_object('state','acquired','lease_token',v_token);
  end if;

  select * into v_lease
    from race_prediction.prediction_generation_leases
   where reuse_key = p_reuse_key
   for update;
  if not found then
    -- The row can only disappear between the arbitration statement and this
    -- read if an operator explicitly deletes it. Retry the atomic insert once.
    insert into race_prediction.prediction_generation_leases(reuse_key, lease_token, lease_until)
      values (p_reuse_key, v_token, v_until)
      on conflict (reuse_key) do nothing;
    if found then
      return jsonb_build_object('state','acquired','lease_token',v_token);
    end if;
    select * into v_lease
      from race_prediction.prediction_generation_leases
     where reuse_key = p_reuse_key
     for update;
  end if;
  if v_lease.lease_until <= now() then
    update race_prediction.prediction_generation_leases
       set lease_token = v_token, lease_until = v_until
     where reuse_key = p_reuse_key;
    return jsonb_build_object('state','acquired','lease_token',v_token);
  end if;
  return jsonb_build_object('state','busy','retry_after',greatest(1,ceil(extract(epoch from (v_lease.lease_until-now())))::integer));
end;
$$;
revoke all on function race_prediction.acquire_prediction_generation(text,integer) from public,anon,authenticated;
grant execute on function race_prediction.acquire_prediction_generation(text,integer) to service_role;

create or replace function public.race_data_acquire_prediction_generation(p_reuse_key text,p_lease_seconds integer default 30)
returns jsonb language sql security definer
set search_path=public,race_prediction,race_data,extensions,pg_catalog
as $$ select race_prediction.acquire_prediction_generation($1,$2); $$;
revoke all on function public.race_data_acquire_prediction_generation(text,integer) from public,anon,authenticated;
grant execute on function public.race_data_acquire_prediction_generation(text,integer) to service_role;
