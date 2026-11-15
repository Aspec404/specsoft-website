-- SPECSOFT Spectra Journal (v2: tabs + force write)
-- Run AFTER spectra-bond.sql, spectra-bond-shop.sql and spectra-bond-gift-category.sql.
-- Safe on a fresh database AND on top of the first version of this file (it upgrades in place). Safe to run again.
--
-- How it works
--   * Spectra writes a short diary entry about every 10 minutes (the chat page asks for it, see spectra-journal.js).
--   * Every Journals gift you SEND to her adds +5 pages to ONE shared pool. One page holds 2500 characters.
--   * The journal has TABS. Each tab is paginated on its own (entries never split, she turns the page when one does not fit),
--     and every page used in any tab comes out of the shared pool.
--   * Tabs unlock with more pages (the last one also needs a bond level). Edit them in _journal_tabs() below.
--   * She rotates between the unlocked tabs, so a new tab starts filling right after you unlock it.
--   * "Make me write now" (force write) is free: 2 minute cooldown, 10 a day. Forced entries also count to the 30 a day cap.
--   * Writes only happen through the spectra-journal edge function (service role). Members can only read their own journal.
--
-- Tweaks (all in this file):
--   starter pages ........ the 0 in _journal_pages()   (use 5 to give everyone one free journal)
--   tabs + unlock levels . _journal_tabs()  ("pages" = pages she must own, "bond" = bond level needed)
--   write interval ....... 600 (seconds) in spectra_journal_plan() and interval_min in spectra_journal_list()
--   limits ............... 30 entries a day, 10 forced a day, 2 minute force cooldown (all in spectra_journal_plan())
--   chars per page ....... 2500 (everywhere, and chars_per_page in spectra_journal_list())

-- ===== 1. which store item adds pages (set journal_pages on any store item to make it a journal) =====
alter table public.store_items
  add column if not exists journal_pages int check (journal_pages is null or journal_pages > 0);

update public.store_items set journal_pages = 5
 where bond_xp is not null and name = 'Journals' and journal_pages is null;

-- ===== 2. the journal =====
create table if not exists public.spectra_journal (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_at timestamptz not null default now(),     -- the time shown on the page
  created_at timestamptz not null default now(),   -- when it was really written (this drives the 10 minute rhythm)
  page int not null check (page >= 1),             -- page number INSIDE its tab
  mood text,
  body text not null check (char_length(body) between 1 and 900)
);
alter table public.spectra_journal add column if not exists tab text not null default 'daily';
alter table public.spectra_journal add column if not exists forced boolean not null default false;
create index if not exists spectra_journal_user_idx on public.spectra_journal (user_id, entry_at, id);
create index if not exists spectra_journal_tab_idx on public.spectra_journal (user_id, tab, page);

alter table public.spectra_journal enable row level security;
drop policy if exists journal_read on public.spectra_journal;
create policy journal_read on public.spectra_journal for select to authenticated using (user_id = auth.uid());

-- ===== 3. the tabs (key, pages she must own, bond level needed) =====
create or replace function public._journal_tabs() returns jsonb
language sql immutable as $$
  select '[
    {"key":"daily",   "pages":1,  "bond":1},
    {"key":"about",   "pages":10, "bond":1},
    {"key":"stories", "pages":15, "bond":1},
    {"key":"favs",    "pages":20, "bond":1},
    {"key":"dreams",  "pages":25, "bond":1},
    {"key":"secrets", "pages":30, "bond":25}
  ]'::jsonb
$$;

