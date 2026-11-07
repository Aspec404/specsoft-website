-- ============================================================================
-- SPECSOFT® Store: FREE REWARDS (every few hours: watch an ad, get guaranteed rewards, pick 1 of 3 cards)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-boosters.sql (which itself needs the quests,
-- xp-admin, frames and titles files). Safe to re-run.
--
--   1. Cooldown (default 5 hours), kept on the SERVER, so changing a clock does nothing.
--   2. The ad: the page calls freemium_begin(), shows the ad (a placeholder timer for now), then calls
--      freemium_claim(). The server refuses the claim unless enough real time passed since begin.
--   3. Guaranteed rewards on every claim: credits + XP + a short booster (all editable).
--   4. Three face-down cards, rolled by the SERVER from the weighted pool below. The browser never sees
--      them until it picks one, and a refresh cannot reroll them.
--   5. Titles / frames only come from active, unlimited-stock items up to a rarity cap, never ones the
--      member already owns. A pity counter makes sure rare cards do show up now and then.
--   6. Boosters follow the usual booster rules. If one cannot start (a stronger one is running), the
--      reward is paid out right away as the same amount of credits / XP instead.
-- ============================================================================

-- ---------- settings (one row) --------------------------------------------------------------
create table if not exists public.freemium_settings (
    id int primary key default 1 check (id = 1),
    active boolean not null default true,
    cooldown_hours double precision not null default 5 check (cooldown_hours between 0.01 and 168),
    ad_seconds int not null default 15 check (ad_seconds between 0 and 120),
    credits int not null default 10 check (credits between 0 and 100000),
    xp int not null default 20 check (xp between 0 and 100000),
    booster_minutes int not null default 15 check (booster_minutes between 1 and 1440),
    booster_tier int not null default 2 check (booster_tier in (2, 3, 5)),
    pity_limit int not null default 20 check (pity_limit between 0 and 1000),   -- 0 = off
    updated_at timestamptz not null default now()
);
insert into public.freemium_settings (id) values (1) on conflict (id) do nothing;

-- ---------- per member state, offers, pool -----------------------------------------------------
create table if not exists public.freemium_state (
    user_id uuid primary key references auth.users(id) on delete cascade,
    last_claim_at timestamptz,
    ad_started_at timestamptz,
    pity int not null default 0,
    claims int not null default 0,
    updated_at timestamptz not null default now()
);

create table if not exists public.freemium_offers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    cards jsonb not null,
    picked int check (picked is null or picked between 0 and 2),
    created_at timestamptz not null default now(),
    picked_at timestamptz
);
create index if not exists freemium_offers_user_idx on public.freemium_offers (user_id, created_at desc);

create or replace function public.freemium_rank(r text)
returns int language sql immutable as $$
    select case r when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4
                  when 'legendary' then 5 when 'legacy' then 6 when 'mythic' then 7 else 4 end;
$$;

create or replace function public.freemium_params_ok(k text, p jsonb)
returns boolean language plpgsql immutable as $$
begin
    if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
    if k in ('credits', 'xp') then
        return (p->>'min') ~ '^[0-9]{1,7}$' and (p->>'max') ~ '^[0-9]{1,7}$'
           and (p->>'min')::int >= 1 and (p->>'max')::int >= (p->>'min')::int and (p->>'max')::int <= 1000000;
    elsif k = 'booster' then
        return (p->>'boost') in ('credits', 'xp') and (p->>'tier') in ('2', '3', '5')
           and (p->>'minutes') ~ '^[0-9]{1,5}$' and (p->>'minutes')::int between 1 and 43200;
    elsif k in ('title', 'frame') then
        return (p->>'max_rarity') is null or (p->>'max_rarity') in ('common','uncommon','rare','epic','legendary','legacy','mythic');
    end if;
    return false;
end $$;

create table if not exists public.freemium_pool (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('credits', 'xp', 'booster', 'title', 'frame')),
    weight int not null default 10 check (weight between 1 and 1000),
    params jsonb not null default '{}'::jsonb,
    label text check (label is null or char_length(label) <= 60),
    active boolean not null default true,
    sort int not null default 0,
    created_at timestamptz not null default now(),
    constraint freemium_pool_params check (public.freemium_params_ok(kind, params))
);

alter table public.freemium_settings enable row level security;
alter table public.freemium_state enable row level security;
alter table public.freemium_offers enable row level security;
alter table public.freemium_pool enable row level security;

-- staff manage settings and the pool. Members get no direct access at all (the odds and the cards stay hidden):
-- everything they do goes through the functions below.
drop policy if exists freemium_settings_admin on public.freemium_settings;
create policy freemium_settings_admin on public.freemium_settings for all to authenticated
    using (public.store_is_admin()) with check (public.store_is_admin());
