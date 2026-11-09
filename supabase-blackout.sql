-- ============================================================================
-- SPECSOFT® BLACKOUT EVENT (live, synced for everyone, global multiplayer)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-admin.sql, supabase-store.sql,
-- supabase-store-quests.sql and supabase-nuke.sql (it reuses the event-audio bucket). Safe to re-run.
--
--   * site_blackout_now()      what every visitor's browser asks ("is there a blackout?")
--   * blackout_join / blackout_live / blackout_gen_start / blackout_gen_finish / blackout_claim
--                              members only. The SERVER decides: which pages hold YOUR generators,
--                              who got hit by the red light, who is terminated, when the grid is back.
--   * blackout_report()        the ending screen list
--   * Console > Events > Blackout   staff: launch, schedule, abort, settings, audio uploads
--   * Every staff change lands in the audit log (same as nuke, glitchware, seasons ...)
--
-- How it plays
--   * The whole site goes dark. Each member gets their OWN random list of pages (their route);
--     one generator is hidden on each of those pages, one at a time, in that order.
--   * Fixing generators raises ONE shared counter (goal is set in the console, default 50).
--   * Red lights glow on random pages on a schedule every browser can compute (blackout_red below, and
--     redInfo() in blackout-event.js MUST stay identical). Staying on a page in its strong red stage for
--     red_kill_s seconds = terminated: locked out until the event ends (chat and spectating stay open).
--   * Reaching the goal restores power: everybody wins. Rewards are paid HERE in the database.
-- ============================================================================

