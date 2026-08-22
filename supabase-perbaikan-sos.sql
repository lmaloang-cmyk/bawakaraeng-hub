-- ============================================================================
--  PERBAIKAN TABEL sos_alerts  (Bawakaraeng Hub / RCS.CBS)
-- ----------------------------------------------------------------------------
--  Kenapa berkas ini ada:
--  Saat menyimpan SOS, server menulis kolom lat, lng, name, device, user_id,
--  user_email, active, dan status. Kalau SATU saja kolom itu tidak ada di
--  tabel, PostgREST menolak seluruh INSERT, server membalas 502, dan aplikasi
--  hanya menampilkan "SOS belum tersimpan. Periksa koneksi lalu coba lagi."
--  Padahal koneksinya sehat -- yang salah adalah bentuk tabelnya.
--
--  Berkas ini AMAN dijalankan berulang kali (idempoten): tidak menghapus data,
--  tidak menimpa kolom yang sudah ada, hanya menambah yang kurang.
--
--  Cara pakai: Supabase -> SQL Editor -> New query -> tempel semua -> Run.
-- ============================================================================

-- 1) Pastikan tabelnya ada. Kalau sudah ada, perintah ini tidak melakukan apa pun.
create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- 2) Tambahkan setiap kolom yang dipakai server bila belum ada.
alter table public.sos_alerts add column if not exists created_at  timestamptz not null default now();
alter table public.sos_alerts add column if not exists lat         double precision;
alter table public.sos_alerts add column if not exists lng         double precision;
alter table public.sos_alerts add column if not exists name        text;
alter table public.sos_alerts add column if not exists device      text;
alter table public.sos_alerts add column if not exists user_id     uuid;
alter table public.sos_alerts add column if not exists user_email  text;
alter table public.sos_alerts add column if not exists active      boolean not null default true;
alter table public.sos_alerts add column if not exists status      text not null default 'active';
alter table public.sos_alerts add column if not exists handled_at  timestamptz;
alter table public.sos_alerts add column if not exists handled_by  text;

-- 3) Longgarkan NOT NULL yang bisa menggagalkan INSERT dari server.
--    Server tidak selalu mengirim name/device/user_email (mis. akun tanpa nama).
do $$
begin
  begin alter table public.sos_alerts alter column name       drop not null; exception when others then null; end;
  begin alter table public.sos_alerts alter column device     drop not null; exception when others then null; end;
  begin alter table public.sos_alerts alter column user_email drop not null; exception when others then null; end;
  begin alter table public.sos_alerts alter column user_id    drop not null; exception when others then null; end;
end $$;

-- 4) Rapikan baris lama yang status-nya kosong supaya ikut terbaca
--    penyaring sos-nearby (status = 'active').
update public.sos_alerts set status = case when active then 'active' else 'resolved' end
where status is null;

-- 5) Indeks agar pencarian SOS aktif tetap cepat.
create index if not exists sos_alerts_active_created_idx on public.sos_alerts (active, created_at desc);
create index if not exists sos_alerts_status_created_idx on public.sos_alerts (status, created_at desc);
create index if not exists sos_alerts_user_active_idx    on public.sos_alerts (user_id, active);

-- 6) RLS tetap menyala tanpa satu pun policy: hanya Service Role (server) yang
--    boleh membaca/menulis. Lokasi pendaki TIDAK boleh terbuka ke publik.
alter table public.sos_alerts enable row level security;

-- ============================================================================
--  VERIFIKASI -- hasilnya harus memuat 11 baris nama kolom di bawah ini.
-- ============================================================================
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'sos_alerts'
order by column_name;

-- Uji tulis sungguhan lalu langsung dihapus. Kalau blok ini lolos tanpa error,
-- berarti INSERT dari server juga akan lolos.
do $$
declare uji uuid;
begin
  insert into public.sos_alerts (lat, lng, name, device, user_id, user_email, active, status)
  values (-5.0, 119.0, 'UJI SISTEM', 'uji-skema', null, 'uji@contoh.test', true, 'active')
  returning id into uji;
  delete from public.sos_alerts where id = uji;
  raise notice 'UJI INSERT sos_alerts: BERHASIL (baris uji sudah dihapus)';
end $$;
