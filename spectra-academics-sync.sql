-- Spectra Academics: cloud-synced chats + projects (run once in Supabase > SQL Editor)
-- One row per chat or project. Deleting a chat just marks the row deleted, so your other devices find out.

create table if not exists public.spectra_acad_items (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text        not null check (kind in ('chat', 'project')),
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  u          bigint      not null default 0,          -- client "last edited" stamp (ms), used to decide which copy wins
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists spectra_acad_items_user_updated
  on public.spectra_acad_items (user_id, updated_at);

-- keep updated_at honest on every write
create or replace function public.spectra_acad_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists spectra_acad_touch on public.spectra_acad_items;
create trigger spectra_acad_touch before insert or update on public.spectra_acad_items
  for each row execute function public.spectra_acad_touch();

-- each person only ever sees and writes their own rows
alter table public.spectra_acad_items enable row level security;

drop policy if exists "own items" on public.spectra_acad_items;
create policy "own items" on public.spectra_acad_items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.spectra_acad_items to authenticated;

-- live updates between devices (open the app on your phone, chat on your laptop, it shows up)
do $$
begin
  alter publication supabase_realtime add table public.spectra_acad_items;
exception when duplicate_object then null;
end $$;

-- OPTIONAL, run now and then: forget deleted chats older than 30 days
-- delete from public.spectra_acad_items where deleted and updated_at < now() - interval '30 days';
