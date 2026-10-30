-- ============================================================================
-- SPECSOFT® Seasonal themes (Halloween, Christmas, ...)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql. Safe to re-run.
--
--   * site_theme_now()   what every visitor's browser asks ("which theme is on right now?")
--   * Console > Seasons  the staff screen: automatic by date, force a theme, or turn it all off
--   * Every change by staff lands in the audit log (same as bans, roles, etc.)
--
-- Default mode is AUTOMATIC: the schedule below switches themes on and off by itself,
-- so Halloween turns on tonight without anyone touching anything.
-- ============================================================================

-- ---------- settings (one row) ---------------------------------------------
create table if not exists public.site_season_settings (
    id int primary key default 1 check (id = 1),
    mode text not null default 'auto' check (mode in ('auto', 'off', 'theme')),   -- auto = follow the schedule
    forced_theme text check (forced_theme is null or forced_theme ~ '^[a-z]{3,20}$'),
    effects boolean not null default true,                                        -- particles, bats, snow, ...
    intensity text not null default 'normal' check (intensity in ('low', 'normal', 'high')),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.site_season_settings (id) values (1) on conflict (id) do nothing;

-- ---------- schedule ---------------------------------------------------------
create table if not exists public.site_season_schedule (
    id uuid primary key default gen_random_uuid(),
    theme text not null check (theme ~ '^[a-z]{3,20}$'),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index if not exists site_season_schedule_range_idx on public.site_season_schedule (starts_at, ends_at);

-- nobody reads these tables directly: only the functions below
alter table public.site_season_settings enable row level security;
alter table public.site_season_schedule enable row level security;

-- ---------- public: which theme is on? ---------------------------------------
create or replace function public.site_theme_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare
    s public.site_season_settings;
    sch record;
    th text := null;
    ends timestamptz := null;
    src text := 'none';
begin
    select * into s from public.site_season_settings where id = 1;
    if s.mode = 'theme' then
        th := s.forced_theme; src := 'manual';
    elsif s.mode = 'auto' then
        select x.theme, x.ends_at into sch
          from public.site_season_schedule x
         where x.enabled and now() between x.starts_at and x.ends_at
         order by x.starts_at desc limit 1;
        if found then th := sch.theme; ends := sch.ends_at; src := 'schedule'; end if;
    end if;
    return json_build_object('theme', th, 'source', src, 'mode', s.mode, 'effects', s.effects,
                             'intensity', s.intensity, 'ends_at', ends, 'v', extract(epoch from s.updated_at)::bigint);
end $$;

grant execute on function public.site_theme_now() to anon, authenticated;

-- ---------- staff: read everything for the Seasons screen --------------------
create or replace function public.admin_seasons_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'seasons_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true,
        'settings', (select to_jsonb(s) from public.site_season_settings s where s.id = 1),
        'schedule', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.site_season_schedule x), '[]'::jsonb),
        'now', public.site_theme_now()::jsonb
    );
end $$;

-- ---------- staff: mode / forced theme / effects / intensity ------------------
create or replace function public.admin_seasons_set(p_mode text, p_theme text, p_effects boolean, p_intensity text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb;
begin
    v_err := public.admin_gate('admin', 'seasons_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_mode not in ('auto', 'off', 'theme') then return public.admin_fail('seasons_set', null, p_reason, 'bad_mode'); end if;
    if p_mode = 'theme' and (p_theme is null or p_theme !~ '^[a-z]{3,20}$') then return public.admin_fail('seasons_set', null, p_reason, 'bad_theme'); end if;
    if p_intensity not in ('low', 'normal', 'high') then return public.admin_fail('seasons_set', null, p_reason, 'bad_intensity'); end if;

    select to_jsonb(s) into v_before from public.site_season_settings s where s.id = 1;
    update public.site_season_settings
       set mode = p_mode,
           forced_theme = case when p_mode = 'theme' then p_theme else forced_theme end,
           effects = coalesce(p_effects, effects),
           intensity = p_intensity,
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.site_season_settings s where s.id = 1;

    perform public.admin_log('seasons_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: add or edit a scheduled event ------------------------------
create or replace function public.admin_seasons_schedule_save(p_id uuid, p_theme text, p_label text, p_starts timestamptz, p_ends timestamptz, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_row public.site_season_schedule;
begin
    v_err := public.admin_gate('admin', 'seasons_schedule_save');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    if p_theme is null or p_theme !~ '^[a-z]{3,20}$' then return public.admin_fail('seasons_schedule_save', null, null, 'bad_theme'); end if;
    if p_starts is null or p_ends is null or p_ends <= p_starts then return public.admin_fail('seasons_schedule_save', null, null, 'bad_dates'); end if;

    if p_id is null then
        insert into public.site_season_schedule (theme, label, starts_at, ends_at, enabled)
        values (p_theme, nullif(left(btrim(coalesce(p_label, '')), 60), ''), p_starts, p_ends, coalesce(p_enabled, true))
        returning * into v_row;
        perform public.admin_log('seasons_schedule_save', null, null, true, null, to_jsonb(v_row), null, 'season_event', v_row.id::text);
    else
        select to_jsonb(x) into v_before from public.site_season_schedule x where x.id = p_id;
        if v_before is null then return public.admin_fail('seasons_schedule_save', null, null, 'not_found'); end if;
        update public.site_season_schedule
           set theme = p_theme, label = nullif(left(btrim(coalesce(p_label, '')), 60), ''),
               starts_at = p_starts, ends_at = p_ends, enabled = coalesce(p_enabled, enabled)
         where id = p_id returning * into v_row;
        perform public.admin_log('seasons_schedule_save', null, null, true, v_before, to_jsonb(v_row), null, 'season_event', v_row.id::text);
    end if;
    return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_seasons_schedule_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'seasons_schedule_delete');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.site_season_schedule x where x.id = p_id;
    if v_before is null then return public.admin_fail('seasons_schedule_delete', null, null, 'not_found'); end if;
    delete from public.site_season_schedule where id = p_id;
    perform public.admin_log('seasons_schedule_delete', null, null, true, v_before, null, null, 'season_event', p_id::text);
    return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_seasons_get() from public, anon;
revoke all on function public.admin_seasons_set(text, text, boolean, text, text) from public, anon;
revoke all on function public.admin_seasons_schedule_save(uuid, text, text, timestamptz, timestamptz, boolean) from public, anon;
revoke all on function public.admin_seasons_schedule_delete(uuid) from public, anon;
grant execute on function public.admin_seasons_get() to authenticated;
grant execute on function public.admin_seasons_set(text, text, boolean, text, text) to authenticated;
grant execute on function public.admin_seasons_schedule_save(uuid, text, text, timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.admin_seasons_schedule_delete(uuid) to authenticated;

-- ---------- starter schedule (times are Philippine time, UTC+8) ----------------
insert into public.site_season_schedule (theme, label, starts_at, ends_at)
select * from (values
    ('halloween', 'Halloween 2026',  timestamptz '2026-10-25 00:00:00+08', timestamptz '2026-11-02 00:00:00+08'),
    ('christmas', 'Christmas 2026',  timestamptz '2026-12-01 00:00:00+08', timestamptz '2026-12-27 00:00:00+08'),
    ('newyear',   'New Year 2027',   timestamptz '2026-12-30 00:00:00+08', timestamptz '2027-01-03 00:00:00+08'),
    ('valentine', 'Valentine''s 2027', timestamptz '2027-02-10 00:00:00+08', timestamptz '2027-02-16 00:00:00+08')
) as v(theme, label, starts_at, ends_at)
where not exists (select 1 from public.site_season_schedule);
