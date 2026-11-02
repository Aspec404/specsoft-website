-- ==========================================================================
-- SPECSOFT® PROJECTS HUB: the feed behind projects.html (projects.js)
--
-- PROPOSAL: read it, then run it in the Supabase SQL Editor. Safe to run more than once.
-- Run supabase-profiles.sql and supabase-project-social.sql FIRST (this uses profile_projects, profile_project_likes,
-- profile_project_comments and profile_reposts from them), and for the Studio link also supabase-studio-phase7.sql and
-- supabase-studio-phase7b-hub.sql (it reads studio_published.hub_project_id).
--
-- WHY THIS FILE EXISTS: projects.js calls a database function named hub_projects(...) and a table named
-- profile_project_saves. The file called supabase-hub.sql in this project is the secret Hub (tasks, diary, classified
-- files) and does NOT create them, so the Projects hub had nothing to read. This file creates them. It is named
-- supabase-projects-hub.sql so it can never be confused with supabase-hub.sql again.
--
-- WHAT IT DOES (nothing is dropped except the old category check, see 1):
--   1. profile_projects: adds the card columns the hub shows IF THEY ARE MISSING (summary, category, url, repo_url,
--      video_url, cover_url, tags, pinned). Existing columns and data are left alone, with ONE exception: a project
--      whose category is empty or not one of ai / games / software / roblox / other is set to 'other', and the category
--      check is re-created with exactly those five values (the same list as CATS in projects.js and HUBCATS in
--      studio-publish.js). Any older check on the category column is replaced.
--   2. profile_project_saves: the bookmark table (RLS: you only see, add and remove your OWN saves).
--   3. hub_projects(...): the ONE read path the hub uses. It returns {items, total, saved_count} with each card's owner
--      (id, username, display_name, avatar_url) and its like / comment / repost counts and your own liked / reposted /
--      saved flags. It runs with YOUR permissions (not security definer), so the row-level security on profile_projects
--      and profiles still decides what a visitor may see.
--
-- Studio projects need nothing special: Publish creates a normal profile_projects card (tags: ['studio']) and it shows up
-- here like any other project. Each card also gets a studio_slug (the published project's link name) from
-- studio_hub_slug() below, so the hub can open the project from ITS OWN address (studio-view.html?p=slug). No domain,
-- no stored link and no https rule are involved, and it works wherever the hub page is hosted.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) profile_projects: card columns + categories
-- --------------------------------------------------------------------------
alter table public.profile_projects add column if not exists summary   text;
alter table public.profile_projects add column if not exists category  text not null default 'other';
alter table public.profile_projects add column if not exists url       text;
alter table public.profile_projects add column if not exists repo_url  text;
alter table public.profile_projects add column if not exists video_url text;
alter table public.profile_projects add column if not exists cover_url text;
alter table public.profile_projects add column if not exists tags      text[] not null default '{}';
alter table public.profile_projects add column if not exists pinned    boolean not null default false;

update public.profile_projects
   set category = 'other'
 where category is null or category not in ('ai', 'games', 'software', 'roblox', 'other');

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.profile_projects'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%category%'
  loop
    execute format('alter table public.profile_projects drop constraint %I', r.conname);
  end loop;
  alter table public.profile_projects
    add constraint profile_projects_category_check check (category in ('ai', 'games', 'software', 'roblox', 'other'));
end $$;

create index if not exists profile_projects_hub_idx on public.profile_projects (created_at desc);


