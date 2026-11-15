-- SPECSOFT Spectra Bond: give gifts their own "gift" category (instead of misc)
-- Run AFTER spectra-bond-shop.sql. Safe to run again.
--
-- If anything in the Store acts weird after this, you can undo it with one line:
--   update public.store_items set category = 'misc' where category = 'gift';
-- (the Store and the Spectra chat find gifts by their bond XP, so they keep working either way)

-- 1) let the category check on store_items accept 'gift'
--    (your older SQL files made a check like: category = ANY (ARRAY['frame', 'bundle', ...]); this adds 'gift' to that list)
do $$
declare c record; def text;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as d
    from pg_constraint
    where conrelid = 'public.store_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'category = any \(array\['
  loop
    if c.d !~ '''gift''' then
      def := regexp_replace(c.d, 'ARRAY\[', 'ARRAY[''gift''::text, ');
      execute format('alter table public.store_items drop constraint %I', c.conname);
      execute format('alter table public.store_items add constraint %I %s', c.conname, def);
    end if;
  end loop;
end $$;

-- 2) move the gifts over
update public.store_items set category = 'gift' where bond_xp is not null and category <> 'gift';

-- 3) check: every gift with its category, price, stock and bond XP
select name, category, price, stock, bond_xp, bond_favorite from public.store_items where bond_xp is not null order by sort;
