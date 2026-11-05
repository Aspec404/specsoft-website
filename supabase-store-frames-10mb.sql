-- ============================================================================
-- SPECSOFT® Store: frame image fix  (10 MB uploads + newest frame validator)
-- Run this ONCE in Supabase > SQL Editor. Safe to re-run, in any order, any time.
--
--   1. store-frames bucket: created if missing, limit raised to 10 MB, PNG / GIF / WebP only
--   2. storage policies: anyone can see frame images, only store admins can upload / change / delete
--   3. frame validator: reinstalls the NEWEST version (v1 + v2 designer + v3 image frames + Frame Lab
--      effects), so if an older supabase-store-frames-v2.sql was re-run later and overwrote it,
--      image frames and Lab effects work again
--
-- Heads up: Supabase also has a project-wide upload cap in Dashboard > Storage > Settings.
-- Keep it at 10 MB or higher, or the bucket limit below cannot go past it.
-- ============================================================================

-- ---------- 1. bucket ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-frames', 'store-frames', true, 10485760, array['image/png', 'image/gif', 'image/webp'])
on conflict (id) do update
    set public = true,
        file_size_limit = 10485760,
        allowed_mime_types = array['image/png', 'image/gif', 'image/webp'];

-- ---------- 2. policies --------------------------------------------------------
drop policy if exists store_frames_read on storage.objects;
create policy store_frames_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'store-frames');

drop policy if exists store_frames_admin_insert on storage.objects;
create policy store_frames_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'store-frames' and public.store_is_admin());

drop policy if exists store_frames_admin_update on storage.objects;
create policy store_frames_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'store-frames' and public.store_is_admin())
    with check (bucket_id = 'store-frames' and public.store_is_admin());

drop policy if exists store_frames_admin_delete on storage.objects;
create policy store_frames_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'store-frames' and public.store_is_admin());

-- ---------- 3. newest frame validator ------------------------------------------
create or replace function public.store_frame_ok(f jsonb)
returns boolean language plpgsql immutable as $$
declare l jsonb; c jsonb; im jsonb; shape text; k text; n numeric;
begin
    if f is null or jsonb_typeof(f) <> 'object' then return false; end if;
    if pg_column_size(f) > 12000 then return false; end if;

    if (f->>'v') in ('2', '3') then
        shape := f->>'shape';
        if shape is not null and shape not in ('circle','squircle','rounded','square','petal','blob') then return false; end if;

        if (f->>'v') = '2' then
            if coalesce(jsonb_typeof(f->'layers'), '') <> 'array' then return false; end if;
            if jsonb_array_length(f->'layers') not between 1 and 4 then return false; end if;
        else
            -- v3: an uploaded image plus 0 to 4 optional layers
            if f->'layers' is not null and jsonb_typeof(f->'layers') <> 'array' then return false; end if;
            if coalesce(jsonb_array_length(f->'layers'), 0) > 4 then return false; end if;

            im := f->'image';
            if im is null or jsonb_typeof(im) <> 'object' then return false; end if;
            if coalesce(im->>'src', '') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/store-frames/[A-Za-z0-9._/-]+$' then return false; end if;
            if position('..' in (im->>'src')) > 0 or length(im->>'src') > 300 then return false; end if;

            foreach k in array array['scale', 'x', 'y', 'rot'] loop
                if (im->>k) is not null then
                    if (im->>k) !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
                    n := (im->>k)::numeric;
                    if k = 'scale' and n not between 0.5 and 3 then return false; end if;
                    if k in ('x', 'y') and n not between -50 and 50 then return false; end if;
                    if k = 'rot' and n not between -180 and 180 then return false; end if;
                end if;
            end loop;
        end if;

        for l in select * from jsonb_array_elements(coalesce(f->'layers', '[]'::jsonb)) loop
            if jsonb_typeof(l) <> 'object' then return false; end if;
            if coalesce(l->>'type', '') not in (
                'ring','gradient','dashed','dotted','glow','dots','sparkles','ripple',
                'lightning','hearts','stars','snow','shimmer','glitch') then return false; end if;
            if (l->>'blend') is not null and (l->>'blend') not in ('normal','screen','lighten','overlay','color-dodge','difference') then return false; end if;
            if coalesce(jsonb_typeof(l->'colors'), '') <> 'array' then return false; end if;
            if jsonb_array_length(l->'colors') not between 1 and 5 then return false; end if;
            for c in select * from jsonb_array_elements(l->'colors') loop
                if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
            end loop;
        end loop;
        return true;
    end if;

    -- original v1 frames
    return (f->>'style') in ('spin','rainbow','pulse','orbit','neon','fire','dots','aurora','twin')
       and (f->>'c1') ~ '^#[0-9a-fA-F]{6}$'
       and (f->>'c2') ~ '^#[0-9a-fA-F]{6}$'
       and case
             when (f->>'speed') is null then true
             when (f->>'speed') ~ '^[0-9]+(\.[0-9]+)?$' then (f->>'speed')::numeric between 0.5 and 20
             else false
           end;
end $$;
