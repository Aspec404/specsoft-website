-- =============================================================================
-- SPECSOFT chats: VIDEO + SEEN/SENT + VOICE CHAT
-- Run once in Supabase > SQL Editor. Safe to run again (it never deletes data).
-- It only needs your existing table  public.chat_members (room_id, user_id)
-- and the storage bucket  chat-attachments.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) VIDEO: let the attachments bucket take videos up to 50 MB
--    * If your bucket has an allow-list of file types, the video types are added to it.
--    * If it has no list, nothing changes there.
--    * Supabase also has a PROJECT-WIDE upload limit (Dashboard > Storage > Settings).
--      The free plan caps it at 50 MB, so 50 MB is the most you can use there.
-- -----------------------------------------------------------------------------
update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800),
    allowed_mime_types = case
        when allowed_mime_types is null then null
        else (
            select array_agg(distinct t)
            from unnest(allowed_mime_types || array['video/mp4','video/webm','video/quicktime','video/x-m4v','video/ogg']) as t
        )
    end
where id = 'chat-attachments';


-- -----------------------------------------------------------------------------
-- 2) SEEN / SENT: remembers how far each person has read in each chat
--    (the "live" part goes through Realtime broadcast, this is what survives a reload)
--    The room_id column copies the type of chat_members.room_id, so it always matches.
-- -----------------------------------------------------------------------------
do $setup$
declare
    t text;
begin
    select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
    where a.attrelid = 'public.chat_members'::regclass
      and a.attname = 'room_id'
      and not a.attisdropped;

    if t is null then
        raise exception 'public.chat_members.room_id was not found, so I cannot create chat_reads';
    end if;

    execute format($f$
        create table if not exists public.chat_reads (
            room_id    %s not null,
            user_id    uuid not null,
            seen_upto  timestamptz not null default 'epoch',
            updated_at timestamptz not null default now(),
            primary key (room_id, user_id)
        )
    $f$, t);

    -- chat_seen(room, time): "I have read this chat up to this message time"
    -- (the time is capped at now(), and it can only ever move forward)
    execute format($f$
        create or replace function public.chat_seen(p_room %s, p_upto timestamptz)
        returns void
        language plpgsql
        security definer
        set search_path = public
        as $b$
        begin
            if auth.uid() is null or p_upto is null then
                return;
            end if;
            if not exists (
                select 1 from public.chat_members m
                where m.room_id = p_room and m.user_id = auth.uid()
            ) then
                return;
            end if;
            insert into public.chat_reads (room_id, user_id, seen_upto, updated_at)
            values (p_room, auth.uid(), least(p_upto, now()), now())
            on conflict (room_id, user_id) do update
                set seen_upto  = greatest(public.chat_reads.seen_upto, excluded.seen_upto),
                    updated_at = now();
        end
        $b$
    $f$, t);

    execute format('revoke all on function public.chat_seen(%s, timestamptz) from public', t);
    execute format('grant execute on function public.chat_seen(%s, timestamptz) to authenticated', t);
end
$setup$;

alter table public.chat_reads enable row level security;

-- members of a chat can see who has read how far; nobody can write directly (only chat_seen() can)
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
    for select to authenticated
    using (exists (
        select 1 from public.chat_members m
        where m.room_id = chat_reads.room_id and m.user_id = auth.uid()
    ));


-- -----------------------------------------------------------------------------
-- 3) VOICE CHAT: only members of a room may join its voice channel
--    The app uses PRIVATE Realtime channels named  specsoft-voice-<room id>.
--    ('specsoft-voice-' is 15 characters, so the room id starts at character 16.)
--    This does not touch your existing chat channels.
-- -----------------------------------------------------------------------------
drop policy if exists "voice: members can listen" on realtime.messages;
create policy "voice: members can listen" on realtime.messages
    for select to authenticated
    using (
        realtime.messages.extension in ('broadcast', 'presence')
        and realtime.topic() like 'specsoft-voice-%'
        and exists (
            select 1 from public.chat_members m
            where m.user_id = auth.uid()
              and m.room_id::text = substring(realtime.topic() from 16)
        )
    );

drop policy if exists "voice: members can speak" on realtime.messages;
create policy "voice: members can speak" on realtime.messages
    for insert to authenticated
    with check (
        realtime.messages.extension in ('broadcast', 'presence')
        and realtime.topic() like 'specsoft-voice-%'
        and exists (
            select 1 from public.chat_members m
            where m.user_id = auth.uid()
              and m.room_id::text = substring(realtime.topic() from 16)
        )
    );


-- let the API pick up the new function/table right away
notify pgrst, 'reload schema';
