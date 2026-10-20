-- ==========================================================================
-- SPECSOFT® Chats  v3 upgrade
-- Run this ONCE in the Supabase SQL Editor, AFTER your existing
-- supabase-chats.sql. It is safe to re-run.
--
-- What this adds
--   * REAL-TIME: puts the chat tables into the supabase_realtime publication
--     (this is what was missing, so messages only showed after a refresh)
--   * Per-chat settings: pin, mute, nickname, close DM, clear history
--   * Blocking users
--   * Delete chat (DMs: clears it for you only. Groups/communities: owner only)
--   * Descriptions are now capped at 200 characters on the server too
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Per-user chat settings (pin / mute / nickname / closed / cleared)
-- --------------------------------------------------------------------------
create table if not exists public.chat_prefs (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  pinned     boolean not null default false,
  pinned_at  timestamptz,
  muted      boolean not null default false,
  closed     boolean not null default false,
  nickname   text check (nickname is null or char_length(nickname) between 1 and 32),
  cleared_at timestamptz,
  primary key (user_id, room_id)
);

alter table public.chat_prefs enable row level security;

drop policy if exists "chat prefs readable by owner" on public.chat_prefs;
create policy "chat prefs readable by owner"
on public.chat_prefs for select
using (user_id = auth.uid());
-- no insert/update/delete policies on purpose: everything goes through chat_set_pref()

-- --------------------------------------------------------------------------
-- 2. Blocks
-- --------------------------------------------------------------------------
create table if not exists public.chat_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.chat_blocks enable row level security;

drop policy if exists "chat blocks readable by blocker" on public.chat_blocks;
create policy "chat blocks readable by blocker"
on public.chat_blocks for select
using (blocker_id = auth.uid());

