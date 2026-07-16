-- Hotfix untuk error: column "user_id" does not exist pada public.messages
-- Jalankan file ini SEKALI di Supabase SQL Editor, lalu jalankan ulang supabase-security.sql.

alter table public.messages add column if not exists user_id uuid;
