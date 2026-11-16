-- SPECSOFT Spectra Headpat
-- Run AFTER spectra-bond.sql. Safe to run again.
-- Members pat Spectra in the Headpat popout. The database counts the pats and gives a little bond XP:
--   +1 bond XP for every 10 pats, at most 5 bond XP a day (so 50 pats a day earn XP).
--   At most 300 pats are counted a day, and about 4 pats a second at most (so scripts cannot farm it).
--   Pats do NOT count as chatting, so they never stop the bond from fading. Only real chats and gifts do that.
-- Tweaks: 10 (pats per XP), 5 (max XP a day), 300 (max pats a day), 4 (pats per second) below.

create table if not exists public.spectra_headpat (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total bigint not null default 0,
  day date not null default current_date,
  day_pats int not null default 0,
  day_xp int not null default 0,
  last_at timestamptz
);
alter table public.spectra_headpat enable row level security;
drop policy if exists headpat_read on public.spectra_headpat;
create policy headpat_read on public.spectra_headpat for select to authenticated using (user_id = auth.uid());

-- my pat numbers (opens the Headpat popout)
create or replace function public.spectra_headpat_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); h public.spectra_headpat;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select * into h from public.spectra_headpat where user_id = v_uid;
  if not found then return jsonb_build_object('ok', true, 'total', 0, 'today', 0, 'xp_left', 5); end if;
  if h.day <> current_date then h.day_pats := 0; h.day_xp := 0; end if;
  return jsonb_build_object('ok', true, 'total', h.total, 'today', h.day_pats, 'xp_left', greatest(0, 5 - h.day_xp));
end $$;

-- send a batch of pats (the page sends them in small groups)
create or replace function public.spectra_headpat(p_count int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); h public.spectra_headpat; b public.spectra_bond;
        n int; v_xp int := 0; v_old int; v_step_old int; v_step_new int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  insert into public.spectra_headpat (user_id) values (v_uid) on conflict do nothing;
  select * into h from public.spectra_headpat where user_id = v_uid for update;     -- also stops two tabs racing
  if h.day <> current_date then h.day := current_date; h.day_pats := 0; h.day_xp := 0; end if;

  n := greatest(0, least(coalesce(p_count, 0), 20));
  if h.last_at is not null then                                                      -- speed limit: about 4 pats a second
    n := least(n, greatest(0, ceil(extract(epoch from (now() - h.last_at)) * 4)::int));
  end if;
  n := greatest(0, least(n, 300 - h.day_pats));                                      -- 300 counted pats a day

  v_step_old := h.day_pats / 10;
  h.day_pats := h.day_pats + n;
  h.total := h.total + n;
  v_step_new := h.day_pats / 10;
  v_xp := greatest(0, least(v_step_new - v_step_old, 5 - h.day_xp));
  h.day_xp := h.day_xp + v_xp;

  update public.spectra_headpat set total = h.total, day = h.day, day_pats = h.day_pats, day_xp = h.day_xp, last_at = now()
   where user_id = v_uid;

  if v_xp > 0 then
    b := public._bond_touch(v_uid);
    v_old := b.bond_level;
    b.bond_xp := least(43560, b.bond_xp + v_xp);
    b.bond_level := public.bond_level_for(b.bond_xp);
    update public.spectra_bond set bond_xp = b.bond_xp, bond_level = b.bond_level where user_id = v_uid;   -- last_chat_at stays as it is
    return public._bond_json(b) || jsonb_build_object('ok', true, 'counted', n, 'total', h.total, 'today', h.day_pats,
      'xp_gain', v_xp, 'delta', v_xp, 'leveled_up', b.bond_level > v_old, 'xp_left', greatest(0, 5 - h.day_xp));
  end if;
  return jsonb_build_object('ok', true, 'counted', n, 'total', h.total, 'today', h.day_pats, 'xp_gain', 0,
                            'xp_left', greatest(0, 5 - h.day_xp));
end $$;

revoke all on function public.spectra_headpat_status() from public, anon;
revoke all on function public.spectra_headpat(int) from public, anon;
grant execute on function public.spectra_headpat_status() to authenticated;
grant execute on function public.spectra_headpat(int) to authenticated;
