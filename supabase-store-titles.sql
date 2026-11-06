-- ============================================================================
-- SPECSOFT® Store: Titles (replaces Badges)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-frames.sql. Safe to re-run.
--
--   TITLES  an item with category 'title' and title_data like
--           {"v":1,"text":"Night Owl","font":"serif","fill":"gradient","colors":["#a78bfa","#38bdf8"],"effect":"float"}
--           Buy it, equip it, and it shows next to your name in chats and on your profile.
--   Every existing 'badge' item is converted into a simple title (same name, same price, same owners).
-- ============================================================================

-- ---------- category + column -------------------------------------------------
alter table public.store_items drop constraint if exists store_items_category_check;
alter table public.store_items add constraint store_items_category_check
    check (category in ('badge','theme','boost','cosmetic','misc','emote','frame','bundle','title'));

alter table public.store_items add column if not exists title_data jsonb;

-- ---------- validator: structure + whitelists only (the site clamps the numbers) ----------
create or replace function public.store_title_ok(f jsonb)
returns boolean language plpgsql immutable as $$
declare c jsonb; s text;
begin
    if f is null or jsonb_typeof(f) <> 'object' then return false; end if;
    if pg_column_size(f) > 3000 then return false; end if;
    if (f->>'v') is distinct from '1' then return false; end if;

    s := coalesce(f->>'text', '');
    if char_length(btrim(s)) not between 1 and 24 then return false; end if;
    if s ~ '[<>]' or s ~ '[[:cntrl:]]' then return false; end if;

    if (f->>'font') is not null and (f->>'font') not in ('sans','rounded','serif','classic','display','mono','script','comic','engrave') then return false; end if;
    if (f->>'effect') is not null and (f->>'effect') not in ('none','glow','neon','pulse','flicker','shimmer','wave','glitch','rainbow','float','sparkle') then return false; end if;
    if (f->>'fill') is not null and (f->>'fill') not in ('solid','gradient') then return false; end if;
    if (f->>'deco') is not null and (f->>'deco') not in ('none','pill','underline','outline','brackets') then return false; end if;
    if (f->>'left') is not null and (f->>'left') not in ('','✦','★','❖','☾','⚡','♛','❄','❤','☠','✿','⚔','♦','✧','☀','➤') then return false; end if;
    if (f->>'right') is not null and (f->>'right') not in ('','✦','★','❖','☾','⚡','♛','❄','❤','☠','✿','⚔','♦','✧','☀','➤') then return false; end if;
    if (f->>'outline') is not null and jsonb_typeof(f->'outline') = 'string' and (f->>'outline') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;

    if coalesce(jsonb_typeof(f->'colors'), '') <> 'array' then return false; end if;
    if jsonb_array_length(f->'colors') not between 1 and 5 then return false; end if;
    for c in select * from jsonb_array_elements(f->'colors') loop
        if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    end loop;
    return true;
end $$;

-- ---------- convert old badges into titles (before the title rule is added) ----------
update public.store_items i
   set category = 'title',
       per_user_limit = 1,
       title_data = jsonb_build_object(
           'v', 1,
           'text', left(coalesce(nullif(btrim(regexp_replace(i.name, '\s*badge\s*$', '', 'i')), ''), 'Title'), 24),
           'font', 'sans', 'weight', 700, 'fill', 'solid',
           'colors', jsonb_build_array(case i.rarity
               when 'uncommon'  then '#f1f3f5'
               when 'rare'      then '#3b9cff'
               when 'epic'      then '#a66bff'
               when 'legendary' then '#facc15'
               when 'legacy'    then '#ff7a1a'
               when 'mythic'    then '#ef2b3a'
               else '#9ca3af' end),
           'effect', case when i.rarity in ('epic','legendary','legacy','mythic') then 'glow' else 'none' end,
           'strength', 45, 'speed', 3)
 where i.category = 'badge';

alter table public.store_items drop constraint if exists store_items_title_rules;
alter table public.store_items add constraint store_items_title_rules
    check (category <> 'title' or (public.store_title_ok(title_data) and per_user_limit = 1));

-- ---------- equipping ---------------------------------------------------------------
alter table public.user_equipped add column if not exists title_item uuid references public.store_items(id) on delete set null;

