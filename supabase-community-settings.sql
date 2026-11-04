-- ==========================================================================
-- SPECSOFT® Chats  v8: community settings, roles + permissions, moderation
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-community-channels-v3.sql (v7).
-- It is safe to re-run.
--
-- What this adds
--   PROFILE      avatar + banner + tags + welcome text for a community
--   ROLES        custom roles with permissions, ranks (higher role = more power),
--                one default "Member" role everybody has, and templates:
--                  Title      cosmetic only (name + color, no permissions)
--                  Member     talk, start forum posts
--                  Moderator  Member + delete messages, lock/pin posts, timeout, kick, ban, read the log
--                  Manager    Moderator + channels, events, invites, announcements
--                  Admin      every permission (roles + community profile too)
--                The owner can do everything, and can also delete the community.
--                Existing owners/admins keep working exactly as before (they hold every permission).
--   INVITES      visibility: discoverable | invite_only | private, new invite code
--   MODERATION   kick, ban / unban, timeout (mute), delete messages, and a moderation log
--   INSIGHTS     a tiny 7-day activity summary
--   DELETE       delete a community (owner, type the name to confirm)
--
-- Everything is ADDITIVE. The channel / forum / roadmap / event functions from v5 + v6
-- are re-created at the bottom with ONE change: "owner or admin" became a permission check.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_community_settings (
  room_id     uuid primary key references public.chat_rooms(id) on delete cascade,
  avatar_path text,
  banner_path text,
  tags        text[] not null default '{}',
  visibility  text not null default 'invite_only'
              check (visibility in ('discoverable', 'invite_only', 'private')),
  welcome     text check (welcome is null or char_length(welcome) <= 500),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.chat_roles (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 32),
  color      text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  template   text check (template is null or template in ('title', 'member', 'moderator', 'manager', 'admin', 'custom')),
  perms      text[] not null default '{}',
  position   int  not null default 0,           -- 0 = top of the list = highest rank
  is_default boolean not null default false,    -- the "everyone" role
  created_at timestamptz not null default now()
);

create unique index if not exists chat_roles_name_idx        on public.chat_roles (room_id, lower(name));
create unique index if not exists chat_roles_one_default_idx on public.chat_roles (room_id) where is_default;
create index        if not exists chat_roles_room_idx        on public.chat_roles (room_id, position);

