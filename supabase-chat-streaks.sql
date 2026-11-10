-- ==========================================================================
-- SPECSOFT® Chat Streaks  (v3: streaks + restores + milestones + timezones)
-- Run this ONCE in the Supabase SQL Editor (after the chats v3 upgrade).
-- It is safe to re-run, and it upgrades the v1 / v2 streak SQL in place.
--
-- RULES
--   * DMs only. Groups and communities never count.
--   * A streak day counts when BOTH people send at least one message on the
--     same calendar day. If only one of you chatted, the streak does NOT go up
--     yet (the flame stays grey until the other one chats too).
--   * Miss a whole day and the streak ends (shows as "restorable").
--   * TIMEZONES: the day flips at 12:00 AM local time. Every person's browser
--     tells the server their timezone. A DM uses ONE clock for both people:
--     the timezone of whoever started the DM (fallback: Asia/Manila).
--     The server itself runs on UTC (12:00 AM UTC is 8:00 AM in the
--     Philippines), which is why the day is always converted to a timezone.
--   * RESTORES: 7 per person per month (refill on the 1st), taken from the
--     person who restores. 3 days to restore, streak must have been 3+ days.
--   * MILESTONES: 3, 7, 14, 20, 30, 50, 70, every 100, 150, 250, 365.
--   * A streak bug can never stop a message from sending.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------------------
create table if not exists public.chat_streaks (
  room_id    uuid primary key references public.chat_rooms(id) on delete cascade,
  user_low   uuid not null references public.profiles(id) on delete cascade,
  user_high  uuid not null references public.profiles(id) on delete cascade,
  low_day    date,                       -- last day user_low sent something
  high_day   date,                       -- last day user_high sent something
  last_day   date,                       -- last day BOTH chatted (counted)
  streak     integer not null default 0,
  best       integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.chat_streaks add column if not exists lost_streak    integer not null default 0;
alter table public.chat_streaks add column if not exists lost_last_day  date;
alter table public.chat_streaks add column if not exists last_milestone integer not null default 0;
alter table public.chat_streaks add column if not exists milestone_at   timestamptz;
alter table public.chat_streaks add column if not exists tz             text;   -- the clock of this DM (null = Asia/Manila)

alter table public.chat_streaks enable row level security;

drop policy if exists "chat streaks readable by members" on public.chat_streaks;
create policy "chat streaks readable by members"
on public.chat_streaks for select
using (user_low = auth.uid() or user_high = auth.uid());

create table if not exists public.chat_streak_restores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  month   date not null,
  used    integer not null default 0,
  primary key (user_id, month)
);

alter table public.chat_streak_restores enable row level security;

drop policy if exists "chat streak restores readable by owner" on public.chat_streak_restores;
create policy "chat streak restores readable by owner"
on public.chat_streak_restores for select
using (user_id = auth.uid());

-- each person's timezone (sent by the browser)
create table if not exists public.chat_user_tz (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  tz         text not null,
  updated_at timestamptz not null default now()
);

alter table public.chat_user_tz enable row level security;

drop policy if exists "chat user tz readable by owner" on public.chat_user_tz;
create policy "chat user tz readable by owner"
on public.chat_user_tz for select
using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 2. The knobs
-- --------------------------------------------------------------------------
drop function if exists public.chat_streak_today();      -- v1/v2 had no timezone argument

create or replace function public.chat_streak_today(p_tz text default null)
returns date language sql stable as $$
  select (now() at time zone coalesce(nullif(p_tz, ''), 'Asia/Manila'))::date;
$$;

create or replace function public.chat_streak_restore_limit()
returns integer language sql immutable as $$ select 7; $$;          -- restores per person per month

create or replace function public.chat_streak_restore_grace()
returns integer language sql immutable as $$ select 3; $$;          -- days you have to restore after it ended

create or replace function public.chat_streak_restore_min()
returns integer language sql immutable as $$ select 3; $$;          -- streaks shorter than this can not be restored

-- keep this list in sync with STREAK_MILESTONES in chats.js
create or replace function public.chat_streak_is_milestone(n integer)
returns boolean language sql immutable as $$
  select n in (3, 7, 14, 20, 30, 50, 70, 150, 250, 365) or (n >= 100 and n % 100 = 0);
$$;

create or replace function public.chat_streak_milestone_floor(n integer)
returns integer language sql immutable as $$
  select coalesce(max(m), 0)
  from generate_series(1, greatest(n, 1)) m
  where public.chat_streak_is_milestone(m);
$$;

create or replace function public.chat_user_tz_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tz from public.chat_user_tz where user_id = p_user;
$$;

