-- SPECSOFT build 2026-10-21 · supabase-reports.sql · v1
-- ==========================================================================
-- SPECSOFT® REPORTS AND CASES
--
-- RUN AFTER: supabase-profiles.sql, supabase-project-social.sql, supabase-chats.sql,
-- supabase-admin.sql, supabase-notifications.sql, supabase-hub.sql.
-- Safe to run more than once.
--
-- HOW IT WORKS
--   * Members report something with report_submit(). Reports about the SAME thing are
--     grouped into ONE case (5 people reporting one project = 1 case with 5 reports).
--   * Your existing project "Report" button keeps working: a trigger copies those
--     reports into cases, and old reports are migrated the first time you run this.
--   * Staff work cases in the console: assign to a moderator, move between
--     pending / investigating, then resolve or dismiss. Closing a case sends every
--     reporter an update in their notification bell (the "System" tab).
--   * Reporters are only ever visible to staff, never to the person reported.
--   * A case captures a snapshot of what was reported, so it can still be judged if the
--     content is edited or deleted afterwards.
--   * Staff cannot handle a case about themselves, or about someone above their level.
--
--   Reportable: project, comment, user, chat_message, bug (a chat bug card sent to staff).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) TABLES
-- --------------------------------------------------------------------------
create table if not exists public.report_cases (
  id                uuid primary key default gen_random_uuid(),
  case_no           bigint generated always as identity,
  target_type       text not null check (target_type in ('project', 'comment', 'user', 'chat_message', 'bug')),
  target_id         text not null,
  target_user       uuid references public.profiles(id) on delete set null,
  summary           text not null default '' check (char_length(summary) <= 200),
  snapshot          jsonb not null default '{}'::jsonb,
  status            text not null default 'pending' check (status in ('pending', 'investigating', 'resolved', 'dismissed')),
  assigned_to       uuid references public.profiles(id) on delete set null,
  assigned_at       timestamptz,
  report_count      int not null default 0,
  first_reported_at timestamptz not null default now(),
  last_reported_at  timestamptz not null default now(),
  outcome           text check (outcome is null or outcome in ('action_taken', 'no_violation', 'duplicate', 'other')),
  outcome_note      text check (outcome_note is null or char_length(outcome_note) <= 600),
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create unique index if not exists report_cases_no_idx on public.report_cases (case_no);
-- only ONE open case per thing; a new report after it closes starts a fresh case
create unique index if not exists report_cases_open_target_idx on public.report_cases (target_type, target_id) where status in ('pending', 'investigating');
create index if not exists report_cases_queue_idx  on public.report_cases (status, report_count desc, last_reported_at desc);
create index if not exists report_cases_assign_idx on public.report_cases (assigned_to) where status in ('pending', 'investigating');

create table if not exists public.case_reports (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.report_cases(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'inappropriate', 'harassment', 'copyright', 'impersonation', 'bug', 'other')),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (case_id, reporter_id)
);

create index if not exists case_reports_reporter_idx on public.case_reports (reporter_id, created_at desc);

