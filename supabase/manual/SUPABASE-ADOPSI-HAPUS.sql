-- ADOPSI POHON — KEBIJAKAN HAPUS (DELETE)
-- Jalankan sekali di Supabase SQL Editor.
-- Prasyarat: tabel public.adoption_requests dan fungsi public.is_app_admin()
-- sudah dibuat lebih dulu (lihat SUPABASE-ADOPSI-QRIS.sql).
--
-- Tujuan: mengizinkan admin (yang tercantum pada app_admins) menghapus
-- permintaan adopsi yang sudah selesai langsung dari panel admin di aplikasi.

alter table public.adoption_requests enable row level security;

-- Hapus kebijakan lama bila ada, agar aman dijalankan berulang.
drop policy if exists "adoption admin deletes" on public.adoption_requests;

-- Hanya admin yang boleh menghapus baris.
create policy "adoption admin deletes" on public.adoption_requests
  for delete to authenticated
  using (public.is_app_admin());

-- Selesai. Setelah dijalankan, tombol "🗑️ Hapus Permintaan (Selesai)"
-- pada panel admin adopsi akan berfungsi untuk akun admin.
