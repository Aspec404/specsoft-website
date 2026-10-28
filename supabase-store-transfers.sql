-- ============================================================================
-- SPECSOFT® Store: send APEX Credits to another member + receipts + history
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store.sql. Safe to re-run.
--
-- What it adds
--   * apex_transfer(...)        send credits (sender is charged, receiver is credited, one receipt)
--   * apex_lookup_user(...)     lets the sender confirm WHO they are paying before sending
--   * apex_receipt(...)         look up a receipt by its number (proof of delivery)
--   * apex_my_transactions(...) your full history with a running balance
--   * transfer rules in store_settings (on/off, fee %, daily cap, minimum account age)
-- ============================================================================

-- ---------- rules (editable in store-manager.html > Credits) ----------------
alter table public.store_settings add column if not exists transfers_enabled boolean not null default true;
alter table public.store_settings add column if not exists transfer_fee_percent int not null default 0 check (transfer_fee_percent between 0 and 50);
alter table public.store_settings add column if not exists transfer_daily_cap int not null default 1000 check (transfer_daily_cap >= 0);   -- 0 = no cap
alter table public.store_settings add column if not exists transfer_min_age_days int not null default 3 check (transfer_min_age_days >= 0);

-- ---------- receipts --------------------------------------------------------
create table if not exists public.apex_transfers (
    id uuid primary key default gen_random_uuid(),
    receipt_no text not null unique,
    from_user uuid not null references auth.users(id) on delete cascade,
    to_user uuid not null references auth.users(id) on delete cascade,
    amount int not null check (amount > 0),
    fee int not null default 0 check (fee >= 0),
    note text,
    created_at timestamptz not null default now()
);
create index if not exists apex_transfers_from_idx on public.apex_transfers (from_user, created_at desc);
create index if not exists apex_transfers_to_idx on public.apex_transfers (to_user, created_at desc);

alter table public.apex_transfers enable row level security;
drop policy if exists apex_transfers_own on public.apex_transfers;
create policy apex_transfers_own on public.apex_transfers for select to authenticated
    using (from_user = auth.uid() or to_user = auth.uid() or public.store_is_admin());

-- ledger rows can point at a receipt
alter table public.apex_ledger add column if not exists ref text;

-- ---------- wallet info now also reports transfer limits ---------------------
create or replace function public.apex_wallet()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.apex_wallets; s public.store_settings; sent bigint;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid;
    select * into s from public.store_settings where id = 1;
    select coalesce(sum(amount), 0) into sent from public.apex_transfers where from_user = uid and created_at > now() - interval '24 hours';
    return json_build_object(
        'balance', w.balance,
        'lifetime', w.lifetime,
        'streak', case when w.last_claim is not null and w.last_claim >= current_date - 1 then w.streak else 0 end,
        'can_claim', w.last_claim is distinct from current_date,
        'sent_24h', sent,
        'transfer', json_build_object(
            'enabled', s.transfers_enabled, 'fee_percent', s.transfer_fee_percent,
            'daily_cap', s.transfer_daily_cap, 'min_age_days', s.transfer_min_age_days)
    );
end $$;

-- ---------- who am I about to pay? -------------------------------------------
create or replace function public.apex_lookup_user(p_username text)
returns json language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
    if auth.uid() is null then raise exception 'not_signed_in'; end if;
    select id, username, display_name, avatar_url into p
      from public.profiles where lower(username) = lower(btrim(coalesce(p_username, ''))) limit 1;
    if not found then raise exception 'user_not_found'; end if;
    return json_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'is_self', p.id = auth.uid());
end $$;

