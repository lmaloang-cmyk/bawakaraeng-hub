-- ============================================================
--  Pintu Angin  Tabel Donasi (sinkron lintas perangkat)
--  Jalankan SEKALI di Supabase  SQL Editor  New query  RUN
-- ============================================================

create table if not exists public.donasi (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  amt bigint not null default 0,
  astatus text not null default 'baru',
  created_at timestamptz not null default now()
);

alter table public.donasi enable row level security;

-- Publik boleh melihat donasi yang SUDAH disetujui (untuk leaderboard)
drop policy if exists donasi_select_public on public.donasi;
create policy donasi_select_public on public.donasi
  for select using (astatus = 'disetujui');

-- Admin boleh melihat SEMUA (termasuk yang masih 'baru')
drop policy if exists donasi_select_admin on public.donasi;
create policy donasi_select_admin on public.donasi
  for select using (
    coalesce(auth.jwt() ->> 'email','') in
    ('songkranveo@gmail.com','songkrangveo@gmail.com','upik.zulkiflie@gmail.com')
  );

-- Siapa pun boleh mengirim donasi baru (status wajib 'baru')
drop policy if exists donasi_insert_public on public.donasi;
create policy donasi_insert_public on public.donasi
  for insert with check (astatus = 'baru');

-- Admin boleh menambah langsung (mis. status 'disetujui')
drop policy if exists donasi_insert_admin on public.donasi;
create policy donasi_insert_admin on public.donasi
  for insert with check (
    coalesce(auth.jwt() ->> 'email','') in
    ('songkranveo@gmail.com','songkrangveo@gmail.com','upik.zulkiflie@gmail.com')
  );

-- Hanya admin yang boleh verifikasi / ubah status
drop policy if exists donasi_update_admin on public.donasi;
create policy donasi_update_admin on public.donasi
  for update using (
    coalesce(auth.jwt() ->> 'email','') in
    ('songkranveo@gmail.com','songkrangveo@gmail.com','upik.zulkiflie@gmail.com')
  );

-- Hanya admin yang boleh menghapus
drop policy if exists donasi_delete_admin on public.donasi;
create policy donasi_delete_admin on public.donasi
  for delete using (
    coalesce(auth.jwt() ->> 'email','') in
    ('songkranveo@gmail.com','songkrangveo@gmail.com','upik.zulkiflie@gmail.com')
  );
