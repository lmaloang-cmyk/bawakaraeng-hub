-- ============================================================
-- Bawakaraeng Hub — Perbaikan tabel SOS (sos_alerts)
-- Jalankan di Supabase: Dashboard > SQL Editor > New query > Run
-- Aman dijalankan berulang (idempotent).
-- ============================================================

-- 1) Pastikan tabel ada (kalau sudah ada, baris ini dilewati)
create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  name text,
  device text,
  active boolean not null default true
);

-- 2) Tambahkan kolom yang mungkin belum ada di tabel lama
--    (INI KUNCI perbaikan: kolom "device" untuk mengenali HP pengirim)
alter table public.sos_alerts add column if not exists device text;
alter table public.sos_alerts add column if not exists active boolean not null default true;
alter table public.sos_alerts add column if not exists created_at timestamptz not null default now();

-- 3) Aktifkan Row Level Security
alter table public.sos_alerts enable row level security;

-- 4) Kebijakan akses: mode tamu (anon) boleh BACA & KIRIM SOS,
--    dan boleh baca-balik hasil insert (dibutuhkan aplikasi)
drop policy if exists "sos_select_all" on public.sos_alerts;
create policy "sos_select_all" on public.sos_alerts
  for select using (true);

drop policy if exists "sos_insert_all" on public.sos_alerts;
create policy "sos_insert_all" on public.sos_alerts
  for insert with check (true);

-- (opsional) izinkan menandai SOS selesai / non-aktif
drop policy if exists "sos_update_all" on public.sos_alerts;
create policy "sos_update_all" on public.sos_alerts
  for update using (true) with check (true);

-- 5) (opsional) index supaya query cepat
create index if not exists sos_alerts_created_at_idx on public.sos_alerts (created_at desc);
