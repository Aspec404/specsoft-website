-- ============================================================================
-- SPECSOFT® Store: FREE REWARDS v3  (run ONCE in Supabase > SQL Editor, AFTER supabase-store-freemium-v2.sql)
-- Safe to re-run.
--
--   1. STREAK SHIELDS: a member earns a shield every N streak (default 7), holds up to 3.
--      If they miss the streak_reset_hours window but claim within shield_grace_hours after it,
--      a shield is used automatically and the streak keeps going (+1). No shield = it resets as before.
--      Set shield_every or shield_max to 0 to switch shields off.
--   2. RANDOM EMOTES: a new pool reward type 'emote' (any active, unlimited-stock, unowned emote up to a
--      rarity cap). A won emote becomes a normal purchase, so it can be sent in chats right away.
--   Random titles and frames keep working exactly as before.
-- ============================================================================

-- ---------- settings / state ---------------------------------------------------------------
alter table public.freemium_settings
    add column if not exists shield_every int not null default 7 check (shield_every between 0 and 1000),
    add column if not exists shield_max int not null default 3 check (shield_max between 0 and 100),
    add column if not exists shield_grace_hours double precision not null default 12 check (shield_grace_hours between 0.01 and 720);

alter table public.freemium_state
    add column if not exists shields int not null default 0 check (shields >= 0);

-- ---------- emote as a pool reward type -------------------------------------------------------
do $$
declare c record;
begin
    for c in select conname from pg_constraint
              where conrelid = 'public.freemium_pool'::regclass and contype = 'c'
                and conname <> 'freemium_pool_params' and pg_get_constraintdef(oid) ilike '%booster%'
    loop
        execute format('alter table public.freemium_pool drop constraint %I', c.conname);
    end loop;
end $$;
alter table public.freemium_pool add constraint freemium_pool_kind_check
    check (kind in ('credits', 'xp', 'booster', 'title', 'frame', 'emote'));

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
    elsif k in ('title', 'frame', 'emote') then
        return (p->>'max_rarity') is null or (p->>'max_rarity') in ('common','uncommon','rare','epic','legendary','legacy','mythic');
    end if;
    return false;
end $$;

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
           and ((p_row.kind = 'title' and i.title_data is not null)
                or (p_row.kind = 'frame' and i.frame_data is not null)
                or (p_row.kind = 'emote' and i.emote_name is not null and i.image_url is not null))
           and not (i.id = any (coalesce(p_skip, '{}')))
           and not exists (select 1 from public.store_purchases pu where pu.user_id = p_uid and pu.item_id = i.id)
         order by random() limit 1;
        if not found then return null; end if;
        return jsonb_build_object('kind', p_row.kind, 'item_id', it.id, 'name', it.name, 'rarity', it.rarity,
                                  'data', case when p_row.kind = 'title' then it.title_data when p_row.kind = 'frame' then it.frame_data else null end,
                                  'emote_name', it.emote_name,
                                  'image_url', case when p_row.kind = 'emote' then it.image_url else null end);
    end if;
end $$;
revoke execute on function public.freemium_roll_card(uuid, public.freemium_pool, uuid[]) from public, anon, authenticated;

-- ---------- status (now with shields) ----------------------------------------------------------------
create or replace function public.freemium_status()
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state;
    left_s int := 0; pend uuid; cur int := 0; sleft int := 0; lost boolean := false;
    sh_on boolean; sh int := 0; saving boolean := false;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    select * into st from public.freemium_state where user_id = uid;
    sh_on := s.shield_every > 0 and s.shield_max > 0;
    if found and st.last_claim_at is not null then
        left_s := greatest(0, ceil(extract(epoch from (st.last_claim_at + s.cooldown_hours * interval '1 hour' - now())))::int);
        sh := case when sh_on then coalesce(st.shields, 0) else 0 end;
        if now() < st.last_claim_at + s.streak_reset_hours * interval '1 hour' then
            cur := coalesce(st.streak, 0);
            sleft := greatest(0, ceil(extract(epoch from (st.last_claim_at + s.streak_reset_hours * interval '1 hour' - now())))::int);
        elsif sh_on and coalesce(st.streak, 0) > 0 and sh > 0
              and now() < st.last_claim_at + (s.streak_reset_hours + s.shield_grace_hours) * interval '1 hour' then
            -- missed the window, but a shield will catch it if they claim in time
            cur := coalesce(st.streak, 0); saving := true;
            sleft := greatest(0, ceil(extract(epoch from (st.last_claim_at + (s.streak_reset_hours + s.shield_grace_hours) * interval '1 hour' - now())))::int);
        else
            lost := coalesce(st.streak, 0) > 0;
        end if;
    else
        sh := case when sh_on then coalesce(st.shields, 0) else 0 end;
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
        'shields', sh, 'shield_saving', saving,
        'shield_max', case when sh_on then s.shield_max else 0 end, 'shield_every', case when sh_on then s.shield_every else 0 end,
        'guaranteed', json_build_object('credits', s.credits, 'xp', s.xp, 'booster_minutes', s.booster_minutes, 'booster_tier', s.booster_tier));
