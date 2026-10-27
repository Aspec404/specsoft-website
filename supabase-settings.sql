-- ==========================================================================
-- SPECSOFT® user settings: one row per account, synced across devices
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL of this
-- > Run. It is safe to run more than once.
--
-- SECURITY: Row Level Security is ON. A member can only read, create, edit or
-- delete THEIR OWN row. Settings are preferences only; nothing here decides
-- bans, roles or admin access.
-- ==========================================================================

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings drop constraint if exists user_settings_shape;
alter table public.user_settings add constraint user_settings_shape
  check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 20000);

alter table public.user_settings enable row level security;

drop policy if exists "members read own settings"   on public.user_settings;
drop policy if exists "members create own settings" on public.user_settings;
drop policy if exists "members edit own settings"   on public.user_settings;
drop policy if exists "members delete own settings" on public.user_settings;

create policy "members read own settings" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "members create own settings" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "members edit own settings" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "members delete own settings" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;
