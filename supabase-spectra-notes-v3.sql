-- ===== RUN ONCE: Supabase > SQL Editor =====
-- SPECSOFT® Spectra Notes v3 (glow-up batch 1): lets each note keep its own icon and color.
-- Safe to run again, and it never touches your existing notes. Notes still work without it (they just can't save colors and icons).

alter table public.spectra_notes add column if not exists icon  text check (icon is null or char_length(icon) <= 8);
alter table public.spectra_notes add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- make the API notice the new columns right away
notify pgrst, 'reload schema';
