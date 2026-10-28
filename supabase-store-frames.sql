-- ============================================================================
-- SPECSOFT® Store: profile frames (CSS only) + bundles
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store.sql and
-- supabase-store-emotes.sql. Safe to re-run.
--
--   FRAMES   an item with category 'frame' and frame_data like
--            {"style":"spin","c1":"#7F77DD","c2":"#D4537E","speed":3}
--            Buy it, equip it, and it shows on your avatar in chats and on your profile.
--   BUNDLES  an item with category 'bundle' that contains other items (store_bundle_items).
--            One purchase gives the buyer every item inside that they do not own yet.
-- ============================================================================

-- ---------- categories ------------------------------------------------------
alter table public.store_items drop constraint if exists store_items_category_check;
alter table public.store_items add constraint store_items_category_check
    check (category in ('badge','theme','boost','cosmetic','misc','emote','frame','bundle'));

alter table public.store_items add column if not exists frame_data jsonb;

-- a frame can only ever be one of these styles with plain hex colors (so it can never inject CSS)
create or replace function public.store_frame_ok(f jsonb)
returns boolean language sql immutable as $$
    select f is not null
       and jsonb_typeof(f) = 'object'
       and (f->>'style') in ('spin','rainbow','pulse','orbit','neon','fire','dots','aurora','twin')
       and (f->>'c1') ~ '^#[0-9a-fA-F]{6}$'
       and (f->>'c2') ~ '^#[0-9a-fA-F]{6}$'
       and case
             when (f->>'speed') is null then true
             when (f->>'speed') ~ '^[0-9]+(\.[0-9]+)?$' then (f->>'speed')::numeric between 0.5 and 20
             else false
           end;
$$;

alter table public.store_items drop constraint if exists store_items_frame_rules;
alter table public.store_items add constraint store_items_frame_rules
    check (category <> 'frame' or (public.store_frame_ok(frame_data) and per_user_limit = 1));

alter table public.store_items drop constraint if exists store_items_bundle_rules;
alter table public.store_items add constraint store_items_bundle_rules
    check (category <> 'bundle' or per_user_limit = 1);

-- ---------- bundles ---------------------------------------------------------
create table if not exists public.store_bundle_items (
    bundle_id uuid not null references public.store_items(id) on delete cascade,
    item_id   uuid not null references public.store_items(id) on delete cascade,
    primary key (bundle_id, item_id),
    check (bundle_id <> item_id)
);
alter table public.store_bundle_items enable row level security;

drop policy if exists store_bundle_items_read on public.store_bundle_items;
create policy store_bundle_items_read on public.store_bundle_items for select to anon, authenticated using (true);
drop policy if exists store_bundle_items_admin on public.store_bundle_items;
create policy store_bundle_items_admin on public.store_bundle_items for all to authenticated
    using (public.store_is_admin()) with check (public.store_is_admin());

-- a bundle holds normal items only (no bundles inside bundles)
create or replace function public.store_bundle_guard()
returns trigger language plpgsql as $$
begin
    if not exists (select 1 from public.store_items where id = new.bundle_id and category = 'bundle') then
        raise exception 'bundle_rules: the parent must be a bundle';
    end if;
    if exists (select 1 from public.store_items where id = new.item_id and category = 'bundle') then
        raise exception 'bundle_rules: a bundle cannot contain another bundle';
    end if;
    return new;
end $$;
drop trigger if exists store_bundle_guard on public.store_bundle_items;
create trigger store_bundle_guard before insert or update on public.store_bundle_items
    for each row execute function public.store_bundle_guard();

-- which bundle gave you an item (null = bought on its own)
alter table public.store_purchases add column if not exists bundle_id uuid references public.store_items(id) on delete set null;

