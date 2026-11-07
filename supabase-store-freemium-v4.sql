-- ============================================================================
-- SPECSOFT® Store: FREE REWARDS v4  (run ONCE in Supabase > SQL Editor, AFTER supabase-store-freemium-v3.sql)
-- Safe to re-run.
--
--   SPECIFIC ITEMS: a new pool reward type 'item'. In the manager you pick the exact titles / frames / emotes
--   you made (one or up to 12). When that reward lands on a card, the member gets one of THOSE items
--   (a random one from the list, never one they already own). The card shows the real item.
--   Only active items with unlimited stock can be given. "Random title / frame / emote" keep working too.
-- ============================================================================

do $$
declare c record;
begin
    for c in select conname from pg_constraint
              where conrelid = 'public.freemium_pool'::regclass and contype = 'c'
                and conname <> 'freemium_pool_params' and pg_get_constraintdef(oid) ilike '%booster%'
    loop
        execute format('alter table public.freemium_pool drop constraint %I', c.conname);
    end loop;
end $$;
alter table public.freemium_pool add constraint freemium_pool_kind_check
    check (kind in ('credits', 'xp', 'booster', 'title', 'frame', 'emote', 'item'));

create or replace function public.freemium_params_ok(k text, p jsonb)
returns boolean language plpgsql immutable as $$
begin
    if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
    if k in ('credits', 'xp') then
        return (p->>'min') ~ '^[0-9]{1,7}$' and (p->>'max') ~ '^[0-9]{1,7}$'
           and (p->>'min')::int >= 1 and (p->>'max')::int >= (p->>'min')::int and (p->>'max')::int <= 1000000;
    elsif k = 'booster' then
        return (p->>'boost') in ('credits', 'xp') and (p->>'tier') in ('2', '3', '5')
           and (p->>'minutes') ~ '^[0-9]{1,5}$' and (p->>'minutes')::int between 1 and 43200;
    elsif k in ('title', 'frame', 'emote') then
        return (p->>'max_rarity') is null or (p->>'max_rarity') in ('common','uncommon','rare','epic','legendary','legacy','mythic');
    elsif k = 'item' then
        if jsonb_typeof(p->'item_ids') is distinct from 'array' then return false; end if;
        if jsonb_array_length(p->'item_ids') not between 1 and 12 then return false; end if;
        return not exists (
            select 1 from jsonb_array_elements(p->'item_ids') e
             where jsonb_typeof(e) <> 'string'
                or (e #>> '{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
    end if;
    return false;
end $$;

create or replace function public.freemium_roll_card(p_uid uuid, p_row public.freemium_pool, p_skip uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare it public.store_items; lo int; hi int;
begin
    if p_row.kind in ('credits', 'xp') then
        lo := (p_row.params->>'min')::int; hi := (p_row.params->>'max')::int;
        return jsonb_build_object('kind', p_row.kind, 'amount', lo + floor(random() * (hi - lo + 1))::int);
    elsif p_row.kind = 'booster' then
        return jsonb_build_object('kind', 'booster', 'boost', p_row.params->>'boost',
                                  'tier', (p_row.params->>'tier')::int, 'minutes', (p_row.params->>'minutes')::int);
    elsif p_row.kind = 'item' then
        -- one of the exact items you picked (the card kind becomes the item's own type: title / frame / emote)
        select i.* into it from public.store_items i
         where i.id in (select (e #>> '{}')::uuid from jsonb_array_elements(p_row.params->'item_ids') e)
           and i.active and i.stock is null and i.category in ('title', 'frame', 'emote')
           and ((i.category = 'title' and i.title_data is not null)
                or (i.category = 'frame' and i.frame_data is not null)
                or (i.category = 'emote' and i.emote_name is not null and i.image_url is not null))
           and not (i.id = any (coalesce(p_skip, '{}')))
           and not exists (select 1 from public.store_purchases pu where pu.user_id = p_uid and pu.item_id = i.id)
         order by random() limit 1;
        if not found then return null; end if;
        return jsonb_build_object('kind', it.category, 'item_id', it.id, 'name', it.name, 'rarity', it.rarity,
                                  'data', case when it.category = 'title' then it.title_data when it.category = 'frame' then it.frame_data else null end,
                                  'emote_name', it.emote_name,
                                  'image_url', case when it.category = 'emote' then it.image_url else null end);
    else
        select i.* into it from public.store_items i
         where i.active and i.category = p_row.kind and i.stock is null
           and public.freemium_rank(i.rarity) <= public.freemium_rank(coalesce(p_row.params->>'max_rarity', 'epic'))
           and ((p_row.kind = 'title' and i.title_data is not null)
                or (p_row.kind = 'frame' and i.frame_data is not null)
                or (p_row.kind = 'emote' and i.emote_name is not null and i.image_url is not null))
           and not (i.id = any (coalesce(p_skip, '{}')))
           and not exists (select 1 from public.store_purchases pu where pu.user_id = p_uid and pu.item_id = i.id)
         order by random() limit 1;
        if not found then return null; end if;
        return jsonb_build_object('kind', p_row.kind, 'item_id', it.id, 'name', it.name, 'rarity', it.rarity,
                                  'data', case when p_row.kind = 'title' then it.title_data when p_row.kind = 'frame' then it.frame_data else null end,
                                  'emote_name', it.emote_name,
                                  'image_url', case when p_row.kind = 'emote' then it.image_url else null end);
    end if;
end $$;
revoke execute on function public.freemium_roll_card(uuid, public.freemium_pool, uuid[]) from public, anon, authenticated;
