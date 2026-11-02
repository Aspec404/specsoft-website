-- ==========================================================================
-- SPECSOFT® Chats  v7: forum search + "my posts" filters
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-community-channels-v2.sql (v6).
-- It is safe to re-run.
--
-- What changes
--   chat_threads_list() learns two things:
--     p_query  search text. Matches a post's title, its first message and ANY reply.
--              (2 to 60 characters. Shorter text is ignored. % and _ are treated as plain letters.)
--     p_scope  'all'     every post                          (pinned posts stay on top)
--              'mine'    posts you started
--              'replied' posts started by someone else where you replied
--   It also returns `snippet`: when the match was inside a reply, the text of that reply,
--   so the list can show WHY a post matched.
--   While searching or filtering, posts are sorted by latest activity (no pinned-first).
--
-- The old 3-argument version is dropped so there is only ONE chat_threads_list.
-- chats-channels-panels.js falls back to the old behavior if this file has not been run yet.
-- ==========================================================================

-- helps the "replied" filter
create index if not exists chat_messages_thread_sender_idx
  on public.chat_messages (thread_id, sender_id) where thread_id is not null;

drop function if exists public.chat_threads_list(uuid, timestamptz, int);

create or replace function public.chat_threads_list(
  p_channel uuid,
  p_before  timestamptz default null,
  p_limit   int         default 40,
  p_query   text        default null,
  p_scope   text        default 'all'
)
returns table (
  id              uuid,
  channel_id      uuid,
  title           text,
  excerpt         text,
  author_id       uuid,
  author_username text,
  author_display  text,
  author_avatar   text,
  pinned          boolean,
  locked          boolean,
  post_count      int,
  created_at      timestamptz,
  last_post_at    timestamptz,
  snippet         text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q        text;
  v_pat      text;
  v_pinfirst boolean;
begin
  if auth.uid() is null or not public.chat_can_see_channel(p_channel, auth.uid()) then
    raise exception 'not_member';
  end if;

  if p_scope is null or p_scope not in ('all', 'mine', 'replied') then
    raise exception 'bad_status';
  end if;

  v_q := nullif(btrim(coalesce(p_query, '')), '');
  if v_q is not null then
    v_q := left(v_q, 60);
    if char_length(v_q) < 2 then v_q := null; end if;
  end if;
  if v_q is not null then
    -- escape LIKE wildcards so "50%" or "a_b" search for exactly that text
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- pinned posts are only pulled to the top in the plain, unfiltered list
  v_pinfirst := (v_q is null and p_scope = 'all');

  return query
  select t.id, t.channel_id, t.title, t.excerpt, t.author_id,
         p.username::text, p.display_name::text, p.avatar_url::text,
         t.pinned, t.locked, t.post_count, t.created_at, t.last_post_at,
         case
           when v_q is null or t.title ilike v_pat escape '\' then null::text
           else (
             select left(m.body, 160)::text
             from public.chat_messages m
             where m.thread_id = t.id
               and m.deleted_at is null
               and m.body ilike v_pat escape '\'
             order by m.created_at
             limit 1
           )
         end
  from public.chat_threads t
  left join public.profiles p on p.id = t.author_id
  where t.channel_id = p_channel
    and (p_before is null or (t.last_post_at < p_before and (not v_pinfirst or not t.pinned)))
    and (p_scope <> 'mine' or t.author_id = auth.uid())
    and (p_scope <> 'replied' or (
          t.author_id is distinct from auth.uid()
          and exists (
            select 1 from public.chat_messages r
            where r.thread_id = t.id and r.sender_id = auth.uid() and r.deleted_at is null
          )))
    and (v_q is null
         or t.title ilike v_pat escape '\'
         or t.excerpt ilike v_pat escape '\'
         or exists (
              select 1 from public.chat_messages m2
              where m2.thread_id = t.id and m2.deleted_at is null and m2.body ilike v_pat escape '\'
            ))
  order by (case when v_pinfirst then t.pinned else false end) desc, t.last_post_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
end;
$$;

grant execute on function public.chat_threads_list(uuid, timestamptz, int, text, text) to authenticated;
