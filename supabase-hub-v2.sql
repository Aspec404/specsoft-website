-- ==========================================================================
-- SPECSOFT® HUB v2: POSTS + THREADED COMMENTS + STICKERS + IMAGES
--
-- RUN ORDER (once each, in the Supabase SQL Editor):
--   1. supabase-profiles.sql
--   2. supabase-project-social.sql        (see the note in section 2 about its broken line)
--   3. supabase-projects-hub.sql
--   4. supabase-reports.sql               (the Report button needs report_submit from it)
--   5. THIS FILE (safe to run more than once)
--
-- THE BIG IDEA: a POST is just a row in profile_projects with kind = 'post'.
-- That means likes, comments, reposts, saves, reports and the hub feed all keep
-- working for posts with no extra tables. A PROJECT is kind = 'project' (the default,
-- so every project you already have stays a project).
--
-- WHAT THIS DOES
--   1. profile_projects: kind, body, attachments, links, show_in_hub (if missing)
--      + separate limits: 12 projects and 100 posts per member
--   2. profile_project_comments: replies (parent_id), image_url, sticker_url
--      + a guard so replies only go one level deep, on the same project
--   3. profile_comment_likes (like a comment)
--   4. project_comments_list(): ONE request returns the whole thread with authors + likes
--   5. storage buckets: post-media (25 MB) and comment-media (5 MB), members write to their own folder only
--   6. hub_projects() v2: type filter (project / post) + "trending" sort
--   7. hub_stats(): the live numbers at the top of the hub
--   8. realtime for comments
--
-- NOTE ON THE URL IN SECTION 2: it is your Supabase project address from projects.js.
-- If you ever move to another Supabase project, change that one host name.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) profile_projects: posts
-- --------------------------------------------------------------------------
alter table public.profile_projects add column if not exists kind         text    not null default 'project';
alter table public.profile_projects add column if not exists body         text;
alter table public.profile_projects add column if not exists attachments  jsonb   not null default '[]'::jsonb;
alter table public.profile_projects add column if not exists links        jsonb   not null default '[]'::jsonb;
alter table public.profile_projects add column if not exists show_in_hub  boolean not null default true;

alter table public.profile_projects drop constraint if exists projects_kind_check;
alter table public.profile_projects add  constraint projects_kind_check check (kind in ('project', 'post'));

alter table public.profile_projects drop constraint if exists projects_body_len;
alter table public.profile_projects add  constraint projects_body_len check (body is null or char_length(body) <= 5000);

alter table public.profile_projects drop constraint if exists projects_attachments_len;
alter table public.profile_projects add  constraint projects_attachments_len check (octet_length(attachments::text) <= 24000);

alter table public.profile_projects drop constraint if exists projects_links_len;
alter table public.profile_projects add  constraint projects_links_len check (octet_length(links::text) <= 4000);

-- posts may have a longer title than the old 60-character project card
alter table public.profile_projects drop constraint if exists projects_title_len;
alter table public.profile_projects add  constraint projects_title_len check (char_length(title) between 1 and 80);

create index if not exists profile_projects_kind_idx on public.profile_projects (kind, created_at desc);

-- limits: 12 projects, 100 posts per member
drop policy if exists "members add own projects" on public.profile_projects;
create policy "members add own projects"
  on public.profile_projects for insert to authenticated
  with check (
    auth.uid() = owner_id
    and (
      (kind = 'post'
        and (select count(*) from public.profile_projects p where p.owner_id = auth.uid() and p.kind = 'post') < 100)
      or
      (kind <> 'post'
        and (select count(*) from public.profile_projects p where p.owner_id = auth.uid() and p.kind <> 'post') < 12)
    )
  );


-- --------------------------------------------------------------------------
-- 2) COMMENTS: replies, images, stickers
--    (supabase-project-social.sql has one broken line: "drop constraint if exists project_comments_len;"
--     is missing "alter table ... ". This file does it correctly, so just run this file after it.
--     If that file stopped with an error, fix that line first so the rest of it runs too.)
-- --------------------------------------------------------------------------
alter table public.profile_project_comments add column if not exists image_url   text;
alter table public.profile_project_comments add column if not exists sticker_url text;
alter table public.profile_project_comments add column if not exists parent_id   uuid references public.profile_project_comments(id) on delete cascade;

