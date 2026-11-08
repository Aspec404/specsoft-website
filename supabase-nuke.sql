-- ============================================================================
-- SPECSOFT® NUKE EVENT (live, synced for everyone)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql, supabase-store.sql and
-- supabase-store-quests.sql. Safe to re-run.
--
--   * site_nuke_now()          what every visitor's browser asks ("is there a nuke event?")
--   * nuke_join / nuke_pad_start / nuke_pad_finish   members only; the SERVER decides who survived
--   * nuke_report()            the ending screen list (@username [ ALIVE ] / [ MISSING ])
--   * Console > Events         staff: launch, schedule, abort, timings, rewards, audio uploads
--   * Every staff change lands in the audit log (same as seasons, bans, roles ...)
--
-- Rewards are paid HERE in the database (APEX Credits + XP), so nobody can give themselves
-- rewards from the browser console. Amounts are set in Console > Events.
-- ============================================================================

-- ---------- audio bucket (mp3 / m4a, 15 MB max, public read, staff write) -----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-audio', 'event-audio', true, 15728640,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'])
on conflict (id) do update
   set public = true, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event audio staff insert" on storage.objects;
create policy "event audio staff insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'event-audio' and public.staff_rank(auth.uid()) >= 2 and public.admin_unlocked(auth.uid()));
drop policy if exists "event audio staff update" on storage.objects;
create policy "event audio staff update" on storage.objects for update to authenticated
    using (bucket_id = 'event-audio' and public.staff_rank(auth.uid()) >= 2 and public.admin_unlocked(auth.uid()));
drop policy if exists "event audio staff delete" on storage.objects;
create policy "event audio staff delete" on storage.objects for delete to authenticated
    using (bucket_id = 'event-audio' and public.staff_rank(auth.uid()) >= 2 and public.admin_unlocked(auth.uid()));