create table if not exists public.case_notes (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.report_cases(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  note       text not null check (char_length(btrim(note)) between 2 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists case_notes_case_idx on public.case_notes (case_id, created_at desc);

create table if not exists public.case_events (
  id       bigint generated always as identity primary key,
  case_id  uuid not null references public.report_cases(id) on delete cascade,
  at       timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  kind     text not null,
  text     text
);

create index if not exists case_events_case_idx on public.case_events (case_id, id);

alter table public.report_cases enable row level security;
alter table public.case_reports enable row level security;
alter table public.case_notes   enable row level security;
alter table public.case_events  enable row level security;
-- (no policies on purpose: only the functions below can touch these)
revoke all on public.report_cases, public.case_reports, public.case_notes, public.case_events from anon, authenticated;


-- --------------------------------------------------------------------------
-- 2) INTERNAL: add one report to the right case (never callable from the website)
-- --------------------------------------------------------------------------
create or replace function public.report_add(
  p_reporter    uuid,
  p_type        text,
  p_target      text,
  p_target_user uuid,
  p_summary     text,
  p_snapshot    jsonb,
  p_reason      text,
  p_note        text,
  p_created     timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.report_cases;
  v_new  boolean := false;
begin
  select * into v_case from public.report_cases
  where target_type = p_type and target_id = p_target and status in ('pending', 'investigating')
  limit 1 for update;

  if v_case.id is null then
    begin
      insert into public.report_cases (target_type, target_id, target_user, summary, snapshot, first_reported_at, last_reported_at, created_at)
      values (p_type, p_target, p_target_user, left(coalesce(p_summary, ''), 200), coalesce(p_snapshot, '{}'::jsonb), p_created, p_created, p_created)
      returning * into v_case;
      v_new := true;
      insert into public.case_events (case_id, at, kind, text) values (v_case.id, p_created, 'opened', 'Case opened from a member report');
    exception when unique_violation then
      -- someone else opened it a split second ago: join that one
      select * into v_case from public.report_cases
      where target_type = p_type and target_id = p_target and status in ('pending', 'investigating')
      limit 1 for update;
    end;
  end if;

  if v_case.id is null then
    return jsonb_build_object('ok', false, 'error', 'server');
  end if;

  if exists (select 1 from public.case_reports where case_id = v_case.id and reporter_id = p_reporter) then
    return jsonb_build_object('ok', false, 'error', 'already_reported', 'case_no', v_case.case_no);
  end if;

  insert into public.case_reports (case_id, reporter_id, reason, note, created_at)
  values (v_case.id, p_reporter, p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_created);

  update public.report_cases
  set report_count = report_count + 1, last_reported_at = greatest(last_reported_at, p_created)
  where id = v_case.id;

  if not v_new then
    insert into public.case_events (case_id, at, kind, text) values (v_case.id, p_created, 'report_added', 'Another member reported this');
  end if;

  return jsonb_build_object('ok', true, 'case_no', v_case.case_no, 'new_case', v_new);
end;
$$;

-- tells a member something in their notification bell (System tab); never listed as a staff announcement
create or replace function public.report_notify(p_user uuid, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (category, type, user_id, title, body, created_by)
  values ('system', 'announcement', p_user, left(p_title, 120), left(p_body, 600), null);
$$;


-- --------------------------------------------------------------------------
-- 3) WHAT MEMBERS CALL: report_submit()
--    Always answers {ok, error?, case_no?}. It never raises, so the page can show a clear message.
-- --------------------------------------------------------------------------
create or replace function public.report_submit(p_type text, p_target text, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_reason   text := p_reason;
  v_id       uuid;
  v_target_user uuid;
  v_summary  text;
  v_snap     jsonb;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_msg      public.chat_messages;
  v_room     text;
  v_res      jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'login');
  end if;
  if public.sanction_active(v_uid, array['ban', 'suspension']) then
    return jsonb_build_object('ok', false, 'error', 'restricted');
  end if;
  if p_type is null or p_type not in ('project', 'comment', 'user', 'chat_message', 'bug') then
    return jsonb_build_object('ok', false, 'error', 'bad_type');
  end if;
  if p_target is null or p_target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_id := p_target::uuid;

  if p_type = 'bug' then
    v_reason := 'bug';
  elsif v_reason is null or v_reason not in ('spam', 'inappropriate', 'harassment', 'copyright', 'impersonation', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'bad_note');
  end if;

  if (select count(*) from public.case_reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  if p_type = 'project' then
    select p.owner_id, p.title,
           jsonb_build_object('title', p.title, 'summary', p.summary, 'url', p.url, 'category', p.category,
                              'owner_username', (select username from public.profiles where id = p.owner_id))
      into v_target_user, v_summary, v_snap
    from public.profile_projects p where p.id = v_id;
    if v_target_user is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if v_target_user = v_uid then return jsonb_build_object('ok', false, 'error', 'own_content'); end if;

  elsif p_type = 'comment' then
    select c.user_id, left(coalesce(nullif(c.body, ''), '[image]'), 120),
           jsonb_build_object('body', c.body, 'image_url', c.image_url, 'project_id', c.project_id,
                              'project_title', (select title from public.profile_projects where id = c.project_id),
                              'author_username', (select username from public.profiles where id = c.user_id))
      into v_target_user, v_summary, v_snap
    from public.profile_project_comments c where c.id = v_id;
    if v_target_user is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if v_target_user = v_uid then return jsonb_build_object('ok', false, 'error', 'own_content'); end if;

  elsif p_type = 'user' then
    select p.id, '@' || p.username,
           jsonb_build_object('username', p.username, 'display_name', p.display_name, 'headline', p.headline, 'bio', p.bio, 'avatar_url', p.avatar_url)
      into v_target_user, v_summary, v_snap
    from public.profiles p where p.id = v_id;
    if v_target_user is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if v_target_user = v_uid then return jsonb_build_object('ok', false, 'error', 'own_content'); end if;

  else   -- chat_message or bug
    select * into v_msg from public.chat_messages where id = v_id and deleted_at is null;
    if v_msg.id is null or not public.chat_has_membership(v_msg.room_id, v_uid) then
      return jsonb_build_object('ok', false, 'error', 'not_found');             -- you can only report what you can see
    end if;
    select name into v_room from public.chat_rooms where id = v_msg.room_id;

    if p_type = 'bug' then
      if left(v_msg.body, 6) <> '[[bug:' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      v_target_user := null;                                                      -- a bug report is not a complaint about a person
      v_summary := 'Bug report from chat';
    else
      if v_msg.sender_id = v_uid then return jsonb_build_object('ok', false, 'error', 'own_content'); end if;
      v_target_user := v_msg.sender_id;
      v_summary := left(v_msg.body, 120);
    end if;
    v_snap := jsonb_build_object('body', left(v_msg.body, 2000), 'room_name', v_room, 'room_id', v_msg.room_id,
                                 'sender_username', (select username from public.profiles where id = v_msg.sender_id),
                                 'sent_at', v_msg.created_at);
  end if;

  v_res := public.report_add(v_uid, p_type, v_id::text, v_target_user, v_summary, v_snap, v_reason, v_note, now());
  return v_res;
end;
$$;


-- --------------------------------------------------------------------------
-- 4) YOUR EXISTING PROJECT REPORT BUTTON: mirror its rows into cases
--    (so nothing breaks if a visitor still has the old page cached)
-- --------------------------------------------------------------------------
create or replace function public.report_mirror_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid; v_title text; v_snap jsonb;
begin
  select p.owner_id, p.title,
         jsonb_build_object('title', p.title, 'summary', p.summary, 'url', p.url, 'category', p.category,
                            'owner_username', (select username from public.profiles where id = p.owner_id))
    into v_owner, v_title, v_snap
  from public.profile_projects p where p.id = new.project_id;

  if v_owner is not null then
    perform public.report_add(new.reporter_id, 'project', new.project_id::text, v_owner, v_title, v_snap, new.reason, new.note, new.created_at);
  end if;
  return new;
exception when others then
  return new;                                      -- never block a member's report
end;
$$;

drop trigger if exists report_mirror_project on public.profile_project_reports;
create trigger report_mirror_project after insert on public.profile_project_reports
  for each row execute function public.report_mirror_project();

-- one-time migration of reports that already exist (only runs while there are no cases yet)
do $$
declare
  r record;
begin
  if to_regclass('public.profile_project_reports') is not null and not exists (select 1 from public.report_cases) then
    for r in
      select pr.project_id, pr.reporter_id, pr.reason, pr.note, pr.created_at, p.owner_id, p.title,
             jsonb_build_object('title', p.title, 'summary', p.summary, 'url', p.url, 'category', p.category,
                                'owner_username', (select username from public.profiles where id = p.owner_id)) as snap
      from public.profile_project_reports pr
      join public.profile_projects p on p.id = pr.project_id
      order by pr.created_at
    loop
      perform public.report_add(r.reporter_id, 'project', r.project_id::text, r.owner_id, r.title, r.snap, r.reason, r.note, r.created_at);
    end loop;
  end if;
end $$;


-- --------------------------------------------------------------------------
-- 5) STAFF: the queue, one case, assign, status, notes, resolve
-- --------------------------------------------------------------------------
create or replace function public.admin_cases_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('moderator', 'cases_summary');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true,
    'pending',       (select count(*) from public.report_cases where status = 'pending'),
    'investigating', (select count(*) from public.report_cases where status = 'investigating'),
    'unassigned',    (select count(*) from public.report_cases where status in ('pending', 'investigating') and assigned_to is null),
    'mine',          (select count(*) from public.report_cases where status in ('pending', 'investigating') and assigned_to = auth.uid()));
end;
$$;

create or replace function public.admin_cases_list(
  p_status text default 'open', p_type text default null, p_mine boolean default false,
  p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  v_err := public.admin_gate('moderator', 'cases_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true,
    'counts', jsonb_build_object(
      'pending',       (select count(*) from public.report_cases where status = 'pending'),
      'investigating', (select count(*) from public.report_cases where status = 'investigating'),
      'unassigned',    (select count(*) from public.report_cases where status in ('pending', 'investigating') and assigned_to is null),
      'mine',          (select count(*) from public.report_cases where status in ('pending', 'investigating') and assigned_to = auth.uid())),
    'cases', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ord) from (
        select c.id, c.case_no, c.target_type, c.target_id, c.target_user, c.summary, c.status, c.report_count,
               c.first_reported_at, c.last_reported_at, c.assigned_to, c.outcome,
               (select username from public.profiles where id = c.assigned_to) as assigned_name,
               (select username from public.profiles where id = c.target_user) as target_name,
               (select r.reason from public.case_reports r where r.case_id = c.id group by r.reason order by count(*) desc, r.reason limit 1) as top_reason,
               row_number() over (
                 order by (case when c.status in ('pending', 'investigating') then 0 else 1 end), c.report_count desc, c.last_reported_at desc
               ) as ord
        from public.report_cases c
        where (p_status is null or p_status = '' or (p_status = 'open' and c.status in ('pending', 'investigating')) or c.status = p_status)
          and (p_type is null or p_type = '' or c.target_type = p_type)
          and (not coalesce(p_mine, false) or c.assigned_to = auth.uid())
        order by ord
        limit v_lim offset greatest(coalesce(p_offset, 0), 0)
      ) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_case_detail(p_case uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  c public.report_cases;
  v_conflict boolean;
begin
  v_err := public.admin_gate('moderator', 'case_detail');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into c from public.report_cases where id = p_case;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_conflict := c.target_user is not null and public.staff_rank(c.target_user) > 0
                and (c.target_user = auth.uid() or public.staff_rank(c.target_user) > public.staff_rank(auth.uid()));

  return jsonb_build_object('ok', true,
    'case', jsonb_build_object(
      'id', c.id, 'case_no', c.case_no, 'target_type', c.target_type, 'target_id', c.target_id, 'target_user', c.target_user,
      'summary', c.summary, 'snapshot', c.snapshot, 'status', c.status, 'assigned_to', c.assigned_to,
      'assigned_name', (select username from public.profiles where id = c.assigned_to),
      'report_count', c.report_count, 'first_reported_at', c.first_reported_at, 'last_reported_at', c.last_reported_at,
      'outcome', c.outcome, 'outcome_note', c.outcome_note, 'resolved_at', c.resolved_at,
      'resolved_by_name', (select username from public.profiles where id = c.resolved_by)),
    'conflict', v_conflict,
    'target', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
                 'staff_level', (select level from public.staff_members where user_id = p.id),
                 'banned', public.sanction_active(p.id, array['ban']), 'suspended', public.sanction_active(p.id, array['suspension']))
               from public.profiles p where p.id = c.target_user),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('reporter_id', r.reporter_id, 'reporter_name', rp.username, 'reason', r.reason, 'note', r.note,
                                          'created_at', r.created_at, 'notified_at', r.notified_at) order by r.created_at)
      from public.case_reports r left join public.profiles rp on rp.id = r.reporter_id where r.case_id = c.id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at,
                                          'author_name', (select username from public.profiles where id = n.author_id)) order by n.created_at desc)
      from public.case_notes n where n.case_id = c.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'text', e.text,
                                          'actor_name', (select username from public.profiles where id = e.actor_id)) order by e.id)
      from public.case_events e where e.case_id = c.id), '[]'::jsonb));
