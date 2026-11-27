-- ============================================================================
-- SPECSOFT® Turkey Hunt (Thanksgiving)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql, supabase-profiles.sql and
-- supabase-seasons.sql. Safe to re-run.
--
--   * Hidden turkeys on every hunt page (only while the Thanksgiving theme is on)
--   * Normal turkey = 10 points, GOLDEN turkey (every 4th one on a page) = 50 points
--   * Every find is counted by the SERVER, one time per turkey per person
--   * turkey_leaderboard()  Top Hunters + your own rank
--   * Console > Seasons > Turkey hunt   on/off, hunt pages, turkeys per page, start a new hunt
--   * Every change by staff lands in the audit log
-- ============================================================================

-- ---------- settings (one row) ---------------------------------------------
create table if not exists public.site_turkey_settings (
    id int primary key default 1 check (id = 1),
    enabled boolean not null default true,
    hunt text not null default 'tg2026' check (hunt ~ '^[a-z0-9_-]{3,24}$'),     -- the leaderboard belongs to one hunt; a new key = a fresh hunt
    pages text[] not null default array['index', 'chats', 'projects', 'store'],  -- file name without .html, same keys as the Glitchware hunt
    density int not null default 4 check (density between 1 and 10),             -- turkeys hidden on EACH hunt page
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null,
    check (cardinality(pages) between 1 and 30)
);
insert into public.site_turkey_settings (id) values (1) on conflict (id) do nothing;

-- ---------- every turkey somebody caught -------------------------------------
create table if not exists public.turkey_finds (
    hunt text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    page text not null check (page ~ '^[a-z0-9_-]{1,32}$'),
    idx int not null check (idx between 0 and 9),
    points int not null check (points > 0),
    found_at timestamptz not null default now(),
    primary key (hunt, user_id, page, idx)                                       -- one catch per turkey per person
);
create index if not exists turkey_finds_hunt_idx on public.turkey_finds (hunt, found_at);

-- nobody reads these tables directly: only the functions below
alter table public.site_turkey_settings enable row level security;
alter table public.turkey_finds enable row level security;

-- ---------- points per turkey: MUST match valueOf() in turkey-hunt.js -----------
create or replace function public.turkey_value(p_idx int)
returns int language sql immutable as $$ select case when p_idx % 4 = 3 then 50 else 10 end $$;

-- ---------- public: is the hunt on, where, how many? ----------------------------
create or replace function public.site_turkey_now()
returns json language sql stable security definer set search_path = public as $$
    select json_build_object('enabled', s.enabled, 'hunt', s.hunt, 'pages', to_json(s.pages), 'density', s.density,
                             'v', extract(epoch from s.updated_at)::bigint)
      from public.site_turkey_settings s where s.id = 1
$$;

