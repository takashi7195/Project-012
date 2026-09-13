-- Project-012 public comments. All writes go through the comments Edge Function.
-- Raw IP addresses are never stored. The Edge Function stores an HMAC only,
-- which is removed by the 15-minute cleanup job after 24 hours.

begin;

create extension if not exists pg_cron;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  nickname text not null default '',
  body text not null,
  ai_reply text not null,
  reply_index smallint not null check (reply_index between 1 and 10),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(body) between 1 and 280),
  constraint comments_nickname_length check (char_length(nickname) <= 40)
);

create index if not exists comments_visible_created_at_id_idx
  on public.comments (created_at desc, id desc)
  where status = 'visible';

alter table public.comments enable row level security;
revoke all on public.comments from public, anon, authenticated;
grant all on public.comments to service_role;

create table if not exists public.comment_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  last_post_at timestamptz not null default now()
);

alter table public.comment_rate_limits enable row level security;
revoke all on public.comment_rate_limits from public, anon, authenticated;
grant all on public.comment_rate_limits to service_role;

create table if not exists public.comment_reply_state (
  id smallint primary key check (id = 1),
  last_reply_index smallint not null default 0 check (last_reply_index between 0 and 10)
);

insert into public.comment_reply_state (id, last_reply_index)
values (1, 0)
on conflict (id) do nothing;

alter table public.comment_reply_state enable row level security;
revoke all on public.comment_reply_state from public, anon, authenticated;
grant all on public.comment_reply_state to service_role;

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
    where public.comment_rate_limits.last_post_at <= pg_catalog.now() - interval '30 seconds';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_comment_rate_limit(text) from public, anon, authenticated;
grant execute on function public.claim_comment_rate_limit(text) to service_role;

create or replace function public.create_comment(p_nickname text, p_body text)
returns setof public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replies text[] := array[
    '今日も最後までドキドキですね。',
    'どんな展開になるか楽しみですね。',
    'スタートから目が離せませんね。',
    '水面の動きにも注目ですね。',
    '予想する時間もレースの醍醐味ですね。',
    '最後までレースを楽しみましょう。',
    'それぞれの舟に注目ですね。',
    '次の展開が気になりますね。',
    '応援の気持ち、届きますように。',
    '熱いレースになりますように。'
  ];
  v_last smallint;
  v_index smallint;
  v_comment_id uuid;
begin
  insert into public.comment_reply_state (id, last_reply_index)
  values (1, 0)
  on conflict (id) do nothing;

  select last_reply_index into v_last
  from public.comment_reply_state
  where id = 1
  for update;

  if v_last = 0 then
    v_index := (floor(pg_catalog.random() * 10) + 1)::smallint;
  else
    v_index := (floor(pg_catalog.random() * 9) + 1)::smallint;
    if v_index >= v_last then
      v_index := v_index + 1;
    end if;
  end if;

  insert into public.comments (nickname, body, ai_reply, reply_index)
  values (
    pg_catalog.left(pg_catalog.btrim(coalesce(p_nickname, '')), 40),
    pg_catalog.btrim(p_body),
    v_replies[v_index],
    v_index
  )
  returning id into v_comment_id;

  update public.comment_reply_state
  set last_reply_index = v_index
  where id = 1;

  return query
  select c.* from public.comments as c where c.id = v_comment_id;
end;
$$;

revoke all on function public.create_comment(text, text) from public, anon, authenticated;
grant execute on function public.create_comment(text, text) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-comment-rate-limits';

select cron.schedule(
  'cleanup-comment-rate-limits',
  '*/15 * * * *',
  $job$delete from public.comment_rate_limits where last_post_at < now() - interval '24 hours';$job$
);

commit;
