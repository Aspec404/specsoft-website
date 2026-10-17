-- ==========================================================================
-- SPECSOFT® profiles: tables, security rules and image storage
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL of this
-- > Run. It is safe to run more than once.
--
-- WHAT THIS CREATES
--   profiles            one public profile per account
--   profile_projects    projects a member posts on their profile
--   profile_highlights  the small "story ring" highlights on a profile
--   avatars / banners   public image buckets (members can only write to
--                       their own folder)
--
-- SECURITY: Row Level Security (RLS) is ON for every table. Anyone can READ
-- profiles (that is what makes them public), but only the owner can create,
-- edit or delete their own rows. Emails are NEVER stored here.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) PROFILES
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null,
  display_name  text,
  headline      text,
  bio           text,
  location      text,
  avatar_url    text,
  banner_url    text,
  background_url text,
  banner_preset text not null default 'grid',
  theme         jsonb not null default '{"primary":"#7c3aed","secondary":"#22d3ee","top":"#0f172a","bottom":"#1e293b"}'::jsonb,
  display_style jsonb not null default '{"font":"default","style":"solid","animated":false,"gradientColors":["#7c3aed","#22d3ee","#f472b6","#fbbf24","#a78bfa"],"glowColor":"#7c3aed"}'::jsonb,
  status        text not null default 'online',
  skills        text[] not null default '{}',
  links         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_status_valid    check (status in ('online', 'idle', 'dnd', 'offline')),
  constraint profiles_preset_valid    check (banner_preset in ('grid', 'rings', 'scan', 'dots', 'diag', 'wave')),
  constraint profiles_theme_len       check (octet_length(theme::text) <= 1000),
  constraint profiles_display_len     check (display_name is null or char_length(display_name) <= 40),
  constraint profiles_headline_len    check (headline is null or char_length(headline) <= 80),
  constraint profiles_location_len    check (location is null or char_length(location) <= 40),
  constraint profiles_bio_len         check (bio is null or char_length(bio) <= 500),
  constraint profiles_skills_len      check (cardinality(skills) <= 12),
  constraint profiles_links_len       check (octet_length(links::text) <= 1500),
  constraint profiles_avatar_https    check (avatar_url is null or avatar_url ~ '^https://'),
  constraint profiles_banner_https    check (banner_url is null or banner_url ~ '^https://'),
  constraint profiles_background_https check (background_url is null or background_url ~ '^https://')
);

-- usernames are unique no matter the capital letters (Alex = alex)
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create index if not exists profiles_created_idx
  on public.profiles (created_at desc);

-- older installs of this script did not have these two columns yet,
-- so add them first (does nothing if they already exist)
alter table public.profiles
  add column if not exists theme jsonb not null default '{"primary":"#7c3aed","secondary":"#22d3ee","top":"#0f172a","bottom":"#1e293b"}'::jsonb;

alter table public.profiles
  add column if not exists background_url text;

alter table public.profiles
  add column if not exists display_style jsonb not null default '{"font":"default","style":"solid","animated":false,"gradientColors":["#7c3aed","#22d3ee","#f472b6","#fbbf24","#a78bfa"],"glowColor":"#7c3aed"}'::jsonb;

alter table public.profiles
  alter column theme set default '{"primary":"#7c3aed","secondary":"#22d3ee","top":"#0f172a","bottom":"#1e293b"}'::jsonb;

alter table public.profiles
  add column if not exists display_style jsonb not null default '{"font":"default","style":"solid","animated":false,"gradientColors":["#7c3aed","#22d3ee","#f472b6","#fbbf24","#a78bfa"],"glowColor":"#7c3aed"}'::jsonb;

update public.profiles
set theme = coalesce(
  theme,
  '{"primary":"#7c3aed","secondary":"#22d3ee","top":"#0f172a","bottom":"#1e293b"}'::jsonb
)
where theme is null;

