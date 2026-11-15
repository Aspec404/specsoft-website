-- ============================================================================
-- SPECSOFT® Superior rewards (Phase 3): weekly + monthly APEX Credits, and the
-- custom Superior profile frame. Run AFTER supabase-membership.sql and
-- supabase-store.sql. Safe to run again.
-- ============================================================================

-- ---------- tunable numbers + which store frame is "the Superior frame" -----
create table if not exists public.membership_settings (
    id             int primary key default 1 check (id = 1),
    weekly_amount  int not null default 600  check (weekly_amount  between 0 and 1000000),
    monthly_amount int not null default 2000 check (monthly_amount between 0 and 1000000),
    frame_item     uuid references public.store_items(id) on delete set null   -- null = the built-in gold frame
);
insert into public.membership_settings (id) values (1) on conflict (id) do nothing;
alter table public.membership_settings enable row level security;

-- ---------- when each member last claimed -----------------------------------
create table if not exists public.superior_claims (
    user_id      uuid primary key references auth.users(id) on delete cascade,
    last_weekly  timestamptz,
    last_monthly timestamptz
);
alter table public.superior_claims enable row level security;   -- no policies: only the functions below touch it

do $$ begin
    drop policy if exists membership_settings_read on public.membership_settings;
    create policy membership_settings_read on public.membership_settings for select to anon, authenticated using (true);
    drop policy if exists membership_settings_admin on public.membership_settings;
    create policy membership_settings_admin on public.membership_settings for all to authenticated
        using (public.store_is_admin()) with check (public.store_is_admin());
end $$;

-- ---------- what can this member claim right now? ----------------------------
-- Windows are rolling (7 days / 30 days since the LAST claim), not calendar based,
-- so buying Superior at the end of a month cannot double dip.
create or replace function public.superior_rewards()
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.membership_settings; c public.superior_claims;
        w_next timestamptz; m_next timestamptz;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if not public.is_superior(uid) then return json_build_object('active', false); end if;
    select * into s from public.membership_settings where id = 1;
    select * into c from public.superior_claims where user_id = uid;
    w_next := case when c.last_weekly  is null then now() else c.last_weekly  + interval '7 days'  end;
    m_next := case when c.last_monthly is null then now() else c.last_monthly + interval '30 days' end;
    return json_build_object(
        'active', true,
        'weekly',  json_build_object('amount', s.weekly_amount,  'available', w_next <= now(), 'next_at', w_next),
        'monthly', json_build_object('amount', s.monthly_amount, 'available', m_next <= now(), 'next_at', m_next)
    );
end $$;

-- ---------- claim ('weekly' or 'monthly') -------------------------------------
create or replace function public.superior_claim(p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.membership_settings; c public.superior_claims;
        amt int; last_at timestamptz; gap interval; bal bigint;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_kind not in ('weekly', 'monthly') then raise exception 'bad_kind'; end if;
    if not public.is_superior(uid) then raise exception 'not_superior'; end if;

    select * into s from public.membership_settings where id = 1;
    insert into public.superior_claims (user_id) values (uid) on conflict do nothing;
    select * into c from public.superior_claims where user_id = uid for update;     -- one claim at a time

    if p_kind = 'weekly' then amt := s.weekly_amount;  last_at := c.last_weekly;  gap := interval '7 days';
    else                      amt := s.monthly_amount; last_at := c.last_monthly; gap := interval '30 days';
    end if;
    if last_at is not null and last_at + gap > now() then raise exception 'not_ready'; end if;

    update public.superior_claims
       set last_weekly  = case when p_kind = 'weekly'  then now() else last_weekly  end,
           last_monthly = case when p_kind = 'monthly' then now() else last_monthly end
     where user_id = uid;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    update public.apex_wallets
       set balance = balance + amt, lifetime = lifetime + amt, updated_at = now()
     where user_id = uid returning balance into bal;
    insert into public.apex_ledger (user_id, delta, reason)
    values (uid, amt, 'Superior ' || p_kind || ' bonus');

    return json_build_object('amount', amt, 'balance', bal, 'next_at', now() + gap);
end $$;

-- ---------- the custom Superior frame (any store frame item you pick) --------
-- Returns that item's frame data, or null for the built-in gold frame. Public on purpose:
-- everyone's browser needs it to draw a Superior member's avatar. It stays readable even
-- when the item itself is switched off in the store.
create or replace function public.superior_frame()
returns json language sql stable security definer set search_path = public as $$
    select to_json(i.frame_data)
      from public.membership_settings s
      join public.store_items i on i.id = s.frame_item
     where s.id = 1;
$$;

-- ---------- permissions -------------------------------------------------------
grant execute on function public.superior_rewards() to authenticated;
grant execute on function public.superior_claim(text) to authenticated;
grant execute on function public.superior_frame() to anon, authenticated;
