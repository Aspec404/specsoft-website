-- Run this AFTER supabase-profiles.sql in Supabase SQL Editor.
-- Safe to rerun: it creates tables, indexes, and RPC helpers idempotently.
--
-- v2 changes (security + Developer Mode):
--   * removed direct-write policies that let any signed-in user join private rooms,
--     promote themselves to owner, forge messages, or rewrite other people's messages
--   * chat_remove_member now protects owners (admins can only remove plain members)
--   * chat_delete lets room owners/admins moderate; chat_attach replaces the direct UPDATE
--   * chat_members.last_read_at (powers the NEW divider; ready for read receipts)
--   * NEW: chat_bug_status + chat_set_bug_status (bug report cards)
--   * NEW: chat_snippets + chat_save_snippet / chat_get_snippet (shareable code snippets)

create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  kind          text not null default 'group' check (kind in ('dm', 'group', 'community')),
  name          text not null default 'Chat' check (char_length(name) between 2 and 80),
  description   text,
  icon          text default '💬' check (icon is null or char_length(icon) between 1 and 4),
  is_public     boolean not null default false,
  invite_code   text unique,
  created_at    timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_id uuid,
  check (kind <> 'dm' or char_length(name) <= 40)
);

create table if not exists public.chat_members (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at   timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  reply_to    uuid references public.chat_messages(id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
);

create table if not exists public.chat_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.chat_messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 8),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table if not exists public.chat_invites (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.chat_rooms(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by     uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  unique (room_id, invited_user_id)
);

create table if not exists public.chat_inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  kind        text not null default 'message' check (kind in ('message', 'invite')),
  from_id     uuid references public.profiles(id) on delete set null,
  message_id  uuid references public.chat_messages(id) on delete set null,
  preview     text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.chat_rooms add column if not exists owner_id uuid;
alter table public.chat_rooms add column if not exists kind text;
alter table public.chat_rooms add column if not exists name text;
alter table public.chat_rooms add column if not exists description text;
alter table public.chat_rooms add column if not exists icon text;
alter table public.chat_rooms add column if not exists is_public boolean;
alter table public.chat_rooms add column if not exists invite_code text;
alter table public.chat_rooms add column if not exists created_at timestamptz;
alter table public.chat_rooms add column if not exists last_message_at timestamptz;
alter table public.chat_rooms add column if not exists last_message_id uuid;

alter table public.chat_members add column if not exists room_id uuid;
alter table public.chat_members add column if not exists user_id uuid;
alter table public.chat_members add column if not exists role text;
alter table public.chat_members add column if not exists joined_at timestamptz;
alter table public.chat_members add column if not exists last_read_at timestamptz;
update public.chat_members set last_read_at = now() where last_read_at is null;
alter table public.chat_members alter column last_read_at set default now();

alter table public.chat_messages add column if not exists room_id uuid;
alter table public.chat_messages add column if not exists sender_id uuid;
alter table public.chat_messages add column if not exists body text;
alter table public.chat_messages add column if not exists reply_to uuid;
alter table public.chat_messages add column if not exists created_at timestamptz;
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;
alter table public.chat_messages add column if not exists attachment_path text;
alter table public.chat_messages add column if not exists attachment_name text;
alter table public.chat_messages add column if not exists attachment_type text;
alter table public.chat_messages add column if not exists attachment_size bigint;

alter table public.chat_reactions add column if not exists message_id uuid;
alter table public.chat_reactions add column if not exists user_id uuid;
alter table public.chat_reactions add column if not exists emoji text;
alter table public.chat_reactions add column if not exists created_at timestamptz;

alter table public.chat_invites add column if not exists room_id uuid;
alter table public.chat_invites add column if not exists invited_user_id uuid;
alter table public.chat_invites add column if not exists invited_by uuid;
alter table public.chat_invites add column if not exists created_at timestamptz;
alter table public.chat_invites add column if not exists accepted_at timestamptz;

alter table public.chat_inbox add column if not exists user_id uuid;
alter table public.chat_inbox add column if not exists room_id uuid;
alter table public.chat_inbox add column if not exists kind text;
alter table public.chat_inbox add column if not exists from_id uuid;
alter table public.chat_inbox add column if not exists message_id uuid;
alter table public.chat_inbox add column if not exists preview text;
alter table public.chat_inbox add column if not exists read_at timestamptz;
alter table public.chat_inbox add column if not exists created_at timestamptz;

create index if not exists chat_rooms_owner_idx on public.chat_rooms (owner_id, created_at desc);
create index if not exists chat_members_room_idx on public.chat_members (room_id, user_id);
create index if not exists chat_members_user_idx on public.chat_members (user_id, room_id);
create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at desc);
create index if not exists chat_reactions_message_idx on public.chat_reactions (message_id, created_at desc);
create index if not exists chat_invites_user_idx on public.chat_invites (invited_user_id, created_at desc);
create index if not exists chat_inbox_user_idx on public.chat_inbox (user_id, read_at, created_at desc);