end $$;

-- ---------- claim (shields + emote cards) -----------------------------------------------------------------
create or replace function public.freemium_claim(p_offer uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid(); s public.freemium_settings; st public.freemium_state; o public.freemium_offers;
    ss public.store_settings; u public.user_xp; it public.store_items;
    card jsonb; k text; res jsonb := '{}'::jsonb; boost jsonb := null;
    gained_xp int := 0; bal bigint; prev_streak int; new_streak int; was_reset boolean := false;
    sh_on boolean; new_shields int; used_shield boolean := false; earned_shield boolean := false;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.freemium_settings where id = 1;
    if not s.active then raise exception 'freemium_off'; end if;
    select * into st from public.freemium_state where user_id = uid for update;
    if not found or st.ad_started_at is null then raise exception 'ad_not_watched'; end if;
    if now() - st.ad_started_at < make_interval(secs => greatest(s.ad_seconds - 1, 0)) then raise exception 'ad_not_watched'; end if;
    if now() - st.ad_started_at > interval '15 minutes' then raise exception 'ad_not_watched'; end if;

    select * into o from public.freemium_offers where id = p_offer and user_id = uid for update;
    if not found then raise exception 'offer_missing'; end if;
    if o.picked is not null then raise exception 'already_picked'; end if;
    if o.created_at < now() - interval '24 hours' then raise exception 'offer_expired'; end if;
    if o.selected is null then raise exception 'not_selected'; end if;

    if o.boost_kind is distinct from 'legacy' then
        perform public.freemium_grant_credits(uid, s.credits, 'Free reward');
        perform public.freemium_grant_xp(uid, s.xp, 'Free reward');
        gained_xp := s.xp;
        boost := public.freemium_grant_booster(uid, o.boost_kind, s.booster_tier, s.booster_minutes);
        if o.boost_kind = 'xp' and (boost->>'converted')::boolean then gained_xp := gained_xp + (boost->>'amount')::int; end if;
    end if;

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
    elsif k in ('title', 'frame', 'emote') then
        select * into it from public.store_items where id = (card->>'item_id')::uuid;
        if found and not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then
            insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, 0);
        else
            -- they got it some other way in the meantime (or it was removed): pay credits instead
            perform public.freemium_grant_credits(uid, 100, 'Free reward card (item paid out)');
            res := jsonb_build_object('converted', true, 'amount', 100);
        end if;
    end if;

    update public.freemium_offers set picked = o.selected, picked_at = now(), claimed_at = now() where id = o.id;

    -- streak, with shields
    prev_streak := coalesce(st.streak, 0);
    sh_on := s.shield_every > 0 and s.shield_max > 0;
    new_shields := coalesce(st.shields, 0);
    if st.last_claim_at is null then
        new_streak := 1;
    elsif now() < st.last_claim_at + s.streak_reset_hours * interval '1 hour' then
        new_streak := prev_streak + 1;
    elsif sh_on and prev_streak > 0 and new_shields > 0
          and now() < st.last_claim_at + (s.streak_reset_hours + s.shield_grace_hours) * interval '1 hour' then
        new_streak := prev_streak + 1; new_shields := new_shields - 1; used_shield := true;
    else
        new_streak := 1; was_reset := prev_streak > 0;
    end if;
    if sh_on and new_streak % s.shield_every = 0 and new_shields < s.shield_max then
        new_shields := new_shields + 1; earned_shield := true;
    end if;

    update public.freemium_state
       set last_claim_at = now(), ad_started_at = null, claims = claims + 1,
           streak = new_streak, best_streak = greatest(best_streak, new_streak), shields = new_shields,
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
                                    'warn_hours', s.streak_warn_hours, 'reset_hours', s.streak_reset_hours, 'cooldown_hours', s.cooldown_hours,
                                    'shield_used', used_shield, 'shield_earned', earned_shield, 'shields', new_shields,
                                    'shield_max', case when sh_on then s.shield_max else 0 end, 'shield_every', case when sh_on then s.shield_every else 0 end));
end $$;

grant execute on function public.freemium_status() to authenticated;
grant execute on function public.freemium_claim(uuid) to authenticated;

-- ---------- optional starter emote reward (only if you have emote items and no emote reward yet) ----------------
insert into public.freemium_pool (kind, weight, params, label, sort)
select 'emote', 5, '{"max_rarity":"epic"}', 'Random emote', 70
 where exists (select 1 from public.store_items where category = 'emote' and active and stock is null)
   and not exists (select 1 from public.freemium_pool where kind = 'emote');