-- ---------- buying (now bundle aware) ----------------------------------------
create or replace function public.store_buy(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    it public.store_items; c public.store_items; w public.apex_wallets;
    d int; price int; owned int;
    missing uuid[] := '{}';
    granted text[] := '{}';
    n_all int := 0;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    select * into it from public.store_items where id = p_item for update;
    if not found or not it.active then raise exception 'item_unavailable'; end if;
    if it.stock is not null and it.stock <= 0 then raise exception 'sold_out'; end if;
    if it.per_user_limit is not null then
        select count(*) into owned from public.store_purchases where user_id = uid and item_id = it.id;
        if owned >= it.per_user_limit then raise exception 'limit_reached'; end if;
    end if;

    -- bundles: work out which of the contents this person does not own yet
    if it.category = 'bundle' then
        for c in
            select i.* from public.store_bundle_items b join public.store_items i on i.id = b.item_id
             where b.bundle_id = it.id order by i.sort, i.created_at
        loop
            n_all := n_all + 1;
            select count(*) into owned from public.store_purchases where user_id = uid and item_id = c.id;
            if c.per_user_limit is null or owned < c.per_user_limit then missing := missing || c.id; end if;
        end loop;
        if n_all = 0 then raise exception 'item_unavailable'; end if;
        if cardinality(missing) = 0 then raise exception 'already_own_all'; end if;
        for c in select * from public.store_items where id = any (missing) order by id for update loop
            if c.stock is not null and c.stock <= 0 then raise exception 'sold_out'; end if;
        end loop;
    end if;

    select f.discount into d from public.store_featured() f where f.item_id = it.id limit 1;
    price := case when d is null then it.price else greatest(0, round(it.price * (100 - d) / 100.0))::int end;

    insert into public.apex_wallets (user_id) values (uid) on conflict do nothing;
    select * into w from public.apex_wallets where user_id = uid for update;
    if w.balance < price then raise exception 'not_enough_credits'; end if;

    update public.apex_wallets set balance = balance - price, updated_at = now() where user_id = uid;
    if it.stock is not null then update public.store_items set stock = stock - 1 where id = it.id; end if;
    insert into public.store_purchases (user_id, item_id, item_name, price_paid) values (uid, it.id, it.name, price);

    if it.category = 'bundle' then
        for c in select * from public.store_items where id = any (missing) order by sort, created_at loop
            insert into public.store_purchases (user_id, item_id, item_name, price_paid, bundle_id) values (uid, c.id, c.name, 0, it.id);
            if c.stock is not null then update public.store_items set stock = stock - 1 where id = c.id; end if;
            granted := granted || c.name;
        end loop;
    end if;

    insert into public.apex_ledger (user_id, delta, reason)
    values (uid, -price, 'Bought ' || it.name || case when it.category = 'bundle' then ' (' || cardinality(missing) || ' items)' else '' end);

    return json_build_object('balance', w.balance - price, 'price', price, 'item', it.name, 'granted', to_json(granted));
end $$;

-- ---------- equipping frames ---------------------------------------------------
create table if not exists public.user_equipped (
    user_id uuid primary key references auth.users(id) on delete cascade,
    frame_item uuid references public.store_items(id) on delete set null,
    updated_at timestamptz not null default now()
);
alter table public.user_equipped enable row level security;
drop policy if exists user_equipped_own on public.user_equipped;
create policy user_equipped_own on public.user_equipped for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policies: only store_equip below can change it, and it checks you own the frame

create or replace function public.store_equip(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it public.store_items;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_item is null then
        delete from public.user_equipped where user_id = uid;
        return json_build_object('item', null, 'frame', null);
    end if;
    select * into it from public.store_items where id = p_item;
    if not found or it.category <> 'frame' then raise exception 'item_unavailable'; end if;
    if not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then raise exception 'not_owned'; end if;
    insert into public.user_equipped (user_id, frame_item) values (uid, it.id)
    on conflict (user_id) do update set frame_item = excluded.frame_item, updated_at = now();
    return json_build_object('item', it.id, 'frame', it.frame_data);
end $$;

-- what avatars use to show other people's frames (public info: it is only a cosmetic style)
create or replace function public.frames_for(p_ids uuid[])
returns table (user_id uuid, frame_data jsonb)
language sql stable security definer set search_path = public as $$
    select e.user_id, i.frame_data
      from public.user_equipped e
      join public.store_items i on i.id = e.frame_item
     where e.user_id = any (p_ids[1:200]) and i.category = 'frame' and i.frame_data is not null;
$$;

grant execute on function public.store_buy(uuid) to authenticated;
grant execute on function public.store_equip(uuid) to authenticated;
grant execute on function public.frames_for(uuid[]) to anon, authenticated;

-- ---------- starter content (only when there are no frames yet) ----------------
do $$
declare
    b uuid; f1 uuid; f2 uuid;
begin
    if exists (select 1 from public.store_items where category = 'frame') then return; end if;

    insert into public.store_items (name, description, category, rarity, price, emoji, frame_data, per_user_limit, in_rotation, sort) values
      ('Violet spin',   'A violet and pink ring that never stops moving.',   'frame', 'rare',      150, '🖼️', '{"style":"spin","c1":"#7F77DD","c2":"#D4537E","speed":3}',      1, true,  110),
      ('Mint pulse',    'A calm mint glow that breathes.',                   'frame', 'common',     80, '🖼️', '{"style":"pulse","c1":"#1D9E75","c2":"#5DCAA5","speed":2.4}',   1, false, 120),
      ('Dashed orbit',  'A coral dashed ring in slow orbit.',                'frame', 'common',     90, '🖼️', '{"style":"orbit","c1":"#D85A30","c2":"#F0997B","speed":4}',    1, false, 130),
      ('Neon sky',      'Two buzzing neon rings with a flicker.',            'frame', 'rare',      220, '🖼️', '{"style":"neon","c1":"#38bdf8","c2":"#a78bfa","speed":3}',     1, true,  140),
      ('Rainbow ring',  'Every color, all the time.',                        'frame', 'epic',      400, '🖼️', '{"style":"rainbow","c1":"#ff4d4d","c2":"#4dc3ff","speed":4}',  1, true,  150),
      ('Inferno',       'Flames licking around your avatar.',                'frame', 'epic',      450, '🔥', '{"style":"fire","c1":"#ff4d00","c2":"#ffd54f","speed":3}',     1, true,  160),
      ('Aurora',        'Soft northern lights with a glow.',                 'frame', 'epic',      380, '🖼️', '{"style":"aurora","c1":"#22d3ee","c2":"#a855f7","speed":4}',   1, false, 170),
      ('Pumpkin glow',  'Halloween orange and purple, pulsing.',             'frame', 'rare',      160, '🎃', '{"style":"pulse","c1":"#ff7a00","c2":"#7c3aed","speed":2.2}',  1, false, 180);

    select id into f1 from public.store_items where category = 'frame' and name = 'Pumpkin glow';
    select id into f2 from public.store_items where name = 'Night Owl badge' limit 1;

    if f1 is not null and f2 is not null then
        insert into public.store_items (name, description, category, rarity, price, emoji, per_user_limit, in_rotation, sort)
        values ('Halloween pack', 'A pumpkin frame and a Night Owl badge together, for less.', 'bundle', 'epic', 170, '🎃', 1, false, 190)
        returning id into b;
        insert into public.store_bundle_items (bundle_id, item_id) values (b, f1), (b, f2);
    end if;
end $$;