-- ---------- member: catch a turkey ----------------------------------------------
create or replace function public.turkey_collect(p_page text, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.site_turkey_settings;
    last_at timestamptz;
    ins int;
    v_cnt int;
    v_pts int;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.site_turkey_settings where id = 1;
    if not found or not s.enabled then raise exception 'hunt_off'; end if;
    if p_page is null or not (p_page = any (s.pages)) then raise exception 'bad_page'; end if;
    if p_idx is null or p_idx < 0 or p_idx >= s.density then raise exception 'bad_turkey'; end if;

    -- a real person needs a moment between two catches
    select max(f.found_at) into last_at from public.turkey_finds f where f.hunt = s.hunt and f.user_id = uid;
    if last_at is not null and clock_timestamp() - last_at < interval '350 milliseconds' then raise exception 'too_fast'; end if;

    insert into public.turkey_finds (hunt, user_id, page, idx, points, found_at)
    values (s.hunt, uid, p_page, p_idx, public.turkey_value(p_idx), clock_timestamp())
    on conflict do nothing;
    get diagnostics ins = row_count;

    select count(*)::int, coalesce(sum(f.points), 0)::int into v_cnt, v_pts
      from public.turkey_finds f where f.hunt = s.hunt and f.user_id = uid;

    return json_build_object('ok', true, 'gained', case when ins = 1 then public.turkey_value(p_idx) else 0 end,
                             'found', v_cnt, 'points', v_pts);
end $$;

-- ---------- member: what have I caught so far? -----------------------------------
create or replace function public.turkey_me()
returns json language plpgsql stable security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.site_turkey_settings;
    v_found json; v_pts int; v_cnt int;
begin
    if uid is null then return json_build_object('signed_in', false); end if;
    select * into s from public.site_turkey_settings where id = 1;
    if not found then return json_build_object('signed_in', true, 'found', '[]'::json, 'points', 0, 'count', 0); end if;
    select coalesce(json_agg(f.page || ':' || f.idx::text), '[]'::json), coalesce(sum(f.points), 0)::int, count(*)::int
      into v_found, v_pts, v_cnt
      from public.turkey_finds f where f.hunt = s.hunt and f.user_id = uid;
    return json_build_object('signed_in', true, 'found', v_found, 'points', v_pts, 'count', v_cnt);
end $$;

-- ---------- everyone: Top Hunters (+ your own rank when signed in) ------------------
create or replace function public.turkey_leaderboard(p_limit int default 20)
returns json language plpgsql stable security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.site_turkey_settings;
    v_rows json; v_hunters int; v_me json := null;
    mc int; mp int; ml timestamptz; rnk int;
begin
    select * into s from public.site_turkey_settings where id = 1;
    if not found then return json_build_object('rows', '[]'::json, 'hunters', 0, 'total', 0, 'me', null); end if;

    select coalesce(json_agg(to_json(r) order by r.rank), '[]'::json) into v_rows from (
        select row_number() over (order by t.p desc, t.l asc, t.user_id) as rank,
               pr.username,
               coalesce(nullif(pr.display_name, ''), pr.username) as name,
               pr.avatar_url as avatar,
               t.c as found,
               t.p as points,
               coalesce(t.user_id = uid, false) as is_me
          from (select f.user_id, count(*)::int as c, sum(f.points)::int as p, max(f.found_at) as l
                  from public.turkey_finds f where f.hunt = s.hunt group by f.user_id) t
          join public.profiles pr on pr.id = t.user_id
         order by t.p desc, t.l asc, t.user_id
         limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) r;

    select count(distinct f.user_id)::int into v_hunters from public.turkey_finds f where f.hunt = s.hunt;

    if uid is not null then
        select count(*)::int, coalesce(sum(f.points), 0)::int, max(f.found_at) into mc, mp, ml
          from public.turkey_finds f where f.hunt = s.hunt and f.user_id = uid;
        if mc > 0 then
            select 1 + count(*)::int into rnk
              from (select f.user_id, sum(f.points) as p, max(f.found_at) as l
                      from public.turkey_finds f where f.hunt = s.hunt group by f.user_id) t
             where t.p > mp or (t.p = mp and t.l < ml);
            v_me := json_build_object('found', mc, 'points', mp, 'rank', rnk);
        else
            v_me := json_build_object('found', 0, 'points', 0, 'rank', null);
        end if;
    end if;

    return json_build_object('rows', v_rows, 'hunters', v_hunters, 'total', cardinality(s.pages) * s.density, 'me', v_me);
end $$;

-- ---------- staff: read everything for the Turkey hunt panel -------------------------
create or replace function public.admin_turkey_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.site_turkey_settings;
begin
    v_err := public.admin_gate('admin', 'turkey_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.site_turkey_settings where id = 1;
    return jsonb_build_object(
        'ok', true,
        'settings', to_jsonb(s),
        'stats', (select jsonb_build_object('hunters', count(distinct f.user_id), 'finds', count(*), 'points', coalesce(sum(f.points), 0))
                    from public.turkey_finds f where f.hunt = s.hunt),
        'top', coalesce((select jsonb_agg(x) from (
                    select pr.username as username, count(*)::int as found, sum(f.points)::int as points
                      from public.turkey_finds f join public.profiles pr on pr.id = f.user_id
                     where f.hunt = s.hunt
                     group by pr.username
                     order by sum(f.points) desc, max(f.found_at) asc
                     limit 5) x), '[]'::jsonb)
    );
end $$;

-- ---------- staff: on/off, hunt pages, turkeys per page ---------------------------------
create or replace function public.admin_turkey_set(p_enabled boolean, p_pages text[], p_density int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb; v_pages text[];
begin
    v_err := public.admin_gate('admin', 'turkey_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

    select array_agg(distinct lower(btrim(x))) into v_pages from unnest(coalesce(p_pages, '{}'::text[])) as x where btrim(x) <> '';
    if v_pages is null or cardinality(v_pages) < 1 or cardinality(v_pages) > 30 then return public.admin_fail('turkey_set', null, p_reason, 'bad_pages'); end if;
    if exists (select 1 from unnest(v_pages) as x where x !~ '^[a-z0-9_-]{1,32}$') then return public.admin_fail('turkey_set', null, p_reason, 'bad_pages'); end if;
    if p_density is null or p_density < 1 or p_density > 10 then return public.admin_fail('turkey_set', null, p_reason, 'bad_density'); end if;

    select to_jsonb(s) into v_before from public.site_turkey_settings s where s.id = 1;
    update public.site_turkey_settings
       set enabled = coalesce(p_enabled, enabled), pages = v_pages, density = p_density,
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.site_turkey_settings s where s.id = 1;

    perform public.admin_log('turkey_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: start a brand new hunt (fresh leaderboard, old finds are kept in the table) ----
create or replace function public.admin_turkey_reset(p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb;
begin
    v_err := public.admin_gate('admin', 'turkey_reset');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

    select to_jsonb(s) into v_before from public.site_turkey_settings s where s.id = 1;
    update public.site_turkey_settings
       set hunt = 't' || to_char(clock_timestamp(), 'YYMMDDHH24MISS'), updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.site_turkey_settings s where s.id = 1;

    perform public.admin_log('turkey_reset', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- who may call what -------------------------------------------------------------
revoke all on function public.site_turkey_now() from public;
revoke all on function public.turkey_collect(text, int) from public, anon;
revoke all on function public.turkey_me() from public, anon;
revoke all on function public.turkey_leaderboard(int) from public;
revoke all on function public.admin_turkey_get() from public, anon;
revoke all on function public.admin_turkey_set(boolean, text[], int, text) from public, anon;
revoke all on function public.admin_turkey_reset(text) from public, anon;

grant execute on function public.site_turkey_now() to anon, authenticated;
grant execute on function public.turkey_leaderboard(int) to anon, authenticated;
grant execute on function public.turkey_collect(text, int) to authenticated;
grant execute on function public.turkey_me() to authenticated;
grant execute on function public.admin_turkey_get() to authenticated;
grant execute on function public.admin_turkey_set(boolean, text[], int, text) to authenticated;
grant execute on function public.admin_turkey_reset(text) to authenticated;