-- unequipping a frame now only clears the frame (it used to delete the whole row, which would drop the title too)
create or replace function public.store_equip(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it public.store_items;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_item is null then
        update public.user_equipped set frame_item = null, updated_at = now() where user_id = uid;
        return json_build_object('item', null, 'frame', null);
    end if;
    select * into it from public.store_items where id = p_item;
    if not found or it.category <> 'frame' then raise exception 'item_unavailable'; end if;
    if not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then raise exception 'not_owned'; end if;
    insert into public.user_equipped (user_id, frame_item) values (uid, it.id)
    on conflict (user_id) do update set frame_item = excluded.frame_item, updated_at = now();
    return json_build_object('item', it.id, 'frame', it.frame_data);
end $$;

create or replace function public.store_equip_title(p_item uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it public.store_items;
begin
    if uid is null then raise exception 'not_signed_in'; end if;
    if p_item is null then
        update public.user_equipped set title_item = null, updated_at = now() where user_id = uid;
        return json_build_object('item', null, 'title', null);
    end if;
    select * into it from public.store_items where id = p_item;
    if not found or it.category <> 'title' then raise exception 'item_unavailable'; end if;
    if not exists (select 1 from public.store_purchases where user_id = uid and item_id = it.id) then raise exception 'not_owned'; end if;
    insert into public.user_equipped (user_id, title_item) values (uid, it.id)
    on conflict (user_id) do update set title_item = excluded.title_item, updated_at = now();
    return json_build_object('item', it.id, 'title', it.title_data);
end $$;

-- what chats and profiles use to show other people's titles (public info: only a cosmetic style)
create or replace function public.titles_for(p_ids uuid[])
returns table (user_id uuid, title_data jsonb)
language sql stable security definer set search_path = public as $$
    select e.user_id, i.title_data
      from public.user_equipped e
      join public.store_items i on i.id = e.title_item
     where e.user_id = any (p_ids[1:200]) and i.category = 'title' and i.title_data is not null;
$$;

grant execute on function public.store_equip(uuid) to authenticated;
grant execute on function public.store_equip_title(uuid) to authenticated;
grant execute on function public.titles_for(uuid[]) to anon, authenticated;

-- ---------- starter titles (only when there are no titles yet) ----------------------------
do $$
declare top_rarity text := 'legendary';
begin
    if exists (select 1 from public.store_items where category = 'title') then return; end if;
    -- use Mythic for the top starter only when supabase-store-rarity.sql has been run
    if exists (select 1 from pg_constraint where conrelid = 'public.store_items'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) ilike '%mythic%') then top_rarity := 'mythic'; end if;
    insert into public.store_items (name, description, category, rarity, price, emoji, title_data, per_user_limit, in_rotation, sort) values
      ('Aurora',     'A drifting northern-lights gradient with a soft glow.', 'title', 'epic',      380, '✨', '{"v":1,"text":"Aurora","font":"rounded","weight":700,"fill":"gradient","colors":["#22d3ee","#a855f7","#f472b6"],"angle":90,"flow":4,"effect":"glow","strength":40,"speed":3}', 1, true,  210),
      ('Neon Sign',  'Buzzing neon letters with a flicker.',                  'title', 'rare',      220, '💡', '{"v":1,"text":"NEON","font":"mono","caps":true,"spacing":3,"fill":"solid","colors":["#38bdf8","#a78bfa"],"effect":"neon","strength":60,"speed":3}', 1, true,  220),
      ('Royalty',    'Golden script with a crown and a passing shine.',       'title', 'legendary', 600, '👑', '{"v":1,"text":"Royalty","font":"classic","italic":true,"fill":"gradient","colors":["#fde68a","#f59e0b","#fde68a"],"angle":100,"flow":5,"effect":"shimmer","speed":3,"left":"♛","right":"♛"}', 1, true,  230),
      ('Wave Rider', 'Every letter bobs on its own.',                         'title', 'rare',      180, '🌊', '{"v":1,"text":"Wave Rider","font":"comic","fill":"gradient","colors":["#34d399","#22d3ee","#a78bfa"],"angle":90,"effect":"wave","speed":3}', 1, false, 240),
      ('Glitch',     'Signal lost. Letters tear and recover.',                'title', 'epic',      350, '📺', '{"v":1,"text":"GLITCH","font":"mono","caps":true,"weight":800,"spacing":2,"fill":"solid","colors":["#e5e7eb"],"effect":"glitch","speed":3}', 1, false, 250),
      ('Mythic',     'Pulsing red-orange fire in brackets.',                  'title', top_rarity,  900, '🔥', '{"v":1,"text":"Mythic","font":"engrave","caps":true,"spacing":3,"fill":"gradient","colors":["#ef2b3a","#ff7a1a","#ef2b3a"],"angle":90,"flow":3,"effect":"pulse","strength":70,"speed":2.4,"deco":"brackets"}', 1, true,  260);
end $$;