alter table public.profile_project_comments alter column body set default '';
alter table public.profile_project_comments alter column body drop not null;

alter table public.profile_project_comments drop constraint if exists project_comments_len;
alter table public.profile_project_comments add  constraint project_comments_len
  check (char_length(btrim(coalesce(body, ''))) <= 500);

-- a comment needs words, an image or a sticker (NOT VALID = only checked for NEW comments, old ones stay)
alter table public.profile_project_comments drop constraint if exists project_comments_content;
alter table public.profile_project_comments add  constraint project_comments_content
  check (char_length(btrim(coalesce(body, ''))) > 0 or image_url is not null or sticker_url is not null) not valid;

-- images must come from YOUR comment-media bucket (stops people pointing at tracking pixels)
alter table public.profile_project_comments drop constraint if exists project_comments_image_host;
alter table public.profile_project_comments add  constraint project_comments_image_host
  check (image_url is null or image_url ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/comment-media/') not valid;

-- stickers: the same image hosts the chats allow for custom emoji, plus your own storage (store emotes)
alter table public.profile_project_comments drop constraint if exists project_comments_sticker_host;
alter table public.profile_project_comments add  constraint project_comments_sticker_host
  check (sticker_url is null or sticker_url ~ '^https://(em-content\.zobj\.net|([a-z0-9-]+\.)?emoji\.gg|mcpjjmbvuzclzrniunkq\.supabase\.co)/') not valid;

create index if not exists profile_project_comments_parent_idx on public.profile_project_comments (parent_id);

-- replies: one level deep, same project, parent must be a top-level comment
create or replace function public.project_comment_guard()
returns trigger
language plpgsql
as $$
declare
  v_parent public.profile_project_comments;
begin
  if new.parent_id is not null then
    select * into v_parent from public.profile_project_comments where id = new.parent_id;
    if v_parent.id is null then
      raise exception 'reply_parent_missing';
    end if;
    if v_parent.project_id <> new.project_id then
      raise exception 'reply_wrong_project';
    end if;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;        -- replying to a reply lands in the same thread
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_comment_guard on public.profile_project_comments;
create trigger project_comment_guard before insert on public.profile_project_comments
  for each row execute function public.project_comment_guard();

drop policy if exists "members comment" on public.profile_project_comments;
create policy "members comment"
  on public.profile_project_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      select count(*) from public.profile_project_comments c
      where c.user_id = auth.uid() and c.created_at > now() - interval '1 minute'
    ) < 8
  );


-- --------------------------------------------------------------------------
-- 3) COMMENT LIKES
-- --------------------------------------------------------------------------
create table if not exists public.profile_comment_likes (
  comment_id uuid not null references public.profile_project_comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.profile_comment_likes enable row level security;

drop policy if exists "comment likes public"      on public.profile_comment_likes;
drop policy if exists "comment likes add own"     on public.profile_comment_likes;
drop policy if exists "comment likes remove own"  on public.profile_comment_likes;

create policy "comment likes public"     on public.profile_comment_likes for select using (true);
create policy "comment likes add own"    on public.profile_comment_likes for insert to authenticated with check (auth.uid() = user_id);
create policy "comment likes remove own" on public.profile_comment_likes for delete to authenticated using (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 4) THE THREAD IN ONE REQUEST
-- --------------------------------------------------------------------------
create or replace function public.project_comments_list(p_project uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    to_jsonb(c) || jsonb_build_object(
      'author', jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url),
      'like_count', (select count(*) from public.profile_comment_likes l where l.comment_id = c.id),
      'liked', auth.uid() is not null and exists (select 1 from public.profile_comment_likes l where l.comment_id = c.id and l.user_id = auth.uid())
    ) order by c.created_at), '[]'::jsonb)
  from (
    select * from public.profile_project_comments
    where project_id = p_project
    order by created_at
    limit 500
  ) c
  left join public.profiles pr on pr.id = c.user_id;
$$;

grant execute on function public.project_comments_list(uuid) to anon, authenticated;


