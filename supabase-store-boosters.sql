-- ============================================================================
-- SPECSOFT® Store: XP + credit BOOSTERS
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-frames.sql, supabase-store-quests.sql
-- and supabase-store-gifts.sql. Safe to re-run.
--
--   A booster is a store item (category 'boost') with boost_data like
--       {"v":1,"kind":"credits","tier":3,"minutes":60}        kind: credits | xp     tier: 2 | 3 | 5
--   While it runs, every ONLINE minute pays  tier x booster_base  credits (or XP):
--       a 3x credit booster = 3 APEX Credits per online minute, a 5x XP booster = 5 XP per online minute.
--   "Online minute" = the minute the existing XP heartbeat (xp.js > xp_ping) already measures on the
--   server, so idle tabs, hidden tabs and extra tabs cannot farm it. Offline time pays nothing,
--   but the booster clock keeps running (wall clock).
--
--   Buying rules (one credit booster and one XP booster can run at the same time)
--     same tier again      adds the time
--     higher tier          replaces the running one (the old one's leftover time is lost)
--     lower tier           refused while a stronger one is running (nothing is charged)
--     total time           at most 30 days can be queued per booster
-- ============================================================================

alter table public.store_settings add column if not exists booster_base int not null default 1 check (booster_base between 1 and 100);

-- ---------- item data ---------------------------------------------------------------
alter table public.store_items add column if not exists boost_data jsonb;

create or replace function public.store_boost_ok(f jsonb)
returns boolean language sql immutable as $$
    select f is not null
       and jsonb_typeof(f) = 'object'
       and (f->>'v') = '1'
       and (f->>'kind') in ('credits', 'xp')
       and (f->>'tier') in ('2', '3', '5')
       and (f->>'minutes') ~ '^[0-9]{1,5}$'
       and case when (f->>'minutes') ~ '^[0-9]{1,5}$' then (f->>'minutes')::int between 1 and 43200 else false end;
$$;

alter table public.store_items drop constraint if exists store_items_boost_rules;
alter table public.store_items add constraint store_items_boost_rules
    check (boost_data is null or (category = 'boost' and public.store_boost_ok(boost_data) and per_user_limit is null));

-- ---------- running boosters ----------------------------------------------------------
create table if not exists public.user_boosters (
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('credits', 'xp')),
    tier int not null check (tier in (2, 3, 5)),
    ends_at timestamptz not null,
    started_at timestamptz not null default now(),
    earned bigint not null default 0,
    primary key (user_id, kind)
);
alter table public.user_boosters enable row level security;
drop policy if exists user_boosters_own on public.user_boosters;
create policy user_boosters_own on public.user_boosters for select to authenticated using (user_id = auth.uid());
-- no write policies: only the functions below can change it

create or replace function public.booster_json(p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'kind', b.kind, 'tier', b.tier, 'ends_at', b.ends_at,
               'seconds_left', floor(extract(epoch from (b.ends_at - now())))::int, 'earned', b.earned
           ) order by b.kind), '[]'::jsonb)
      from public.user_boosters b
     where b.user_id = p_uid and b.ends_at > now();
$$;

create or replace function public.booster_status()
returns json language plpgsql stable security definer set search_path = public as $$
begin
    if auth.uid() is null then raise exception 'not_signed_in'; end if;
    return public.booster_json(auth.uid())::json;
end $$;

-- can this booster be added right now? (raises booster_blocked / booster_max, writes nothing)
create or replace function public.booster_check(p_uid uuid, p_kind text, p_tier int, p_minutes int)
returns void language plpgsql stable security definer set search_path = public as $$
declare b public.user_boosters;
begin
    select * into b from public.user_boosters where user_id = p_uid and kind = p_kind;
    if found and b.ends_at > now() then
        if p_tier < b.tier then raise exception 'booster_blocked'; end if;
        if p_tier = b.tier and extract(epoch from (b.ends_at - now())) + p_minutes * 60 > 43200 * 60 then raise exception 'booster_max'; end if;
    end if;
end $$;

