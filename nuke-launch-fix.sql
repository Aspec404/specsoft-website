-- SPECSOFT: fixes the false "Another nuke event is already scheduled" error.
-- Run this once in the Supabase SQL editor. It only replaces admin_nuke_launch (no data is touched).

create or replace function public.admin_nuke_launch(p_starts timestamptz, p_label text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_err text; s public.nuke_settings; t0 timestamptz; e public.nuke_events;
begin
    v_err := public.admin_gate('admin', 'nuke_launch');
    if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
    select * into s from public.nuke_settings where id = 1;
    t0 := coalesce(p_starts, now() + interval '45 seconds');
    if t0 < now() + interval '10 seconds' then return public.admin_fail('nuke_launch', null, p_reason, 'bad_time'); end if;
    if exists (select 1 from public.nuke_events x
                where x.aborted_at is null
                  and x.ends_at > t0 - interval '60 seconds'
                  and x.starts_at < t0 + make_interval(secs => s.countdown_s + s.aftermath_s + 60)) then
        return public.admin_fail('nuke_launch', null, p_reason, 'event_overlap');
    end if;
    insert into public.nuke_events (label, starts_at, boom_at, ends_at, countdown_s, aftermath_s, reward_xp, reward_ac,
                                    spare_survivors, volume, audio_ost, audio_boom, audio_after, audio_alarm, created_by)
    values (nullif(left(btrim(coalesce(p_label, '')), 60), ''), t0, t0 + make_interval(secs => s.countdown_s),
            t0 + make_interval(secs => s.countdown_s + s.aftermath_s), s.countdown_s, s.aftermath_s, s.reward_xp, s.reward_ac,
            s.spare_survivors, s.volume, s.audio_ost, s.audio_boom, s.audio_after, s.audio_alarm, auth.uid())
    returning * into e;
    perform public.admin_log('nuke_launch', null, nullif(btrim(coalesce(p_reason, '')), ''), true, null, to_jsonb(e), null, 'nuke_event', e.id::text);
    return jsonb_build_object('ok', true, 'id', e.id);
end $$;
