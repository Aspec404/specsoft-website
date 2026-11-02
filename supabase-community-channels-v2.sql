-- ==========================================================================
-- SPECSOFT® Chats  v6: forums, roadmap, events + channel reordering
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-community-channels.sql (v5).
-- It is safe to re-run. Everything is ADDITIVE.
--
-- What this adds
--   FORUMS    chat_threads  + chat_messages.thread_id
--             A post is a thread. Replies are normal chat_messages with a
--             thread_id, so reactions / edit / reply / delete keep working.
--             chat_thread_create, chat_send_thread, chat_threads_list,
--             chat_thread_get, chat_thread_set (pin / lock), chat_thread_delete
--   ROADMAP   chat_roadmap_items + chat_roadmap_votes
--             chat_roadmap_list / _save / _move / _delete / _vote
--   EVENTS    chat_events + chat_event_rsvps
--             chat_events_list / _save / _delete / chat_event_rsvp
--   REORDER   chat_layout_save   (one atomic call for sections + channels)
--
-- Who can do what
--   owner + admin : create/edit/delete roadmap items and events, pin/lock/delete posts,
--                   reorder sections and channels
--   every member  : start posts and reply, vote on roadmap items, RSVP to events
-- Private channels stay private: every function checks chat_can_see_channel().
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Forum tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  room_id      uuid not null references public.chat_rooms(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  title        text not null check (char_length(title) between 3 and 100),
  excerpt      text,
  pinned       boolean not null default false,
  locked       boolean not null default false,
  post_count   int not null default 0,                 -- replies, the first message is not counted
  created_at   timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);

create index if not exists chat_threads_channel_idx
  on public.chat_threads (channel_id, pinned desc, last_post_at desc);

alter table public.chat_messages
  add column if not exists thread_id uuid references public.chat_threads(id) on delete cascade;

create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at) where thread_id is not null;