-- start / extend / upgrade. p_soft = true never raises: it just returns false when it cannot apply (used for bundles)
create or replace function public.booster_apply(p_uid uuid, p_kind text, p_tier int, p_minutes int, p_soft boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare b public.user_boosters; add interval := make_interval(mins => p_minutes);
begin
    select * into b from public.user_boosters where user_id = p_uid and kind = p_kind for update;
    if found and b.ends_at > now() then
        if p_tier < b.tier then
            if p_soft then return false; end if;
            raise exception 'booster_blocked';
        elsif p_tier = b.tier then
            if extract(epoch from (b.ends_at - now())) + p_minutes * 60 > 43200 * 60 then
                if p_soft then return false; end if;
                raise exception 'booster_max';
            end if;
            update public.user_boosters set ends_at = ends_at + add where user_id = p_uid and kind = p_kind;
        else
            update public.user_boosters set tier = p_tier, ends_at = now() + add, started_at = now(), earned = 0
             where user_id = p_uid and kind = p_kind;
        end if;
    else
        insert into public.user_boosters (user_id, kind, tier, ends_at)
        values (p_uid, p_kind, p_tier, now() + add)
        on conflict (user_id, kind) do update
            set tier = excluded.tier, ends_at = excluded.ends_at, started_at = now(), earned = 0;
    end if;
    return true;
end $$;

-- pay the boosters for p_mins online minutes. Credits go to the wallet here; XP is RETURNED so
-- xp_ping can add it to its own row in one write. A problem in here can never break xp_ping.
create or replace function public.booster_pay(p_uid uuid, p_mins int)
returns table (credits int, xp int)
language plpgsql security definer set search_path = public as $$
declare b record; base int; cut timestamptz; paid int; amt int; c_total int := 0; x_total int := 0;
begin
    credits := 0; xp := 0;
    if p_mins is null or p_mins <= 0 then return next; return; end if;
    begin
        select booster_base into base from public.store_settings where id = 1;
        cut := now() - p_mins * interval '1 minute';
        for b in select * from public.user_boosters where user_id = p_uid and ends_at > cut for update loop
            -- only the minutes that fall inside the booster's window are paid
            paid := least(p_mins, ceil(extract(epoch from (b.ends_at - cut)) / 60.0)::int);
            amt := paid * b.tier * coalesce(base, 1);
            if amt <= 0 then continue; end if;
            if b.kind = 'credits' then
                insert into public.apex_wallets (user_id) values (p_uid) on conflict do nothing;
                update public.apex_wallets set balance = balance + amt, lifetime = lifetime + amt, updated_at = now() where user_id = p_uid;
                insert into public.apex_ledger (user_id, delta, reason)
                values (p_uid, amt, 'Booster: ' || b.tier || 'x credits (' || paid || ' min)');
                c_total := c_total + amt;
            else
                x_total := x_total + amt;
            end if;
            update public.user_boosters set earned = earned + amt where user_id = p_uid and kind = b.kind;
        end loop;
    exception when others then
        c_total := 0; x_total := 0;
    end;
    credits := c_total; xp := x_total;
    return next;
end $$;

-- ---------- XP heartbeat: same as before, plus booster payouts + the booster list in the answer ----------
create or replace function public.xp_pack_b(u public.user_xp, s public.store_settings, g int, p_uid uuid, bc int, bx int)
returns json language sql stable as $$
    select (public.xp_pack(u, s, coalesce(g, 0) + coalesce(bx, 0))::jsonb || jsonb_build_object(
        'boosters', public.booster_json(p_uid),
        'booster_credits', coalesce(bc, 0),
        'booster_xp', coalesce(bx, 0)
    ))::json;
$$;

create or replace function public.xp_ping(p_resume boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.store_settings; u public.user_xp;
    el numeric; credit int := 0; gain int := 0; mins int := 0; bc int := 0; bx int := 0;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid for update;

    if u.day_date is distinct from current_date then u.day_xp := 0; u.day_date := current_date; end if;

    if u.last_ping is not null and not coalesce(p_resume, false) then
        el := extract(epoch from (now() - u.last_ping));
        if el < 20 then return public.xp_pack_b(u, s, 0, uid, 0, 0); end if;     -- another tab pinged a moment ago
        if el <= 150 then credit := least(el, 90)::int; end if;                  -- a longer gap means the person was away
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

    -- boosters pay per verified online minute; booster XP is not part of the daily passive cap
    if mins > 0 then
        select p.credits, p.xp into bc, bx from public.booster_pay(uid, mins) p;
        u.xp := u.xp + coalesce(bx, 0);
    end if;

    update public.user_xp
       set xp = u.xp, sec_carry = u.sec_carry, min_carry = u.min_carry, day_xp = u.day_xp,
           day_date = u.day_date, last_ping = now(), updated_at = now()
     where user_id = uid;

    if mins > 0 then perform public.quest_bump(uid, 'online_minutes', mins); end if;
    return public.xp_pack_b(u, s, gain, uid, bc, bx);
end $$;

create or replace function public.xp_status()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.store_settings; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;
    return public.xp_pack_b(u, s, 0, uid, 0, 0);
end $$;

-- ---------- buying (bundle + booster aware) ---------------------------------------------
create or replace function public.store_buy(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    it public.store_items; c public.store_items; w public.apex_wallets;
    d int; price int; owned int;
    missing uuid[] := '{}';
    granted text[] := '{}';
    n_all int := 0;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into it from public.store_items where id = p_item for update;
    if not found or not it.active then raise exception 'item_unavailable'; end if;
    if it.stock is not null and it.stock <= 0 then raise exception 'sold_out'; end if;
    if it.per_user_limit is not null then
        select count(*) into owned from public.store_purchases where user_id = uid and item_id = it.id;
        if owned >= it.per_user_limit then raise exception 'limit_reached'; end if;
    end if;

    -- a booster that cannot be applied is refused BEFORE any credits are taken
    if it.category = 'boost' and it.boost_data is not null then
        perform public.booster_check(uid, it.boost_data->>'kind', (it.boost_data->>'tier')::int, (it.boost_data->>'minutes')::int);
    end if;

    if it.category = 'bundle' then
        for c in
            select i.* from public.store_bundle_items b join public.store_items i on i.id = b.item_id
             where b.bundle_id = it.id order by i.sort, i.created_at
        loop
            n_all := n_all + 1;
            select count(*) into owned from public.store_purchases where user_id = uid and item_id = c.id;
            if c.per_user_limit is null or owned < c.per_user_limit then missing := missing || c.id; end if;
        end loop;
        if n_all = 0 then raise exception 'item_unavailable'; end if;
        if cardinality(missing) = 0 then raise exception 'already_own_all'; end if;
        for c in select * from public.store_items where id = any (missing) order by id for update loop
            if c.stock is not null and c.stock <= 0 then raise exception 'sold_out'; end if;
        end loop;
    end if;

    select f.discount into d from public.store_featured() f where f.item_id = it.id limit 1;
    price := case when d is null then it.price else greatest(0, round(it.price * (100 - d) / 100.0))::int end;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid for update;
    if w.balance < price then raise exception 'not_enough_credits'; end if;

    update public.apex_wallets set balance = balance - price, updated_at = now() where user_id = uid;
    if it.stock is not null then update public.store_items set stock = stock - 1 where id = it.id; end if;
    insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, price);

    if it.category = 'boost' and it.boost_data is not null then
        perform public.booster_apply(uid, it.boost_data->>'kind', (it.boost_data->>'tier')::int, (it.boost_data->>'minutes')::int, false);
    end if;

    if it.category = 'bundle' then
        for c in select * from public.store_items where id = any (missing) order by sort, created_at loop
            insert into public.store_purchases (user_id, item_id, item_name, price_paid, bundle_id) values (uid, c.id, c.name, 0, it.id);
            if c.stock is not null then update public.store_items set stock = stock - 1 where id = c.id; end if;
            granted := granted || c.name;
            -- boosters inside a bundle start too (skipped quietly if a stronger one is already running)
            if c.category = 'boost' and c.boost_data is not null then
                perform public.booster_apply(uid, c.boost_data->>'kind', (c.boost_data->>'tier')::int, (c.boost_data->>'minutes')::int, true);
            end if;
        end loop;
    end if;

    insert into public.apex_ledger (user_id, delta, reason)
    values (uid, -price, 'Bought ' || it.name || case when it.category = 'bundle' then ' (' || cardinality(missing) || ' items)' else '' end);

    return json_build_object('balance', w.balance - price, 'price', price, 'item', it.name,
                             'granted', to_json(granted), 'boosters', public.booster_json(uid));
end $$;

-- ---------- staff gifts: boosters start for the member too ----------------------------------
create or replace function public.store_admin_give_item(p_username text, p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid; it public.store_items; c public.store_items; owned int;
    granted text[] := '{}';
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    select id into uid from public.profiles where lower(username) = lower(btrim(p_username)) limit 1;
    if uid is null then raise exception 'user_not_found'; end if;
    select * into it from public.store_items where id = p_item;
    if not found then raise exception 'item_unavailable'; end if;

    if it.category = 'bundle' then
        for c in
            select i.* from public.store_bundle_items b join public.store_items i on i.id = b.item_id
             where b.bundle_id = it.id order by i.sort, i.created_at
        loop
            select count(*) into owned from public.store_purchases where user_id = uid and item_id = c.id;
            if c.per_user_limit is null or owned < c.per_user_limit then
                insert into public.store_purchases (user_id, item_id, item_name, price_paid, bundle_id) values (uid, c.id, c.name, 0, it.id);
                granted := granted || c.name;
                if c.category = 'boost' and c.boost_data is not null then
                    perform public.booster_apply(uid, c.boost_data->>'kind', (c.boost_data->>'tier')::int, (c.boost_data->>'minutes')::int, true);
                end if;
            end if;
        end loop;
        if cardinality(granted) = 0 then raise exception 'already_owned'; end if;
    else
        select count(*) into owned from public.store_purchases where user_id = uid and item_id = it.id;
        if it.per_user_limit is not null and owned >= it.per_user_limit then raise exception 'already_owned'; end if;
        if it.category = 'boost' and it.boost_data is not null then
            perform public.booster_apply(uid, it.boost_data->>'kind', (it.boost_data->>'tier')::int, (it.boost_data->>'minutes')::int, false);
        end if;
        insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, 0);
        granted := array[it.name];
    end if;

    return json_build_object('user_id', uid, 'item', it.name, 'granted', to_json(granted));
end $$;

grant execute on function public.store_buy(uuid) to authenticated;
grant execute on function public.store_admin_give_item(text, uuid) to authenticated;
grant execute on function public.xp_ping(boolean) to authenticated;
grant execute on function public.xp_status() to authenticated;
grant execute on function public.booster_status() to authenticated;
-- booster_apply / booster_pay / booster_check are internal: no grants, only the functions above call them

-- ---------- the old placeholder becomes a real booster ----------------------------------------
update public.store_items
   set boost_data = '{"v":1,"kind":"xp","tier":2,"minutes":1440}'::jsonb,
       per_user_limit = null,
       description = 'A 2x XP booster for 24 hours: 2 XP per minute while you are online.'
 where category = 'boost' and boost_data is null and name = 'Double XP (24h)';

-- ---------- starter boosters (only when there are none yet) -------------------------------------
-- Check the prices against what you want people to earn: a booster pays tier x booster_base per online minute.
do $$
begin
    if exists (select 1 from public.store_items where boost_data is not null) then return; end if;
    insert into public.store_items (name, description, category, rarity, price, emoji, boost_data, per_user_limit, in_rotation, sort) values
      ('2x Credit Booster (1h)',  '2 APEX Credits per online minute for 1 hour.',  'boost', 'rare',      100, '💰', '{"v":1,"kind":"credits","tier":2,"minutes":60}', null, false, 310),
      ('3x Credit Booster (1h)',  '3 APEX Credits per online minute for 1 hour.',  'boost', 'epic',      160, '💰', '{"v":1,"kind":"credits","tier":3,"minutes":60}', null, false, 320),
      ('5x Credit Booster (30m)', '5 APEX Credits per online minute for 30 minutes.', 'boost', 'legendary', 130, '💰', '{"v":1,"kind":"credits","tier":5,"minutes":30}', null, false, 330),
      ('2x XP Booster (1h)',      '2 XP per online minute for 1 hour.',            'boost', 'rare',       60, '⚡', '{"v":1,"kind":"xp","tier":2,"minutes":60}', null, false, 340),
      ('3x XP Booster (1h)',      '3 XP per online minute for 1 hour.',            'boost', 'epic',      110, '⚡', '{"v":1,"kind":"xp","tier":3,"minutes":60}', null, false, 350),
      ('5x XP Booster (30m)',     '5 XP per online minute for 30 minutes.',        'boost', 'legendary',  90, '⚡', '{"v":1,"kind":"xp","tier":5,"minutes":30}', null, false, 360);
end $$;
