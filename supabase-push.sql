-- Optimasi & pengamanan Web Push SOS.
-- Jalankan SEKALI di Supabase → SQL Editor. Aman bila dijalankan ulang.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  device text,
  name text,
  lat double precision,
  lng double precision,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Penanda atomik: satu SOS hanya bisa mengirim satu gelombang push.
create table if not exists public.sos_push_deliveries (
  sos_id text primary key,
  created_at timestamptz not null default now()
);

-- Indeks untuk pencarian perangkat dalam bounding box 20 km.
create index if not exists push_subscriptions_active_location_idx
  on public.push_subscriptions (active, lat, lng)
  where active = true and lat is not null and lng is not null;

alter table public.push_subscriptions enable row level security;
alter table public.sos_push_deliveries enable row level security;

-- Keamanan: langganan hanya ditulis/dibaca oleh Vercel memakai Service Role.
-- Endpoint, token auth, dan lokasi perangkat tidak lagi bisa dibaca publik.
drop policy if exists push_insert_all on public.push_subscriptions;
drop policy if exists push_update_all on public.push_subscriptions;
drop policy if exists push_select_all on public.push_subscriptions;
drop policy if exists push_delete_all on public.push_subscriptions;

drop policy if exists sos_push_delivery_public on public.sos_push_deliveries;

-- Tidak ada policy anon: Service Role di Vercel melewati RLS.