create or replace function public.chat_has_membership(p_room uuid, p_user uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members m
    where m.room_id = p_room and m.user_id = p_user
  );
$$;

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
  other_username text,
  other_display text,
  other_avatar text,
  role text,
  unread bigint,
  member_count bigint,
  last_body text,
  last_at timestamptz,
  last_sender uuid,
  last_read_at timestamptz
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
    case when r.kind = 'dm' then p2.username end as other_username,
    case when r.kind = 'dm' then p2.display_name end as other_display,
    case when r.kind = 'dm' then p2.avatar_url end as other_avatar,
    m.role::text as role,
    coalesce((
      select count(*)
      from public.chat_inbox i
      where i.user_id = auth.uid() and i.room_id = r.id and i.kind = 'message' and i.read_at is null
    ), 0)::bigint as unread,
    coalesce((select count(*) from public.chat_members cm where cm.room_id = r.id), 0)::bigint as member_count,
    lm.body as last_body,
    lm.created_at as last_at,
    lm.sender_id as last_sender,
    m.last_read_at
  from public.chat_members m
  join public.chat_rooms r on r.id = m.room_id
  left join public.chat_messages lm on lm.id = r.last_message_id
  left join public.chat_members dm_member on dm_member.room_id = r.id and dm_member.user_id <> auth.uid() and r.kind = 'dm'
  left join public.profiles p2 on p2.id = dm_member.user_id
  where m.user_id = auth.uid()
  order by coalesce(lm.created_at, r.created_at) desc;
$$;

