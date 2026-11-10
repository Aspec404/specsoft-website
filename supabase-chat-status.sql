-- ==========================================================================
-- SPECSOFT® Chats  v5: custom status
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-profiles.sql.
-- It is safe to re-run.
--
-- Everything here is ADDITIVE. Nothing existing is changed, and the online
-- status you already have (profiles.status: online / idle / dnd / offline)
-- is reused as it is.
--
-- What this adds
--   * profiles.status_text          the custom status line (60 characters max)
--   * profiles.status_expires_at    when the custom status disappears (null = never)
--   * profiles.status_thumb_path    thumbnail (PNG / JPG / WebP / GIF) in the status-media bucket
--   * profiles.status_music_title   "now vibing" song title   (music API comes later)
--   * profiles.status_music_artist  "now vibing" artist
--   * profile_set_custom_status()   saves / clears all of the above in one call
--   * status-media                  public image bucket, 3 MB, members write only in their own folder
--
-- SECURITY: the thumbnail is stored as a PATH inside our own bucket, never a
-- free link, so nobody can point a status at a tracking URL that every
-- viewer's browser would then call.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Columns
-- --------------------------------------------------------------------------
alter table public.profiles add column if not exists status_text         text;
alter table public.profiles add column if not exists status_expires_at   timestamptz;
alter table public.profiles add column if not exists status_thumb_path   text;
alter table public.profiles add column if not exists status_music_title  text;
alter table public.profiles add column if not exists status_music_artist text;

alter table public.profiles drop constraint if exists profiles_status_text_len;
alter table public.profiles drop constraint if exists profiles_status_music_len;
alter table public.profiles drop constraint if exists profiles_status_thumb_fmt;

alter table public.profiles add constraint profiles_status_text_len
  check (status_text is null or char_length(status_text) <= 60);

alter table public.profiles add constraint profiles_status_music_len
  check ((status_music_title  is null or char_length(status_music_title)  <= 60)
     and (status_music_artist is null or char_length(status_music_artist) <= 60));

-- <user id>/<file name>, letters, digits, dot, dash and underscore only
alter table public.profiles add constraint profiles_status_thumb_fmt
  check (status_thumb_path is null
         or status_thumb_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,80}$');

-- --------------------------------------------------------------------------
-- 2. Save / clear the custom status (runs as the member, so RLS still applies)
--    p_minutes: how long it lasts. null or 0 = until the member clears it.
--    Sending nothing (no text, no thumbnail, no music) clears everything.
-- --------------------------------------------------------------------------
create or replace function public.profile_set_custom_status(
  p_text         text    default null,
  p_minutes      int     default null,
  p_thumb        text    default null,
  p_music_title  text    default null,
  p_music_artist text    default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_text   text;
  v_thumb  text;
  v_title  text;
  v_artist text;
  v_exp    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_text   := nullif(left(btrim(coalesce(p_text, '')), 60), '');
  v_thumb  := nullif(btrim(coalesce(p_thumb, '')), '');
  v_title  := nullif(left(btrim(coalesce(p_music_title, '')), 60), '');
  v_artist := nullif(left(btrim(coalesce(p_music_artist, '')), 60), '');

  -- the artist alone means nothing
  if v_title is null then
    v_artist := null;
  end if;

  -- a thumbnail must live in the member's own folder
  if v_thumb is not null and left(v_thumb, 37) <> (auth.uid()::text || '/') then
    raise exception 'bad_thumb';
  end if;

  if v_text is null and v_thumb is null and v_title is null then
    v_exp := null;
  elsif coalesce(p_minutes, 0) > 0 then
    v_exp := now() + make_interval(mins => least(p_minutes, 10080));   -- 7 days at most
  else
    v_exp := null;
  end if;

  update public.profiles
  set status_text         = v_text,
      status_thumb_path   = v_thumb,
      status_music_title  = v_title,
      status_music_artist = v_artist,
      status_expires_at   = v_exp
  where id = auth.uid();
end;
$$;

grant execute on function public.profile_set_custom_status(text, int, text, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Status thumbnails (GIFs allowed, 3 MB)
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('status-media', 'status-media', true, 3145728,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "status media public read" on storage.objects;
drop policy if exists "status media upload own"  on storage.objects;
drop policy if exists "status media replace own" on storage.objects;
drop policy if exists "status media delete own"  on storage.objects;

create policy "status media public read"
  on storage.objects for select
  using (bucket_id = 'status-media');

-- a member can only write inside a folder named after their own user id
create policy "status media upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "status media replace own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "status media delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
