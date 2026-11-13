-- ==========================================================================
-- SPECSOFT® HUB v3: THE NEW POST COMPOSER
-- Run AFTER supabase-hub-v2.sql. Safe to run more than once.
--
-- WHAT THIS DOES
--   1. profile_projects: doc (formatted text as safe data), visibility, status, status_label
--   2. post-media bucket: files up to 50 MB (videos). Images stay 10 MB and files 25 MB in the composer.
--   3. WHO CAN SEE A ROW: public / followers only / people I follow / only me (enforced by the database, not by the page)
--
-- BEFORE YOU RUN IT (step 3 replaces your read policy "projects are public"):
--   * it needs the table profile_follows(follower_id, following_id), the one profile.js already uses
--   * after running it, test with a second account: a "Only me" post must NOT show for them, in the hub or on the profile
--
-- NOTE ON 50 MB: Supabase has its own project-wide upload limit (Dashboard > Storage > Settings).
-- It must be 50 MB or more, or videos will be refused no matter what this file says.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) NEW COLUMNS
-- --------------------------------------------------------------------------
alter table public.profile_projects add column if not exists doc          jsonb;
alter table public.profile_projects add column if not exists visibility   text not null default 'public';
alter table public.profile_projects add column if not exists status       text;
alter table public.profile_projects add column if not exists status_label text;

alter table public.profile_projects drop constraint if exists projects_visibility_check;
alter table public.profile_projects add  constraint projects_visibility_check
  check (visibility in ('public', 'followers', 'following', 'private'));

alter table public.profile_projects drop constraint if exists projects_status_check;
alter table public.profile_projects add  constraint projects_status_check
  check (status is null or status in ('work', 'updates', 'milestones', 'education', 'awareness', 'development', 'teams', 'custom'));

alter table public.profile_projects drop constraint if exists projects_status_label_len;
alter table public.profile_projects add  constraint projects_status_label_len
  check (status_label is null or char_length(status_label) between 1 and 24);

-- the formatted text is plain data; keep it small (the plain text in "body" is still limited to 5000 characters)
alter table public.profile_projects drop constraint if exists projects_doc_len;
alter table public.profile_projects add  constraint projects_doc_len
  check (doc is null or octet_length(doc::text) <= 60000);

create index if not exists profile_projects_visibility_idx on public.profile_projects (visibility);


-- --------------------------------------------------------------------------
-- 2) STORAGE: post-media now takes videos up to 50 MB
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media', 'post-media', true, 52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
        'application/pdf', 'application/zip', 'application/json', 'text/plain', 'text/markdown']
)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;


-- --------------------------------------------------------------------------
-- 3) WHO CAN SEE A PROJECT OR POST
--    public     : everyone
--    followers  : the owner, and people who follow the owner
--    following  : the owner, and people the owner follows
--    private    : only the owner
--    hub_projects() and hub_stats() are not "security definer", so they obey this policy by themselves.
-- --------------------------------------------------------------------------
drop policy if exists "projects are public"          on public.profile_projects;
drop policy if exists "projects visible by setting"  on public.profile_projects;

create policy "projects visible by setting"
  on public.profile_projects for select
  using (
    visibility = 'public'
    or owner_id = auth.uid()
    or (
      visibility = 'followers' and auth.uid() is not null and exists (
        select 1 from public.profile_follows f
        where f.follower_id = auth.uid() and f.following_id = profile_projects.owner_id
      )
    )
    or (
      visibility = 'following' and auth.uid() is not null and exists (
        select 1 from public.profile_follows f
        where f.follower_id = profile_projects.owner_id and f.following_id = auth.uid()
      )
    )
  );
