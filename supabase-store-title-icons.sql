-- ============================================================================
-- SPECSOFT® Store: title icons (Flaticon PNG / SVG / WebP uploads)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-titles.sql. Safe to re-run.
--
--   1. store-icons bucket: public, 2 MB per file, PNG / WebP / GIF / SVG only
--   2. storage policies: anyone can see icons, only store admins can upload / change / delete
--   3. title validator: titles may now carry  "iconL" / "iconR" (an https link into the store-icons
--      bucket and nowhere else) and "iconSize". Every older title stays valid.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-icons', 'store-icons', true, 2097152, array['image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update
    set public = true,
        file_size_limit = 2097152,
        allowed_mime_types = array['image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

drop policy if exists store_icons_read on storage.objects;
create policy store_icons_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'store-icons');

drop policy if exists store_icons_admin_insert on storage.objects;
create policy store_icons_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'store-icons' and public.store_is_admin());

drop policy if exists store_icons_admin_update on storage.objects;
create policy store_icons_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'store-icons' and public.store_is_admin())
    with check (bucket_id = 'store-icons' and public.store_is_admin());

drop policy if exists store_icons_admin_delete on storage.objects;
create policy store_icons_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'store-icons' and public.store_is_admin());

create or replace function public.store_title_ok(f jsonb)
returns boolean language plpgsql immutable as $$
declare c jsonb; s text; k text; u text;
begin
    if f is null or jsonb_typeof(f) <> 'object' then return false; end if;
    if pg_column_size(f) > 4500 then return false; end if;
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

    -- icons: only links into our own store-icons bucket
    foreach k in array array['iconL', 'iconR'] loop
        if f->k is not null and jsonb_typeof(f->k) <> 'null' then
            if jsonb_typeof(f->k) <> 'string' then return false; end if;
            u := f->>k;
            if length(u) > 300 or position('..' in u) > 0 then return false; end if;
            if u !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/store-icons/[A-Za-z0-9._/-]+$' then return false; end if;
        end if;
    end loop;
    if (f->>'iconSize') is not null and (f->>'iconSize') !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;

    if coalesce(jsonb_typeof(f->'colors'), '') <> 'array' then return false; end if;
    if jsonb_array_length(f->'colors') not between 1 and 5 then return false; end if;
    for c in select * from jsonb_array_elements(f->'colors') loop
        if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    end loop;
    return true;
end $$;
