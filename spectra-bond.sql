-- SPECSOFT Spectra Bond + Gifts
-- Table names start with spectra_bond_ on purpose: an older public.spectra_gifts table (from the APEX gift feature) may already exist and must not be touched.
-- Run once in the Supabase SQL editor. Needs public.apex_wallets (user_id, balance, lifetime).
-- Bond: level 1..100. XP needed to go from level L to L+1 = 40 + 8*L.
-- Decay: 2 grace days, then -3 XP per day, never below the start of the current level.
-- Chat XP: friendly +2, banter +1 (cap 40/day). Hostile -5 (cap 20/day, never below level floor).

-- ===== TABLES =====
create table if not exists public.spectra_bond_gifts (
  id text primary key,
  name text not null,
  emoji text not null,
  price int not null check (price >= 0),
  bond_xp int not null check (bond_xp > 0),
  rarity text not null default 'common' check (rarity in ('common','rare','epic','legendary')),
  is_favorite boolean not null default false,   -- Spectra's favorite gifts give double bond XP
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.spectra_bond_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  gift_id text not null references public.spectra_bond_gifts(id),
  qty int not null default 0 check (qty >= 0),
  primary key (user_id, gift_id)
);

create table if not exists public.spectra_bond (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bond_xp int not null default 0 check (bond_xp >= 0),
  bond_level int not null default 1 check (bond_level between 1 and 100),
  last_chat_at timestamptz,
  last_decay_at timestamptz not null default now(),
  daily_day date not null default current_date,
  daily_gain int not null default 0,
  daily_loss int not null default 0
);

-- ===== RLS (reads only; every write goes through the functions below) =====
alter table public.spectra_bond_gifts enable row level security;
alter table public.spectra_bond_inventory enable row level security;
alter table public.spectra_bond enable row level security;

drop policy if exists gifts_read on public.spectra_bond_gifts;
create policy gifts_read on public.spectra_bond_gifts for select to anon, authenticated using (active);
drop policy if exists inv_read on public.spectra_bond_inventory;
create policy inv_read on public.spectra_bond_inventory for select to authenticated using (user_id = auth.uid());
drop policy if exists bond_read on public.spectra_bond;
create policy bond_read on public.spectra_bond for select to authenticated using (user_id = auth.uid());

-- ===== LEVEL MATH =====
-- total XP needed to REACH level L = (L-1)*(40+4L). Level 100 = 43560 XP.
create or replace function public.bond_xp_floor(l int) returns int
language sql immutable as $$ select (l - 1) * (40 + 4 * l) $$;

create or replace function public.bond_level_for(xp int) returns int
language sql immutable as $$
  select least(100, greatest(1, floor((-36 + sqrt(1936 + 16.0 * xp)) / 8)::int))
$$;

create or replace function public._bond_json(b public.spectra_bond) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'level', b.bond_level,
    'xp', b.bond_xp,
    'xp_into_level', b.bond_xp - public.bond_xp_floor(b.bond_level),
    'xp_needed', case when b.bond_level >= 100 then 0 else 40 + 8 * b.bond_level end,
    'last_chat_at', b.last_chat_at,
    'grace_days', 2
  )
$$;

-- ===== INTERNAL: create row, reset daily caps, apply lazy decay =====
create or replace function public._bond_touch(p_user uuid) returns public.spectra_bond
language plpgsql security definer set search_path = public as $$
declare b public.spectra_bond; from_ts timestamptz; d int; fl int;
begin
  insert into public.spectra_bond (user_id) values (p_user) on conflict do nothing;
  select * into b from public.spectra_bond where user_id = p_user for update;

  if b.daily_day <> current_date then
    b.daily_day := current_date; b.daily_gain := 0; b.daily_loss := 0;
  end if;

  if b.last_chat_at is not null then
    from_ts := greatest(b.last_chat_at + interval '2 days', b.last_decay_at);
    d := floor(extract(epoch from (now() - from_ts)) / 86400)::int;
    if d > 0 then
      fl := public.bond_xp_floor(b.bond_level);
      b.bond_xp := greatest(fl, b.bond_xp - d * 3);
      b.last_decay_at := from_ts + d * interval '1 day';
    end if;
  end if;

  update public.spectra_bond set
    bond_xp = b.bond_xp, bond_level = b.bond_level, last_decay_at = b.last_decay_at,
    daily_day = b.daily_day, daily_gain = b.daily_gain, daily_loss = b.daily_loss
  where user_id = p_user;
  return b;