-- --------------------------------------------------------------------------
-- 2. Roadmap + events tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_roadmap_items (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.chat_channels(id) on delete cascade,
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  status      text not null default 'planned'
              check (status in ('considering', 'planned', 'in_progress', 'shipped')),
  target      text check (target is null or char_length(target) <= 24),
  position    int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chat_roadmap_channel_idx on public.chat_roadmap_items (channel_id, status, position);

create table if not exists public.chat_roadmap_votes (
  item_id    uuid not null references public.chat_roadmap_items(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table if not exists public.chat_events (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.chat_channels(id) on delete cascade,
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  location    text check (location is null or char_length(location) <= 120),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists chat_events_channel_idx on public.chat_events (channel_id, starts_at);

create table if not exists public.chat_event_rsvps (
  event_id   uuid not null references public.chat_events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null check (status in ('going', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- --------------------------------------------------------------------------
-- 3. Row level security: reads only, every write goes through the functions
-- --------------------------------------------------------------------------
alter table public.chat_threads        enable row level security;
alter table public.chat_roadmap_items  enable row level security;
alter table public.chat_roadmap_votes  enable row level security;
alter table public.chat_events         enable row level security;
alter table public.chat_event_rsvps    enable row level security;

drop policy if exists "chat threads readable if visible" on public.chat_threads;
create policy "chat threads readable if visible"
on public.chat_threads for select
using (public.chat_can_see_channel(channel_id, auth.uid()));

drop policy if exists "chat roadmap readable if visible" on public.chat_roadmap_items;
create policy "chat roadmap readable if visible"
on public.chat_roadmap_items for select
using (public.chat_can_see_channel(channel_id, auth.uid()));

drop policy if exists "chat roadmap votes own" on public.chat_roadmap_votes;
create policy "chat roadmap votes own"
on public.chat_roadmap_votes for select
using (user_id = auth.uid());

drop policy if exists "chat events readable if visible" on public.chat_events;
create policy "chat events readable if visible"
on public.chat_events for select
using (public.chat_can_see_channel(channel_id, auth.uid()));

drop policy if exists "chat rsvps own" on public.chat_event_rsvps;
create policy "chat rsvps own"
on public.chat_event_rsvps for select
using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 4. Private helper: @mention inbox rows (same rule as chat_send_channel)
-- --------------------------------------------------------------------------
create or replace function public.chat_inbox_mentions(p_msg uuid, p_channel uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_inbox (user_id, room_id, kind, from_id, message_id, preview, read_at, created_at)
  select u.id, m.room_id, 'message', m.sender_id, m.id, left(m.body, 180), null, now()
  from public.chat_messages m
  cross join lateral (
    select distinct p.id
    from regexp_matches(m.body, '@([A-Za-z0-9_]{3,20})', 'g') as mm(hit)
    join public.profiles p on lower(p.username) = lower((mm.hit)[1])
    where p.id <> m.sender_id
      and public.chat_can_see_channel(p_channel, p.id)
  ) u
  where m.id = p_msg;
$$;

revoke execute on function public.chat_inbox_mentions(uuid, uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 5. FORUMS
-- --------------------------------------------------------------------------
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
  if v_thr.locked and v_role not in ('owner', 'admin') then raise exception 'thread_locked'; end if;

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

create or replace function public.chat_threads_list(p_channel uuid, p_before timestamptz default null, p_limit int default 40)
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
  last_post_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_can_see_channel(p_channel, auth.uid()) then
    raise exception 'not_member';
  end if;

  -- page 1 = pinned first. Later pages (p_before set) only continue the unpinned posts.
  return query
  select t.id, t.channel_id, t.title, t.excerpt, t.author_id,
         p.username::text, p.display_name::text, p.avatar_url::text,
         t.pinned, t.locked, t.post_count, t.created_at, t.last_post_at
  from public.chat_threads t
  left join public.profiles p on p.id = t.author_id
  where t.channel_id = p_channel
    and (p_before is null or (not t.pinned and t.last_post_at < p_before))
  order by t.pinned desc, t.last_post_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
end;
$$;

create or replace function public.chat_thread_get(p_thread uuid)
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
  last_post_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  return query
  select t.id, t.channel_id, t.title, t.excerpt, t.author_id,
         p.username::text, p.display_name::text, p.avatar_url::text,
         t.pinned, t.locked, t.post_count, t.created_at, t.last_post_at
  from public.chat_threads t
  left join public.profiles p on p.id = t.author_id
  where t.id = p_thread
    and public.chat_can_see_channel(t.channel_id, auth.uid());
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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  update public.chat_threads
  set pinned = coalesce(p_pinned, pinned),
      locked = coalesce(p_locked, locked)
  where id = p_thread;

  perform public.chat_log(v_thr.room_id, 'thread.update', null,
                          jsonb_build_object('thread', p_thread, 'pinned', p_pinned, 'locked', p_locked));
end;
$$;

-- the author or an owner/admin; the replies go with it
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
  if v_role not in ('owner', 'admin') and v_thr.author_id is distinct from auth.uid() then
    raise exception 'not_allowed';
  end if;

  delete from public.chat_threads where id = p_thread;     -- cascades to its messages
  perform public.chat_log(v_thr.room_id, 'thread.delete', v_thr.author_id, jsonb_build_object('title', v_thr.title));
end;
$$;

-- --------------------------------------------------------------------------
-- 6. ROADMAP
-- --------------------------------------------------------------------------
create or replace function public.chat_roadmap_list(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_can_see_channel(p_channel, auth.uid()) then
    raise exception 'not_member';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'description', i.description,
        'status', i.status,
        'target', i.target,
        'position', i.position,
        'votes', (select count(*) from public.chat_roadmap_votes v where v.item_id = i.id),
        'voted', exists (select 1 from public.chat_roadmap_votes v where v.item_id = i.id and v.user_id = auth.uid())
      )
      order by i.position, i.created_at)
    from public.chat_roadmap_items i
    where i.channel_id = p_channel
  ), '[]'::jsonb);
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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  delete from public.chat_roadmap_items where id = p_item;
end;
$$;

create or replace function public.chat_roadmap_vote(p_item uuid, p_vote boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it public.chat_roadmap_items;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_it from public.chat_roadmap_items where id = p_item;
  if v_it.id is null then raise exception 'item_not_found'; end if;
  if not public.chat_can_see_channel(v_it.channel_id, auth.uid()) then raise exception 'not_member'; end if;

  if coalesce(p_vote, true) then
    insert into public.chat_roadmap_votes (item_id, user_id) values (p_item, auth.uid())
    on conflict do nothing;
  else
    delete from public.chat_roadmap_votes where item_id = p_item and user_id = auth.uid();
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 7. EVENTS
-- --------------------------------------------------------------------------
-- p_past = false: events that have not ended yet (soonest first)
-- p_past = true : events that already ended (newest first)
create or replace function public.chat_events_list(p_channel uuid, p_past boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.chat_can_see_channel(p_channel, auth.uid()) then
    raise exception 'not_member';
  end if;

  return coalesce((
    select jsonb_agg(x.obj order by x.k)
    from (
      select
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'description', e.description,
          'location', e.location,
          'starts_at', e.starts_at,
          'ends_at', e.ends_at,
          'going', (select count(*) from public.chat_event_rsvps r where r.event_id = e.id and r.status = 'going'),
          'maybe', (select count(*) from public.chat_event_rsvps r where r.event_id = e.id and r.status = 'maybe'),
          'mine', (select r.status from public.chat_event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()),
          'going_names', (
            select coalesce(jsonb_agg(q.n), '[]'::jsonb) from (
              select coalesce(p.display_name, p.username) as n
              from public.chat_event_rsvps r
              join public.profiles p on p.id = r.user_id
              where r.event_id = e.id and r.status = 'going'
              order by r.created_at
              limit 4
            ) q
          )
        ) as obj,
        (case when coalesce(p_past, false) then -extract(epoch from e.starts_at) else extract(epoch from e.starts_at) end) as k
      from public.chat_events e
      where e.channel_id = p_channel
        and (
          (coalesce(p_past, false) = false and coalesce(e.ends_at, e.starts_at + interval '2 hours') >= now())
          or
          (coalesce(p_past, false) = true and coalesce(e.ends_at, e.starts_at + interval '2 hours') < now())
        )
      order by k
      limit case when coalesce(p_past, false) then 30 else 50 end
    ) x
  ), '[]'::jsonb);
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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

  delete from public.chat_events where id = p_event;
end;
$$;

-- p_status null = take the RSVP back
create or replace function public.chat_event_rsvp(p_event uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev public.chat_events;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_ev from public.chat_events where id = p_event;
  if v_ev.id is null then raise exception 'event_not_found'; end if;
  if not public.chat_can_see_channel(v_ev.channel_id, auth.uid()) then raise exception 'not_member'; end if;

  if p_status is null then
    delete from public.chat_event_rsvps where event_id = p_event and user_id = auth.uid();
  else
    if p_status not in ('going', 'maybe', 'no') then raise exception 'bad_status'; end if;
    insert into public.chat_event_rsvps (event_id, user_id, status)
    values (p_event, auth.uid(), p_status)
    on conflict (event_id, user_id) do update set status = excluded.status;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 8. REORDER: one atomic call for the whole sidebar
--    p_layout = {
--      "sections": [ { "id": "<uuid>", "position": 0 }, ... ],
--      "channels": [ { "id": "<uuid>", "section_id": "<uuid>" | null, "position": 0 }, ... ]
--    }
--    A channel with section_id null lands in the uncategorized group (shown at the top).
-- --------------------------------------------------------------------------
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
  if v_role not in ('owner', 'admin') then raise exception 'not_allowed'; end if;

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

  perform public.chat_log(p_room, 'layout.update');
end;
$$;

-- --------------------------------------------------------------------------
-- 9. Who may call what
-- --------------------------------------------------------------------------
grant execute on function public.chat_thread_create(uuid, text, text)                     to authenticated;
grant execute on function public.chat_send_thread(uuid, text, uuid)                       to authenticated;
grant execute on function public.chat_threads_list(uuid, timestamptz, int)                to authenticated;
grant execute on function public.chat_thread_get(uuid)                                    to authenticated;
grant execute on function public.chat_thread_set(uuid, boolean, boolean)                  to authenticated;
grant execute on function public.chat_thread_delete(uuid)                                 to authenticated;
grant execute on function public.chat_roadmap_list(uuid)                                  to authenticated;
grant execute on function public.chat_roadmap_save(uuid, uuid, text, text, text, text)    to authenticated;
grant execute on function public.chat_roadmap_move(uuid, text)                            to authenticated;
grant execute on function public.chat_roadmap_delete(uuid)                                to authenticated;
grant execute on function public.chat_roadmap_vote(uuid, boolean)                         to authenticated;
grant execute on function public.chat_events_list(uuid, boolean)                          to authenticated;
grant execute on function public.chat_event_save(uuid, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.chat_event_delete(uuid)                                  to authenticated;
grant execute on function public.chat_event_rsvp(uuid, text)                              to authenticated;
grant execute on function public.chat_layout_save(uuid, jsonb)                            to authenticated;
