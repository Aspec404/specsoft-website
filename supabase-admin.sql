-- ==========================================================================
-- SPECSOFT® ADMIN + MODERATION (Phase 1)
--
-- RUN ORDER: supabase-profiles.sql, supabase-project-social.sql and
-- supabase-chats.sql FIRST (this attaches to their tables), then this file.
-- HOW TO RUN: Supabase dashboard > SQL Editor > New query > paste ALL > Run.
-- Safe to run more than once. Re-running never overwrites role icons/colors
-- you edited in the panel, and never removes staff.
--
-- WHERE THE SECURITY LIVES (read this once)
--   Nothing in the browser protects the admin panel. The page and admin.js can be
--   opened and edited by anyone. Every action goes through a database function that
--   checks, on the server, on EVERY call:
--     1. you are signed in,
--     2. you are in staff_members, at a high enough level for that action,
--     3. you unlocked the panel with YOUR admin password, from THIS login session,
--        within the last 30 idle minutes (8 hours max).
--   Admin passwords are stored only as bcrypt hashes in a table nobody can read.
--   Wrong passwords lock you out (5 tries, then 15+ minutes, growing). Every action,
--   every failure and every probe by a non-staff account lands in an append-only
--   audit log that no one can edit or delete from the website.
--
-- STAFF LEVELS
--   moderator  warn, suspend (max 72h), restrict, add notes, view logs
--   admin      everything a moderator does, plus bans/unbans, roles, longer suspensions
--   owner      everything, plus staff management, role definitions, password resets
--   Badges (roles) never grant access. Access comes only from staff_members.
-- ==========================================================================

create extension if not exists pgcrypto with schema extensions;


-- --------------------------------------------------------------------------
-- 1) STAFF + CREDENTIALS + AUDIT LOG
-- --------------------------------------------------------------------------
create table if not exists public.staff_members (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  level      text not null check (level in ('moderator', 'admin', 'owner')),
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_credentials (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  pass_hash       text,
  set_at          timestamptz,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  unlocked_at     timestamptz,
  unlocked_until  timestamptz,
  session_id      text
);

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  target_user uuid,
  target_name text,
  target_type text,
  target_id   text,
  reason      text,
  success     boolean not null default true,
  before      jsonb,
  after       jsonb,
  meta        jsonb
);

create index if not exists admin_audit_at_idx     on public.admin_audit_log (at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_log (target_user, at desc);
create index if not exists admin_audit_actor_idx  on public.admin_audit_log (actor_id, at desc);

-- append-only: no update, no delete, no truncate (from the website or the API)
create or replace function public.admin_audit_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log_is_append_only';
end;
$$;

drop trigger if exists admin_audit_no_change   on public.admin_audit_log;
drop trigger if exists admin_audit_no_truncate on public.admin_audit_log;
create trigger admin_audit_no_change   before update or delete on public.admin_audit_log for each row       execute function public.admin_audit_immutable();
create trigger admin_audit_no_truncate before truncate          on public.admin_audit_log for each statement execute function public.admin_audit_immutable();

alter table public.staff_members     enable row level security;
alter table public.staff_credentials enable row level security;
alter table public.admin_audit_log   enable row level security;
-- (no policies on purpose: these tables are only reachable through the functions below)

revoke all on public.staff_members, public.staff_credentials, public.admin_audit_log from anon, authenticated;


-- --------------------------------------------------------------------------
-- 2) ROLES (badges) - public to read, written only by admin functions
-- --------------------------------------------------------------------------
create table if not exists public.role_defs (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  category    text not null check (category in ('general', 'cosmetic', 'verified', 'level')),
  name        text not null check (char_length(name) between 2 and 60),
  icon        text not null default '*' check (char_length(icon) between 1 and 8),
  color       text not null default '#9ca3af' check (color ~ '^#[0-9a-fA-F]{6}$'),
  rank        int  not null default 100,
  min_grant   text not null default 'admin' check (min_grant in ('moderator', 'admin', 'owner')),
  active      boolean not null default true
);

