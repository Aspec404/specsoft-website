-- ==========================================================================
-- SPECSOFT® HUB (Phase 3): tasks, Spectra's Corner posts, Classified files
--
-- RUN ORDER: supabase-admin.sql FIRST (this uses its staff system), then this file.
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL > Run.
-- Safe to run more than once. Re-running never overwrites or duplicates the
-- starter content once the tables have rows.
--
-- WHERE THE SECURITY LIVES
--   Everyone can READ published Hub content (it is shown on a secret page, not a
--   vault). Nobody can WRITE from the website directly. Every change goes through
--   a function that calls admin_gate('admin'), so on the SERVER, on EVERY call:
--     1. you are signed in,
--     2. you are in staff_members as admin or owner,
--     3. you unlocked the admin panel with YOUR admin password this session.
--   Every save and delete is written to the same append-only audit log as the
--   Console, so you can see who published or removed what.
--
--   Classified files: the secret text and the clearance code are never readable
--   by the website. The code is stored only as a bcrypt hash, and the text only
--   comes back from hub_declassify() when the right code is sent.
--   (The public teaser IS public: never put a secret in it. Anything you wrap in
--   [[double brackets]] is blacked out by the database BEFORE it is stored.)
-- ==========================================================================

create extension if not exists pgcrypto with schema extensions;

-- --------------------------------------------------------------------------
-- 1) TABLES
-- --------------------------------------------------------------------------
create table if not exists public.hub_tasks (
  id         uuid primary key default gen_random_uuid(),
  tag        text not null check (tag ~ '^[A-Z0-9]{2,12}$'),
  status     text not null check (status in ('todo', 'doing', 'done')),
  title      text not null check (char_length(btrim(title)) between 2 and 80),
  descr      text not null default '' check (char_length(descr) <= 300),
  say        text check (say is null or char_length(say) <= 160),
  pos        int  not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hub_posts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('diary', 'story')),
  title      text not null check (char_length(btrim(title)) between 2 and 80),
  body       text not null check (char_length(btrim(body)) between 2 and 4000),
  published  boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hub_files (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(btrim(title)) between 2 and 80),
  teaser     text not null check (char_length(btrim(teaser)) between 2 and 400),
  hint       text check (hint is null or char_length(hint) <= 160),
  body       text not null check (char_length(btrim(body)) between 2 and 4000),
  code_hash  text not null,
  published  boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hub_tasks_pos_idx on public.hub_tasks (pos, created_at);
create index if not exists hub_posts_kind_idx on public.hub_posts (kind, created_at desc);

alter table public.hub_tasks enable row level security;
alter table public.hub_posts enable row level security;
alter table public.hub_files enable row level security;

drop policy if exists "hub tasks are public"        on public.hub_tasks;
drop policy if exists "hub posts: published are public" on public.hub_posts;
drop policy if exists "hub files: published teasers are public" on public.hub_files;
create policy "hub tasks are public"        on public.hub_tasks for select to anon, authenticated using (true);
create policy "hub posts: published are public" on public.hub_posts for select to anon, authenticated using (published);
create policy "hub files: published teasers are public" on public.hub_files for select to anon, authenticated using (published);

revoke all on public.hub_tasks, public.hub_posts, public.hub_files from anon, authenticated;
grant select on public.hub_tasks to anon, authenticated;
grant select (id, kind, title, body, created_at) on public.hub_posts to anon, authenticated;
-- body + code_hash of a classified file are deliberately NOT granted
grant select (id, title, teaser, hint, created_at) on public.hub_files to anon, authenticated;


-- --------------------------------------------------------------------------
-- 2) PUBLIC: declassify a file (the only way its secret text leaves the database)
-- --------------------------------------------------------------------------
create or replace function public.hub_declassify(p_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.hub_files;
  v_code text := lower(btrim(coalesce(p_code, '')));
begin
  select * into v_f from public.hub_files where id = p_id and published;
  if v_f.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if char_length(v_code) < 1 or char_length(v_code) > 60
     or extensions.crypt(v_code, v_f.code_hash) <> v_f.code_hash then
    perform pg_sleep(0.6);   -- slows down guessing
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  return jsonb_build_object('ok', true, 'body', v_f.body);
end;
$$;


-- --------------------------------------------------------------------------
-- 3) ADMINS ONLY: list everything (drafts included), save, delete
-- --------------------------------------------------------------------------
create or replace function public.hub_admin_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('admin', 'hub_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object(
    'ok', true,
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.pos, t.created_at) from public.hub_tasks t), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.hub_posts p), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(to_jsonb(f) - 'code_hash' order by f.created_at desc) from public.hub_files f), '[]'::jsonb)
  );
