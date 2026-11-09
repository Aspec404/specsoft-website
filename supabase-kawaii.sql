-- ============================================================================
-- SPECSOFT® KAWAII THEME EVENT (a "theme / chill" event, live and synced for everyone)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql and supabase-nuke.sql
-- (it reuses the "event-audio" bucket and its staff policies from supabase-nuke.sql).
-- Safe to re-run.
--
--   * site_kawaii_now()        what every visitor's browser asks ("is the kawaii theme on?")
--   * Console > Events         staff: launch, schedule, abort, length, volume, sparkles, music upload
--   * Every staff change lands in the audit log (same as seasons, bans, roles ...)
--
-- No countdown, no survivors, no rewards. It is just a start time and an end time.
-- ============================================================================

-- ---------- settings (one row) ------------------------------------------------
create table if not exists public.kawaii_settings (
    id int primary key default 1 check (id = 1),
    duration_s int not null default 3600 check (duration_s between 300 and 86400),   -- 5 minutes to 24 hours
    volume int not null default 60 check (volume between 0 and 100),
    sparkles int not null default 2 check (sparkles between 0 and 3),                -- 0 = none, 3 = lots
    audio_ost text check (audio_ost is null or audio_ost ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$'),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.kawaii_settings (id) values (1) on conflict (id) do nothing;

-- ---------- events (each launch copies the settings, so later edits never change a running event) ----
create table if not exists public.kawaii_events (
    id uuid primary key default gen_random_uuid(),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    duration_s int not null,
    volume int not null default 60,
    sparkles int not null default 2,
    audio_ost text,
    aborted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index if not exists kawaii_events_start_idx on public.kawaii_events (starts_at desc);

-- nobody reads or writes these tables directly: only the functions below
alter table public.kawaii_settings enable row level security;
alter table public.kawaii_events enable row level security;

-- ---------- public: is the theme on? -------------------------------------------
-- Returns the running event, or one that starts within the hour.
create or replace function public.site_kawaii_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.kawaii_events;
begin
    select * into e from public.kawaii_events x
     where x.aborted_at is null
       and x.ends_at > now()
       and x.starts_at < now() + interval '1 hour'
     order by x.starts_at asc
     limit 1;
    if not found then return json_build_object('now', now(), 'event', null); end if;
    return json_build_object('now', now(), 'event', json_build_object(
        'id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'duration_s', e.duration_s, 'volume', e.volume, 'sparkles', e.sparkles,
        'audio', json_build_object('ost', e.audio_ost)));
end $$;

-- ---------- staff: read everything for Console > Events > Kawaii ---------------
create or replace function public.admin_kawaii_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'kawaii_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true, 'now', now(),
        'settings', (select to_jsonb(s) from public.kawaii_settings s where s.id = 1),
        'events', coalesce((
            select jsonb_agg(to_jsonb(x) order by x.starts_at desc)
              from (select e.* from public.kawaii_events e order by e.starts_at desc limit 15) x
        ), '[]'::jsonb));
end $$;

-- ---------- staff: length, volume, sparkles, music -----------------------------
create or replace function public.admin_kawaii_settings_set(p_cfg jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb;
        v_dur int; v_vol int; v_spk int; v_ost text;
        v_re text := '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$';
begin
    v_err := public.admin_gate('admin', 'kawaii_settings_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_value'); end if;

    begin
        v_dur := (p_cfg->>'duration_s')::int;
        v_vol := (p_cfg->>'volume')::int;
        v_spk := (p_cfg->>'sparkles')::int;
    exception when others then
        return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_value');
    end;
    v_ost := nullif(p_cfg->'audio'->>'ost', '');

    if v_dur is null or v_dur not between 300 and 86400 then return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_duration'); end if;
    if v_vol is null or v_vol not between 0 and 100 then return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_volume'); end if;
    if v_spk is null or v_spk not between 0 and 3 then return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_sparkles'); end if;
    if v_ost is not null and v_ost !~ v_re then return public.admin_fail('kawaii_settings_set', null, p_reason, 'bad_audio_url'); end if;

    select to_jsonb(s) into v_before from public.kawaii_settings s where s.id = 1;
    update public.kawaii_settings
       set duration_s = v_dur, volume = v_vol, sparkles = v_spk, audio_ost = v_ost,
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.kawaii_settings s where s.id = 1;
    perform public.admin_log('kawaii_settings_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: launch (now = starts in 30 seconds so every open page can catch it) -----
create or replace function public.admin_kawaii_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.kawaii_settings; t0 timestamptz; e public.kawaii_events;
begin
    v_err := public.admin_gate('admin', 'kawaii_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.kawaii_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '30 seconds');
    if t0 < now() + interval '10 seconds' then return public.admin_fail('kawaii_launch', null, p_reason, 'bad_time'); end if;
    -- only one kawaii event at a time (it can run next to other events)
    if exists (select 1 from public.kawaii_events x
                where x.aborted_at is null
                  and x.ends_at > t0
                  and x.starts_at < t0 + make_interval(secs => s.duration_s)) then
        return public.admin_fail('kawaii_launch', null, p_reason, 'event_overlap');
    end if;
    insert into public.kawaii_events (label, starts_at, ends_at, duration_s, volume, sparkles, audio_ost, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t0 + make_interval(secs => s.duration_s),
            s.duration_s, s.volume, s.sparkles, s.audio_ost, auth.uid())
    returning * into e;
    perform public.admin_log('kawaii_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'kawaii_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;

-- ---------- staff: abort (every browser tidies itself within seconds) ------------
create or replace function public.admin_kawaii_abort(p_event uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'kawaii_abort');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.kawaii_events x where x.id = p_event and x.aborted_at is null and x.ends_at > now();
    if v_before is null then return public.admin_fail('kawaii_abort', null, p_reason, 'not_active'); end if;
    update public.kawaii_events set aborted_at = now() where id = p_event;
    perform public.admin_log('kawaii_abort', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, null, null, 'kawaii_event', p_event::text);
    return jsonb_build_object('ok', true);
end $$;

grant execute on function public.site_kawaii_now() to anon, authenticated;
revoke all on function public.admin_kawaii_get() from public, anon;
revoke all on function public.admin_kawaii_settings_set(jsonb, text) from public, anon;
revoke all on function public.admin_kawaii_launch(timestamptz, text, text) from public, anon;
revoke all on function public.admin_kawaii_abort(uuid, text) from public, anon;
grant execute on function public.admin_kawaii_get() to authenticated;
grant execute on function public.admin_kawaii_settings_set(jsonb, text) to authenticated;
grant execute on function public.admin_kawaii_launch(timestamptz, text, text) to authenticated;
grant execute on function public.admin_kawaii_abort(uuid, text) to authenticated;
