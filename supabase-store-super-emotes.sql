-- ============================================================================
-- SPECSOFT® Store: SUPER EMOTES  (sticker emotes with effects + sound)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-emotes.sql
-- (and after the frames SQL, because it reuses store_is_admin()). Safe to re-run.
--
-- What this adds
--   1. store_items.super_data      the super design (effects, sound, sticker style), emotes only
--   2. store-super bucket          public, 10 MB per file, PNG / GIF / WebP images and mp3 / ogg / wav / m4a sounds;
--                                  only store admins can upload, change or delete
--   3. store_super_ok()            the validator behind the super_data check (intro / loop / outro names, every number clamped,
--                                  every color #rrggbb, sound files must live in the store-super bucket)
--   4. chat_super_emotes()         what chats loads so every message can show the sticker for everyone
--   5. server-side rules           ONE super emote per message and a 10 SECOND cooldown per member,
--                                  enforced by a trigger, so nobody can skip the timer from the browser console
--
-- Nothing here changes chat_send, chat_emotes or chat_my_emotes, so it cannot clash with your other SQL files.
-- ============================================================================

-- ---------- 1. column ----------------------------------------------------------
alter table public.store_items add column if not exists super_data jsonb;

-- ---------- 2. bucket + policies -----------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-super', 'store-super', true, 10485760, array[
    'image/png', 'image/gif', 'image/webp',
    'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do update
    set public = true,
        file_size_limit = 10485760,
        allowed_mime_types = array[
            'image/png', 'image/gif', 'image/webp',
            'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];

drop policy if exists store_super_read on storage.objects;
create policy store_super_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'store-super');

drop policy if exists store_super_admin_insert on storage.objects;
create policy store_super_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'store-super' and public.store_is_admin());

drop policy if exists store_super_admin_update on storage.objects;
create policy store_super_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'store-super' and public.store_is_admin())
    with check (bucket_id = 'store-super' and public.store_is_admin());

drop policy if exists store_super_admin_delete on storage.objects;
create policy store_super_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'store-super' and public.store_is_admin());

-- ---------- 3. validator -------------------------------------------------------
create or replace function public.store_super_ok(f jsonb)
returns boolean language plpgsql immutable as $$
declare
    l jsonb; c jsonb; s jsonb; k text; n numeric;
