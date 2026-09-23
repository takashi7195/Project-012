-- Local integration fixture only. Never apply this file to a hosted project.
-- The date/stadium/title/raw hash identify every row created by this fixture.
select * from race_data.ingest_snapshot(
  'boatraceopenapi-v1',
  date '2099-12-31',
  'local-v0.1.14-prediction-fixture',
  jsonb_build_object(
    'raceCount', 1,
    'records', jsonb_build_array(jsonb_build_object(
      'race', jsonb_build_object('raceDate','2099-12-31','stadiumCode',99,'raceNumber',1),
      'components', jsonb_build_array(
        jsonb_build_object('kind','program','rawHash','local-v0.1.14-prediction-fixture-program','rawJson','{}'::jsonb,'presence','value'),
        jsonb_build_object('kind','preview','rawHash','local-v0.1.14-prediction-fixture-preview','rawJson','{}'::jsonb,'presence','value'),
        jsonb_build_object('kind','result','rawHash','local-v0.1.14-prediction-fixture-result','rawJson','{}'::jsonb,'presence','empty')
      ),
      'program', jsonb_build_object(
        'presence','value',
        'common', jsonb_build_object('closedAtSource','2099-12-31 23:00:00','title','LOCAL_TEST_FIXTURE_v0.1.14','subtitle','integration','grade','TEST','distanceM',1800,'dayNumber',1),
        'entries', (select jsonb_agg(jsonb_build_object(
          'entryNumber', n, 'registrationNumber', 99000+n, 'name', 'Fixture Racer '||n,
          'rank', case when n=1 then 'A1' when n<=3 then 'A2' else 'B1' end,
          'age', 25+n, 'weightKg', 52+n, 'averageStartTiming', 0.12+(n*0.01),
          'nationalWinRate', 6.0-(n*0.1), 'localWinRate', 6.2-(n*0.12),
          'motorNumber', 20+n, 'hullNumber', 30+n,
          'raw', jsonb_build_object('fixture',true,'fixtureId','local-v0.1.14-prediction-fixture')
        ) order by n) from generate_series(1,6) as g(n))
      ),
      'preview', jsonb_build_object(
        'presence','value',
        'common', jsonb_build_object('weather',1,'windDirection',2,'windSpeed',2,'waveHeight',1,'airTemperature',20,'waterTemperature',18),
        'entries', (select jsonb_agg(jsonb_build_object(
          'entryNumber', n, 'course', n, 'startTiming', 0.08+(n*0.005),
          'weightKg', 52+n, 'weightAdjustmentKg', 0, 'exhibitionTime', 6.70+(n*0.01), 'tilt', 0,
          'propeller', '{}'::jsonb, 'parts', '{}'::jsonb, 'raw', jsonb_build_object('fixture',true)
        ) order by n) from generate_series(1,6) as g(n))
      ),
      'result', jsonb_build_object('presence','empty','common',jsonb_build_object(),'entries',jsonb_build_array(),'payouts',jsonb_build_array(),'refunds',jsonb_build_array())
    ))
  ),
  now(), 'local-fixture-parser-v1', 'local-fixture-rules-v1', true
);
