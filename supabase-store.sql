-- ============================================================================
-- SPECSOFT® Store + APEX Credits
-- Run this ONCE in Supabase > SQL Editor. It is safe to run again later.
--
-- After running it, make yourself a store admin (so store-manager.html works):
--   insert into public.store_admins (user_id) values ('PASTE-YOUR-USER-ID');
-- (store-manager.html shows your user id if you open it before you are an admin)
-- ============================================================================

-- ---------- admins ----------------------------------------------------------
create table if not exists public.store_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.store_admins enable row level security;   -- no policies: only the dashboard / functions touch it

create or replace function public.store_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.store_admins where user_id = auth.uid());
$$;

-- ---------- settings (one row) ---------------------------------------------
create table if not exists public.store_settings (
    id int primary key default 1 check (id = 1),
    rotation_days int not null default 3 check (rotation_days between 1 and 60),
    rotation_slots int not null default 3 check (rotation_slots between 1 and 6),
    featured_discount int not null default 20 check (featured_discount between 0 and 90),
    rotation_epoch timestamptz not null default '2026-01-01 00:00:00+00',
    daily_amount int not null default 3 check (daily_amount >= 0),
    streak_every int not null default 7 check (streak_every >= 0),
    streak_bonus int not null default 15 check (streak_bonus >= 0),
    updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (1) on conflict (id) do nothing;

-- ---------- items -----------------------------------------------------------
create table if not exists public.store_items (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 60),
    description text not null default '' check (char_length(description) <= 240),
    category text not null default 'misc' check (category in ('badge','theme','boost','cosmetic','misc')),
    rarity text not null default 'common' check (rarity in ('common','rare','epic','legendary')),
    price int not null check (price >= 0),
    emoji text,
    image_url text,
    stock int check (stock is null or stock >= 0),            -- null = unlimited
    per_user_limit int check (per_user_limit is null or per_user_limit >= 1),   -- null = unlimited
    active boolean not null default true,
    in_rotation boolean not null default false,               -- part of the auto-rotating featured pool
    featured_until timestamptz,                               -- manual spotlight until this time
    sort int not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.store_purchases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    item_id uuid references public.store_items(id) on delete set null,
    item_name text not null,
    price_paid int not null,
    created_at timestamptz not null default now()
);
create index if not exists store_purchases_user_idx on public.store_purchases (user_id, created_at desc);

-- ---------- credit packs (real-money purchases, filled in by you) -----------
create table if not exists public.credit_packs (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    credits int not null check (credits > 0),
    bonus int not null default 0 check (bonus >= 0),
    price_label text not null default '',                     -- e.g. "$4.99" or "PHP 249"
    checkout_url text,                                        -- your payment link (Ko-fi, Stripe link, PayPal, ...)
    badge text,                                               -- e.g. "Best value"
    active boolean not null default true,
    sort int not null default 0,
    created_at timestamptz not null default now()
);

-- ---------- wallets ---------------------------------------------------------
create table if not exists public.apex_wallets (
    user_id uuid primary key references auth.users(id) on delete cascade,
    balance bigint not null default 0 check (balance >= 0),
    lifetime bigint not null default 0,
    streak int not null default 0,
    last_claim date,
    updated_at timestamptz not null default now()
);

create table if not exists public.apex_ledger (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    delta bigint not null,
    reason text not null,
    created_at timestamptz not null default now()
);
create index if not exists apex_ledger_user_idx on public.apex_ledger (user_id, created_at desc);

-- ---------- redeem codes ----------------------------------------------------
create table if not exists public.apex_codes (
    code text primary key check (code = lower(code)),
    credits int not null check (credits > 0),
    max_uses int check (max_uses is null or max_uses >= 1),
    uses int not null default 0,
    expires_at timestamptz,
    active boolean not null default true,
    note text,
    created_at timestamptz not null default now()
);
create table if not exists public.apex_code_redemptions (
    user_id uuid not null references auth.users(id) on delete cascade,
    code text not null references public.apex_codes(code) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, code)
);

-- ---------- row level security ---------------------------------------------
alter table public.store_settings enable row level security;
alter table public.store_items enable row level security;
alter table public.store_purchases enable row level security;
alter table public.credit_packs enable row level security;
alter table public.apex_wallets enable row level security;
alter table public.apex_ledger enable row level security;
alter table public.apex_codes enable row level security;
alter table public.apex_code_redemptions enable row level security;