end $$;

-- ===== CLIENT: bond status (opens the Bond Status popout / top pill) =====
create or replace function public.spectra_bond_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.spectra_bond;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  b := public._bond_touch(auth.uid());
  return public._bond_json(b) || jsonb_build_object('ok', true);
end $$;

-- ===== EDGE FUNCTION ONLY (service role): apply a chat message's tone =====
-- p_tone: 'friendly' | 'banter' | 'hostile'. The edge function decides the tone, never the client.
create or replace function public.spectra_bond_apply(p_user uuid, p_tone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.spectra_bond; delta int := 0; old_level int; fl int;
begin
  b := public._bond_touch(p_user);
  old_level := b.bond_level;

  if p_tone in ('friendly', 'banter') then
    delta := least(case when p_tone = 'friendly' then 2 else 1 end, greatest(0, 40 - b.daily_gain));
    b.bond_xp := least(43560, b.bond_xp + delta);
    b.daily_gain := b.daily_gain + delta;
  elsif p_tone = 'hostile' then
    fl := public.bond_xp_floor(b.bond_level);
    delta := - greatest(0, least(5, 20 - b.daily_loss, b.bond_xp - fl));
    b.bond_xp := b.bond_xp + delta;
    b.daily_loss := b.daily_loss - delta;
  end if;

  b.bond_level := public.bond_level_for(b.bond_xp);
  b.last_chat_at := now();
  b.last_decay_at := now();

  update public.spectra_bond set
    bond_xp = b.bond_xp, bond_level = b.bond_level, last_chat_at = b.last_chat_at,
    last_decay_at = b.last_decay_at, daily_day = b.daily_day,
    daily_gain = b.daily_gain, daily_loss = b.daily_loss
  where user_id = p_user;

  return public._bond_json(b) || jsonb_build_object(
    'ok', true, 'delta', delta, 'leveled_up', b.bond_level > old_level);
end $$;

-- ===== CLIENT: buy a gift from the shop (APEX Credits -> inventory) =====
create or replace function public.spectra_bond_gift_buy(p_gift text, p_qty int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.spectra_bond_gifts; bal numeric; total int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
  select * into g from public.spectra_bond_gifts where id = p_gift and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_gift'); end if;

  total := g.price * p_qty;
  update public.apex_wallets set balance = balance - total
   where user_id = uid and balance >= total returning balance into bal;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_enough'); end if;

  insert into public.spectra_bond_inventory (user_id, gift_id, qty) values (uid, g.id, p_qty)
  on conflict (user_id, gift_id) do update set qty = public.spectra_bond_inventory.qty + p_qty;

  return jsonb_build_object('ok', true, 'gift', g.id, 'bought', p_qty, 'balance', bal);
end $$;

-- ===== CLIENT: send a gift from the inventory to Spectra =====
create or replace function public.spectra_bond_gift_send(p_gift text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.spectra_bond_gifts; b public.spectra_bond;
        left_qty int; gain int; old_level int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into g from public.spectra_bond_gifts where id = p_gift;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_gift'); end if;

  update public.spectra_bond_inventory set qty = qty - 1
   where user_id = uid and gift_id = p_gift and qty > 0 returning qty into left_qty;
  if not found then return jsonb_build_object('ok', false, 'error', 'empty'); end if;

  b := public._bond_touch(uid);
  old_level := b.bond_level;
  gain := g.bond_xp * case when g.is_favorite then 2 else 1 end;
  b.bond_xp := least(43560, b.bond_xp + gain);
  b.bond_level := public.bond_level_for(b.bond_xp);
  b.last_chat_at := now();
  b.last_decay_at := now();

  update public.spectra_bond set
    bond_xp = b.bond_xp, bond_level = b.bond_level, last_chat_at = b.last_chat_at,
    last_decay_at = b.last_decay_at, daily_day = b.daily_day,
    daily_gain = b.daily_gain, daily_loss = b.daily_loss
  where user_id = uid;

  return public._bond_json(b) || jsonb_build_object(
    'ok', true, 'gift', g.id, 'name', g.name, 'emoji', g.emoji, 'gain', gain,
    'favorite', g.is_favorite, 'left', left_qty, 'leveled_up', b.bond_level > old_level);
end $$;

-- ===== CLIENT: inventory list (empty array = show the "Go to Shop" button) =====
create or replace function public.spectra_bond_gift_list() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'emoji', g.emoji, 'rarity', g.rarity,
    'bond_xp', g.bond_xp, 'qty', i.qty) order by g.sort), '[]'::jsonb)
  from public.spectra_bond_inventory i
  join public.spectra_bond_gifts g on g.id = i.gift_id
  where i.user_id = auth.uid() and i.qty > 0
