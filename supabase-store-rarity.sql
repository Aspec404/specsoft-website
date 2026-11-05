-- ============================================================================
-- SPECSOFT® Store: rarity tiers  (adds Uncommon, Legacy and Mythic)
-- Run this ONCE in Supabase > SQL Editor. Safe to re-run.
--   common (grey) · uncommon (white) · rare (blue) · epic (purple)
--   legendary (yellow) · legacy (orange) · mythic (red)
-- ============================================================================
do $$
declare r record;
begin
    -- drop whatever check currently limits the rarity column, whatever it is called
    for r in
        select c.conname from pg_constraint c
         where c.conrelid = 'public.store_items'::regclass and c.contype = 'c'
           and pg_get_constraintdef(c.oid) ilike '%rarity%'
    loop
        execute format('alter table public.store_items drop constraint %I', r.conname);
    end loop;
end $$;

alter table public.store_items add constraint store_items_rarity_check
    check (rarity in ('common','uncommon','rare','epic','legendary','legacy','mythic'));
