-- ============================================================================
-- SPECSOFT® Store: XP + Quest Board  (Phase 1: backend)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store.sql
-- (supabase-store-frames.sql / supabase-store-transfers.sql are optional, but run them first if you use them).
-- Safe to re-run.
--
-- XP
--   * xp.js pings the server once a minute while the tab is visible and you are active.
--   * The SERVER measures the time, so spamming the endpoint gives nothing.
--   * 1 XP per 180 seconds (xp_seconds_per_xp) and at most 60 passive XP a day (xp_daily_cap, 0 = no cap).
--   * Quest rewards are NOT limited by that cap.
--   * Level n starts at 20 * (n-1)^2 XP  (L2 = 20, L3 = 80, L5 = 320, L10 = 1620).
--
-- QUESTS
--   * Three tabs: normal (rotates every quest_normal_hours = 5h), daily (UTC midnight), weekly (Monday UTC midnight).
--   * Each tab shows 3 quests, the same for everybody: one easy, one medium, one hard
--     (if a difficulty is missing, the board is topped up from the others).
--   * Progress is counted automatically from things people already do (check-in, buying, chatting, ...).
--     Nothing in the existing store functions had to change: small triggers watch apex_ledger,
--     chat_messages and user_equipped.
--   * A finished quest must be claimed before its board rotates.
--
-- Tip: do not make quests out of send_credits / redeem_code with big rewards, they are easy to farm with a second account.
-- ============================================================================

-- ---------- settings ----------------------------------------------------------
alter table public.store_settings add column if not exists xp_seconds_per_xp int not null default 180 check (xp_seconds_per_xp between 30 and 3600);
alter table public.store_settings add column if not exists xp_daily_cap int not null default 60 check (xp_daily_cap >= 0);
alter table public.store_settings add column if not exists quest_normal_hours int not null default 5 check (quest_normal_hours between 1 and 48);

-- ---------- tables --------------------------------------------------------------
create table if not exists public.user_xp (
    user_id uuid primary key references auth.users(id) on delete cascade,
    xp bigint not null default 0 check (xp >= 0),
    sec_carry int not null default 0,          -- seconds that have not become 1 XP yet
    min_carry int not null default 0,          -- seconds that have not become 1 online minute yet
    day_xp int not null default 0,             -- passive XP earned today (UTC)
    day_date date,
    last_ping timestamptz,
    last_msg_at timestamptz,                   -- chat messages count for quests at most once per 15s
    updated_at timestamptz not null default now()
);

create table if not exists public.quest_defs (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('normal','daily','weekly')),
    title text not null check (char_length(title) between 1 and 60),
    description text not null default '' check (char_length(description) <= 160),
    metric text not null check (metric in (
        'online_minutes','daily_checkin','buy_item','spend_credits','send_credits','redeem_code',
        'equip_frame','send_messages','visit_store','visit_profile','visit_chats')),
    target int not null check (target between 1 and 100000),
    reward_ac int not null default 0 check (reward_ac between 0 and 100000),
    reward_xp int not null default 0 check (reward_xp between 0 and 100000),
    difficulty text not null default 'easy' check (difficulty in ('easy','medium','hard')),
    active boolean not null default true,
    sort int not null default 0,
    created_at timestamptz not null default now(),
    constraint quest_visit_once check (left(metric, 6) <> 'visit_' or target = 1)
);
create index if not exists quest_defs_kind_idx on public.quest_defs (kind, active);

create table if not exists public.quest_progress (
    user_id uuid not null references auth.users(id) on delete cascade,
    quest_id uuid not null references public.quest_defs(id) on delete cascade,
    window_key text not null,                  -- which board rotation this belongs to
    progress int not null default 0,
    claimed boolean not null default false,
    claimed_at timestamptz,
    primary key (user_id, quest_id, window_key)
);

alter table public.user_xp enable row level security;
alter table public.quest_defs enable row level security;
alter table public.quest_progress enable row level security;