-- --------------------------------------------------------------------------
-- 3. RPCs for the new menu
-- --------------------------------------------------------------------------
create or replace function public.chat_set_pref(
  p_room uuid,
  p_field text,
  p_bool boolean default null,
  p_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  insert into public.chat_prefs (user_id, room_id)
  values (auth.uid(), p_room)
  on conflict (user_id, room_id) do nothing;

  if p_field = 'pinned' then
    update public.chat_prefs
    set pinned = coalesce(p_bool, false),
        pinned_at = case when coalesce(p_bool, false) then now() else null end
    where user_id = auth.uid() and room_id = p_room;

  elsif p_field = 'muted' then
    update public.chat_prefs set muted = coalesce(p_bool, false)
    where user_id = auth.uid() and room_id = p_room;

  elsif p_field = 'closed' then
    update public.chat_prefs set closed = coalesce(p_bool, false)
    where user_id = auth.uid() and room_id = p_room;

  elsif p_field = 'nickname' then
    v_nick := nullif(left(btrim(coalesce(p_text, '')), 32), '');
    update public.chat_prefs set nickname = v_nick
    where user_id = auth.uid() and room_id = p_room;

  else
    raise exception 'not_allowed';
  end if;
end;
$$;

create or replace function public.chat_set_block(p_user uuid, p_block boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_user is null or p_user = auth.uid() then
    raise exception 'bad_user';
  end if;

  if p_block then
    insert into public.chat_blocks (blocker_id, blocked_id)
    values (auth.uid(), p_user)
    on conflict do nothing;
  else
    delete from public.chat_blocks where blocker_id = auth.uid() and blocked_id = p_user;
  end if;
end;
$$;

-- DM: "delete" clears the chat for YOU only (the other person keeps their copy).
-- Group / community: only the owner can delete it for everyone.
create or replace function public.chat_delete_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_role text;
begin
  select kind into v_kind from public.chat_rooms where id = p_room;
  if v_kind is null then
    raise exception 'room_not_found';
  end if;

  select role into v_role from public.chat_members where room_id = p_room and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_member';
  end if;

  if v_kind = 'dm' then
    insert into public.chat_prefs (user_id, room_id, closed, cleared_at)
    values (auth.uid(), p_room, true, now())
    on conflict (user_id, room_id) do update
      set closed = true, cleared_at = now(), pinned = false, pinned_at = null;

    update public.chat_inbox
    set read_at = now()
    where user_id = auth.uid() and room_id = p_room and read_at is null;
  else
    if v_role <> 'owner' then
      raise exception 'not_allowed';
    end if;
    delete from public.chat_rooms where id = p_room;   -- cascades to members, messages, reactions...
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 4. chat_my_rooms: now includes the settings, hides closed DMs
-- --------------------------------------------------------------------------
drop function if exists public.chat_my_rooms();
create or replace function public.chat_my_rooms()
returns table (
  room_id uuid,
  kind text,
  name text,
  icon text,
  description text,
  is_public boolean,
  invite_code text,
  other_id uuid,
  other_username text,
  other_display text,
  other_avatar text,
  role text,
  unread bigint,
  member_count bigint,
  last_body text,
  last_at timestamptz,
  last_sender uuid,
  last_read_at timestamptz,
  pinned boolean,
  pinned_at timestamptz,
  muted boolean,
  nickname text,
  cleared_at timestamptz,
  blocked_by_me boolean,
  blocked_me boolean
)
language sql
security definer
set search_path = public
as $$
  select
    r.id as room_id,
    r.kind::text as kind,
    r.name,
    r.icon,
    r.description,
    r.is_public,
    r.invite_code,
    case when r.kind = 'dm' then dm_member.user_id end as other_id,
    case when r.kind = 'dm' then p2.username end as other_username,
    case when r.kind = 'dm' then p2.display_name end as other_display,
    case when r.kind = 'dm' then p2.avatar_url end as other_avatar,
    m.role::text as role,
    coalesce((
      select count(*)
      from public.chat_inbox i
      where i.user_id = auth.uid() and i.room_id = r.id and i.kind = 'message' and i.read_at is null
        and (pf.cleared_at is null or i.created_at > pf.cleared_at)
    ), 0)::bigint as unread,
    coalesce((select count(*) from public.chat_members cm where cm.room_id = r.id), 0)::bigint as member_count,
    case when pf.cleared_at is not null and lm.created_at <= pf.cleared_at then null else lm.body end as last_body,
    case when pf.cleared_at is not null and lm.created_at <= pf.cleared_at then null else lm.created_at end as last_at,
    case when pf.cleared_at is not null and lm.created_at <= pf.cleared_at then null else lm.sender_id end as last_sender,
    m.last_read_at,
    coalesce(pf.pinned, false) as pinned,
    pf.pinned_at,
    coalesce(pf.muted, false) as muted,
    pf.nickname,
    pf.cleared_at,
    (r.kind = 'dm' and exists (
      select 1 from public.chat_blocks b where b.blocker_id = auth.uid() and b.blocked_id = dm_member.user_id
    )) as blocked_by_me,
    (r.kind = 'dm' and exists (
      select 1 from public.chat_blocks b where b.blocker_id = dm_member.user_id and b.blocked_id = auth.uid()
    )) as blocked_me
  from public.chat_members m
  join public.chat_rooms r on r.id = m.room_id
  left join public.chat_prefs pf on pf.room_id = r.id and pf.user_id = auth.uid()
  left join public.chat_messages lm on lm.id = r.last_message_id
  left join public.chat_members dm_member on dm_member.room_id = r.id and dm_member.user_id <> auth.uid() and r.kind = 'dm'
  left join public.profiles p2 on p2.id = dm_member.user_id
  where m.user_id = auth.uid()
    and not coalesce(pf.closed, false)
  order by coalesce(pf.pinned, false) desc, pf.pinned_at desc nulls last, coalesce(lm.created_at, r.created_at) desc;
$$;

-- --------------------------------------------------------------------------
-- 5. chat_send: refuses blocked DMs, wakes closed DMs back up
-- --------------------------------------------------------------------------
create or replace function public.chat_send(p_room uuid, p_body text, p_reply uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
  v_kind text;
  v_other uuid;
begin
  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty_message';
  end if;

  if char_length(btrim(p_body)) > 2000 then
    raise exception 'too_long';
  end if;

  select kind into v_kind from public.chat_rooms where id = p_room;
  if v_kind = 'dm' then
    select user_id into v_other from public.chat_members
    where room_id = p_room and user_id <> auth.uid() limit 1;

    if v_other is not null and exists (
      select 1 from public.chat_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = v_other)
         or (b.blocker_id = v_other and b.blocked_id = auth.uid())
    ) then
      raise exception 'blocked';
    end if;
  end if;

  insert into public.chat_messages (room_id, sender_id, body, reply_to)
  values (p_room, auth.uid(), btrim(p_body), p_reply)
  returning * into v_msg;

  update public.chat_rooms
  set last_message_id = v_msg.id, last_message_at = v_msg.created_at
  where id = p_room;

  -- a closed DM comes back for everybody when a new message lands
  update public.chat_prefs set closed = false where room_id = p_room and closed;

  insert into public.chat_inbox (user_id, room_id, kind, from_id, message_id, preview, read_at, created_at)
  select
    cm.user_id,
    p_room,
    'message',
    auth.uid(),
    v_msg.id,
    left(v_msg.body, 180),
    case when cm.user_id = auth.uid() then now() else null end,
    now()
  from public.chat_members cm
  where cm.room_id = p_room;

  return v_msg;
end;
$$;

-- --------------------------------------------------------------------------
-- 6. chat_start_dm: re-opens a DM you had closed
-- --------------------------------------------------------------------------
create or replace function public.chat_start_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if p_other = auth.uid() then
    raise exception 'bad_user';
  end if;

  select r.id into v_room
  from public.chat_rooms r
  join public.chat_members m1 on m1.room_id = r.id and m1.user_id = auth.uid()
  join public.chat_members m2 on m2.room_id = r.id and m2.user_id = p_other
  where r.kind = 'dm'
  limit 1;

  if v_room is not null then
    update public.chat_prefs set closed = false where user_id = auth.uid() and room_id = v_room and closed;
    return v_room;
  end if;

  insert into public.chat_rooms (owner_id, kind, name, description, icon, is_public)
  values (auth.uid(), 'dm', 'Direct message', null, '💬', false)
  returning id into v_room;

  insert into public.chat_members (room_id, user_id, role)
  values (v_room, auth.uid(), 'owner'), (v_room, p_other, 'member');

  return v_room;
end;
$$;

-- --------------------------------------------------------------------------
-- 7. chat_create_room: description capped at 200 characters
-- --------------------------------------------------------------------------
create or replace function public.chat_create_room(p_kind text, p_name text, p_desc text default null, p_icon text default '💬', p_public boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if p_kind not in ('group', 'community') then
    raise exception 'bad_kind';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'bad_name';
  end if;

  insert into public.chat_rooms (owner_id, kind, name, description, icon, is_public, invite_code)
  values (
    auth.uid(), p_kind, left(btrim(p_name), 40),
    nullif(left(btrim(coalesce(p_desc, '')), 200), ''),
    coalesce(p_icon, '💬'), p_public, upper(substr(md5(random()::text), 1, 8))
  )
  returning id into v_room;

  insert into public.chat_members (room_id, user_id, role)
  values (v_room, auth.uid(), 'owner');

  return v_room;
end;
$$;

-- --------------------------------------------------------------------------
-- 8. REAL-TIME  (the important one)
--    Without these tables in the publication Supabase never pushes changes,
--    so the page only updated after a refresh.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'chat_reactions', 'chat_inbox', 'chat_invites', 'chat_members', 'chat_prefs']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- lets UPDATE / DELETE events carry the whole row where Supabase allows it
alter table public.chat_reactions replica identity full;
alter table public.chat_members   replica identity full;
alter table public.chat_prefs     replica identity full;