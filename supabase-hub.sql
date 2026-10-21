-- ==========================================================================
-- SPECSOFT® PROJECTS HUB
--
-- RUN ORDER: supabase-profiles.sql, supabase-project-social.sql, supabase-chats.sql and
-- supabase-admin.sql FIRST, then this file. Safe to run more than once.
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL > Run.
--
-- WHAT THIS DOES
--   Every project a member posts on their profile already lives in ONE table,
--   profile_projects, and likes / comments / reposts point at that project's id.
--   So the Projects Hub does not copy anything: it reads the same rows through
--   hub_projects(). Every like and comment a project already has shows up on the hub
--   automatically, and new ones count on both pages because they are the same rows.
--
--   Adds: a category on every project, a "show on the hub" switch (on by default),
--   a private Saved list, staff "hide from hub", and live updates.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) NEW COLUMNS ON profile_projects
-- --------------------------------------------------------------------------
alter table public.profile_projects add column if not exists category text;
alter table public.profile_projects add column if not exists show_in_hub boolean not null default true;
alter table public.profile_projects add column if not exists hub_hidden_at timestamptz;
alter table public.profile_projects add column if not exists hub_hidden_by uuid references public.profiles(id) on delete set null;
alter table public.profile_projects add column if not exists hub_hidden_reason text;

-- one-time guess for projects that already exist, based on their tags
-- (rerunning this file never touches a project that already has a category)
update public.profile_projects set category = case
  when exists (select 1 from unnest(tags) t where lower(t) in ('roblox', 'lua', 'luau', 'rbxl', 'roblox studio')) then 'roblox'
  when exists (select 1 from unnest(tags) t where lower(t) in ('ai', 'ml', 'llm', 'gpt', 'chatbot', 'machine learning', 'neural', 'agent', 'agents')) then 'ai'
  when exists (select 1 from unnest(tags) t where lower(t) in ('game', 'games', 'gamedev', 'unity', 'godot', 'unreal', 'fps', 'rpg', 'simulator', 'platformer')) then 'games'
  when exists (select 1 from unnest(tags) t where lower(t) in ('app', 'tool', 'tools', 'software', 'web', 'website', 'bot', 'discord', 'api', 'cli', 'plugin', 'extension', 'library', 'framework', 'html', 'css', 'javascript', 'js', 'python', 'react')) then 'software'
  else 'other'
end
where category is null;

alter table public.profile_projects alter column category set default 'other';
alter table public.profile_projects alter column category set not null;

alter table public.profile_projects drop constraint if exists projects_category_valid;
alter table public.profile_projects add constraint projects_category_valid
  check (category in ('ai', 'games', 'software', 'roblox', 'other'));

create index if not exists profile_projects_hub_idx
  on public.profile_projects (created_at desc)
  where show_in_hub and hub_hidden_at is null;

-- members can never un-hide a project staff hid (only admin_hub_hide below may change these)
create or replace function public.projects_hub_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.hub_hidden_at := null;
    new.hub_hidden_by := null;
    new.hub_hidden_reason := null;
  elsif coalesce(current_setting('specsoft.admin_hide', true), '') <> '1' then
    new.hub_hidden_at := old.hub_hidden_at;
    new.hub_hidden_by := old.hub_hidden_by;
    new.hub_hidden_reason := old.hub_hidden_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_hub_guard on public.profile_projects;
create trigger projects_hub_guard before insert or update on public.profile_projects
  for each row execute function public.projects_hub_guard();


