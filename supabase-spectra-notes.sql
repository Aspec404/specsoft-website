-- Spectra Academics: Notes (v1)
-- Run this once in the Supabase SQL editor. Safe to run again.

create table if not exists public.spectra_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Untitled note' check (char_length(title) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 20000),
  category    text not null default 'General Knowledge' check (char_length(category) between 1 and 40),
  source_chat text check (source_chat is null or char_length(source_chat) <= 60),
  source_msg  text check (source_msg is null or char_length(source_msg) <= 60),
  pinned      boolean not null default false,
  bookmarked  boolean not null default false,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists spectra_notes_user_updated on public.spectra_notes (user_id, updated_at desc);
create index if not exists spectra_notes_user_msg on public.spectra_notes (user_id, source_msg);

-- every person only ever sees and changes their own notes
alter table public.spectra_notes enable row level security;

drop policy if exists "notes select own" on public.spectra_notes;
drop policy if exists "notes insert own" on public.spectra_notes;
drop policy if exists "notes update own" on public.spectra_notes;
drop policy if exists "notes delete own" on public.spectra_notes;
create policy "notes select own" on public.spectra_notes for select using (auth.uid() = user_id);
create policy "notes insert own" on public.spectra_notes for insert with check (auth.uid() = user_id);
create policy "notes update own" on public.spectra_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes delete own" on public.spectra_notes for delete using (auth.uid() = user_id);

-- updated_at moves on every change; user_id can never be switched to someone else
create or replace function public.spectra_notes_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  return new;
end $$;

drop trigger if exists spectra_notes_touch on public.spectra_notes;
create trigger spectra_notes_touch before update on public.spectra_notes
  for each row execute function public.spectra_notes_touch();

-- at most 300 notes per person (keeps the table small)
create or replace function public.spectra_notes_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.spectra_notes where user_id = new.user_id) >= 300 then
    raise exception 'Note limit reached (300)';
  end if;
  return new;
end $$;

drop trigger if exists spectra_notes_limit on public.spectra_notes;
create trigger spectra_notes_limit before insert on public.spectra_notes
  for each row execute function public.spectra_notes_limit();

grant select, insert, update, delete on public.spectra_notes to authenticated;