drop policy if exists freemium_pool_admin on public.freemium_pool;
create policy freemium_pool_admin on public.freemium_pool for all to authenticated
    using (public.store_is_admin()) with check (public.store_is_admin());

-- ---------- internal helpers (revoked from browsers at the bottom) ------------------------------------
create or replace function public.freemium_grant_credits(p_uid uuid, p_amt int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
    if p_amt is null or p_amt <= 0 then return; end if;
    insert into public.apex_wallets (user_id) values (p_uid) on conflict do nothing;
    update public.apex_wallets set balance = balance + p_amt, lifetime = lifetime + p_amt, updated_at = now() where user_id = p_uid;
    insert into public.apex_ledger (user_id, delta, reason) values (p_uid, p_amt, p_reason);
end $$;

create or replace function public.freemium_grant_xp(p_uid uuid, p_amt int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
    if p_amt is null or p_amt <= 0 then return; end if;
    insert into public.user_xp (user_id, xp) values (p_uid, p_amt)
    on conflict (user_id) do update set xp = public.user_xp.xp + p_amt, updated_at = now();
    insert into public.xp_log (user_id, delta, reason, by_admin) values (p_uid, p_amt, p_reason, null);
end $$;

-- start a booster; if it cannot start (stronger one running / too much time queued) pay the same value instead.
-- returns {"kind","tier","minutes","converted","amount"}
create or replace function public.freemium_grant_booster(p_uid uuid, p_boost text, p_tier int, p_minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean; base int; amt int;
begin
    ok := public.booster_apply(p_uid, p_boost, p_tier, p_minutes, true);
    if ok then
        return jsonb_build_object('kind', p_boost, 'tier', p_tier, 'minutes', p_minutes, 'converted', false, 'amount', 0);
    end if;
    select coalesce(booster_base, 1) into base from public.store_settings where id = 1;
    amt := greatest(1, p_minutes * p_tier * coalesce(base, 1));
    if p_boost = 'xp' then
        perform public.freemium_grant_xp(p_uid, amt, 'Free reward (booster paid out)');
    else
        perform public.freemium_grant_credits(p_uid, amt, 'Free reward (booster paid out)');
    end if;
    return jsonb_build_object('kind', p_boost, 'tier', p_tier, 'minutes', p_minutes, 'converted', true, 'amount', amt);
end $$;

-- roll ONE concrete card from a pool row (null when nothing eligible exists for it)
create or replace function public.freemium_roll_card(p_uid uuid, p_row public.freemium_pool, p_skip uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare it public.store_items; lo int; hi int;
begin
    if p_row.kind in ('credits', 'xp') then
        lo := (p_row.params->>'min')::int; hi := (p_row.params->>'max')::int;
        return jsonb_build_object('kind', p_row.kind, 'amount', lo + floor(random() * (hi - lo + 1))::int);
    elsif p_row.kind = 'booster' then
        return jsonb_build_object('kind', 'booster', 'boost', p_row.params->>'boost',
                                  'tier', (p_row.params->>'tier')::int, 'minutes', (p_row.params->>'minutes')::int);
    else
        select i.* into it from public.store_items i
         where i.active and i.category = p_row.kind and i.stock is null
           and public.freemium_rank(i.rarity) <= public.freemium_rank(coalesce(p_row.params->>'max_rarity', 'epic'))
           and ((p_row.kind = 'title' and i.title_data is not null) or (p_row.kind = 'frame' and i.frame_data is not null))
           and not (i.id = any (coalesce(p_skip, '{}')))
           and not exists (select 1 from public.store_purchases pu where pu.user_id = p_uid and pu.item_id = i.id)
         order by random() limit 1;
        if not found then return null; end if;
        return jsonb_build_object('kind', p_row.kind, 'item_id', it.id, 'name', it.name, 'rarity', it.rarity,
                                  'data', case when p_row.kind = 'title' then it.title_data else it.frame_data end);
    end if;
end $$;

-- three cards from the weighted pool (different kinds when possible). p_force_rare puts a title/frame in slot 1.
create or replace function public.freemium_pick_cards(p_uid uuid, p_force_rare boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    cards jsonb := '[]'::jsonb; card jsonb; r public.freemium_pool;
    kinds text[] := '{}'; items uuid[] := '{}'; slot int;
begin
    for slot in 1..3 loop
        card := null;
        if slot = 1 and p_force_rare then
            for r in select * from public.freemium_pool where active and kind in ('title', 'frame') order by random() loop
                card := public.freemium_roll_card(p_uid, r, items);
                exit when card is not null;
            end loop;
        end if;
        if card is null then
            -- weighted random order: smaller key = more likely to come first
            for r in select * from public.freemium_pool where active and not (kind = any (kinds))
                      order by (-ln(1 - random())) / weight loop
                card := public.freemium_roll_card(p_uid, r, items);
                exit when card is not null;
            end loop;
        end if;
        if card is null then
            for r in select * from public.freemium_pool where active order by (-ln(1 - random())) / weight loop
                card := public.freemium_roll_card(p_uid, r, items);
                exit when card is not null;
            end loop;
        end if;
        if card is null then card := jsonb_build_object('kind', 'credits', 'amount', 25); end if;   -- empty pool safety net

        kinds := kinds || (card->>'kind');
        if (card->>'item_id') is not null then items := items || ((card->>'item_id')::uuid); end if;
        cards := cards || jsonb_build_array(card);
    end loop;
    return cards;
end $$;

-- ---------- what the page calls -----------------------------------------------------------------------
create or replace function public.freemium_status()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state;
    left_s int := 0; pend uuid;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    select * into st from public.freemium_state where user_id = uid;
    if found and st.last_claim_at is not null then
        left_s := greatest(0, ceil(extract(epoch from (st.last_claim_at + s.cooldown_hours * interval '1 hour' - now())))::int);
    end if;
    select o.id into pend from public.freemium_offers o
     where o.user_id = uid and o.picked is null and o.created_at > now() - interval '24 hours'
     order by o.created_at desc limit 1;
    return json_build_object(
        'enabled', s.active, 'ready', s.active and left_s = 0 and pend is null, 'seconds_left', left_s,
        'pending_offer', pend, 'claims', coalesce(st.claims, 0), 'ad_seconds', s.ad_seconds,
        'cooldown_hours', s.cooldown_hours,
        'guaranteed', json_build_object('credits', s.credits, 'xp', s.xp, 'booster_minutes', s.booster_minutes, 'booster_tier', s.booster_tier));
end $$;

create or replace function public.freemium_begin()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state; pend uuid;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    insert into public.freemium_state (user_id) values (uid) on conflict do nothing;
    select * into st from public.freemium_state where user_id = uid for update;
    if st.last_claim_at is not null and now() < st.last_claim_at + s.cooldown_hours * interval '1 hour' then raise exception 'not_ready'; end if;
    select o.id into pend from public.freemium_offers o
     where o.user_id = uid and o.picked is null and o.created_at > now() - interval '24 hours' limit 1;
    if pend is not null then raise exception 'pending_offer'; end if;
    update public.freemium_state set ad_started_at = now(), updated_at = now() where user_id = uid;
    return json_build_object('ad_seconds', s.ad_seconds);
end $$;

create or replace function public.freemium_claim()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state; ss public.store_settings; u public.user_xp;
    pend uuid; cards jsonb; offer uuid; has_rare boolean; force_rare boolean;
    boost jsonb; bkind text; gained_xp int; bal bigint;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    select * into st from public.freemium_state where user_id = uid for update;
    if not found or st.ad_started_at is null then raise exception 'ad_not_watched'; end if;
    -- the "ad" has to have really run for its length (1s of slack for network delay), and the claim must not be stale
    if now() - st.ad_started_at < make_interval(secs => greatest(s.ad_seconds - 1, 0)) then raise exception 'ad_not_watched'; end if;
    if now() - st.ad_started_at > interval '15 minutes' then raise exception 'ad_not_watched'; end if;
    if st.last_claim_at is not null and now() < st.last_claim_at + s.cooldown_hours * interval '1 hour' then raise exception 'not_ready'; end if;
    select o.id into pend from public.freemium_offers o
     where o.user_id = uid and o.picked is null and o.created_at > now() - interval '24 hours' limit 1;
    if pend is not null then raise exception 'pending_offer'; end if;

    -- guaranteed rewards, every time
    perform public.freemium_grant_credits(uid, s.credits, 'Free reward');
    perform public.freemium_grant_xp(uid, s.xp, 'Free reward');
    bkind := case when random() < 0.5 then 'credits' else 'xp' end;
    boost := public.freemium_grant_booster(uid, bkind, s.booster_tier, s.booster_minutes);
    gained_xp := s.xp + case when bkind = 'xp' and (boost->>'converted')::boolean then (boost->>'amount')::int else 0 end;

    -- three face-down cards (pity: after enough claims without a title/frame, slot 1 is one)
    force_rare := s.pity_limit > 0 and st.pity >= s.pity_limit;
    cards := public.freemium_pick_cards(uid, force_rare);
    has_rare := exists (select 1 from jsonb_array_elements(cards) c where c->>'kind' in ('title', 'frame'));
    insert into public.freemium_offers (user_id, cards) values (uid, cards) returning id into offer;

    update public.freemium_state
       set last_claim_at = now(), ad_started_at = null, claims = claims + 1,
           pity = case when has_rare then 0 else pity + 1 end, updated_at = now()
     where user_id = uid;

    select balance into bal from public.apex_wallets where user_id = uid;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;
    select * into ss from public.store_settings where id = 1;
    return json_build_object(
        'offer_id', offer, 'balance', coalesce(bal, 0), 'xp', public.xp_pack_b(u, ss, gained_xp, uid, 0, 0),
        'guaranteed', json_build_object('credits', s.credits, 'xp', s.xp, 'booster', boost));
end $$;

create or replace function public.freemium_pick(p_offer uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); o public.freemium_offers; card jsonb; res jsonb := '{}'::jsonb;
    ss public.store_settings; u public.user_xp; it public.store_items; bal bigint; k text; gained_xp int := 0;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_idx is null or p_idx not between 0 and 2 then raise exception 'bad_card'; end if;
    select * into o from public.freemium_offers where id = p_offer and user_id = uid for update;
    if not found then raise exception 'offer_missing'; end if;
    if o.picked is not null then raise exception 'already_picked'; end if;
    if o.created_at < now() - interval '24 hours' then raise exception 'offer_expired'; end if;

    card := o.cards -> p_idx;
    k := card->>'kind';
    if k = 'credits' then
        perform public.freemium_grant_credits(uid, (card->>'amount')::int, 'Free reward card');
    elsif k = 'xp' then
        perform public.freemium_grant_xp(uid, (card->>'amount')::int, 'Free reward card');
        gained_xp := (card->>'amount')::int;
    elsif k = 'booster' then
        res := public.freemium_grant_booster(uid, card->>'boost', (card->>'tier')::int, (card->>'minutes')::int);
        if (res->>'converted')::boolean and card->>'boost' = 'xp' then gained_xp := (res->>'amount')::int; end if;
    elsif k in ('title', 'frame') then
        select * into it from public.store_items where id = (card->>'item_id')::uuid;
        if found and not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then
            insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, 0);
        else
            -- they got it some other way in the meantime (or it was removed): pay credits instead
            perform public.freemium_grant_credits(uid, 100, 'Free reward card (item paid out)');
            res := jsonb_build_object('converted', true, 'amount', 100);
        end if;
    end if;

    update public.freemium_offers set picked = p_idx, picked_at = now() where id = o.id;

    select balance into bal from public.apex_wallets where user_id = uid;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;
    select * into ss from public.store_settings where id = 1;
    return json_build_object('picked', p_idx, 'cards', o.cards, 'result', res, 'balance', coalesce(bal, 0),
                             'xp', public.xp_pack_b(u, ss, gained_xp, uid, 0, 0));
end $$;

-- ---------- permissions ----------------------------------------------------------------------------------
-- Members can call ONLY the four functions below. The helpers are internal: if a browser could call
-- freemium_grant_credits directly it could mint credits for itself, so they are locked.
revoke execute on function public.freemium_grant_credits(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.freemium_grant_xp(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.freemium_grant_booster(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.freemium_roll_card(uuid, public.freemium_pool, uuid[]) from public, anon, authenticated;
revoke execute on function public.freemium_pick_cards(uuid, boolean) from public, anon, authenticated;
grant execute on function public.freemium_status() to authenticated;
grant execute on function public.freemium_begin() to authenticated;
grant execute on function public.freemium_claim() to authenticated;
grant execute on function public.freemium_pick(uuid, int) to authenticated;

-- ---------- starter pool (only when empty) ------------------------------------------------------------------
do $$
begin
    if exists (select 1 from public.freemium_pool) then return; end if;
    insert into public.freemium_pool (kind, weight, params, label, sort) values
      ('credits', 30, '{"min":50,"max":150}',                              'Credits',        10),
      ('xp',      30, '{"min":50,"max":200}',                              'XP',             20),
      ('booster', 15, '{"boost":"xp","tier":2,"minutes":60}',              'XP booster 1h',  30),
      ('booster', 15, '{"boost":"credits","tier":2,"minutes":30}',         'Credit booster 30m', 40),
      ('title',    5, '{"max_rarity":"epic"}',                             'Random title',   50),
      ('frame',    5, '{"max_rarity":"epic"}',                             'Random frame',   60);
end $$;

-- ---------- staff testing tool: let a member claim again right away ------------------------------------------
create or replace function public.freemium_admin_reset(p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    select id into uid from public.profiles where lower(username) = lower(btrim(p_username)) limit 1;
    if uid is null then raise exception 'user_not_found'; end if;
    update public.freemium_state set last_claim_at = null, ad_started_at = null, updated_at = now() where user_id = uid;
    delete from public.freemium_offers where user_id = uid and picked is null;
end $$;
grant execute on function public.freemium_admin_reset(text) to authenticated;
