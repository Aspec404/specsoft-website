-- SPECSOFT® Studio, PHASE 7c: SHARING. The owner decides whether visitors can copy a published project.
-- PROPOSAL: read it, then run it in the Supabase SQL Editor. Safe to run more than once.
-- Run these first: supabase-studio.sql, supabase-studio-phase7.sql, supabase-studio-phase7b-hub.sql.
--
-- THREE MODES (the owner picks one on the Publish page):
--   none      No copy (the default). Visitors can open the project and nothing else.
--   free      Free copy. Any SIGNED-IN member can copy it into their own Studio.
--   password  Password to copy. Signed-in members need the password the owner set.
--
-- HOW IT STAYS SAFE
--   * The copy needs the project's graph, so a release now CAN carry a snapshot of the graph (studio_releases.graph).
--     It is only stored when the owner publishes with Free copy or Password, it is never returned by studio_open(), and
--     it is never readable by visitors: the only way it leaves the database is studio_copy(), and only after the checks.
--   * The password is never stored as text: only a bcrypt hash (like the Classified files). The browser never sees the
--     hash of anyone else's project, and a wrong password costs a short delay on the server.
--   * Copying creates a NEW project owned by the visitor (their limit of 20 projects applies). It never touches the original.
--   * Releases stay immutable. Switching a project from No copy to Free copy applies to releases published AFTER the
--     switch (older releases have no graph snapshot, so they report "cannot copy" until a new release is published).
--
-- HONEST LIMIT: whatever a visitor can OPEN, a determined visitor can read. A published page runs in their browser, and a
-- "Source code" release shows its files on purpose. "No copy" and the password stop the Make a copy button and the stored
-- project data; they cannot hide code that is already being shown.

create extension if not exists pgcrypto with schema extensions;

-- ============ 1. columns ============
alter table public.studio_published add column if not exists sharing   text not null default 'none';
alter table public.studio_published add column if not exists pass_hash text;

alter table public.studio_published drop constraint if exists studio_pub_sharing;
alter table public.studio_published add  constraint studio_pub_sharing check (sharing in ('free', 'password', 'none'));
alter table public.studio_published drop constraint if exists studio_pub_pass_needed;
alter table public.studio_published add  constraint studio_pub_pass_needed check (sharing <> 'password' or pass_hash is not null);

alter table public.studio_releases add column if not exists graph jsonb;
alter table public.studio_releases drop constraint if exists studio_releases_graph_len;
alter table public.studio_releases add  constraint studio_releases_graph_len check (graph is null or octet_length(graph::text) <= 500000);

-- ============ 2. owner: choose the mode (the ONLY place a password is hashed) ============
-- p_password is only used for 'password'. Empty password + mode 'password' keeps the current password if there is one.
create or replace function public.studio_set_sharing(p_project uuid, p_mode text, p_password text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pw  text := coalesce(p_password, '');
  v_has boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_mode is null or p_mode not in ('free', 'password', 'none') then return jsonb_build_object('ok', false, 'error', 'bad_mode'); end if;

  select (pass_hash is not null) into v_has
  from public.studio_published where project_id = p_project and owner_id = v_uid;
  if v_has is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if p_mode = 'password' then
    if v_pw = '' then
      if not v_has then return jsonb_build_object('ok', false, 'error', 'password_required'); end if;
      update public.studio_published set sharing = 'password' where project_id = p_project and owner_id = v_uid;
    else
      if char_length(v_pw) not between 4 and 60 then return jsonb_build_object('ok', false, 'error', 'bad_password'); end if;
      update public.studio_published
         set sharing = 'password', pass_hash = extensions.crypt(v_pw, extensions.gen_salt('bf', 8))
       where project_id = p_project and owner_id = v_uid;
    end if;
  else
    update public.studio_published set sharing = p_mode, pass_hash = null where project_id = p_project and owner_id = v_uid;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ============ 3. visitors: what does this project allow? (no secrets) ============
create or replace function public.studio_share_info(p_slug text)
returns table (sharing text, can_copy boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.sharing, (p.sharing <> 'none' and r.graph is not null)
  from public.studio_published p
  join public.studio_releases r on r.id = p.release_id
  where p.slug = lower(p_slug) and p.visibility in ('public', 'unlisted') and p.release_id is not null
  limit 1
$$;

-- ============ 4. visitors: make a copy (signed in only) ============
create or replace function public.studio_copy(p_slug text, p_password text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_pub   public.studio_published;
  v_graph jsonb;
  v_id    uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;

  select p.* into v_pub
  from public.studio_published p
  where p.slug = lower(p_slug) and p.visibility in ('public', 'unlisted') and p.release_id is not null;
  if v_pub.project_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select r.graph into v_graph from public.studio_releases r where r.id = v_pub.release_id;
  if v_pub.sharing = 'none' or v_graph is null then return jsonb_build_object('ok', false, 'error', 'copy_not_allowed'); end if;

  if v_pub.sharing = 'password' then
    -- fail closed: anything that is not a clear match (including NULL) is a wrong password
    if not coalesce(
         v_pub.pass_hash is not null
         and char_length(coalesce(p_password, '')) between 1 and 60
         and extensions.crypt(p_password, v_pub.pass_hash) = v_pub.pass_hash, false) then
      perform pg_sleep(0.8);   -- slows down guessing
      return jsonb_build_object('ok', false, 'error', 'bad_password');
    end if;
  end if;

  if (select count(*) from public.studio_projects s where s.owner_id = v_uid) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'project_limit');
  end if;

  insert into public.studio_projects (owner_id, title, graph)
  values (v_uid, left(v_pub.title, 52) || ' (copy)', v_graph)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ============ 5. who can call what ============
revoke all on function public.studio_set_sharing(uuid, text, text) from public, anon, authenticated;
revoke all on function public.studio_share_info(text)              from public, anon, authenticated;
revoke all on function public.studio_copy(text, text)              from public, anon, authenticated;
grant execute on function public.studio_set_sharing(uuid, text, text) to authenticated;
grant execute on function public.studio_share_info(text)              to anon, authenticated;
grant execute on function public.studio_copy(text, text)              to authenticated;

-- NOTE: studio_open(slug) is NOT changed: it still returns only the page, never the graph or the password hash.
-- NOTE: the owner's own "read own" policy on studio_published returns the pass_hash column to the owner's browser
--       (a bcrypt hash of their own password). It is never readable by anyone else.