update public.profiles
set display_style = coalesce(
  display_style,
  '{"font":"default","style":"solid","animated":false,"gradientColors":["#7c3aed","#22d3ee","#f472b6","#fbbf24","#a78bfa"],"glowColor":"#7c3aed"}'::jsonb
)
where display_style is null;

-- SECURITY: colors must be plain #rrggbb. Without this a member could save
-- something like url(https://tracker...) as a "color" and every visitor's
-- browser would call it when viewing their profile.
alter table public.profiles drop constraint if exists profiles_theme_len;
alter table public.profiles drop constraint if exists profiles_style_len;
alter table public.profiles drop constraint if exists profiles_theme_colors;
alter table public.profiles drop constraint if exists profiles_style_colors;

alter table public.profiles add constraint profiles_theme_len
  check (octet_length(theme::text) <= 1000);

alter table public.profiles add constraint profiles_style_len
  check (octet_length(display_style::text) <= 1000);

alter table public.profiles add constraint profiles_theme_colors check (
      theme->>'primary'   ~ '^#[0-9a-fA-F]{6}$'
  and theme->>'secondary' ~ '^#[0-9a-fA-F]{6}$'
  and theme->>'top'       ~ '^#[0-9a-fA-F]{6}$'
  and theme->>'bottom'    ~ '^#[0-9a-fA-F]{6}$'
);

alter table public.profiles add constraint profiles_style_colors check (
      (display_style->>'glowColor') ~ '^#[0-9a-fA-F]{6}$'
  and ((display_style->'gradientColors')::text) ~ '^\["#[0-9a-fA-F]{6}"(, ?"#[0-9a-fA-F]{6}"){0,4}\]$'
  and (display_style->>'font') in ('default','tempo','lora','medieval','pixel','typewriter','sakura','mainframe','aesthetic')
  and (display_style->>'style') in ('solid','gradient','neon','prism','pop')
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are public"        on public.profiles;
drop policy if exists "members create own profile" on public.profiles;
drop policy if exists "members edit own profile"   on public.profiles;
drop policy if exists "members delete own profile" on public.profiles;

create policy "profiles are public"
  on public.profiles for select
  using (true);

create policy "members create own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "members edit own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "members delete own profile"
  on public.profiles for delete to authenticated
  using (auth.uid() = id);


-- --------------------------------------------------------------------------
-- 2) PROJECTS (max 12 per member)
-- --------------------------------------------------------------------------
create table if not exists public.profile_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  summary    text,
  url        text,
  repo_url   text,
  cover_url  text,
  video_url  text,
  tags       text[] not null default '{}',
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),

  constraint projects_title_len   check (char_length(title) between 1 and 60),
  constraint projects_summary_len check (summary is null or char_length(summary) <= 280),
  constraint projects_tags_len    check (cardinality(tags) <= 6),
  constraint projects_url_https   check (url       is null or url       ~ '^https://'),
  constraint projects_repo_https  check (repo_url  is null or repo_url  ~ '^https://'),
  constraint projects_cover_https check (cover_url is null or cover_url ~ '^https://'),
  constraint projects_video_https check (video_url is null or video_url ~ '^https://')
);

alter table public.profile_projects
  add column if not exists video_url text;

create table if not exists public.profile_project_likes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.profile_projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists profile_projects_owner_idx
  on public.profile_projects (owner_id, created_at desc);

create index if not exists profile_project_likes_project_idx
  on public.profile_project_likes (project_id, created_at desc);

alter table public.profile_projects enable row level security;
alter table public.profile_project_likes enable row level security;

drop policy if exists "projects are public"      on public.profile_projects;
drop policy if exists "members add own projects" on public.profile_projects;
drop policy if exists "members edit own projects" on public.profile_projects;
drop policy if exists "members delete own projects" on public.profile_projects;
drop policy if exists "project likes are public" on public.profile_project_likes;
drop policy if exists "members can like projects" on public.profile_project_likes;
drop policy if exists "members can undo own likes" on public.profile_project_likes;

