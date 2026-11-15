-- SPECSOFT Spectra Bond: Spectra thanks you in her own words when you give her a gift
-- Run AFTER spectra-bond-shop.sql. Safe to run again.
-- When a gift is sent, the database remembers it for 15 minutes ("thanks"). The chat function picks it up,
-- tells Spectra what she just got, and that thank-you reply is free (it does not use a daily credit).
-- It cannot be faked from the browser: only a real gift send creates it, and it can be used once.

alter table public.spectra_bond add column if not exists thanks jsonb;

-- same send function as before, now it also saves the gift for the thank-you
create or replace function public.spectra_bond_gift_send(p_gift text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it record; b public.spectra_bond;
        have int; sent_n int; gain int; old_level int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  select i.id, i.name, i.emoji, i.bond_xp, i.bond_favorite into it
    from public.store_items i where i.id::text = p_gift and i.bond_xp is not null;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_gift'); end if;

  b := public._bond_touch(uid);               -- also locks this member's bond row, so two sends cannot race
  old_level := b.bond_level;

  select count(*)::int into have from public.store_purchases sp where sp.user_id = uid and sp.item_id::text = p_gift;
  select coalesce((select l.sent from public.spectra_bond_gift_sent l where l.user_id = uid and l.item_id = p_gift), 0) into sent_n;
  if have - sent_n <= 0 then return jsonb_build_object('ok', false, 'error', 'empty'); end if;

  insert into public.spectra_bond_gift_sent (user_id, item_id, sent) values (uid, p_gift, 1)
  on conflict (user_id, item_id) do update set sent = public.spectra_bond_gift_sent.sent + 1;

  gain := it.bond_xp * case when it.bond_favorite then 2 else 1 end;
  b.bond_xp := least(43560, b.bond_xp + gain);
  b.bond_level := public.bond_level_for(b.bond_xp);
  b.last_chat_at := now();
  b.last_decay_at := now();

  update public.spectra_bond set
    bond_xp = b.bond_xp, bond_level = b.bond_level, last_chat_at = b.last_chat_at,
    last_decay_at = b.last_decay_at, daily_day = b.daily_day,
    daily_gain = b.daily_gain, daily_loss = b.daily_loss,
    thanks = jsonb_build_object('name', it.name, 'emoji', it.emoji, 'favorite', it.bond_favorite, 'gain', gain,
                                'level', b.bond_level, 'leveled_up', b.bond_level > old_level, 'at', now())
  where user_id = uid;

  return public._bond_json(b) || jsonb_build_object(
    'ok', true, 'gift', p_gift, 'name', it.name, 'emoji', it.emoji, 'gain', gain,
    'favorite', it.bond_favorite, 'left', have - sent_n - 1, 'leveled_up', b.bond_level > old_level);
end $$;

-- chat function only: take the pending thank-you (returns null if there is none or it is older than 15 minutes)
create or replace function public.spectra_bond_take_thanks(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t jsonb;
begin
  select thanks into t from public.spectra_bond where user_id = p_user for update;
  if t is null then return null; end if;
  update public.spectra_bond set thanks = null where user_id = p_user;
  if (t->>'at')::timestamptz < now() - interval '15 minutes' then return null; end if;
  return t;
end $$;

revoke all on function public.spectra_bond_take_thanks(uuid) from public, anon, authenticated;
grant execute on function public.spectra_bond_take_thanks(uuid) to service_role;
