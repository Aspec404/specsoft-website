-- ============================================================================
-- SPECSOFT® Store: purchasable emotes ("MY EMOTES" in chats)
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-store.sql. Safe to re-run.
--
-- How it works
--   * An emote is a normal store item with category = 'emote', a code (emote_name)
--     and an image. Members type / pick it in chats as  :emote_name:
--   * Everybody can SEE every store emote in messages.
--   * Only people who bought it can SEND it (enforced by a trigger on chat_messages).
-- ============================================================================

-- 1) emote columns + rules on store_items
alter table public.store_items add column if not exists emote_name text unique;

alter table public.store_items drop constraint if exists store_items_category_check;
alter table public.store_items add constraint store_items_category_check
    check (category in ('badge','theme','boost','cosmetic','misc','emote'));

alter table public.store_items drop constraint if exists store_items_emote_name_format;
alter table public.store_items add constraint store_items_emote_name_format
    check (emote_name is null or emote_name ~ '^[a-z0-9_+-]{1,32}$');

alter table public.store_items drop constraint if exists store_items_emote_rules;
alter table public.store_items add constraint store_items_emote_rules
    check (category <> 'emote' or (emote_name is not null and image_url is not null and per_user_limit = 1));

-- 2) what chats loads: every emote (so messages render for everyone), and the ones you own
create or replace function public.chat_emotes()
returns table (emote_name text, image_url text)
language sql stable security definer set search_path = public as $$
    select i.emote_name, i.image_url
      from public.store_items i
     where i.category = 'emote' and i.emote_name is not null and i.image_url is not null;
$$;

create or replace function public.chat_my_emotes()
returns table (emote_name text)
language sql stable security definer set search_path = public as $$
    select distinct i.emote_name
      from public.store_purchases p
      join public.store_items i on i.id = p.item_id
     where p.user_id = auth.uid() and i.category = 'emote' and i.emote_name is not null;
$$;

grant execute on function public.chat_emotes() to anon, authenticated;
grant execute on function public.chat_my_emotes() to authenticated;

-- 3) only owners can send a store emote
create or replace function public.store_enforce_emotes()
returns trigger language plpgsql security definer set search_path = public as $$
declare code text;
begin
    if new.body is null or position(':' in new.body) = 0 then return new; end if;
    for code in
        select lower(m[1]) from regexp_matches(new.body, ':([A-Za-z0-9_+-]{1,32}):', 'g') as t(m)
    loop
        if exists (select 1 from public.store_items i where i.category = 'emote' and i.emote_name = code)
           and not exists (
                select 1 from public.store_purchases p
                  join public.store_items i on i.id = p.item_id
                 where p.user_id = new.sender_id and i.emote_name = code)
        then
            raise exception 'emote_not_owned';
        end if;
    end loop;
    return new;
end $$;

drop trigger if exists store_enforce_emotes on public.chat_messages;
create trigger store_enforce_emotes
    before insert or update of body on public.chat_messages
    for each row execute function public.store_enforce_emotes();
