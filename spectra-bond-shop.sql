-- SPECSOFT Spectra Bond: gifts sold in the Store (with stock)
-- Run AFTER spectra-bond.sql. Gifts become normal public.store_items, so the Store's own
-- buy flow, prices, featured discounts and stock ("12 left" / "Sold out") all just work.
-- A gift you bought stays in your Gift Inventory until you send it to Spectra.
-- (inventory = gifts bought in store_purchases minus gifts already sent)

-- ===== 1. extra columns on store_items (gift items are the ones with bond_xp set) =====
alter table public.store_items
  add column if not exists bond_xp int check (bond_xp is null or bond_xp > 0),
  add column if not exists bond_favorite boolean not null default false,   -- Spectra's favorite = 2x bond XP
  add column if not exists bond_stock_max int;                             -- stock level used by the restock function

-- ===== 2. the gifts (inserted as "misc" first; run spectra-bond-gift-category.sql next to move them into their own Gift category) =====
-- per_user_limit stays null so members can buy the same gift again and again (only the stock limits it)
insert into public.store_items (name, description, price, category, rarity, emoji, stock, per_user_limit, active, sort, bond_xp, bond_favorite, bond_stock_max)
select v.name, v.description, v.price, 'misc', v.rarity, v.emoji, v.stock, null, true, v.sort, v.bond_xp, v.fav, v.stock
from (values
  ('Chocolate Chip Cookies', 'Warm and gooey. A little treat for Spectra.',        15,  'common',    '🍪', 200, 101, 4,   false),
  ('Strawberry Milktea',     'Pink, sweet and extra cold. Her favorite.',          30,  'common',    '🧋', 150, 102, 8,   true),
  ('Strawberry Pancakes',    'A fluffy stack with strawberries on top.',           55,  'common',    '🥞', 100, 103, 15,  false),
  ('Strawberry Macarons',    'Tiny, pink and fancy.',                              85,  'uncommon',  '🍓', 60,  104, 24,  false),
  ('Sticker Collection',     'A sheet of cute stickers for her laptop.',           100, 'uncommon',  '⭐', 60,  105, 28,  false),
  ('Strawberry Cheesecake',  'A creamy slice with a strawberry glaze.',            110, 'rare',      '🍰', 40,  106, 32,  false),
  ('Omurice',                'A fluffy omelette over ketchup rice.',               140, 'rare',      '🍳', 40,  107, 42,  false),
  ('Cute Keychains',         'A bundle of tiny charms for her bag.',               160, 'epic',      '🔑', 30,  108, 48,  false),
  ('Hair Accessories',       'Clips and ribbons in monochrome.',                   220, 'epic',      '🎀', 25,  109, 70,  false),
  ('Journals',               'A clean notebook for her ideas. Her favorite.',      260, 'epic',      '📓', 25,  110, 80,  true),
  ('Plushie',                'Soft, squishy and huggable.',                        300, 'epic',      '🧸', 20,  111, 95,  false),
  ('Flower Bouquets',        'A fresh bouquet. The big one.',                      500, 'legendary', '💐', 10,  112, 170, false)
) as v(name, description, price, rarity, emoji, stock, sort, bond_xp, fav)
where not exists (select 1 from public.store_items i where i.name = v.name and i.bond_xp is not null);

-- ===== 3. how many of each gift a member already sent =====
create table if not exists public.spectra_bond_gift_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,                       -- store_items.id as text (works for uuid or integer ids)
  sent int not null default 0 check (sent >= 0),
  primary key (user_id, item_id)
);
alter table public.spectra_bond_gift_sent enable row level security;
drop policy if exists bond_sent_read on public.spectra_bond_gift_sent;
create policy bond_sent_read on public.spectra_bond_gift_sent for select to authenticated using (user_id = auth.uid());

-- ===== 4. Gift Inventory list (empty array = the popout shows "Go to Shop") =====
create or replace function public.spectra_bond_gift_list() returns jsonb
language sql security definer set search_path = public as $$
  with bought as (
    select sp.item_id::text as iid, count(*)::int as n
    from public.store_purchases sp where sp.user_id = auth.uid() group by sp.item_id::text
  ), have as (
    select i.id::text as id, i.name, i.emoji, i.rarity, i.bond_xp, i.bond_favorite, i.sort,
           b.n - coalesce(l.sent, 0) as qty
    from public.store_items i
    join bought b on b.iid = i.id::text
    left join public.spectra_bond_gift_sent l on l.user_id = auth.uid() and l.item_id = i.id::text
    where i.bond_xp is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.name, 'emoji', h.emoji, 'rarity', h.rarity,
    'bond_xp', h.bond_xp, 'favorite', h.bond_favorite, 'qty', h.qty) order by h.sort, h.name), '[]'::jsonb)
  from have h where h.qty > 0
$$;

-- ===== 5. send one gift to Spectra =====
create or replace function public.spectra_bond_gift_send(p_gift text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it record; b public.spectra_bond;
        have int; sent_n int; gain int; old_level int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select i.id, i.name, i.emoji, i.bond_xp, i.bond_favorite into it
    from public.store_items i where i.id::text = p_gift and i.bond_xp is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_gift'); end if;

  b := public._bond_touch(uid);               -- also locks this member's bond row, so two sends cannot race
  old_level := b.bond_level;

  select count(*)::int into have from public.store_purchases sp where sp.user_id = uid and sp.item_id::text = p_gift;
  select coalesce((select l.sent from public.spectra_bond_gift_sent l where l.user_id = uid and l.item_id = p_gift), 0) into sent_n;
  if have - sent_n <= 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;

  insert into public.spectra_bond_gift_sent (user_id, item_id, sent) values (uid, p_gift, 1)
  on conflict (user_id, item_id) do update set sent = public.spectra_bond_gift_sent.sent + 1;

  gain := it.bond_xp * case when it.bond_favorite then 2 else 1 end;
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
    'ok', true, 'gift', p_gift, 'name', it.name, 'emoji', it.emoji, 'gain', gain,
    'favorite', it.bond_favorite, 'left', have - sent_n - 1, 'leveled_up', b.bond_level > old_level);
end $$;

-- ===== 6. restock: refill every gift back to its bond_stock_max =====
create or replace function public.spectra_bond_restock() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.store_items set stock = bond_stock_max
   where bond_xp is not null and bond_stock_max is not null and stock is distinct from bond_stock_max;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===== permissions =====
drop function if exists public.spectra_bond_gift_buy(text, int);     -- old in-popout buying is gone: the Store sells gifts now
revoke all on function public.spectra_bond_gift_list() from public, anon;
revoke all on function public.spectra_bond_gift_send(text) from public, anon;
revoke all on function public.spectra_bond_restock() from public, anon, authenticated;
grant execute on function public.spectra_bond_gift_list() to authenticated;
grant execute on function public.spectra_bond_gift_send(text) to authenticated;
grant execute on function public.spectra_bond_restock() to service_role;

-- ===== OPTIONAL: restock every day at 00:00 UTC =====
-- Needs the pg_cron extension (Dashboard > Database > Extensions). Then run this once:
-- select cron.schedule('bond-gift-restock', '0 0 * * *', $$select public.spectra_bond_restock()$$);
--
-- ===== OPTIONAL: remove the old gift tables from the first version of spectra-bond.sql (nothing uses them now) =====
-- drop table if exists public.spectra_bond_inventory;
-- drop table if exists public.spectra_bond_gifts;
