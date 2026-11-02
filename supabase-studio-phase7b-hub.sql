-- SPECSOFT® Studio, PHASE 7b: show published Studio projects on the Projects hub.
-- PROPOSAL: read it, then run it in the Supabase SQL Editor. Safe to run more than once.
-- Run these first: supabase-profiles.sql, supabase-studio-phase7.sql (and supabase-hub.sql, which the hub already needs).
--
-- What it does: ONE new column on studio_published, hub_project_id. It remembers which profile_projects row (the card on
-- the Projects hub) belongs to a published Studio project, so republishing UPDATES that card instead of making a copy.
-- The card is a normal profile project: likes, comments, reposts and reports keep working exactly as they do today.
-- If that card is ever deleted, hub_project_id becomes null by itself (on delete set null).
--
-- Security: the policies below are re-created with one extra rule: hub_project_id must point to a project YOU own.
-- Nothing else changes: no table is dropped, no data is touched.

alter table public.studio_published
  add column if not exists hub_project_id uuid references public.profile_projects(id) on delete set null;

drop policy if exists "studio published insert own" on public.studio_published;
drop policy if exists "studio published update own" on public.studio_published;

create policy "studio published insert own" on public.studio_published for insert to authenticated
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.studio_projects p where p.id = studio_published.project_id and p.owner_id = auth.uid())
    and (release_id is null or exists (select 1 from public.studio_releases r where r.id = studio_published.release_id and r.project_id = studio_published.project_id and r.owner_id = auth.uid()))
    and (hub_project_id is null or exists (select 1 from public.profile_projects h where h.id = studio_published.hub_project_id and h.owner_id = auth.uid()))
  );

create policy "studio published update own" on public.studio_published for update to authenticated
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and (release_id is null or exists (select 1 from public.studio_releases r where r.id = studio_published.release_id and r.project_id = studio_published.project_id and r.owner_id = auth.uid()))
    and (hub_project_id is null or exists (select 1 from public.profile_projects h where h.id = studio_published.hub_project_id and h.owner_id = auth.uid()))
  );