do $$ begin
    drop policy if exists user_xp_own on public.user_xp;
    create policy user_xp_own on public.user_xp for select to authenticated using (user_id = auth.uid() or public.store_is_admin());

    drop policy if exists quest_defs_read on public.quest_defs;
    create policy quest_defs_read on public.quest_defs for select to anon, authenticated using (active or public.store_is_admin());
    drop policy if exists quest_defs_admin on public.quest_defs;
    create policy quest_defs_admin on public.quest_defs for all to authenticated using (public.store_is_admin()) with check (public.store_is_admin());

    drop policy if exists quest_progress_own on public.quest_progress;
    create policy quest_progress_own on public.quest_progress for select to authenticated using (user_id = auth.uid() or public.store_is_admin());
end $$;
-- nobody can write user_xp / quest_progress directly: only the functions below can.

-- ---------- levels ----------------------------------------------------------------
create or replace function public.xp_level(p_xp bigint)
returns int language sql immutable as $$
    select 1 + floor(sqrt(greatest(coalesce(p_xp, 0), 0)::numeric / 20))::int;
$$;

create or replace function public.xp_floor(p_level int)
returns bigint language sql immutable as $$
    select (20 * (greatest(p_level, 1) - 1) * (greatest(p_level, 1) - 1))::bigint;
$$;

create or replace function public.xp_info(p_xp bigint)
returns json language sql immutable as $$
    select json_build_object(
        'xp', coalesce(p_xp, 0),
        'level', t.lv,
        'into', coalesce(p_xp, 0) - public.xp_floor(t.lv),
        'need', public.xp_floor(t.lv + 1) - public.xp_floor(t.lv),
        'pct', round(100.0 * (coalesce(p_xp, 0) - public.xp_floor(t.lv)) / (public.xp_floor(t.lv + 1) - public.xp_floor(t.lv)))::int
    ) from (select public.xp_level(p_xp) as lv) t;
$$;

create or replace function public.xp_pack(u public.user_xp, s public.store_settings, g int)
returns json language sql stable as $$
    select (public.xp_info(u.xp)::jsonb || jsonb_build_object(
        'gained', coalesce(g, 0),
        'day_xp', case when u.day_date = current_date then coalesce(u.day_xp, 0) else 0 end,
        'day_cap', s.xp_daily_cap
    ))::json;
$$;

