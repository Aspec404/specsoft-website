-- ==========================================================================
-- SPECSOFT® Chats: animated chat backgrounds
-- Run this in the Supabase SQL editor after supabase-community-settings.sql
-- (and the chats SQL that defines chat_rooms / chat_members / chat_has_membership).
-- It adds the missing background storage bucket, table, and RPCs that the
-- frontend already calls in chats-community-settings.js.
-- ========================================================================== 

drop function if exists public.chat_bg_get(uuid);
drop function if exists public.chat_shared_bg_save(uuid, text, integer, integer, integer, boolean);
drop function if exists public.chat_my_bg_save(uuid, text, integer, integer, integer, boolean, boolean);

drop policy if exists "chat backgrounds readable by members" on public.chat_room_backgrounds;
drop policy if exists "chat backgrounds writable by room members" on public.chat_room_backgrounds;
drop policy if exists "chat backgrounds editable by room members" on public.chat_room_backgrounds;
drop policy if exists "chat backgrounds deletable by room members" on public.chat_room_backgrounds;

drop policy if exists "chat backgrounds are public" on storage.objects;
drop policy if exists "chat backgrounds insert" on storage.objects;
drop policy if exists "chat backgrounds update" on storage.objects;
drop policy if exists "chat backgrounds delete" on storage.objects;