begin
    if f is null or jsonb_typeof(f) <> 'object' then return false; end if;
    if pg_column_size(f) > 8000 then return false; end if;
    if coalesce(f->>'v', '') <> '1' then return false; end if;

    if f->'hl' is not null and (jsonb_typeof(f->'hl') <> 'string' or (f->>'hl') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
    if f->'anim' is not null and (jsonb_typeof(f->'anim') <> 'string' or (f->>'anim') not in ('pop', 'bounce', 'wiggle', 'none')) then return false; end if;
    if f->'intro' is not null and (jsonb_typeof(f->'intro') <> 'string' or (f->>'intro') not in ('none', 'pop', 'bounce', 'wiggle', 'spin', 'zoom', 'dash', 'drop', 'flip', 'rubber', 'glitch', 'fade')) then return false; end if;
    if f->'loop' is not null and (jsonb_typeof(f->'loop') <> 'string' or (f->>'loop') not in ('none', 'spin', 'pulse', 'float', 'wiggle', 'heartbeat', 'shake', 'swing', 'tada', 'flicker')) then return false; end if;
    if f->'outro' is not null and (jsonb_typeof(f->'outro') <> 'string' or (f->>'outro') not in ('none', 'spin', 'hop', 'shrink', 'fadedip', 'shake', 'dash')) then return false; end if;
    if f->'impact' is not null and jsonb_typeof(f->'impact') <> 'boolean' then return false; end if;
    if f->'glow' is not null and jsonb_typeof(f->'glow') <> 'boolean' then return false; end if;

    foreach k in array array['size', 'tilt', 'dur'] loop
        if f->k is not null then
            if jsonb_typeof(f->k) <> 'number' then return false; end if;
            n := (f->>k)::numeric;
            if k = 'size' and n not between 48 and 128 then return false; end if;
            if k = 'tilt' and n not between -20 and 20 then return false; end if;
            if k = 'dur'  and n not between 1000 and 6000 then return false; end if;
        end if;
    end loop;

    s := f->'sound';
    if s is not null and jsonb_typeof(s) <> 'null' then
        if jsonb_typeof(s) <> 'object' then return false; end if;
        if coalesce(jsonb_typeof(s->'src'), '') <> 'string' then return false; end if;
        if (s->>'src') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/store-super/[A-Za-z0-9._/-]+$' then return false; end if;
        if position('..' in (s->>'src')) > 0 or length(s->>'src') > 300 then return false; end if;
        if s->'vol' is not null then
            if jsonb_typeof(s->'vol') <> 'number' then return false; end if;
            if (s->>'vol')::numeric not between 0.05 and 1 then return false; end if;
        end if;
    end if;

    if f->'fx' is not null then
        if jsonb_typeof(f->'fx') <> 'array' then return false; end if;
        if jsonb_array_length(f->'fx') > 4 then return false; end if;
        for l in select * from jsonb_array_elements(f->'fx') loop
            if jsonb_typeof(l) <> 'object' then return false; end if;
            if coalesce(l->>'type', '') not in (
                'burst', 'confetti', 'fire', 'rain', 'hearts', 'stars', 'snow',
                'lightning', 'shockwave', 'shake', 'flash', 'glitch', 'vignette',
                'sparkles', 'bubbles', 'petals', 'coins', 'meteors', 'smoke', 'fireworks', 'speedlines',
                'rays', 'spotlight', 'matrix', 'scanlines', 'pixelburst', 'emojirain', 'emojiburst') then return false; end if;
            if coalesce(jsonb_typeof(l->'colors'), '') <> 'array' then return false; end if;
            if jsonb_array_length(l->'colors') not between 1 and 4 then return false; end if;
            for c in select * from jsonb_array_elements(l->'colors') loop
                if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
            end loop;
            foreach k in array array['amount', 'speed', 'delay'] loop
                if l->k is not null then
                    if jsonb_typeof(l->k) <> 'number' then return false; end if;
                    n := (l->>k)::numeric;
                    if k in ('amount', 'speed') and n not between 1 and 10 then return false; end if;
                    if k = 'delay' and n not between 0 and 2000 then return false; end if;
                end if;
            end loop;
        end loop;
    end if;

    return true;
end $$;

alter table public.store_items drop constraint if exists store_items_super_rules;
alter table public.store_items add constraint store_items_super_rules
    check (super_data is null or (category = 'emote' and public.store_super_ok(super_data)));

-- ---------- 4. what chats loads ------------------------------------------------
-- Everybody can SEE every super emote (sticker + effects); only owners can SEND them
-- (that part is already enforced by the store_enforce_emotes trigger).
create or replace function public.chat_super_emotes()
returns table (emote_name text, super_data jsonb)
language sql stable security definer set search_path = public as $$
    select i.emote_name, i.super_data
      from public.store_items i
     where i.category = 'emote' and i.emote_name is not null
       and i.image_url is not null and i.super_data is not null;
$$;

grant execute on function public.chat_super_emotes() to anon, authenticated;

-- ---------- 5. one per message + 10 second cooldown ----------------------------
-- The cooldown lives in its own tiny table, so deleting a message can never reset it.
create table if not exists public.super_emote_cd (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    last_at timestamptz not null default now()
);
alter table public.super_emote_cd enable row level security;
-- no policies on purpose: only the trigger below (security definer) touches this table

create or replace function public.store_enforce_super_emotes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    codes text[];
    used text[];
    old_used text[];
    prev timestamptz;
    wait_s integer;
begin
    if new.body is null or position(':' in new.body) = 0 then return new; end if;

    select coalesce(array_agg(i.emote_name), '{}') into codes
      from public.store_items i
     where i.category = 'emote' and i.super_data is not null and i.emote_name is not null;
    if coalesce(array_length(codes, 1), 0) = 0 then return new; end if;

    select coalesce(array_agg(lower(m[1])), '{}') into used
      from regexp_matches(new.body, ':([A-Za-z0-9_+-]{1,32}):', 'g') as t(m)
     where lower(m[1]) = any(codes);
    if coalesce(array_length(used, 1), 0) = 0 then return new; end if;

    if tg_op = 'UPDATE' then
        -- editing a message may keep its super emote, but can never add a new one
        select coalesce(array_agg(lower(m[1])), '{}') into old_used
          from regexp_matches(coalesce(old.body, ''), ':([A-Za-z0-9_+-]{1,32}):', 'g') as t(m)
         where lower(m[1]) = any(codes);
        if array_length(used, 1) > 1
           or exists (select 1 from unnest(used) u where not (u = any(old_used))) then
            raise exception 'super_one_per_message';
        end if;
        return new;
    end if;

    if array_length(used, 1) > 1 then
        raise exception 'super_one_per_message';
    end if;

    select last_at into prev from public.super_emote_cd where user_id = new.sender_id;
    if prev is not null and now() - prev < interval '10 seconds' then
        wait_s := greatest(1, ceil(10 - extract(epoch from (now() - prev)))::integer);
        raise exception 'super_cooldown:%', wait_s;
    end if;

    insert into public.super_emote_cd (user_id, last_at) values (new.sender_id, now())
    on conflict (user_id) do update set last_at = excluded.last_at;

    return new;
end $$;

drop trigger if exists store_enforce_super_emotes on public.chat_messages;
create trigger store_enforce_super_emotes
    before insert or update of body on public.chat_messages
    for each row execute function public.store_enforce_super_emotes();