-- the browser calls this once per visit: "my timezone is Asia/Manila"
create or replace function public.chat_set_timezone(p_tz text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    return;                                   -- unknown timezone name: ignore it
  end if;
  insert into public.chat_user_tz (user_id, tz) values (auth.uid(), p_tz)
  on conflict (user_id) do update set tz = excluded.tz, updated_at = now();
end;
$$;

-- --------------------------------------------------------------------------
-- 3. What can be restored right now (uses the DM's own clock)
-- --------------------------------------------------------------------------
create or replace function public.chat_streak_lost_amount(s public.chat_streaks)
returns integer
language sql
stable
as $$
  select case
    when s.streak > 0 and s.last_day < public.chat_streak_today(s.tz) - 1
         and s.streak >= public.chat_streak_restore_min()
         and public.chat_streak_today(s.tz) <= s.last_day + 1 + public.chat_streak_restore_grace()
      then s.streak
    when not (s.streak > 0 and s.last_day < public.chat_streak_today(s.tz) - 1)
         and s.lost_streak >= public.chat_streak_restore_min()
         and s.lost_last_day is not null
         and public.chat_streak_today(s.tz) <= s.lost_last_day + 1 + public.chat_streak_restore_grace()
      then s.lost_streak
    else 0
  end;
$$;

create or replace function public.chat_streak_lost_deadline(s public.chat_streaks)
returns date
language sql
stable
as $$
  select case
    when s.streak > 0 and s.last_day < public.chat_streak_today(s.tz) - 1
      then s.last_day + 1 + public.chat_streak_restore_grace()
    else s.lost_last_day + 1 + public.chat_streak_restore_grace()
  end;
$$;

-- --------------------------------------------------------------------------
-- 4. Trigger: every new DM message updates the streak
-- --------------------------------------------------------------------------
create or replace function public.chat_streak_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_other uuid;
  v_low   uuid;
  v_high  uuid;
  v_today date;
  r       public.chat_streaks;
begin
  select kind::text into v_kind from public.chat_rooms where id = new.room_id;
  if v_kind is distinct from 'dm' then
    return new;
  end if;

  select user_id into v_other from public.chat_members
  where room_id = new.room_id and user_id <> new.sender_id
  limit 1;
  if v_other is null then
    return new;
  end if;

  v_low  := least(new.sender_id, v_other);
  v_high := greatest(new.sender_id, v_other);

  -- the DM's clock = timezone of whoever started the DM, else the sender's, else Manila
  insert into public.chat_streaks (room_id, user_low, user_high, tz)
  values (
    new.room_id, v_low, v_high,
    coalesce(
      (select u.tz from public.chat_user_tz u join public.chat_rooms rm on rm.owner_id = u.user_id where rm.id = new.room_id),
      (select u.tz from public.chat_user_tz u where u.user_id = new.sender_id),
      'Asia/Manila')
  )
  on conflict (room_id) do nothing;

  select * into r from public.chat_streaks where room_id = new.room_id for update;
  v_today := public.chat_streak_today(r.tz);

  -- a whole day went by without both of you: the streak ended
  if r.last_day is not null and r.last_day < v_today - 1 and r.streak > 0 then
    if r.lost_streak = 0
       or r.lost_last_day is null
       or v_today > r.lost_last_day + 1 + public.chat_streak_restore_grace()
       or r.streak >= r.lost_streak then
      r.lost_streak   := r.streak;
      r.lost_last_day := r.last_day;
    end if;
    r.streak         := 0;
    r.last_milestone := 0;
  end if;

  if new.sender_id = v_low then r.low_day := v_today; else r.high_day := v_today; end if;

  -- BOTH chatted today and today is not counted yet: streak up!
  -- (only one of you chatted? nothing changes until the other one does)
  if r.low_day = v_today and r.high_day = v_today and r.last_day is distinct from v_today then
    r.streak   := r.streak + 1;
    r.best     := greatest(r.best, r.streak);
    r.last_day := v_today;
    if public.chat_streak_is_milestone(r.streak) then
      r.last_milestone := r.streak;
      r.milestone_at   := now();
    end if;
  end if;

  update public.chat_streaks
  set low_day = r.low_day, high_day = r.high_day, last_day = r.last_day,
      streak = r.streak, best = r.best,
      lost_streak = r.lost_streak, lost_last_day = r.lost_last_day,
      last_milestone = r.last_milestone, milestone_at = r.milestone_at,
      updated_at = now()
  where room_id = new.room_id;

  return new;
exception when others then
  return new;      -- never block a message because of a streak
end;
$$;

drop trigger if exists chat_streak_after_message on public.chat_messages;
create trigger chat_streak_after_message
after insert on public.chat_messages
for each row execute function public.chat_streak_on_message();

-- --------------------------------------------------------------------------
-- 5. RPC: my streaks
-- --------------------------------------------------------------------------
drop function if exists public.chat_my_streaks();
create or replace function public.chat_my_streaks()
returns table (
  room_id           uuid,
  streak            integer,
  best              integer,
  done_today        boolean,
  at_risk           boolean,
  restorable        integer,
  restore_days_left integer,
  milestone         integer,
  milestone_at      timestamptz,
  me_today          boolean,      -- I already chatted today
  other_today       boolean,      -- they already chatted today
  tz                text,         -- this DM's clock
  resets_in         integer       -- seconds until 12:00 AM on that clock
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.room_id,
    case when s.last_day >= t.d - 1 then s.streak else 0 end,
    s.best,
    (s.last_day = t.d),
    (s.last_day = t.d - 1),
    public.chat_streak_lost_amount(s),
    case when public.chat_streak_lost_amount(s) > 0
         then (public.chat_streak_lost_deadline(s) - t.d + 1) else 0 end,
    case when s.last_day >= t.d - 1 then s.last_milestone else 0 end,
    s.milestone_at,
    (case when auth.uid() = s.user_low then s.low_day else s.high_day end) = t.d,
    (case when auth.uid() = s.user_low then s.high_day else s.low_day end) = t.d,
    coalesce(s.tz, 'Asia/Manila'),
    greatest(0, extract(epoch from (((t.d + 1)::timestamp at time zone coalesce(s.tz, 'Asia/Manila')) - now()))::integer)
  from public.chat_streaks s
  cross join lateral (select public.chat_streak_today(s.tz) as d) t
  where (s.user_low = auth.uid() or s.user_high = auth.uid())
    and s.last_day is not null
    and (s.last_day >= t.d - 1 or public.chat_streak_lost_amount(s) > 0);
$$;

-- --------------------------------------------------------------------------
-- 6. RPC: how many restores do I have this month? (months follow MY timezone)
-- --------------------------------------------------------------------------
create or replace function public.chat_streak_restores_left()
returns table (restores_left integer, restores_total integer, refill_day date)
language sql
stable
security definer
set search_path = public
as $$
  select
    greatest(public.chat_streak_restore_limit() - coalesce(
      (select u.used from public.chat_streak_restores u
       where u.user_id = auth.uid()
         and u.month = date_trunc('month', public.chat_streak_today(public.chat_user_tz_of(auth.uid())))::date), 0), 0),
    public.chat_streak_restore_limit(),
    (date_trunc('month', public.chat_streak_today(public.chat_user_tz_of(auth.uid()))) + interval '1 month')::date;
$$;

-- --------------------------------------------------------------------------
-- 7. RPC: restore an ended streak (spends ONE of the caller's restores)
-- --------------------------------------------------------------------------
create or replace function public.chat_restore_streak(p_room uuid)
returns table (streak integer, restores_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.chat_streaks;
  v_today  date;
  v_month  date := date_trunc('month', public.chat_streak_today(public.chat_user_tz_of(auth.uid())))::date;
  v_lost   integer;
  v_cur    integer;
  v_new    integer;
  v_used   integer;
  v_other  uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into r from public.chat_streaks where room_id = p_room for update;
  if not found or (r.user_low <> auth.uid() and r.user_high <> auth.uid()) then
    raise exception 'not_member';
  end if;
  v_today := public.chat_streak_today(r.tz);

  v_other := case when r.user_low = auth.uid() then r.user_high else r.user_low end;
  if exists (
    select 1 from public.chat_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = v_other)
       or (b.blocker_id = v_other and b.blocked_id = auth.uid())
  ) then
    raise exception 'blocked';
  end if;

  v_lost := public.chat_streak_lost_amount(r);
  if v_lost <= 0 then
    raise exception 'nothing_to_restore';
  end if;

  insert into public.chat_streak_restores (user_id, month) values (auth.uid(), v_month)
  on conflict (user_id, month) do nothing;

  select u.used into v_used from public.chat_streak_restores u
  where u.user_id = auth.uid() and u.month = v_month for update;

  if v_used >= public.chat_streak_restore_limit() then
    raise exception 'no_restores';
  end if;

  update public.chat_streak_restores set used = used + 1
  where user_id = auth.uid() and month = v_month;

  v_cur := case when r.last_day >= v_today - 1 then r.streak else 0 end;
  v_new := v_lost + v_cur;

  update public.chat_streaks cs
  set streak         = v_new,
      best           = greatest(cs.best, v_new),
      last_day       = case when cs.last_day < v_today - 1 then v_today - 1 else cs.last_day end,
      lost_streak    = 0,
      lost_last_day  = null,
      last_milestone = public.chat_streak_milestone_floor(v_new),
      updated_at     = now()
  where cs.room_id = p_room;

  return query select v_new, public.chat_streak_restore_limit() - v_used - 1;
end;
$$;

-- --------------------------------------------------------------------------
-- 8. Real-time
-- --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_streaks'
     ) then
    alter publication supabase_realtime add table public.chat_streaks;
  end if;
end $$;