-- ===== 4. pages a member has = starter pages + pages from every journal they sent to Spectra =====
create or replace function public._journal_pages(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select 0 + coalesce((
    select sum(i.journal_pages * l.sent)::int
    from public.spectra_bond_gift_sent l
    join public.store_items i on i.id::text = l.item_id
    where l.user_id = p_user and i.journal_pages is not null
  ), 0)
$$;

-- pages already used = the pages of every tab added together
create or replace function public._journal_used_pages(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(m), 0)::int
  from (select max(j.page) as m from public.spectra_journal j where j.user_id = p_user group by j.tab) s
$$;

-- ===== 5. EDGE FUNCTION ONLY: how many entries may she write right now, and in which tabs? =====
drop function if exists public.spectra_journal_plan(uuid);
create or replace function public.spectra_journal_plan(p_user uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pages int; v_lvl int; v_used int; v_free int; v_open text[]; v_k text; v_mx int; v_uc int; v_room int; v_cnt int;
  v_tabs jsonb := '[]'::jsonb; v_today int; v_ftoday int; v_last timestamptz; v_lastf timestamptz;
  v_slots int; v_allowed int := 0; v_reason text; v_wait int := 0;
begin
  v_pages := public._journal_pages(p_user);
  if v_pages < 1 then
    return jsonb_build_object('allowed', 0, 'reason', 'no_pages', 'pages', 0, 'open', '[]'::jsonb, 'tabs', '[]'::jsonb, 'force_left', 0);
  end if;

  select coalesce(max(b.bond_level), 1) into v_lvl from public.spectra_bond b where b.user_id = p_user;
  select coalesce(array_agg(x->>'key'), '{}'::text[]) into v_open
    from jsonb_array_elements(public._journal_tabs()) x
   where (x->>'pages')::int <= v_pages and (x->>'bond')::int <= v_lvl;

  v_used := public._journal_used_pages(p_user);
  v_free := greatest(0, v_pages - v_used);

  -- tabs that can still take an entry (room = space left on the tab's last page + all free pages)
  foreach v_k in array v_open loop
    select max(j.page), count(*)::int into v_mx, v_cnt from public.spectra_journal j where j.user_id = p_user and j.tab = v_k;
    if v_mx is null then
      v_room := v_free * 2500;
    else
      select coalesce(sum(char_length(j.body)), 0)::int into v_uc
        from public.spectra_journal j where j.user_id = p_user and j.tab = v_k and j.page = v_mx;
      v_room := (2500 - v_uc) + v_free * 2500;
    end if;
    if v_room >= 150 then
      v_tabs := v_tabs || jsonb_build_array(jsonb_build_object('key', v_k, 'room', v_room, 'count', v_cnt));
    end if;
  end loop;

  select count(*)::int into v_today from public.spectra_journal j
   where j.user_id = p_user and j.created_at >= date_trunc('day', now());
  select count(*)::int into v_ftoday from public.spectra_journal j
   where j.user_id = p_user and j.forced and j.created_at >= date_trunc('day', now());
  select max(j.created_at) into v_last from public.spectra_journal j where j.user_id = p_user and not j.forced;
  select max(j.created_at) into v_lastf from public.spectra_journal j where j.user_id = p_user and j.forced;

  if jsonb_array_length(v_tabs) = 0 then
    v_reason := 'full';
  elsif v_today >= 30 then
    v_reason := 'daily_cap';
  elsif p_force then
    if v_ftoday >= 10 then
      v_reason := 'force_cap';
    elsif v_lastf is not null and v_lastf > now() - interval '2 minutes' then
      v_reason := 'cooldown';
      v_wait := ceil(extract(epoch from (v_lastf + interval '2 minutes' - now())))::int;
    else
      v_allowed := 1;
    end if;
  else
    if v_last is null then v_slots := 1;
    else v_slots := floor(extract(epoch from (now() - v_last)) / 600)::int; end if;
    v_allowed := greatest(0, least(v_slots, 4, 30 - v_today));
    if v_allowed = 0 then v_reason := 'wait'; end if;
  end if;

  return jsonb_build_object('allowed', v_allowed, 'reason', v_reason, 'pages', v_pages, 'used', v_used, 'bond', v_lvl,
                            'open', to_jsonb(v_open), 'tabs', v_tabs, 'last_at', v_last,
                            'wait_s', v_wait, 'force_left', greatest(0, 10 - v_ftoday));
end $$;

-- ===== 6. EDGE FUNCTION ONLY: save the entries she wrote (the database decides what really fits) =====
drop function if exists public.spectra_journal_add(uuid, jsonb);
create or replace function public.spectra_journal_add(p_user uuid, p_entries jsonb, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan jsonb; v_allowed int; v_pages int; v_open text[]; e jsonb; n int := 0; v_full boolean := false;
  v_tab text; v_body text; v_len int; v_at timestamptz; v_mood text; v_mx int; v_uc int; v_free int; v_page int;
begin
  perform pg_advisory_xact_lock(hashtext('spectra_journal:' || p_user::text));   -- two tabs cannot write at the same time
  v_plan := public.spectra_journal_plan(p_user, p_force);
  v_allowed := (v_plan->>'allowed')::int;
  if v_allowed < 1 then
    return jsonb_build_object('ok', true, 'added', 0, 'reason', v_plan->>'reason', 'wait_s', coalesce((v_plan->>'wait_s')::int, 0));
  end if;
  v_pages := (v_plan->>'pages')::int;
  select coalesce(array_agg(t), '{}'::text[]) into v_open from jsonb_array_elements_text(v_plan->'open') t;

  for e in select value from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    exit when n >= v_allowed;
    v_tab := coalesce(e->>'tab', 'daily');
    continue when not (v_tab = any(v_open));                       -- locked or unknown tab
    v_body := left(btrim(coalesce(e->>'body', '')), 900);
    v_len := char_length(v_body);
    continue when v_len < 1;

    select max(j.page) into v_mx from public.spectra_journal j where j.user_id = p_user and j.tab = v_tab;
    v_free := v_pages - public._journal_used_pages(p_user);
    if v_mx is null then
      if v_free < 1 then v_full := true; continue; end if;
      v_page := 1;
    else
      select coalesce(sum(char_length(j.body)), 0)::int into v_uc
        from public.spectra_journal j where j.user_id = p_user and j.tab = v_tab and j.page = v_mx;
      if v_uc + v_len <= 2500 then v_page := v_mx;                  -- fits on the current page
      elsif v_free >= 1 then v_page := v_mx + 1;                    -- turn the page
      else v_full := true; continue; end if;
    end if;

    begin v_at := (e->>'at')::timestamptz; exception when others then v_at := now(); end;
    v_at := least(now(), greatest(now() - interval '2 days', coalesce(v_at, now())));
    v_mood := left(coalesce(e->>'mood', ''), 20);
    insert into public.spectra_journal (user_id, tab, entry_at, page, mood, body, forced)
    values (p_user, v_tab, v_at, v_page, nullif(v_mood, ''), v_body, p_force);
    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'added', n, 'reason', case when n = 0 and v_full then 'full' else null end);
end $$;

-- ===== 7. CLIENT: read my journal =====
create or replace function public.spectra_journal_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_pages int; v_lvl int; v_p jsonb; v_f jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  v_pages := public._journal_pages(v_uid);
  select coalesce(max(b.bond_level), 1) into v_lvl from public.spectra_bond b where b.user_id = v_uid;
  v_p := public.spectra_journal_plan(v_uid, false);
  v_f := public.spectra_journal_plan(v_uid, true);
  return jsonb_build_object(
    'ok', true, 'pages', v_pages, 'used_pages', public._journal_used_pages(v_uid),
    'chars_per_page', 2500, 'interval_min', 10, 'bond_level', v_lvl,
    'full', coalesce(v_p->>'reason', '') = 'full',
    'last_at', (select max(j.created_at) from public.spectra_journal j where j.user_id = v_uid and not j.forced),
    'tabs', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', t.x->>'key', 'pages_needed', (t.x->>'pages')::int, 'bond_needed', (t.x->>'bond')::int,
                'unlocked', (t.x->>'pages')::int <= v_pages and (t.x->>'bond')::int <= v_lvl) order by t.ord), '[]'::jsonb)
             from jsonb_array_elements(public._journal_tabs()) with ordinality as t(x, ord)),
    'force', jsonb_build_object('ok', coalesce((v_f->>'allowed')::int, 0) > 0, 'reason', v_f->>'reason',
                                'wait_s', coalesce((v_f->>'wait_s')::int, 0), 'left', coalesce((v_f->>'force_left')::int, 0)),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'at', j.entry_at, 'tab', j.tab, 'page', j.page, 'mood', j.mood,
                                          'body', j.body, 'forced', j.forced) order by j.entry_at, j.id)
      from public.spectra_journal j where j.user_id = v_uid), '[]'::jsonb));
end $$;

-- ===== permissions =====
revoke all on function public._journal_tabs() from public, anon, authenticated;
revoke all on function public._journal_pages(uuid) from public, anon, authenticated;
revoke all on function public._journal_used_pages(uuid) from public, anon, authenticated;
revoke all on function public.spectra_journal_plan(uuid, boolean) from public, anon, authenticated;
revoke all on function public.spectra_journal_add(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.spectra_journal_list() from public, anon;
grant execute on function public.spectra_journal_plan(uuid, boolean) to service_role;
grant execute on function public.spectra_journal_add(uuid, jsonb, boolean) to service_role;
grant execute on function public.spectra_journal_list() to authenticated;

-- check: your Journals item should show journal_pages = 5
select name, category, price, bond_xp, journal_pages from public.store_items where journal_pages is not null;
