-- v0.1.11 rollback. Run only after verifying the target is Project-012 and
-- only when the race_data experiment must be removed. This does not touch public.comments.
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'race_data') then
    raise notice 'race_data does not exist; nothing to remove';
  else
    drop schema race_data cascade;
  end if;
end;
$$;
