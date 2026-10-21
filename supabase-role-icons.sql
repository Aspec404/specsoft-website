-- ==========================================================================
-- SPECSOFT® ROLE ICONS: emoji OR image (Flaticon / your own file)
--
-- RUN AFTER supabase-admin.sql. Safe to run more than once.
--
-- A role icon may now be:
--   1. an emoji or short symbol (up to 8 characters), like before
--   2. a Flaticon image link:  https://cdn-icons-png.flaticon.com/512/1828/1828884.png
--      (also cdn-icons-gif, cdn-icons, cdn-uicons, media .flaticon.com)
--   3. an image in your Supabase Storage public bucket (this project only)
--   4. a file on your own site:  badges/crown.png   (png, svg, webp or gif)
-- Anything else is rejected by the database, so a role can never point at a random site.
-- ==========================================================================

create or replace function public.role_icon_ok(p_icon text)
returns boolean
language sql
immutable
as $$
  select p_icon is not null and (
    char_length(p_icon) between 1 and 8
    or p_icon ~ '^https://(cdn-icons-png|cdn-icons-gif|cdn-icons|cdn-uicons|media)\.flaticon\.com/[A-Za-z0-9_./%-]{3,250}$'
    or p_icon ~ '^https://mcpjjmbvuzclzrniunkq\.supabase\.co/storage/v1/object/public/[A-Za-z0-9_./%-]{3,250}$'
    or p_icon ~ '^badges/[A-Za-z0-9_-]{1,60}\.(png|svg|webp|gif)$'
  );
$$;

-- replace the old "1 to 8 characters" rule on the icon column
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.role_defs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%icon%'
  loop
    execute format('alter table public.role_defs drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.role_defs add constraint role_defs_icon_valid check (public.role_icon_ok(icon));

-- same function as before, with the new icon rule
create or replace function public.admin_upsert_role_def(
  p_id text, p_category text, p_name text, p_icon text, p_color text, p_rank int, p_min_grant text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_before jsonb;
  v_after jsonb;
begin
  v_err := public.admin_gate('owner', 'role_def_upsert');
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  if p_id is null or p_id !~ '^[a-z0-9_]{2,40}$'
     or p_category not in ('general', 'cosmetic', 'verified', 'level')
     or char_length(btrim(coalesce(p_name, ''))) not between 2 and 60
     or not public.role_icon_ok(p_icon)
     or p_color !~ '^#[0-9a-fA-F]{6}$'
     or p_min_grant not in ('moderator', 'admin', 'owner') then
    return public.admin_fail('role_def_upsert', null, null, 'bad_input', jsonb_build_object('id', p_id));
  end if;

  select to_jsonb(d) into v_before from public.role_defs d where d.id = p_id;

  insert into public.role_defs (id, category, name, icon, color, rank, min_grant, active)
  values (p_id, p_category, btrim(p_name), p_icon, p_color, coalesce(p_rank, 100), p_min_grant, coalesce(p_active, true))
  on conflict (id) do update
    set category = excluded.category, name = excluded.name, icon = excluded.icon, color = excluded.color,
        rank = excluded.rank, min_grant = excluded.min_grant, active = excluded.active;

  select to_jsonb(d) into v_after from public.role_defs d where d.id = p_id;

  perform public.admin_log('role_def_upsert', null, null, true, v_before, v_after, null, 'role', p_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_upsert_role_def(text, text, text, text, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_upsert_role_def(text, text, text, text, text, int, text, boolean) to authenticated;