create table if not exists public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    text not null references public.role_defs(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists user_roles_role_idx on public.user_roles (role_id);

alter table public.role_defs  enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "role definitions are public" on public.role_defs;
drop policy if exists "user roles are public"       on public.user_roles;
create policy "role definitions are public" on public.role_defs  for select using (true);
create policy "user roles are public"       on public.user_roles for select using (true);

revoke insert, update, delete, truncate on public.role_defs, public.user_roles from anon, authenticated;

-- seed (never overwrites what you edited later; rerunning only adds missing roles)
insert into public.role_defs (id, category, name, icon, color, rank, min_grant) values
  -- general
  ('founder',            'general', 'SPECSOFT Administrative Founder', '👑', '#f5c518',   0, 'owner'),
  ('head_management',    'general', 'SPECSOFT Head Management',        '🛡️', '#ef4444',  10, 'owner'),
  ('management',         'general', 'SPECSOFT Management',             '🏛️', '#f97316',  20, 'owner'),
  ('operations_chair',   'general', 'SPECSOFT Operations Chairman',    '⚙️', '#eab308',  30, 'owner'),
  ('development_team',   'general', 'SPECSOFT Development Team',       '💻', '#22d3ee',  40, 'admin'),
  ('moderation_team',    'general', 'Moderation Team',                 '🔨', '#a78bfa',  50, 'admin'),
  ('early_supporter',    'general', 'Early Supporter',                 '🌱', '#4ade80',  60, 'admin'),
  ('support_staff',      'general', 'SPECSOFT Support Staff',          '🎧', '#38bdf8',  70, 'admin'),
  ('high_effort_team',   'general', 'High Effort Team',                '🔥', '#fb923c',  80, 'admin'),
  ('health_safety',      'general', 'SPECSOFT Health & Safety Officer','🩺', '#34d399',  90, 'admin'),
  ('qa_testing',         'general', 'QA Testing Program',              '🧪', '#c084fc', 100, 'admin'),
  ('error_response',     'general', 'Error Response Specialist',       '🚨', '#f87171', 110, 'admin'),
  ('supporters',         'general', 'SPECSOFT Supporters',             '💜', '#a855f7', 120, 'admin'),
  ('vip',                'general', 'VIP',                             '💎', '#60a5fa', 130, 'admin'),
  ('artists',            'general', 'Artists',                         '🎨', '#f472b6', 140, 'admin'),
  ('partner_affairs',    'general', 'SPECSOFT Partner Affairs',        '🤝', '#2dd4bf', 150, 'admin'),
  ('recruitment',        'general', 'SPECSOFT Recruitment Division',   '📋', '#94a3b8', 160, 'admin'),
  -- cosmetic
  ('larpsoft',           'cosmetic', 'LaRpSoFT',                       '🎭', '#e879f9', 210, 'admin'),
  ('loyalists',          'cosmetic', 'SPECSOFT Loyalists',             '🏅', '#fbbf24', 220, 'admin'),
  ('contributors',       'cosmetic', 'Contributors',                   '🛠️', '#38bdf8', 230, 'admin'),
  ('legacy_members',     'cosmetic', 'Legacy Members',                 '📜', '#d6d3d1', 240, 'admin'),
  ('contest_winners',    'cosmetic', 'Contest Winners',                '🏆', '#facc15', 250, 'admin'),
  ('event_winners',      'cosmetic', 'Event Winners',                  '🥇', '#fcd34d', 260, 'admin'),
  ('affiliates',         'cosmetic', 'Affiliates',                     '🔗', '#5eead4', 270, 'admin'),
  ('ambassadors',        'cosmetic', 'Community Ambassadors',          '📣', '#fb7185', 280, 'admin'),
  ('hall_of_fame',       'cosmetic', 'Hall of Fame',                   '🌟', '#fde047', 290, 'admin'),
  ('collaborators',      'cosmetic', 'Collaborators',                  '🧩', '#818cf8', 300, 'admin'),
  ('trusted',            'cosmetic', 'Trusted',                        '🔰', '#86efac', 310, 'admin'),
  -- verified (one at a time)
  ('verified_gold',      'verified', 'Gold Verified',                  '✔️', '#f5c518', 410, 'admin'),
  ('verified_blue',      'verified', 'Blue Verified',                  '✔️', '#3b82f6', 420, 'admin'),
  ('verified_green',     'verified', 'Green Verified',                 '✔️', '#22c55e', 430, 'admin'),
  ('verified_none',      'verified', 'Non Verified',                   '○',  '#6b7280', 440, 'admin'),
  -- level (one at a time)
  ('tier_1',             'level', 'Tier 1 - Noob',                     '🥚', '#9ca3af', 501, 'admin'),
  ('tier_2',             'level', 'Tier 2 - Rookie',                   '🐣', '#a3e635', 502, 'admin'),
  ('tier_3',             'level', 'Tier 3 - Professionals',            '💼', '#4ade80', 503, 'admin'),
  ('tier_4',             'level', 'Tier 4 - Apprentice',               '📘', '#38bdf8', 504, 'admin'),
  ('tier_5',             'level', 'Tier 5 - Epic',                     '⚡', '#a78bfa', 505, 'admin'),
  ('tier_6',             'level', 'Tier 6 - Master',                   '🥋', '#f472b6', 506, 'admin'),
  ('tier_7',             'level', 'Tier 7 - The Grandmaster',          '🧠', '#fb923c', 507, 'admin'),
  ('tier_8',             'level', 'Tier 8 - SPECSOFT Legend',          '🌠', '#facc15', 508, 'admin')
on conflict (id) do nothing;


-- --------------------------------------------------------------------------
-- 3) SANCTIONS, NOTES, NOTICES, PRESENCE
-- --------------------------------------------------------------------------
create table if not exists public.user_sanctions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('warning', 'suspension', 'ban', 'restrict_post', 'restrict_comment', 'restrict_chat')),
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  issued_by     uuid references public.profiles(id) on delete set null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles(id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 500)
);

create index if not exists user_sanctions_user_idx   on public.user_sanctions (user_id, created_at desc);
create index if not exists user_sanctions_active_idx on public.user_sanctions (user_id, kind) where revoked_at is null;

create table if not exists public.staff_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  note       text not null check (char_length(btrim(note)) between 2 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists staff_notes_user_idx on public.staff_notes (user_id, created_at desc);

create table if not exists public.user_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('warning', 'suspension', 'ban', 'restriction', 'lifted', 'report_update', 'info')),
  title      text not null check (char_length(title) between 1 and 120),
  body       text check (body is null or char_length(body) <= 600),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists user_notices_user_idx on public.user_notices (user_id, created_at desc);

create table if not exists public.user_presence (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now(),
  page      text check (page is null or char_length(page) <= 60)
);

alter table public.user_sanctions enable row level security;
alter table public.staff_notes    enable row level security;
alter table public.user_notices   enable row level security;
alter table public.user_presence  enable row level security;

drop policy if exists "members read own notices" on public.user_notices;
create policy "members read own notices" on public.user_notices for select to authenticated using (user_id = auth.uid());

revoke all on public.user_sanctions, public.staff_notes, public.user_presence from anon, authenticated;
revoke all on public.user_notices from anon;
revoke insert, update, delete, truncate on public.user_notices from authenticated;


