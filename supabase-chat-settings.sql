-- ==========================================================================
-- SPECSOFT® Chats  v4: chat settings
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-chats.sql (v3).
-- It is safe to re-run.
--
-- Everything here is ADDITIVE. No existing table, column or function is
-- changed, so your current chats keep working exactly as they do now.
--
-- What this adds
--   * chat_update_room    edit name / icon / description / visibility (owner + admin)
--   * chat_regen_invite   make a new invite code (owner + admin)
--   * chat_pins           pinned messages  + chat_set_pin / chat_pinned
--   * chat_room_media     list of images and files shared in a chat
--   * chat_audit          log of who changed what (the viewer comes later)
--
-- Roles it relies on: 'owner', 'admin', 'member' (the ones chats.js already uses).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_pins (
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  pinned_by  uuid references public.profiles(id) on delete set null,
  pinned_at  timestamptz not null default now(),
  primary key (room_id, message_id)
);

create index if not exists chat_pins_room_idx on public.chat_pins (room_id, pinned_at desc);

alter table public.chat_pins enable row level security;

drop policy if exists "chat pins readable by members" on public.chat_pins;
create policy "chat pins readable by members"
on public.chat_pins for select
using (public.chat_has_membership(room_id, auth.uid()));
-- no insert/update/delete policies on purpose: everything goes through chat_set_pin()

create table if not exists public.chat_audit (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_user uuid references public.profiles(id) on delete set null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists chat_audit_room_idx on public.chat_audit (room_id, created_at desc);

alter table public.chat_audit enable row level security;

drop policy if exists "chat audit readable by owner and admins" on public.chat_audit;
create policy "chat audit readable by owner and admins"
on public.chat_audit for select
using (exists (
  select 1 from public.chat_members m
  where m.room_id = chat_audit.room_id
    and m.user_id = auth.uid()
    and m.role::text in ('owner', 'admin')
));

-- --------------------------------------------------------------------------
-- 2. Private helpers (other functions can use them, the browser cannot)
-- --------------------------------------------------------------------------
create or replace function public.chat_role_of(p_room uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role::text from public.chat_members m where m.room_id = p_room and m.user_id = p_user limit 1;
$$;

create or replace function public.chat_log(p_room uuid, p_action text, p_target uuid default null, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_audit (room_id, actor_id, action, target_user, detail)
  values (p_room, auth.uid(), p_action, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

revoke execute on function public.chat_role_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_log(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. Edit a group / community
--    owner + admin: name, icon, description
--    owner only:    public / private
-- --------------------------------------------------------------------------
create or replace function public.chat_update_room(
  p_room uuid,
  p_name text,
  p_desc text default null,
  p_icon text default null,
  p_public boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind   text;
  v_public boolean;
  v_role   text;
  v_name   text;
  v_desc   text;
  v_icon   text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select kind::text, is_public into v_kind, v_public from public.chat_rooms where id = p_room;
  if v_kind is null then
    raise exception 'room_not_found';
  end if;
  if v_kind = 'dm' then
    raise exception 'not_allowed';
  end if;

  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then
    raise exception 'not_member';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  v_name := left(btrim(coalesce(p_name, '')), 40);
  if char_length(v_name) < 2 then
    raise exception 'bad_name';
  end if;

  v_desc := nullif(left(btrim(coalesce(p_desc, '')), 200), '');
  v_icon := nullif(left(btrim(coalesce(p_icon, '')), 8), '');

  if p_public is not null and p_public is distinct from v_public and v_role <> 'owner' then
    raise exception 'not_allowed';
  end if;

  update public.chat_rooms
  set name        = v_name,
      description = v_desc,
      icon        = coalesce(v_icon, icon),
      is_public   = coalesce(p_public, is_public)
  where id = p_room;

  perform public.chat_log(p_room, 'room.update', null, jsonb_build_object('name', v_name));
end;
$$;

-- --------------------------------------------------------------------------
-- 4. New invite code (the old one stops working)
-- --------------------------------------------------------------------------
create or replace function public.chat_regen_invite(p_room uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_role text;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select kind::text into v_kind from public.chat_rooms where id = p_room;
  if v_kind is null then
    raise exception 'room_not_found';
  end if;
  if v_kind = 'dm' then
    raise exception 'not_allowed';
  end if;

  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then
    raise exception 'not_member';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  update public.chat_rooms set invite_code = v_code where id = p_room;
  perform public.chat_log(p_room, 'invite.reset');

  return v_code;
end;
$$;

-- --------------------------------------------------------------------------
-- 5. Pinned messages
--    DMs: either person can pin.  Groups / communities: owner + admin.
-- --------------------------------------------------------------------------
create or replace function public.chat_set_pin(p_room uuid, p_message uuid, p_pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_role  text;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select kind::text into v_kind from public.chat_rooms where id = p_room;
  if v_kind is null then
    raise exception 'room_not_found';
  end if;

  v_role := public.chat_role_of(p_room, auth.uid());
  if v_role is null then
    raise exception 'not_member';
  end if;
  if v_kind <> 'dm' and v_role not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;

  if coalesce(p_pin, false) then
    if not exists (
      select 1 from public.chat_messages
      where id = p_message and room_id = p_room and deleted_at is null
    ) then
      raise exception 'message_not_found';
    end if;

    select count(*) into v_count from public.chat_pins where room_id = p_room;
    if v_count >= 50 and not exists (
      select 1 from public.chat_pins where room_id = p_room and message_id = p_message
    ) then
      raise exception 'pin_limit';
    end if;

    insert into public.chat_pins (room_id, message_id, pinned_by)
    values (p_room, p_message, auth.uid())
    on conflict do nothing;

    perform public.chat_log(p_room, 'message.pin', null, jsonb_build_object('message', p_message));
  else
    delete from public.chat_pins where room_id = p_room and message_id = p_message;
    perform public.chat_log(p_room, 'message.unpin', null, jsonb_build_object('message', p_message));
  end if;
end;
$$;

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
  order by p.pinned_at desc;
end;
$$;

-- --------------------------------------------------------------------------
-- 6. Media and files shared in a chat (newest first, 60 at a time)
-- --------------------------------------------------------------------------
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

  -- a DM you cleared stays cleared for you
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
    and (v_cleared is null or m.created_at > v_cleared)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
end;
$$;

-- --------------------------------------------------------------------------
-- 7. Who may call what
-- --------------------------------------------------------------------------
grant execute on function public.chat_update_room(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.chat_regen_invite(uuid)                           to authenticated;
grant execute on function public.chat_set_pin(uuid, uuid, boolean)                 to authenticated;
grant execute on function public.chat_pinned(uuid)                                 to authenticated;
grant execute on function public.chat_room_media(uuid, timestamptz, int)           to authenticated;

-- --------------------------------------------------------------------------
-- 8. Real-time for pins (so a pin shows up without a refresh)
-- --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_pins'
     ) then
    alter publication supabase_realtime add table public.chat_pins;
  end if;
end $$;

alter table public.chat_pins replica identity full;