create or replace function public.chat_my_invites()
returns table (
  invite_id uuid,
  room_id uuid,
  room_name text,
  room_icon text,
  room_kind text,
  invited_by_username text,
  invited_by_display text,
  invited_by_avatar text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    i.id as invite_id,
    i.room_id,
    r.name as room_name,
    r.icon as room_icon,
    r.kind::text as room_kind,
    p.username as invited_by_username,
    p.display_name as invited_by_display,
    p.avatar_url as invited_by_avatar,
    i.created_at
  from public.chat_invites i
  join public.chat_rooms r on r.id = i.room_id
  join public.profiles p on p.id = i.invited_by
  where i.invited_user_id = auth.uid() and i.accepted_at is null
  order by i.created_at desc;
$$;

create or replace function public.chat_discover()
returns table (
  room_id uuid,
  kind text,
  name text,
  icon text,
  description text,
  member_count bigint,
  invite_code text
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
    coalesce((select count(*) from public.chat_members cm where cm.room_id = r.id), 0)::bigint as member_count,
    r.invite_code
  from public.chat_rooms r
  where r.is_public = true and r.kind = 'community'
  order by r.created_at desc;
$$;

create or replace function public.chat_mark_read(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_inbox
  set read_at = now()
  where user_id = auth.uid() and room_id = p_room and read_at is null and kind = 'message';

  update public.chat_members
  set last_read_at = now()
  where user_id = auth.uid() and room_id = p_room;
end;
$$;

create or replace function public.chat_send(p_room uuid, p_body text, p_reply uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
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

  insert into public.chat_messages (room_id, sender_id, body, reply_to)
  values (p_room, auth.uid(), btrim(p_body), p_reply)
  returning * into v_msg;

  update public.chat_rooms
  set last_message_id = v_msg.id, last_message_at = v_msg.created_at
  where id = p_room;

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

create or replace function public.chat_edit(p_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
begin
  select * into v_msg
  from public.chat_messages
  where id = p_id and sender_id = auth.uid() and deleted_at is null;

  if v_msg.id is null then
    raise exception 'not_allowed';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty_message';
  end if;

  update public.chat_messages
  set body = btrim(p_body), edited_at = now()
  where id = p_id and sender_id = auth.uid();

  select * into v_msg from public.chat_messages where id = p_id;
  update public.chat_inbox
  set preview = left(v_msg.body, 180)
  where message_id = p_id and kind = 'message';

  return v_msg;
end;
$$;

create or replace function public.chat_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
  v_role text;
begin
  select * into v_msg from public.chat_messages where id = p_id and deleted_at is null;
  if v_msg.id is null then
    return;
  end if;

  select role into v_role from public.chat_members where room_id = v_msg.room_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_member';
  end if;

  if v_msg.sender_id <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  update public.chat_messages
  set deleted_at = now(), body = '[deleted]'
  where id = p_id;

  delete from public.chat_reactions where message_id = p_id;

  update public.chat_inbox
  set preview = '[deleted]'
  where message_id = p_id and kind = 'message';
end;
$$;

-- Attach an uploaded file to a message you just sent. Replaces the old direct
-- UPDATE on chat_messages (that policy is gone, see the policy section below).
create or replace function public.chat_attach(p_msg uuid, p_path text, p_name text, p_type text, p_size bigint)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
begin
  select * into v_msg
  from public.chat_messages
  where id = p_msg and sender_id = auth.uid() and deleted_at is null and attachment_path is null;

  if v_msg.id is null then
    raise exception 'not_allowed';
  end if;

  if p_path is null or left(p_path, length(v_msg.room_id::text || '/' || auth.uid()::text || '/')) <> (v_msg.room_id::text || '/' || auth.uid()::text || '/') then
    raise exception 'not_allowed';
  end if;

  if p_size is null or p_size < 0 or p_size > 10485760 then
    raise exception 'not_allowed';
  end if;

  update public.chat_messages
  set attachment_path = p_path,
      attachment_name = left(coalesce(p_name, 'file'), 200),
      attachment_type = left(coalesce(p_type, 'application/octet-stream'), 100),
      attachment_size = p_size
  where id = p_msg
  returning * into v_msg;

  return v_msg;
end;
$$;

create or replace function public.chat_toggle_reaction(p_msg uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
  declare v_count int;
begin
  if not exists (select 1 from public.chat_messages where id = p_msg and deleted_at is null) then
    raise exception 'room_not_found';
  end if;

  if exists (
    select 1 from public.chat_reactions where message_id = p_msg and user_id = auth.uid() and emoji = p_emoji
  ) then
    delete from public.chat_reactions where message_id = p_msg and user_id = auth.uid() and emoji = p_emoji;
    return 'removed';
  end if;

  insert into public.chat_reactions (message_id, user_id, emoji)
  values (p_msg, auth.uid(), p_emoji)
  on conflict (message_id, user_id, emoji) do nothing;

  return 'added';
end;
$$;

create or replace function public.chat_start_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_room2 uuid;
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
  values (auth.uid(), p_kind, btrim(p_name), p_desc, coalesce(p_icon, '💬'), p_public, upper(substr(md5(random()::text), 1, 8)))
  returning id into v_room;

  insert into public.chat_members (room_id, user_id, role)
  values (v_room, auth.uid(), 'owner');

  return v_room;
end;
$$;

create or replace function public.chat_join_public(p_room uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.chat_members where room_id = p_room and user_id = auth.uid()) then
    return p_room;
  end if;

  if not exists (select 1 from public.chat_rooms where id = p_room and is_public = true) then
    raise exception 'room_not_found';
  end if;

  insert into public.chat_members (room_id, user_id, role) values (p_room, auth.uid(), 'member');
  return p_room;
end;
$$;

create or replace function public.chat_join_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'bad_code';
  end if;

  select id into v_room
  from public.chat_rooms
  where upper(invite_code) = upper(btrim(p_code))
  limit 1;

  if v_room is null then
    raise exception 'room_not_found';
  end if;

  if exists (select 1 from public.chat_members where room_id = v_room and user_id = auth.uid()) then
    return v_room;
  end if;

  insert into public.chat_members (room_id, user_id, role) values (v_room, auth.uid(), 'member');
  return v_room;
end;
$$;

create or replace function public.chat_invite(p_room uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_room_kind text;
begin
  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  select id into v_user from public.profiles where username = lower(btrim(p_username, '@')) limit 1;
  if v_user is null then
    raise exception 'user_not_found';
  end if;

  if v_user = auth.uid() then
    raise exception 'bad_user';
  end if;

  if exists (select 1 from public.chat_members where room_id = p_room and user_id = v_user) then
    raise exception 'already_member';
  end if;

  insert into public.chat_invites (room_id, invited_user_id, invited_by)
  values (p_room, v_user, auth.uid())
  on conflict (room_id, invited_user_id) do nothing;

  insert into public.chat_inbox (user_id, room_id, kind, from_id, preview, read_at, created_at)
  values (v_user, p_room, 'invite', auth.uid(), 'You were invited to a chat.', null, now())
  on conflict do nothing;

  return p_room;
end;
$$;

create or replace function public.chat_respond_invite(p_invite uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.chat_invites;
  v_room uuid;
begin
  select * into v_invite from public.chat_invites where id = p_invite and invited_user_id = auth.uid() and accepted_at is null limit 1;
  if v_invite.id is null then
    raise exception 'invite_not_found';
  end if;

  v_room := v_invite.room_id;

  if p_accept then
    insert into public.chat_members (room_id, user_id, role)
    values (v_room, auth.uid(), 'member')
    on conflict (room_id, user_id) do nothing;
  end if;

  update public.chat_invites set accepted_at = now() where id = p_invite;
  delete from public.chat_inbox where user_id = auth.uid() and room_id = v_room and kind = 'invite';

  return v_room;
end;
$$;

create or replace function public.chat_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_members where room_id = p_room and user_id = auth.uid();
end;
$$;

create or replace function public.chat_remove_member(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_target text;
begin
  select role into v_role from public.chat_members where room_id = p_room and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_member';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  select role into v_target from public.chat_members where room_id = p_room and user_id = p_user;
  if v_target is null then
    return;
  end if;

  -- nobody removes an owner here; admins can only remove plain members
  if v_target = 'owner' or (v_role = 'admin' and v_target <> 'member') then
    raise exception 'not_allowed';
  end if;

  delete from public.chat_members where room_id = p_room and user_id = p_user;
end;
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_invites enable row level security;
alter table public.chat_inbox enable row level security;

create or replace function public.chat_user_is_member_in_room(p_room uuid, p_user uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_members cm
    where cm.room_id = p_room and cm.user_id = p_user
  );
$$;

-- RLS policies. Reads are limited to room members. Everything that WRITES to
-- rooms, members and messages goes through the security-definer RPCs above, so there
-- are deliberately NO direct insert/update policies on chat_rooms, chat_members (except
-- leaving) or chat_messages. Direct policies there let any signed-in user join private
-- rooms, make themselves owner, forge messages, or rewrite other people's messages.
drop policy if exists "chat rooms are readable by members" on public.chat_rooms;
drop policy if exists "members may create room rows" on public.chat_rooms;
drop policy if exists "owners may update room rows" on public.chat_rooms;
drop policy if exists "chat members visible to room members" on public.chat_members;
drop policy if exists "chat members are readable by owner" on public.chat_members;
drop policy if exists "members may join rooms" on public.chat_members;
drop policy if exists "members may update own member rows" on public.chat_members;
drop policy if exists "members may leave rooms" on public.chat_members;
drop policy if exists "chat messages visible to room members" on public.chat_messages;
drop policy if exists "chat messages are readable by room members" on public.chat_messages;
drop policy if exists "room members may insert messages" on public.chat_messages;
drop policy if exists "owners or senders may update/delete messages" on public.chat_messages;
drop policy if exists "chat reactions visible to room members" on public.chat_reactions;
drop policy if exists "chat reactions readable by room members" on public.chat_reactions;
drop policy if exists "only sender may delete own reaction" on public.chat_reactions;
drop policy if exists "sender may add own reaction" on public.chat_reactions;
drop policy if exists "sender may delete own reaction" on public.chat_reactions;
drop policy if exists "chat invites visible to invited user" on public.chat_invites;
drop policy if exists "invited user may update invite acceptance" on public.chat_invites;
drop policy if exists "chat inbox visible to owner" on public.chat_inbox;
drop policy if exists "chat inbox readable by user" on public.chat_inbox;
drop policy if exists "invited user may insert own inbox entries" on public.chat_inbox;
drop policy if exists "user may update inbox read flag" on public.chat_inbox;
drop policy if exists "user may delete own inbox messages" on public.chat_inbox;

drop policy if exists "chat rooms are readable by members" on public.chat_rooms;
drop policy if exists "chat members visible to room members" on public.chat_members;

create policy "chat rooms are readable by members"
on public.chat_rooms for select
using (
  public.chat_user_is_member_in_room(chat_rooms.id, auth.uid())
);

create policy "chat members visible to room members"
on public.chat_members for select
using (
  public.chat_user_is_member_in_room(chat_members.room_id, auth.uid())
);

create policy "chat messages visible to room members"
on public.chat_messages for select
using (
  exists (
    select 1 from public.chat_members cm where cm.room_id = chat_messages.room_id and cm.user_id = auth.uid()
  )
);

create policy "chat reactions visible to room members"
on public.chat_reactions for select
using (
  exists (
    select 1 from public.chat_messages m
    join public.chat_members cm on cm.room_id = m.room_id
    where m.id = chat_reactions.message_id and cm.user_id = auth.uid()
  )
);

create policy "chat invites visible to invited user"
on public.chat_invites for select
using (invited_user_id = auth.uid());

create policy "chat inbox visible to owner"
on public.chat_inbox for select
using (user_id = auth.uid());

create policy "members may leave rooms"
on public.chat_members for delete to authenticated
using (user_id = auth.uid());

create policy "sender may add own reaction"
on public.chat_reactions for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.chat_messages m join public.chat_members cm on cm.room_id = m.room_id where m.id = chat_reactions.message_id and cm.user_id = auth.uid()));

create policy "sender may delete own reaction"
on public.chat_reactions for delete to authenticated
using (user_id = auth.uid());

create policy "invited user may update invite acceptance"
on public.chat_invites for update to authenticated
using (invited_user_id = auth.uid());

create policy "invited user may insert own inbox entries"
on public.chat_inbox for insert to authenticated
with check (user_id = auth.uid());

create policy "user may update inbox read flag"
on public.chat_inbox for update to authenticated
using (user_id = auth.uid());

create policy "user may delete own inbox messages"
on public.chat_inbox for delete to authenticated
using (user_id = auth.uid());

-- Private file storage: room members can upload to and download from their rooms.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "chat members upload attachments" on storage.objects;
create policy "chat members upload attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.chat_user_is_member_in_room(((storage.foldername(name))[1])::uuid, auth.uid())
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "chat members read attachments" on storage.objects;
create policy "chat members read attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.chat_user_is_member_in_room(((storage.foldername(name))[1])::uuid, auth.uid())
);

drop policy if exists "users delete own chat attachments" on storage.objects;
create policy "users delete own chat attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- ==========================================================================
-- DEVELOPER MODE
-- ==========================================================================

-- ----- Bug report cards ---------------------------------------------------
-- The card itself is a normal chat message whose body starts with "[[bug:" (JSON).
-- Its mutable status label lives here so it can change without editing the message.
create table if not exists public.chat_bug_status (
  message_id  uuid primary key references public.chat_messages(id) on delete cascade,
  status      text not null default 'open' check (status in ('open', 'investigating', 'fixed', 'wontfix')),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.chat_bug_status enable row level security;

drop policy if exists "chat bug status visible to room members" on public.chat_bug_status;
create policy "chat bug status visible to room members"
on public.chat_bug_status for select
using (
  exists (
    select 1
    from public.chat_messages m
    join public.chat_members cm on cm.room_id = m.room_id
    where m.id = chat_bug_status.message_id and cm.user_id = auth.uid()
  )
);

create or replace function public.chat_set_bug_status(p_msg uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_status is null or p_status not in ('open', 'investigating', 'fixed', 'wontfix') then
    raise exception 'bad_status';
  end if;

  select * into v_msg from public.chat_messages where id = p_msg and deleted_at is null;
  if v_msg.id is null then
    raise exception 'room_not_found';
  end if;

  select role into v_role from public.chat_members where room_id = v_msg.room_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not_member';
  end if;

  if left(v_msg.body, 6) <> '[[bug:' then
    raise exception 'not_a_bug';
  end if;

  -- the reporter or a room owner/admin can triage
  if v_msg.sender_id <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  insert into public.chat_bug_status (message_id, status, updated_by, updated_at)
  values (p_msg, p_status, auth.uid(), now())
  on conflict (message_id) do update
    set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  return p_status;
end;
$$;

-- live status changes (separate channel in the client, so a missing table never breaks chat)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_bug_status'
     ) then
    alter publication supabase_realtime add table public.chat_bug_status;
  end if;
end $$;

-- ----- Shareable code snippets ---------------------------------------------
-- Anyone signed in who has the link (an unguessable uuid) can open a snippet.
-- There is no table-level read except your own, so snippets can't be listed or scraped.
create table if not exists public.chat_snippets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'Snippet' check (char_length(title) between 1 and 80),
  language    text check (language is null or char_length(language) <= 20),
  code        text not null check (char_length(code) between 1 and 20000),
  created_at  timestamptz not null default now()
);

create index if not exists chat_snippets_owner_idx on public.chat_snippets (owner_id, created_at desc);

alter table public.chat_snippets enable row level security;

drop policy if exists "owners read own snippets" on public.chat_snippets;
create policy "owners read own snippets"
on public.chat_snippets for select
using (owner_id = auth.uid());

create or replace function public.chat_save_snippet(p_title text, p_lang text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_lang text := nullif(left(lower(btrim(coalesce(p_lang, ''))), 20), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'empty_message';
  end if;

  if char_length(p_code) > 20000 then
    raise exception 'too_long';
  end if;

  -- same person saving the same code again just gets the same link
  select id into v_id
  from public.chat_snippets
  where owner_id = auth.uid() and code = p_code and language is not distinct from v_lang
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  if (select count(*) from public.chat_snippets where owner_id = auth.uid()) >= 300 then
    raise exception 'too_many_snippets';
  end if;

  insert into public.chat_snippets (owner_id, title, language, code)
  values (auth.uid(), left(coalesce(nullif(btrim(p_title), ''), 'Snippet'), 80), v_lang, p_code)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.chat_get_snippet(p_id uuid)
returns table (
  id uuid,
  title text,
  language text,
  code text,
  created_at timestamptz,
  owner_username text,
  owner_display text
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.title, s.language, s.code, s.created_at, p.username, p.display_name
  from public.chat_snippets s
  join public.profiles p on p.id = s.owner_id
  where s.id = p_id and auth.uid() is not null;
$$;

create or replace function public.chat_delete_snippet(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_snippets where id = p_id and owner_id = auth.uid();
$$;