with rank_filter as (
  select public.race_data_search_current_races_filtered(null::date,null::date,null::smallint,null::smallint,null::smallint,null::integer,null::text,'A1',null::smallint,null::smallint,null::text,null::bigint,null::bigint,3) payload
), payout_filter as (
  select public.race_data_search_current_races_filtered(null::date,null::date,null::smallint,null::smallint,null::smallint,null::integer,null::text,null::text,null::smallint,null::smallint,'trifecta',10000::bigint,null::bigint,3) payload
)
select jsonb_build_object(
  'rank_rows', jsonb_array_length((select payload->'data' from rank_filter)),
  'payout_rows', jsonb_array_length((select payload->'data' from payout_filter)),
  'rank_has_coverage', ((select payload ? 'coverage' from rank_filter)),
  'payout_has_aggregates', ((select payload ? 'aggregates' from payout_filter))
) as smoke;