-- --------------------------------------------------------------------------
-- 5) STORAGE: post-media (images + files for posts), comment-media (images in comments)
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media', 'post-media', true, 26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
        'application/pdf', 'application/zip', 'application/json', 'text/plain', 'text/markdown']
)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comment-media', 'comment-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hub media public read" on storage.objects;
drop policy if exists "hub media upload own"  on storage.objects;
drop policy if exists "hub media delete own"  on storage.objects;

create policy "hub media public read"
  on storage.objects for select
  using (bucket_id in ('post-media', 'comment-media'));

create policy "hub media upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('post-media', 'comment-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "hub media delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('post-media', 'comment-media')
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- --------------------------------------------------------------------------
-- 6) hub_projects() v2: adds p_kind (project | post) and the "trending" sort
--    (the old version is removed first so the website never sees two versions)
-- --------------------------------------------------------------------------
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
  p_sort        text    default 'trending',
  p_limit       int     default 24,
  p_offset      int     default 0,
  p_saved_only  boolean default false,
  p_pinned_only boolean default false,
  p_id          uuid    default null,
  p_kind        text    default null
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
  v_kind  text := nullif(btrim(coalesce(p_kind, '')), '');
  v_sort  text := coalesce(p_sort, 'trending');
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
           (select count(*) from public.profile_project_likes l    where l.project_id = p.id) as lc,
           (select count(*) from public.profile_project_comments c where c.project_id = p.id) as cc,
           (select count(*) from public.profile_reposts rp         where rp.project_id = p.id) as rc
    from public.profile_projects p
    where (p_id is null or p.id = p_id)
      and (p_id is not null or p.show_in_hub)
      and (v_cat is null or p.category = v_cat)
      and (v_kind is null or p.kind = v_kind)
      and (not v_pin or p.pinned)
      and (not v_saved or (v_uid is not null and exists (
            select 1 from public.profile_project_saves s where s.project_id = p.id and s.user_id = v_uid)))
      and (v_q is null
           or p.title ilike v_q escape '\'
           or coalesce(p.summary, '') ilike v_q escape '\'
           or coalesce(p.body, '') ilike v_q escape '\'
           or array_to_string(p.tags, ' ') ilike v_q escape '\')
  ),
  ranked as (
    select b.*,
           row_number() over (
             order by case when v_sort = 'trending' then (b.lc + 2 * b.cc + 3 * b.rc) end desc nulls last,
                      case when v_sort = 'liked'    then b.lc end desc nulls last,
                      case when v_sort = 'az'       then lower(b.title) end asc nulls last,
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
                 'username', pr.username,
                 'display_name', pr.display_name,
                 'avatar_url', pr.avatar_url),
             'studio_slug',   public.studio_hub_slug(p.id),
             'like_count',    (select count(*) from public.profile_project_likes l    where l.project_id = p.id),
             'comment_count', (select count(*) from public.profile_project_comments c where c.project_id = p.id),
             'repost_count',  (select count(*) from public.profile_reposts rp         where rp.project_id = p.id),
             'liked',    v_uid is not null and exists (select 1 from public.profile_project_likes l where l.project_id = p.id and l.user_id = v_uid),
             'reposted', v_uid is not null and exists (select 1 from public.profile_reposts rp      where rp.project_id = p.id and rp.user_id = v_uid),
             'saved',    v_uid is not null and exists (select 1 from public.profile_project_saves s where s.project_id = p.id and s.user_id = v_uid)
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

revoke all on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid, text) from public;
grant execute on function public.hub_projects(text, text, text, int, int, boolean, boolean, uuid, text) to anon, authenticated;


-- --------------------------------------------------------------------------
-- 7) hub_stats(): the numbers at the top of the hub
-- --------------------------------------------------------------------------
create or replace function public.hub_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'projects', count(*) filter (where kind <> 'post'),
    'posts',    count(*) filter (where kind = 'post'),
    'makers',   count(distinct owner_id)
  )
  from public.profile_projects
  where show_in_hub;
$$;

grant execute on function public.hub_stats() to anon, authenticated;


-- --------------------------------------------------------------------------
-- 8) REALTIME: new comments and comment likes appear without a refresh
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profile_projects', 'profile_project_comments', 'profile_project_likes', 'profile_reposts', 'profile_comment_likes']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
