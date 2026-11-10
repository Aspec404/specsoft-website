-- SPECSOFT Spectra AI: bug reports from Settings > Report bug.
-- Run once in Supabase > SQL Editor. Only the edge function (service role) writes here; read reports in Table Editor.
create table if not exists public.spectra_bug_reports (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null check (category in ('bug','answer','idea','other')),
  message    text not null,
  info       text,
  chat       jsonb,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists spectra_bug_reports_created_idx on public.spectra_bug_reports (created_at desc);
alter table public.spectra_bug_reports enable row level security;
-- no policies on purpose: nobody can read or write from the browser, only the service role (edge function) can.
