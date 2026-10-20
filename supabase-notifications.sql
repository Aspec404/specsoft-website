-- ==========================================================================
-- SPECSOFT® NOTIFICATIONS (bell menu: Main / Events / System)
--
-- RUN ORDER: supabase-profiles.sql, supabase-project-social.sql and
-- supabase-admin.sql FIRST (this attaches to profiles, profile_projects,
-- profile_project_likes, profile_follows, staff_members, admin_gate, admin_log).
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL > Run.
-- Safe to run more than once.
--
-- WHAT THIS ADDS
--   notifications        one row per notification. user_id = NULL means it
--                         is a broadcast everyone sees (an announcement).
--   notification_reads   who has read what. Nothing is fanned out at publish
--                         time, a read row is only written when someone
--                         actually opens/reads a notification.
--
-- THE THREE TABS
--   Main    -> likes on your projects, new followers, and announcements an
--              admin published to "Main"
--   Events  -> announcements an admin published to "Events"
--   System  -> announcements an admin published to "System" (maintenance,
--              content removal, general notices). Bans/suspensions/warnings
--              already have their own notice system in supabase-admin.sql
--              (user_notices / my_standing) and are NOT duplicated here.
--
-- SECURITY: same shape as user_sanctions/staff_notes in supabase-admin.sql.
-- Row Level Security is on, but there are NO policies: both tables are only
-- reachable through the SECURITY DEFINER functions below, which always act
-- as the signed-in member (auth.uid()) or check admin_gate() for staff
-- actions. Nothing in the browser can read someone else's notifications.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1) TABLES
-- --------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('main', 'events', 'system')),
  type       text not null default 'announcement'
             check (type in ('announcement', 'like', 'follow', 'comment', 'repost')),
  user_id    uuid references public.profiles(id) on delete cascade,   -- NULL = everyone
  actor_id   uuid references public.profiles(id) on delete set null,  -- who caused it (liker/follower)
  project_id uuid references public.profile_projects(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  body       text check (body is null or char_length(body) <= 600),
  link_url   text check (link_url is null or (char_length(link_url) <= 300 and link_url ~ '^https://')),
  created_by uuid references public.profiles(id) on delete set null,  -- staff member, if this was published from the console
  created_at timestamptz not null default now()
);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, category, created_at desc) where user_id is not null;

create index if not exists notifications_broadcast_idx
  on public.notifications (category, created_at desc) where user_id is null;

create index if not exists notifications_admin_idx
  on public.notifications (created_at desc) where created_by is not null;

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id, notification_id);

alter table public.notifications      enable row level security;
alter table public.notification_reads enable row level security;
-- (no policies on purpose: reachable only through the functions below)

revoke all on public.notifications, public.notification_reads from anon, authenticated;


-- --------------------------------------------------------------------------
-- 2) AUTOMATIC NOTIFICATIONS: project likes + new followers (Main tab)
-- --------------------------------------------------------------------------
create or replace function public.notify_project_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_who   text;
begin
  select owner_id, title into v_owner, v_title from public.profile_projects where id = new.project_id;
  if v_owner is null or v_owner = new.user_id then
    return new;    -- project gone, or you liked your own project
  end if;

  select coalesce(display_name, username) into v_who from public.profiles where id = new.user_id;

  insert into public.notifications (category, type, user_id, actor_id, project_id, title, body)
  values ('main', 'like', v_owner, new.user_id, new.project_id,
          'New like on your project', coalesce(v_who, 'Someone') || ' liked "' || left(coalesce(v_title, 'your project'), 60) || '"');

  return new;
end;
$$;

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_who text;
begin
  select coalesce(display_name, username) into v_who from public.profiles where id = new.follower_id;

  insert into public.notifications (category, type, user_id, actor_id, title, body)
  values ('main', 'follow', new.following_id, new.follower_id,
          'New follower', coalesce(v_who, 'Someone') || ' started following you');

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.profile_project_likes') is not null then
    drop trigger if exists profile_project_likes_notify on public.profile_project_likes;
    create trigger profile_project_likes_notify after insert on public.profile_project_likes
      for each row execute function public.notify_project_like();
  end if;

  if to_regclass('public.profile_follows') is not null then
    drop trigger if exists profile_follows_notify on public.profile_follows;
    create trigger profile_follows_notify after insert on public.profile_follows
      for each row execute function public.notify_new_follower();
  end if;
end $$;


-- --------------------------------------------------------------------------
-- 3) FUNCTIONS EVERY SIGNED-IN MEMBER USES (the bell)
-- --------------------------------------------------------------------------

-- unread counts per tab, for the little red badge
create or replace function public.my_notification_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then jsonb_build_object('main', 0, 'events', 0, 'system', 0, 'total', 0)
  else (
    select jsonb_build_object(
      'main',   coalesce(sum(case when n.category = 'main'   then 1 else 0 end), 0),
      'events', coalesce(sum(case when n.category = 'events' then 1 else 0 end), 0),
      'system', coalesce(sum(case when n.category = 'system' then 1 else 0 end), 0),
      'total',  count(*)
    )
    from public.notifications n
    where (n.user_id = auth.uid() or n.user_id is null)
      and n.created_at > now() - interval '180 days'
      and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
  ) end;
