-- ==========================================================================
-- SPECSOFT® HUB v4: MUSIC ON POSTS
-- Run AFTER supabase-hub-v3.sql. Safe to run more than once.
--
-- WHAT THIS DOES
--   1. profile_projects.music  (jsonb): one background track OR up to 5 showcase tracks
--   2. a new public bucket "post-audio": MP3 / M4A only, 20 MB per file
--   3. storage rules for that bucket (anyone can listen, you can only add and delete files in your own folder)
--
-- Moving text, post backgrounds and mentions need NO database change: they live inside the "doc" column from v3.
--
-- music looks like:
--   { "mode": "background" | "showcase",
--     "tracks": [ { "url": "https://.../post-audio/<your id>/<file>.mp3", "title": "...", "artist": "...", "size": 123, "type": "audio/mpeg" } ] }
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) THE COLUMN
-- --------------------------------------------------------------------------
alter table public.profile_projects add column if not exists music jsonb;

alter table public.profile_projects drop constraint if exists projects_music_check;
alter table public.profile_projects add  constraint projects_music_check
  check (
    music is null or (
      octet_length(music::text) <= 8000
      and music->>'mode' in ('background', 'showcase')
      and jsonb_typeof(music->'tracks') = 'array'
      and jsonb_array_length(music->'tracks') between 1 and 5
      and (music->>'mode' <> 'background' or jsonb_array_length(music->'tracks') = 1)
    )
  );


-- --------------------------------------------------------------------------
-- 2) THE BUCKET: music only, 20 MB per file
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-audio', 'post-audio', true, 20971520, array['audio/mpeg', 'audio/mp4', 'audio/x-m4a'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;


-- --------------------------------------------------------------------------
-- 3) STORAGE RULES for post-audio (same pattern as post-media in v2)
-- --------------------------------------------------------------------------
drop policy if exists "post audio public read" on storage.objects;
drop policy if exists "post audio upload own"  on storage.objects;
drop policy if exists "post audio delete own"  on storage.objects;

create policy "post audio public read"
  on storage.objects for select
  using (bucket_id = 'post-audio');

create policy "post audio upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "post audio delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
