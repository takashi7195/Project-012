select jsonb_build_object(
  'existing', public.race_data_list_race_versions('2026-09-20'::date,1::smallint,1::smallint,10),
  'no_match', public.race_data_list_race_versions('2026-09-20'::date,99::smallint,1::smallint,10)
) as smoke;
