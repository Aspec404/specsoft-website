-- ============================================================================
-- SPECSOFT® Store: layered frames (the Frame Designer)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-frames.sql. Safe to re-run.
--
-- It only replaces the validation function, so
--   * every old frame (the 9 original styles) stays valid and keeps working
--   * new designer frames {"v":2,"shape":...,"layers":[...]} are accepted
-- Numbers are clamped by the site when it draws a frame, so the database only checks the
-- structure: at most 4 layers, known layer types and shapes, and plain #rrggbb colors (max 5 each).
-- ============================================================================

create or replace function public.store_frame_ok(f jsonb)
returns boolean language plpgsql immutable as $$
declare l jsonb; c jsonb;
begin
    if f is null or jsonb_typeof(f) <> 'object' then return false; end if;
    if pg_column_size(f) > 6000 then return false; end if;

    if (f->>'v') = '2' then
        if (f->>'shape') is not null and (f->>'shape') not in ('circle','squircle','rounded','square','petal','blob') then return false; end if;
        if coalesce(jsonb_typeof(f->'layers'), '') <> 'array' then return false; end if;
        if jsonb_array_length(f->'layers') not between 1 and 4 then return false; end if;
        for l in select * from jsonb_array_elements(f->'layers') loop
            if jsonb_typeof(l) <> 'object' then return false; end if;
            if coalesce(l->>'type', '') not in ('ring','gradient','dashed','dotted','glow','dots','sparkles','ripple') then return false; end if;
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
