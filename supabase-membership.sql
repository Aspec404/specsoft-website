-- ============================================================================
-- SPECSOFT® Superior membership + Youth Safety acknowledgment
-- Run AFTER supabase-store.sql. Safe to run again.
-- ============================================================================

-- ---------- who is Superior, and until when ---------------------------------
create table if not exists public.memberships (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    tier       text not null default 'superior' check (tier in ('superior')),
    started_at timestamptz not null default now(),
    expires_at timestamptz not null,
    updated_at timestamptz not null default now()
);
alter table public.memberships enable row level security;

-- ---------- price + payment link per currency (you fill the links in) -------
create table if not exists public.membership_plans (
    currency     text primary key check (currency in ('PHP', 'USD')),
    price_label  text not null,
    checkout_url text,                      -- your payment link for that currency
    active       boolean not null default true
);
alter table public.membership_plans enable row level security;

-- ---------- youth safety acknowledgment -------------------------------------
create table if not exists public.youth_safety_acks (
    user_id  uuid primary key references auth.users(id) on delete cascade,
    acked_at timestamptz not null default now()
);
alter table public.youth_safety_acks enable row level security;

do $$ begin
    drop policy if exists memberships_read_own on public.memberships;
    create policy memberships_read_own on public.memberships for select to authenticated
        using (user_id = auth.uid() or public.store_is_admin());
    -- no insert/update/delete policies: only the functions below can change it

    drop policy if exists membership_plans_read on public.membership_plans;
    create policy membership_plans_read on public.membership_plans for select to anon, authenticated
        using (active or public.store_is_admin());
    drop policy if exists membership_plans_admin on public.membership_plans;
    create policy membership_plans_admin on public.membership_plans for all to authenticated
        using (public.store_is_admin()) with check (public.store_is_admin());

    drop policy if exists youth_acks_read_own on public.youth_safety_acks;
    create policy youth_acks_read_own on public.youth_safety_acks for select to authenticated
        using (user_id = auth.uid());
end $$;

-- ---------- is this person Superior right now? ------------------------------
-- Use this in every other function / edge function that gives a Superior perk.
create or replace function public.is_superior(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.memberships where user_id = p_user and expires_at > now());
$$;

create or replace function public.my_membership()
returns json language sql stable security definer set search_path = public as $$
    select json_build_object(
        'active', coalesce((select expires_at > now() from public.memberships where user_id = auth.uid()), false),
        'expires_at', (select expires_at from public.memberships where user_id = auth.uid())
    );
$$;

-- ---------- staff: activate or extend Superior after a payment ---------------
-- Renewing early stacks: the new days are added after the current end date.
create or replace function public.store_admin_grant_superior(p_username text, p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare target uuid; new_end timestamptz;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    if p_days is null or p_days < 1 or p_days > 400 then raise exception 'bad_days'; end if;
    select id into target from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
    if target is null then raise exception 'user_not_found'; end if;
    insert into public.memberships (user_id, expires_at)
    values (target, now() + make_interval(days => p_days))
    on conflict (user_id) do update
        set expires_at = greatest(public.memberships.expires_at, now()) + make_interval(days => p_days),
            updated_at = now()
    returning expires_at into new_end;
    return json_build_object('expires_at', new_end);
end $$;

-- ---------- staff: end Superior early (refund, abuse, mistake) ---------------
create or replace function public.store_admin_revoke_superior(p_username text)
returns json language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
    if not public.store_is_admin() then raise exception 'not_admin'; end if;
    select id into target from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
    if target is null then raise exception 'user_not_found'; end if;
    delete from public.memberships where user_id = target;
    return json_build_object('revoked', true);
end $$;

-- ---------- user: acknowledge the Youth Safety Commitment --------------------
create or replace function public.youth_safety_ack()
returns json language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then raise exception 'not_signed_in'; end if;
    insert into public.youth_safety_acks (user_id) values (auth.uid()) on conflict do nothing;
    return json_build_object('acked', true);
end $$;

-- ---------- permissions ------------------------------------------------------
grant execute on function public.is_superior(uuid) to anon, authenticated;
grant execute on function public.my_membership() to authenticated;
grant execute on function public.store_admin_grant_superior(text, int) to authenticated;
grant execute on function public.store_admin_revoke_superior(text) to authenticated;
grant execute on function public.youth_safety_ack() to authenticated;

-- ---------- starter prices (add your payment links in the table editor) -----
insert into public.membership_plans (currency, price_label, checkout_url) values
    ('PHP', '₱149', null),
    ('USD', '$8',   null)
on conflict (currency) do nothing;
