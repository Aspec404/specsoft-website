-- SPECSOFT® Studio, PHASE 7: Version Control (snapshots) and Publishing (releases).
-- PROPOSAL: read it, then run it in the Supabase SQL Editor. Run supabase-studio.sql first. Safe to run more than once.
-- Nothing here changes studio_projects. Three new tables, all with RLS ON, plus one function for the public viewer.
--
--   studio_versions   manual snapshots of a project's graph (owner only, immutable: you can create and delete, not edit)
--   studio_releases   one row per published release: the built page (or the source files) + version number + notes (owner only)
--   studio_published  one row per project: its public listing (slug, title, visibility, which release is live)
--   studio_open(slug) the ONLY way visitors read a published project. It returns the live release of a public or unlisted
--                     project and nothing else, so private projects, old releases and unlisted slugs can never be listed.
--
-- Limits (change the numbers if you like): 15 snapshots per project, 50 releases per project, 300,000 characters per page.

-- ============ 1. Version Control: snapshots ============
create table if not exists public.studio_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  number      integer not null default 0,
  label       text not null default '',
  note        text not null default '',
  graph       jsonb not null,
  created_at  timestamptz not null default now(),
  constraint studio_versions_label_len check (char_length(label) <= 80),
  constraint studio_versions_note_len  check (char_length(note) <= 500),
  constraint studio_versions_graph_len check (octet_length(graph::text) <= 500000),
  constraint studio_versions_unique    unique (project_id, number)
);
create index if not exists studio_versions_project_idx on public.studio_versions (project_id, number desc);
alter table public.studio_versions enable row level security;
drop policy if exists "studio versions read own"   on public.studio_versions;
drop policy if exists "studio versions insert own" on public.studio_versions;
drop policy if exists "studio versions delete own" on public.studio_versions;
create policy "studio versions read own" on public.studio_versions for select to authenticated using (auth.uid() = owner_id);
create policy "studio versions insert own" on public.studio_versions for insert to authenticated
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.studio_projects p where p.id = studio_versions.project_id and p.owner_id = auth.uid())
    and (select count(*) from public.studio_versions v where v.project_id = studio_versions.project_id) < 15
  );
create policy "studio versions delete own" on public.studio_versions for delete to authenticated using (auth.uid() = owner_id);
-- no UPDATE policy on purpose: a snapshot never changes

create or replace function public.studio_version_number() returns trigger language plpgsql as $$
begin
  new.number = coalesce((select max(v.number) from public.studio_versions v where v.project_id = new.project_id), 0) + 1;
  return new;
end $$;
drop trigger if exists studio_version_number_trg on public.studio_versions;
create trigger studio_version_number_trg before insert on public.studio_versions for each row execute function public.studio_version_number();

-- ============ 2. Publishing: releases ============
create table if not exists public.studio_releases (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  version     text not null,
  notes       text not null default '',
  kind        text not null,
  bundle      text not null default '',
  files       jsonb,
  created_at  timestamptz not null default now(),
  constraint studio_releases_version_fmt check (version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'),
  constraint studio_releases_notes_len   check (char_length(notes) <= 500),
  constraint studio_releases_kind        check (kind in ('website', 'game', 'interactive', 'source')),
  constraint studio_releases_bundle_len  check (char_length(bundle) <= 300000),
  constraint studio_releases_files_len   check (files is null or octet_length(files::text) <= 300000),
  constraint studio_releases_has_content check ((kind = 'source' and files is not null) or (kind <> 'source' and char_length(bundle) > 0)),
  constraint studio_releases_unique      unique (project_id, version)
);
create index if not exists studio_releases_project_idx on public.studio_releases (project_id, created_at desc);
alter table public.studio_releases enable row level security;
drop policy if exists "studio releases read own"   on public.studio_releases;
drop policy if exists "studio releases insert own" on public.studio_releases;
drop policy if exists "studio releases delete own" on public.studio_releases;
create policy "studio releases read own" on public.studio_releases for select to authenticated using (auth.uid() = owner_id);
create policy "studio releases insert own" on public.studio_releases for insert to authenticated
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.studio_projects p where p.id = studio_releases.project_id and p.owner_id = auth.uid())
    and (select count(*) from public.studio_releases r where r.project_id = studio_releases.project_id) < 50
  );
create policy "studio releases delete own" on public.studio_releases for delete to authenticated using (auth.uid() = owner_id);
-- no UPDATE policy on purpose: a release never changes (rollback just points the listing at an older release)

-- ============ 3. Publishing: the listing (one per project) ============
create table if not exists public.studio_published (
  project_id   uuid primary key references public.studio_projects(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  slug         text not null unique,
  title        text not null,
  description  text not null default '',
  category     text not null default 'other',
  cover        text,
  visibility   text not null default 'private',
  release_id   uuid references public.studio_releases(id) on delete set null,
  published_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint studio_pub_slug_fmt   check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  constraint studio_pub_title_len  check (char_length(title) between 1 and 60),
  constraint studio_pub_desc_len   check (char_length(description) <= 300),
  constraint studio_pub_category   check (category in ('website', 'game', 'art', 'tool', 'education', 'other')),
  constraint studio_pub_visibility check (visibility in ('public', 'unlisted', 'private')),
  constraint studio_pub_cover      check (cover is null or (char_length(cover) <= 150000 and cover ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'))
);
alter table public.studio_published enable row level security;
drop policy if exists "studio published read own"   on public.studio_published;
drop policy if exists "studio published insert own" on public.studio_published;
drop policy if exists "studio published update own" on public.studio_published;
drop policy if exists "studio published delete own" on public.studio_published;
create policy "studio published read own" on public.studio_published for select to authenticated using (auth.uid() = owner_id);
create policy "studio published insert own" on public.studio_published for insert to authenticated
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.studio_projects p where p.id = studio_published.project_id and p.owner_id = auth.uid())
    and (release_id is null or exists (select 1 from public.studio_releases r where r.id = studio_published.release_id and r.project_id = studio_published.project_id and r.owner_id = auth.uid()))
  );
create policy "studio published update own" on public.studio_published for update to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and (release_id is null or exists (select 1 from public.studio_releases r where r.id = studio_published.release_id and r.project_id = studio_published.project_id and r.owner_id = auth.uid()))
  );
create policy "studio published delete own" on public.studio_published for delete to authenticated using (auth.uid() = owner_id);
drop trigger if exists studio_pub_touch_trg on public.studio_published;
create trigger studio_pub_touch_trg before update on public.studio_published for each row execute function public.studio_touch();

-- ============ 4. The public viewer: one function, read-only ============
-- Visitors (even signed-out) call studio_open('my-slug'). It only returns the LIVE release of a project that is
-- public or unlisted. It never returns private projects, other releases, owners' ids or the project graph.
create or replace function public.studio_open(p_slug text)
returns table (title text, description text, category text, cover text, kind text, version text, notes text, bundle text, files jsonb, released_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.title, p.description, p.category, p.cover, r.kind, r.version, r.notes, r.bundle, r.files, r.created_at
  from public.studio_published p
  join public.studio_releases r on r.id = p.release_id
  where p.slug = lower(p_slug) and p.visibility in ('public', 'unlisted') and p.release_id is not null
  limit 1
$$;
revoke all on function public.studio_open(text) from public;
grant execute on function public.studio_open(text) to anon, authenticated;
