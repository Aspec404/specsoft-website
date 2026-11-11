-- ==========================================================================
-- SPECSOFT® Chats  v6: status music (iTunes 30 second previews)
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-chat-status.sql.
-- It is safe to re-run.
--
-- Everything here is ADDITIVE except one swap: profile_set_custom_status()
-- gets three more optional inputs. The old 5-input version is dropped first,
-- so the site never has two versions to choose between. Old calls (no music
-- clip) keep working because every new input has a default.
--
-- What this adds
--   * profiles.status_music_url     the iTunes preview (30 second .m4a)
--   * profiles.status_music_art     the album art (100x100) shown on the play button
--   * profiles.status_music_start   where the clip starts, in seconds (0 to 30).
--                                   The site plays the full 30 second iTunes preview from there.
--   * profiles.status_music_path    an UPLOADED clip: the app trims the member's MP3 / M4A to the
--                                   30 seconds they picked and uploads a small WAV (about 2 MB)
--   * status-audio                  public audio bucket, 3 MB, members write only in their own folder
--
-- NOTE: Postgres regular expressions only allow repeat counts up to 255, so the
-- 500 character limit is a separate char_length() check, not {1,500}.
--
-- SECURITY: nobody can store a free link. The preview must be on Apple's
-- audio host (audio-ssl.itunes.apple.com) and the art on Apple's image host
-- (is1..is9-ssl.mzstatic.com). Anything else is rejected by both the
-- function and a table constraint, so a status can never point every
-- viewer's browser at a tracking URL.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Columns
-- --------------------------------------------------------------------------
alter table public.profiles add column if not exists status_music_url   text;
alter table public.profiles add column if not exists status_music_art   text;
alter table public.profiles add column if not exists status_music_start numeric(4,1);

alter table public.profiles drop constraint if exists profiles_status_music_url_fmt;
alter table public.profiles drop constraint if exists profiles_status_music_art_fmt;
alter table public.profiles drop constraint if exists profiles_status_music_start_rng;

alter table public.profiles add constraint profiles_status_music_url_fmt
  check (status_music_url is null
         or (char_length(status_music_url) <= 500 and status_music_url ~ '^https://audio-ssl\.itunes\.apple\.com/[^[:space:]<>"'']+$'));

alter table public.profiles add constraint profiles_status_music_art_fmt
  check (status_music_art is null
         or (char_length(status_music_art) <= 500 and status_music_art ~ '^https://is[0-9]-ssl\.mzstatic\.com/[^[:space:]<>"'']+$'));

alter table public.profiles add constraint profiles_status_music_start_rng
  check (status_music_start is null or (status_music_start >= 0 and status_music_start <= 30));

alter table public.profiles add column if not exists status_music_path text;
alter table public.profiles drop constraint if exists profiles_status_music_path_fmt;
-- <user id>/<file name>, same shape as the thumbnail path
alter table public.profiles add constraint profiles_status_music_path_fmt
  check (status_music_path is null
         or status_music_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,80}$');

-- --------------------------------------------------------------------------
-- 2. Save / clear the custom status (now with the music clip)
--    Sending nothing (no text, no thumbnail, no music) clears everything.
--    A clip only counts when there is a song title next to it.
-- --------------------------------------------------------------------------
drop function if exists public.profile_set_custom_status(text, int, text, text, text);
drop function if exists public.profile_set_custom_status(text, int, text, text, text, text, text, numeric);

create or replace function public.profile_set_custom_status(
  p_text         text    default null,
  p_minutes      int     default null,
  p_thumb        text    default null,
  p_music_title  text    default null,
  p_music_artist text    default null,
  p_music_url    text    default null,
  p_music_art    text    default null,
  p_music_start  numeric default null,
  p_music_path   text    default null
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
  v_url    text;
  v_art    text;
  v_start  numeric;
  v_path   text;
  v_exp    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_text   := nullif(left(btrim(coalesce(p_text, '')), 60), '');
  v_thumb  := nullif(btrim(coalesce(p_thumb, '')), '');
  v_title  := nullif(left(btrim(coalesce(p_music_title, '')), 60), '');
  v_artist := nullif(left(btrim(coalesce(p_music_artist, '')), 60), '');
  v_url    := nullif(btrim(coalesce(p_music_url, '')), '');
  v_art    := nullif(btrim(coalesce(p_music_art, '')), '');
  v_path   := nullif(btrim(coalesce(p_music_path, '')), '');

  -- the artist, the clip and the art alone mean nothing
  if v_title is null then
    v_artist := null;
    v_url    := null;
    v_art    := null;
    v_path   := null;
  end if;

  -- only Apple's own hosts
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://audio-ssl\.itunes\.apple\.com/[^[:space:]<>"'']+$') then
    raise exception 'bad_music_url';
  end if;
  if v_art is not null and (char_length(v_art) > 500 or v_art !~ '^https://is[0-9]-ssl\.mzstatic\.com/[^[:space:]<>"'']+$') then
    v_art := null;   -- the art is a bonus, so a bad one is simply dropped
  end if;

  if v_url is null then
    v_art   := null;
    v_start := null;
  else
    v_start := round(least(greatest(coalesce(p_music_start, 0), 0), 30), 1);
  end if;

  -- an uploaded clip lives in the member's own folder of status-audio and replaces any iTunes clip
  if v_path is not null then
    if left(v_path, 37) <> (auth.uid()::text || '/') or v_path !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,80}$' then
      raise exception 'bad_music_path';
    end if;
    v_url   := null;
    v_art   := null;
    v_start := 0;
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
      status_music_url    = v_url,
      status_music_art    = v_art,
      status_music_start  = v_start,
      status_music_path   = v_path,
      status_expires_at   = v_exp
  where id = auth.uid();
end;
$$;

grant execute on function
  public.profile_set_custom_status(text, int, text, text, text, text, text, numeric, text)
  to authenticated;

-- --------------------------------------------------------------------------
-- 3. Uploaded clips (the app sends a trimmed 30 second WAV, about 1.9 MB)
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('status-audio', 'status-audio', true, 3145728,
        array['audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "status audio public read" on storage.objects;
drop policy if exists "status audio upload own"  on storage.objects;
drop policy if exists "status audio replace own" on storage.objects;
drop policy if exists "status audio delete own"  on storage.objects;

create policy "status audio public read"
  on storage.objects for select
  using (bucket_id = 'status-audio');

-- a member can only write inside a folder named after their own user id
create policy "status audio upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'status-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "status audio replace own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'status-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "status audio delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'status-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- make PostgREST (the Supabase API) pick up the new function right away
notify pgrst, 'reload schema';