create policy "projects are public"
  on public.profile_projects for select
  using (true);

create policy "members add own projects"
  on public.profile_projects for insert to authenticated
  with check (
    auth.uid() = owner_id
    and (select count(*) from public.profile_projects p where p.owner_id = auth.uid()) < 12
  );

create policy "members edit own projects"
  on public.profile_projects for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "members delete own projects"
  on public.profile_projects for delete to authenticated
  using (auth.uid() = owner_id);

create policy "project likes are public"
  on public.profile_project_likes for select
  using (true);

create policy "members can like projects"
  on public.profile_project_likes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "members can undo own likes"
  on public.profile_project_likes for delete to authenticated
  using (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 3) HIGHLIGHTS (max 10 per member)
-- --------------------------------------------------------------------------
create table if not exists public.profile_highlights (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  icon       text not null default '★',
  body       text,
  created_at timestamptz not null default now(),

  constraint highlights_title_len check (char_length(title) between 1 and 24),
  constraint highlights_icon_len  check (char_length(icon) between 1 and 4),
  constraint highlights_body_len  check (body is null or char_length(body) <= 280)
);

create index if not exists profile_highlights_owner_idx
  on public.profile_highlights (owner_id, created_at);

alter table public.profile_highlights enable row level security;

drop policy if exists "highlights are public"        on public.profile_highlights;
drop policy if exists "members add own highlights"   on public.profile_highlights;
drop policy if exists "members edit own highlights"  on public.profile_highlights;
drop policy if exists "members delete own highlights" on public.profile_highlights;

create policy "highlights are public"
  on public.profile_highlights for select
  using (true);

create policy "members add own highlights"
  on public.profile_highlights for insert to authenticated
  with check (
    auth.uid() = owner_id
    and (select count(*) from public.profile_highlights h where h.owner_id = auth.uid()) < 10
  );

create policy "members edit own highlights"
  on public.profile_highlights for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "members delete own highlights"
  on public.profile_highlights for delete to authenticated
  using (auth.uid() = owner_id);


-- --------------------------------------------------------------------------
-- 4) FOLLOWERS / FOLLOWING
-- --------------------------------------------------------------------------
create table if not exists public.profile_follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint profile_follows_no_self check (follower_id <> following_id),
  constraint profile_follows_unique unique (follower_id, following_id)
);

create index if not exists profile_follows_follower_idx
  on public.profile_follows (follower_id, created_at desc);

create index if not exists profile_follows_following_idx
  on public.profile_follows (following_id, created_at desc);

alter table public.profile_follows enable row level security;

drop policy if exists "follows are public"          on public.profile_follows;
drop policy if exists "members follow people"       on public.profile_follows;
drop policy if exists "members unfollow people"    on public.profile_follows;

drop policy if exists "members delete own follows" on public.profile_follows;

create policy "follows are public"
  on public.profile_follows for select
  using (true);

create policy "members follow people"
  on public.profile_follows for insert to authenticated
  with check (auth.uid() = follower_id);

create policy "members unfollow people"
  on public.profile_follows for delete to authenticated
  using (auth.uid() = follower_id);


-- --------------------------------------------------------------------------
-- 5) IMAGE STORAGE (avatars 2 MB, banners 3 MB, png/jpeg/webp only)
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('banners', 'banners', true, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sp media public read"   on storage.objects;
drop policy if exists "sp media upload own"    on storage.objects;
drop policy if exists "sp media replace own"   on storage.objects;
drop policy if exists "sp media delete own"    on storage.objects;

create policy "sp media public read"
  on storage.objects for select
  using (bucket_id in ('avatars', 'banners'));

-- a member can only write inside a folder named after their own user id
create policy "sp media upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "sp media replace own"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "sp media delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'banners')
    and (storage.foldername(name))[1] = auth.uid()::text
  );