-- --------------------------------------------------------------------------
-- 4) INTERNAL HELPERS (not callable from the website)
-- --------------------------------------------------------------------------
create or replace function public.staff_rank(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case level when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end
    from public.staff_members where user_id = p_user
  ), 0);
$$;

create or replace function public.sanction_active(p_user uuid, p_kinds text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_sanctions s
    where s.user_id = p_user
      and s.kind = any (p_kinds)
      and s.revoked_at is null
      and s.starts_at <= now()
      and (s.ends_at is null or s.ends_at > now())
  );
$$;

-- the only sanction check the website itself may call: it can only ever look at YOU
create or replace function public.sanction_active_self(p_kinds text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.sanction_active(auth.uid(), p_kinds);
$$;

create or replace function public.admin_unlocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.unlocked_until > now()
       and c.unlocked_at > now() - interval '8 hours'
       and coalesce(c.session_id, '') = coalesce(auth.jwt() ->> 'session_id', '')
    from public.staff_credentials c where c.user_id = p_user
  ), false);
$$;

create or replace function public.admin_log(
  p_action text, p_target uuid, p_reason text, p_success boolean,
  p_before jsonb, p_after jsonb, p_meta jsonb default null,
  p_ttype text default null, p_tid text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_log
    (actor_id, actor_name, action, target_user, target_name, target_type, target_id, reason, success, before, after, meta)
  values
    (auth.uid(), (select username from public.profiles where id = auth.uid()), p_action,
     p_target, (select username from public.profiles where id = p_target), p_ttype, p_tid,
     left(p_reason, 500), p_success, p_before, p_after, p_meta);
end;
$$;

-- security alerts, at most one per person per kind per minute so nobody can flood the log
create or replace function public.admin_alert(p_kind text, p_meta jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.admin_audit_log
    where actor_id is not distinct from auth.uid() and action = 'security:' || p_kind and at > now() - interval '1 minute'
  ) then
    return;
  end if;
  perform public.admin_log('security:' || p_kind, null, null, false, null, null, p_meta);
end;
$$;

create or replace function public.admin_fail(p_action text, p_target uuid, p_reason text, p_err text, p_meta jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_log(p_action, p_target, p_reason, false, null, null, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('error', p_err));
  return jsonb_build_object('ok', false, 'error', p_err);
end;
$$;

-- returns NULL when allowed, otherwise the reason it is not
create or replace function public.admin_gate(p_min text, p_action text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_need int;
begin
  if auth.uid() is null then
    return 'not_authenticated';
  end if;

  v_rank := public.staff_rank(auth.uid());
  if v_rank = 0 then
    perform public.admin_alert('forbidden_probe', jsonb_build_object('action', p_action));
    return 'not_staff';
  end if;

  if not public.admin_unlocked(auth.uid()) then
    return 'locked';
  end if;

  v_need := case p_min when 'owner' then 3 when 'admin' then 2 else 1 end;
  if v_rank < v_need then
    perform public.admin_alert('forbidden_action', jsonb_build_object('action', p_action, 'needs', p_min));
    return 'forbidden';
  end if;

  -- sliding idle timeout
  update public.staff_credentials set unlocked_until = now() + interval '30 minutes' where user_id = auth.uid();
  return null;
end;
$$;

create or replace function public.admin_notify(p_user uuid, p_kind text, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_notices (user_id, kind, title, body) values (p_user, p_kind, left(p_title, 120), left(p_body, 600));
$$;


-- --------------------------------------------------------------------------
-- 5) ENFORCEMENT: sanctions really block things, in the database
--    RESTRICTIVE policies are added on top of your existing policies, and use their
--    own names, so re-running supabase-project-social.sql / supabase-profiles.sql
--    does not remove them.
-- --------------------------------------------------------------------------
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('profile_project_comments', 'insert', 'sanctions block commenting', array['ban', 'suspension', 'restrict_comment']),
      ('profile_projects',         'insert', 'sanctions block posting',    array['ban', 'suspension', 'restrict_post']),
      ('profile_highlights',       'insert', 'sanctions block posting',    array['ban', 'suspension', 'restrict_post']),
      ('profile_reposts',          'insert', 'sanctions block posting',    array['ban', 'suspension', 'restrict_post']),
      ('profile_project_likes',    'insert', 'sanctions block activity',   array['ban', 'suspension']),
      ('profile_follows',          'insert', 'sanctions block activity',   array['ban', 'suspension']),
      ('profiles',                 'update', 'sanctions block profile edits', array['ban', 'suspension'])
    ) as t(tbl, cmd, pol, kinds)
  loop
    if to_regclass('public.' || spec.tbl) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', spec.pol, spec.tbl);

    if spec.cmd = 'insert' then
      execute format(
        'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.sanction_active_self(%L::text[]))',
        spec.pol, spec.tbl, spec.kinds);
    else
      execute format(
        'create policy %I on public.%I as restrictive for update to authenticated using (not public.sanction_active_self(%L::text[])) with check (not public.sanction_active_self(%L::text[]))',
        spec.pol, spec.tbl, spec.kinds, spec.kinds);
    end if;
  end loop;
end $$;

-- chat: a trigger on the table, so it works no matter how chat_send is written
create or replace function public.enforce_chat_sanctions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.sanction_active(new.sender_id, array['ban', 'suspension', 'restrict_chat']) then
    raise exception 'account_restricted';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.chat_messages') is not null then
    drop trigger if exists chat_sanctions_guard on public.chat_messages;
    create trigger chat_sanctions_guard before insert on public.chat_messages
      for each row execute function public.enforce_chat_sanctions();
  end if;
end $$;


-- --------------------------------------------------------------------------
-- 6) FUNCTIONS EVERY SIGNED-IN MEMBER USES (presence + "my account standing")
-- --------------------------------------------------------------------------
create or replace function public.presence_touch(p_page text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.user_presence (user_id, last_seen, page)
  values (auth.uid(), now(), left(p_page, 60))
  on conflict (user_id) do update
    set last_seen = now(), page = left(excluded.page, 60)
    where public.user_presence.last_seen < now() - interval '25 seconds';
end;
$$;

create or replace function public.my_standing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('sanctions', '[]'::jsonb, 'warnings', 0, 'notices', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'sanctions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'reason', s.reason, 'ends_at', s.ends_at) order by s.created_at desc)
      from public.user_sanctions s
      where s.user_id = v_uid and s.kind <> 'warning' and s.revoked_at is null
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    ), '[]'::jsonb),
    'warnings', (
      select count(*) from public.user_sanctions s
      where s.user_id = v_uid and s.kind = 'warning' and s.revoked_at is null
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    ),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'created_at', n.created_at) order by n.created_at desc)
      from (
        select * from public.user_notices where user_id = v_uid and read_at is null order by created_at desc limit 5
      ) n
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.notice_mark_read(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_notices set read_at = now()
  where user_id = auth.uid() and id = any (p_ids) and read_at is null;
$$;


-- --------------------------------------------------------------------------
-- 7) PANEL ACCESS: status, unlock, lock, passwords
-- --------------------------------------------------------------------------
create or replace function public.admin_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_level text;
  v_cred public.staff_credentials;
  v_ok boolean;