-- ---------- settings (one row) ------------------------------------------------
create table if not exists public.nuke_settings (
    id int primary key default 1 check (id = 1),
    countdown_s int not null default 180 check (countdown_s between 30 and 1800),   -- time to impact
    aftermath_s int not null default 120 check (aftermath_s between 20 and 900),    -- how long the wreck lasts
    reward_xp int not null default 0 check (reward_xp between 0 and 1000000),
    reward_ac int not null default 0 check (reward_ac between 0 and 1000000),
    spare_survivors boolean not null default true,                                  -- survivors watch from a "bunker" instead of the wreck
    volume int not null default 80 check (volume between 0 and 100),
    audio_ost text check (audio_ost is null or audio_ost ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$'),
    audio_boom text check (audio_boom is null or audio_boom ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$'),
    audio_after text check (audio_after is null or audio_after ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$'),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.nuke_settings (id) values (1) on conflict (id) do nothing;

-- ---------- events (each launch copies the settings, so later edits never change a running event) ----
create table if not exists public.nuke_events (
    id uuid primary key default gen_random_uuid(),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,          -- countdown begins
    boom_at timestamptz not null,            -- impact
    ends_at timestamptz not null,            -- aftermath over, ending screen
    countdown_s int not null,
    aftermath_s int not null,
    reward_xp int not null default 0,
    reward_ac int not null default 0,
    spare_survivors boolean not null default true,
    volume int not null default 80,
    audio_ost text, audio_boom text, audio_after text,
    aborted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (boom_at > starts_at and ends_at > boom_at)
);
create index if not exists nuke_events_start_idx on public.nuke_events (starts_at desc);

-- ---------- alarm blare slot (added later; safe to re-run) ----------------------
alter table public.nuke_settings add column if not exists audio_alarm text;
alter table public.nuke_events   add column if not exists audio_alarm text;
alter table public.nuke_settings drop constraint if exists nuke_settings_audio_alarm_check;
alter table public.nuke_settings add constraint nuke_settings_audio_alarm_check
    check (audio_alarm is null or audio_alarm ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$');

create table if not exists public.nuke_participants (
    event_id uuid not null references public.nuke_events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    pad_started_at timestamptz,
    safe_at timestamptz,                     -- set by the server when the tapper was really finished = ALIVE
    primary key (event_id, user_id)
);
create index if not exists nuke_participants_safe_idx on public.nuke_participants (event_id, safe_at);

-- nobody reads or writes these tables directly: only the functions below
alter table public.nuke_settings enable row level security;
alter table public.nuke_events enable row level security;
alter table public.nuke_participants enable row level security;

-- ---------- public: is there an event? ----------------------------------------
-- Returns the current event, or one that starts within the hour, or one that ended in the last 10 minutes.
create or replace function public.site_nuke_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.nuke_events;
begin
    select * into e from public.nuke_events x
     where x.aborted_at is null
       and x.ends_at > now() - interval '10 minutes'
       and x.starts_at < now() + interval '1 hour'
     order by case when x.ends_at >= now() then 0 else 1 end, x.starts_at asc
     limit 1;
    if not found then return json_build_object('now', now(), 'event', null); end if;
    return json_build_object('now', now(), 'event', json_build_object(
        'id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'boom_at', e.boom_at, 'ends_at', e.ends_at,
        'countdown_s', e.countdown_s, 'aftermath_s', e.aftermath_s, 'spare', e.spare_survivors, 'volume', e.volume,
        'reward_xp', e.reward_xp, 'reward_ac', e.reward_ac,
        'audio', json_build_object('ost', e.audio_ost, 'boom', e.audio_boom, 'after', e.audio_after, 'alarm', e.audio_alarm)));
end $$;

-- ---------- members: join, start the tapper, finish the tapper ----------------
create or replace function public.nuke_join(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.nuke_events; p public.nuke_participants;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.nuke_events where id = p_event and aborted_at is null;
    if not found or now() < e.starts_at or now() > e.ends_at then return json_build_object('ok', false); end if;
    insert into public.nuke_participants (event_id, user_id) values (p_event, uid) on conflict do nothing;
    select * into p from public.nuke_participants where event_id = p_event and user_id = uid;
    return json_build_object('ok', true, 'safe', p.safe_at is not null);
end $$;

create or replace function public.nuke_pad_start(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.nuke_events; p public.nuke_participants;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.nuke_events where id = p_event and aborted_at is null;
    if not found then raise exception 'event_not_found'; end if;
    if now() < e.starts_at or now() >= e.boom_at then raise exception 'not_in_countdown'; end if;
    insert into public.nuke_participants (event_id, user_id) values (p_event, uid) on conflict do nothing;
    update public.nuke_participants set pad_started_at = coalesce(pad_started_at, now())
     where event_id = p_event and user_id = uid returning * into p;
    return json_build_object('ok', true, 'safe', p.safe_at is not null);
end $$;

-- The browser says "I hit 210". The server only believes it if the pad was really opened and enough
-- real time passed (a human cannot hit 210 random tiles in a few seconds). Rewards are paid once.
create or replace function public.nuke_pad_finish(p_event uuid, p_hits int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.nuke_events; p public.nuke_participants; elapsed numeric;
        bal bigint; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.nuke_events where id = p_event and aborted_at is null;
    if not found then raise exception 'event_not_found'; end if;
    if now() < e.starts_at then raise exception 'not_in_countdown'; end if;
    if now() > e.boom_at + interval '2 seconds' then raise exception 'too_late'; end if;

    select * into p from public.nuke_participants where event_id = p_event and user_id = uid for update;
    if not found or p.pad_started_at is null then raise exception 'pad_not_started'; end if;
    if p.safe_at is not null then return json_build_object('ok', true, 'already', true); end if;
    if coalesce(p_hits, 0) < 210 then raise exception 'not_enough_hits'; end if;

    elapsed := extract(epoch from (now() - p.pad_started_at));
    if elapsed < 52 then raise exception 'too_fast'; end if;           -- 210 tiles in under 52 seconds is a script, not a hand

    update public.nuke_participants set safe_at = now() where event_id = p_event and user_id = uid;

    if e.reward_ac > 0 then
        insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
        update public.apex_wallets
           set balance = balance + e.reward_ac, lifetime = lifetime + e.reward_ac, updated_at = now()
         where user_id = uid returning balance into bal;
        insert into public.apex_ledger (user_id, delta, reason) values (uid, e.reward_ac, 'Nuke event: survived');
    else
        select balance into bal from public.apex_wallets where user_id = uid;
    end if;

    if e.reward_xp > 0 then
        insert into public.user_xp (user_id, xp) values (uid, e.reward_xp)
        on conflict (user_id) do update set xp = public.user_xp.xp + e.reward_xp, updated_at = now();
    end if;
    select * into u from public.user_xp where user_id = uid;

    return json_build_object('ok', true, 'reward_ac', e.reward_ac, 'reward_xp', e.reward_xp,
                             'balance', coalesce(bal, 0), 'xp', public.xp_info(coalesce(u.xp, 0)));
end $$;

-- ---------- the ending screen list ---------------------------------------------
create or replace function public.nuke_report(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.nuke_events;
begin
    select * into e from public.nuke_events where id = p_event and aborted_at is null;
    if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
    if now() < e.ends_at then return json_build_object('ok', false, 'error', 'not_over'); end if;
    return json_build_object(
        'ok', true, 'starts_at', e.starts_at, 'boom_at', e.boom_at, 'ends_at', e.ends_at,
        'alive',   (select count(*) from public.nuke_participants where event_id = p_event and safe_at is not null),
        'missing', (select count(*) from public.nuke_participants where event_id = p_event and safe_at is null),
        'players', coalesce((
            select json_agg(json_build_object('u', t.username, 'alive', t.alive, 'me', t.me)
                            order by (not t.alive), lower(t.username))
              from (select pr.username, (p.safe_at is not null) as alive, (p.user_id = auth.uid()) as me
                      from public.nuke_participants p join public.profiles pr on pr.id = p.user_id
                     where p.event_id = p_event and pr.username is not null
                     order by (p.safe_at is null), lower(pr.username) limit 1000) t
        ), '[]'::json));
end $$;

grant execute on function public.site_nuke_now() to anon, authenticated;
grant execute on function public.nuke_report(uuid) to anon, authenticated;
revoke all on function public.nuke_join(uuid) from public, anon;
revoke all on function public.nuke_pad_start(uuid) from public, anon;
revoke all on function public.nuke_pad_finish(uuid, int) from public, anon;
grant execute on function public.nuke_join(uuid) to authenticated;
grant execute on function public.nuke_pad_start(uuid) to authenticated;
grant execute on function public.nuke_pad_finish(uuid, int) to authenticated;

-- ---------- staff: read everything for Console > Events -------------------------
create or replace function public.admin_nuke_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'nuke_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true, 'now', now(),
        'settings', (select to_jsonb(s) from public.nuke_settings s where s.id = 1),
        'events', coalesce((
            select jsonb_agg(to_jsonb(x) order by x.starts_at desc)
              from (select e.*,
                           (select count(*) from public.nuke_participants p where p.event_id = e.id) as players,
                           (select count(*) from public.nuke_participants p where p.event_id = e.id and p.safe_at is not null) as alive
                      from public.nuke_events e order by e.starts_at desc limit 15) x
        ), '[]'::jsonb));
end $$;

-- ---------- staff: timings, rewards, volume, audio -----------------------------
drop function if exists public.admin_nuke_settings_set(int, int, int, int, boolean, int, text, text, text, text);
create or replace function public.admin_nuke_settings_set(
    p_countdown int, p_aftermath int, p_xp int, p_ac int, p_spare boolean, p_volume int,
    p_ost text, p_boom text, p_after text, p_alarm text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb;
        v_re text := '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$';
begin
    v_err := public.admin_gate('admin', 'nuke_settings_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_countdown is null or p_countdown not between 30 and 1800 then return public.admin_fail('nuke_settings_set', null, p_reason, 'bad_countdown'); end if;
    if p_aftermath is null or p_aftermath not between 20 and 900 then return public.admin_fail('nuke_settings_set', null, p_reason, 'bad_aftermath'); end if;
    if p_xp is null or p_xp not between 0 and 1000000 or p_ac is null or p_ac not between 0 and 1000000 then return public.admin_fail('nuke_settings_set', null, p_reason, 'bad_reward'); end if;
    if p_volume is null or p_volume not between 0 and 100 then return public.admin_fail('nuke_settings_set', null, p_reason, 'bad_volume'); end if;
    if (p_ost is not null and p_ost !~ v_re) or (p_boom is not null and p_boom !~ v_re) or (p_after is not null and p_after !~ v_re) or (p_alarm is not null and p_alarm !~ v_re) then
        return public.admin_fail('nuke_settings_set', null, p_reason, 'bad_audio_url');
    end if;

    select to_jsonb(s) into v_before from public.nuke_settings s where s.id = 1;
    update public.nuke_settings
       set countdown_s = p_countdown, aftermath_s = p_aftermath, reward_xp = p_xp, reward_ac = p_ac,
           spare_survivors = coalesce(p_spare, spare_survivors), volume = p_volume,
           audio_ost = p_ost, audio_boom = p_boom, audio_after = p_after, audio_alarm = p_alarm,
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.nuke_settings s where s.id = 1;
    perform public.admin_log('nuke_settings_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: launch (now = starts in 45 seconds so every open page can catch it) -----
create or replace function public.admin_nuke_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.nuke_settings; t0 timestamptz; e public.nuke_events;
begin
    v_err := public.admin_gate('admin', 'nuke_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.nuke_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '45 seconds');
    if t0 < now() + interval '10 seconds' then return public.admin_fail('nuke_launch', null, p_reason, 'bad_time'); end if;
    if exists (select 1 from public.nuke_events x
                where x.aborted_at is null
                  and x.ends_at > t0 - interval '60 seconds'
                  and x.starts_at < t0 + make_interval(secs => s.countdown_s + s.aftermath_s + 60)) then
        return public.admin_fail('nuke_launch', null, p_reason, 'event_overlap');
    end if;
    insert into public.nuke_events (label, starts_at, boom_at, ends_at, countdown_s, aftermath_s, reward_xp, reward_ac,
                                    spare_survivors, volume, audio_ost, audio_boom, audio_after, audio_alarm, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t0 + make_interval(secs => s.countdown_s),
            t0 + make_interval(secs => s.countdown_s + s.aftermath_s), s.countdown_s, s.aftermath_s, s.reward_xp, s.reward_ac,
            s.spare_survivors, s.volume, s.audio_ost, s.audio_boom, s.audio_after, s.audio_alarm, auth.uid())
    returning * into e;
    perform public.admin_log('nuke_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'nuke_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;

-- ---------- staff: abort (every browser tidies itself within seconds) ------------
create or replace function public.admin_nuke_abort(p_event uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'nuke_abort');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.nuke_events x where x.id = p_event and x.aborted_at is null and x.ends_at > now();
    if v_before is null then return public.admin_fail('nuke_abort', null, p_reason, 'not_active'); end if;
    update public.nuke_events set aborted_at = now() where id = p_event;
    perform public.admin_log('nuke_abort', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, null, null, 'nuke_event', p_event::text);
    return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_nuke_get() from public, anon;
revoke all on function public.admin_nuke_settings_set(int, int, int, int, boolean, int, text, text, text, text, text) from public, anon;
revoke all on function public.admin_nuke_launch(timestamptz, text, text) from public, anon;
revoke all on function public.admin_nuke_abort(uuid, text) from public, anon;
grant execute on function public.admin_nuke_get() to authenticated;
grant execute on function public.admin_nuke_settings_set(int, int, int, int, boolean, int, text, text, text, text, text) to authenticated;
grant execute on function public.admin_nuke_launch(timestamptz, text, text) to authenticated;
grant execute on function public.admin_nuke_abort(uuid, text) to authenticated;