-- --------------------------------------------------------------------------
-- 2) SAVED PROJECTS (private bookmarks)
-- --------------------------------------------------------------------------
create table if not exists public.profile_project_saves (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.profile_projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists profile_project_saves_user_idx on public.profile_project_saves (user_id, created_at desc);

alter table public.profile_project_saves enable row level security;

drop policy if exists "saves are private"     on public.profile_project_saves;
drop policy if exists "members save projects" on public.profile_project_saves;
drop policy if exists "members unsave"        on public.profile_project_saves;

create policy "saves are private"
  on public.profile_project_saves for select to authenticated
  using (auth.uid() = user_id);

create policy "members save projects"
  on public.profile_project_saves for insert to authenticated
  with check (
    auth.uid() = user_id
    and (select count(*) from public.profile_project_saves s where s.user_id = auth.uid()) < 500
  );

create policy "members unsave"
  on public.profile_project_saves for delete to authenticated
  using (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 3) THE HUB FEED (one call: projects + owner + like/comment/repost counts + "did I...")
--    p_sort: newest | liked | az      p_id: open one project (deep links)
-- --------------------------------------------------------------------------
create or replace function public.hub_projects(
  p_q            text    default null,
  p_category     text    default null,
  p_sort         text    default 'newest',
  p_limit        int     default 24,
  p_offset       int     default 0,
  p_saved_only   boolean default false,
  p_pinned_only  boolean default false,
  p_id           uuid    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int  := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(btrim(coalesce(p_q, '')), '');
  v_cat   text := nullif(btrim(coalesce(p_category, '')), '');
  v_like  text;
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if v_q is not null then
    v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select p.*,
           o.username     as o_username,
           o.display_name as o_display,
           o.avatar_url   as o_avatar,
           (select count(*) from public.profile_project_likes l where l.project_id = p.id) as like_count
    from public.profile_projects p
    join public.profiles o on o.id = p.owner_id
    where p.show_in_hub
      and p.hub_hidden_at is null
      and not public.sanction_active(p.owner_id, array['ban'])
      and (p_id is null or p.id = p_id)
      and (v_cat is null or p.category = v_cat)
      and (not coalesce(p_pinned_only, false) or p.pinned)
      and (
        v_like is null
        or p.title ilike v_like escape '\'
        or coalesce(p.summary, '') ilike v_like escape '\'
        or o.username ilike v_like escape '\'
        or exists (select 1 from unnest(p.tags) t where t ilike v_like escape '\')
      )
      and (
        not coalesce(p_saved_only, false)
        or (v_uid is not null and exists (
              select 1 from public.profile_project_saves s where s.project_id = p.id and s.user_id = v_uid))
      )
  ),
  ranked as (
    select b.*,
           count(*) over () as total_count,
           row_number() over (
             order by (case when p_sort = 'liked' then b.like_count end) desc nulls last,
                      (case when p_sort = 'az' then lower(b.title) end) asc nulls last,
                      b.created_at desc
           ) as rn
    from base b
  ),
  page as (
    select * from ranked where rn > v_off and rn <= v_off + v_limit
  )
  select coalesce(max(total_count), 0),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', pg.id,
             'owner_id', pg.owner_id,
             'title', pg.title,
             'summary', pg.summary,
             'url', pg.url,
             'repo_url', pg.repo_url,
             'cover_url', pg.cover_url,
             'video_url', pg.video_url,
             'tags', to_jsonb(pg.tags),
             'pinned', pg.pinned,
             'category', pg.category,
             'created_at', pg.created_at,
             'owner', jsonb_build_object('id', pg.owner_id, 'username', pg.o_username, 'display_name', pg.o_display, 'avatar_url', pg.o_avatar),
             'like_count', pg.like_count,
             'comment_count', (select count(*) from public.profile_project_comments c where c.project_id = pg.id),
             'repost_count',  (select count(*) from public.profile_reposts r where r.project_id = pg.id),
             'liked',    v_uid is not null and exists (select 1 from public.profile_project_likes l where l.project_id = pg.id and l.user_id = v_uid),
             'reposted', v_uid is not null and exists (select 1 from public.profile_reposts r where r.project_id = pg.id and r.user_id = v_uid),
             'saved',    v_uid is not null and exists (select 1 from public.profile_project_saves s where s.project_id = pg.id and s.user_id = v_uid)
           ) order by pg.rn
         ), '[]'::jsonb)
  into v_total, v_items
  from page pg;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'items', v_items,
    'saved_count', case when v_uid is null then 0 else (select count(*) from public.profile_project_saves where user_id = v_uid) end
  );
end;
$$;

revoke all on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid) from public;
grant execute on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid) to anon, authenticated;


-- --------------------------------------------------------------------------
-- 4) STAFF: hide a project from the hub (the member's profile keeps it)
--    Needs supabase-admin.sql. The admin console gets a button for this next.
-- --------------------------------------------------------------------------
create or replace function public.admin_hub_hide(p_project uuid, p_hidden boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_p public.profile_projects;
begin
  v_err := public.admin_gate('moderator', 'hub_hide');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into v_p from public.profile_projects where id = p_project;
  if v_p.id is null then
    return public.admin_fail('hub_hide', null, p_reason, 'not_found');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return public.admin_fail('hub_hide', v_p.owner_id, p_reason, 'reason_required', jsonb_build_object('project', p_project));
  end if;

  perform set_config('specsoft.admin_hide', '1', true);
  update public.profile_projects
  set hub_hidden_at     = case when p_hidden then now() else null end,
      hub_hidden_by     = case when p_hidden then auth.uid() else null end,
      hub_hidden_reason = case when p_hidden then left(btrim(p_reason), 300) else null end
  where id = p_project;
  perform set_config('specsoft.admin_hide', '', true);

  if p_hidden then
    perform public.admin_notify(v_p.owner_id, 'info', 'A project was removed from the Projects Hub',
      '"' || left(v_p.title, 60) || '": ' || btrim(p_reason) || ' It is still on your profile.');
  end if;

  perform public.admin_log('hub_hide', v_p.owner_id, p_reason, true,
    jsonb_build_object('hidden', v_p.hub_hidden_at is not null),
    jsonb_build_object('hidden', p_hidden), null, 'project', p_project::text);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_hub_hide(uuid, boolean, text) from public, anon;
grant execute on function public.admin_hub_hide(uuid, boolean, text) to authenticated;


-- --------------------------------------------------------------------------
-- 5) LIVE UPDATES: new projects, likes and comments reach an open hub without a refresh
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profile_projects', 'profile_project_likes', 'profile_project_comments', 'profile_reposts'] loop
      if to_regclass('public.' || t) is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
