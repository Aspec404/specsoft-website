-- ==========================================================================
-- SPECSOFT® homepage content RPCs: live team roster + live site stats
--
-- RUN ORDER: after supabase-profiles.sql and supabase-admin.sql.
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL > Run.
-- Safe to run more than once.
--
-- WHY THIS EXISTS: the homepage's "THE TEAM" and "BY THE NUMBERS" sections
-- show REAL numbers instead of made-up marketing copy. Both functions are
-- read-only, SECURITY DEFINER (same pattern as everything in
-- supabase-admin.sql), and granted to anon so a logged-out visitor can see
-- them too — nothing here exposes anything the person hasn't already made
-- visible on their own public profile (staff_credentials, staff_notes and
-- admin_audit_log are never touched).
-- ==========================================================================

create or replace function public.public_team_roster()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.created_at), '[]'::jsonb)
  from (
    select p.username, p.display_name, p.headline, p.avatar_url, p.links,
           s.level,
           case s.level when 'owner' then 0 when 'admin' then 1 else 2 end as rank,
           s.created_at
    from public.staff_members s
    join public.profiles p on p.id = s.user_id
  ) x
$$;

create or replace function public.public_site_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'members',  (select count(*) from public.profiles),
    'projects', (select count(*) from public.profile_projects),
    'likes',    (select count(*) from public.profile_project_likes),
    'staff',    (select count(*) from public.staff_members)
  );
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('public_team_roster', 'public_site_stats')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
