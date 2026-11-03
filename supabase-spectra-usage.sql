-- SPECSOFT® Spectra AI: per-user daily usage limit.
-- Run ONCE in Supabase > SQL Editor. Safe to re-run.
-- The edge function (using the service role) is the only thing that can touch this.

create table if not exists public.spectra_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default ((now() at time zone 'utc')::date),
  used    int  not null default 0,
  primary key (user_id, day)
);

alter table public.spectra_usage enable row level security;   -- no policies = browsers can't read or write it
revoke all on table public.spectra_usage from anon, authenticated;

-- Atomically add p_cost credits. Refuses (ok=false) if it would go over p_limit.
create or replace function public.spectra_use(p_user uuid, p_cost int, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day  date := (now() at time zone 'utc')::date;
  v_used int;
begin
  insert into public.spectra_usage (user_id, day, used) values (p_user, v_day, 0)
    on conflict (user_id, day) do nothing;

  update public.spectra_usage
     set used = used + p_cost
   where user_id = p_user and day = v_day and used + p_cost <= p_limit
  returning used into v_used;

  if v_used is null then
    select used into v_used from public.spectra_usage where user_id = p_user and day = v_day;
    return jsonb_build_object('ok', false, 'used', v_used, 'limit', p_limit);
  end if;
  return jsonb_build_object('ok', true, 'used', v_used, 'limit', p_limit);
end;
$$;

-- Give credits back when Gemini fails for everyone
create or replace function public.spectra_refund(p_user uuid, p_cost int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.spectra_usage
     set used = greatest(used - p_cost, 0)
   where user_id = p_user and day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.spectra_use(uuid, int, int)  from public, anon, authenticated;
revoke all on function public.spectra_refund(uuid, int)    from public, anon, authenticated;
grant execute on function public.spectra_use(uuid, int, int) to service_role;
grant execute on function public.spectra_refund(uuid, int)   to service_role;
