-- ============================================================================
-- SPECSOFT® Store: FREE REWARDS v2  (run ONCE in Supabase > SQL Editor, AFTER supabase-store-freemium.sql)
-- Safe to re-run.
--
-- What changes:
--   1. NEW ORDER: no ad first. freemium_offer() rolls your guaranteed rewards + 3 hidden cards and shows them.
--      You choose a card, freemium_select() locks it in, THEN you press claim: freemium_begin() starts the ad
--      and freemium_claim() pays everything out (guaranteed rewards + your chosen card) once the ad has run.
--   2. NOTHING is paid before the ad. The old instant functions are dropped so they cannot be used to skip the ad.
--   3. STREAK: not daily. A claim is possible after the cooldown (5h). The streak goes +1 on every claim made
--      within streak_reset_hours (12h) of the last claim. From streak_warn_hours (11h) the page warns the member.
--      Past streak_reset_hours without a claim the streak resets (next claim starts again at 1).
-- ============================================================================

-- ---------- new settings / state columns ----------------------------------------------------------
alter table public.freemium_settings
    add column if not exists streak_warn_hours  double precision not null default 11 check (streak_warn_hours  between 0.01 and 720),
    add column if not exists streak_reset_hours double precision not null default 12 check (streak_reset_hours between 0.01 and 720);

alter table public.freemium_state
    add column if not exists streak int not null default 0,
    add column if not exists best_streak int not null default 0;

alter table public.freemium_offers
    add column if not exists selected int check (selected is null or selected between 0 and 2),
    add column if not exists boost_kind text,
    add column if not exists claimed_at timestamptz;

-- offers made by the OLD flow already paid their guaranteed rewards: mark them so they are not paid twice
update public.freemium_offers set boost_kind = 'legacy' where picked is null and boost_kind is null;

-- ---------- drop the old instant functions (they paid out without the new steps) ------------------
drop function if exists public.freemium_pick(uuid, int);
drop function if exists public.freemium_begin();
drop function if exists public.freemium_claim();

-- ---------- status (what the little card on the page reads) --------------------------------------
create or replace function public.freemium_status()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state;
    left_s int := 0; pend uuid; cur int := 0; sleft int := 0; lost boolean := false;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    select * into st from public.freemium_state where user_id = uid;
    if found and st.last_claim_at is not null then
        left_s := greatest(0, ceil(extract(epoch from (st.last_claim_at + s.cooldown_hours * interval '1 hour' - now())))::int);
        if now() >= st.last_claim_at + s.streak_reset_hours * interval '1 hour' then
            lost := coalesce(st.streak, 0) > 0;
        else
            cur := coalesce(st.streak, 0);
            sleft := greatest(0, ceil(extract(epoch from (st.last_claim_at + s.streak_reset_hours * interval '1 hour' - now())))::int);
        end if;
    end if;
    select o.id into pend from public.freemium_offers o
     where o.user_id = uid and o.picked is null and o.created_at > now() - interval '24 hours'
     order by o.created_at desc limit 1;
    return json_build_object(
        'enabled', s.active, 'ready', s.active and left_s = 0 and pend is null, 'seconds_left', left_s,
        'pending_offer', pend, 'claims', coalesce(st.claims, 0), 'ad_seconds', s.ad_seconds,
        'cooldown_hours', s.cooldown_hours,
        'streak', cur, 'best_streak', coalesce(st.best_streak, 0), 'streak_seconds_left', sleft, 'streak_lost', lost,
        'streak_warn_hours', s.streak_warn_hours, 'streak_reset_hours', s.streak_reset_hours,
        'guaranteed', json_build_object('credits', s.credits, 'xp', s.xp, 'booster_minutes', s.booster_minutes, 'booster_tier', s.booster_tier));
end $$;