begin
  if v_uid is null then
    return jsonb_build_object('staff', false);
  end if;

  select level into v_level from public.staff_members where user_id = v_uid;
  if v_level is null then
    perform public.admin_alert('panel_probe', null);
    return jsonb_build_object('staff', false);
  end if;

  select * into v_cred from public.staff_credentials where user_id = v_uid;
  v_ok := public.admin_unlocked(v_uid);

  return jsonb_build_object(
    'staff', true,
    'level', v_level,
    'username', (select username from public.profiles where id = v_uid),
    'password_set', coalesce(v_cred.pass_hash is not null, false),
    'unlocked', v_ok,
    'unlocked_until', case when v_ok then v_cred.unlocked_until end,
    'locked_until', case when v_cred.locked_until > now() then v_cred.locked_until end
  );
end;
$$;

create or replace function public.admin_unlock(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cred public.staff_credentials;
  v_failed int;
  v_lock timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public.staff_rank(v_uid) = 0 then
    perform public.admin_alert('unlock_probe', null);
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  insert into public.staff_credentials (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_cred from public.staff_credentials where user_id = v_uid for update;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts', 'retry_at', v_cred.locked_until);
  end if;

  if v_cred.pass_hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_password');
  end if;

  if p_password is not null and extensions.crypt(p_password, v_cred.pass_hash) = v_cred.pass_hash then
    update public.staff_credentials
    set failed_attempts = 0, locked_until = null, unlocked_at = now(),
        unlocked_until = now() + interval '30 minutes', session_id = coalesce(auth.jwt() ->> 'session_id', '')
    where user_id = v_uid;
    perform public.admin_log('panel_unlock', null, null, true, null, null);
    return jsonb_build_object('ok', true, 'unlocked_until', now() + interval '30 minutes');
  end if;

  perform pg_sleep(0.6);   -- slows down guessing
  v_failed := v_cred.failed_attempts + 1;
  v_lock := case when v_failed >= 5 then now() + least(interval '24 hours', interval '15 minutes' * (1 + (v_failed - 5))) end;

  update public.staff_credentials
  set failed_attempts = v_failed, locked_until = coalesce(v_lock, locked_until)
  where user_id = v_uid;

  perform public.admin_log('panel_unlock', null, null, false, null, null, jsonb_build_object('attempts', v_failed, 'locked', v_lock is not null));

  return jsonb_build_object(
    'ok', false,
    'error', case when v_lock is not null then 'too_many_attempts' else 'bad_password' end,
    'attempts_left', greatest(0, 5 - v_failed),
    'retry_at', v_lock
  );
end;
$$;

create or replace function public.admin_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update public.staff_credentials set unlocked_until = null where user_id = auth.uid();
$$;

-- first password (no current needed), or a change (current required)
create or replace function public.admin_set_password(p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cred public.staff_credentials;
  v_failed int;
  v_lock timestamptz;
  v_first boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public.staff_rank(v_uid) = 0 then
    perform public.admin_alert('password_probe', null);
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  if p_new is null or char_length(p_new) < 12 or char_length(p_new) > 128
     or lower(p_new) = lower(coalesce((select username from public.profiles where id = v_uid), '')) then
    return jsonb_build_object('ok', false, 'error', 'weak_password');
  end if;

  insert into public.staff_credentials (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_cred from public.staff_credentials where user_id = v_uid for update;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts', 'retry_at', v_cred.locked_until);
  end if;

  v_first := v_cred.pass_hash is null;

  if not v_first then
    if p_current is null or extensions.crypt(p_current, v_cred.pass_hash) <> v_cred.pass_hash then
      perform pg_sleep(0.6);
      v_failed := v_cred.failed_attempts + 1;
      v_lock := case when v_failed >= 5 then now() + least(interval '24 hours', interval '15 minutes' * (1 + (v_failed - 5))) end;
      update public.staff_credentials set failed_attempts = v_failed, locked_until = coalesce(v_lock, locked_until) where user_id = v_uid;
      perform public.admin_log('password_change', null, null, false, null, null, jsonb_build_object('attempts', v_failed));
      return jsonb_build_object('ok', false, 'error', 'bad_password');
    end if;
  end if;

  update public.staff_credentials
  set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 12)),
      set_at = now(), failed_attempts = 0, locked_until = null,
      unlocked_at = now(), unlocked_until = now() + interval '30 minutes',
      session_id = coalesce(auth.jwt() ->> 'session_id', '')
  where user_id = v_uid;

  perform public.admin_log(case when v_first then 'password_create' else 'password_change' end, null, null, true, null, null);
  return jsonb_build_object('ok', true, 'unlocked_until', now() + interval '30 minutes');
end;
$$;

create or replace function public.admin_reset_staff_password(p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('owner', 'reset_staff_password');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_user = auth.uid() or not exists (select 1 from public.staff_members where user_id = p_user) then
    return public.admin_fail('password_reset', p_user, p_reason, 'bad_target');
  end if;

  update public.staff_credentials
  set pass_hash = null, set_at = null, failed_attempts = 0, locked_until = null, unlocked_until = null, session_id = null
  where user_id = p_user;

  perform public.admin_log('password_reset', p_user, p_reason, true, null, null);
  return jsonb_build_object('ok', true);
end;
$$;


-- --------------------------------------------------------------------------
-- 8) DASHBOARD, USERS, SANCTIONS, NOTES
-- --------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_reports bigint := 0;
begin
  v_err := public.admin_gate('moderator', 'dashboard');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  begin
    select count(*) into v_reports from public.profile_project_reports;
  exception when undefined_table then
    v_reports := 0;
  end;

  return jsonb_build_object(
    'ok', true,
    'users_total',   (select count(*) from public.profiles),
    'users_24h',     (select count(*) from public.profiles where created_at > now() - interval '24 hours'),
    'online_now',    (select count(*) from public.user_presence where last_seen > now() - interval '2 minutes'),
    'staff_online',  (select count(*) from public.user_presence up join public.staff_members sm on sm.user_id = up.user_id where up.last_seen > now() - interval '2 minutes'),
    'warnings_active', (select count(*) from public.user_sanctions where kind = 'warning' and revoked_at is null and starts_at <= now() and (ends_at is null or ends_at > now())),
    'suspensions_active', (select count(*) from public.user_sanctions where kind = 'suspension' and revoked_at is null and starts_at <= now() and (ends_at is null or ends_at > now())),
    'bans_active',   (select count(*) from public.user_sanctions where kind = 'ban' and revoked_at is null and starts_at <= now() and (ends_at is null or ends_at > now())),
    'restrictions_active', (select count(*) from public.user_sanctions where kind like 'restrict\_%' and revoked_at is null and starts_at <= now() and (ends_at is null or ends_at > now())),
    'reports_total', v_reports,
    'actions_24h',   (select count(*) from public.admin_audit_log where at > now() - interval '24 hours' and action not like 'security:%'),
    'alerts_24h',    (select count(*) from public.admin_audit_log where at > now() - interval '24 hours' and (action like 'security:%' or (success = false and action = 'panel_unlock'))),
    'recent_actions', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id desc) from (
        select id, at, actor_name, action, target_name, reason, success
        from public.admin_audit_log where action not like 'security:%' order by id desc limit 8
      ) a), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id desc) from (
        select id, at, actor_name, action, meta, success
        from public.admin_audit_log
        where action like 'security:%' or (success = false and action = 'panel_unlock')
        order by id desc limit 8
      ) a), '[]'::jsonb),
    'newest_users', coalesce((
      select jsonb_agg(to_jsonb(u) order by u.created_at desc) from (
        select id, username, display_name, avatar_url, created_at from public.profiles order by created_at desc limit 6
      ) u), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_online_users()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('moderator', 'online_users');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(to_jsonb(o) order by o.last_seen desc) from (
      select p.id, p.username, p.display_name, p.avatar_url, up.last_seen, up.page,
             (select sm.level from public.staff_members sm where sm.user_id = p.id) as staff_level
      from public.user_presence up
      join public.profiles p on p.id = up.user_id
      where up.last_seen > now() - interval '2 minutes'
      order by up.last_seen desc limit 100
    ) o), '[]'::jsonb));
