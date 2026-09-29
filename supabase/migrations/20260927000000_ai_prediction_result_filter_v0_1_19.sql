-- Additive correction for the already-applied v0.1.19 input-filter migration.
-- Keep 20260926000000 immutable: some environments may already have applied it.
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
     where key not in ('result','payouts','refunds','actual_course','actual_start_timing','finish_position','place_number','place_number_source',
       'existing_prediction','ai_prediction','prediction_snapshot');
    return v_result;
  end if;
  return p_value;
end $$;
