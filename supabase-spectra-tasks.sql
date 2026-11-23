-- ===== RUN ONCE: Supabase > SQL Editor =====
-- SPECSOFT® Spectra Academics: My Tasks (spectra-tasks.js). Safe to run again.
-- "Missing" is NOT stored: the page works it out (not completed + due date already passed).

create table if not exists public.spectra_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  subject      text not null default '' check (char_length(subject) <= 40),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status       text not null default 'pending' check (status in ('pending', 'ongoing', 'completed')),
  due          date,
  notes        text not null default '' check (char_length(notes) <= 600),
  subtasks     jsonb not null default '[]'::jsonb check (jsonb_typeof(subtasks) = 'array' and jsonb_array_length(subtasks) <= 20),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists spectra_tasks_user_idx on public.spectra_tasks (user_id, created_at desc);

-- keeps updated_at fresh and stops one account from piling up more than 500 tasks
create or replace function public.spectra_tasks_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.spectra_tasks where user_id = new.user_id) >= 500 then
      raise exception 'Task limit reached';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists spectra_tasks_guard_t on public.spectra_tasks;
create trigger spectra_tasks_guard_t
  before insert or update on public.spectra_tasks
  for each row execute function public.spectra_tasks_guard();

-- each person only ever sees and changes their own tasks
alter table public.spectra_tasks enable row level security;

drop policy if exists "tasks select own" on public.spectra_tasks;
drop policy if exists "tasks insert own" on public.spectra_tasks;
drop policy if exists "tasks update own" on public.spectra_tasks;
drop policy if exists "tasks delete own" on public.spectra_tasks;

create policy "tasks select own" on public.spectra_tasks for select to authenticated using (auth.uid() = user_id);
create policy "tasks insert own" on public.spectra_tasks for insert to authenticated with check (auth.uid() = user_id);
create policy "tasks update own" on public.spectra_tasks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks delete own" on public.spectra_tasks for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.spectra_tasks to authenticated;
