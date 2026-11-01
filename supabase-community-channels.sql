-- ==========================================================================
-- SPECSOFT® Chats  v5: community sections + channels (Discord style)
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-chat-settings.sql (v4).
-- It is safe to re-run.
--
-- Everything here is ADDITIVE:
--   * new tables, new functions, one new nullable column on chat_messages
--   * chat_my_rooms / chat_send / chat_create_room are NOT touched
--   * DMs and groups behave exactly as before
--   * messages that already exist stay where they are. A message with
--     channel_id = NULL belongs to the community's DEFAULT channel (#general),
--     so no existing row is rewritten.
--
-- What this adds
--   chat_sections           categories ("Text channels", "Dev talk" ...)
--   chat_channels           the channels. type = text | announcements | discussion |
--                           spoiler | sensitive | roadmap | event,  plus is_private
--   chat_channel_members    who may see a PRIVATE channel (owners/admins always can)
--   chat_channel_reads      per-channel "read up to here" (this drives the unread badges)
--   chat_prefs.notif_level  per-community notifications: all | mentions | none
--   chat_send_channel()     posting into a channel (enforces announcements + privacy)
--   a restrictive RLS policy on chat_messages so PRIVATE channels stay private
--   (also in realtime), and chat_pinned / chat_room_media now respect it too
--
-- Traffic notes (why this will not hammer Supabase)
--   * chat_send_channel does NOT write an inbox row for every member.
--     Only people who are @mentioned get one.
--   * unread counts are computed per channel on demand and capped at 100.
--   * notification level "none" or "mentions" is applied on the device, so
--     no banner, sound or badge work happens for chats you silenced.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_sections (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists chat_sections_room_idx on public.chat_sections (room_id, position);

create table if not exists public.chat_channels (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  section_id uuid references public.chat_sections(id) on delete set null,
  name       text not null check (name ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  topic      text check (topic is null or char_length(topic) <= 200),
  type       text not null default 'text'
             check (type in ('text', 'announcements', 'discussion', 'spoiler', 'sensitive', 'roadmap', 'event')),
  is_private boolean not null default false,
  is_default boolean not null default false,
  position   int  not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);

create index if not exists chat_channels_room_idx on public.chat_channels (room_id, position);
-- only one default channel per community
create unique index if not exists chat_channels_one_default_idx
  on public.chat_channels (room_id) where is_default;

create table if not exists public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.chat_channel_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- the one column we add to existing tables (nullable, so nothing breaks)
alter table public.chat_messages
  add column if not exists channel_id uuid references public.chat_channels(id) on delete cascade;

create index if not exists chat_messages_channel_idx
  on public.chat_messages (channel_id, created_at desc);

alter table public.chat_prefs
  add column if not exists notif_level text not null default 'all';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_prefs_notif_level_check'
  ) then
    alter table public.chat_prefs
      add constraint chat_prefs_notif_level_check check (notif_level in ('all', 'mentions', 'none'));
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2. Who can see a channel
--    Public channel  : every member of the community
--    Private channel : owners, admins, and people added to chat_channel_members
--    (granted to the browser because the RLS policies below call it)
-- --------------------------------------------------------------------------
create or replace function public.chat_can_see_channel(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_channels c
    join public.chat_members m on m.room_id = c.room_id and m.user_id = p_user
    where c.id = p_channel
      and (
        not c.is_private
        or m.role::text in ('owner', 'admin')
        or exists (
          select 1 from public.chat_channel_members cm
          where cm.channel_id = c.id and cm.user_id = p_user
        )
      )
  );
$$;

grant execute on function public.chat_can_see_channel(uuid, uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Row level security
--    Reads only. Every write goes through the functions further down.
-- --------------------------------------------------------------------------
alter table public.chat_sections        enable row level security;
alter table public.chat_channels        enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_channel_reads   enable row level security;

drop policy if exists "chat sections readable by members" on public.chat_sections;
create policy "chat sections readable by members"
on public.chat_sections for select
using (public.chat_has_membership(room_id, auth.uid()));

drop policy if exists "chat channels readable if visible" on public.chat_channels;
create policy "chat channels readable if visible"
on public.chat_channels for select
using (public.chat_can_see_channel(id, auth.uid()));

drop policy if exists "chat channel members readable by self" on public.chat_channel_members;
create policy "chat channel members readable by self"
on public.chat_channel_members for select
using (user_id = auth.uid());

drop policy if exists "chat channel reads readable by owner" on public.chat_channel_reads;
create policy "chat channel reads readable by owner"
on public.chat_channel_reads for select
using (user_id = auth.uid());

-- RESTRICTIVE = this is AND-ed with the policies chat_messages already has.
-- Messages with no channel (DMs, groups, old community messages) are unaffected.
-- Messages in a private channel are invisible to people who cannot see it,
-- in normal queries AND in realtime.
drop policy if exists "chat channel privacy" on public.chat_messages;
create policy "chat channel privacy"
on public.chat_messages
as restrictive
for select
to authenticated
using (channel_id is null or public.chat_can_see_channel(channel_id, auth.uid()));

-- --------------------------------------------------------------------------
-- 4. Default channel for every community
-- --------------------------------------------------------------------------
create or replace function public.chat_community_seed(p_room uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sec uuid;
  v_ch  uuid;
begin
  perform pg_advisory_xact_lock(hashtext('chat_seed:' || p_room::text));

  select id into v_ch from public.chat_channels
  where room_id = p_room
  order by is_default desc, position, created_at
  limit 1;
  if v_ch is not null then
    return v_ch;
  end if;

  insert into public.chat_sections (room_id, name, position)
  values (p_room, 'Text channels', 0)
  returning id into v_sec;

  insert into public.chat_channels (room_id, section_id, name, type, is_default, position)
  values (p_room, v_sec, 'general', 'text', true, 0)
  returning id into v_ch;

  return v_ch;
end;
$$;

revoke execute on function public.chat_community_seed(uuid) from public, anon, authenticated;

-- new communities get #general automatically
create or replace function public.chat_community_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind::text = 'community' then
    perform public.chat_community_seed(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists chat_community_defaults on public.chat_rooms;
create trigger chat_community_defaults
after insert on public.chat_rooms
for each row execute function public.chat_community_after_insert();

-- existing communities get it now (no messages are touched)
do $$
declare
  r record;
begin
  for r in select id from public.chat_rooms where kind::text = 'community' loop
    perform public.chat_community_seed(r.id);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 5. List sections + channels (one call, includes unread counts)
-- --------------------------------------------------------------------------
create or replace function public.chat_channels_list(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sections jsonb;
  v_channels jsonb;
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  -- safety net: a community that somehow has no channel gets #general
  if not exists (select 1 from public.chat_channels where room_id = p_room) then
    perform public.chat_community_seed(p_room);
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position)
           order by s.position, s.created_at), '[]'::jsonb)
  into v_sections
  from public.chat_sections s
  where s.room_id = p_room;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', c.id,
             'section_id', c.section_id,
             'name', c.name,
             'topic', c.topic,
             'type', c.type,
             'is_private', c.is_private,
             'is_default', c.is_default,
             'position', c.position,
             'unread', (
               select count(*) from (
                 select 1
                 from public.chat_messages m
                 where m.room_id = c.room_id
                   and (m.channel_id = c.id or (c.is_default and m.channel_id is null))
                   and m.deleted_at is null
                   and m.sender_id <> auth.uid()
                   and m.created_at > greatest(
                         coalesce(cr.last_read_at, mem.last_read_at, c.created_at),
                         c.created_at)
                 limit 100
               ) x
             )
           )
           order by c.position, c.created_at), '[]'::jsonb)
  into v_channels
  from public.chat_channels c
  left join public.chat_channel_reads cr on cr.channel_id = c.id and cr.user_id = auth.uid()
  left join public.chat_members mem on mem.room_id = c.room_id and mem.user_id = auth.uid()
  where c.room_id = p_room
    and public.chat_can_see_channel(c.id, auth.uid());

  return jsonb_build_object('sections', v_sections, 'channels', v_channels);
