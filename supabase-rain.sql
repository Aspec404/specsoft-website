-- ============================================================================
-- SPECSOFT® RAIN THEME EVENT (a "theme / chill" event, live and synced for everyone)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql. Safe to re-run.
--
--   * site_rain_now()        what every visitor's browser asks ("is the rain on?")
--   * Console > Events > Rain  staff: launch, schedule, abort, length, what rains, intensity ...
--   * Every staff change lands in the audit log (same as the other events)
--
-- No countdown, no rewards, no audio files: sound is generated in the browser.
-- A running event keeps the settings it was launched with, later edits never change it.
-- ============================================================================

-- ---------- settings (one row) ------------------------------------------------
create table if not exists public.rain_settings (
    id int primary key default 1 check (id = 1),
    duration_s int not null default 3600 check (duration_s between 300 and 86400),   -- 5 min to 24 h
    kind text not null default 'rain' check (kind in ('rain', 'red', 'credits')),    -- what falls (visitors can switch for themselves)
    intensity int not null default 2 check (intensity between 1 and 3),              -- 1 drizzle, 2 steady, 3 storm
    lightning boolean not null default true,
    flashlight boolean not null default true,                                        -- the page is dark, the cursor lights a circle
    glass boolean not null default true,                                             -- water beads sliding down the screen
    volume int not null default 60 check (volume between 0 and 100),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.rain_settings (id) values (1) on conflict (id) do nothing;

-- ---------- events (each launch copies the settings) ---------------------------
create table if not exists public.rain_events (
    id uuid primary key default gen_random_uuid(),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    duration_s int not null,
    kind text not null default 'rain' check (kind in ('rain', 'red', 'credits')),
    intensity int not null default 2,
    lightning boolean not null default true,
    flashlight boolean not null default true,
    glass boolean not null default true,
    volume int not null default 60,
    aborted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index if not exists rain_events_start_idx on public.rain_events (starts_at desc);

-- nobody reads or writes these tables directly: only the functions below
alter table public.rain_settings enable row level security;
alter table public.rain_events enable row level security;

-- ---------- public: is there an event? ----------------------------------------
-- Returns the current event, or one that starts within the hour. Nothing else.
create or replace function public.site_rain_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.rain_events;
begin
    select * into e from public.rain_events x
     where x.aborted_at is null
       and x.ends_at > now()
       and x.starts_at < now() + interval '1 hour'
     order by x.starts_at asc
     limit 1;
    if not found then return json_build_object('now', now(), 'event', null); end if;
    return json_build_object('now', now(), 'event', json_build_object(
        'id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'duration_s', e.duration_s,
        'kind', e.kind, 'intensity', e.intensity, 'lightning', e.lightning, 'flashlight', e.flashlight,
        'glass', e.glass, 'volume', e.volume));
end $$;

grant execute on function public.site_rain_now() to anon, authenticated;

-- ---------- staff: read everything for Console > Events > Rain ------------------
create or replace function public.admin_rain_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'rain_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true, 'now', now(),
        'settings', (select to_jsonb(s) from public.rain_settings s where s.id = 1),
        'events', coalesce((
            select jsonb_agg(to_jsonb(x) order by x.starts_at desc)
              from (select e.* from public.rain_events e order by e.starts_at desc limit 15) x
        ), '[]'::jsonb));
end $$;

-- ---------- staff: save settings (p_cfg = { duration_s, kind, intensity, lightning, flashlight, glass, volume }) ----
create or replace function public.admin_rain_settings_set(p_cfg jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb;
        v_dur int; v_kind text; v_int int; v_vol int; v_lt boolean; v_fl boolean; v_gl boolean;
begin
    v_err := public.admin_gate('admin', 'rain_settings_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_value'); end if;

    begin
        v_dur  := (p_cfg ->> 'duration_s')::int;
        v_kind := p_cfg ->> 'kind';
        v_int  := (p_cfg ->> 'intensity')::int;
        v_vol  := (p_cfg ->> 'volume')::int;
        v_lt   := (p_cfg ->> 'lightning')::boolean;
        v_fl   := (p_cfg ->> 'flashlight')::boolean;
        v_gl   := (p_cfg ->> 'glass')::boolean;
    exception when others then
        return public.admin_fail('rain_settings_set', null, p_reason, 'bad_value');
    end;

    if v_dur is null or v_dur not between 300 and 86400 then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_duration'); end if;
    if v_kind is null or v_kind not in ('rain', 'red', 'credits') then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_kind'); end if;
    if v_int is null or v_int not between 1 and 3 then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_intensity'); end if;
    if v_vol is null or v_vol not between 0 and 100 then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_volume'); end if;
    if v_lt is null or v_fl is null or v_gl is null then return public.admin_fail('rain_settings_set', null, p_reason, 'bad_value'); end if;

    select to_jsonb(s) into v_before from public.rain_settings s where s.id = 1;
    update public.rain_settings
       set duration_s = v_dur, kind = v_kind, intensity = v_int, lightning = v_lt, flashlight = v_fl,
           glass = v_gl, volume = v_vol, updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.rain_settings s where s.id = 1;
    perform public.admin_log('rain_settings_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: launch (now = starts in 35 seconds so every open page can catch it) -----
create or replace function public.admin_rain_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.rain_settings; t0 timestamptz; t1 timestamptz; e public.rain_events; v_busy boolean := false;
begin
    v_err := public.admin_gate('admin', 'rain_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.rain_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '35 seconds');
    if t0 < now() + interval '10 seconds' then return public.admin_fail('rain_launch', null, p_reason, 'bad_time'); end if;
    t1 := t0 + make_interval(secs => s.duration_s);

    -- no overlap with another rain event ...
    if exists (select 1 from public.rain_events x
                where x.aborted_at is null and x.ends_at > t0 and x.starts_at < t1) then
        return public.admin_fail('rain_launch', null, p_reason, 'event_overlap');
    end if;
    -- ... or with the other theme / chill events (only checked when those tables exist)
    if to_regclass('public.kawaii_events') is not null then
        execute 'select exists (select 1 from public.kawaii_events x where x.aborted_at is null and x.ends_at > $1 and x.starts_at < $2)'
            into v_busy using t0, t1;
        if v_busy then return public.admin_fail('rain_launch', null, p_reason, 'event_overlap'); end if;
    end if;
    if to_regclass('public.thethe_events') is not null then
        execute 'select exists (select 1 from public.thethe_events x where x.aborted_at is null and x.ends_at > $1 and x.starts_at < $2)'
            into v_busy using t0, t1;
        if v_busy then return public.admin_fail('rain_launch', null, p_reason, 'event_overlap'); end if;
    end if;

    insert into public.rain_events (label, starts_at, ends_at, duration_s, kind, intensity, lightning, flashlight, glass, volume, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t1, s.duration_s, s.kind, s.intensity, s.lightning, s.flashlight, s.glass, s.volume, auth.uid())
    returning * into e;
    perform public.admin_log('rain_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'rain_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;

-- ---------- staff: abort (every browser tidies itself within seconds) ------------
create or replace function public.admin_rain_abort(p_event uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'rain_abort');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.rain_events x where x.id = p_event and x.aborted_at is null and x.ends_at > now();
    if v_before is null then return public.admin_fail('rain_abort', null, p_reason, 'not_active'); end if;
    update public.rain_events set aborted_at = now() where id = p_event;
    perform public.admin_log('rain_abort', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, null, null, 'rain_event', p_event::text);
    return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_rain_get() from public, anon;
revoke all on function public.admin_rain_settings_set(jsonb, text) from public, anon;
revoke all on function public.admin_rain_launch(timestamptz, text, text) from public, anon;
revoke all on function public.admin_rain_abort(uuid, text) from public, anon;
grant execute on function public.admin_rain_get() to authenticated;
grant execute on function public.admin_rain_settings_set(jsonb, text) to authenticated;
grant execute on function public.admin_rain_launch(timestamptz, text, text) to authenticated;
grant execute on function public.admin_rain_abort(uuid, text) to authenticated;
