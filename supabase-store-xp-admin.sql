-- ============================================================================
-- SPECSOFT® Store: XP + quest ADMIN tools  (Phase 3)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-quests.sql. Safe to re-run.
--
-- What it adds
--   * store_admin_grant_xp(...)    give or remove XP (admins only), with a log
--   * store_admin_xp_lookup(...)   see a member's level / XP / credits before you change anything
--   * quest_admin_live()           which quests are on the boards right now (for the LIVE badges)
--   * quest_admin_stats()          how many people started / claimed each quest
--   * quest_epoch + quest_seed     the NORMAL quest board now has its own timer (no longer shared with the
--                                  featured-items rotation), and "Shuffle boards" in the manager works
--
-- One-time effect: the normal board's internal id changes, so whoever is mid-way through the current
-- normal board starts that one board again. Daily and weekly boards are not affected.
-- ============================================================================

alter table public.store_settings add column if not exists quest_epoch timestamptz not null default '2026-01-01 00:00:00+00';
alter table public.store_settings add column if not exists quest_seed int not null default 0;

-- ---------- XP log (admin grants) ---------------------------------------------------
create table if not exists public.xp_log (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    delta bigint not null,
    reason text not null default '',
    by_admin uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists xp_log_created_idx on public.xp_log (created_at desc);
alter table public.xp_log enable row level security;
drop policy if exists xp_log_admin on public.xp_log;
create policy xp_log_admin on public.xp_log for select to authenticated using (public.store_is_admin());

-- ---------- normal board: own timer, own shuffle seed ---------------------------------
create or replace function public.quest_window(p_kind text)
returns table (wkey text, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare s public.store_settings; n bigint;
begin
    select * into s from public.store_settings where id = 1;
    if p_kind = 'daily' then
        return query select 'd' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
                            (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC';
    elsif p_kind = 'weekly' then
        return query select 'w' || to_char(date_trunc('week', now() at time zone 'UTC'), 'YYYY-MM-DD'),
                            (date_trunc('week', now() at time zone 'UTC') + interval '7 days') at time zone 'UTC';
    else
        n := greatest(floor(extract(epoch from (now() - s.quest_epoch)) / (s.quest_normal_hours * 3600.0)), 0);
        -- the epoch is part of the key, so "refresh now" can never reuse an old, already-claimed board id
        return query select 'n' || floor(extract(epoch from s.quest_epoch))::bigint::text || '.' || n::text,
                            s.quest_epoch + ((n + 1) * s.quest_normal_hours) * interval '1 hour';
    end if;
end $$;

create or replace function public.quest_board_ids(p_kind text)
returns table (quest_id uuid, wkey text, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
    with w as (
        select q.wkey, q.ends_at,
               (select case when ss.quest_seed = 0 then '' else ss.quest_seed::text end
                  from public.store_settings ss where ss.id = 1) as seed
          from public.quest_window(p_kind) q
    ),
    ranked as (
        select d.id, row_number() over (partition by d.difficulty order by md5(d.id::text || w.wkey || w.seed)) as rn
          from public.quest_defs d cross join w
         where d.active and d.kind = p_kind
    ),
    firsts as (select r.id from ranked r where r.rn = 1),
    extras as (
        select r.id from ranked r cross join w
         where r.rn > 1
         order by md5(r.id::text || w.wkey || w.seed)
         limit greatest(3 - (select count(*) from firsts), 0)
    )
    select x.id, w.wkey, w.ends_at from (select id from firsts union all select id from extras) x cross join w;
$$;

-- ---------- give / remove XP ----------------------------------------------------------
create or replace function public.store_admin_grant_xp(p_username text, p_amount int, p_reason text default '')
returns json language plpgsql security definer set search_path = public as $$
declare
    target uuid; uname text; why text;
    s public.store_settings; u public.user_xp;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'bad_amount'; end if;

    select id, username into target, uname from public.profiles
     where lower(username) = lower(trim(coalesce(p_username, ''))) limit 1;
    if target is null then raise exception 'user_not_found'; end if;

    why := coalesce(nullif(left(trim(coalesce(p_reason, '')), 80), ''),
                    case when p_amount > 0 then 'Granted by staff' else 'Removed by staff' end);

    insert into public.user_xp (user_id, xp) values (target, greatest(p_amount, 0))
    on conflict (user_id) do update set xp = greatest(0, public.user_xp.xp + p_amount), updated_at = now();

    insert into public.xp_log (user_id, delta, reason, by_admin) values (target, p_amount, why, auth.uid());

    -- tell the member (only if the moderation notices table exists)
    if p_amount > 0 and to_regclass('public.user_notices') is not null then
        begin
            execute 'insert into public.user_notices (user_id, kind, title, body) values ($1, ''info'', $2, $3)'
               using target, 'You received ' || p_amount || ' XP', why;
        exception when others then null;
        end;
    end if;

    select * into u from public.user_xp where user_id = target;
    select * into s from public.store_settings where id = 1;
    return json_build_object('username', uname, 'xp', public.xp_pack(u, s, 0));
end $$;

create or replace function public.store_admin_xp_lookup(p_username text)
returns json language plpgsql security definer set search_path = public as $$
declare
    target uuid; uname text; dname text; bal bigint;
    s public.store_settings; u public.user_xp;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    select id, username, display_name into target, uname, dname from public.profiles
     where lower(username) = lower(trim(coalesce(p_username, ''))) limit 1;
    if target is null then raise exception 'user_not_found'; end if;

    select * into u from public.user_xp where user_id = target;
    if not found then u.user_id := target; u.xp := 0; u.day_xp := 0; end if;
    select * into s from public.store_settings where id = 1;
    select w.balance into bal from public.apex_wallets w where w.user_id = target;

    return json_build_object('username', uname, 'display_name', dname,
                             'xp', public.xp_pack(u, s, 0), 'balance', coalesce(bal, 0));
end $$;

-- ---------- quest manager helpers -------------------------------------------------------
create or replace function public.quest_admin_live()
returns table (quest_id uuid, kind text, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    return query
        select b.quest_id, 'normal'::text, b.ends_at from public.quest_board_ids('normal') b
        union all
        select b.quest_id, 'daily'::text, b.ends_at from public.quest_board_ids('daily') b
        union all
        select b.quest_id, 'weekly'::text, b.ends_at from public.quest_board_ids('weekly') b;
end $$;

create or replace function public.quest_admin_stats()
returns table (quest_id uuid, started bigint, claims bigint, claims_7d bigint)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    return query
        select p.quest_id,
               count(*)::bigint,
               (count(*) filter (where p.claimed))::bigint,
               (count(*) filter (where p.claimed and p.claimed_at > now() - interval '7 days'))::bigint
          from public.quest_progress p
         group by p.quest_id;
end $$;

-- ---------- permissions -------------------------------------------------------------------
grant execute on function public.store_admin_grant_xp(text, int, text) to authenticated;
grant execute on function public.store_admin_xp_lookup(text) to authenticated;
grant execute on function public.quest_admin_live() to authenticated;
grant execute on function public.quest_admin_stats() to authenticated;
