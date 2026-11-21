-- Spectra Academics: Notes (v2)
-- Run this once in the Supabase SQL editor (after supabase-spectra-notes.sql). Safe to run again.
-- Adds the "Add to my projects" link. Everything else in v2 (back links, graph, merge) needs no new columns.

alter table public.spectra_notes
  add column if not exists project text;

alter table public.spectra_notes
  drop constraint if exists spectra_notes_project_len;
alter table public.spectra_notes
  add constraint spectra_notes_project_len check (project is null or char_length(project) <= 60);

create index if not exists spectra_notes_user_project on public.spectra_notes (user_id, project);
