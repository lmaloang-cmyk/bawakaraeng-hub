-- Pintu Angin — SOS AMAN
-- Skrip ini menggantikan versi lama yang membuka akses SOS ke publik.
-- Jalankan di Supabase → SQL Editor, lalu jalankan juga supabase-operations.sql.

create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  name text,
  device text,
  active boolean not null default true,
  user_id uuid,
  user_email text,
  status text not null default 'active',
  handled_at timestamptz,
  handled_by text
);

alter table public.sos_alerts add column if not exists device text;
alter table public.sos_alerts add column if not exists active boolean not null default true;
alter table public.sos_alerts add column if not exists created_at timestamptz not null default now();
alter table public.sos_alerts add column if not exists user_id uuid;
alter table public.sos_alerts add column if not exists user_email text;
alter table public.sos_alerts add column if not exists status text not null default 'active';
alter table public.sos_alerts add column if not exists handled_at timestamptz;
alter table public.sos_alerts add column if not exists handled_by text;

alter table public.sos_alerts enable row level security;
-- Hapus kebijakan lama: browser tidak boleh baca/tulis seluruh SOS.
drop policy if exists "sos_select_all" on public.sos_alerts;
drop policy if exists "sos_insert_all" on public.sos_alerts;
drop policy if exists "sos_update_all" on public.sos_alerts;

-- Endpoint Vercel yang memverifikasi login memakai Service Role.
create index if not exists sos_alerts_active_created_idx on public.sos_alerts (active, created_at desc);
create index if not exists sos_alerts_user_active_idx on public.sos_alerts (user_id, active, created_at desc);
