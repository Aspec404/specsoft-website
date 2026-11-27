-- ===== RUN ONCE: Supabase > SQL Editor =====
-- SPECSOFT® Spectra Notes v4 (glow-up batch 2): tags on notes, and a Trash that keeps deleted notes for 30 days.
-- Safe to run again, and it never touches your existing notes. Notes still work without it (but no tags, and deleting is permanent).

alter table public.spectra_notes add column if not exists tags       text[] not null default '{}' check (cardinality(tags) <= 12);
alter table public.spectra_notes add column if not exists deleted_at timestamptz;

-- make the API notice the new columns right away
notify pgrst, 'reload schema';
