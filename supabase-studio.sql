-- SPECSOFT® Studio, PHASE 1: studio_projects only.
-- Run supabase-profiles.sql first. Safe to run more than once.
-- RLS is ON: members can only see and change their OWN studio projects.
-- The graph column holds the whole node graph as JSON (used from Phase 2).
create table if not exists public.studio_projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'Untitled project',
  graph       jsonb not null default '{"nodes":[],"connections":[]}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint studio_title_len check (char_length(title) between 1 and 60),
  constraint studio_graph_len check (octet_length(graph::text) <= 500000)
);
create index if not exists studio_projects_owner_idx on public.studio_projects (owner_id, updated_at desc);
alter table public.studio_projects enable row level security;
drop policy if exists "studio read own"   on public.studio_projects;
drop policy if exists "studio insert own" on public.studio_projects;
drop policy if exists "studio update own" on public.studio_projects;
drop policy if exists "studio delete own" on public.studio_projects;
create policy "studio read own" on public.studio_projects for select to authenticated using (auth.uid() = owner_id);
create policy "studio insert own" on public.studio_projects for insert to authenticated
  with check (auth.uid() = owner_id and (select count(*) from public.studio_projects s where s.owner_id = auth.uid()) < 20);
create policy "studio update own" on public.studio_projects for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "studio delete own" on public.studio_projects for delete to authenticated using (auth.uid() = owner_id);
create or replace function public.studio_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists studio_touch_trg on public.studio_projects;
create trigger studio_touch_trg before update on public.studio_projects for each row execute function public.studio_touch();
