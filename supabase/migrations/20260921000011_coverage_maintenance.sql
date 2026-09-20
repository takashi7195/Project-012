-- Keep the designed coverage table synchronized with each published/staged batch.
create or replace function race_data.refresh_coverage_for_snapshot_race()
returns trigger
language plpgsql security definer
set search_path = race_data, extensions, pg_catalog
as $$
declare
  v_stadium smallint;
begin
  select stadium_code into v_stadium from race_data.races where id = new.race_id;
  if v_stadium is null then return new; end if;
  insert into race_data.coverage(batch_id,scope,stadium_code,program_count,preview_count,result_count,unknown_count,basis,issues)
  select new.batch_id,'stadium',v_stadium,
         count(*) filter (where program_projection_id is not null),
         count(*) filter (where preview_projection_id is not null),
         count(*) filter (where result_projection_id is not null),
         count(*) filter (where result_presence in ('missing','null','empty','invalid')),
         'snapshot_races','[]'::jsonb
    from race_data.snapshot_races sr join race_data.races r on r.id=sr.race_id
   where sr.batch_id=new.batch_id and r.stadium_code=v_stadium
  on conflict (batch_id,scope,stadium_code) do update set
    program_count=excluded.program_count,preview_count=excluded.preview_count,
    result_count=excluded.result_count,unknown_count=excluded.unknown_count,
    basis=excluded.basis,issues=excluded.issues;
  insert into race_data.coverage(batch_id,scope,stadium_code,program_count,preview_count,result_count,unknown_count,basis,issues)
  select new.batch_id,'all',0,
         count(*) filter (where program_projection_id is not null),
         count(*) filter (where preview_projection_id is not null),
         count(*) filter (where result_projection_id is not null),
         count(*) filter (where result_presence in ('missing','null','empty','invalid')),
         'snapshot_races','[]'::jsonb
    from race_data.snapshot_races where batch_id=new.batch_id
  on conflict (batch_id,scope,stadium_code) do update set
    program_count=excluded.program_count,preview_count=excluded.preview_count,
    result_count=excluded.result_count,unknown_count=excluded.unknown_count,
    basis=excluded.basis,issues=excluded.issues;
  return new;
end;
$$;

drop trigger if exists snapshot_races_coverage_trigger on race_data.snapshot_races;
create trigger snapshot_races_coverage_trigger
after insert or update of program_projection_id,preview_projection_id,result_projection_id,program_presence,preview_presence,result_presence
on race_data.snapshot_races
for each row execute function race_data.refresh_coverage_for_snapshot_race();

revoke all on function race_data.refresh_coverage_for_snapshot_race() from public,anon,authenticated;
grant execute on function race_data.refresh_coverage_for_snapshot_race() to service_role;

-- Backfill coverage for batches that existed before the trigger was installed.
insert into race_data.coverage(batch_id,scope,stadium_code,program_count,preview_count,result_count,unknown_count,basis,issues)
select sr.batch_id,'all',0,
       count(*) filter (where sr.program_projection_id is not null),
       count(*) filter (where sr.preview_projection_id is not null),
       count(*) filter (where sr.result_projection_id is not null),
       count(*) filter (where sr.result_presence in ('missing','null','empty','invalid')),
       'snapshot_races','[]'::jsonb
  from race_data.snapshot_races sr group by sr.batch_id
on conflict (batch_id,scope,stadium_code) do update set
  program_count=excluded.program_count,preview_count=excluded.preview_count,
  result_count=excluded.result_count,unknown_count=excluded.unknown_count,
  basis=excluded.basis,issues=excluded.issues;
