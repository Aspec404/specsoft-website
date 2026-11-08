-- ============================================================================
-- SPECSOFT® GLITCHWARE EVENT (live, synced for everyone)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql, supabase-store.sql,
-- supabase-store-quests.sql and supabase-nuke.sql. Safe to re-run (also safe if you already ran
-- the first version of this file: it upgrades it in place).
--
--   * site_glitch_now()                 what every visitor's browser asks ("is there a glitchware event?")
--   * glitch_join / glitch_collect      members only; the SERVER counts credits and decides who PURGED it
--   * glitch_report()                   the ending screen list (@username [ PURGED ] / [ INFECTED ])
--   * Console > Events > Glitchware     staff: launch, schedule, abort, timer, goal, pages, rewards,
--                                       villain image, 5 audio slots
--   * glitch-assets (storage bucket)    where the villain image and the OSTs are uploaded (staff only)
--   * events_overlap()                  one shared check so a nuke and a glitchware never run together
--
-- How the hunt works
--   Hidden APEX Credits sit on the pages staff pick ("hunt pages"). Positions come from a seed in the
--   event row. Each credit has a point value that depends on its slot number (see glitch_value).
--   Collect enough points (the goal, 300 by default) before the timer ends and the glitchware is
--   purged for you. The goal is POINTS. What staff pay out for winning is set separately
--   (reward_ac / reward_xp). Rewards are paid HERE in the database.
--
-- Anti-cheat (the server does not trust the browser)
--   * a credit only counts on a page that is in the event's hunt pages list
--   * one pickup per 250 ms, one pickup per credit, and a real person needs time to win:
--     the winning pickup is refused until 25% of the timer (at least 15 s) has passed since you joined
--   * a launch is refused if the goal could not be reached (goal must be <= 80% of the hidden points)
-- ============================================================================

-- ---------- storage: villain image + OSTs ------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('glitch-assets', 'glitch-assets', true, 15728640,
        array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'image/png', 'image/webp', 'image/gif', 'image/jpeg'])
on conflict (id) do update
   set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- storage policies run as the signed in member, who may not call staff_rank() directly,
-- so this small wrapper (security definer) answers "is this an unlocked admin?" for them
create or replace function public.glitch_assets_staff()
returns boolean language sql stable security definer set search_path = public as $$
    select public.staff_rank(auth.uid()) >= 2 and public.admin_unlocked(auth.uid());
$$;
revoke all on function public.glitch_assets_staff() from public, anon;
grant execute on function public.glitch_assets_staff() to authenticated;

drop policy if exists "glitch assets staff read" on storage.objects;
drop policy if exists "glitch assets staff insert" on storage.objects;
drop policy if exists "glitch assets staff update" on storage.objects;
drop policy if exists "glitch assets staff delete" on storage.objects;
create policy "glitch assets staff read"   on storage.objects for select to authenticated using (bucket_id = 'glitch-assets' and public.glitch_assets_staff());
create policy "glitch assets staff insert" on storage.objects for insert to authenticated with check (bucket_id = 'glitch-assets' and public.glitch_assets_staff());
create policy "glitch assets staff update" on storage.objects for update to authenticated using (bucket_id = 'glitch-assets' and public.glitch_assets_staff()) with check (bucket_id = 'glitch-assets' and public.glitch_assets_staff());
create policy "glitch assets staff delete" on storage.objects for delete to authenticated using (bucket_id = 'glitch-assets' and public.glitch_assets_staff());

-- ---------- one rule for "is this one of OUR uploaded files?" -----------------
create or replace function public.glitch_url_ok(u text)
returns boolean language sql immutable as $$
    select u is null or u ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/(event-audio|glitch-assets)/[A-Za-z0-9_./%-]{3,200}$';
$$;