$$;

-- the list shown in the dropdown, one tab at a time, paged with p_before
create or replace function public.my_notifications(p_category text default null, p_limit int default 20, p_before timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select n.id, n.category, n.type, n.title, n.body, n.link_url, n.project_id, n.created_at,
             (r.notification_id is not null) as read,
             a.username as actor_username, a.display_name as actor_display_name, a.avatar_url as actor_avatar_url
      from public.notifications n
      left join public.notification_reads r on r.notification_id = n.id and r.user_id = auth.uid()
      left join public.profiles a on a.id = n.actor_id
      where (n.user_id = auth.uid() or n.user_id is null)
        and (p_category is null or n.category = p_category)
        and (p_before is null or n.created_at < p_before)
      order by n.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x
  ), '[]'::jsonb) end;
$$;

create or replace function public.notifications_mark_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid()
  from public.notifications n
  where n.id = any (p_ids) and (n.user_id = auth.uid() or n.user_id is null)
  on conflict (notification_id, user_id) do nothing;
$$;

create or replace function public.notifications_mark_all_read(p_category text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid()
  from public.notifications n
  where (n.user_id = auth.uid() or n.user_id is null)
    and (p_category is null or n.category = p_category)
    and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
  on conflict (notification_id, user_id) do nothing;
$$;


-- --------------------------------------------------------------------------
-- 4) ADMIN COMPOSER: publish an announcement to Main, Events or System
--    Same access rules as everything else in supabase-admin.sql: it runs
--    through admin_gate(), and every publish/delete is written to
--    admin_audit_log via admin_log().
-- --------------------------------------------------------------------------
create or replace function public.admin_publish_notification(
  p_category     text,
  p_title        text,
  p_body         text default null,
  p_link         text default null,
  p_target_user  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err  text;
  v_id   uuid;
  v_meta jsonb := jsonb_build_object('category', p_category, 'target', p_target_user);
begin
  -- a broadcast to every member is a bigger action than messaging one person
  v_err := public.admin_gate(case when p_target_user is null then 'admin' else 'moderator' end, 'notification_publish');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_category not in ('main', 'events', 'system') then
    return public.admin_fail('notification_publish', p_target_user, null, 'bad_category', v_meta);
  end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 then
    return public.admin_fail('notification_publish', p_target_user, null, 'title_required', v_meta);
  end if;
  if p_target_user is not null and not exists (select 1 from public.profiles where id = p_target_user) then
    return public.admin_fail('notification_publish', p_target_user, null, 'not_found', v_meta);
  end if;
  if p_link is not null and btrim(p_link) <> '' and p_link !~ '^https://' then
    return public.admin_fail('notification_publish', p_target_user, null, 'bad_link', v_meta);
  end if;

  insert into public.notifications (category, type, user_id, title, body, link_url, created_by)
  values (p_category, 'announcement', p_target_user, left(btrim(p_title), 120),
          nullif(left(btrim(coalesce(p_body, '')), 600), ''),
          nullif(btrim(coalesce(p_link, '')), ''), auth.uid())
  returning id into v_id;

  perform public.admin_log('notification_publish', p_target_user, null, true, null,
    jsonb_build_object('id', v_id, 'category', p_category, 'title', p_title), v_meta, 'notification', v_id::text);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- history shown in the console: announcements staff have published
create or replace function public.admin_list_notifications(p_limit int default 50, p_before timestamptz default null, p_category text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('moderator', 'notification_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select n.id, n.category, n.title, n.body, n.link_url, n.created_at,
             n.user_id as target_user, t.username as target_username,
             n.created_by, c.username as created_by_username
      from public.notifications n
      left join public.profiles t on t.id = n.user_id
      left join public.profiles c on c.id = n.created_by
      where n.created_by is not null
        and (p_category is null or n.category = p_category)
        and (p_before is null or n.created_at < p_before)
      order by n.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_delete_notification(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_row public.notifications;
begin
  v_err := public.admin_gate('moderator', 'notification_delete');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into v_row from public.notifications where id = p_id and created_by is not null;
  if v_row.id is null then
    return public.admin_fail('notification_delete', null, null, 'not_found');
  end if;

  delete from public.notifications where id = p_id;

  perform public.admin_log('notification_delete', v_row.user_id, null, true,
    jsonb_build_object('id', v_row.id, 'category', v_row.category, 'title', v_row.title), null, null, 'notification', p_id::text);

  return jsonb_build_object('ok', true);
end;
$$;


-- --------------------------------------------------------------------------
-- 5) WHO CAN CALL WHAT
-- --------------------------------------------------------------------------
do $$
declare
  r record;
  v_client text[] := array[
    'my_notification_counts', 'my_notifications', 'notifications_mark_read', 'notifications_mark_all_read',
    'admin_publish_notification', 'admin_list_notifications', 'admin_delete_notification'
  ];
  v_internal text[] := array['notify_project_like', 'notify_new_follower'];
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