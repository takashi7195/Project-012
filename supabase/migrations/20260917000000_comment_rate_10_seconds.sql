-- Trial-stage rate limit: allow one comment per environment every 10 seconds.
create or replace function public.claim_comment_rate_limit(p_rate_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into public.comment_rate_limits (rate_key, last_post_at)
  values (p_rate_key, pg_catalog.now())
  on conflict (rate_key) do update
    set last_post_at = excluded.last_post_at
    where public.comment_rate_limits.last_post_at <= pg_catalog.now() - interval '10 seconds';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_comment_rate_limit(text) from public, anon, authenticated;
grant execute on function public.claim_comment_rate_limit(text) to service_role;