create table if not exists public.chat_member_roles (
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.chat_roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists chat_member_roles_room_idx on public.chat_member_roles (room_id, user_id);

create table if not exists public.chat_bans (
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text check (reason is null or char_length(reason) <= 200),
  banned_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.chat_timeouts (
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  until      timestamptz not null,
  reason     text check (reason is null or char_length(reason) <= 200),
  set_by     uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- no foreign key on room_id on purpose: the log must be writable while a room is being deleted
create table if not exists public.chat_mod_log (
  id         bigint generated always as identity primary key,
  room_id    uuid not null,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  target_id  uuid references public.profiles(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_mod_log_room_idx on public.chat_mod_log (room_id, created_at desc);

-- --------------------------------------------------------------------------
-- 2. Row level security. Reads only, and only what the browser needs live.
--    Bans, timeouts and the log are never read directly: they go through functions.
-- --------------------------------------------------------------------------
alter table public.chat_community_settings enable row level security;
alter table public.chat_roles              enable row level security;
alter table public.chat_member_roles       enable row level security;
alter table public.chat_bans               enable row level security;
alter table public.chat_timeouts           enable row level security;
alter table public.chat_mod_log            enable row level security;

drop policy if exists "community settings readable by members" on public.chat_community_settings;
create policy "community settings readable by members"
on public.chat_community_settings for select
using (public.chat_has_membership(room_id, auth.uid()));

drop policy if exists "chat roles readable by members" on public.chat_roles;
create policy "chat roles readable by members"
on public.chat_roles for select
using (public.chat_has_membership(room_id, auth.uid()));

drop policy if exists "chat member roles readable by members" on public.chat_member_roles;
create policy "chat member roles readable by members"
on public.chat_member_roles for select
using (public.chat_has_membership(room_id, auth.uid()));

-- --------------------------------------------------------------------------
-- 3. The permission engine
--    Permissions are plain words. The catalog is the ONE list the server accepts.
-- --------------------------------------------------------------------------
create or replace function public.chat_perm_catalog()
returns text[]
language sql
immutable
as $$
  select array[
    'send_messages', 'create_posts', 'post_announcements',
    'manage_messages', 'manage_threads', 'manage_events',
    'timeout_members', 'kick_members', 'ban_members', 'view_mod_log',
    'manage_channels', 'manage_invites', 'manage_roles', 'manage_community'
  ]::text[];
$$;

create or replace function public.chat_template_perms(p_template text)
returns text[]
language sql
immutable
as $$
  select case p_template
    when 'member' then array['send_messages', 'create_posts']::text[]
    when 'moderator' then array['send_messages', 'create_posts', 'manage_messages', 'manage_threads',
                                'timeout_members', 'kick_members', 'ban_members', 'view_mod_log']::text[]
    when 'manager' then array['send_messages', 'create_posts', 'post_announcements', 'manage_messages', 'manage_threads',
                              'manage_events', 'timeout_members', 'kick_members', 'ban_members', 'view_mod_log',
                              'manage_channels', 'manage_invites']::text[]
    when 'admin' then public.chat_perm_catalog()
    else array[]::text[]
  end;
$$;

-- every community gets Admin / Manager / Moderator / Member (Member = the default role)
create or replace function public.chat_community_roles_seed(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_roles_seed:' || p_room::text));

  insert into public.chat_community_settings (room_id, visibility)
  select r.id, case when r.is_public then 'discoverable' else 'invite_only' end
  from public.chat_rooms r
  where r.id = p_room
  on conflict (room_id) do nothing;

  if exists (select 1 from public.chat_roles where room_id = p_room) then
    return;
  end if;

  insert into public.chat_roles (room_id, name, color, template, perms, position, is_default) values
    (p_room, 'Admin',     '#e5484d', 'admin',     public.chat_template_perms('admin'),     0, false),
    (p_room, 'Manager',   '#f5a524', 'manager',   public.chat_template_perms('manager'),   1, false),
    (p_room, 'Moderator', '#3ddc84', 'moderator', public.chat_template_perms('moderator'), 2, false),
    (p_room, 'Member',    null,      'member',    public.chat_template_perms('member'),    3, true);
end;
$$;

revoke execute on function public.chat_community_roles_seed(uuid) from public, anon, authenticated;

-- rank: owner > old-style admin > custom roles (top of the list first) > everybody else
create or replace function public.chat_rank_of(p_room uuid, p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.chat_rooms r where r.id = p_room and r.owner_id = p_user) then 1000000
    when exists (
      select 1 from public.chat_members m
      where m.room_id = p_room and m.user_id = p_user and m.role::text in ('owner', 'admin')
    ) then 100000
    else coalesce((
      select max(1000 - cr.position)
      from public.chat_member_roles mr
      join public.chat_roles cr on cr.id = mr.role_id
      where mr.room_id = p_room and mr.user_id = p_user and not cr.is_default
    ), 0)
  end;
$$;

create or replace function public.chat_has_perm(p_room uuid, p_user uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then false
    when not exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = p_user) then false
    when exists (select 1 from public.chat_rooms r where r.id = p_room and r.owner_id = p_user) then true
    when exists (
      select 1 from public.chat_members m
      where m.room_id = p_room and m.user_id = p_user and m.role::text in ('owner', 'admin')
    ) then true
    when exists (
      select 1 from public.chat_roles cr
      where cr.room_id = p_room
        and p_perm = any (cr.perms)
        and (cr.is_default or exists (
              select 1 from public.chat_member_roles mr where mr.role_id = cr.id and mr.user_id = p_user))
    ) then true
    -- a community that has no roles yet keeps the member basics open
    when p_perm in ('send_messages', 'create_posts')
         and not exists (select 1 from public.chat_roles cr where cr.room_id = p_room) then true
    else false
  end;
$$;

grant execute on function public.chat_perm_catalog()                    to authenticated;
grant execute on function public.chat_template_perms(text)              to authenticated;
grant execute on function public.chat_has_perm(uuid, uuid, text)        to authenticated;   -- the RLS + storage policies call it
revoke execute on function public.chat_rank_of(uuid, uuid) from public, anon, authenticated;

-- what the browser needs to show or hide buttons (the server still checks every action)
create or replace function public.chat_my_perms(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perms text[];
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  perform public.chat_community_roles_seed(p_room);

  select coalesce(array_agg(pc.k), '{}'::text[]) into v_perms
  from unnest(public.chat_perm_catalog()) as pc(k)
  where public.chat_has_perm(p_room, auth.uid(), pc.k);

  return jsonb_build_object(
    'perms', to_jsonb(v_perms),
    'owner', exists (select 1 from public.chat_rooms r where r.id = p_room and r.owner_id = auth.uid()),
    'rank',  public.chat_rank_of(p_room, auth.uid()),
    'role_ids', coalesce((select jsonb_agg(mr.role_id) from public.chat_member_roles mr
                          where mr.room_id = p_room and mr.user_id = auth.uid()), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.chat_my_perms(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 4. Moderation log helper (internal) + automatic join / leave entries
-- --------------------------------------------------------------------------
create or replace function public.chat_mod_record(
  p_room   uuid,
  p_action text,
  p_target uuid  default null,
  p_meta   jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_mod_log (room_id, actor_id, action, target_id, meta)
  values (p_room, auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb));
$$;

revoke execute on function public.chat_mod_record(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- joins / leaves of communities are logged, and a person who leaves loses their roles
create or replace function public.chat_member_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_user uuid;
  v_act  text;
begin
  if tg_op = 'INSERT' then
    v_room := new.room_id; v_user := new.user_id; v_act := 'member.join';
  else
    v_room := old.room_id; v_user := old.user_id; v_act := 'member.leave';
    delete from public.chat_member_roles where room_id = v_room and user_id = v_user;
    delete from public.chat_channel_members cm
    using public.chat_channels c
    where cm.channel_id = c.id and c.room_id = v_room and cm.user_id = v_user;
  end if;

  if not exists (select 1 from public.chat_rooms r where r.id = v_room and r.kind::text = 'community') then
    return null;
  end if;

  if v_act = 'member.leave' and coalesce(current_setting('chat.skip_leave_log', true), '') = '1' then
    return null;      -- a kick or a ban writes its own, better entry
  end if;

  insert into public.chat_mod_log (room_id, actor_id, action, target_id)
  values (v_room, v_user, v_act, v_user);
  return null;
end;
$$;

drop trigger if exists chat_member_log_trg on public.chat_members;
create trigger chat_member_log_trg
after insert or delete on public.chat_members
for each row execute function public.chat_member_log();

-- --------------------------------------------------------------------------
-- 5. Guards that work no matter which function adds a member / sends a message
-- --------------------------------------------------------------------------
-- banned people cannot (re)join. PRIVATE communities only accept people who were invited by name.
create or replace function public.chat_member_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vis text;
begin
  if exists (select 1 from public.chat_bans b where b.room_id = new.room_id and b.user_id = new.user_id) then
    raise exception 'banned';
  end if;

  select s.visibility into v_vis from public.chat_community_settings s where s.room_id = new.room_id;

  if v_vis = 'private'
     and not exists (select 1 from public.chat_rooms r where r.id = new.room_id and r.owner_id = new.user_id) then
    begin
      if not exists (
        select 1 from public.chat_invites i
        where i.room_id = new.room_id and i.invited_user_id = new.user_id
      ) then
        raise exception 'private_community';
      end if;
    exception
      when undefined_column or undefined_table then
        null;     -- the invite table looks different than expected: do not block anybody
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists chat_member_guard_trg on public.chat_members;
create trigger chat_member_guard_trg
before insert on public.chat_members
for each row execute function public.chat_member_guard();

-- a person in timeout cannot post (one primary-key lookup per message)
create or replace function public.chat_timeout_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.chat_timeouts t
    where t.room_id = new.room_id and t.user_id = new.sender_id and t.until > now()
  ) then
    raise exception 'timed_out';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_timeout_guard_trg on public.chat_messages;
create trigger chat_timeout_guard_trg
before insert on public.chat_messages
for each row execute function public.chat_timeout_guard();

-- --------------------------------------------------------------------------
-- 6. Existing community functions, now permission based
--    These are the v5 + v6 functions, copied as they were. The only changes:
--      * "owner or admin"  ->  public.chat_has_perm(room, user, '<permission>')
--      * chat_log(...)     ->  chat_mod_record(...)      (so it shows in the moderation log)
--      * posting also needs the send_messages / create_posts permission
--    Old-style owners and admins hold every permission, so nothing changes for them.
-- --------------------------------------------------------------------------

-- private channels: owner, old-style admins, anybody who can manage channels, and people you added
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
        or public.chat_has_perm(c.room_id, p_user, 'manage_channels')
        or exists (
          select 1 from public.chat_channel_members cm
          where cm.channel_id = c.id and cm.user_id = p_user
        )
      )
  );
$$;

-- new communities get #general AND the default roles
create or replace function public.chat_community_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind::text = 'community' then
    perform public.chat_community_seed(new.id);
    perform public.chat_community_roles_seed(new.id);
  end if;
  return new;
end;
$$;

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
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;
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

  perform public.chat_mod_record(p_room, 'section.create', null, jsonb_build_object('name', v_name));
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
  if not public.chat_has_perm(v_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

  v_name := left(btrim(coalesce(p_name, '')), 40);
  if char_length(v_name) < 1 then raise exception 'bad_name'; end if;

  update public.chat_sections set name = v_name where id = p_section;
  perform public.chat_mod_record(v_room, 'section.update', null, jsonb_build_object('name', v_name));
end;
$$;

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
  if not public.chat_has_perm(v_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

  delete from public.chat_sections where id = p_section;
  perform public.chat_mod_record(v_room, 'section.delete');
end;
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
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;
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

  perform public.chat_mod_record(p_room, 'channel.create', null,
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
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

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

  perform public.chat_mod_record(v_ch.room_id, 'channel.update', null, jsonb_build_object('name', v_name));
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
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

  if v_ch.is_default then raise exception 'default_channel'; end if;

  delete from public.chat_channels where id = p_channel;   -- cascades to its messages
  perform public.chat_mod_record(v_ch.room_id, 'channel.delete', null, jsonb_build_object('name', v_ch.name));
end;
$$;

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
  if v_role is null or not public.chat_has_perm(v_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

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
  if v_role is null or not public.chat_has_perm(v_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

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

  perform public.chat_mod_record(v_room, case when coalesce(p_add, true) then 'channel.member_add' else 'channel.member_remove' end,
                          v_user, jsonb_build_object('channel', p_channel));
end;
$$;

create or replace function public.chat_layout_save(p_room uuid, p_layout jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_channels') then raise exception 'not_allowed'; end if;

  if p_layout is null
     or jsonb_typeof(p_layout) <> 'object'
     or jsonb_typeof(coalesce(p_layout -> 'sections', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_layout -> 'channels', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_layout -> 'sections', '[]'::jsonb)) > 100
     or jsonb_array_length(coalesce(p_layout -> 'channels', '[]'::jsonb)) > 200 then
    raise exception 'bad_layout';
  end if;

  update public.chat_sections s
  set position = x.position
  from jsonb_to_recordset(coalesce(p_layout -> 'sections', '[]'::jsonb)) as x(id uuid, position int)
  where s.id = x.id and s.room_id = p_room;

  update public.chat_channels c
  set section_id = x.section_id,
      position   = x.position
  from jsonb_to_recordset(coalesce(p_layout -> 'channels', '[]'::jsonb)) as x(id uuid, section_id uuid, position int)
  where c.id = x.id
    and c.room_id = p_room
    and (x.section_id is null
         or exists (select 1 from public.chat_sections s2 where s2.id = x.section_id and s2.room_id = p_room));

  perform public.chat_mod_record(p_room, 'layout.update');
end;
$$;

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

  if v_ch.type = 'announcements' and not public.chat_has_perm(v_ch.room_id, auth.uid(), 'post_announcements') then
    raise exception 'announce_only';
  end if;
  if v_ch.type in ('discussion', 'roadmap', 'event') then
    raise exception 'channel_type_unsupported';
  end if;
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'send_messages') then raise exception 'no_send'; end if;

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

create or replace function public.chat_send_thread(p_thread uuid, p_body text, p_reply uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thr  public.chat_threads;
  v_ch   public.chat_channels;
  v_role text;
  v_msg  public.chat_messages;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_thr from public.chat_threads where id = p_thread;
  if v_thr.id is null then raise exception 'thread_not_found'; end if;
  select * into v_ch from public.chat_channels where id = v_thr.channel_id;

  v_role := public.chat_role_of(v_thr.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_can_see_channel(v_thr.channel_id, auth.uid()) then raise exception 'not_allowed'; end if;
  if v_thr.locked and not public.chat_has_perm(v_thr.room_id, auth.uid(), 'manage_threads') then raise exception 'thread_locked'; end if;
  if not public.chat_has_perm(v_thr.room_id, auth.uid(), 'send_messages') then raise exception 'no_send'; end if;

  if p_body is null or btrim(p_body) = '' then raise exception 'empty_message'; end if;
  if char_length(btrim(p_body)) > 2000 then raise exception 'too_long'; end if;

  insert into public.chat_messages (room_id, sender_id, body, reply_to, channel_id, thread_id)
  values (v_thr.room_id, auth.uid(), btrim(p_body), p_reply, v_thr.channel_id, p_thread)
  returning * into v_msg;

  update public.chat_threads
  set post_count = post_count + 1, last_post_at = v_msg.created_at
  where id = p_thread;

  if not v_ch.is_private then
    update public.chat_rooms
    set last_message_id = v_msg.id, last_message_at = v_msg.created_at
    where id = v_thr.room_id;
  end if;

  perform public.chat_inbox_mentions(v_msg.id, v_thr.channel_id);
  return v_msg;
end;
$$;

create or replace function public.chat_thread_set(p_thread uuid, p_pinned boolean default null, p_locked boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thr  public.chat_threads;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_thr from public.chat_threads where id = p_thread;
  if v_thr.id is null then raise exception 'thread_not_found'; end if;

  v_role := public.chat_role_of(v_thr.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_thr.room_id, auth.uid(), 'manage_threads') then raise exception 'not_allowed'; end if;

  update public.chat_threads
  set pinned = coalesce(p_pinned, pinned),
      locked = coalesce(p_locked, locked)
  where id = p_thread;

  perform public.chat_mod_record(v_thr.room_id, 'thread.update', null,
                          jsonb_build_object('thread', p_thread, 'pinned', p_pinned, 'locked', p_locked));
end;
$$;

create or replace function public.chat_thread_delete(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thr  public.chat_threads;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_thr from public.chat_threads where id = p_thread;
  if v_thr.id is null then raise exception 'thread_not_found'; end if;

  v_role := public.chat_role_of(v_thr.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_thr.room_id, auth.uid(), 'manage_threads') and v_thr.author_id is distinct from auth.uid() then
    raise exception 'not_allowed';
  end if;

  delete from public.chat_threads where id = p_thread;     -- cascades to its messages
  perform public.chat_mod_record(v_thr.room_id, 'thread.delete', v_thr.author_id, jsonb_build_object('title', v_thr.title));
end;
$$;

create or replace function public.chat_roadmap_save(
  p_channel uuid,
  p_id uuid,
  p_title text,
  p_desc text default null,
  p_status text default 'planned',
  p_target text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch    public.chat_channels;
  v_role  text;
  v_title text;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;
  if v_ch.type <> 'roadmap' then raise exception 'not_allowed'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'manage_events') then raise exception 'not_allowed'; end if;

  v_title := left(btrim(coalesce(p_title, '')), 80);
  if char_length(v_title) < 1 then raise exception 'bad_title'; end if;
  if p_status is null or p_status not in ('considering', 'planned', 'in_progress', 'shipped') then
    raise exception 'bad_status';
  end if;

  if p_id is null then
    if (select count(*) from public.chat_roadmap_items where channel_id = p_channel) >= 200 then
      raise exception 'roadmap_limit';
    end if;
    insert into public.chat_roadmap_items (channel_id, room_id, title, description, status, target, position, created_by)
    values (p_channel, v_ch.room_id, v_title,
            nullif(left(btrim(coalesce(p_desc, '')), 500), ''), p_status,
            nullif(left(btrim(coalesce(p_target, '')), 24), ''),
            coalesce((select max(position) + 1 from public.chat_roadmap_items
                      where channel_id = p_channel and status = p_status), 0),
            auth.uid())
    returning id into v_id;
  else
    update public.chat_roadmap_items
    set title = v_title,
        description = nullif(left(btrim(coalesce(p_desc, '')), 500), ''),
        status = p_status,
        target = nullif(left(btrim(coalesce(p_target, '')), 24), ''),
        updated_at = now()
    where id = p_id and channel_id = p_channel
    returning id into v_id;
    if v_id is null then raise exception 'item_not_found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.chat_roadmap_move(p_item uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it   public.chat_roadmap_items;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_it from public.chat_roadmap_items where id = p_item;
  if v_it.id is null then raise exception 'item_not_found'; end if;

  v_role := public.chat_role_of(v_it.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_it.room_id, auth.uid(), 'manage_events') then raise exception 'not_allowed'; end if;
  if p_status is null or p_status not in ('considering', 'planned', 'in_progress', 'shipped') then
    raise exception 'bad_status';
  end if;

  update public.chat_roadmap_items
  set status = p_status,
      position = coalesce((select max(position) + 1 from public.chat_roadmap_items
                           where channel_id = v_it.channel_id and status = p_status), 0),
      updated_at = now()
  where id = p_item;
end;
$$;

create or replace function public.chat_roadmap_delete(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it   public.chat_roadmap_items;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_it from public.chat_roadmap_items where id = p_item;
  if v_it.id is null then raise exception 'item_not_found'; end if;

  v_role := public.chat_role_of(v_it.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_it.room_id, auth.uid(), 'manage_events') then raise exception 'not_allowed'; end if;

  delete from public.chat_roadmap_items where id = p_item;
end;
$$;

create or replace function public.chat_event_save(
  p_channel uuid,
  p_id uuid,
  p_title text,
  p_desc text,
  p_location text,
  p_starts timestamptz,
  p_ends timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch    public.chat_channels;
  v_role  text;
  v_title text;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;
  if v_ch.type <> 'event' then raise exception 'not_allowed'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'manage_events') then raise exception 'not_allowed'; end if;

  v_title := left(btrim(coalesce(p_title, '')), 100);
  if char_length(v_title) < 1 then raise exception 'bad_title'; end if;
  if p_starts is null then raise exception 'bad_date'; end if;
  if p_ends is not null and p_ends <= p_starts then raise exception 'bad_date'; end if;

  if p_id is null then
    if (select count(*) from public.chat_events where channel_id = p_channel and starts_at > now() - interval '1 day') >= 100 then
      raise exception 'event_limit';
    end if;
    insert into public.chat_events (channel_id, room_id, title, description, location, starts_at, ends_at, created_by)
    values (p_channel, v_ch.room_id, v_title,
            nullif(left(btrim(coalesce(p_desc, '')), 1000), ''),
            nullif(left(btrim(coalesce(p_location, '')), 120), ''),
            p_starts, p_ends, auth.uid())
    returning id into v_id;
  else
    update public.chat_events
    set title = v_title,
        description = nullif(left(btrim(coalesce(p_desc, '')), 1000), ''),
        location = nullif(left(btrim(coalesce(p_location, '')), 120), ''),
        starts_at = p_starts,
        ends_at = p_ends
    where id = p_id and channel_id = p_channel
    returning id into v_id;
    if v_id is null then raise exception 'event_not_found'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.chat_event_delete(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev   public.chat_events;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ev from public.chat_events where id = p_event;
  if v_ev.id is null then raise exception 'event_not_found'; end if;

  v_role := public.chat_role_of(v_ev.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_has_perm(v_ev.room_id, auth.uid(), 'manage_events') then raise exception 'not_allowed'; end if;

  delete from public.chat_events where id = p_event;
end;
$$;

create or replace function public.chat_thread_create(p_channel uuid, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch    public.chat_channels;
  v_role  text;
  v_title text;
  v_body  text;
  v_thr   uuid;
  v_msg   public.chat_messages;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_ch from public.chat_channels where id = p_channel;
  if v_ch.id is null then raise exception 'channel_not_found'; end if;

  v_role := public.chat_role_of(v_ch.room_id, auth.uid());
  if v_role is null then raise exception 'not_member'; end if;
  if not public.chat_can_see_channel(p_channel, auth.uid()) then raise exception 'not_allowed'; end if;
  if v_ch.type <> 'discussion' then raise exception 'not_allowed'; end if;
  if not public.chat_has_perm(v_ch.room_id, auth.uid(), 'create_posts') then raise exception 'no_send'; end if;

  v_title := left(btrim(coalesce(p_title, '')), 100);
  if char_length(v_title) < 3 then raise exception 'bad_title'; end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'empty_message'; end if;
  if char_length(v_body) > 2000 then raise exception 'too_long'; end if;

  insert into public.chat_threads (channel_id, room_id, author_id, title, excerpt)
  values (p_channel, v_ch.room_id, auth.uid(), v_title, left(v_body, 160))
  returning id into v_thr;

  insert into public.chat_messages (room_id, sender_id, body, channel_id, thread_id)
  values (v_ch.room_id, auth.uid(), v_body, p_channel, v_thr)
  returning * into v_msg;

  if not v_ch.is_private then
    update public.chat_rooms
    set last_message_id = v_msg.id, last_message_at = v_msg.created_at
    where id = v_ch.room_id;
  end if;

  perform public.chat_inbox_mentions(v_msg.id, p_channel);
  return v_thr;
end;
$$;


-- --------------------------------------------------------------------------
-- 7. Community profile + visibility + invite code
-- --------------------------------------------------------------------------
create or replace function public.chat_community_get(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.chat_rooms;
  s public.chat_community_settings;
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  perform public.chat_community_roles_seed(p_room);

  select * into r from public.chat_rooms where id = p_room and kind::text = 'community';
  if r.id is null then raise exception 'room_not_found'; end if;

  select * into s from public.chat_community_settings where room_id = p_room;

  return jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'icon', r.icon,
    'description', r.description,
    'owner_id', r.owner_id,
    'avatar_path', s.avatar_path,
    'banner_path', s.banner_path,
    'tags', to_jsonb(coalesce(s.tags, '{}'::text[])),
    'visibility', coalesce(s.visibility, case when r.is_public then 'discoverable' else 'invite_only' end),
    'welcome', s.welcome,
    'invite_code', case when public.chat_has_perm(p_room, auth.uid(), 'manage_invites') then r.invite_code else null end,
    'member_count', (select count(*) from public.chat_members m where m.room_id = p_room)
  );
end;
$$;

-- avatar / banner / tags for a list of communities (the ones you are in, plus public ones)
create or replace function public.chat_community_meta(p_rooms uuid[])
returns table (room_id uuid, avatar_path text, banner_path text, tags text[])
language sql
stable
security definer
set search_path = public
as $$
  select s.room_id, s.avatar_path, s.banner_path, s.tags
  from public.chat_community_settings s
  join public.chat_rooms r on r.id = s.room_id
  where auth.uid() is not null
    and s.room_id = any (coalesce(p_rooms, '{}'::uuid[]))
    and (
      s.visibility = 'discoverable'
      or r.is_public
      or exists (select 1 from public.chat_members m where m.room_id = s.room_id and m.user_id = auth.uid())
    )
  limit 100;
$$;

create or replace function public.chat_community_profile_save(
  p_room          uuid,
  p_name          text,
  p_desc          text,
  p_icon          text,
  p_tags          text[],
  p_welcome       text,
  p_avatar_path   text    default null,
  p_banner_path   text    default null,
  p_clear_avatar  boolean default false,
  p_clear_banner  boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_tag   text;
  v_tags  text[] := '{}';
  v_icon  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_community') then raise exception 'not_allowed'; end if;

  v_name := left(btrim(coalesce(p_name, '')), 40);
  if char_length(v_name) < 2 then raise exception 'bad_name'; end if;

  foreach v_tag in array coalesce(p_tags, '{}'::text[]) loop
    v_tag := regexp_replace(lower(btrim(coalesce(v_tag, ''))), '\s+', '-', 'g');
    v_tag := left(regexp_replace(v_tag, '[^a-z0-9-]', '', 'g'), 20);
    if char_length(v_tag) >= 2 and not (v_tag = any (v_tags)) then
      v_tags := v_tags || v_tag;
    end if;
  end loop;
  if coalesce(array_length(v_tags, 1), 0) > 8 then raise exception 'too_many_tags'; end if;

  if p_avatar_path is not null and left(p_avatar_path, 37) <> p_room::text || '/' then raise exception 'bad_path'; end if;
  if p_banner_path is not null and left(p_banner_path, 37) <> p_room::text || '/' then raise exception 'bad_path'; end if;

  v_icon := nullif(left(btrim(coalesce(p_icon, '')), 8), '');

  update public.chat_rooms
  set name        = v_name,
      description = nullif(left(btrim(coalesce(p_desc, '')), 200), ''),
      icon        = coalesce(v_icon, icon)
  where id = p_room;

  insert into public.chat_community_settings (room_id, tags, welcome, avatar_path, banner_path, updated_by)
  values (
    p_room, v_tags,
    nullif(left(btrim(coalesce(p_welcome, '')), 500), ''),
    case when p_clear_avatar then null else p_avatar_path end,
    case when p_clear_banner then null else p_banner_path end,
    auth.uid()
  )
  on conflict (room_id) do update
  set tags        = excluded.tags,
      welcome     = excluded.welcome,
      avatar_path = case when p_clear_avatar then null
                         when p_avatar_path is not null then p_avatar_path
                         else public.chat_community_settings.avatar_path end,
      banner_path = case when p_clear_banner then null
                         when p_banner_path is not null then p_banner_path
                         else public.chat_community_settings.banner_path end,
      updated_at  = now(),
      updated_by  = auth.uid();

  perform public.chat_mod_record(p_room, 'community.profile', null, jsonb_build_object('name', v_name));
end;
$$;

create or replace function public.chat_community_visibility_set(p_room uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_invites') then raise exception 'not_allowed'; end if;
  if p_visibility is null or p_visibility not in ('discoverable', 'invite_only', 'private') then
    raise exception 'bad_status';
  end if;

  insert into public.chat_community_settings (room_id, visibility, updated_by)
  values (p_room, p_visibility, auth.uid())
  on conflict (room_id) do update
  set visibility = excluded.visibility, updated_at = now(), updated_by = auth.uid();

  -- the old "public" flag drives the existing Discover list
  update public.chat_rooms set is_public = (p_visibility = 'discoverable') where id = p_room;

  perform public.chat_mod_record(p_room, 'invite.visibility', null, jsonb_build_object('visibility', p_visibility));
end;
$$;

create or replace function public.chat_community_regen_code(p_room uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_invites') then raise exception 'not_allowed'; end if;

  update public.chat_rooms
  set invite_code = upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
  where id = p_room
  returning invite_code into v_code;

  perform public.chat_mod_record(p_room, 'invite.regen');
  return v_code;
end;
$$;

-- --------------------------------------------------------------------------
-- 8. Roles
-- --------------------------------------------------------------------------
create or replace function public.chat_roles_list(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  perform public.chat_community_roles_seed(p_room);

  return jsonb_build_object(
    'catalog', to_jsonb(public.chat_perm_catalog()),
    'templates', jsonb_build_object(
      'title',     to_jsonb(public.chat_template_perms('title')),
      'member',    to_jsonb(public.chat_template_perms('member')),
      'moderator', to_jsonb(public.chat_template_perms('moderator')),
      'manager',   to_jsonb(public.chat_template_perms('manager')),
      'admin',     to_jsonb(public.chat_template_perms('admin'))
    ),
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cr.id, 'name', cr.name, 'color', cr.color, 'template', cr.template,
          'perms', to_jsonb(cr.perms), 'position', cr.position, 'is_default', cr.is_default,
          'members', (select count(*) from public.chat_member_roles mr where mr.role_id = cr.id)
        )
        order by cr.is_default, cr.position, cr.created_at)
      from public.chat_roles cr
      where cr.room_id = p_room
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chat_role_save(
  p_room     uuid,
  p_id       uuid,
  p_name     text,
  p_color    text,
  p_perms    text[],
  p_template text default 'custom'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank  int;
  v_old   public.chat_roles;
  v_name  text;
  v_perms text[] := '{}';
  v_p     text;
  v_tpl   text;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_roles') then raise exception 'not_allowed'; end if;

  v_rank := public.chat_rank_of(p_room, auth.uid());

  v_name := left(btrim(coalesce(p_name, '')), 32);
  if char_length(v_name) < 1 then raise exception 'bad_name'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad_color'; end if;

  v_tpl := case when p_template in ('title', 'member', 'moderator', 'manager', 'admin') then p_template else 'custom' end;

  if p_id is not null then
    select * into v_old from public.chat_roles where id = p_id and room_id = p_room;
    if v_old.id is null then raise exception 'role_not_found'; end if;
    if not v_old.is_default and v_rank < 100000 and (1000 - v_old.position) >= v_rank then
      raise exception 'role_above_you';
    end if;
  end if;

  foreach v_p in array coalesce(p_perms, '{}'::text[]) loop
    if not (v_p = any (public.chat_perm_catalog())) then raise exception 'bad_permission'; end if;
    if not (v_p = any (v_perms)) then
      -- you can only hand out what you hold yourself (keeping what the role already had is fine)
      if not public.chat_has_perm(p_room, auth.uid(), v_p)
         and not (v_old.id is not null and v_p = any (v_old.perms)) then
        raise exception 'perm_above_you';
      end if;
      v_perms := v_perms || v_p;
    end if;
  end loop;
  if v_tpl = 'title' then v_perms := '{}'; end if;

  begin
    if p_id is null then
      if (select count(*) from public.chat_roles where room_id = p_room) >= 25 then
        raise exception 'role_limit';
      end if;
      insert into public.chat_roles (room_id, name, color, template, perms, position)
      values (p_room, v_name, p_color, v_tpl, v_perms,
              coalesce((select max(position) + 1 from public.chat_roles where room_id = p_room and not is_default), 0))
      returning id into v_id;
    else
      update public.chat_roles
      set name = v_name, color = p_color, template = v_tpl, perms = v_perms
      where id = p_id and room_id = p_room
      returning id into v_id;
    end if;
  exception
    when unique_violation then raise exception 'role_name_taken';
  end;

  perform public.chat_mod_record(p_room, 'role.save', null,
                                 jsonb_build_object('name', v_name, 'created', p_id is null));
  return v_id;
end;
$$;

create or replace function public.chat_role_delete(p_role uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.chat_roles;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_role from public.chat_roles where id = p_role;
  if v_role.id is null then raise exception 'role_not_found'; end if;
  if not public.chat_has_perm(v_role.room_id, auth.uid(), 'manage_roles') then raise exception 'not_allowed'; end if;
  if v_role.is_default then raise exception 'default_role'; end if;
  if public.chat_rank_of(v_role.room_id, auth.uid()) < 100000
     and (1000 - v_role.position) >= public.chat_rank_of(v_role.room_id, auth.uid()) then
    raise exception 'role_above_you';
  end if;

  delete from public.chat_roles where id = p_role;       -- member assignments go with it
  perform public.chat_mod_record(v_role.room_id, 'role.delete', null, jsonb_build_object('name', v_role.name));
end;
$$;

-- p_ids = every NON-default role of the community, highest rank first
create or replace function public.chat_roles_reorder(p_room uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_n    int;
  v_i    int;
  v_id   uuid;
  v_pos  int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_roles') then raise exception 'not_allowed'; end if;

  v_rank := public.chat_rank_of(p_room, auth.uid());
  v_n := coalesce(array_length(p_ids, 1), 0);

  if (select count(*) from public.chat_roles where room_id = p_room and not is_default) <> v_n
     or exists (
       select 1 from unnest(coalesce(p_ids, '{}'::uuid[])) as x(id)
       where not exists (select 1 from public.chat_roles r where r.id = x.id and r.room_id = p_room and not r.is_default)
     ) then
    raise exception 'bad_layout';
  end if;

  if v_rank < 100000 then
    for v_i in 1 .. v_n loop
      v_id := p_ids[v_i];
      select position into v_pos from public.chat_roles where id = v_id;
      if v_pos <> v_i - 1 and ((1000 - v_pos) >= v_rank or (1000 - (v_i - 1)) >= v_rank) then
        raise exception 'role_above_you';
      end if;
    end loop;
  end if;

  update public.chat_roles r
  set position = x.ord - 1
  from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as x(id, ord)
  where r.id = x.id and r.room_id = p_room;

  update public.chat_roles set position = v_n where room_id = p_room and is_default;

  perform public.chat_mod_record(p_room, 'role.reorder');
end;
$$;

create or replace function public.chat_member_roles_set(p_room uuid, p_user uuid, p_role_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank  int;
  v_trank int;
  v_cur   uuid[];
  v_want  uuid[];
  v_in    int;
  v_rid   uuid;
  v_role  public.chat_roles;
  v_added   text[] := '{}';
  v_removed text[] := '{}';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'manage_roles') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.chat_members where room_id = p_room and user_id = p_user) then
    raise exception 'not_member';
  end if;

  v_rank  := public.chat_rank_of(p_room, auth.uid());
  v_trank := public.chat_rank_of(p_room, p_user);

  if v_rank < 100000 and (p_user = auth.uid() or v_trank >= v_rank) then
    raise exception 'rank_too_low';
  end if;
  if v_trank >= 1000000 and p_user <> auth.uid() then
    raise exception 'rank_too_low';
  end if;

  select coalesce(array_agg(role_id), '{}'::uuid[]) into v_cur
  from public.chat_member_roles where room_id = p_room and user_id = p_user;

  select count(distinct x) into v_in from unnest(coalesce(p_role_ids, '{}'::uuid[])) as x;
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_want
  from public.chat_roles r
  where r.room_id = p_room and not r.is_default and r.id = any (coalesce(p_role_ids, '{}'::uuid[]));
  if coalesce(array_length(v_want, 1), 0) <> v_in then raise exception 'role_not_found'; end if;

  for v_rid in select x from unnest(v_want) as x where not (x = any (v_cur)) loop
    select * into v_role from public.chat_roles where id = v_rid;
    if v_rank < 100000 and (1000 - v_role.position) >= v_rank then raise exception 'role_above_you'; end if;
    insert into public.chat_member_roles (room_id, user_id, role_id, assigned_by)
    values (p_room, p_user, v_rid, auth.uid())
    on conflict do nothing;
    v_added := v_added || v_role.name;
  end loop;

  for v_rid in select x from unnest(v_cur) as x where not (x = any (v_want)) loop
    select * into v_role from public.chat_roles where id = v_rid;
    if v_rank < 100000 and (1000 - v_role.position) >= v_rank then raise exception 'role_above_you'; end if;
    delete from public.chat_member_roles where user_id = p_user and role_id = v_rid;
    v_removed := v_removed || v_role.name;
  end loop;

  if coalesce(array_length(v_added, 1), 0) + coalesce(array_length(v_removed, 1), 0) > 0 then
    perform public.chat_mod_record(p_room, 'member.roles', p_user,
                                   jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 9. Members
-- --------------------------------------------------------------------------
create or replace function public.chat_members_list(
  p_room   uuid,
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q   text;
  v_pat text;
  v_total int;
  v_rows  jsonb;
begin
  if auth.uid() is null or not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  v_q := nullif(btrim(coalesce(p_query, '')), '');
  if v_q is not null then
    v_q := left(v_q, 40);
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
  from public.chat_members m
  join public.profiles p on p.id = m.user_id
  where m.room_id = p_room
    and (v_pat is null or p.username ilike v_pat escape '\' or coalesce(p.display_name, '') ilike v_pat escape '\');

  select coalesce(jsonb_agg(x.obj order by x.rk desc, x.nm), '[]'::jsonb) into v_rows
  from (
    select
      public.chat_rank_of(p_room, m.user_id) as rk,
      lower(coalesce(nullif(p.display_name, ''), p.username)) as nm,
      jsonb_build_object(
        'user_id', m.user_id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'base_role', m.role::text,
        'is_owner', exists (select 1 from public.chat_rooms r where r.id = p_room and r.owner_id = m.user_id),
        'rank', public.chat_rank_of(p_room, m.user_id),
        'role_ids', coalesce((select jsonb_agg(mr.role_id) from public.chat_member_roles mr
                              where mr.room_id = p_room and mr.user_id = m.user_id), '[]'::jsonb),
        'timeout_until', (select t.until from public.chat_timeouts t
                          where t.room_id = p_room and t.user_id = m.user_id and t.until > now())
      ) as obj
    from public.chat_members m
    join public.profiles p on p.id = m.user_id
    where m.room_id = p_room
      and (v_pat is null or p.username ilike v_pat escape '\' or coalesce(p.display_name, '') ilike v_pat escape '\')
    order by rk desc, nm
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) x;

  return jsonb_build_object('total', v_total, 'members', v_rows);
end;
$$;

-- --------------------------------------------------------------------------
-- 10. Moderation: timeout, kick, ban, unban, delete a message, the log
-- --------------------------------------------------------------------------
-- internal: may the caller act on this person with this permission?
create or replace function public.chat_mod_gate(p_room uuid, p_target uuid, p_perm text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and kind::text = 'community') then
    raise exception 'room_not_found';
  end if;
  if not public.chat_has_perm(p_room, auth.uid(), p_perm) then raise exception 'not_allowed'; end if;
  if p_target is null or p_target = auth.uid() then raise exception 'bad_user'; end if;
  if exists (select 1 from public.chat_rooms where id = p_room and owner_id = p_target) then
    raise exception 'rank_too_low';
  end if;
  if public.chat_rank_of(p_room, p_target) >= public.chat_rank_of(p_room, auth.uid()) then
    raise exception 'rank_too_low';
  end if;
end;
$$;

revoke execute on function public.chat_mod_gate(uuid, uuid, text) from public, anon, authenticated;

-- p_minutes <= 0 (or null) lifts the timeout. Maximum 28 days.
create or replace function public.chat_member_timeout(p_room uuid, p_user uuid, p_minutes int, p_reason text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until  timestamptz;
  v_reason text;
begin
  perform public.chat_mod_gate(p_room, p_user, 'timeout_members');
  if not exists (select 1 from public.chat_members where room_id = p_room and user_id = p_user) then
    raise exception 'not_member';
  end if;

  v_reason := nullif(left(btrim(coalesce(p_reason, '')), 200), '');

  if p_minutes is null or p_minutes <= 0 then
    delete from public.chat_timeouts where room_id = p_room and user_id = p_user;
    perform public.chat_mod_record(p_room, 'member.timeout_clear', p_user);
    return null;
  end if;

  if p_minutes > 40320 then raise exception 'bad_duration'; end if;
  v_until := now() + make_interval(mins => p_minutes);

  insert into public.chat_timeouts (room_id, user_id, until, reason, set_by)
  values (p_room, p_user, v_until, v_reason, auth.uid())
  on conflict (room_id, user_id) do update
  set until = excluded.until, reason = excluded.reason, set_by = excluded.set_by, created_at = now();

  perform public.chat_mod_record(p_room, 'member.timeout', p_user,
                                 jsonb_build_object('minutes', p_minutes, 'reason', v_reason));
  return v_until;
end;
$$;

create or replace function public.chat_member_kick(p_room uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  perform public.chat_mod_gate(p_room, p_user, 'kick_members');
  if not exists (select 1 from public.chat_members where room_id = p_room and user_id = p_user) then
    raise exception 'not_member';
  end if;

  v_reason := nullif(left(btrim(coalesce(p_reason, '')), 200), '');

  perform set_config('chat.skip_leave_log', '1', true);
  delete from public.chat_members where room_id = p_room and user_id = p_user;
  perform set_config('chat.skip_leave_log', '', true);

  perform public.chat_mod_record(p_room, 'member.kick', p_user, jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.chat_member_ban(p_room uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  perform public.chat_mod_gate(p_room, p_user, 'ban_members');
  v_reason := nullif(left(btrim(coalesce(p_reason, '')), 200), '');

  insert into public.chat_bans (room_id, user_id, reason, banned_by)
  values (p_room, p_user, v_reason, auth.uid())
  on conflict (room_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();

  perform set_config('chat.skip_leave_log', '1', true);
  delete from public.chat_members where room_id = p_room and user_id = p_user;
  perform set_config('chat.skip_leave_log', '', true);

  delete from public.chat_timeouts where room_id = p_room and user_id = p_user;

  perform public.chat_mod_record(p_room, 'member.ban', p_user, jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.chat_member_unban(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'ban_members') then raise exception 'not_allowed'; end if;

  delete from public.chat_bans where room_id = p_room and user_id = p_user;
  perform public.chat_mod_record(p_room, 'member.unban', p_user);
end;
$$;

create or replace function public.chat_bans_list(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'ban_members') then raise exception 'not_allowed'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', b.user_id, 'username', p.username, 'display_name', p.display_name,
        'avatar_url', p.avatar_url, 'reason', b.reason, 'created_at', b.created_at,
        'banned_by', coalesce(nullif(bp.display_name, ''), bp.username))
      order by b.created_at desc)
    from public.chat_bans b
    join public.profiles p on p.id = b.user_id
    left join public.profiles bp on bp.id = b.banned_by
    where b.room_id = p_room
  ), '[]'::jsonb);
end;
$$;

-- delete somebody else's message (or your own)
create or replace function public.chat_mod_delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_msg from public.chat_messages where id = p_message;
  if v_msg.id is null then raise exception 'message_not_found'; end if;
  if not exists (select 1 from public.chat_rooms where id = v_msg.room_id and kind::text = 'community') then
    raise exception 'not_allowed';
  end if;
  if not public.chat_has_perm(v_msg.room_id, auth.uid(), 'manage_messages') then raise exception 'not_allowed'; end if;
  if v_msg.sender_id is distinct from auth.uid()
     and public.chat_rank_of(v_msg.room_id, v_msg.sender_id) >= public.chat_rank_of(v_msg.room_id, auth.uid()) then
    raise exception 'rank_too_low';
  end if;

  update public.chat_messages
  set deleted_at = now(), body = '',
      attachment_path = null, attachment_name = null, attachment_type = null, attachment_size = null
  where id = p_message and deleted_at is null;

  perform public.chat_mod_record(v_msg.room_id, 'message.delete', v_msg.sender_id,
                                 jsonb_build_object('channel', v_msg.channel_id));
end;
$$;

-- p_group: members | moderation | roles | channels | community   (null = everything)
create or replace function public.chat_mod_log_list(
  p_room   uuid,
  p_before timestamptz default null,
  p_limit  int         default 40,
  p_group  text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pat text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.chat_has_perm(p_room, auth.uid(), 'view_mod_log') then raise exception 'not_allowed'; end if;

  v_pat := case p_group
    when 'members'    then array['member.join', 'member.leave']
    when 'moderation' then array['member.kick', 'member.ban', 'member.unban', 'member.timeout%', 'message.delete']
    when 'roles'      then array['role.%', 'member.roles']
    when 'channels'   then array['channel.%', 'section.%', 'layout.%', 'thread.%']
    when 'community'  then array['community.%', 'invite.%']
    else null
  end;

  return coalesce((
    select jsonb_agg(x.obj order by x.ts desc, x.id desc)
    from (
      select
        l.id, l.created_at as ts,
        jsonb_build_object(
          'id', l.id, 'action', l.action, 'created_at', l.created_at, 'meta', l.meta,
          'actor',  jsonb_build_object('id', ap.id, 'username', ap.username, 'display_name', ap.display_name, 'avatar_url', ap.avatar_url),
          'target', jsonb_build_object('id', tp.id, 'username', tp.username, 'display_name', tp.display_name, 'avatar_url', tp.avatar_url)
        ) as obj
      from public.chat_mod_log l
      left join public.profiles ap on ap.id = l.actor_id
      left join public.profiles tp on tp.id = l.target_id
      where l.room_id = p_room
        and (p_before is null or l.created_at < p_before)
        and (v_pat is null or exists (select 1 from unnest(v_pat) as pt where l.action like pt))
      order by l.created_at desc, l.id desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- --------------------------------------------------------------------------
-- 11. Insights (last 7 days) + delete community
-- --------------------------------------------------------------------------
create or replace function public.chat_community_insights(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msgs int;
  v_active int;
  v_top jsonb;
  v_default uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (public.chat_has_perm(p_room, auth.uid(), 'manage_community')
          or public.chat_has_perm(p_room, auth.uid(), 'manage_channels')
          or public.chat_has_perm(p_room, auth.uid(), 'view_mod_log')) then
    raise exception 'not_allowed';
  end if;

  select id into v_default from public.chat_channels where room_id = p_room and is_default limit 1;

  with recent as (
    select m.sender_id, coalesce(m.channel_id, v_default) as channel_id
    from public.chat_messages m
    where m.room_id = p_room and m.deleted_at is null and m.created_at > now() - interval '7 days'
    limit 20000
  ),
  tot as (
    select count(*)::int as n, count(distinct sender_id)::int as a from recent
  ),
  top as (
    select c.id, c.name, count(*) as n
    from recent r
    join public.chat_channels c on c.id = r.channel_id
    group by c.id, c.name
    order by count(*) desc
    limit 5
  )
  select (select n from tot),
         (select a from tot),
         coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'messages', t.n) order by t.n desc) from top t), '[]'::jsonb)
  into v_msgs, v_active, v_top;

  return jsonb_build_object(
    'members', (select count(*) from public.chat_members where room_id = p_room),
    'messages_7d', v_msgs,
    'active_7d', v_active,
    'top_channels', v_top
  );
end;
$$;

create or replace function public.chat_community_delete(p_room uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.chat_rooms;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into r from public.chat_rooms where id = p_room and kind::text = 'community';
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.owner_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if btrim(coalesce(p_confirm, '')) <> r.name then raise exception 'confirm_mismatch'; end if;

  delete from public.chat_rooms where id = p_room;      -- everything inside cascades
end;
$$;

-- --------------------------------------------------------------------------
-- 12. Storage for the community picture + banner and chat backgrounds
--     GIFs and short videos are allowed for motion backgrounds; the upload path
--     still respects the community manage-permission check.
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-assets', 'community-assets', true, 41943040, array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update
set public = true, file_size_limit = 41943040, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];

drop policy if exists "community assets are public" on storage.objects;
create policy "community assets are public"
on storage.objects for select
using (bucket_id = 'community-assets');

drop policy if exists "community assets insert" on storage.objects;
create policy "community assets insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-assets'
  and public.chat_has_perm(((storage.foldername(name))[1])::uuid, auth.uid(), 'manage_community')
);

drop policy if exists "community assets update" on storage.objects;
create policy "community assets update"
on storage.objects for update to authenticated
using (
  bucket_id = 'community-assets'
  and public.chat_has_perm(((storage.foldername(name))[1])::uuid, auth.uid(), 'manage_community')
);

drop policy if exists "community assets delete" on storage.objects;
create policy "community assets delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'community-assets'
  and public.chat_has_perm(((storage.foldername(name))[1])::uuid, auth.uid(), 'manage_community')
);

-- --------------------------------------------------------------------------
-- 13. Who may call what
-- --------------------------------------------------------------------------
grant execute on function public.chat_community_get(uuid)                                                               to authenticated;
grant execute on function public.chat_community_meta(uuid[])                                                            to authenticated;
grant execute on function public.chat_community_profile_save(uuid, text, text, text, text[], text, text, text, boolean, boolean) to authenticated;
grant execute on function public.chat_community_visibility_set(uuid, text)                                              to authenticated;
grant execute on function public.chat_community_regen_code(uuid)                                                        to authenticated;
grant execute on function public.chat_roles_list(uuid)                                                                  to authenticated;
grant execute on function public.chat_role_save(uuid, uuid, text, text, text[], text)                                   to authenticated;
grant execute on function public.chat_role_delete(uuid)                                                                 to authenticated;
grant execute on function public.chat_roles_reorder(uuid, uuid[])                                                       to authenticated;
grant execute on function public.chat_member_roles_set(uuid, uuid, uuid[])                                              to authenticated;
grant execute on function public.chat_members_list(uuid, text, int, int)                                                to authenticated;
grant execute on function public.chat_member_timeout(uuid, uuid, int, text)                                             to authenticated;
grant execute on function public.chat_member_kick(uuid, uuid, text)                                                     to authenticated;
grant execute on function public.chat_member_ban(uuid, uuid, text)                                                      to authenticated;
grant execute on function public.chat_member_unban(uuid, uuid)                                                          to authenticated;
grant execute on function public.chat_bans_list(uuid)                                                                   to authenticated;
grant execute on function public.chat_mod_delete_message(uuid)                                                          to authenticated;
grant execute on function public.chat_mod_log_list(uuid, timestamptz, int, text)                                        to authenticated;
grant execute on function public.chat_community_insights(uuid)                                                          to authenticated;
grant execute on function public.chat_community_delete(uuid, text)                                                      to authenticated;

-- --------------------------------------------------------------------------
-- 14. Give every EXISTING community its roles + settings row (no message is touched)
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.chat_rooms where kind::text = 'community' loop
    perform public.chat_community_roles_seed(r.id);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 15. Real-time: roles and settings changes show up without a refresh
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_community_settings', 'chat_roles', 'chat_member_roles']
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

alter table public.chat_member_roles replica identity full;
