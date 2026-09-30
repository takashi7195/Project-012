-- Read-only local Supabase least-privilege check for v0.1.19 AI RPCs.
do $check$
declare
  v_function regprocedure;
  v_functions regprocedure[] := array[
    'public.race_prediction_get_ai_input(date,smallint,smallint)'::regprocedure,
    'public.race_prediction_claim_ai_job(text,uuid,jsonb,timestamptz,text,text,jsonb,jsonb,integer)'::regprocedure,
    'public.race_prediction_begin_ai_attempt(uuid,uuid,smallint,text)'::regprocedure,
    'public.race_prediction_finish_ai_attempt(uuid,uuid,smallint,jsonb)'::regprocedure,
    'public.race_prediction_finish_ai_job(uuid,uuid,smallint,jsonb,jsonb,integer)'::regprocedure,
    'public.race_prediction_fail_ai_job(uuid,uuid,text,boolean)'::regprocedure,
    'public.race_prediction_read_ai_job(uuid)'::regprocedure
  ];
begin
  foreach v_function in array v_functions loop
    if has_function_privilege('anon',v_function,'EXECUTE') or has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'public role can execute private AI RPC %',v_function;
    end if;
    if not has_function_privilege('service_role',v_function,'EXECUTE') then
      raise exception 'service_role cannot execute AI RPC %',v_function;
    end if;
  end loop;
  if has_table_privilege('anon','race_prediction.ai_generation_jobs','SELECT') or
     has_table_privilege('authenticated','race_prediction.ai_generation_jobs','SELECT') or
     has_table_privilege('anon','race_prediction.ai_prediction_bundles','SELECT') or
     has_table_privilege('authenticated','race_prediction.ai_prediction_bundles','SELECT') then
    raise exception 'public role can read private generation tables';
  end if;
  if not has_table_privilege('service_role','race_prediction.ai_generation_jobs','SELECT') or
     not has_table_privilege('service_role','race_prediction.ai_prediction_bundles','SELECT') then
    raise exception 'service_role cannot read generation tables';
  end if;
  raise notice 'PASS: anon/authenticated cannot execute AI RPCs or read private tables; service_role retains required access';
end $check$;
