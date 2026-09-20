select jsonb_build_object(
  'summary', (public.race_data_coverage_report('2026-08-22'::date,'2026-09-20'::date))->'summary',
  'warnings', (public.race_data_coverage_report('2026-08-22'::date,'2026-09-20'::date))->'warnings',
  'invalid_warnings', (public.race_data_coverage_report('2026-09-21'::date,'2026-09-20'::date))->'warnings'
) as smoke;
