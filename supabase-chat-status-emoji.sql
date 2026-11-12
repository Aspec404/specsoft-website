-- ==========================================================================
-- SPECSOFT® Chats  v7: status emoji (the emoji next to the status message)
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-chat-status-music.sql.
-- It is safe to re-run.
--
-- Everything here is ADDITIVE except one swap: profile_set_custom_status()
-- gets one more optional input (p_emoji). The old 9-input version is dropped
-- first, so the site never has two versions to choose between. Old calls
-- (no emoji) keep working because the new input has a default.
--
-- What this adds
--   * profiles.status_emoji   ONE emoji: a keyboard emoji (up to 16 characters,
--                             that covers flags and ZWJ combos) or one of your own
--                             emotes written as :name:
--
-- SECURITY: nothing free-form can be stored. It is either :name: (letters,
-- digits, _ + -) or a short run of characters with no spaces, colons, quotes
-- or angle brackets. The site only draws it as an image or as text, never as HTML.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Column
-- --------------------------------------------------------------------------
alter table public.profiles add column if not exists status_emoji text;

alter table public.profiles drop constraint if exists profiles_status_emoji_fmt;
alter table public.profiles add constraint profiles_status_emoji_fmt
  check (status_emoji is null
         or status_emoji ~ '^:[A-Za-z0-9_+-]{1,32}:$'
         or (char_length(status_emoji) between 1 and 16 and status_emoji !~ '[[:space:]:<>"'']'));

-- --------------------------------------------------------------------------
-- 2. Save / clear the custom status (now with the emoji)
--    Sending nothing (no text, no emoji, no thumbnail, no music) clears everything.
-- --------------------------------------------------------------------------
drop function if exists public.profile_set_custom_status(text, int, text, text, text, text, text, numeric, text);
drop function if exists public.profile_set_custom_status(text, int, text, text, text, text, text, numeric, text, text);

create or replace function public.profile_set_custom_status(
  p_text         text    default null,
  p_minutes      int     default null,
  p_thumb        text    default null,
  p_music_title  text    default null,
  p_music_artist text    default null,
  p_music_url    text    default null,
  p_music_art    text    default null,
  p_music_start  numeric default null,
  p_music_path   text    default null,
  p_emoji        text    default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_text   text;
  v_emoji  text;
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
  v_emoji  := nullif(btrim(coalesce(p_emoji, '')), '');
  v_thumb  := nullif(btrim(coalesce(p_thumb, '')), '');
  v_title  := nullif(left(btrim(coalesce(p_music_title, '')), 60), '');
  v_artist := nullif(left(btrim(coalesce(p_music_artist, '')), 60), '');
  v_url    := nullif(btrim(coalesce(p_music_url, '')), '');
  v_art    := nullif(btrim(coalesce(p_music_art, '')), '');
  v_path   := nullif(btrim(coalesce(p_music_path, '')), '');

  -- one emoji only: :name: or a short run of characters, nothing else
  if v_emoji is not null and not (
       v_emoji ~ '^:[A-Za-z0-9_+-]{1,32}:$'
       or (char_length(v_emoji) between 1 and 16 and v_emoji !~ '[[:space:]:<>"'']')
     ) then
    raise exception 'bad_emoji';
  end if;

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

  if v_text is null and v_emoji is null and v_thumb is null and v_title is null then
    v_exp := null;
  elsif coalesce(p_minutes, 0) > 0 then
    v_exp := now() + make_interval(mins => least(p_minutes, 10080));   -- 7 days at most
  else
    v_exp := null;
  end if;

  update public.profiles
  set status_text         = v_text,
      status_emoji        = v_emoji,
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
  public.profile_set_custom_status(text, int, text, text, text, text, text, numeric, text, text)
  to authenticated;

-- make PostgREST (the Supabase API) pick up the new function right away
notify pgrst, 'reload schema';
