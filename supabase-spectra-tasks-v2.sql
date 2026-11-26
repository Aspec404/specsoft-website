-- ===== RUN ONCE: Supabase > SQL Editor =====
-- SPECSOFT® My Tasks v2: lets a task remember which note it came from (the "open note" chip on the task).
-- Safe to run again, and it never touches your existing tasks. Tasks still work without it (they just can't link to notes).

alter table public.spectra_tasks add column if not exists note_id    text check (note_id is null or char_length(note_id) <= 64);
alter table public.spectra_tasks add column if not exists note_title text check (note_title is null or char_length(note_title) <= 120);

-- make the API notice the new columns right away
notify pgrst, 'reload schema';
