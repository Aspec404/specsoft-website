-- ==========================================================================
-- SPECSOFT® BAN SCREEN (data + "report this as a mistake")
--
-- RUN AFTER supabase-admin.sql. Safe to run more than once. Purely additive: it never
-- redefines your existing admin functions, so your revamped admin SQL stays as it is.
--
-- What the member sees on the ban screen comes from my_ban_status():
--   reason, moderator note, the evidence we reviewed (ID + date), the duration, and the
--   status of any "report this as a mistake" they sent.
-- Staff fill in the note and evidence with admin_set_sanction_details() after (or while)
-- issuing a ban or suspension, and answer mistake reports with admin_appeals_list() /
-- admin_appeal_resolve().
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) TABLES
-- --------------------------------------------------------------------------
alter table public.user_sanctions add column if not exists mod_note text;
alter table public.user_sanctions drop constraint if exists user_sanctions_mod_note_len;
alter table public.user_sanctions add constraint user_sanctions_mod_note_len
  check (mod_note is null or char_length(mod_note) <= 500);

create table if not exists public.sanction_evidence (
  id          uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.user_sanctions(id) on delete cascade,
  ref         text not null unique default ('EV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  summary     text not null check (char_length(btrim(summary)) between 3 and 500),
  reviewed_at timestamptz not null default now(),
  added_by    uuid references public.profiles(id) on delete set null
);

create index if not exists sanction_evidence_sanction_idx on public.sanction_evidence (sanction_id, reviewed_at desc);

create table if not exists public.ban_appeals (
  id          uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.user_sanctions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('appeal', 'mistake')),
  message     text not null check (char_length(btrim(message)) between 10 and 1000),
  status      text not null default 'open' check (status in ('open', 'reviewing', 'accepted', 'rejected')),
  created_at  timestamptz not null default now(),
  handled_by  uuid references public.profiles(id) on delete set null,
  handled_at  timestamptz,
  response    text check (response is null or char_length(response) <= 600)
);

create index if not exists ban_appeals_status_idx   on public.ban_appeals (status, created_at desc);
create index if not exists ban_appeals_sanction_idx on public.ban_appeals (sanction_id, created_at desc);

alter table public.sanction_evidence enable row level security;
alter table public.ban_appeals       enable row level security;
-- (no policies on purpose: only the functions below can touch them)
revoke all on public.sanction_evidence, public.ban_appeals from anon, authenticated;


-- --------------------------------------------------------------------------
-- 2) WHAT THE BANNED MEMBER SEES (only ever about themselves)
-- --------------------------------------------------------------------------
create or replace function public.my_ban_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_s   public.user_sanctions;
  v_ev  jsonb;
  v_ap  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('banned', false);
  end if;

  select * into v_s
  from public.user_sanctions
  where user_id = v_uid
    and kind in ('ban', 'suspension')
    and revoked_at is null
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  order by (kind = 'ban') desc, created_at desc
  limit 1;

  if v_s.id is null then
    return jsonb_build_object('banned', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('ref', e.ref, 'summary', e.summary, 'reviewed_at', e.reviewed_at) order by e.reviewed_at desc), '[]'::jsonb)
    into v_ev
  from (
    select * from public.sanction_evidence where sanction_id = v_s.id order by reviewed_at desc limit 10
  ) e;

  select jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'created_at', a.created_at, 'response', a.response)
    into v_ap
  from public.ban_appeals a
  where a.sanction_id = v_s.id and a.user_id = v_uid
  order by a.created_at desc
  limit 1;

  return jsonb_build_object(
    'banned', true,
    'username', (select username from public.profiles where id = v_uid),
    'sanction', jsonb_build_object(
      'id', v_s.id, 'kind', v_s.kind, 'reason', v_s.reason, 'mod_note', v_s.mod_note,
      'starts_at', v_s.starts_at, 'ends_at', v_s.ends_at, 'issued_at', v_s.created_at),
    'evidence', v_ev,
    'appeal', v_ap
  );
end;
$$;