$$;

-- ===== PERMISSIONS =====
revoke all on function public._bond_touch(uuid) from public, anon, authenticated;
revoke all on function public.spectra_bond_apply(uuid, text) from public, anon, authenticated;
grant execute on function public.spectra_bond_apply(uuid, text) to service_role;

revoke all on function public.spectra_bond_status() from public, anon;
revoke all on function public.spectra_bond_gift_buy(text, int) from public, anon;
revoke all on function public.spectra_bond_gift_send(text) from public, anon;
revoke all on function public.spectra_bond_gift_list() from public, anon;
grant execute on function public.spectra_bond_status() to authenticated;
grant execute on function public.spectra_bond_gift_buy(text, int) to authenticated;
grant execute on function public.spectra_bond_gift_send(text) to authenticated;
grant execute on function public.spectra_bond_gift_list() to authenticated;

-- ===== BOND GIFTS (edit freely, or manage them from your store manager) =====
-- is_favorite = Spectra's favorite (2x bond XP). Change with: update public.spectra_bond_gifts set is_favorite = true where id = '...';
insert into public.spectra_bond_gifts (id, name, emoji, price, bond_xp, rarity, is_favorite, sort) values
  ('choco_cookies',        'Chocolate Chip Cookies', '🍪', 15,  4,   'common',    false, 1),
  ('strawberry_milktea',   'Strawberry Milktea',     '🧋', 30,  8,   'common',    true,  2),
  ('strawberry_pancakes',  'Strawberry Pancakes',    '🥞', 55,  15,  'common',    false, 3),
  ('strawberry_macarons',  'Strawberry Macarons',    '🍓', 85,  24,  'rare',      false, 4),
  ('sticker_collection',   'Sticker Collection',     '⭐', 100, 28,  'rare',      false, 5),
  ('strawberry_cheesecake','Strawberry Cheesecake',  '🍰', 110, 32,  'rare',      false, 6),
  ('omurice',              'Omurice',                '🍳', 140, 42,  'rare',      false, 7),
  ('cute_keychains',       'Cute Keychains',         '🔑', 160, 48,  'epic',      false, 8),
  ('hair_accessories',     'Hair Accessories',       '🎀', 220, 70,  'epic',      false, 9),
  ('journals',             'Journals',               '📓', 260, 80,  'epic',      true,  10),
  ('plushie',              'Plushie',                '🧸', 300, 95,  'epic',      false, 11),
  ('flower_bouquets',      'Flower Bouquets',        '💐', 500, 170, 'legendary', false, 12)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, price = excluded.price, bond_xp = excluded.bond_xp,
  rarity = excluded.rarity, is_favorite = excluded.is_favorite, sort = excluded.sort;
