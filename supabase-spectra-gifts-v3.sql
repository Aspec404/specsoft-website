-- SPECSOFT Spectra AI: gift cards v3. Run ONCE in Supabase > SQL Editor (after v2).
-- Change: the offer now stores Spectra's note in the database, so if someone begs again while a card is still waiting
-- (new chat, other device, reloaded page) the SAME card is shown again instead of leaving them with no Accept button.

alter table public.spectra_gifts add column if not exists pending_note text;

-- the old 4-argument version must go, otherwise both versions exist side by side
drop function if exists public.spectra_offer_gift(uuid, int, interval, interval);

create or replace function public.spectra_offer_gift(p_user uuid, p_amount int default 30, p_cooldown interval default '4 hours', p_note text default '', p_expire interval default '2 hours')
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
    return jsonb_build_object('ok', true, 'pending', true, 'amount', g.pending_amount, 'note', coalesce(g.pending_note, ''));
  end if;
  update public.spectra_gifts
     set pending_amount = p_amount, pending_at = now(), pending_note = left(coalesce(p_note, ''), 80)
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'pending', false, 'amount', p_amount, 'note', left(coalesce(p_note, ''), 80));
end $$;

create or replace function public.spectra_accept_gift(p_user uuid, p_expire interval default '2 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; amt int;
begin
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if not found or g.pending_amount <= 0 or g.pending_at is null then
    return jsonb_build_object('ok', false, 'error', 'none');
  end if;
  if g.pending_at + p_expire <= now() then
    update public.spectra_gifts set pending_amount = 0, pending_at = null, pending_note = null where user_id = p_user;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  amt := g.pending_amount;
  perform public.spectra_grant_credits(p_user, amt);
  update public.spectra_gifts
     set last_gift_at = now(), total_gifted = total_gifted + amt, gift_count = gift_count + 1,
         pending_amount = 0, pending_at = null, pending_note = null
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;

create or replace function public.spectra_reject_gift(p_user uuid, p_expire interval default '2 hours')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.spectra_gifts; amt int;
begin
  select * into g from public.spectra_gifts where user_id = p_user for update;
  if not found or g.pending_amount <= 0 or g.pending_at is null or g.pending_at + p_expire <= now() then
    return jsonb_build_object('ok', false, 'error', 'none');
  end if;
  amt := g.pending_amount;
  update public.spectra_gifts set pending_amount = 0, pending_at = null, pending_note = null where user_id = p_user;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;

revoke all on function public.spectra_offer_gift(uuid, int, interval, text, interval) from public, anon, authenticated;
revoke all on function public.spectra_accept_gift(uuid, interval) from public, anon, authenticated;
revoke all on function public.spectra_reject_gift(uuid, interval) from public, anon, authenticated;
grant execute on function public.spectra_offer_gift(uuid, int, interval, text, interval) to service_role;
grant execute on function public.spectra_accept_gift(uuid, interval) to service_role;
grant execute on function public.spectra_reject_gift(uuid, interval) to service_role;