end;
$$;

create or replace function public.admin_find_users(p_q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_q text := btrim(coalesce(p_q, ''));
  v_like text;
  v_rows jsonb;
begin
  v_err := public.admin_gate('moderator', 'find_users');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'users', '[]'::jsonb);
  end if;

  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rows from (
    select p.id, p.username, p.display_name, p.avatar_url, p.created_at,
           coalesce((select jsonb_agg(ur.role_id) from public.user_roles ur where ur.user_id = p.id), '[]'::jsonb) as roles,
           public.sanction_active(p.id, array['ban'])        as banned,
           public.sanction_active(p.id, array['suspension']) as suspended,
           (select count(*) from public.user_sanctions s
             where s.user_id = p.id and s.kind <> 'warning' and s.revoked_at is null and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())) as active_sanctions,
           (select count(*) from public.user_sanctions s
             where s.user_id = p.id and s.kind = 'warning' and s.revoked_at is null and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())) as active_warnings,
           (select sm.level from public.staff_members sm where sm.user_id = p.id) as staff_level,
           (select up.last_seen from public.user_presence up where up.user_id = p.id) as last_seen
    from public.profiles p
    where p.id::text = lower(v_q)
       or p.username ilike v_like escape '\'
       or p.display_name ilike v_like escape '\'
    order by (lower(p.username) = lower(v_q)) desc, p.username
    limit 25
  ) u;

  return jsonb_build_object('ok', true, 'users', v_rows);
