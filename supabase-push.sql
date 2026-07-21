-- Tabel langganan Web Push untuk notifikasi SOS latar belakang.
-- Jalankan di Supabase → SQL Editor. Idempoten (aman dijalankan berulang).

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

alter table public.push_subscriptions enable row level security;

-- Klien (anon) boleh mendaftarkan & memperbarui langganannya sendiri (upsert dari HP).
drop policy if exists push_insert_all on public.push_subscriptions;
create policy push_insert_all on public.push_subscriptions
  for insert with check (true);

drop policy if exists push_update_all on public.push_subscriptions;
create policy push_update_all on public.push_subscriptions
  for update using (true) with check (true);

drop policy if exists push_select_all on public.push_subscriptions;
create policy push_select_all on public.push_subscriptions
  for select using (true);

-- Catatan: pengiriman push dari server (/api/sos-push) memakai SERVICE ROLE key
-- yang melewati RLS, jadi daftar langganan tidak terekspos lewat anon key.
