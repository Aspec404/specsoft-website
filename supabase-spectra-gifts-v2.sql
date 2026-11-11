-- SPECSOFT Spectra AI: gift CARDS (Spectra offers, the person taps Accept or Reject).
-- Run this ONCE in Supabase > SQL Editor. It builds on supabase-spectra-gifts.sql (keep spectra_grant_credits as you wired it).
-- Flow: beg -> spectra_offer_gift (no credits yet) -> Accept: spectra_accept_gift adds credits + starts the cooldown
--                                                     -> Reject: spectra_reject_gift cancels, cooldown NOT used.
-- An offer waits 2 hours, then expires.

alter table public.spectra_gifts add column if not exists pending_amount int not null default 0;
alter table public.spectra_gifts add column if not exists pending_at timestamptz;

-- 1) offer: reserves ONE pending gift (nothing is paid yet)
create or replace function public.spectra_offer_gift(p_user uuid, p_amount int default 30, p_cooldown interval default '4 hours', p_expire interval default '2 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; wait_s int;
begin
  insert into public.spectra_gifts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if g.last_gift_at + p_cooldown > now() then
    wait_s := ceil(extract(epoch from (g.last_gift_at + p_cooldown - now())))::int;
    return jsonb_build_object('ok', false, 'wait_seconds', wait_s);
  end if;
  if g.pending_amount > 0 and g.pending_at is not null and g.pending_at + p_expire > now() then
    return jsonb_build_object('ok', true, 'pending', true, 'amount', g.pending_amount);
  end if;
  update public.spectra_gifts set pending_amount = p_amount, pending_at = now() where user_id = p_user;
  return jsonb_build_object('ok', true, 'pending', false, 'amount', p_amount);
end $$;

-- 2) accept: pays out (rolls back completely if spectra_grant_credits fails) and starts the cooldown
create or replace function public.spectra_accept_gift(p_user uuid, p_expire interval default '2 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; amt int;
begin
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if not found or g.pending_amount <= 0 or g.pending_at is null then
    return jsonb_build_object('ok', false, 'error', 'none');
  end if;
  if g.pending_at + p_expire <= now() then
    update public.spectra_gifts set pending_amount = 0, pending_at = null where user_id = p_user;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  amt := g.pending_amount;
  perform public.spectra_grant_credits(p_user, amt);
  update public.spectra_gifts
     set last_gift_at = now(), total_gifted = total_gifted + amt, gift_count = gift_count + 1,
         pending_amount = 0, pending_at = null
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;

-- 3) reject: cancels the pending gift, no credits, no cooldown
create or replace function public.spectra_reject_gift(p_user uuid, p_expire interval default '2 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; amt int;
begin
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if not found or g.pending_amount <= 0 or g.pending_at is null or g.pending_at + p_expire <= now() then
    return jsonb_build_object('ok', false, 'error', 'none');
  end if;
  amt := g.pending_amount;
  update public.spectra_gifts set pending_amount = 0, pending_at = null where user_id = p_user;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;

-- 4) only the edge function (service role) may call these
revoke all on function public.spectra_offer_gift(uuid, int, interval, interval) from public, anon, authenticated;
revoke all on function public.spectra_accept_gift(uuid, interval) from public, anon, authenticated;
revoke all on function public.spectra_reject_gift(uuid, interval) from public, anon, authenticated;
grant execute on function public.spectra_offer_gift(uuid, int, interval, interval) to service_role;
grant execute on function public.spectra_accept_gift(uuid, interval) to service_role;
grant execute on function public.spectra_reject_gift(uuid, interval) to service_role;

-- optional cleanup: the old one-step function is no longer used
-- drop function if exists public.spectra_claim_gift(uuid, int, interval);