do $$ begin
    -- everyone can read the shop
    drop policy if exists store_settings_read on public.store_settings;
    create policy store_settings_read on public.store_settings for select to anon, authenticated using (true);
    drop policy if exists store_settings_admin on public.store_settings;
    create policy store_settings_admin on public.store_settings for all to authenticated using (public.store_is_admin()) with check (public.store_is_admin());

    drop policy if exists store_items_read on public.store_items;
    create policy store_items_read on public.store_items for select to anon, authenticated using (active or public.store_is_admin());
    drop policy if exists store_items_admin on public.store_items;
    create policy store_items_admin on public.store_items for all to authenticated using (public.store_is_admin()) with check (public.store_is_admin());

    drop policy if exists credit_packs_read on public.credit_packs;
    create policy credit_packs_read on public.credit_packs for select to anon, authenticated using (active or public.store_is_admin());
    drop policy if exists credit_packs_admin on public.credit_packs;
    create policy credit_packs_admin on public.credit_packs for all to authenticated using (public.store_is_admin()) with check (public.store_is_admin());

    -- codes are secret: admins only
    drop policy if exists apex_codes_admin on public.apex_codes;
    create policy apex_codes_admin on public.apex_codes for all to authenticated using (public.store_is_admin()) with check (public.store_is_admin());

    -- you can only read your own money stuff; nobody can write it directly (only the functions below)
    drop policy if exists apex_wallets_own on public.apex_wallets;
    create policy apex_wallets_own on public.apex_wallets for select to authenticated using (user_id = auth.uid() or public.store_is_admin());
    drop policy if exists apex_ledger_own on public.apex_ledger;
    create policy apex_ledger_own on public.apex_ledger for select to authenticated using (user_id = auth.uid() or public.store_is_admin());
    drop policy if exists store_purchases_own on public.store_purchases;
    create policy store_purchases_own on public.store_purchases for select to authenticated using (user_id = auth.uid() or public.store_is_admin());
end $$;