-- ---------- settings (one row) ------------------------------------------------
create table if not exists public.blackout_settings (
    id int primary key default 1 check (id = 1),
    duration_s int not null default 600 check (duration_s between 120 and 3600),
    goal int not null default 50 check (goal between 1 and 5000),
    per_player_max int not null default 4 check (per_player_max between 1 and 30),
    red_level int not null default 3 check (red_level between 1 and 5),
    red_kill_s int not null default 5 check (red_kill_s between 2 and 15),
    hint_after_s int not null default 120 check (hint_after_s between 0 and 1800),
    fix_cooldown_s int not null default 15 check (fix_cooldown_s between 0 and 300),
    pages text[] not null default array['index','projects','community','spectra-ai','settings'] check (cardinality(pages) between 2 and 30),
    reward_gen_xp int not null default 0 check (reward_gen_xp between 0 and 1000000),
    reward_gen_ac int not null default 0 check (reward_gen_ac between 0 and 1000000),
    reward_win_xp int not null default 0 check (reward_win_xp between 0 and 1000000),
    reward_win_ac int not null default 0 check (reward_win_ac between 0 and 1000000),
    volume int not null default 80 check (volume between 0 and 100),
    audio_ost text, audio_danger text, audio_gen text, audio_dead text, audio_win text, audio_fail text,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
insert into public.blackout_settings (id) values (1) on conflict (id) do nothing;

-- ---------- events (each launch copies the settings, so later edits never change a running event) ----
create table if not exists public.blackout_events (
    id uuid primary key default gen_random_uuid(),
    label text check (label is null or char_length(label) <= 60),
    starts_at timestamptz not null,          -- lights out
    ends_at timestamptz not null,            -- time is up (moved forward when the goal is reached)
    duration_s int not null,
    goal int not null,
    per_player_max int not null,
    red_level int not null,
    red_kill_s int not null,
    hint_after_s int not null,
    fix_cooldown_s int not null,
    pages text[] not null,
    seed int not null,                       -- makes the red light schedule the same for every browser
    reward_gen_xp int not null default 0, reward_gen_ac int not null default 0,
    reward_win_xp int not null default 0, reward_win_ac int not null default 0,
    volume int not null default 80,
    audio_ost text, audio_danger text, audio_gen text, audio_dead text, audio_win text, audio_fail text,
    won_at timestamptz,                      -- set by the server when the shared counter reached the goal
    aborted_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index if not exists blackout_events_start_idx on public.blackout_events (starts_at desc);

create table if not exists public.blackout_participants (
    event_id uuid not null references public.blackout_events(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    route text[] not null default '{}',      -- THIS player's generator pages, in order (different for everybody)
    fixed int not null default 0,
    points int not null default 0,
    last_fix_at timestamptz,
    gen_started_at timestamptz,
    gen_page text,
    exposure numeric not null default 0,     -- seconds spent in strong red light (decays when safe)
    last_ping timestamptz,
    last_page text,
    dead_at timestamptz,
    win_claimed_at timestamptz,
    primary key (event_id, user_id)
);
create index if not exists blackout_participants_score_idx on public.blackout_participants (event_id, points desc);

-- nobody reads or writes these tables directly: only the functions below
alter table public.blackout_settings enable row level security;
alter table public.blackout_events enable row level security;
alter table public.blackout_participants enable row level security;

-- ---------- the red light schedule (pure maths, no table) ----------------------
-- 0 = no red, 1 = faint glow, 2 = flicker, 3 = STRONG (this is the only stage that counts as exposure).
-- Every cycle a new set of pages turns hot. The first 25 seconds are a grace period.
-- Must match redInfo() in blackout-event.js exactly (same hash, same cycle, same stages).
create or replace function public.blackout_red(p_seed int, p_pages text[], p_t numeric, p_level int, p_dur int, p_page text)
returns int language plpgsql immutable set search_path = public as $$
declare n int := coalesce(cardinality(p_pages), 0); idx int; cyc int; tt numeric; slot bigint; u numeric; nhot int; rnk int; mine bigint;
begin
    if n < 2 or p_page is null then return 0; end if;
    idx := array_position(p_pages, p_page);
    if idx is null then return 0; end if;
    tt := p_t - 25;
    if tt < 0 or p_t >= p_dur then return 0; end if;
    cyc := 30 - 3 * p_level;
    slot := floor(tt / cyc);
    u := (tt - slot * cyc) / cyc;
    nhot := 1 + (case when p_level >= 3 then 1 else 0 end) + (case when p_level >= 5 then 1 else 0 end) + (case when p_t >= p_dur - 60 then 1 else 0 end);
    nhot := least(nhot, n - 1);
    mine := ((slot * 7919 + idx::bigint * 104729 + p_seed) * 2654435761) % 4294967296;
    select count(*) into rnk from generate_series(1, n) i
     where (((slot * 7919 + i::bigint * 104729 + p_seed) * 2654435761) % 4294967296) < mine
        or ((((slot * 7919 + i::bigint * 104729 + p_seed) * 2654435761) % 4294967296) = mine and i < idx);
    if rnk >= nhot then return 0; end if;
    return case when u < 0.25 then 1 when u < 0.5 then 2 else 3 end;
end $$;

-- ---------- public: is there an event? ----------------------------------------
create or replace function public.site_blackout_now()
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.blackout_events;
begin
    select * into e from public.blackout_events x
     where x.aborted_at is null
       and x.ends_at > now() - interval '10 minutes'
       and x.starts_at < now() + interval '1 hour'
     order by case when x.ends_at >= now() then 0 else 1 end, x.starts_at asc
     limit 1;
    if not found then return json_build_object('now', now(), 'event', null); end if;
    return json_build_object('now', now(), 'event', json_build_object(
        'id', e.id, 'label', e.label, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'won_at', e.won_at,
        'duration_s', e.duration_s, 'goal', e.goal, 'per_player_max', e.per_player_max, 'red_level', e.red_level, 'red_kill_s', e.red_kill_s,
        'hint_after_s', e.hint_after_s, 'pages', e.pages, 'seed', e.seed, 'volume', e.volume,
        'reward_gen_xp', e.reward_gen_xp, 'reward_gen_ac', e.reward_gen_ac, 'reward_win_xp', e.reward_win_xp, 'reward_win_ac', e.reward_win_ac,
        'audio', json_build_object('ost', e.audio_ost, 'danger', e.audio_danger, 'gen', e.audio_gen, 'dead', e.audio_dead, 'win', e.audio_win, 'fail', e.audio_fail)));
end $$;

-- ---------- members: join (the server rolls THEIR route of pages) ---------------
create or replace function public.blackout_join(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.blackout_events; p public.blackout_participants; r text[];
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found or now() < e.starts_at - interval '40 seconds' or now() > e.ends_at or e.won_at is not null then return json_build_object('ok', false); end if;
    select coalesce(array_agg(q.pg), '{}') into r
      from (select pg from unnest(e.pages) as pg order by random() limit least(e.per_player_max, cardinality(e.pages))) q;
    insert into public.blackout_participants (event_id, user_id, route) values (p_event, uid, r) on conflict do nothing;
    select * into p from public.blackout_participants where event_id = p_event and user_id = uid;
    return json_build_object('ok', true, 'dead', p.dead_at is not null, 'fixed', p.fixed, 'quota', cardinality(p.route));
end $$;

-- ---------- members + visitors: the live pulse -----------------------------------
-- Called every 1 to 3 seconds by every open page. For a signed-in member it also records where they are
-- and adds red light exposure (the server alone decides who is terminated). Anonymous visitors only read the totals.
create or replace function public.blackout_live(p_event uuid, p_page text default null, p_top boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.blackout_events; p public.blackout_participants;
        pg text := case when p_page ~ '^[a-z0-9_-]{1,30}$' then p_page else null end;
        t numeric; dt numeric; st int; ex numeric; here boolean := false; hint text := null; cool numeric := 0; me json := null;
        tot int; alive int; dead int; plrs int; top json := null;
begin
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
    t := extract(epoch from (now() - e.starts_at));

    if uid is not null then
        select * into p from public.blackout_participants where event_id = p_event and user_id = uid for update;
        if found then
            if pg is not null and p.dead_at is null and e.won_at is null and now() >= e.starts_at and now() < e.ends_at then
                dt := case when p.last_ping is null then 1 else least(3.0, greatest(0, extract(epoch from (now() - p.last_ping)))) end;
                st := public.blackout_red(e.seed, e.pages, t, e.red_level, e.duration_s, pg);
                ex := case when st = 3 then p.exposure + dt else greatest(0, p.exposure - dt * 1.5) end;
                update public.blackout_participants
                   set exposure = ex, last_ping = now(), last_page = pg,
                       dead_at = case when ex >= e.red_kill_s then now() else null end
                 where event_id = p_event and user_id = uid returning * into p;
            end if;
            if p.dead_at is null and p.fixed < cardinality(p.route) then
                here := (pg is not null and p.route[p.fixed + 1] = pg);
                if e.hint_after_s > 0 and now() >= coalesce(p.last_fix_at, p.joined_at) + make_interval(secs => e.hint_after_s) then hint := p.route[p.fixed + 1]; end if;
            end if;
            if p.last_fix_at is not null then cool := greatest(0, e.fix_cooldown_s - extract(epoch from (now() - p.last_fix_at))); end if;
            me := json_build_object('joined', true, 'dead', p.dead_at is not null, 'fixed', p.fixed, 'quota', cardinality(p.route), 'points', p.points,
                                    'exposure', round(p.exposure, 2), 'here', here, 'hint', hint, 'cool', round(cool, 1));
        else
            me := json_build_object('joined', false);
        end if;
    end if;

    select coalesce(sum(fixed), 0), count(*) filter (where dead_at is null), count(*) filter (where dead_at is not null), count(*)
      into tot, alive, dead, plrs from public.blackout_participants where event_id = p_event;
    if p_top then
        select coalesce(json_agg(json_build_object('u', z.username, 'fixed', z.fixed, 'pts', z.points, 'dead', z.dead, 'me', z.me) order by z.points desc, z.username), '[]'::json) into top
          from (select pr.username, bp.fixed, bp.points, (bp.dead_at is not null) as dead, (bp.user_id = uid) as me
                  from public.blackout_participants bp join public.profiles pr on pr.id = bp.user_id
                 where bp.event_id = p_event and pr.username is not null
                 order by bp.points desc, pr.username limit 10) z;
    end if;
    return json_build_object('ok', true, 'now', now(), 'ends_at', e.ends_at, 'won_at', e.won_at, 'goal', e.goal, 'fixed_total', tot,
                             'players', plrs, 'alive', alive, 'dead', dead, 'me', me, 'top', top);
end $$;

-- ---------- members: open a generator, then finish the wire puzzle --------------
create or replace function public.blackout_gen_start(p_event uuid, p_page text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.blackout_events; p public.blackout_participants;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found then raise exception 'event_not_found'; end if;
    if now() < e.starts_at or now() >= e.ends_at or e.won_at is not null then raise exception 'event_over'; end if;
    select * into p from public.blackout_participants where event_id = p_event and user_id = uid for update;
    if not found then raise exception 'not_joined'; end if;
    if p.dead_at is not null then raise exception 'terminated'; end if;
    if p.fixed >= cardinality(p.route) then raise exception 'quota_done'; end if;
    if p_page is null or p_page !~ '^[a-z0-9_-]{1,30}$' or p.route[p.fixed + 1] is distinct from p_page then raise exception 'wrong_page'; end if;
    if p.last_ping is null or p.last_ping < now() - interval '12 seconds' or p.last_page is distinct from p_page then raise exception 'no_signal'; end if;
    if p.last_fix_at is not null and extract(epoch from (now() - p.last_fix_at)) < e.fix_cooldown_s then raise exception 'cooling_down'; end if;
    update public.blackout_participants set gen_started_at = now(), gen_page = p_page where event_id = p_event and user_id = uid;
    return json_build_object('ok', true);
end $$;

-- The browser says "all 5 wires connected". The server only believes it if the generator was really opened,
-- it is the right page, and enough real time passed. Rewards are paid per generator, once each.
create or replace function public.blackout_gen_finish(p_event uuid, p_wires int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.blackout_events; p public.blackout_participants; tot int; won boolean := false; rows int := 0; bal bigint; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found then raise exception 'event_not_found'; end if;
    if now() < e.starts_at or now() >= e.ends_at or e.won_at is not null then raise exception 'event_over'; end if;
    select * into p from public.blackout_participants where event_id = p_event and user_id = uid for update;
    if not found then raise exception 'not_joined'; end if;
    if p.dead_at is not null then raise exception 'terminated'; end if;
    if p.fixed >= cardinality(p.route) then raise exception 'quota_done'; end if;
    if p.gen_started_at is null or p.gen_page is distinct from p.route[p.fixed + 1] then raise exception 'not_started'; end if;
    if coalesce(p_wires, 0) < 5 then raise exception 'not_enough_wires'; end if;
    if extract(epoch from (now() - p.gen_started_at)) < 4 then raise exception 'too_fast'; end if;   -- 5 wires in under 4 seconds is a script, not a hand

    update public.blackout_participants
       set fixed = fixed + 1, points = points + 100, last_fix_at = now(), gen_started_at = null, gen_page = null
     where event_id = p_event and user_id = uid returning * into p;

    if e.reward_gen_ac > 0 then
        insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
        update public.apex_wallets set balance = balance + e.reward_gen_ac, lifetime = lifetime + e.reward_gen_ac, updated_at = now()
         where user_id = uid returning balance into bal;
        insert into public.apex_ledger (user_id, delta, reason) values (uid, e.reward_gen_ac, 'Blackout event: generator repaired');
    else
        select balance into bal from public.apex_wallets where user_id = uid;
    end if;
    if e.reward_gen_xp > 0 then
        insert into public.user_xp (user_id, xp) values (uid, e.reward_gen_xp)
        on conflict (user_id) do update set xp = public.user_xp.xp + e.reward_gen_xp, updated_at = now();
    end if;
    select * into u from public.user_xp where user_id = uid;

    select coalesce(sum(fixed), 0) into tot from public.blackout_participants where event_id = p_event;
    if tot >= e.goal then
        update public.blackout_events set won_at = now(), ends_at = least(ends_at, now() + interval '35 seconds')
         where id = p_event and won_at is null;
        get diagnostics rows = row_count;
        won := rows > 0;
    end if;

    return json_build_object('ok', true, 'fixed', p.fixed, 'quota', cardinality(p.route), 'points', p.points, 'total', tot, 'won', won,
                             'reward_xp', e.reward_gen_xp, 'reward_ac', e.reward_gen_ac, 'balance', coalesce(bal, 0),
                             'xp', public.xp_info(coalesce(u.xp, 0)));
end $$;

-- ---------- members: the "power is back" bonus (alive, fixed at least one, once) ----
create or replace function public.blackout_claim(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.blackout_events; p public.blackout_participants; bal bigint; u public.user_xp;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found or e.won_at is null then return json_build_object('ok', false, 'error', 'not_won'); end if;
    select * into p from public.blackout_participants where event_id = p_event and user_id = uid for update;
    if not found or p.dead_at is not null or p.fixed < 1 then return json_build_object('ok', false, 'error', 'not_eligible'); end if;
    if p.win_claimed_at is not null then return json_build_object('ok', true, 'already', true); end if;
    update public.blackout_participants set win_claimed_at = now() where event_id = p_event and user_id = uid;

    if e.reward_win_ac > 0 then
        insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
        update public.apex_wallets set balance = balance + e.reward_win_ac, lifetime = lifetime + e.reward_win_ac, updated_at = now()
         where user_id = uid returning balance into bal;
        insert into public.apex_ledger (user_id, delta, reason) values (uid, e.reward_win_ac, 'Blackout event: power restored');
    else
        select balance into bal from public.apex_wallets where user_id = uid;
    end if;
    if e.reward_win_xp > 0 then
        insert into public.user_xp (user_id, xp) values (uid, e.reward_win_xp)
        on conflict (user_id) do update set xp = public.user_xp.xp + e.reward_win_xp, updated_at = now();
    end if;
    select * into u from public.user_xp where user_id = uid;
    return json_build_object('ok', true, 'reward_xp', e.reward_win_xp, 'reward_ac', e.reward_win_ac, 'balance', coalesce(bal, 0), 'xp', public.xp_info(coalesce(u.xp, 0)));
end $$;

-- ---------- the ending screen list ---------------------------------------------
create or replace function public.blackout_report(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.blackout_events;
begin
    select * into e from public.blackout_events where id = p_event and aborted_at is null;
    if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
    if now() < e.ends_at then return json_build_object('ok', false, 'error', 'not_over'); end if;
    return json_build_object(
        'ok', true, 'won', e.won_at is not null, 'goal', e.goal, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'total', (select coalesce(sum(fixed), 0) from public.blackout_participants where event_id = p_event),
        'alive', (select count(*) from public.blackout_participants where event_id = p_event and dead_at is null),
        'dead',  (select count(*) from public.blackout_participants where event_id = p_event and dead_at is not null),
        'players', coalesce((
            select json_agg(json_build_object('u', t.username, 'fixed', t.fixed, 'dead', t.dead, 'me', t.me) order by t.dead, t.fixed desc, lower(t.username))
              from (select pr.username, p.fixed, (p.dead_at is not null) as dead, (p.user_id = auth.uid()) as me
                      from public.blackout_participants p join public.profiles pr on pr.id = p.user_id
                     where p.event_id = p_event and pr.username is not null
                     order by (p.dead_at is not null), p.fixed desc, lower(pr.username) limit 1000) t
        ), '[]'::json));
end $$;

grant execute on function public.site_blackout_now() to anon, authenticated;
grant execute on function public.blackout_live(uuid, text, boolean) to anon, authenticated;
grant execute on function public.blackout_report(uuid) to anon, authenticated;
revoke all on function public.blackout_red(int, text[], numeric, int, int, text) from public, anon, authenticated;
revoke all on function public.blackout_join(uuid) from public, anon;
revoke all on function public.blackout_gen_start(uuid, text) from public, anon;
revoke all on function public.blackout_gen_finish(uuid, int) from public, anon;
revoke all on function public.blackout_claim(uuid) from public, anon;
grant execute on function public.blackout_join(uuid) to authenticated;
grant execute on function public.blackout_gen_start(uuid, text) to authenticated;
grant execute on function public.blackout_gen_finish(uuid, int) to authenticated;
grant execute on function public.blackout_claim(uuid) to authenticated;

-- ---------- staff: read everything for Console > Events > Blackout ---------------
create or replace function public.admin_blackout_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
    v_err := public.admin_gate('admin', 'blackout_view');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    return jsonb_build_object(
        'ok', true, 'now', now(),
        'settings', (select to_jsonb(s) from public.blackout_settings s where s.id = 1),
        'events', coalesce((
            select jsonb_agg(to_jsonb(x) order by x.starts_at desc)
              from (select e.id, e.label, e.starts_at, e.ends_at, e.goal, e.won_at, e.aborted_at,
                           (select count(*) from public.blackout_participants p where p.event_id = e.id) as players,
                           (select count(*) from public.blackout_participants p where p.event_id = e.id and p.dead_at is null) as alive,
                           (select coalesce(sum(p.fixed), 0) from public.blackout_participants p where p.event_id = e.id) as fixed_total
                      from public.blackout_events e order by e.starts_at desc limit 15) x
        ), '[]'::jsonb));
end $$;

-- ---------- staff: every setting in one json (so adding a setting later never breaks old consoles) ----
create or replace function public.admin_blackout_settings_set(p_cfg jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb; v_after jsonb; k text;
        v_re text := '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/event-audio/[A-Za-z0-9_./%-]{3,200}$';
        v_dur int; v_goal int; v_max int; v_lvl int; v_kill int; v_hint int; v_cool int; v_vol int; v_gx int; v_ga int; v_wx int; v_wa int; v_pages text[];
begin
    v_err := public.admin_gate('admin', 'blackout_settings_set');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    begin
        v_dur := (p_cfg->>'duration_s')::int; v_goal := (p_cfg->>'goal')::int; v_max := (p_cfg->>'per_player_max')::int;
        v_lvl := (p_cfg->>'red_level')::int; v_kill := (p_cfg->>'red_kill_s')::int; v_hint := (p_cfg->>'hint_after_s')::int;
        v_cool := (p_cfg->>'fix_cooldown_s')::int; v_vol := (p_cfg->>'volume')::int;
        v_gx := coalesce((p_cfg->>'reward_gen_xp')::int, 0); v_ga := coalesce((p_cfg->>'reward_gen_ac')::int, 0);
        v_wx := coalesce((p_cfg->>'reward_win_xp')::int, 0); v_wa := coalesce((p_cfg->>'reward_win_ac')::int, 0);
        select array_agg(distinct lower(btrim(x))) into v_pages from jsonb_array_elements_text(p_cfg->'pages') x;
    exception when others then
        return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_value');
    end;
    if v_dur is null or v_dur not between 120 and 3600 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_duration'); end if;
    if v_goal is null or v_goal not between 1 and 5000 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_goal'); end if;
    if v_lvl is null or v_lvl not between 1 and 5 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_red_level'); end if;
    if v_kill is null or v_kill not between 2 and 15 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_kill'); end if;
    if v_hint is null or v_hint not between 0 and 1800 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_hint'); end if;
    if v_cool is null or v_cool not between 0 and 300 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_cooldown'); end if;
    if v_vol is null or v_vol not between 0 and 100 then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_volume'); end if;
    if v_gx not between 0 and 1000000 or v_ga not between 0 and 1000000 or v_wx not between 0 and 1000000 or v_wa not between 0 and 1000000 then
        return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_reward');
    end if;
    if v_pages is null or cardinality(v_pages) not between 2 and 30 or exists (select 1 from unnest(v_pages) pg where pg !~ '^[a-z0-9_-]{1,30}$') then
        return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_pages');
    end if;
    if v_max is null or v_max not between 1 and 30 or v_max > cardinality(v_pages) then return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_per_player'); end if;
    foreach k in array array['ost', 'danger', 'gen', 'dead', 'win', 'fail'] loop
        if nullif(p_cfg->'audio'->>k, '') is not null and (p_cfg->'audio'->>k) !~ v_re then
            return public.admin_fail('blackout_settings_set', null, p_reason, 'bad_audio_url');
        end if;
    end loop;

    select to_jsonb(s) into v_before from public.blackout_settings s where s.id = 1;
    update public.blackout_settings
       set duration_s = v_dur, goal = v_goal, per_player_max = v_max, red_level = v_lvl, red_kill_s = v_kill, hint_after_s = v_hint,
           fix_cooldown_s = v_cool, pages = v_pages, reward_gen_xp = v_gx, reward_gen_ac = v_ga, reward_win_xp = v_wx, reward_win_ac = v_wa, volume = v_vol,
           audio_ost = nullif(p_cfg->'audio'->>'ost', ''), audio_danger = nullif(p_cfg->'audio'->>'danger', ''), audio_gen = nullif(p_cfg->'audio'->>'gen', ''),
           audio_dead = nullif(p_cfg->'audio'->>'dead', ''), audio_win = nullif(p_cfg->'audio'->>'win', ''), audio_fail = nullif(p_cfg->'audio'->>'fail', ''),
           updated_at = now(), updated_by = auth.uid()
     where id = 1;
    select to_jsonb(s) into v_after from public.blackout_settings s where s.id = 1;
    perform public.admin_log('blackout_settings_set', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, v_after);
    return jsonb_build_object('ok', true);
end $$;

-- ---------- staff: launch (now = lights out in 45 seconds so every open page can catch it) -----
create or replace function public.admin_blackout_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.blackout_settings; t0 timestamptz; t1 timestamptz; e public.blackout_events; v_busy boolean := false;
begin
    v_err := public.admin_gate('admin', 'blackout_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.blackout_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '45 seconds');
    t1 := t0 + make_interval(secs => s.duration_s);
    if t0 < now() + interval '10 seconds' then return public.admin_fail('blackout_launch', null, p_reason, 'bad_time'); end if;
    -- never overlap another blackout, a nuke event, or Glitchware (the browsers also yield to each other as a second safety)
    if exists (select 1 from public.blackout_events x where x.aborted_at is null and x.ends_at > t0 - interval '60 seconds' and x.starts_at < t1 + interval '60 seconds')
       or exists (select 1 from public.nuke_events x where x.aborted_at is null and x.ends_at > t0 - interval '60 seconds' and x.starts_at < t1 + interval '60 seconds') then
        return public.admin_fail('blackout_launch', null, p_reason, 'event_overlap');
    end if;
    if to_regclass('public.glitch_events') is not null then
        begin
            execute 'select exists (select 1 from public.glitch_events x where x.aborted_at is null and x.ends_at > $1 and x.starts_at < $2)'
               into v_busy using t0 - interval '60 seconds', t1 + interval '60 seconds';
        exception when others then v_busy := false;      -- different column names: skip, the browsers still yield to each other
        end;
        if v_busy then return public.admin_fail('blackout_launch', null, p_reason, 'event_overlap'); end if;
    end if;
    insert into public.blackout_events (label, starts_at, ends_at, duration_s, goal, per_player_max, red_level, red_kill_s, hint_after_s, fix_cooldown_s, pages, seed,
                                        reward_gen_xp, reward_gen_ac, reward_win_xp, reward_win_ac, volume,
                                        audio_ost, audio_danger, audio_gen, audio_dead, audio_win, audio_fail, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t1, s.duration_s, s.goal, s.per_player_max, s.red_level, s.red_kill_s, s.hint_after_s, s.fix_cooldown_s, s.pages,
            floor(random() * 2000000000)::int, s.reward_gen_xp, s.reward_gen_ac, s.reward_win_xp, s.reward_win_ac, s.volume,
            s.audio_ost, s.audio_danger, s.audio_gen, s.audio_dead, s.audio_win, s.audio_fail, auth.uid())
    returning * into e;
    perform public.admin_log('blackout_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'blackout_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;

-- ---------- staff: abort (every browser tidies itself within seconds) ------------
create or replace function public.admin_blackout_abort(p_event uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; v_before jsonb;
begin
    v_err := public.admin_gate('admin', 'blackout_abort');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select to_jsonb(x) into v_before from public.blackout_events x where x.id = p_event and x.aborted_at is null and x.ends_at > now();
    if v_before is null then return public.admin_fail('blackout_abort', null, p_reason, 'not_active'); end if;
    update public.blackout_events set aborted_at = now() where id = p_event;
    perform public.admin_log('blackout_abort', null, nullif(btrim(coalesce(p_reason, '')), ''), true, v_before, null, null, 'blackout_event', p_event::text);
    return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_blackout_get() from public, anon;
revoke all on function public.admin_blackout_settings_set(jsonb, text) from public, anon;
revoke all on function public.admin_blackout_launch(timestamptz, text, text) from public, anon;
revoke all on function public.admin_blackout_abort(uuid, text) from public, anon;
grant execute on function public.admin_blackout_get() to authenticated;
grant execute on function public.admin_blackout_settings_set(jsonb, text) to authenticated;
grant execute on function public.admin_blackout_launch(timestamptz, text, text) to authenticated;
grant execute on function public.admin_blackout_abort(uuid, text) to authenticated;
