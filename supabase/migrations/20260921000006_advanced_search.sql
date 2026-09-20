-- Additional filters for the administrative search layer. The original
-- seven-argument RPC remains unchanged for compatibility.
create or replace function race_data.search_current_races_filtered(
  p_from date default null,
  p_to date default null,
  p_stadium_code smallint default null,
  p_race_number smallint default null,
  p_entry_number smallint default null,
  p_racer_registration integer default null,
  p_racer_name text default null,
  p_rank_code text default null,
  p_min_age smallint default null,
  p_max_age smallint default null,
  p_bet_type text default null,
  p_min_amount_yen bigint default null,
  p_max_amount_yen bigint default null,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_from date := coalesce(p_from, date '1900-01-01');
  v_to date := coalesce(p_to, date '9999-12-31');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_name text := nullif(lower(regexp_replace(coalesce(p_racer_name, ''), '\s+', '', 'g')), '');
begin
  if v_from > v_to then
    return jsonb_build_object('data','[]'::jsonb,'aggregates',jsonb_build_object(),
      'coverage',jsonb_build_object('matched_races',0,'truncated',false),
      'warnings',jsonb_build_array('invalid_date_range'));
  end if;
  return (
    with current_races as (
      select r.id race_id,r.race_date,r.stadium_code,r.race_number,
             dh.current_batch_id batch_id,dh.last_success_at,
             sr.program_projection_id,sr.preview_projection_id,sr.result_projection_id,
             row_number() over(order by r.race_date desc,r.stadium_code,r.race_number) rn
        from race_data.day_heads dh
        join race_data.normalization_batches b on b.id=dh.current_batch_id and b.state in ('ready','published')
        join race_data.snapshot_races sr on sr.batch_id=b.id
        join race_data.races r on r.id=sr.race_id
       where r.race_date between v_from and v_to
         and (p_stadium_code is null or r.stadium_code=p_stadium_code)
         and (p_race_number is null or r.race_number=p_race_number)
         and (p_entry_number is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and e.entry_number=p_entry_number))
         and (p_racer_registration is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and e.racer_registration_number=p_racer_registration))
         and (p_rank_code is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and e.rank_code=upper(p_rank_code)))
         and (p_min_age is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and e.age_at_race>=p_min_age))
         and (p_max_age is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and e.age_at_race<=p_max_age))
         and (v_name is null or exists(select 1 from race_data.race_entries e where e.projection_id=sr.program_projection_id and coalesce(e.name_search,lower(regexp_replace(coalesce(e.name,''),'\s+','','g'))) ilike '%'||v_name||'%'))
         and (p_bet_type is null or exists(select 1 from race_data.payouts p where p.projection_id=sr.result_projection_id and p.bet_type=p_bet_type and (p_min_amount_yen is null or p.amount_yen>=p_min_amount_yen) and (p_max_amount_yen is null or p.amount_yen<=p_max_amount_yen)))
    ), limited as (select * from current_races where rn<=v_limit),
    result_rows as (
      select l.*,coalesce((select jsonb_agg(jsonb_build_object('entry_number',e.entry_number,'racer_registration_number',e.racer_registration_number,'name',e.name,'rank_code',e.rank_code,'age_at_race',e.age_at_race,'national_win_rate',e.national_win_rate,'local_win_rate',e.local_win_rate,'motor_number',e.motor_number,'hull_number',e.hull_number) order by e.entry_number) from race_data.race_entries e where e.projection_id=l.program_projection_id),'[]'::jsonb) entries,
      coalesce((select jsonb_agg(jsonb_build_object('bet_type',p.bet_type,'combination_entries',p.combination_entries,'amount_yen',p.amount_yen,'label',p.label,'payout_kind',p.payout_kind) order by p.bet_type,p.item_index) from race_data.payouts p where p.projection_id=l.result_projection_id and (p_bet_type is null or p.bet_type=p_bet_type) and (p_min_amount_yen is null or p.amount_yen>=p_min_amount_yen) and (p_max_amount_yen is null or p.amount_yen<=p_max_amount_yen)),'[]'::jsonb) payouts
      from limited l
    ), payout_max as (
      select max(p.amount_yen) amount_yen from race_data.payouts p join current_races l on l.result_projection_id=p.projection_id where p.payout_kind='normal' and (p_bet_type is null or p.bet_type=p_bet_type) and (p_min_amount_yen is null or p.amount_yen>=p_min_amount_yen) and (p_max_amount_yen is null or p.amount_yen<=p_max_amount_yen)
    )
    select jsonb_build_object(
      'data',coalesce((select jsonb_agg(jsonb_build_object('race_id',r.race_id,'race_date',r.race_date,'stadium_code',r.stadium_code,'race_number',r.race_number,'batch_id',r.batch_id,'last_success_at',r.last_success_at,'entries',r.entries,'payouts',r.payouts) order by r.race_date desc,r.stadium_code,r.race_number) from result_rows r),'[]'::jsonb),
      'aggregates',jsonb_build_object('matched_races',(select count(*) from current_races),'returned_races',(select count(*) from limited),'max_normal_payout_yen',(select amount_yen from payout_max)),
      'coverage',jsonb_build_object('from',case when p_from is null then null else p_from::text end,'to',case when p_to is null then null else p_to::text end,'source','boatraceopenapi-v1','published_only',true,'truncated',(select count(*)>v_limit from current_races)),
      'warnings',case when (select count(*) from limited)=0 then jsonb_build_array('no_match') else '[]'::jsonb end)
  );
end;
$$;

revoke all on function race_data.search_current_races_filtered(date,date,smallint,smallint,smallint,integer,text,text,smallint,smallint,text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function race_data.search_current_races_filtered(date,date,smallint,smallint,smallint,integer,text,text,smallint,smallint,text,bigint,bigint,integer) to service_role;

create or replace function public.race_data_search_current_races_filtered(
  p_from date default null,p_to date default null,p_stadium_code smallint default null,p_race_number smallint default null,
  p_entry_number smallint default null,p_racer_registration integer default null,p_racer_name text default null,p_rank_code text default null,
  p_min_age smallint default null,p_max_age smallint default null,p_bet_type text default null,p_min_amount_yen bigint default null,p_max_amount_yen bigint default null,p_limit integer default 100
) returns jsonb language sql security definer set search_path=public,race_data,extensions,pg_catalog as $$
  select race_data.search_current_races_filtered($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14);
$$;
revoke all on function public.race_data_search_current_races_filtered(date,date,smallint,smallint,smallint,integer,text,text,smallint,smallint,text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.race_data_search_current_races_filtered(date,date,smallint,smallint,smallint,integer,text,text,smallint,smallint,text,bigint,bigint,integer) to service_role;