-- ---------- featured rotation ----------------------------------------------
-- Pinned items (featured_until in the future) always show first.
-- Remaining slots are filled from the rotation pool; the pick changes every rotation_days.
create or replace function public.store_featured()
returns table (item_id uuid, ends_at timestamptz, discount int, is_pinned boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    s public.store_settings;
    win bigint;
    win_end timestamptz;
begin
    select * into s from public.store_settings where id = 1;
    win := greatest(floor(extract(epoch from (now() - s.rotation_epoch)) / (s.rotation_days * 86400.0)), 0);
    win_end := s.rotation_epoch + ((win + 1) * s.rotation_days) * interval '1 day';

    return query
    with pinned as (
        select i.id as pid, i.featured_until as pend
        from public.store_items i
        where i.active and i.featured_until > now()
        order by i.sort, i.created_at
        limit s.rotation_slots
    ),
    picks as (
        select i.id as pid
        from public.store_items i
        where i.active and i.in_rotation
          and not exists (select 1 from pinned p where p.pid = i.id)
        order by md5(i.id::text || win::text)
        limit greatest(s.rotation_slots - (select count(*) from pinned), 0)
    )
    select p.pid, p.pend, s.featured_discount, true from pinned p
    union all
    select k.pid, win_end, s.featured_discount, false from picks k;
end $$;

-- ---------- wallet ----------------------------------------------------------
create or replace function public.apex_wallet()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.apex_wallets;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid;
    return json_build_object(
        'balance', w.balance,
        'lifetime', w.lifetime,
        'streak', case when w.last_claim is not null and w.last_claim >= current_date - 1 then w.streak else 0 end,
        'can_claim', w.last_claim is distinct from current_date
    );
end $$;

create or replace function public.apex_claim_daily()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.apex_wallets; s public.store_settings; new_streak int; amt int; bonus boolean := false;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid for update;
    select * into s from public.store_settings where id = 1;
    if w.last_claim = current_date then raise exception 'already_claimed'; end if;

    new_streak := case when w.last_claim = current_date - 1 then w.streak + 1 else 1 end;
    amt := s.daily_amount;
    if s.streak_every > 0 and new_streak % s.streak_every = 0 then amt := amt + s.streak_bonus; bonus := true; end if;

    update public.apex_wallets
       set balance = balance + amt, lifetime = lifetime + amt, streak = new_streak, last_claim = current_date, updated_at = now()
     where user_id = uid;
    insert into public.apex_ledger (user_id, delta, reason) values (uid, amt, 'Daily check-in (day ' || new_streak || ')');
    return json_build_object('amount', amt, 'streak', new_streak, 'bonus', bonus, 'balance', w.balance + amt);
end $$;

create or replace function public.apex_redeem_code(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.apex_codes; k text := lower(trim(coalesce(p_code, ''))); bal bigint;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into c from public.apex_codes where code = k for update;
    if not found or not c.active or (c.expires_at is not null and c.expires_at < now()) then raise exception 'bad_code'; end if;
    if c.max_uses is not null and c.uses >= c.max_uses then raise exception 'code_used_up'; end if;
    if exists (select 1 from public.apex_code_redemptions where user_id = uid and code = k) then raise exception 'code_already_used'; end if;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    insert into public.apex_code_redemptions (user_id, code) values (uid, k);
    update public.apex_codes set uses = uses + 1 where code = k;
    update public.apex_wallets set balance = balance + c.credits, lifetime = lifetime + c.credits, updated_at = now()
     where user_id = uid returning balance into bal;
    insert into public.apex_ledger (user_id, delta, reason) values (uid, c.credits, 'Code: ' || k);
    return json_build_object('amount', c.credits, 'balance', bal);
end $$;

-- ---------- buying ----------------------------------------------------------
create or replace function public.store_buy(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it public.store_items; w public.apex_wallets; d int; price int; owned int;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into it from public.store_items where id = p_item for update;
    if not found or not it.active then raise exception 'item_unavailable'; end if;
    if it.stock is not null and it.stock <= 0 then raise exception 'sold_out'; end if;
    if it.per_user_limit is not null then
        select count(*) into owned from public.store_purchases where user_id = uid and item_id = it.id;
        if owned >= it.per_user_limit then raise exception 'limit_reached'; end if;
    end if;

    select f.discount into d from public.store_featured() f where f.item_id = it.id limit 1;
    price := case when d is null then it.price else greatest(0, round(it.price * (100 - d) / 100.0))::int end;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid for update;
    if w.balance < price then raise exception 'not_enough_credits'; end if;

    update public.apex_wallets set balance = balance - price, updated_at = now() where user_id = uid;
    if it.stock is not null then update public.store_items set stock = stock - 1 where id = it.id; end if;
    insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, price);
    insert into public.apex_ledger (user_id, delta, reason) values (uid, -price, 'Bought ' || it.name);
    return json_build_object('balance', w.balance - price, 'price', price, 'item', it.name);
end $$;

-- ---------- admin: give or take credits (also how you fulfil pack purchases) -
create or replace function public.store_admin_grant(p_username text, p_amount int, p_reason text default '')
returns json language plpgsql security definer set search_path = public as $$
declare target uuid; bal bigint;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    select id into target from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
    if target is null then raise exception 'user_not_found'; end if;
    insert into public.apex_wallets (user_id) values (target) on conflict do nothing;
    update public.apex_wallets
       set balance = greatest(0, balance + p_amount),
           lifetime = lifetime + greatest(p_amount, 0),
           updated_at = now()
     where user_id = target returning balance into bal;
    insert into public.apex_ledger (user_id, delta, reason)
    values (target, p_amount, coalesce(nullif(trim(p_reason), ''), case when p_amount >= 0 then 'Granted by staff' else 'Removed by staff' end));
    return json_build_object('balance', bal);
end $$;

-- ---------- permissions -----------------------------------------------------
grant execute on function public.store_is_admin() to anon, authenticated;
grant execute on function public.store_featured() to anon, authenticated;
grant execute on function public.apex_wallet() to authenticated;
grant execute on function public.apex_claim_daily() to authenticated;
grant execute on function public.apex_redeem_code(text) to authenticated;
grant execute on function public.store_buy(uuid) to authenticated;
grant execute on function public.store_admin_grant(text, int, text) to authenticated;

-- ---------- starter content (only when the shop is empty) --------------------
insert into public.store_items (name, description, category, rarity, price, emoji, in_rotation, per_user_limit, sort)
select * from (values
    ('Neon Pulse badge',   'A glowing badge next to your name in chats.',        'badge',    'rare',      120, '⚡', true,  1, 10),
    ('Night Owl badge',    'For people who are always online at 3am.',            'badge',    'common',     40, '🦉', true,  1, 20),
    ('Founder frame',      'A gold avatar frame. Very limited.',                  'cosmetic', 'legendary', 900, '👑', true,  1, 30),
    ('Midnight theme',     'A deep-blue theme for your profile page.',            'theme',    'epic',      350, '🌌', true,  1, 40),
    ('Paper theme',        'A clean off-white profile theme.',                    'theme',    'common',     80, '📄', false, 1, 50),
    ('Double XP (24h)',    'Doubles activity rewards for one day.',               'boost',    'rare',      150, '🚀', true,  null, 60),
    ('Confetti reaction',  'Unlocks a confetti burst reaction in chats.',         'cosmetic', 'epic',      260, '🎉', false, 1, 70),
    ('Mystery sticker',    'A random sticker. Could be a rare one.',              'misc',     'common',     25, '🎁', false, null, 80)
) as v(name, description, category, rarity, price, emoji, in_rotation, per_user_limit, sort)
where not exists (select 1 from public.store_items);

insert into public.credit_packs (name, credits, bonus, price_label, badge, sort)
select * from (values
    ('Starter pack',  200,   0, '$1.99',  null,         10),
    ('Builder pack', 600,  60, '$4.99',  'Popular',    20),
    ('Studio pack', 1500, 300, '$9.99',  'Best value', 30)
) as v(name, credits, bonus, price_label, badge, sort)
where not exists (select 1 from public.credit_packs);
