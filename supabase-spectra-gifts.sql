-- SPECSOFT Spectra AI: APEX Credit gifts (Spectra gifts credits to users who beg, once per cooldown).
-- Run once in Supabase > SQL Editor.
-- IMPORTANT: step 2 (spectra_grant_credits) must be wired to YOUR APEX wallet. Until then it raises an error,
-- so nothing is ever gifted, no cooldown is consumed, and Spectra just says gifting is unavailable.

-- 1) cooldown + stats per user (nobody can touch this from the browser: RLS on, no policies)
create table if not exists public.spectra_gifts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  last_gift_at  timestamptz not null default 'epoch'::timestamptz,
  total_gifted  int not null default 0,
  gift_count    int not null default 0
);
alter table public.spectra_gifts enable row level security;

-- 2) wired to the APEX wallet (public.apex_wallets: user_id, balance, lifetime)
create or replace function public.spectra_grant_credits(p_user uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 500 then raise exception 'bad gift amount'; end if;
  insert into public.apex_wallets (user_id) values (p_user) on conflict do nothing;
  update public.apex_wallets
     set balance  = balance + p_amount,
         lifetime = lifetime + p_amount   -- delete this line if gifts should not count toward lifetime
   where user_id = p_user;
end $$;

-- 3) claim a gift: atomic, one per cooldown. If the grant fails, everything rolls back (cooldown NOT used).
create or replace function public.spectra_claim_gift(p_user uuid, p_amount int default 30, p_cooldown interval default '4 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; wait_s int;
begin
  insert into public.spectra_gifts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if g.last_gift_at + p_cooldown > now() then
    wait_s := ceil(extract(epoch from (g.last_gift_at + p_cooldown - now())))::int;
    return jsonb_build_object('ok', false, 'wait_seconds', wait_s);
  end if;
  perform public.spectra_grant_credits(p_user, p_amount);
  update public.spectra_gifts
     set last_gift_at = now(), total_gifted = total_gifted + p_amount, gift_count = gift_count + 1
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'amount', p_amount);
end $$;

-- 4) only the edge function (service role) may call these; browsers can never claim gifts or grant credits
revoke all on function public.spectra_grant_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.spectra_claim_gift(uuid, int, interval) from public, anon, authenticated;
grant execute on function public.spectra_grant_credits(uuid, int) to service_role;
grant execute on function public.spectra_claim_gift(uuid, int, interval) to service_role;