-- ---------- send credits -----------------------------------------------------
-- The receiver gets exactly p_amount. The sender pays p_amount + fee (the fee is removed from the economy).
create or replace function public.apex_transfer(p_to text, p_amount int, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    s public.store_settings;
    target uuid; tname text; sname text;
    fee int; w public.apex_wallets; sent bigint; age numeric;
    rno text; made timestamptz; new_bal bigint;
    note text := nullif(left(btrim(coalesce(p_note, '')), 80), '');
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into s from public.store_settings where id = 1;
    if not s.transfers_enabled then raise exception 'transfers_off'; end if;
    if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception 'bad_amount'; end if;

    select id, username into target, tname from public.profiles
     where lower(username) = lower(btrim(coalesce(p_to, ''))) limit 1;
    if target is null then raise exception 'user_not_found'; end if;
    if target = uid then raise exception 'self_transfer'; end if;
    select username into sname from public.profiles where id = uid;

    select floor(extract(epoch from (now() - u.created_at)) / 86400.0) into age from auth.users u where u.id = uid;
    if coalesce(age, 0) < s.transfer_min_age_days then raise exception 'account_too_new'; end if;

    fee := ceil(p_amount * s.transfer_fee_percent / 100.0)::int;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    insert into public.apex_wallets (user_id) values (target) on conflict do nothing;
    perform 1 from public.apex_wallets where user_id in (uid, target) order by user_id for update;   -- same order for everyone: no deadlocks

    select * into w from public.apex_wallets where user_id = uid;
    select coalesce(sum(amount), 0) into sent from public.apex_transfers where from_user = uid and created_at > now() - interval '24 hours';
    if s.transfer_daily_cap > 0 and sent + p_amount > s.transfer_daily_cap then raise exception 'cap_reached'; end if;
    if w.balance < p_amount + fee then raise exception 'not_enough_credits'; end if;

    rno := 'APX-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));
    new_bal := w.balance - p_amount - fee;

    update public.apex_wallets set balance = new_bal, updated_at = now() where user_id = uid;
    update public.apex_wallets set balance = balance + p_amount, updated_at = now() where user_id = target;   -- gifts do not count as "earned"

    insert into public.apex_transfers (receipt_no, from_user, to_user, amount, fee, note)
    values (rno, uid, target, p_amount, fee, note) returning created_at into made;

    insert into public.apex_ledger (user_id, delta, reason, ref) values
        (uid,    -(p_amount + fee), 'Sent to @' || tname, rno),
        (target,  p_amount,         'Received from @' || sname, rno);

    -- tell the receiver (only if the moderation notices table exists)
    if to_regclass('public.user_notices') is not null then
        begin
            execute 'insert into public.user_notices (user_id, kind, title, body) values ($1, ''info'', $2, $3)'
               using target, 'You received ' || p_amount || ' APEX Credits',
                     '@' || sname || ' sent you credits. Receipt ' || rno;
        exception when others then null;
        end;
    end if;

    return json_build_object('receipt_no', rno, 'from', sname, 'to', tname, 'amount', p_amount, 'fee', fee,
                             'note', note, 'at', made, 'balance', new_bal);
end $$;

-- ---------- proof: look up a receipt by its number ----------------------------
create or replace function public.apex_receipt(p_no text)
returns json language plpgsql stable security definer set search_path = public as $$
declare t public.apex_transfers; a text; b text;
begin
    if auth.uid() is null then raise exception 'not_signed_in'; end if;
    select * into t from public.apex_transfers where receipt_no = upper(btrim(coalesce(p_no, '')));
    if not found then raise exception 'receipt_not_found'; end if;
    select username into a from public.profiles where id = t.from_user;
    select username into b from public.profiles where id = t.to_user;
    return json_build_object('receipt_no', t.receipt_no, 'from', a, 'to', b, 'amount', t.amount, 'fee', t.fee,
                             'note', t.note, 'at', t.created_at,
                             'viewer', case when auth.uid() = t.from_user then 'sender' when auth.uid() = t.to_user then 'recipient' else 'other' end);
end $$;

-- ---------- my transactions (with the balance after each one) -----------------
create or replace function public.apex_my_transactions(p_limit int default 30, p_before bigint default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal bigint;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select balance into bal from public.apex_wallets where user_id = uid;
    bal := coalesce(bal, 0);
    return coalesce((
        select json_agg(x order by x.id desc) from (
            select r.id, r.delta, r.reason, r.created_at, r.ref, greatest(r.balance_after, 0) as balance_after
              from (
                select l.id, l.delta, l.reason, l.created_at, l.ref,
                       bal - coalesce(sum(l.delta) over (order by l.id desc rows between unbounded preceding and 1 preceding), 0) as balance_after
                  from public.apex_ledger l where l.user_id = uid
              ) r
             where p_before is null or r.id < p_before
             order by r.id desc
             limit least(greatest(coalesce(p_limit, 30), 1), 100)
        ) x
    ), '[]'::json);
end $$;

grant execute on function public.apex_wallet() to authenticated;
grant execute on function public.apex_lookup_user(text) to authenticated;
grant execute on function public.apex_transfer(text, int, text) to authenticated;
grant execute on function public.apex_receipt(text) to authenticated;
grant execute on function public.apex_my_transactions(int, bigint) to authenticated;