end;
$$;

-- p_user null = unassign. Moderators can only take a case themselves; admins can assign anyone on staff.
create or replace function public.admin_case_assign(p_case uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  c public.report_cases;
  v_name text;
begin
  v_err := public.admin_gate('moderator', 'case_assign');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into c from public.report_cases where id = p_case for update;
  if c.id is null then return public.admin_fail('case_assign', null, null, 'not_found'); end if;
  if c.status not in ('pending', 'investigating') then
    return public.admin_fail('case_assign', c.target_user, null, 'case_closed', jsonb_build_object('case_no', c.case_no));
  end if;
  if c.target_user is not null and public.staff_rank(c.target_user) > 0
     and (c.target_user = auth.uid() or public.staff_rank(c.target_user) > public.staff_rank(auth.uid())) then
    return public.admin_fail('case_assign', c.target_user, null, 'conflict', jsonb_build_object('case_no', c.case_no));
  end if;
  if p_user is not null and p_user <> auth.uid() and public.staff_rank(auth.uid()) < 2 then
    return public.admin_fail('case_assign', c.target_user, null, 'forbidden', jsonb_build_object('case_no', c.case_no));
  end if;
  if p_user is not null and public.staff_rank(p_user) = 0 then
    return public.admin_fail('case_assign', c.target_user, null, 'bad_assignee', jsonb_build_object('case_no', c.case_no));
  end if;

  select username into v_name from public.profiles where id = p_user;

  update public.report_cases
  set assigned_to = p_user,
      assigned_at = case when p_user is null then null else now() end,
      status = case when p_user is not null and status = 'pending' then 'investigating' else status end
  where id = p_case;

  insert into public.case_events (case_id, actor_id, kind, text)
  values (p_case, auth.uid(), 'assigned', case when p_user is null then 'Unassigned' else 'Assigned to @' || coalesce(v_name, '?') end);

  perform public.admin_log('case_assign', c.target_user, null, true,
    jsonb_build_object('assigned_to', c.assigned_to), jsonb_build_object('assigned_to', p_user),
    jsonb_build_object('case_no', c.case_no), 'case', p_case::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- pending / investigating (also how a closed case is reopened)
create or replace function public.admin_case_status(p_case uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  c public.report_cases;
begin
  v_err := public.admin_gate('moderator', 'case_status');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_status is null or p_status not in ('pending', 'investigating') then
    return public.admin_fail('case_status', null, null, 'bad_status');
  end if;

  select * into c from public.report_cases where id = p_case for update;
  if c.id is null then return public.admin_fail('case_status', null, null, 'not_found'); end if;
  if c.target_user is not null and public.staff_rank(c.target_user) > 0
     and (c.target_user = auth.uid() or public.staff_rank(c.target_user) > public.staff_rank(auth.uid())) then
    return public.admin_fail('case_status', c.target_user, null, 'conflict', jsonb_build_object('case_no', c.case_no));
  end if;

  -- reopening a closed case: only if nothing else is open about the same thing
  if c.status in ('resolved', 'dismissed') and exists (
    select 1 from public.report_cases o where o.target_type = c.target_type and o.target_id = c.target_id and o.status in ('pending', 'investigating') and o.id <> c.id
  ) then
    return public.admin_fail('case_status', c.target_user, null, 'already_open', jsonb_build_object('case_no', c.case_no));
  end if;

  update public.report_cases
  set status = p_status,
      assigned_to = case when p_status = 'investigating' and assigned_to is null then auth.uid() else assigned_to end,
      assigned_at = case when p_status = 'investigating' and assigned_to is null then now() else assigned_at end,
      outcome = null, outcome_note = null, resolved_at = null, resolved_by = null
  where id = p_case;

  insert into public.case_events (case_id, actor_id, kind, text)
  values (p_case, auth.uid(), 'status', case when c.status in ('resolved', 'dismissed') then 'Reopened as ' || p_status else 'Marked ' || p_status end);

  perform public.admin_log('case_status', c.target_user, null, true,
    jsonb_build_object('status', c.status), jsonb_build_object('status', p_status),
    jsonb_build_object('case_no', c.case_no), 'case', p_case::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_case_note(p_case uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  c public.report_cases;
begin
  v_err := public.admin_gate('moderator', 'case_note');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into c from public.report_cases where id = p_case;
  if c.id is null then return public.admin_fail('case_note', null, null, 'not_found'); end if;
  if char_length(btrim(coalesce(p_note, ''))) < 2 or char_length(p_note) > 1000 then
    return public.admin_fail('case_note', c.target_user, null, 'bad_note', jsonb_build_object('case_no', c.case_no));
  end if;

  insert into public.case_notes (case_id, author_id, note) values (p_case, auth.uid(), btrim(p_note));
  insert into public.case_events (case_id, actor_id, kind, text) values (p_case, auth.uid(), 'note', 'Added a staff note');
  perform public.admin_log('case_note', c.target_user, null, true, null, null, jsonb_build_object('case_no', c.case_no), 'case', p_case::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- close a case. Every reporter who has not been told yet gets an update in their bell.
create or replace function public.admin_case_resolve(
  p_case uuid, p_status text, p_outcome text, p_message text default null, p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  c public.report_cases;
  r record;
  v_outcome text := p_outcome;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_base text;
  v_sent int := 0;
begin
  v_err := public.admin_gate('moderator', 'case_resolve');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_status is null or p_status not in ('resolved', 'dismissed') then
    return public.admin_fail('case_resolve', null, null, 'bad_status');
  end if;
  if p_status = 'dismissed' and v_outcome is null then v_outcome := 'no_violation'; end if;
  if v_outcome is null or v_outcome not in ('action_taken', 'no_violation', 'duplicate', 'other') then
    return public.admin_fail('case_resolve', null, null, 'bad_outcome');
  end if;
  if v_msg is not null and char_length(v_msg) > 400 then
    return public.admin_fail('case_resolve', null, null, 'bad_note');
  end if;

  select * into c from public.report_cases where id = p_case for update;
  if c.id is null then return public.admin_fail('case_resolve', null, null, 'not_found'); end if;
  if c.status in ('resolved', 'dismissed') then
    return public.admin_fail('case_resolve', c.target_user, null, 'case_closed', jsonb_build_object('case_no', c.case_no));
  end if;
  if c.target_user is not null and public.staff_rank(c.target_user) > 0
     and (c.target_user = auth.uid() or public.staff_rank(c.target_user) > public.staff_rank(auth.uid())) then
    return public.admin_fail('case_resolve', c.target_user, null, 'conflict', jsonb_build_object('case_no', c.case_no));
  end if;

  update public.report_cases
  set status = p_status, outcome = v_outcome, outcome_note = v_msg, resolved_at = now(), resolved_by = auth.uid(),
      assigned_to = coalesce(assigned_to, auth.uid()), assigned_at = coalesce(assigned_at, now())
  where id = p_case;

  if coalesce(p_notify, true) then
    v_base := case
      when c.target_type = 'bug' and v_outcome = 'action_taken' then 'Thanks for the bug report. We confirmed it and it will be fixed.'
      when c.target_type = 'bug' and v_outcome = 'no_violation' then 'Thanks for the bug report. We could not reproduce or confirm it.'
      when v_outcome = 'action_taken' then 'We reviewed your report and took action. Thank you for helping keep SPECSOFT safe.'
      when v_outcome = 'no_violation' then 'We reviewed your report and did not find a rule violation. Thank you for letting us know.'
      when v_outcome = 'duplicate'    then 'This was already being handled from another report. Thank you for flagging it.'
      else 'We reviewed your report and closed it. Thank you.'
    end;

    for r in select id, reporter_id from public.case_reports where case_id = p_case and notified_at is null loop
      perform public.report_notify(r.reporter_id, 'Update on your report (case #' || c.case_no || ')',
                                   v_base || case when v_msg is not null then ' ' || v_msg else '' end);
      update public.case_reports set notified_at = now() where id = r.id;
      v_sent := v_sent + 1;
    end loop;
  end if;

  insert into public.case_events (case_id, actor_id, kind, text)
  values (p_case, auth.uid(), 'closed', initcap(p_status) || ' (' || replace(v_outcome, '_', ' ') || ')' ||
          case when v_sent > 0 then ', ' || v_sent || ' reporter(s) notified' else ', nobody notified' end);

  perform public.admin_log('case_resolve', c.target_user, v_msg, true,
    jsonb_build_object('status', c.status), jsonb_build_object('status', p_status, 'outcome', v_outcome, 'notified', v_sent),
    jsonb_build_object('case_no', c.case_no), 'case', p_case::text);

  return jsonb_build_object('ok', true, 'notified', v_sent);
end;
$$;


-- --------------------------------------------------------------------------
-- 6) WHO CAN CALL WHAT
-- --------------------------------------------------------------------------
do $$
declare
  r record;
  v_client text[] := array['report_submit', 'admin_cases_summary', 'admin_cases_list', 'admin_case_detail',
                           'admin_case_assign', 'admin_case_status', 'admin_case_note', 'admin_case_resolve'];
  v_internal text[] := array['report_add', 'report_notify', 'report_mirror_project'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_client || v_internal)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any (v_client) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