create table if not exists public.chat_room_backgrounds (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.chat_rooms(id) on delete cascade,
  user_id        uuid references public.profiles(id) on delete cascade,
  is_shared      boolean not null default false,
  path           text,
  opacity        int not null default 35 check (opacity between 5 and 100),
  blur           int not null default 0 check (blur between 0 and 20),
  dim            int not null default 25 check (dim between 0 and 80),
  hide_community boolean not null default false,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

create unique index if not exists chat_room_backgrounds_shared_idx
  on public.chat_room_backgrounds (room_id)
  where is_shared and user_id is null;

create unique index if not exists chat_room_backgrounds_user_idx
  on public.chat_room_backgrounds (room_id, user_id)
  where not is_shared and user_id is not null;

alter table public.chat_room_backgrounds enable row level security;

create policy "chat backgrounds readable by members"
on public.chat_room_backgrounds for select
using (
  public.chat_has_membership(room_id, auth.uid())
);

create policy "chat backgrounds writable by room members"
on public.chat_room_backgrounds for insert to authenticated
with check (
  public.chat_has_membership(room_id, auth.uid())
  and (
    (is_shared and user_id is null and (
      not exists (select 1 from public.chat_rooms r where r.id = room_id and r.kind::text = 'community')
      or public.chat_has_perm(room_id, auth.uid(), 'manage_community')
    ))
    or (
      not is_shared and user_id = auth.uid()
    )
  )
);

create policy "chat backgrounds editable by room members"
on public.chat_room_backgrounds for update to authenticated
using (
  public.chat_has_membership(room_id, auth.uid())
  and (
    (is_shared and user_id is null and (
      not exists (select 1 from public.chat_rooms r where r.id = room_id and r.kind::text = 'community')
      or public.chat_has_perm(room_id, auth.uid(), 'manage_community')
    ))
    or (
      not is_shared and user_id = auth.uid()
    )
  )
)
with check (
  public.chat_has_membership(room_id, auth.uid())
  and (
    (is_shared and user_id is null and (
      not exists (select 1 from public.chat_rooms r where r.id = room_id and r.kind::text = 'community')
      or public.chat_has_perm(room_id, auth.uid(), 'manage_community')
    ))
    or (
      not is_shared and user_id = auth.uid()
    )
  )
);

create policy "chat backgrounds deletable by room members"
on public.chat_room_backgrounds for delete to authenticated
using (
  public.chat_has_membership(room_id, auth.uid())
  and (
    (is_shared and user_id is null and (
      not exists (select 1 from public.chat_rooms r where r.id = room_id and r.kind::text = 'community')
      or public.chat_has_perm(room_id, auth.uid(), 'manage_community')
    ))
    or (
      not is_shared and user_id = auth.uid()
    )
  )
);

create or replace function public.chat_bg_get(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shared record;
  v_mine record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  select * into v_shared
  from public.chat_room_backgrounds
  where room_id = p_room and is_shared = true and user_id is null
  order by updated_at desc
  limit 1;

  select * into v_mine
  from public.chat_room_backgrounds
  where room_id = p_room and is_shared = false and user_id = auth.uid()
  order by updated_at desc
  limit 1;

  return jsonb_build_object(
    'community', case when v_shared is not null then jsonb_build_object(
      'path', v_shared.path,
      'opacity', coalesce(v_shared.opacity, 35),
      'blur', coalesce(v_shared.blur, 0),
      'dim', coalesce(v_shared.dim, 25)
    ) else null end,
    'mine', case when v_mine is not null then jsonb_build_object(
      'path', v_mine.path,
      'opacity', coalesce(v_mine.opacity, 35),
      'blur', coalesce(v_mine.blur, 0),
      'dim', coalesce(v_mine.dim, 25),
      'hide_community', coalesce(v_mine.hide_community, false)
    ) else null end
  );
end;
$$;

create or replace function public.chat_shared_bg_save(
  p_room uuid,
  p_path text,
  p_opacity int default 35,
  p_blur int default 0,
  p_dim int default 25,
  p_clear boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.chat_rooms;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into r from public.chat_rooms where id = p_room;
  if r.id is null then
    raise exception 'room_not_found';
  end if;

  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  if r.kind::text = 'community' then
    if not public.chat_has_perm(p_room, auth.uid(), 'manage_community') then
      raise exception 'not_allowed';
    end if;
  elsif r.owner_id is distinct from auth.uid() then
    if not exists (
      select 1 from public.chat_members m
      where m.room_id = p_room and m.user_id = auth.uid() and m.role::text in ('owner', 'admin')
    ) then
      raise exception 'not_allowed';
    end if;
  end if;

  if p_clear then
    delete from public.chat_room_backgrounds
    where room_id = p_room and is_shared = true and user_id is null;
    return;
  end if;

  delete from public.chat_room_backgrounds
  where room_id = p_room and is_shared = true and user_id is null;

  insert into public.chat_room_backgrounds (
    room_id, user_id, is_shared, path, opacity, blur, dim, updated_by
  ) values (
    p_room, null, true, btrim(coalesce(p_path, '')),
    coalesce(p_opacity, 35), coalesce(p_blur, 0), coalesce(p_dim, 25), auth.uid()
  );
end;
$$;

create or replace function public.chat_my_bg_save(
  p_room uuid,
  p_path text,
  p_opacity int default 35,
  p_blur int default 0,
  p_dim int default 25,
  p_hide boolean default false,
  p_clear boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not public.chat_has_membership(p_room, auth.uid()) then
    raise exception 'not_member';
  end if;

  if p_clear then
    delete from public.chat_room_backgrounds
    where room_id = p_room and is_shared = false and user_id = auth.uid();
    return;
  end if;

  delete from public.chat_room_backgrounds
  where room_id = p_room and is_shared = false and user_id = auth.uid();

  insert into public.chat_room_backgrounds (
    room_id, user_id, is_shared, path, opacity, blur, dim, hide_community, updated_by
  ) values (
    p_room, auth.uid(), false, btrim(coalesce(p_path, '')),
    coalesce(p_opacity, 35), coalesce(p_blur, 0), coalesce(p_dim, 25), coalesce(p_hide, false), auth.uid()
  );
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-backgrounds', 'chat-backgrounds', true, 41943040, array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update
set public = true,
    file_size_limit = 41943040,
    allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm'];

create policy "chat backgrounds are public" on storage.objects
for select using (bucket_id = 'chat-backgrounds');

create policy "chat backgrounds insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chat-backgrounds'
  and public.chat_has_membership(((storage.foldername(name))[1])::uuid, auth.uid())
);

create policy "chat backgrounds update" on storage.objects
for update to authenticated
using (
  bucket_id = 'chat-backgrounds'
  and public.chat_has_membership(((storage.foldername(name))[1])::uuid, auth.uid())
)
with check (
  bucket_id = 'chat-backgrounds'
  and public.chat_has_membership(((storage.foldername(name))[1])::uuid, auth.uid())
);

create policy "chat backgrounds delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'chat-backgrounds'
  and public.chat_has_membership(((storage.foldername(name))[1])::uuid, auth.uid())
);

grant execute on function public.chat_bg_get(uuid) to authenticated;
grant execute on function public.chat_shared_bg_save(uuid, text, int, int, int, boolean) to authenticated;
grant execute on function public.chat_my_bg_save(uuid, text, int, int, int, boolean, boolean) to authenticated;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_room_backgrounds']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
