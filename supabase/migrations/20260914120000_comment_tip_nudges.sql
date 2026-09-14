-- Store whether the selected AI reply asked for a voluntary note tip.
-- Existing comments receive false and remain unchanged in the UI.

begin;

alter table public.comments
  add column if not exists tip_requested boolean not null default false;

alter table public.comments
  add constraint comments_tip_requested_requires_gemini
  check (not tip_requested or reply_source = 'gemini');

-- Keep the four-argument RPC available during rollout so an already-deployed
-- Edge Function continues to accept comments until the updated function ships.
create function public.create_comment_with_reply(
  p_nickname text,
  p_body text,
  p_ai_reply text,
  p_reply_source text,
  p_tip_requested boolean
)
returns setof public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment_id uuid;
begin
  if p_reply_source is null
     or p_reply_source not in ('template', 'gemini', 'empathetic')
     or p_tip_requested is null
     or (p_tip_requested and p_reply_source <> 'gemini')
     or p_ai_reply is null
     or pg_catalog.char_length(pg_catalog.btrim(p_ai_reply)) not between 1 and 60
     or p_body is null
     or pg_catalog.char_length(pg_catalog.btrim(p_body)) not between 1 and 280
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_nickname, ''))) > 40 then
    raise exception 'invalid comment or reply';
  end if;

  insert into public.comments (nickname, body, ai_reply, reply_index, reply_source, tip_requested)
  values (
    pg_catalog.left(pg_catalog.btrim(coalesce(p_nickname, '')), 40),
    pg_catalog.btrim(p_body),
    pg_catalog.btrim(p_ai_reply),
    1,
    p_reply_source,
    p_tip_requested
  )
  returning id into v_comment_id;

  return query
  select c.* from public.comments as c where c.id = v_comment_id;
end;
$$;

revoke all on function public.create_comment_with_reply(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_comment_with_reply(text, text, text, text, boolean) to service_role;

notify pgrst, 'reload schema';

commit;