-- ---------- XP heartbeat ----------------------------------------------------------
-- p_resume = true means "I was away / the tab was hidden": nothing is credited for the gap.
create or replace function public.xp_ping(p_resume boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.store_settings; u public.user_xp;
    el numeric; credit int := 0; gain int := 0; mins int := 0;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid for update;

    if u.day_date is distinct from current_date then u.day_xp := 0; u.day_date := current_date; end if;

    if u.last_ping is not null and not coalesce(p_resume, false) then
        el := extract(epoch from (now() - u.last_ping));
        if el < 20 then return public.xp_pack(u, s, 0); end if;        -- another tab pinged a moment ago
        if el <= 150 then credit := least(el, 90)::int; end if;         -- a longer gap means the person was away
    end if;

    u.sec_carry := u.sec_carry + credit;
    u.min_carry := u.min_carry + credit;

    gain := u.sec_carry / s.xp_seconds_per_xp;
    u.sec_carry := u.sec_carry - gain * s.xp_seconds_per_xp;
    if s.xp_daily_cap > 0 then
        gain := greatest(0, least(gain, s.xp_daily_cap - u.day_xp));
        if u.day_xp + gain >= s.xp_daily_cap then u.sec_carry := 0; end if;   -- capped: stop banking time
    end if;
    u.xp := u.xp + gain;
    u.day_xp := u.day_xp + gain;

    mins := u.min_carry / 60;
    u.min_carry := u.min_carry % 60;

    update public.user_xp
       set xp = u.xp, sec_carry = u.sec_carry, min_carry = u.min_carry, day_xp = u.day_xp,
           day_date = u.day_date, last_ping = now(), updated_at = now()
     where user_id = uid;

    if mins > 0 then perform public.quest_bump(uid, 'online_minutes', mins); end if;
    return public.xp_pack(u, s, gain);
end $$;

create or replace function public.xp_status()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.store_settings; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;
    return public.xp_pack(u, s, 0);
end $$;

-- levels of other members (for badges in chats / profiles later). XP totals are treated as public info.
create or replace function public.xp_levels(p_ids uuid[])
returns table (user_id uuid, xp bigint, lvl int)
language sql stable security definer set search_path = public as $$
    select x.user_id, x.xp, public.xp_level(x.xp)
      from public.user_xp x
     where x.user_id = any (p_ids[1:200]);
$$;

-- ---------- quest boards ------------------------------------------------------------
create or replace function public.quest_window(p_kind text)
returns table (wkey text, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare s public.store_settings; n bigint;
begin
    select * into s from public.store_settings where id = 1;
    if p_kind = 'daily' then
        return query select 'd' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
                            (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC';
    elsif p_kind = 'weekly' then
        return query select 'w' || to_char(date_trunc('week', now() at time zone 'UTC'), 'YYYY-MM-DD'),
                            (date_trunc('week', now() at time zone 'UTC') + interval '7 days') at time zone 'UTC';
    else
        n := greatest(floor(extract(epoch from (now() - s.rotation_epoch)) / (s.quest_normal_hours * 3600.0)), 0);
        return query select 'n' || n::text,
                            s.rotation_epoch + ((n + 1) * s.quest_normal_hours) * interval '1 hour';
    end if;
end $$;

-- the 3 quests on a board right now: one per difficulty, topped up from the rest
create or replace function public.quest_board_ids(p_kind text)
returns table (quest_id uuid, wkey text, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
    with w as (select * from public.quest_window(p_kind)),
    ranked as (
        select d.id, row_number() over (partition by d.difficulty order by md5(d.id::text || w.wkey)) as rn
          from public.quest_defs d cross join w
         where d.active and d.kind = p_kind
    ),
    firsts as (select r.id from ranked r where r.rn = 1),
    extras as (
        select r.id from ranked r cross join w
         where r.rn > 1
         order by md5(r.id::text || w.wkey)
         limit greatest(3 - (select count(*) from firsts), 0)
    )
    select x.id, w.wkey, w.ends_at from (select id from firsts union all select id from extras) x cross join w;
$$;

-- internal: add progress to every matching quest on the current boards
create or replace function public.quest_bump(p_uid uuid, p_metric text, p_amt int)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
    if p_uid is null or p_amt is null or p_amt < 1 then return; end if;
    foreach k in array array['normal', 'daily', 'weekly'] loop
        insert into public.quest_progress (user_id, quest_id, window_key, progress)
        select p_uid, d.id, b.wkey, least(d.target, p_amt)
          from public.quest_board_ids(k) b
          join public.quest_defs d on d.id = b.quest_id
         where d.metric = p_metric
        on conflict (user_id, quest_id, window_key) do update
           set progress = least((select d2.target from public.quest_defs d2 where d2.id = excluded.quest_id),
                                public.quest_progress.progress + p_amt)
         where not public.quest_progress.claimed;
    end loop;
end $$;

-- what the quest board shows: XP bar + the 3 boards with this person's progress
create or replace function public.quest_board()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.store_settings; u public.user_xp;
    k text; b json; boards jsonb := '{}'::jsonb;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;

    foreach k in array array['normal', 'daily', 'weekly'] loop
        select json_build_object(
            'ends_at', (select w.ends_at from public.quest_window(k) w),
            'quests', coalesce((
                select json_agg(json_build_object(
                           'id', d.id, 'title', d.title, 'description', d.description, 'metric', d.metric,
                           'target', d.target, 'progress', least(coalesce(p.progress, 0), d.target),
                           'reward_ac', d.reward_ac, 'reward_xp', d.reward_xp, 'difficulty', d.difficulty,
                           'done', coalesce(p.progress, 0) >= d.target, 'claimed', coalesce(p.claimed, false))
                       order by case d.difficulty when 'easy' then 1 when 'medium' then 2 else 3 end, d.sort, d.created_at)
                  from public.quest_board_ids(k) bi
                  join public.quest_defs d on d.id = bi.quest_id
                  left join public.quest_progress p on p.user_id = uid and p.quest_id = d.id and p.window_key = bi.wkey
            ), '[]'::json)
        ) into b;
        boards := boards || jsonb_build_object(k, b::jsonb);
    end loop;

    return json_build_object('now', now(), 'xp', public.xp_pack(u, s, 0), 'boards', boards);
end $$;

create or replace function public.quest_claim(p_quest uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    d public.quest_defs; b record; pr public.quest_progress;
    bal bigint; total bigint; s public.store_settings; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into d from public.quest_defs where id = p_quest and active;
    if not found then raise exception 'quest_unavailable'; end if;
    select * into b from public.quest_board_ids(d.kind) bi where bi.quest_id = d.id;
    if not found then raise exception 'quest_expired'; end if;

    select * into pr from public.quest_progress
     where user_id = uid and quest_id = d.id and window_key = b.wkey for update;
    if not found or pr.progress < d.target then raise exception 'quest_not_done'; end if;
    if pr.claimed then raise exception 'quest_already_claimed'; end if;

    update public.quest_progress set claimed = true, claimed_at = now()
     where user_id = uid and quest_id = d.id and window_key = b.wkey;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    update public.apex_wallets
       set balance = balance + d.reward_ac, lifetime = lifetime + d.reward_ac, updated_at = now()
     where user_id = uid returning balance into bal;
    if d.reward_ac > 0 then
        insert into public.apex_ledger (user_id, delta, reason) values (uid, d.reward_ac, 'Quest: ' || d.title);
    end if;

    insert into public.user_xp (user_id, xp) values (uid, d.reward_xp)
    on conflict (user_id) do update set xp = public.user_xp.xp + d.reward_xp, updated_at = now();
    select * into u from public.user_xp where user_id = uid;
    select * into s from public.store_settings where id = 1;

    return json_build_object('quest', d.title, 'reward_ac', d.reward_ac, 'reward_xp', d.reward_xp,
                             'balance', bal, 'xp', public.xp_pack(u, s, d.reward_xp));
end $$;

-- "I opened this page" quests. Their target is always 1, so calling it many times gives nothing extra.
create or replace function public.quest_visit(p_page text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
    if uid is null then return; end if;
    if p_page = 'store' then perform public.quest_bump(uid, 'visit_store', 1);
    elsif p_page = 'profile' then perform public.quest_bump(uid, 'visit_profile', 1);
    elsif p_page = 'chats' then perform public.quest_bump(uid, 'visit_chats', 1);
    end if;
end $$;

-- ---------- automatic progress (triggers; a quest bug can never block a purchase) -----
create or replace function public.quest_ledger_hook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    begin
        if new.reason like 'Quest:%' then return new; end if;
        if new.reason like 'Daily check-in%' then
            perform public.quest_bump(new.user_id, 'daily_checkin', 1);
        elsif new.reason like 'Bought %' then
            perform public.quest_bump(new.user_id, 'buy_item', 1);
            if new.delta < 0 then perform public.quest_bump(new.user_id, 'spend_credits', least(-new.delta, 100000)::int); end if;
        elsif new.reason like 'Sent to @%' then
            perform public.quest_bump(new.user_id, 'send_credits', 1);
        elsif new.reason like 'Code: %' then
            perform public.quest_bump(new.user_id, 'redeem_code', 1);
        end if;
    exception when others then null;
    end;
    return new;
end $$;

drop trigger if exists quest_ledger_hook on public.apex_ledger;
create trigger quest_ledger_hook after insert on public.apex_ledger
    for each row execute function public.quest_ledger_hook();

create or replace function public.quest_message_hook()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
    begin
        if new.sender_id is not null and char_length(btrim(coalesce(new.body, ''))) >= 2 then
            insert into public.user_xp (user_id, last_msg_at) values (new.sender_id, now())
            on conflict (user_id) do update set last_msg_at = now()
             where public.user_xp.last_msg_at is null or public.user_xp.last_msg_at < now() - interval '15 seconds';
            get diagnostics n = row_count;
            if n > 0 then perform public.quest_bump(new.sender_id, 'send_messages', 1); end if;
        end if;
    exception when others then null;
    end;
    return new;
end $$;

create or replace function public.quest_equip_hook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    begin
        if new.frame_item is not null then perform public.quest_bump(new.user_id, 'equip_frame', 1); end if;
    exception when others then null;
    end;
    return new;
end $$;

do $$ begin
    if to_regclass('public.chat_messages') is not null then
        drop trigger if exists quest_message_hook on public.chat_messages;
        create trigger quest_message_hook after insert on public.chat_messages
            for each row execute function public.quest_message_hook();
    end if;
    if to_regclass('public.user_equipped') is not null then
        drop trigger if exists quest_equip_hook on public.user_equipped;
        create trigger quest_equip_hook after insert or update on public.user_equipped
            for each row execute function public.quest_equip_hook();
    end if;
end $$;

-- ---------- permissions ---------------------------------------------------------------
revoke all on function public.quest_bump(uuid, text, int) from public, anon, authenticated;
revoke all on function public.quest_board_ids(text) from public, anon, authenticated;
revoke all on function public.quest_window(text) from public, anon, authenticated;

grant execute on function public.xp_level(bigint) to anon, authenticated;
grant execute on function public.xp_floor(int) to anon, authenticated;
grant execute on function public.xp_info(bigint) to anon, authenticated;
grant execute on function public.xp_ping(boolean) to authenticated;
grant execute on function public.xp_status() to authenticated;
grant execute on function public.xp_levels(uuid[]) to authenticated;
grant execute on function public.quest_board() to authenticated;
grant execute on function public.quest_claim(uuid) to authenticated;
grant execute on function public.quest_visit(text) to authenticated;

-- ---------- starter quests (only when there are none yet; edit them in the manager later) ----
do $$
begin
    if exists (select 1 from public.quest_defs) then return; end if;

    insert into public.quest_defs (kind, title, description, metric, target, reward_ac, reward_xp, difficulty, sort) values
    -- NORMAL (new board every 5 hours)
      ('normal', 'Hang out',          'Stay on SPECSOFT for 5 minutes.',   'online_minutes', 5,  3,  5,  'easy',   10),
      ('normal', 'Window shopping',   'Open the Store.',                   'visit_store',    1,  2,  3,  'easy',   20),
      ('normal', 'Say hi',            'Send 3 chat messages.',             'send_messages',  3,  3,  4,  'easy',   30),
      ('normal', 'Settle in',         'Stay for 15 minutes.',              'online_minutes', 15, 6,  12, 'medium', 40),
      ('normal', 'Chatterbox',        'Send 10 chat messages.',            'send_messages',  10, 6,  12, 'medium', 50),
      ('normal', 'Dress to impress',  'Equip a profile frame.',            'equip_frame',    1,  5,  10, 'medium', 60),
      ('normal', 'Stay a while',      'Stay for 30 minutes.',              'online_minutes', 30, 10, 25, 'hard',   70),
      ('normal', 'Big talker',        'Send 25 chat messages.',            'send_messages',  25, 10, 25, 'hard',   80),
      ('normal', 'Treat yourself',    'Spend 50 APEX Credits in the Store.', 'spend_credits', 50, 8,  20, 'hard',   90),
    -- DAILY (new board every day, UTC midnight)
      ('daily',  'Daily check-in',    'Claim your daily credits.',         'daily_checkin',  1,  3,  6,  'easy',   10),
      ('daily',  'Quick visit',       'Stay for 10 minutes today.',        'online_minutes', 10, 4,  8,  'easy',   20),
      ('daily',  'Active day',        'Stay for 30 minutes today.',        'online_minutes', 30, 8,  18, 'medium', 30),
      ('daily',  'Chat it up',        'Send 15 chat messages today.',      'send_messages',  15, 8,  18, 'medium', 40),
      ('daily',  'Marathon',          'Stay for 60 minutes today.',        'online_minutes', 60, 15, 35, 'hard',   50),
      ('daily',  'Shopaholic',        'Buy an item from the Store.',       'buy_item',       1,  12, 30, 'hard',   60),
    -- WEEKLY (new board every Monday, UTC)
      ('weekly', 'Regular',           'Check in on 3 different days.',     'daily_checkin',  3,  20, 50,  'easy',   10),
      ('weekly', 'Social butterfly',  'Send 50 chat messages.',            'send_messages',  50, 20, 50,  'easy',   20),
      ('weekly', 'Dedicated',         'Stay for 3 hours this week.',       'online_minutes', 180, 40, 100, 'medium', 30),
      ('weekly', 'Collector',         'Buy 2 items from the Store.',       'buy_item',       2,  30, 80,  'medium', 40),
      ('weekly', 'Streak master',     'Check in 7 days in a row.',         'daily_checkin',  7,  60, 150, 'hard',   50),
      ('weekly', 'Live here now',     'Stay for 8 hours this week.',       'online_minutes', 480, 80, 200, 'hard',   60);
end $$;