end;
$$;

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_profile jsonb;
begin
  v_err := public.admin_gate('moderator', 'user_detail');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select jsonb_build_object(
           'id', p.id, 'username', p.username, 'display_name', p.display_name, 'headline', p.headline,
           'bio', p.bio, 'location', p.location, 'avatar_url', p.avatar_url, 'banner_url', p.banner_url,
           'status', p.status, 'links', p.links, 'created_at', p.created_at, 'updated_at', p.updated_at)
    into v_profile
  from public.profiles p where p.id = p_user;

  if v_profile is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', v_profile,
    'staff_level', (select level from public.staff_members where user_id = p_user),
    'last_seen',   (select last_seen from public.user_presence where user_id = p_user),
    'roles', coalesce((select jsonb_agg(role_id) from public.user_roles where user_id = p_user), '[]'::jsonb),
    'sanctions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
        select x.id, x.kind, x.reason, x.starts_at, x.ends_at, x.created_at, x.revoked_at, x.revoke_reason,
               (select username from public.profiles where id = x.issued_by)  as issued_by_name,
               (select username from public.profiles where id = x.revoked_by) as revoked_by_name,
               (x.revoked_at is null and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())) as active
        from public.user_sanctions x where x.user_id = p_user order by x.created_at desc limit 100
      ) s), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (
        select x.id, x.note, x.created_at, (select username from public.profiles where id = x.author_id) as author_name
        from public.staff_notes x where x.user_id = p_user order by x.created_at desc limit 100
      ) n), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id desc) from (
        select id, at, actor_name, action, reason, success, before, after
        from public.admin_audit_log where target_user = p_user and action not like 'security:%' order by id desc limit 25
      ) a), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_issue_sanction(p_user uuid, p_kind text, p_reason text, p_hours int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_rank int;
  v_hours int := p_hours;
  v_ends timestamptz;
  v_id uuid;
  v_title text;
  v_meta jsonb := jsonb_build_object('kind', p_kind, 'hours', p_hours);
begin
  v_err := public.admin_gate(case when p_kind = 'ban' then 'admin' else 'moderator' end, 'sanction_' || coalesce(p_kind, '?'));
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_rank := public.staff_rank(auth.uid());

  if p_kind is null or p_kind not in ('warning', 'suspension', 'ban', 'restrict_post', 'restrict_comment', 'restrict_chat') then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'bad_kind', v_meta);
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'reason_required', v_meta);
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'not_found', v_meta);
  end if;
  if p_user = auth.uid() then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'not_yourself', v_meta);
  end if;
  if public.staff_rank(p_user) >= v_rank then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'target_outranks_you', v_meta);
  end if;
  if p_kind <> 'warning' and public.sanction_active(p_user, array[p_kind]) then
    return public.admin_fail('sanction_issue', p_user, p_reason, 'already_active', v_meta);
  end if;

  if p_kind = 'suspension' then
    if v_hours is null or v_hours < 1 or v_hours > 8760 then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'bad_duration', v_meta);
    end if;
    if v_rank = 1 and v_hours > 72 then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'mods_max_72h', v_meta);
    end if;
  elsif p_kind = 'warning' then
    v_hours := coalesce(v_hours, 2160);            -- warnings fade after 90 days unless told otherwise
    if v_hours < 1 or v_hours > 8760 then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'bad_duration', v_meta);
    end if;
  else
    if v_hours is not null and (v_hours < 1 or v_hours > 87600) then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'bad_duration', v_meta);
    end if;
    if v_hours is not null and v_rank = 1 and v_hours > 72 then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'mods_max_72h', v_meta);
    end if;
    if v_hours is null and v_rank = 1 then
      return public.admin_fail('sanction_issue', p_user, p_reason, 'mods_max_72h', v_meta);   -- moderators cannot make permanent restrictions
    end if;
  end if;

  v_ends := case when v_hours is null then null else now() + make_interval(hours => v_hours) end;

  insert into public.user_sanctions (user_id, kind, reason, issued_by, ends_at)
  values (p_user, p_kind, btrim(p_reason), auth.uid(), v_ends)
  returning id into v_id;

  v_title := case p_kind
    when 'warning'          then 'You received a warning'
    when 'suspension'       then 'Your account has been suspended'
    when 'ban'              then 'Your account has been banned'
    when 'restrict_post'    then 'Posting has been restricted on your account'
    when 'restrict_comment' then 'Commenting has been restricted on your account'
    else                         'Chat has been restricted on your account'
  end;

  perform public.admin_notify(p_user,
    case when p_kind in ('warning', 'suspension', 'ban') then p_kind else 'restriction' end,
    v_title,
    btrim(p_reason) || case when v_ends is not null then ' (until ' || to_char(v_ends at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' else '' end);

  perform public.admin_log('sanction_issue', p_user, p_reason, true, null,
    jsonb_build_object('id', v_id, 'kind', p_kind, 'ends_at', v_ends), null, 'sanction', v_id::text);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_revoke_sanction(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_s public.user_sanctions;
  v_rank int;
begin
  select * into v_s from public.user_sanctions where id = p_id;

  v_err := public.admin_gate(case when v_s.kind = 'ban' then 'admin' else 'moderator' end, 'sanction_revoke');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_rank := public.staff_rank(auth.uid());

  if v_s.id is null then
    return public.admin_fail('sanction_revoke', null, p_reason, 'not_found');
  end if;
  if v_s.revoked_at is not null then
    return public.admin_fail('sanction_revoke', v_s.user_id, p_reason, 'already_revoked');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return public.admin_fail('sanction_revoke', v_s.user_id, p_reason, 'reason_required');
  end if;
  if public.staff_rank(v_s.user_id) >= v_rank then
    return public.admin_fail('sanction_revoke', v_s.user_id, p_reason, 'target_outranks_you');
  end if;

  update public.user_sanctions
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(btrim(p_reason), 500)
  where id = p_id;

  if v_s.kind <> 'warning' then
    perform public.admin_notify(v_s.user_id, 'lifted',
      case v_s.kind when 'ban' then 'Your ban has been lifted' when 'suspension' then 'Your suspension has been lifted' else 'A restriction on your account was lifted' end,
      null);
  end if;

  perform public.admin_log('sanction_revoke', v_s.user_id, p_reason, true,
    jsonb_build_object('id', v_s.id, 'kind', v_s.kind, 'ends_at', v_s.ends_at, 'revoked', false),
    jsonb_build_object('id', v_s.id, 'kind', v_s.kind, 'revoked', true), null, 'sanction', p_id::text);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_add_note(p_user uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_id uuid;
begin
  v_err := public.admin_gate('moderator', 'note_add');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if char_length(btrim(coalesce(p_note, ''))) < 2 or char_length(p_note) > 1000 then
    return public.admin_fail('note_add', p_user, null, 'bad_note');
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return public.admin_fail('note_add', p_user, null, 'not_found');
  end if;

  insert into public.staff_notes (user_id, author_id, note) values (p_user, auth.uid(), btrim(p_note)) returning id into v_id;
  perform public.admin_log('note_add', p_user, null, true, null, jsonb_build_object('id', v_id), null, 'note', v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;


-- --------------------------------------------------------------------------
-- 9) ROLES + STAFF + AUDIT
-- --------------------------------------------------------------------------
create or replace function public.admin_set_roles(p_user uuid, p_category text, p_role_ids text[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_rank int;
  v_ids text[] := coalesce(p_role_ids, '{}');
  v_before jsonb;
  v_after jsonb;
  r record;
  v_need int;
  v_meta jsonb := jsonb_build_object('category', p_category);
begin
  v_err := public.admin_gate('admin', 'roles_set');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_rank := public.staff_rank(auth.uid());

  if p_category is null or p_category not in ('general', 'cosmetic', 'verified', 'level') then
    return public.admin_fail('roles_set', p_user, p_reason, 'bad_category', v_meta);
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return public.admin_fail('roles_set', p_user, p_reason, 'reason_required', v_meta);
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return public.admin_fail('roles_set', p_user, p_reason, 'not_found', v_meta);
  end if;
  if p_category in ('verified', 'level') and cardinality(v_ids) > 1 then
    return public.admin_fail('roles_set', p_user, p_reason, 'only_one_allowed', v_meta);
  end if;
  if exists (
    select 1 from unnest(v_ids) i
    where not exists (select 1 from public.role_defs d where d.id = i and d.category = p_category and d.active)
  ) then
    return public.admin_fail('roles_set', p_user, p_reason, 'bad_role', v_meta);
  end if;

  -- every role being added or removed must be one this person is allowed to hand out
  for r in
    select d.id, d.min_grant
    from public.role_defs d
    where d.category = p_category
      and (
        (d.id = any (v_ids)     and not exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role_id = d.id))
        or
        (not (d.id = any (v_ids)) and exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role_id = d.id))
      )
  loop
    v_need := case r.min_grant when 'owner' then 3 when 'admin' then 2 else 1 end;
    if v_rank < v_need then
      return public.admin_fail('roles_set', p_user, p_reason, 'role_not_grantable', v_meta || jsonb_build_object('role', r.id));
    end if;
  end loop;

  select coalesce(jsonb_agg(ur.role_id order by ur.role_id), '[]'::jsonb) into v_before
  from public.user_roles ur join public.role_defs d on d.id = ur.role_id
  where ur.user_id = p_user and d.category = p_category;

  delete from public.user_roles ur using public.role_defs d
  where ur.role_id = d.id and ur.user_id = p_user and d.category = p_category and not (d.id = any (v_ids));

  insert into public.user_roles (user_id, role_id, granted_by)
  select p_user, i, auth.uid() from unnest(v_ids) i
  on conflict do nothing;

  select coalesce(jsonb_agg(ur.role_id order by ur.role_id), '[]'::jsonb) into v_after
  from public.user_roles ur join public.role_defs d on d.id = ur.role_id
  where ur.user_id = p_user and d.category = p_category;

  perform public.admin_log('roles_set', p_user, p_reason, true,
    jsonb_build_object('category', p_category, 'roles', v_before),
    jsonb_build_object('category', p_category, 'roles', v_after));

  return jsonb_build_object('ok', true, 'roles', coalesce((select jsonb_agg(role_id) from public.user_roles where user_id = p_user), '[]'::jsonb));
end;
$$;

create or replace function public.admin_upsert_role_def(
  p_id text, p_category text, p_name text, p_icon text, p_color text, p_rank int, p_min_grant text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_before jsonb;
  v_after jsonb;
begin
  v_err := public.admin_gate('owner', 'role_def_upsert');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_id is null or p_id !~ '^[a-z0-9_]{2,40}$'
     or p_category not in ('general', 'cosmetic', 'verified', 'level')
     or char_length(btrim(coalesce(p_name, ''))) not between 2 and 60
     or char_length(coalesce(p_icon, '')) not between 1 and 8
     or p_color !~ '^#[0-9a-fA-F]{6}$'
     or p_min_grant not in ('moderator', 'admin', 'owner') then
    return public.admin_fail('role_def_upsert', null, null, 'bad_input', jsonb_build_object('id', p_id));
  end if;

  select to_jsonb(d) into v_before from public.role_defs d where d.id = p_id;

  insert into public.role_defs (id, category, name, icon, color, rank, min_grant, active)
  values (p_id, p_category, btrim(p_name), p_icon, p_color, coalesce(p_rank, 100), p_min_grant, coalesce(p_active, true))
  on conflict (id) do update
    set category = excluded.category, name = excluded.name, icon = excluded.icon, color = excluded.color,
        rank = excluded.rank, min_grant = excluded.min_grant, active = excluded.active;

  select to_jsonb(d) into v_after from public.role_defs d where d.id = p_id;

  perform public.admin_log('role_def_upsert', null, null, true, v_before, v_after, null, 'role', p_id);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_staff_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('admin', 'staff_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true, 'staff', coalesce((
    select jsonb_agg(to_jsonb(s) order by s.rank desc, s.username) from (
      select p.id, p.username, p.display_name, p.avatar_url, sm.level, sm.created_at,
             case sm.level when 'owner' then 3 when 'admin' then 2 else 1 end as rank,
             coalesce(c.pass_hash is not null, false) as password_set,
             (select up.last_seen from public.user_presence up where up.user_id = p.id) as last_seen
      from public.staff_members sm
      join public.profiles p on p.id = sm.user_id
      left join public.staff_credentials c on c.user_id = sm.user_id
    ) s), '[]'::jsonb));
end;
$$;

-- p_level null removes someone from staff. Owners can only be changed in the SQL editor.
create or replace function public.admin_set_staff(p_user uuid, p_level text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_before text;
begin
  v_err := public.admin_gate('owner', 'staff_set');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_user = auth.uid() then
    return public.admin_fail('staff_set', p_user, p_reason, 'not_yourself');
  end if;
  if p_level is not null and p_level not in ('moderator', 'admin') then
    return public.admin_fail('staff_set', p_user, p_reason, 'bad_level');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    return public.admin_fail('staff_set', p_user, p_reason, 'reason_required');
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return public.admin_fail('staff_set', p_user, p_reason, 'not_found');
  end if;

  select level into v_before from public.staff_members where user_id = p_user;
  if v_before = 'owner' then
    return public.admin_fail('staff_set', p_user, p_reason, 'cannot_change_owner');
  end if;

  if p_level is null then
    delete from public.staff_members where user_id = p_user;
    delete from public.staff_credentials where user_id = p_user;
  else
    insert into public.staff_members (user_id, level, added_by) values (p_user, p_level, auth.uid())
    on conflict (user_id) do update set level = excluded.level;
  end if;

  perform public.admin_log('staff_set', p_user, p_reason, true,
    jsonb_build_object('level', v_before), jsonb_build_object('level', p_level));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_audit_list(
  p_limit int default 50, p_before bigint default null, p_action text default null,
  p_target uuid default null, p_actor uuid default null, p_success boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_like text;
begin
  v_err := public.admin_gate('moderator', 'audit_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  v_like := case when p_action is null or btrim(p_action) = '' then null
                 else replace(replace(replace(btrim(p_action), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(to_jsonb(a) order by a.id desc) from (
      select id, at, actor_id, actor_name, action, target_user, target_name, target_type, target_id, reason, success, before, after, meta
      from public.admin_audit_log
      where (p_before is null or id < p_before)
        and (v_like is null or action like v_like escape '\')
        and (p_target is null or target_user = p_target)
        and (p_actor is null or actor_id = p_actor)
        and (p_success is null or success = p_success)
      order by id desc limit v_limit
    ) a), '[]'::jsonb));
end;
$$;


-- --------------------------------------------------------------------------
-- 10) WHO CAN CALL WHAT
--     Supabase gives every new function to anonymous visitors by default. This takes
--     that away, then hands back only what each function needs.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
  v_client text[] := array[
    'admin_status', 'admin_unlock', 'admin_lock', 'admin_set_password', 'admin_reset_staff_password',
    'admin_dashboard', 'admin_online_users', 'admin_find_users', 'admin_user_detail',
    'admin_issue_sanction', 'admin_revoke_sanction', 'admin_add_note', 'admin_set_roles',
    'admin_upsert_role_def', 'admin_staff_list', 'admin_set_staff', 'admin_audit_list',
    'presence_touch', 'my_standing', 'notice_mark_read', 'sanction_active_self'
  ];
  v_internal text[] := array[
    'staff_rank', 'sanction_active', 'admin_unlocked', 'admin_log', 'admin_alert', 'admin_fail',
    'admin_gate', 'admin_notify', 'enforce_chat_sanctions', 'admin_audit_immutable'
  ];
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


-- --------------------------------------------------------------------------
-- 11) FIRST OWNER: Aspec_404
--     Needs an existing profile. If it says "no profile yet", sign in to the website,
--     open your profile page once, then run this file again.
-- --------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where lower(username) = 'aspec_404';

  if v_id is null then
    raise notice 'NO PROFILE YET for Aspec_404: sign in to the website, open your profile once, then run this file again.';
  else
    insert into public.staff_members (user_id, level, added_by) values (v_id, 'owner', v_id)
    on conflict (user_id) do update set level = 'owner';

    insert into public.user_roles (user_id, role_id, granted_by) values (v_id, 'founder', v_id)
    on conflict do nothing;

    raise notice 'Aspec_404 is now owner + SPECSOFT Administrative Founder.';
  end if;
end $$;