-- --------------------------------------------------------------------------
-- 2) SAVES (the bookmark button): private to each member
-- --------------------------------------------------------------------------
create table if not exists public.profile_project_saves (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.profile_projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists profile_project_saves_user_idx on public.profile_project_saves (user_id, created_at desc);

alter table public.profile_project_saves enable row level security;

drop policy if exists "saves read own"   on public.profile_project_saves;
drop policy if exists "saves insert own" on public.profile_project_saves;
drop policy if exists "saves delete own" on public.profile_project_saves;

create policy "saves read own"   on public.profile_project_saves for select to authenticated using (auth.uid() = user_id);
create policy "saves insert own" on public.profile_project_saves for insert to authenticated
  with check (
    auth.uid() = user_id
    and (select count(*) from public.profile_project_saves s where s.user_id = auth.uid()) < 500
  );
create policy "saves delete own" on public.profile_project_saves for delete to authenticated using (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 3) hub_projects(...): the feed
--    p_q           search words (title, summary, tags)
--    p_category    ai | games | software | roblox | other (null = all)
--    p_sort        newest | liked | az
--    p_limit       1 to 60 (default 24)       p_offset  0 or more
--    p_saved_only  only the projects YOU saved
--    p_pinned_only only pinned projects (the highlights row)
--    p_id          one project by id (used by links like projects.html#project-<id>)
-- --------------------------------------------------------------------------
-- Which published Studio project (if any) belongs to a hub card? Visitors cannot read studio_published directly, so this
-- one small function answers for them: it only ever returns the link name of a project that is PUBLIC and LIVE.
create or replace function public.studio_hub_slug(p_hub_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sp.slug
  from public.studio_published sp
  where sp.hub_project_id = p_hub_id and sp.visibility = 'public' and sp.release_id is not null
  order by sp.published_at desc
  limit 1
$$;
revoke all on function public.studio_hub_slug(uuid) from public;
grant execute on function public.studio_hub_slug(uuid) to anon, authenticated;

-- If an OLDER hub_projects with different arguments exists, the website could not choose between the two, so it is
-- removed first (the only thing this file ever drops besides the category check).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'hub_projects'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create or replace function public.hub_projects(
  p_q           text    default null,
  p_category    text    default null,
  p_sort        text    default 'newest',
  p_limit       int     default 24,
  p_offset      int     default 0,
  p_saved_only  boolean default false,
  p_pinned_only boolean default false,
  p_id          uuid    default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_q     text := nullif(btrim(coalesce(p_q, '')), '');
  v_cat   text := nullif(btrim(coalesce(p_category, '')), '');
  v_sort  text := coalesce(p_sort, 'newest');
  v_lim   int  := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_saved boolean := coalesce(p_saved_only, false);
  v_pin   boolean := coalesce(p_pinned_only, false);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_scnt  bigint := 0;
begin
  if v_q is not null then
    v_q := '%' || regexp_replace(v_q, '([\\%_])', '\\\1', 'g') || '%';   -- % and _ typed by a visitor are searched literally
  end if;

  with base as (
    select p.id, p.title, p.created_at,
           (select count(*) from public.profile_project_likes l where l.project_id = p.id) as lc
    from public.profile_projects p
    where (p_id is null or p.id = p_id)
      and (v_cat is null or to_jsonb(p) ->> 'category' = v_cat)
      and (not v_pin or coalesce((to_jsonb(p) ->> 'pinned')::boolean, false))
      and (not v_saved or (v_uid is not null and exists (
            select 1 from public.profile_project_saves s where s.project_id = p.id and s.user_id = v_uid)))
      and (v_q is null
           or p.title ilike v_q escape '\'
           or coalesce(to_jsonb(p) ->> 'summary', '') ilike v_q escape '\'
           or coalesce(to_jsonb(p) ->> 'tags', '') ilike v_q escape '\')
  ),
  ranked as (
    select b.*,
           row_number() over (
             order by case when v_sort = 'liked' then b.lc end desc nulls last,
                      case when v_sort = 'az' then lower(b.title) end asc nulls last,
                      b.created_at desc, b.id
           ) as rn
    from base b
  ),
  page as (
    select r.id, r.rn from ranked r where r.rn > v_off and r.rn <= v_off + v_lim
  )
  select (select count(*) from ranked),
         coalesce(jsonb_agg(
           to_jsonb(p) || jsonb_build_object(
             'owner', jsonb_build_object(
                 'id', p.owner_id,
                 'username', to_jsonb(pr) ->> 'username',
                 'display_name', to_jsonb(pr) ->> 'display_name',
                 'avatar_url', to_jsonb(pr) ->> 'avatar_url'),
             'studio_slug',   public.studio_hub_slug(p.id),
             'like_count',    (select count(*) from public.profile_project_likes l    where l.project_id = p.id),
             'comment_count', (select count(*) from public.profile_project_comments c where c.project_id = p.id),
             'repost_count',  (select count(*) from public.profile_reposts r          where r.project_id = p.id),
             'liked',    v_uid is not null and exists (select 1 from public.profile_project_likes l where l.project_id = p.id and l.user_id = v_uid),
             'reposted', v_uid is not null and exists (select 1 from public.profile_reposts r       where r.project_id = p.id and r.user_id = v_uid),
             'saved',    v_uid is not null and exists (select 1 from public.profile_project_saves s  where s.project_id = p.id and s.user_id = v_uid)
           ) order by pg.rn), '[]'::jsonb)
    into v_total, v_items
  from page pg
  join public.profile_projects p on p.id = pg.id
  left join public.profiles pr on pr.id = p.owner_id;

  if v_uid is not null then
    select count(*) into v_scnt
    from public.profile_project_saves s
    join public.profile_projects p on p.id = s.project_id
    where s.user_id = v_uid;
  end if;

  return jsonb_build_object('items', v_items, 'total', v_total, 'saved_count', v_scnt);
end;
$$;

revoke all on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid) from public;
grant execute on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid) to anon, authenticated;


-- --------------------------------------------------------------------------
-- 4) OPTIONAL: live updates on projects.html (new cards and likes without a refresh).
--    projects.js listens to changes on profile_projects. If it is not already in the realtime publication, run:
--      alter publication supabase_realtime add table public.profile_projects;
--    (It errors harmlessly if the table is already in it.)
-- --------------------------------------------------------------------------
