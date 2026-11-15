-- ============================================================================
-- SPECSOFT® Superior cosmetics lookup (Phase 2)
-- Run AFTER supabase-membership.sql. Safe to run again.
--
-- Returns ONLY which of the given members are Superior right now (no dates,
-- no payment info). That is what the gold bubble, frame and title need.
-- ============================================================================
create or replace function public.superior_ids(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
    select m.user_id
      from public.memberships m
     where m.user_id = any (p_ids[1:200])
       and m.expires_at > now();
$$;

grant execute on function public.superior_ids(uuid[]) to anon, authenticated;