-- ---------- settings (one row) ------------------------------------------------
create table if not exists public.glitch_settings (
    id int primary key default 1 check (id = 1),
    duration_s int not null default 180 check (duration_s between 30 and 1800),      -- the timer
    goal int not null default 300 check (goal between 10 and 5000),                  -- points to collect
    density int not null default 8 check (density between 3 and 12),                 -- hidden credits per page
    intensity text not null default 'medium' check (intensity in ('low', 'medium', 'chaos')),
    jumpscare boolean not null default true,
    reward_xp int not null default 0 check (reward_xp between 0 and 1000000),
    reward_ac int not null default 0 check (reward_ac between 0 and 1000000),
    volume int not null default 80 check (volume between 0 and 100),
    villain_url text,                                                                -- the villain image (jumpscare, intro, popups)
    pages text[] not null default '{}',                                              -- hunt pages: file name without .html
    audio_loop text,                                                                 -- main OST (loops)
    audio_panic text,                                                                -- final 30 seconds OST (loops)
    audio_scare text,                                                                -- jumpscare sound
    audio_crash text,                                                                -- crash screen ambience (loops)
    audio_purge text,                                                                -- victory sting
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.glitch_settings (id) values (1) on conflict (id) do nothing;

-- upgrade from the first version of this file (no-ops on a fresh install)
alter table public.glitch_settings add column if not exists villain_url text;
alter table public.glitch_settings add column if not exists pages text[] not null default '{}';
alter table public.glitch_settings add column if not exists audio_panic text;
alter table public.glitch_settings add column if not exists audio_crash text;
alter table public.glitch_settings drop constraint if exists glitch_settings_audio_loop_check;
alter table public.glitch_settings drop constraint if exists glitch_settings_audio_scare_check;
alter table public.glitch_settings drop constraint if exists glitch_settings_audio_purge_check;
alter table public.glitch_settings drop constraint if exists glitch_settings_urls_ok;
alter table public.glitch_settings add constraint glitch_settings_urls_ok check (
    public.glitch_url_ok(villain_url) and public.glitch_url_ok(audio_loop) and public.glitch_url_ok(audio_panic)
    and public.glitch_url_ok(audio_scare) and public.glitch_url_ok(audio_crash) and public.glitch_url_ok(audio_purge));
alter table public.glitch_settings drop constraint if exists glitch_settings_pages_ok;
alter table public.glitch_settings add constraint glitch_settings_pages_ok check (cardinality(pages) <= 30);

-- ---------- events (each launch copies the settings, so later edits never change a running event) ----
create table if not exists public.glitch_events (
    id uuid primary key default gen_random_uuid(),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,          -- hijack begins, timer starts
    ends_at timestamptz not null,            -- timer over: purged or jumpscare
    duration_s int not null,
    goal int not null,
    density int not null,
    seed int not null default (floor(random() * 2000000000))::int,
    intensity text not null default 'medium',
    jumpscare boolean not null default true,
    reward_xp int not null default 0,
    reward_ac int not null default 0,
    volume int not null default 80,
    villain_url text,
    pages text[] not null default '{}',
    audio_loop text, audio_panic text, audio_scare text, audio_crash text, audio_purge text,
    aborted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
alter table public.glitch_events add column if not exists villain_url text;
alter table public.glitch_events add column if not exists pages text[] not null default '{}';
alter table public.glitch_events add column if not exists audio_panic text;
alter table public.glitch_events add column if not exists audio_crash text;
create index if not exists glitch_events_start_idx on public.glitch_events (starts_at desc);

create table if not exists public.glitch_players (
    event_id uuid not null references public.glitch_events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    points int not null default 0,
    last_collect_at timestamptz,
    purged_at timestamptz,                   -- set by the server when the goal was really reached = PURGED
    primary key (event_id, user_id)
);
create index if not exists glitch_players_purged_idx on public.glitch_players (event_id, purged_at);

-- one row per credit a member picked up (this is what stops double counting)
create table if not exists public.glitch_collects (
    event_id uuid not null references public.glitch_events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    page text not null,
    idx int not null,
    at timestamptz not null default now(),
    primary key (event_id, user_id, page, idx)
);

-- nobody reads or writes these tables directly: only the functions below
alter table public.glitch_settings enable row level security;
alter table public.glitch_events enable row level security;
alter table public.glitch_players enable row level security;
alter table public.glitch_collects enable row level security;

-- ---------- point value of a hidden credit (glitchware-event.js uses the same rule) ----
--   slots 0 and 6 = 25 points (big)   slots 3 and 9 = 10 points   all other slots = 5 points
create or replace function public.glitch_value(p_idx int)
returns int language sql immutable as $$
    select case when p_idx % 6 = 0 then 25 when p_idx % 3 = 0 then 10 else 5 end;
$$;

-- ---------- one shared "is anything else running?" check (nuke + glitchware) ---------
create or replace function public.events_overlap(t0 timestamptz, dur_s int)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.nuke_events x
                    where x.aborted_at is null
                      and x.ends_at > t0 - interval '60 seconds'
                      and x.starts_at < t0 + make_interval(secs => dur_s + 60))
        or exists (select 1 from public.glitch_events g
                    where g.aborted_at is null
                      and g.ends_at + interval '20 seconds' > t0 - interval '60 seconds'
                      and g.starts_at < t0 + make_interval(secs => dur_s + 60));
$$;
revoke all on function public.events_overlap(timestamptz, int) from public, anon, authenticated;

-- the other direction: a NUKE launch is refused while a glitchware is scheduled or running around then.
-- (a trigger, so your existing admin_nuke_launch does not have to be touched)
create or replace function public.glitch_block_nuke_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if exists (select 1 from public.glitch_events g
                where g.aborted_at is null
                  and g.ends_at + interval '20 seconds' > new.starts_at - interval '60 seconds'
                  and g.starts_at < new.ends_at + interval '60 seconds') then
        raise exception 'event_overlap' using hint = 'A glitchware event is scheduled around then.';
    end if;
    return new;
end $$;
revoke all on function public.glitch_block_nuke_overlap() from public, anon, authenticated;
drop trigger if exists glitch_block_nuke_overlap on public.nuke_events;
create trigger glitch_block_nuke_overlap before insert on public.nuke_events
    for each row execute function public.glitch_block_nuke_overlap();

-- ---------- public: is there an event? ----------------------------------------
create or replace function public.site_glitch_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.glitch_events;
begin
    select * into e from public.glitch_events x
     where x.aborted_at is null
       and x.ends_at > now() - interval '5 minutes'
       and x.starts_at < now() + interval '1 hour'
     order by case when x.ends_at >= now() then 0 else 1 end, x.starts_at asc
     limit 1;
    if not found then return json_build_object('now', now(), 'event', null); end if;
    return json_build_object('now', now(), 'event', json_build_object(
        'id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'duration_s', e.duration_s, 'goal', e.goal, 'density', e.density, 'seed', e.seed,
        'intensity', e.intensity, 'jumpscare', e.jumpscare, 'volume', e.volume,
        'reward_xp', e.reward_xp, 'reward_ac', e.reward_ac,
        'villain', e.villain_url, 'pages', to_json(e.pages),
        'audio', json_build_object('loop', e.audio_loop, 'panic', e.audio_panic, 'scare', e.audio_scare,
                                   'crash', e.audio_crash, 'purge', e.audio_purge)));
end $$;

-- ---------- members: join (also tells the page what you already collected) ----
create or replace function public.glitch_join(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.glitch_events; p public.glitch_players;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.glitch_events where id = p_event and aborted_at is null;
    if not found or now() < e.starts_at or now() > e.ends_at + interval '20 seconds' then return json_build_object('ok', false); end if;
    insert into public.glitch_players (event_id, user_id) values (p_event, uid) on conflict do nothing;
    select * into p from public.glitch_players where event_id = p_event and user_id = uid;
    return json_build_object('ok', true, 'points', p.points, 'purged', p.purged_at is not null,
        'got', coalesce((select json_agg(c.page || ':' || c.idx) from public.glitch_collects c where c.event_id = p_event and c.user_id = uid), '[]'::json));
end $$;

-- ---------- members: pick up one hidden credit ---------------------------------
-- The browser says "I found credit #3 on page store". The server checks the event is running, the page is
-- one of the hunt pages, the slot exists, you did not already take it, you are not clicking faster than a
-- hand can, and (for the credit that reaches the goal) that enough real time passed since you joined.
-- Rewards are paid exactly once.
create or replace function public.glitch_collect(p_event uuid, p_page text, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.glitch_events; p public.glitch_players;
        v int; n int; ins int; bal bigint; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.glitch_events where id = p_event and aborted_at is null;
    if not found then raise exception 'event_not_found'; end if;
    if now() < e.starts_at or now() > e.ends_at + interval '2 seconds' then raise exception 'not_running'; end if;
    if p_page is null or p_page !~ '^[a-z0-9_-]{1,32}$' then raise exception 'bad_page'; end if;
    if cardinality(e.pages) = 0 or not (p_page = any (e.pages)) then raise exception 'bad_page'; end if;
    if p_idx is null or p_idx < 0 or p_idx >= e.density then raise exception 'bad_item'; end if;

    insert into public.glitch_players (event_id, user_id) values (p_event, uid) on conflict do nothing;
    select * into p from public.glitch_players where event_id = p_event and user_id = uid for update;
    if p.purged_at is not null then
        return json_build_object('ok', true, 'already', true, 'purged', true, 'points', p.points, 'goal', e.goal);
    end if;
    if p.last_collect_at is not null and now() - p.last_collect_at < interval '250 milliseconds' then raise exception 'too_fast'; end if;

    insert into public.glitch_collects (event_id, user_id, page, idx) values (p_event, uid, p_page, p_idx) on conflict do nothing;
    get diagnostics ins = row_count;
    if ins = 0 then   -- already picked up before
        return json_build_object('ok', true, 'dup', true, 'purged', false, 'points', p.points, 'goal', e.goal);
    end if;

    v := public.glitch_value(p_idx);
    n := p.points + v;

    if n >= e.goal then
        -- a person needs real time to find this many credits: 25% of the timer (at least 15 s) since joining.
        -- (this rolls the pickup back, so a real player who is just very fast can try again a moment later)
        if extract(epoch from (now() - p.joined_at)) < greatest(15, floor(e.duration_s * 0.25)) then raise exception 'too_fast'; end if;
        update public.glitch_players set points = n, last_collect_at = now(), purged_at = now()
         where event_id = p_event and user_id = uid;

        if e.reward_ac > 0 then
            insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
            update public.apex_wallets
               set balance = balance + e.reward_ac, lifetime = lifetime + e.reward_ac, updated_at = now()
             where user_id = uid returning balance into bal;
            insert into public.apex_ledger (user_id, delta, reason) values (uid, e.reward_ac, 'Glitchware: purged');
        else
            select balance into bal from public.apex_wallets where user_id = uid;
        end if;
        if e.reward_xp > 0 then
            insert into public.user_xp (user_id, xp) values (uid, e.reward_xp)
            on conflict (user_id) do update set xp = public.user_xp.xp + e.reward_xp, updated_at = now();
        end if;
        select * into u from public.user_xp where user_id = uid;
        return json_build_object('ok', true, 'value', v, 'points', n, 'goal', e.goal, 'purged', true,
                                 'reward_ac', e.reward_ac, 'reward_xp', e.reward_xp,
                                 'balance', coalesce(bal, 0), 'xp', public.xp_info(coalesce(u.xp, 0)));
    end if;

    update public.glitch_players set points = n, last_collect_at = now() where event_id = p_event and user_id = uid;
    return json_build_object('ok', true, 'value', v, 'points', n, 'goal', e.goal, 'purged', false);
end $$;

-- ---------- the ending screen list ---------------------------------------------
create or replace function public.glitch_report(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.glitch_events;
begin
    select * into e from public.glitch_events where id = p_event and aborted_at is null;
    if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
    if now() < e.ends_at then return json_build_object('ok', false, 'error', 'not_over'); end if;
    return json_build_object(
        'ok', true, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'goal', e.goal,
        'purged',   (select count(*) from public.glitch_players where event_id = p_event and purged_at is not null),
        'infected', (select count(*) from public.glitch_players where event_id = p_event and purged_at is null),
        'players', coalesce((
            select json_agg(json_build_object('u', t.username, 'purged', t.purged, 'me', t.me)
                            order by (not t.purged), lower(t.username))
              from (select pr.username, (p.purged_at is not null) as purged, (p.user_id = auth.uid()) as me
                      from public.glitch_players p join public.profiles pr on pr.id = p.user_id
                     where p.event_id = p_event and pr.username is not null
                     order by (p.purged_at is null), lower(pr.username) limit 1000) t
        ), '[]'::json));
end $$;

grant execute on function public.site_glitch_now() to anon, authenticated;
grant execute on function public.glitch_report(uuid) to anon, authenticated;
revoke all on function public.glitch_join(uuid) from public, anon;
revoke all on function public.glitch_collect(uuid, text, int) from public, anon;
grant execute on function public.glitch_join(uuid) to authenticated;
grant execute on function public.glitch_collect(uuid, text, int) to authenticated;

-- ---------- staff: read everything for Console > Events > Glitchware ------------
create or replace function public.admin_glitch_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'glitch_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true, 'now', now(),
        'settings', (select to_jsonb(s) from public.glitch_settings s where s.id = 1),
        'events', coalesce((
            select jsonb_agg(to_jsonb(x) order by x.starts_at desc)
              from (select e.*,
                           (select count(*) from public.glitch_players p where p.event_id = e.id) as players,
                           (select count(*) from public.glitch_players p where p.event_id = e.id and p.purged_at is not null) as purged
                      from public.glitch_events e order by e.starts_at desc limit 15) x
        ), '[]'::jsonb));
end $$;

-- ---------- staff: timer, goal, pages, rewards, look, villain, audio -------------
-- (the first version of this function had 12 arguments: drop it so only this one exists)
drop function if exists public.admin_glitch_settings_set(int, int, int, text, boolean, int, int, int, text, text, text, text);
create or replace function public.admin_glitch_settings_set(
    p_duration int, p_goal int, p_density int, p_intensity text, p_jumpscare boolean,
    p_xp int, p_ac int, p_volume int, p_villain text, p_pages text[],
    p_loop text, p_panic text, p_scare text, p_crash text, p_purge text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb; v_pages text[];
begin
    v_err := public.admin_gate('admin', 'glitch_settings_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_duration is null or p_duration not between 30 and 1800 then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_duration'); end if;
    if p_goal is null or p_goal not between 10 and 5000 then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_goal'); end if;
    if p_density is null or p_density not between 3 and 12 then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_density'); end if;
    if p_intensity is null or p_intensity not in ('low', 'medium', 'chaos') then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_intensity'); end if;
    if p_xp is null or p_xp not between 0 and 1000000 or p_ac is null or p_ac not between 0 and 1000000 then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_reward'); end if;
    if p_volume is null or p_volume not between 0 and 100 then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_volume'); end if;
    if not public.glitch_url_ok(p_villain) then return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_image_url'); end if;
    if not (public.glitch_url_ok(p_loop) and public.glitch_url_ok(p_panic) and public.glitch_url_ok(p_scare)
            and public.glitch_url_ok(p_crash) and public.glitch_url_ok(p_purge)) then
        return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_audio_url');
    end if;

    v_pages := coalesce((select array_agg(distinct lower(btrim(x)) order by lower(btrim(x)))
                           from unnest(coalesce(p_pages, '{}'::text[])) x where btrim(x) <> ''), '{}'::text[]);
    if cardinality(v_pages) > 30 or exists (select 1 from unnest(v_pages) y where y !~ '^[a-z0-9_-]{1,32}$') then
        return public.admin_fail('glitch_settings_set', null, p_reason, 'bad_pages');
    end if;

    select to_jsonb(s) into v_before from public.glitch_settings s where s.id = 1;
    update public.glitch_settings
       set duration_s = p_duration, goal = p_goal, density = p_density, intensity = p_intensity,
           jumpscare = coalesce(p_jumpscare, jumpscare), reward_xp = p_xp, reward_ac = p_ac, volume = p_volume,
           villain_url = p_villain, pages = v_pages,
           audio_loop = p_loop, audio_panic = p_panic, audio_scare = p_scare, audio_crash = p_crash, audio_purge = p_purge,
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.glitch_settings s where s.id = 1;
    perform public.admin_log('glitch_settings_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: launch (now = starts in 45 seconds so every open page can catch it) -----
create or replace function public.admin_glitch_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.glitch_settings; t0 timestamptz; e public.glitch_events; v_ppp int;
begin
    v_err := public.admin_gate('admin', 'glitch_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.glitch_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '45 seconds');
    if t0 < now() + interval '10 seconds' then return public.admin_fail('glitch_launch', null, p_reason, 'bad_time'); end if;
    if cardinality(s.pages) = 0 then return public.admin_fail('glitch_launch', null, p_reason, 'no_pages'); end if;
    select coalesce(sum(public.glitch_value(i)), 0) into v_ppp from generate_series(0, s.density - 1) i;
    if s.goal > floor(cardinality(s.pages) * v_ppp * 0.8) then
        return public.admin_fail('glitch_launch', null, p_reason, 'goal_unreachable',
                                 jsonb_build_object('goal', s.goal, 'hidden', cardinality(s.pages) * v_ppp));
    end if;
    if public.events_overlap(t0, s.duration_s + 20) then
        return public.admin_fail('glitch_launch', null, p_reason, 'event_overlap');
    end if;
    insert into public.glitch_events (label, starts_at, ends_at, duration_s, goal, density, intensity, jumpscare,
                                      reward_xp, reward_ac, volume, villain_url, pages,
                                      audio_loop, audio_panic, audio_scare, audio_crash, audio_purge, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t0 + make_interval(secs => s.duration_s), s.duration_s, s.goal, s.density,
            s.intensity, s.jumpscare, s.reward_xp, s.reward_ac, s.volume, s.villain_url, s.pages,
            s.audio_loop, s.audio_panic, s.audio_scare, s.audio_crash, s.audio_purge, auth.uid())
    returning * into e;
    perform public.admin_log('glitch_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'glitch_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;

-- ---------- staff: abort (every browser tidies itself within seconds) ------------
create or replace function public.admin_glitch_abort(p_event uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'glitch_abort');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.glitch_events x where x.id = p_event and x.aborted_at is null and x.ends_at > now();
    if v_before is null then return public.admin_fail('glitch_abort', null, p_reason, 'not_active'); end if;
    update public.glitch_events set aborted_at = now() where id = p_event;
    perform public.admin_log('glitch_abort', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, null, null, 'glitch_event', p_event::text);
    return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_glitch_get() from public, anon;
revoke all on function public.admin_glitch_settings_set(int, int, int, text, boolean, int, int, int, text, text[], text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_glitch_launch(timestamptz, text, text) from public, anon;
revoke all on function public.admin_glitch_abort(uuid, text) from public, anon;
grant execute on function public.admin_glitch_get() to authenticated;
grant execute on function public.admin_glitch_settings_set(int, int, int, text, boolean, int, int, int, text, text[], text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_glitch_launch(timestamptz, text, text) to authenticated;
grant execute on function public.admin_glitch_abort(uuid, text) to authenticated;
