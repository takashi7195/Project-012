-- Allow the Edge Function to record a local template reply when Gemini is
-- unavailable, while keeping the same restricted service_role-only RPC.

begin;

create or replace function public.create_comment_with_reply(
  p_nickname text,
  p_body text,
  p_ai_reply text,
  p_reply_source text
)
returns setof public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment_id uuid;
begin
  if p_reply_source not in ('template', 'gemini', 'empathetic')
     or p_ai_reply is null
     or pg_catalog.char_length(pg_catalog.btrim(p_ai_reply)) not between 1 and 60
     or p_body is null
     or pg_catalog.char_length(pg_catalog.btrim(p_body)) not between 1 and 280
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_nickname, ''))) > 40 then
    raise exception 'invalid comment or reply';
  end if;

  insert into public.comments (nickname, body, ai_reply, reply_index, reply_source)
  values (
    pg_catalog.left(pg_catalog.btrim(coalesce(p_nickname, '')), 40),
    pg_catalog.btrim(p_body),
    pg_catalog.btrim(p_ai_reply),
    1,
    p_reply_source
  )
  returning id into v_comment_id;

  return query
  select c.* from public.comments as c where c.id = v_comment_id;
end;
$$;

revoke all on function public.create_comment_with_reply(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_comment_with_reply(text, text, text, text) to service_role;

commit;