end;
$$;

-- --------------------------------------------------------------------------
-- 6. Mark a channel as read
-- --------------------------------------------------------------------------
create or replace function public.chat_channel_read(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_can_see_channel(p_channel, auth.uid()) then
    raise exception 'not_member';
  end if;

  insert into public.chat_channel_reads (user_id, channel_id, last_read_at)
  values (auth.uid(), p_channel, now())
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- --------------------------------------------------------------------------
-- 7. Create / edit / delete sections  (owner + admin)
-- --------------------------------------------------------------------------
create or replace function public.chat_section_create(p_room uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'not_allowed';
  end if;

  v_name := left(btrim(coalesce(p_name, '')), 40);
  if char_length(v_name) < 1 then raise exception 'bad_name'; end if;

  if (select count(*) from public.chat_sections where room_id = p_room) >= 20 then
    raise exception 'section_limit';
  end if;

  insert into public.chat_sections (room_id, name, position)
  values (p_room, v_name,
          coalesce((select max(position) + 1 from public.chat_sections where room_id = p_room), 0))
  returning id into v_id;

  perform public.chat_log(p_room, 'section.create', null, jsonb_build_object('name', v_name));
  return v_id;
end;
$$;

create or replace function public.chat_section_update(p_section uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select room_id into v_room from public.chat_sections where id = p_section;
  if v_room is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_room, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  v_name := left(btrim(coalesce(p_name, '')), 40);
  if char_length(v_name) < 1 then raise exception 'bad_name'; end if;

  update public.chat_sections set name = v_name where id = p_section;
  perform public.chat_log(v_room, 'section.update', null, jsonb_build_object('name', v_name));
end;
$$;

-- channels inside a deleted section are kept, they just become uncategorized
create or replace function public.chat_section_delete(p_section uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select room_id into v_room from public.chat_sections where id = p_section;
  if v_room is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_room, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  delete from public.chat_sections where id = p_section;
  perform public.chat_log(v_room, 'section.delete');
end;
$$;

-- --------------------------------------------------------------------------
-- 8. Create / edit / delete channels  (owner + admin)
-- --------------------------------------------------------------------------
create or replace function public.chat_channel_norm_name(p_name text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', '-', 'g'),
      '[^a-z0-9_-]', '', 'g'),
    32);
$$;

create or replace function public.chat_channel_create(
  p_room uuid,
  p_name text,
  p_type text default 'text',
  p_section uuid default null,
  p_private boolean default false,
  p_topic text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'not_allowed';
  end if;

  if p_type is null or p_type not in ('text', 'announcements', 'discussion', 'spoiler', 'sensitive', 'roadmap', 'event') then
    raise exception 'bad_kind';
  end if;

  v_name := public.chat_channel_norm_name(p_name);
  if v_name !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then raise exception 'bad_channel_name'; end if;
  if exists (select 1 from public.chat_channels where room_id = p_room and name = v_name) then
    raise exception 'name_taken';
  end if;

  if p_section is not null and not exists (
    select 1 from public.chat_sections where id = p_section and room_id = p_room
  ) then
    raise exception 'channel_not_found';
  end if;

  if (select count(*) from public.chat_channels where room_id = p_room) >= 50 then
    raise exception 'channel_limit';
  end if;

  insert into public.chat_channels (room_id, section_id, name, topic, type, is_private, position, created_by)
  values (
    p_room, p_section, v_name,
    nullif(left(btrim(coalesce(p_topic, '')), 200), ''),
    p_type, coalesce(p_private, false),
    coalesce((select max(position) + 1 from public.chat_channels
              where room_id = p_room and section_id is not distinct from p_section), 0),
    auth.uid()
  )
  returning id into v_id;

  perform public.chat_log(p_room, 'channel.create', null,
                          jsonb_build_object('name', v_name, 'type', p_type, 'private', coalesce(p_private, false)));
  return v_id;
end;
$$;

create or replace function public.chat_channel_update(
  p_channel uuid,
  p_name text,
  p_topic text default null,
  p_type text default null,
  p_section uuid default null,
  p_private boolean default null,
  p_move boolean default false      -- true = also apply p_section (null then means "no section")
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch   public.chat_channels;
  v_role text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  v_name := public.chat_channel_norm_name(p_name);
  if v_name !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then raise exception 'bad_channel_name'; end if;
  if v_name <> v_ch.name and exists (
    select 1 from public.chat_channels where room_id = v_ch.room_id and name = v_name
  ) then
    raise exception 'name_taken';
  end if;

  if p_type is not null and p_type not in ('text', 'announcements', 'discussion', 'spoiler', 'sensitive', 'roadmap', 'event') then
    raise exception 'bad_kind';
  end if;

  -- the default channel is where old messages live, so it must stay open to everyone
  if v_ch.is_default and coalesce(p_private, false) then
    raise exception 'default_channel';
  end if;

  if p_move and p_section is not null and not exists (
    select 1 from public.chat_sections where id = p_section and room_id = v_ch.room_id
  ) then
    raise exception 'channel_not_found';
  end if;

  update public.chat_channels
  set name       = v_name,
      topic      = nullif(left(btrim(coalesce(p_topic, '')), 200), ''),
      type       = coalesce(p_type, type),
      is_private = coalesce(p_private, is_private),
      section_id = case when p_move then p_section else section_id end
  where id = p_channel;

  perform public.chat_log(v_ch.room_id, 'channel.update', null, jsonb_build_object('name', v_name));
end;
$$;

create or replace function public.chat_channel_delete(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch   public.chat_channels;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  if v_ch.is_default then raise exception 'default_channel'; end if;

  delete from public.chat_channels where id = p_channel;   -- cascades to its messages
  perform public.chat_log(v_ch.room_id, 'channel.delete', null, jsonb_build_object('name', v_ch.name));
end;
$$;

-- --------------------------------------------------------------------------
-- 9. Private channel members (owner + admin)
-- --------------------------------------------------------------------------
create or replace function public.chat_channel_members_list(p_channel uuid)
returns table (user_id uuid, username text, display_name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select room_id into v_room from public.chat_channels where id = p_channel;
  if v_room is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_room, auth.uid());
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  return query
  select p.id, p.username::text, p.display_name::text, p.avatar_url::text
  from public.chat_channel_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.channel_id = p_channel
  order by cm.created_at;
end;
$$;

create or replace function public.chat_channel_member_set(p_channel uuid, p_username text, p_add boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
  v_user uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select room_id into v_room from public.chat_channels where id = p_channel;
  if v_room is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_room, auth.uid());
  if v_role is null or v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  select id into v_user from public.profiles
  where lower(username) = lower(btrim(coalesce(p_username, ''))) limit 1;
  if v_user is null then raise exception 'user_not_found'; end if;

  if coalesce(p_add, true) then
    if public.chat_role_of(v_room, v_user) is null then raise exception 'not_member'; end if;
    insert into public.chat_channel_members (channel_id, user_id, added_by)
    values (p_channel, v_user, auth.uid())
    on conflict do nothing;
  else
    delete from public.chat_channel_members where channel_id = p_channel and user_id = v_user;
  end if;

  perform public.chat_log(v_room, case when coalesce(p_add, true) then 'channel.member_add' else 'channel.member_remove' end,
                          v_user, jsonb_build_object('channel', p_channel));
end;
$$;

-- --------------------------------------------------------------------------
-- 10. Posting into a channel
--     * announcements: owner + admin only
--     * discussion / roadmap / event: read-only for now (their screens come later)
--     * private channels: only people who can see them
--     * NO inbox row per member. Only @mentioned people get one.
--     * a PRIVATE channel never updates the community's "last message" preview
-- --------------------------------------------------------------------------
create or replace function public.chat_send_channel(p_channel uuid, p_body text, p_reply uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch   public.chat_channels;
  v_role text;
  v_msg  public.chat_messages;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_can_see_channel(p_channel, auth.uid()) then raise exception 'not_allowed'; end if;

  if v_ch.type = 'announcements' and v_role not in ('owner', 'admin') then
    raise exception 'announce_only';
  end if;
  if v_ch.type in ('discussion', 'roadmap', 'event') then
    raise exception 'channel_type_unsupported';
  end if;

  if p_body is null or btrim(p_body) = '' then raise exception 'empty_message'; end if;
  if char_length(btrim(p_body)) > 2000 then raise exception 'too_long'; end if;

  insert into public.chat_messages (room_id, sender_id, body, reply_to, channel_id)
  values (v_ch.room_id, auth.uid(), btrim(p_body), p_reply, p_channel)
  returning * into v_msg;

  if not v_ch.is_private then
    update public.chat_rooms
    set last_message_id = v_msg.id, last_message_at = v_msg.created_at
    where id = v_ch.room_id;
  end if;

  -- inbox rows only for people who were @mentioned (and can actually see this channel)
  insert into public.chat_inbox (user_id, room_id, kind, from_id, message_id, preview, read_at, created_at)
  select u.id, v_ch.room_id, 'message', auth.uid(), v_msg.id, left(v_msg.body, 180), null, now()
  from (
    select distinct p.id
    from regexp_matches(v_msg.body, '@([A-Za-z0-9_]{3,20})', 'g') as mm(hit)
    join public.profiles p on lower(p.username) = lower((mm.hit)[1])
    where p.id <> auth.uid()
      and public.chat_can_see_channel(p_channel, p.id)
  ) u;

  return v_msg;
end;
$$;

-- --------------------------------------------------------------------------
-- 11. Notification level per community  (all | mentions | none)
-- --------------------------------------------------------------------------
create or replace function public.chat_set_notif(p_room uuid, p_level text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_level is null or p_level not in ('all', 'mentions', 'none') then raise exception 'bad_status'; end if;
  if not public.chat_has_membership(p_room, auth.uid()) then raise exception 'not_member'; end if;

  insert into public.chat_prefs (user_id, room_id, notif_level)
  values (auth.uid(), p_room, p_level)
  on conflict (user_id, room_id) do update set notif_level = excluded.notif_level;
end;
$$;

create or replace function public.chat_notif_levels()
returns table (room_id uuid, level text)
language sql
stable
security definer
set search_path = public
as $$
  select pf.room_id, pf.notif_level::text
  from public.chat_prefs pf
  where pf.user_id = auth.uid() and pf.notif_level <> 'all';
$$;

-- --------------------------------------------------------------------------
-- 12. Pins + media must not leak private channels
--     Same functions as v4, with one extra filter line each.
-- --------------------------------------------------------------------------
create or replace function public.chat_pinned(p_room uuid)
returns table (
  message_id      uuid,
  pinned_at       timestamptz,
  pinned_by       uuid,
  sender_id       uuid,
  body            text,
  created_at      timestamptz,
  attachment_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  return query
  select p.message_id, p.pinned_at, p.pinned_by, m.sender_id, m.body, m.created_at, m.attachment_name::text
  from public.chat_pins p
  join public.chat_messages m on m.id = p.message_id
  where p.room_id = p_room
    and m.deleted_at is null
    and (m.channel_id is null or public.chat_can_see_channel(m.channel_id, auth.uid()))
  order by p.pinned_at desc;
end;
$$;

create or replace function public.chat_room_media(p_room uuid, p_before timestamptz default null, p_limit int default 60)
returns table (
  id              uuid,
  sender_id       uuid,
  created_at      timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cleared timestamptz;
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  select pf.cleared_at into v_cleared
  from public.chat_prefs pf
  where pf.user_id = auth.uid() and pf.room_id = p_room;

  return query
  select m.id, m.sender_id, m.created_at,
         m.attachment_path::text, m.attachment_name::text, m.attachment_type::text,
         coalesce(m.attachment_size, 0)::bigint
  from public.chat_messages m
  where m.room_id = p_room
    and m.attachment_path is not null
    and m.deleted_at is null
    and (m.channel_id is null or public.chat_can_see_channel(m.channel_id, auth.uid()))
    and (v_cleared is null or m.created_at > v_cleared)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
end;
$$;

-- --------------------------------------------------------------------------
-- 13. Who may call what
-- --------------------------------------------------------------------------
grant execute on function public.chat_channels_list(uuid)                                   to authenticated;
grant execute on function public.chat_channel_read(uuid)                                    to authenticated;
grant execute on function public.chat_section_create(uuid, text)                            to authenticated;
grant execute on function public.chat_section_update(uuid, text)                            to authenticated;
grant execute on function public.chat_section_delete(uuid)                                  to authenticated;
grant execute on function public.chat_channel_create(uuid, text, text, uuid, boolean, text) to authenticated;
grant execute on function public.chat_channel_update(uuid, text, text, text, uuid, boolean, boolean) to authenticated;
grant execute on function public.chat_channel_delete(uuid)                                  to authenticated;
grant execute on function public.chat_channel_members_list(uuid)                            to authenticated;
grant execute on function public.chat_channel_member_set(uuid, text, boolean)               to authenticated;
grant execute on function public.chat_send_channel(uuid, text, uuid)                        to authenticated;
grant execute on function public.chat_set_notif(uuid, text)                                 to authenticated;
grant execute on function public.chat_notif_levels()                                        to authenticated;

-- --------------------------------------------------------------------------
-- 14. Real-time for the channel list (a new channel shows up without a refresh)
--     Messages are already in the publication from v3.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_channels', 'chat_sections']
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
