-- SPECSOFT® Studio, PHASE 8.5c: project Assets (images and text files).
-- REVIEW FIRST, then run ONCE in the Supabase SQL Editor. Safe to run again (it drops and recreates only its own policies and triggers).
--
-- What it creates
--   1. table  public.studio_assets   one row per uploaded file (name, size, type, storage path). Owner-only (row level security).
--   2. bucket studio-assets          PRIVATE storage bucket. 5 MB per file, only png / jpeg / gif / webp / text.
--   3. policies on storage.objects   a person can only read, add and delete files inside the folder named after their own user id.
--   4. two triggers                  quota (60 files and 20 MB per project) and "only the name may change" on updates.
--
-- ASSUMPTIONS (please check before running, because I have not seen supabase-studio.sql):
--   * public.studio_projects.id is of type uuid and public.studio_projects.owner_id is the owner's auth user id.
--     Check with:
--       select column_name, data_type from information_schema.columns
--       where table_schema = 'public' and table_name = 'studio_projects' and column_name in ('id', 'owner_id');
--     If id is NOT uuid, tell me and I will change the project_id column type.
--
-- LIMITS TO KNOW
--   * The 5 MB file limit and allowed types are enforced by the bucket itself (server side).
--   * The 60 files / 20 MB quota counts rows in studio_assets. Someone who calls the storage API directly could still upload
--     objects without a row, up to the bucket's per-file limit. They stay private to that person and count against your storage.

-- 1. table ---------------------------------------------------------------------------------------------------------------
create table if not exists public.studio_assets (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.studio_projects(id) on delete cascade,
    owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name        text not null,
    path        text not null unique,
    mime        text not null,
    size        integer not null,
    created_at  timestamptz not null default now(),
    constraint studio_assets_name_chk check (name ~ '^[A-Za-z0-9._-]{1,60}$'),
    constraint studio_assets_mime_chk check (mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain')),
    constraint studio_assets_size_chk check (size > 0 and size <= 5000000),
    constraint studio_assets_project_name_uq unique (project_id, name)
);
create index if not exists studio_assets_project_idx on public.studio_assets (project_id);

alter table public.studio_assets enable row level security;

drop policy if exists "studio_assets_select_own" on public.studio_assets;
create policy "studio_assets_select_own" on public.studio_assets
    for select using (owner_id = auth.uid());

drop policy if exists "studio_assets_insert_own" on public.studio_assets;
create policy "studio_assets_insert_own" on public.studio_assets
    for insert with check (
        owner_id = auth.uid()
        and exists (select 1 from public.studio_projects p where p.id = project_id and p.owner_id = auth.uid())
    );

drop policy if exists "studio_assets_update_own" on public.studio_assets;
create policy "studio_assets_update_own" on public.studio_assets
    for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "studio_assets_delete_own" on public.studio_assets;
create policy "studio_assets_delete_own" on public.studio_assets
    for delete using (owner_id = auth.uid());

-- 2. quota trigger (60 files and 20 MB per project) ------------------------------------------------------------------------
create or replace function public.studio_assets_quota() returns trigger
language plpgsql as $$
declare
    n integer;
    total bigint;
begin
    select count(*), coalesce(sum(size), 0) into n, total from public.studio_assets where project_id = new.project_id;
    if n >= 60 then raise exception 'A project can hold at most 60 assets'; end if;
    if total + new.size > 20000000 then raise exception 'A project can hold at most 20 MB of assets'; end if;
    return new;
end;
$$;
drop trigger if exists studio_assets_quota on public.studio_assets;
create trigger studio_assets_quota before insert on public.studio_assets
    for each row execute function public.studio_assets_quota();

-- 3. only the name may change on update ---------------------------------------------------------------------------------------
create or replace function public.studio_assets_name_only() returns trigger
language plpgsql as $$
begin
    if new.id <> old.id or new.project_id <> old.project_id or new.owner_id <> old.owner_id
       or new.path <> old.path or new.mime <> old.mime or new.size <> old.size then
        raise exception 'Only the name of an asset can be changed';
    end if;
    return new;
end;
$$;
drop trigger if exists studio_assets_name_only on public.studio_assets;
create trigger studio_assets_name_only before update on public.studio_assets
    for each row execute function public.studio_assets_name_only();

-- 4. private storage bucket ------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-assets', 'studio-assets', false, 5000000, array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'])
on conflict (id) do update
    set public = false, file_size_limit = 5000000,
        allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'];

-- Files live at  <user id>/<project id>/<random id>,  so the first folder name must be the signed-in user's id.
drop policy if exists "studio_assets_objects_select" on storage.objects;
create policy "studio_assets_objects_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'studio-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "studio_assets_objects_insert" on storage.objects;
create policy "studio_assets_objects_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'studio-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "studio_assets_objects_delete" on storage.objects;
create policy "studio_assets_objects_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'studio-assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- (There is deliberately no update policy on storage: files are never overwritten, only added or deleted.)

-- To undo everything later (this DELETES all assets):
--   drop table if exists public.studio_assets cascade;
--   drop function if exists public.studio_assets_quota();
--   drop function if exists public.studio_assets_name_only();
--   drop policy if exists "studio_assets_objects_select" on storage.objects;
--   drop policy if exists "studio_assets_objects_insert" on storage.objects;
--   drop policy if exists "studio_assets_objects_delete" on storage.objects;
--   (then empty and delete the studio-assets bucket in Storage)
