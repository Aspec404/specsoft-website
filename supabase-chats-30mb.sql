-- SPECSOFT Chats: allow uploads up to 50 MB per file at the storage level
-- (the page itself caps normal files at 30 MB and videos at 50 MB).
-- Safe to re-run. Run in the Supabase SQL Editor.
update storage.buckets
set file_size_limit = 52428800,   -- 50 MB
    allowed_mime_types = null     -- any file type
where id = 'chat-attachments';
