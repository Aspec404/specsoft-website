-- ==========================================================================
-- SPECSOFT® project social features: REPOSTS, COMMENTS, REPORTS + STATS
--
-- RUN supabase-profiles.sql FIRST (this needs profile_projects and
-- profile_project_likes from it).
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL of this
-- > Run. It is safe to run more than once.
--
-- SECURITY: Row Level Security is ON for every table.
--   * reposts and comments are public to read
--   * you can only add/remove YOUR OWN reposts and comments
--   * a project owner can also delete comments on their own project
--   * you cannot repost or report your own project
--   * limits: 8 comments per minute, 100 reposts per member
--   * reports can be written by members but NOT read by anyone on the site.
--     You review them in Supabase > Table Editor > profile_project_reports.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) REPOSTS
-- --------------------------------------------------------------------------
create table if not exists public.profile_reposts (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.profile_projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists profile_reposts_user_idx    on public.profile_reposts (user_id, created_at desc);
create index if not exists profile_reposts_project_idx on public.profile_reposts (project_id);

alter table public.profile_reposts enable row level security;

drop policy if exists "reposts are public"        on public.profile_reposts;
drop policy if exists "members repost others"     on public.profile_reposts;
drop policy if exists "members undo own repost"   on public.profile_reposts;

create policy "reposts are public"
  on public.profile_reposts for select
  using (true);

create policy "members repost others"
  on public.profile_reposts for insert to authenticated
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.profile_projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
    and (select count(*) from public.profile_reposts r where r.user_id = auth.uid()) < 100
  );

create policy "members undo own repost"
  on public.profile_reposts for delete to authenticated
  using (auth.uid() = user_id);


-- --------------------------------------------------------------------------
-- 2) COMMENTS
-- --------------------------------------------------------------------------
create table if not exists public.profile_project_comments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.profile_projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint project_comments_len check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists profile_project_comments_project_idx
  on public.profile_project_comments (project_id, created_at);

alter table public.profile_project_comments enable row level security;

drop policy if exists "comments are public"            on public.profile_project_comments;
drop policy if exists "members comment"                on public.profile_project_comments;
drop policy if exists "authors and owners delete comments" on public.profile_project_comments;

create policy "comments are public"
  on public.profile_project_comments for select
  using (true);

create policy "members comment"
  on public.profile_project_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      select count(*) from public.profile_project_comments c
      where c.user_id = auth.uid() and c.created_at > now() - interval '1 minute'
    ) < 8
  );

create policy "authors and owners delete comments"
  on public.profile_project_comments for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profile_projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );


-- --------------------------------------------------------------------------
-- 3) REPORTS (write-only for members; you read them in the dashboard)
-- --------------------------------------------------------------------------
create table if not exists public.profile_project_reports (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.profile_projects(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'inappropriate', 'harassment', 'copyright', 'other')),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  unique (project_id, reporter_id)
);

alter table public.profile_project_reports enable row level security;

drop policy if exists "members report others" on public.profile_project_reports;

create policy "members report others"
  on public.profile_project_reports for insert to authenticated
  with check (
    auth.uid() = reporter_id
    and not exists (
      select 1 from public.profile_projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );
-- (no select/update/delete policy on purpose: nobody on the website can read reports)


-- --------------------------------------------------------------------------
-- 4) STATS: likes, comments, reposts and "did I like/repost it" for many
--    projects in ONE request (replaces downloading every like row)
-- --------------------------------------------------------------------------
create or replace function public.profile_project_stats(p_ids uuid[])
returns table (
  project_id    uuid,
  like_count    bigint,
  comment_count bigint,
  repost_count  bigint,
  liked         boolean,
  reposted      boolean
)
language sql
stable
as $$
  select i.id,
         (select count(*) from public.profile_project_likes l    where l.project_id = i.id),
         (select count(*) from public.profile_project_comments c where c.project_id = i.id),
         (select count(*) from public.profile_reposts r          where r.project_id = i.id),
         exists (select 1 from public.profile_project_likes l where l.project_id = i.id and l.user_id = auth.uid()),
         exists (select 1 from public.profile_reposts r       where r.project_id = i.id and r.user_id = auth.uid())
  from unnest(p_ids[1:200]) as i(id);
$$;

grant execute on function public.profile_project_stats(uuid[]) to anon, authenticated;