-- "Report this as a mistake". Never raises: always answers {ok, error}.
create or replace function public.ban_submit_appeal(p_sanction uuid, p_kind text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_kind is null or p_kind not in ('appeal', 'mistake') then
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;

  if char_length(btrim(coalesce(p_message, ''))) < 10 or char_length(p_message) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_message');
  end if;

  -- it has to be YOUR sanction, and still in force
  if not exists (
    select 1 from public.user_sanctions s
    where s.id = p_sanction and s.user_id = v_uid and s.kind in ('ban', 'suspension')
      and s.revoked_at is null and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if exists (select 1 from public.ban_appeals where sanction_id = p_sanction and user_id = v_uid and status in ('open', 'reviewing')) then
    return jsonb_build_object('ok', false, 'error', 'already_open');
  end if;

  if (select count(*) from public.ban_appeals where user_id = v_uid and created_at > now() - interval '24 hours') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  insert into public.ban_appeals (sanction_id, user_id, kind, message)
  values (p_sanction, v_uid, p_kind, btrim(p_message))
  returning id into v_id;

  perform public.admin_log('appeal_submit', v_uid, null, true, null,
    jsonb_build_object('appeal', v_id, 'kind', p_kind, 'sanction', p_sanction), null, 'appeal', v_id::text);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;


-- --------------------------------------------------------------------------
-- 3) STAFF SIDE
-- --------------------------------------------------------------------------
-- add the member-visible moderator note and/or one piece of evidence to a sanction
create or replace function public.admin_set_sanction_details(p_sanction uuid, p_mod_note text default null, p_evidence text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_s public.user_sanctions;
  v_ref text;
  v_note text := nullif(btrim(coalesce(p_mod_note, '')), '');
  v_ev   text := nullif(btrim(coalesce(p_evidence, '')), '');
begin
  v_err := public.admin_gate('moderator', 'sanction_details');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into v_s from public.user_sanctions where id = p_sanction;
  if v_s.id is null then
    return public.admin_fail('sanction_details', null, null, 'not_found');
  end if;
  if public.staff_rank(v_s.user_id) >= public.staff_rank(auth.uid()) then
    return public.admin_fail('sanction_details', v_s.user_id, null, 'target_outranks_you');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return public.admin_fail('sanction_details', v_s.user_id, null, 'bad_input');
  end if;
  if v_ev is not null and char_length(v_ev) not between 3 and 500 then
    return public.admin_fail('sanction_details', v_s.user_id, null, 'bad_input');
  end if;
  if v_note is null and v_ev is null then
    return public.admin_fail('sanction_details', v_s.user_id, null, 'bad_input');
  end if;

  if v_note is not null then
    update public.user_sanctions set mod_note = v_note where id = p_sanction;
  end if;

  if v_ev is not null then
    insert into public.sanction_evidence (sanction_id, summary, added_by)
    values (p_sanction, v_ev, auth.uid())
    returning ref into v_ref;
  end if;

  perform public.admin_log('sanction_details', v_s.user_id, null, true,
    jsonb_build_object('mod_note', v_s.mod_note),
    jsonb_build_object('mod_note', coalesce(v_note, v_s.mod_note), 'evidence_ref', v_ref),
    null, 'sanction', p_sanction::text);

  return jsonb_build_object('ok', true, 'evidence_ref', v_ref);
end;
$$;

create or replace function public.admin_appeals_list(p_status text default 'open', p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
begin
  v_err := public.admin_gate('moderator', 'appeals_list');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  return jsonb_build_object('ok', true, 'appeals', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select a.id, a.kind, a.message, a.status, a.created_at, a.handled_at, a.response,
             a.user_id, p.username, p.display_name,
             s.id as sanction_id, s.kind as sanction_kind, s.reason as sanction_reason, s.mod_note, s.ends_at,
             (select username from public.profiles where id = a.handled_by) as handled_by_name,
             coalesce((select jsonb_agg(jsonb_build_object('ref', e.ref, 'summary', e.summary, 'reviewed_at', e.reviewed_at) order by e.reviewed_at desc)
                       from public.sanction_evidence e where e.sanction_id = s.id), '[]'::jsonb) as evidence
      from public.ban_appeals a
      join public.profiles p on p.id = a.user_id
      join public.user_sanctions s on s.id = a.sanction_id
      where (p_status is null or p_status = '' or a.status = p_status)
      order by a.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x), '[]'::jsonb),
    'open_count', (select count(*) from public.ban_appeals where status in ('open', 'reviewing')));
end;
$$;

create or replace function public.admin_appeal_resolve(p_id uuid, p_status text, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_a public.ban_appeals;
  v_resp text := nullif(btrim(coalesce(p_response, '')), '');
begin
  v_err := public.admin_gate('moderator', 'appeal_resolve');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  select * into v_a from public.ban_appeals where id = p_id;
  if v_a.id is null then
    return public.admin_fail('appeal_resolve', null, p_response, 'not_found');
  end if;
  if p_status is null or p_status not in ('reviewing', 'accepted', 'rejected') then
    return public.admin_fail('appeal_resolve', v_a.user_id, p_response, 'bad_status');
  end if;
  if p_status in ('accepted', 'rejected') and (v_resp is null or char_length(v_resp) < 3 or char_length(v_resp) > 600) then
    return public.admin_fail('appeal_resolve', v_a.user_id, p_response, 'reason_required');
  end if;
  if public.staff_rank(v_a.user_id) >= public.staff_rank(auth.uid()) then
    return public.admin_fail('appeal_resolve', v_a.user_id, p_response, 'target_outranks_you');
  end if;

  update public.ban_appeals
  set status = p_status, response = v_resp, handled_by = auth.uid(), handled_at = now()
  where id = p_id;

  perform public.admin_notify(v_a.user_id, 'info',
    case p_status when 'accepted' then 'Your report was accepted' when 'rejected' then 'Your report was reviewed' else 'We are reviewing your report' end,
    coalesce(v_resp, 'A moderator is looking at your case.'));

  perform public.admin_log('appeal_resolve', v_a.user_id, p_response, true,
    jsonb_build_object('status', v_a.status), jsonb_build_object('status', p_status), null, 'appeal', p_id::text);

  return jsonb_build_object('ok', true);
end;
$$;


-- --------------------------------------------------------------------------
-- 4) WHO CAN CALL WHAT
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('my_ban_status', 'ban_submit_appeal', 'admin_set_sanction_details', 'admin_appeals_list', 'admin_appeal_resolve')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