-- ---------- step 1: your guaranteed rewards + 3 hidden cards (no ad, nothing paid yet) ---------------
-- Calling it again returns the same pending offer, so a refresh cannot reroll the cards.
create or replace function public.freemium_offer()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state; o public.freemium_offers;
    cards jsonb; force_rare boolean; bkind text;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    insert into public.freemium_state (user_id) values (uid) on conflict do nothing;
    select * into st from public.freemium_state where user_id = uid for update;

    select * into o from public.freemium_offers
     where user_id = uid and picked is null and created_at > now() - interval '24 hours'
     order by created_at desc limit 1;
    if not found then
        if st.last_claim_at is not null and now() < st.last_claim_at + s.cooldown_hours * interval '1 hour' then raise exception 'not_ready'; end if;
        force_rare := s.pity_limit > 0 and st.pity >= s.pity_limit;
        cards := public.freemium_pick_cards(uid, force_rare);
        bkind := case when random() < 0.5 then 'credits' else 'xp' end;
        insert into public.freemium_offers (user_id, cards, boost_kind) values (uid, cards, bkind) returning * into o;
    end if;

    -- the cards stay hidden: only the chosen one is ever sent, and only after it was locked in
    return json_build_object(
        'offer_id', o.id, 'selected', o.selected, 'ad_seconds', s.ad_seconds,
        'card', case when o.selected is not null then o.cards -> o.selected else null end,
        'guaranteed', case when o.boost_kind = 'legacy' then null else json_build_object(
            'credits', s.credits, 'xp', s.xp,
            'booster', json_build_object('kind', o.boost_kind, 'tier', s.booster_tier, 'minutes', s.booster_minutes)) end);
end $$;

