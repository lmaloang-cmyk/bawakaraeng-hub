-- Pintu Angin: keamanan SOS, dashboard petugas, dan check-in pos.
-- Jalankan seluruh skrip ini di Supabase → SQL Editor.
-- Aman dijalankan ulang.

-- ========== SOS TERPROTEK ==========
alter table public.sos_alerts add column if not exists user_id uuid;
alter table public.sos_alerts add column if not exists user_email text;
alter table public.sos_alerts add column if not exists status text not null default 'active';
alter table public.sos_alerts add column if not exists handled_at timestamptz;
alter table public.sos_alerts add column if not exists handled_by text;
update public.sos_alerts set status = case when active then 'active' else 'resolved' end where status is null or status not in ('active','resolved');
alter table public.sos_alerts enable row level security;

-- Hapus policy lama yang membuka SOS untuk seluruh browser.
drop policy if exists "sos_select_all" on public.sos_alerts;
drop policy if exists "sos_insert_all" on public.sos_alerts;
drop policy if exists "sos_update_all" on public.sos_alerts;
drop policy if exists "sos_read_authenticated" on public.sos_alerts;
drop policy if exists "sos_write_authenticated" on public.sos_alerts;
-- Tidak ada policy publik. SOS sekarang hanya ditulis/dibaca lewat Vercel
-- menggunakan SUPABASE_SERVICE_ROLE dan token pengguna diverifikasi di server.

create index if not exists sos_alerts_active_created_idx on public.sos_alerts (active, created_at desc);
create index if not exists sos_alerts_user_active_idx on public.sos_alerts (user_id, active, created_at desc);

-- ========== CHECK-IN POS ==========
create table if not exists public.trail_checkins (
  id uuid primary key default gen_random_uuid(),
  position_id text not null,
  position_name text not null,
  lat double precision not null,
  lng double precision not null,
  checked_at timestamptz not null default now(),
  user_id uuid not null,
  user_email text not null,
  user_name text,
  sync_state text not null default 'synced',
  created_at timestamptz not null default now()
);
alter table public.trail_checkins enable row level security;
-- Tidak ada policy publik; akses melalui endpoint Vercel yang memverifikasi login.
create index if not exists trail_checkins_checked_at_idx on public.trail_checkins (checked_at desc);
create index if not exists trail_checkins_user_idx on public.trail_checkins (user_id, checked_at desc);

-- ========== PENGIRIMAN PUSH ANTI-DOBEL ==========
create table if not exists public.sos_push_deliveries (
  sos_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.sos_push_deliveries enable row level security;
