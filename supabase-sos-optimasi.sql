-- ===========================================================================
-- BWK SOS · supabase-sos-optimasi.sql
-- Jalankan di Supabase SQL Editor. Seluruh skrip aman diulang (idempoten).
--
-- Isi:
--   1. Tabel sos_push_deliveries (penyebab S3 - push mati total bila hilang)
--   2. Kolom konteks darurat di sos_alerts (akurasi, ketinggian, baterai, plus code)
--   3. Kolom client_id + indeks unik  -> pengiriman ulang jadi idempoten
--   4. Tabel emergency_profiles dengan RLS ketat (data medis)
--   5. Indeks untuk kueri SOS aktif dan pencarian radius
--   6. Realtime untuk dashboard operator
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Anti-dobel push. Tabel ini WAJIB ada.
--    Tanpa tabel ini, api/sos-push.js mengembalikan 503 NO_CLAIM dan TIDAK ADA
--    satu pun notifikasi SOS yang terkirim.
-- ---------------------------------------------------------------------------
create table if not exists public.sos_push_deliveries (
  sos_id      uuid        not null,
  wave        smallint    not null,
  created_at  timestamptz not null default now(),
  sent_count  integer     not null default 0,
  primary key (sos_id, wave)
);

comment on table public.sos_push_deliveries is
  'Mencegah gelombang push yang sama dikirim dua kali. Bila tabel ini bermasalah, api/sos-push.js HARUS tetap mengirim (fail-open).';

create index if not exists sos_push_deliveries_created_idx
  on public.sos_push_deliveries (created_at desc);

alter table public.sos_push_deliveries enable row level security;

-- Hanya service role (server) yang menyentuh tabel ini. Tidak ada policy untuk
-- anon/authenticated, jadi klien sama sekali tidak bisa mengaksesnya.
drop policy if exists sos_push_deliveries_service on public.sos_push_deliveries;
create policy sos_push_deliveries_service
  on public.sos_push_deliveries
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2. Konteks darurat pada sos_alerts
-- ---------------------------------------------------------------------------
alter table public.sos_alerts add column if not exists client_id    text;
alter table public.sos_alerts add column if not exists accuracy_m   integer;
alter table public.sos_alerts add column if not exists altitude_m   integer;
alter table public.sos_alerts add column if not exists battery_pct  smallint;
alter table public.sos_alerts add column if not exists plus_code    text;
alter table public.sos_alerts add column if not exists queued_at    timestamptz;
alter table public.sos_alerts add column if not exists channel      text default 'internet';
alter table public.sos_alerts add column if not exists profile      jsonb;

comment on column public.sos_alerts.accuracy_m is
  'Radius ketidakpastian GPS dalam meter. Menentukan luas area pencarian - jangan diabaikan operator.';
comment on column public.sos_alerts.battery_pct is
  'Sisa baterai saat SOS dikirim. Menentukan apakah korban masih bisa dihubungi nanti.';
comment on column public.sos_alerts.client_id is
  'Id unik dari perangkat pengirim. Membuat pengiriman ulang dari outbox offline bersifat idempoten.';
comment on column public.sos_alerts.channel is
  'internet | sms | lora | manual - jalur mana yang berhasil membawa SOS ini.';
comment on column public.sos_alerts.profile is
  'Data darurat ringkas (golongan darah, alergi, kontak keluarga). SENSITIF - jangan pernah di-select pada endpoint publik.';

-- Batasan nilai supaya data sampah tidak masuk.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sos_alerts_battery_range') then
    alter table public.sos_alerts
      add constraint sos_alerts_battery_range
      check (battery_pct is null or (battery_pct >= 0 and battery_pct <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sos_alerts_accuracy_range') then
    alter table public.sos_alerts
      add constraint sos_alerts_accuracy_range
      check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sos_alerts_latlng_range') then
    alter table public.sos_alerts
      add constraint sos_alerts_latlng_range
      check (
        (lat is null or (lat >= -90  and lat <= 90)) and
        (lng is null or (lng >= -180 and lng <= 180))
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Idempotensi pengiriman ulang.
--    Outbox offline bisa mengirim SOS yang sama berkali-kali saat sinyal
--    putus-nyambung. Indeks unik ini membuat duplikat mustahil di level basis
--    data, bukan sekadar diharapkan tidak terjadi di level aplikasi.
-- ---------------------------------------------------------------------------
create unique index if not exists sos_alerts_client_id_uidx
  on public.sos_alerts (client_id)
  where client_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Indeks kinerja
-- ---------------------------------------------------------------------------
-- Kueri terpanas: "SOS aktif dalam 30 menit terakhir".
create index if not exists sos_alerts_active_recent_idx
  on public.sos_alerts (created_at desc)
  where active = true;

-- Pencarian kotak lintang/bujur pada endpoint sos-nearby.
create index if not exists sos_alerts_latlng_idx
  on public.sos_alerts (lat, lng)
  where active = true;

-- Pencarian penerima push berdasarkan lokasi terakhir.
create index if not exists push_subscriptions_loc_idx
  on public.push_subscriptions (lat, lng)
  where active = true;

create index if not exists push_subscriptions_stale_idx
  on public.push_subscriptions (loc_updated_at);

-- ---------------------------------------------------------------------------
-- 5. Profil darurat (data medis) - RLS ketat
--    Disimpan terpisah dari sos_alerts supaya kebocoran pada endpoint SOS
--    publik tidak otomatis membocorkan data kesehatan.
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  blood_type  text,
  allergies   text,
  illnesses   text,
  kin_name    text,
  kin_phone   text,
  updated_at  timestamptz not null default now()
);

alter table public.emergency_profiles enable row level security;

-- Pemilik boleh membaca dan menulis profilnya sendiri.
drop policy if exists emergency_profiles_own on public.emergency_profiles;
create policy emergency_profiles_own
  on public.emergency_profiles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Server (service role) boleh membaca saat menangani SOS aktif.
drop policy if exists emergency_profiles_service on public.emergency_profiles;
create policy emergency_profiles_service
  on public.emergency_profiles
  for select
  to service_role
  using (true);

-- ---------------------------------------------------------------------------
-- 6. Realtime untuk dashboard operator (S15)
--    Menghilangkan kebutuhan menekan tombol refresh manual saat ada SOS masuk.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sos_alerts'
  ) then
    alter publication supabase_realtime add table public.sos_alerts;
  end if;
end $$;

-- Realtime membutuhkan replica identity agar pembaruan terkirim utuh.
alter table public.sos_alerts replica identity full;

commit;

-- ===========================================================================
-- VERIFIKASI - jalankan setelah commit, semua harus mengembalikan baris.
-- ===========================================================================
-- select to_regclass('public.sos_push_deliveries')            as tabel_antidobel;
-- select column_name from information_schema.columns
--   where table_name='sos_alerts'
--     and column_name in ('client_id','accuracy_m','altitude_m','battery_pct','plus_code','channel');
-- select indexname from pg_indexes
--   where tablename='sos_alerts' and indexname like 'sos_alerts_%';
-- select tablename from pg_publication_tables where pubname='supabase_realtime';