-- ---------- step 2: lock in the card you chose (still nothing paid) --------------------------------
create or replace function public.freemium_select(p_offer uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o public.freemium_offers;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_idx is null or p_idx not between 0 and 2 then raise exception 'bad_card'; end if;
    select * into o from public.freemium_offers where id = p_offer and user_id = uid for update;
    if not found then raise exception 'offer_missing'; end if;
    if o.picked is not null then raise exception 'already_picked'; end if;
    if o.created_at < now() - interval '24 hours' then raise exception 'offer_expired'; end if;
    if o.selected is not null and o.selected <> p_idx then raise exception 'already_selected'; end if;
    if o.selected is null then update public.freemium_offers set selected = p_idx where id = o.id; end if;
    return json_build_object('selected', p_idx, 'card', o.cards -> p_idx);
end $$;

-- ---------- step 3: press claim -> the ad starts ---------------------------------------------------
create or replace function public.freemium_begin(p_offer uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.freemium_settings; o public.freemium_offers;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    select * into o from public.freemium_offers where id = p_offer and user_id = uid for update;
    if not found then raise exception 'offer_missing'; end if;
    if o.picked is not null then raise exception 'already_picked'; end if;
    if o.created_at < now() - interval '24 hours' then raise exception 'offer_expired'; end if;
    if o.selected is null then raise exception 'not_selected'; end if;
    insert into public.freemium_state (user_id) values (uid) on conflict do nothing;
    update public.freemium_state set ad_started_at = now(), updated_at = now() where user_id = uid;
    return json_build_object('ad_seconds', s.ad_seconds);
end $$;

-- ---------- step 4: the ad ran -> pay guaranteed rewards + the chosen card, update the streak ------------
create or replace function public.freemium_claim(p_offer uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state; o public.freemium_offers;
    ss public.store_settings; u public.user_xp; it public.store_items;
    card jsonb; k text; res jsonb := '{}'::jsonb; boost jsonb := null;
    gained_xp int := 0; bal bigint; prev_streak int; new_streak int; was_reset boolean := false;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    select * into st from public.freemium_state where user_id = uid for update;
    if not found or st.ad_started_at is null then raise exception 'ad_not_watched'; end if;
    -- the ad has to have really run for its length (1s of slack for network delay), and the claim must not be stale
    if now() - st.ad_started_at < make_interval(secs => greatest(s.ad_seconds - 1, 0)) then raise exception 'ad_not_watched'; end if;
    if now() - st.ad_started_at > interval '15 minutes' then raise exception 'ad_not_watched'; end if;

    select * into o from public.freemium_offers where id = p_offer and user_id = uid for update;
    if not found then raise exception 'offer_missing'; end if;
    if o.picked is not null then raise exception 'already_picked'; end if;
    if o.created_at < now() - interval '24 hours' then raise exception 'offer_expired'; end if;
    if o.selected is null then raise exception 'not_selected'; end if;

    -- guaranteed rewards (offers from the old flow were already paid)
    if o.boost_kind is distinct from 'legacy' then
        perform public.freemium_grant_credits(uid, s.credits, 'Free reward');
        perform public.freemium_grant_xp(uid, s.xp, 'Free reward');
        gained_xp := s.xp;
        boost := public.freemium_grant_booster(uid, o.boost_kind, s.booster_tier, s.booster_minutes);
        if o.boost_kind = 'xp' and (boost->>'converted')::boolean then gained_xp := gained_xp + (boost->>'amount')::int; end if;
    end if;

    -- the card they chose
    card := o.cards -> o.selected;
    k := card->>'kind';
    if k = 'credits' then
        perform public.freemium_grant_credits(uid, (card->>'amount')::int, 'Free reward card');
    elsif k = 'xp' then
        perform public.freemium_grant_xp(uid, (card->>'amount')::int, 'Free reward card');
        gained_xp := gained_xp + (card->>'amount')::int;
    elsif k = 'booster' then
        res := public.freemium_grant_booster(uid, card->>'boost', (card->>'tier')::int, (card->>'minutes')::int);
        if (res->>'converted')::boolean and card->>'boost' = 'xp' then gained_xp := gained_xp + (res->>'amount')::int; end if;
    elsif k in ('title', 'frame') then
        select * into it from public.store_items where id = (card->>'item_id')::uuid;
        if found and not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then
            insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, 0);
        else
            perform public.freemium_grant_credits(uid, 100, 'Free reward card (item paid out)');
            res := jsonb_build_object('converted', true, 'amount', 100);
        end if;
    end if;

    update public.freemium_offers set picked = o.selected, picked_at = now(), claimed_at = now() where id = o.id;

    -- streak: +1 when claimed within streak_reset_hours of the last claim, otherwise it starts again at 1
    prev_streak := coalesce(st.streak, 0);
    if st.last_claim_at is null or now() >= st.last_claim_at + s.streak_reset_hours * interval '1 hour' then
        new_streak := 1; was_reset := prev_streak > 0;
    else
        new_streak := prev_streak + 1;
    end if;

    update public.freemium_state
       set last_claim_at = now(), ad_started_at = null, claims = claims + 1,
           streak = new_streak, best_streak = greatest(best_streak, new_streak),
           pity = case when k in ('title', 'frame') then 0 else pity + 1 end, updated_at = now()
     where user_id = uid;

    select balance into bal from public.apex_wallets where user_id = uid;
    insert into public.user_xp (user_id) values (uid) on conflict do nothing;
    select * into u from public.user_xp where user_id = uid;
    select * into ss from public.store_settings where id = 1;
    return json_build_object(
        'picked', o.selected, 'cards', o.cards, 'result', res, 'balance', coalesce(bal, 0),
        'xp', public.xp_pack_b(u, ss, gained_xp, uid, 0, 0),
        'guaranteed', case when o.boost_kind = 'legacy' then null else json_build_object('credits', s.credits, 'xp', s.xp, 'booster', boost) end,
        'streak', json_build_object('value', new_streak, 'previous', prev_streak, 'was_reset', was_reset, 'best', greatest(coalesce(st.best_streak, 0), new_streak),
                                    'warn_hours', s.streak_warn_hours, 'reset_hours', s.streak_reset_hours, 'cooldown_hours', s.cooldown_hours));
end $$;

-- ---------- permissions -------------------------------------------------------------------------------
grant execute on function public.freemium_status() to authenticated;
grant execute on function public.freemium_offer() to authenticated;
grant execute on function public.freemium_select(uuid, int) to authenticated;
grant execute on function public.freemium_begin(uuid) to authenticated;
grant execute on function public.freemium_claim(uuid) to authenticated;