end;
$$;

create or replace function public.hub_admin_save(p_type text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_meta jsonb := jsonb_build_object('type', p_type);
  v_title text := btrim(coalesce(p_data ->> 'title', ''));
  v_pub boolean := coalesce((p_data ->> 'published')::boolean, false);
  v_text text;
  v_code text := lower(btrim(coalesce(p_data ->> 'code', '')));
begin
  v_err := public.admin_gate('admin', 'hub_save');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return public.admin_fail('hub_save', null, null, 'bad_input', v_meta);
  end if;

  begin
    v_id := nullif(p_data ->> 'id', '')::uuid;
  exception when others then
    return public.admin_fail('hub_save', null, null, 'bad_id', v_meta);
  end;

  if p_type = 'task' then
    declare
      v_tag text := upper(btrim(coalesce(p_data ->> 'tag', '')));
      v_status text := coalesce(p_data ->> 'status', '');
      v_descr text := btrim(coalesce(p_data ->> 'descr', ''));
      v_say text := nullif(btrim(coalesce(p_data ->> 'say', '')), '');
    begin
      if v_tag !~ '^[A-Z0-9]{2,12}$' then return public.admin_fail('hub_save', null, null, 'bad_tag', v_meta); end if;
      if v_status not in ('todo', 'doing', 'done') then return public.admin_fail('hub_save', null, null, 'bad_status', v_meta); end if;
      if char_length(v_title) not between 2 and 80 then return public.admin_fail('hub_save', null, null, 'bad_title', v_meta); end if;
      if char_length(v_descr) > 300 or char_length(coalesce(v_say, '')) > 160 then return public.admin_fail('hub_save', null, null, 'bad_text', v_meta); end if;

      if v_id is null then
        insert into public.hub_tasks (tag, status, title, descr, say, pos, created_by)
        values (v_tag, v_status, v_title, v_descr, v_say, coalesce((select max(pos) from public.hub_tasks), 0) + 10, auth.uid())
        returning id into v_id;
      else
        select to_jsonb(t) into v_before from public.hub_tasks t where t.id = v_id;
        if v_before is null then return public.admin_fail('hub_save', null, null, 'not_found', v_meta); end if;
        update public.hub_tasks
        set tag = v_tag, status = v_status, title = v_title, descr = v_descr, say = v_say, updated_at = now()
        where id = v_id;
      end if;
      select to_jsonb(t) into v_after from public.hub_tasks t where t.id = v_id;
    end;

  elsif p_type = 'post' then
    declare
      v_kind text := coalesce(p_data ->> 'kind', '');
      v_body text := btrim(coalesce(p_data ->> 'body', ''));
    begin
      if v_kind not in ('diary', 'story') then return public.admin_fail('hub_save', null, null, 'bad_kind', v_meta); end if;
      if char_length(v_title) not between 2 and 80 then return public.admin_fail('hub_save', null, null, 'bad_title', v_meta); end if;
      if char_length(v_body) not between 2 and 4000 then return public.admin_fail('hub_save', null, null, 'bad_text', v_meta); end if;

      if v_id is null then
        insert into public.hub_posts (kind, title, body, published, created_by)
        values (v_kind, v_title, v_body, v_pub, auth.uid())
        returning id into v_id;
      else
        select to_jsonb(p) into v_before from public.hub_posts p where p.id = v_id;
        if v_before is null then return public.admin_fail('hub_save', null, null, 'not_found', v_meta); end if;
        update public.hub_posts
        set kind = v_kind, title = v_title, body = v_body, published = v_pub, updated_at = now()
        where id = v_id;
      end if;
      select to_jsonb(p) into v_after from public.hub_posts p where p.id = v_id;
    end;

  elsif p_type = 'file' then
    declare
      v_teaser text := btrim(coalesce(p_data ->> 'teaser', ''));
      v_hint text := nullif(btrim(coalesce(p_data ->> 'hint', '')), '');
      v_body text := btrim(coalesce(p_data ->> 'body', ''));
    begin
      -- anything in [[double brackets]] is blacked out BEFORE it is stored (the teaser is public)
      v_teaser := regexp_replace(v_teaser, '\[\[.+?\]\]', repeat(chr(9608), 6), 'g');

      if char_length(v_title) not between 2 and 80 then return public.admin_fail('hub_save', null, null, 'bad_title', v_meta); end if;
      if char_length(v_teaser) not between 2 and 400 or char_length(coalesce(v_hint, '')) > 160 then return public.admin_fail('hub_save', null, null, 'bad_text', v_meta); end if;
      if char_length(v_body) not between 2 and 4000 then return public.admin_fail('hub_save', null, null, 'bad_text', v_meta); end if;
      if v_code <> '' and char_length(v_code) not between 1 and 60 then return public.admin_fail('hub_save', null, null, 'bad_code', v_meta); end if;

      if v_id is null then
        if v_code = '' then return public.admin_fail('hub_save', null, null, 'code_required', v_meta); end if;
        insert into public.hub_files (title, teaser, hint, body, code_hash, published, created_by)
        values (v_title, v_teaser, v_hint, v_body, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), v_pub, auth.uid())
        returning id into v_id;
      else
        select to_jsonb(f) - 'code_hash' into v_before from public.hub_files f where f.id = v_id;
        if v_before is null then return public.admin_fail('hub_save', null, null, 'not_found', v_meta); end if;
        update public.hub_files
        set title = v_title, teaser = v_teaser, hint = v_hint, body = v_body, published = v_pub, updated_at = now(),
            code_hash = case when v_code = '' then code_hash else extensions.crypt(v_code, extensions.gen_salt('bf', 8)) end
        where id = v_id;
      end if;
      select to_jsonb(f) - 'code_hash' - 'body' into v_after from public.hub_files f where f.id = v_id;
      v_before := v_before - 'body';
      v_meta := v_meta || jsonb_build_object('code_changed', v_code <> '');
    end;

  else
    return public.admin_fail('hub_save', null, null, 'bad_type', v_meta);
  end if;

  perform public.admin_log('hub_save', null, null, true, v_before, v_after, v_meta, 'hub_' || p_type, v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.hub_admin_delete(p_type text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_before jsonb;
  v_meta jsonb := jsonb_build_object('type', p_type);
begin
  v_err := public.admin_gate('admin', 'hub_delete');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_type = 'task' then
    select to_jsonb(t) into v_before from public.hub_tasks t where t.id = p_id;
    delete from public.hub_tasks where id = p_id;
  elsif p_type = 'post' then
    select to_jsonb(p) into v_before from public.hub_posts p where p.id = p_id;
    delete from public.hub_posts where id = p_id;
  elsif p_type = 'file' then
    select to_jsonb(f) - 'code_hash' - 'body' into v_before from public.hub_files f where f.id = p_id;
    delete from public.hub_files where id = p_id;
  else
    return public.admin_fail('hub_delete', null, null, 'bad_type', v_meta);
  end if;

  if v_before is null then
    return public.admin_fail('hub_delete', null, null, 'not_found', v_meta);
  end if;

  perform public.admin_log('hub_delete', null, null, true, v_before, null, v_meta, 'hub_' || p_type, p_id::text);
  return jsonb_build_object('ok', true);
end;
$$;


-- --------------------------------------------------------------------------
-- 4) WHO CAN CALL WHAT
--    Same approach as supabase-admin.sql: take everything away, hand back only
--    what each function needs.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hub_declassify', 'hub_admin_list', 'hub_admin_save', 'hub_admin_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'hub_declassify' then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;


-- --------------------------------------------------------------------------
-- 5) STARTER CONTENT (only inserted while a table is empty)
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.hub_tasks) then
    insert into public.hub_tasks (tag, status, title, descr, say, pos) values
      ('CHATS',  'done',  'Windows 11 emoji',                'Fluent 3D emoji pictures instead of plain text.', '“Finally, no more :smiling_face: text.”', 10),
      ('CHATS',  'done',  'Emoji picker and quick reactions','Picker categories plus a quick reactions bar, all kept in chat-emoji.js.', null, 20),
      ('STUDIO', 'done',  'Studio Phase 1',                  'The foundation of SPECSOFT Studio.', null, 30),
      ('STUDIO', 'done',  'Studio Phase 2',                  'The node canvas.', null, 40),
      ('STUDIO', 'done',  'Studio Phase 3',                  'Execution engine, run controls, history and console.', null, 50),
      ('STUDIO', 'done',  'Studio Phase 4',                  'JS nodes, delays and nested branches.', null, 60),
      ('STUDIO', 'done',  'Studio Phase 5',                  'Studio sidebar, Code Editor, Database and Timeline.', null, 70),
      ('STUDIO', 'done',  'Studio Phase 6',                  'Secure Preview and the PC-only guard.', '“Phones in desktop mode? Nice try.”', 80),
      ('SITE',   'done',  '404 page',                        'Spectra’s 404 page, built from the mockup.', '“...Huh? This page doesn’t exist?”', 90),
      ('HUB',    'done',  'Hub Phase 1',                     'Secret entrance, gate and the Hub shell.', '“You weren’t supposed to find this place.”', 100),
      ('HUB',    'done',  'Hub Phase 2',                     'Laboratory, Archives and the new icon system.', null, 110),
      ('HUB',    'done',  'Hub Phase 3',                     'Spectra’s Corner, Classified and the admin Manager.', '“Fine. You can write in my diary. Carefully.”', 120),
      ('STUDIO', 'doing', 'Studio Phase 7',                  'STools and resizable panels.', null, 130),
      ('STUDIO', 'todo',  'Studio Phase 8',                  'The final phase of the Studio spec.', null, 140),
      ('HUB',    'done',  'Hub Phase 4',                     'Arcade, Toolbox and Spectra’s chibi collection.', '“...Tch. Fine. Go play your games.”', 150);
  end if;

  if not exists (select 1 from public.hub_posts) then
    insert into public.hub_posts (kind, title, body) values
      ('diary', 'Day 1: Face down',
       'They made a whole page where I lie face down and say “...Tch.” Rude. Accurate, but rude.' || E'\n\n' ||
       'I’m keeping the chibi, though. She’s small and she never has to talk to anyone.'),
      ('diary', 'Someone clicked me five times',
       'FIVE. I said stop. I said stop twice. They kept going anyway.' || E'\n\n' ||
       '...Fine. I respect the commitment. Don’t tell anyone, but I left the door open on purpose.'),
      ('diary', 'Tea report',
       'Tea is the only thing around here that never throws an error. Everything else breaks at 3 a.m. Tea does not.' || E'\n\n' ||
       'I am considering making tea the official SPECSOFT language.'),
      ('story', 'The Missing Page',
       'One night a page went missing. Not deleted, not hidden, just gone.' || E'\n\n' ||
       'Spectra searched the Archives with a tiny flashlight and found it behind a sticky note that said “brb”. The page was hiding because it was shy.' || E'\n\n' ||
       'She sat next to it for a whole hour and said nothing. When the page finally came out, she muttered, “...Tch. You had me worried,” and put it back where it belonged.' || E'\n\n' ||
       'She told everyone she was just stretching her legs.'),
      ('story', 'Spectra and the Red Button',
       'In the Laboratory there is a big red button with no label. Everyone says don’t touch it.' || E'\n\n' ||
       'Spectra stared at it for ten whole minutes. She wanted to. She really, really wanted to.' || E'\n\n' ||
       'Then she made a cup of tea instead. The button stayed red, nothing exploded, and Spectra declared herself the winner. Probably.');
  end if;

  if not exists (select 1 from public.hub_files) then
    insert into public.hub_files (title, teaser, hint, body, code_hash, published) values
      ('FILE 001: The Red Button',
       'The red button in the Laboratory is connected to ██████. Spectra has pressed it ██████ times.',
       'Her favorite sound. Three letters.',
       'DECLASSIFIED.' || E'\n\n' || 'The red button does nothing. Spectra presses it when she thinks nobody is looking.' || E'\n\n' || 'Please do not tell her we know.',
       extensions.crypt('tch', extensions.gen_salt('bf', 8)),
       true);
  end if;
end $$;
