-- Pintu Angin / RCS.CBS — Optimasi keandalan alarm SOS
-- Masalah yang diperbaiki: alarm SOS kadang tidak muncul di perangkat lain.
-- Jalankan SEKALI di Supabase → SQL Editor. Aman bila dijalankan ulang.
-- Prasyarat: supabase-sos.sql, supabase-operations.sql, supabase-push.sql sudah pernah dijalankan.

-- =====================================================================
-- 1. GELOMBANG PUSH BERULANG
-- Sebelumnya sos_push_deliveries memakai PRIMARY KEY (sos_id), sehingga satu SOS
-- hanya boleh mengirim SATU gelombang push selamanya. Perangkat yang saat itu
-- offline, layar mati, atau kehilangan sinyal tidak akan pernah diberi tahu.
-- Sekarang kuncinya (sos_id, wave): tiap jendela ~2,5 menit boleh mengirim satu
-- gelombang baru selama SOS masih aktif, tanpa risiko notifikasi dobel.
-- =====================================================================
create table if not exists public.sos_push_deliveries (
  sos_id text not null,
  created_at timestamptz not null default now()
);

alter table public.sos_push_deliveries add column if not exists wave int not null default 1;
alter table public.sos_push_deliveries add column if not exists created_at timestamptz not null default now();

-- Ganti kunci utama lama (sos_id) menjadi (sos_id, wave).
do $$
declare
  pk_name text;
begin
  select con.conname into pk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where con.contype = 'p' and nsp.nspname = 'public' and rel.relname = 'sos_push_deliveries';

  if pk_name is not null then
    -- Sudah (sos_id, wave)? Jangan diapa-apakan.
    if (select count(*) from pg_attribute a
        join pg_constraint c on c.conrelid = a.attrelid and a.attnum = any(c.conkey)
        where c.conname = pk_name and a.attname in ('sos_id','wave')) = 2 then
      return;
    end if;
    execute format('alter table public.sos_push_deliveries drop constraint %I', pk_name);
  end if;

  execute 'alter table public.sos_push_deliveries add primary key (sos_id, wave)';
end $$;

create index if not exists sos_push_deliveries_sos_idx
  on public.sos_push_deliveries (sos_id, created_at desc);

-- Bersihkan penanda lama agar tabel tidak tumbuh tanpa batas.
delete from public.sos_push_deliveries where created_at < now() - interval '7 days';

-- =====================================================================
-- 2. KOORDINAT LANGGANAN PUSH
-- Server memilih penerima memakai bounding box dari kolom lat/lng. Dulu kolom itu
-- hanya diisi sekali saat mendaftar notifikasi, jadi HP yang mendaftar di kota
-- lalu naik gunung punya koordinat basi dan selalu tersaring keluar.
-- Klien sekarang menyegarkannya tiap aplikasi dibuka; kolom di bawah untuk audit.
-- =====================================================================
alter table public.push_subscriptions add column if not exists loc_updated_at timestamptz;

-- Indeks untuk perangkat yang belum punya koordinat: mereka tetap dikirimi push
-- (lebih baik satu notifikasi berlebih daripada pendaki di radius bahaya tidak diberi tahu).
create index if not exists push_subscriptions_active_nolocation_idx
  on public.push_subscriptions (active)
  where active = true and (lat is null or lng is null);

create index if not exists push_subscriptions_loc_updated_idx
  on public.push_subscriptions (loc_updated_at desc);

-- =====================================================================
-- 3. INDEKS PENCARIAN SOS SEKITAR
-- sos-nearby menyaring active + status + created_at, jadi indeks gabungan
-- membuat polling tetap murah walau jumlah baris bertambah.
-- =====================================================================
create index if not exists sos_alerts_status_created_idx
  on public.sos_alerts (status, created_at desc)
  where active = true;

-- =====================================================================
-- 4. PEMERIKSAAN CEPAT (opsional, jalankan manual untuk audit)
-- =====================================================================
-- SOS aktif 30 menit terakhir:
--   select id, name, lat, lng, created_at from public.sos_alerts
--   where active and status = 'active' and created_at > now() - interval '30 minutes'
--   order by created_at desc;
--
-- Perangkat siap menerima push (dan kesegaran koordinatnya):
--   select count(*) filter (where lat is not null) as ada_lokasi,
--          count(*) filter (where lat is null) as tanpa_lokasi,
--          count(*) filter (where loc_updated_at > now() - interval '1 day') as lokasi_segar
--   from public.push_subscriptions where active;
--
-- Riwayat gelombang push per SOS:
--   select sos_id, max(wave) as gelombang, min(created_at) as mulai, max(created_at) as terakhir
--   from public.sos_push_deliveries group by sos_id order by terakhir desc limit 20;
