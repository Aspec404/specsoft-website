-- ============================================================================
-- SPECSOFT® Store: Titles v2  (more fonts, more effects, 3 effect slots, more decorations, Flaticon icon links)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-titles.sql and supabase-store-title-icons.sql. Safe to re-run.
--
--   - fonts:       25 allowed (9 system fonts + 16 Google web fonts)
--   - effects:     24 allowed, and a title can now carry effect, effect2 and effect3
--   - decorations: 13 allowed
--   - icons:       iconL / iconR may be a link into your store-icons bucket OR a Flaticon CDN image
--                  (https://cdn-icons-png.flaticon.com/<size>/<folder>/<id>.png)
-- Every older title stays valid.
-- ============================================================================

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

    if (f->>'font') is not null and (f->>'font') not in ('sans','rounded','serif','classic','display','mono','script','comic','engrave','orbitron','audiowide','righteous','bungee','bebas','pixel','vt323','cinzel','playfair','gothic','creepster','pacifico','lobster','caveat','marker','fredoka') then return false; end if;
    foreach k in array array['effect', 'effect2', 'effect3'] loop
        if (f->>k) is not null and (f->>k) not in ('none','glow','neon','halo','shadow','float','bounce','shake','swing','heartbeat','pulse','flicker','blink','fade','rainbow','hueshift','shimmer','glitch','ghost','scanline','wave','hop','jitter','spectrum','sparkle') then return false; end if;
    end loop;
    if (f->>'fill') is not null and (f->>'fill') not in ('solid','gradient') then return false; end if;
    if (f->>'deco') is not null and (f->>'deco') not in ('none','pill','gradpill','glass','tag','underline','outline','dashed','double','neonbox','corners','brackets','wings','stars') then return false; end if;
    if (f->>'left') is not null and (f->>'left') not in ('','✦','★','❖','☾','⚡','♛','❄','❤','☠','✿','⚔','♦','✧','☀','➤') then return false; end if;
    if (f->>'right') is not null and (f->>'right') not in ('','✦','★','❖','☾','⚡','♛','❄','❤','☠','✿','⚔','♦','✧','☀','➤') then return false; end if;
    if (f->>'outline') is not null and jsonb_typeof(f->'outline') = 'string' and (f->>'outline') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;

    -- icons: our own store-icons bucket, or a Flaticon CDN image
    foreach k in array array['iconL', 'iconR'] loop
        if f->k is not null and jsonb_typeof(f->k) <> 'null' then
            if jsonb_typeof(f->k) <> 'string' then return false; end if;
            u := f->>k;
            if length(u) > 300 or position('..' in u) > 0 then return false; end if;
            if u !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/store-icons/[A-Za-z0-9._/-]+$'
               and u !~ '^https://cdn-icons-png\.flaticon\.com/[0-9]{2,3}/[0-9]{1,6}/[0-9]{1,9}\.(png|webp)$' then return false; end if;
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
