-- ============================================================================
-- SPECSOFT® Profiles: level, XP and rank on member profiles  (Phase 6)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store-quests.sql. Safe to re-run.
--
--   * profile_xp(user)   level, XP, progress, rank, quests finished and store items owned
--                         for ONE member (shown on their profile page, also to visitors who are not signed in)
--   * xp_levels(ids)     now readable by visitors too, so member cards can show "LV 7"
--
-- XP totals, rank and these counts are treated as public information, like a game profile.
-- Nothing else about a member's wallet or purchases is exposed (no balances, no item names, no history).
-- ============================================================================

create or replace function public.profile_xp(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare x bigint; rk bigint; qd bigint; io bigint;
begin
    select u.xp into x from public.user_xp u where u.user_id = p_user;
    x := coalesce(x, 0);

    select 1 + count(*) into rk from public.user_xp u2 where u2.xp > x;
    select count(*) into qd from public.quest_progress q where q.user_id = p_user and q.claimed;
    select count(distinct p.item_id) into io from public.store_purchases p where p.user_id = p_user;

    return (public.xp_info(x)::jsonb || jsonb_build_object(
        'rank', case when x > 0 then rk else null end,
        'quests_done', qd,
        'items_owned', io
    ))::json;
end $$;

grant execute on function public.profile_xp(uuid) to anon, authenticated;
grant execute on function public.xp_levels(uuid[]) to anon, authenticated;
