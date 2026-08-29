-- ============================================================================
--  TABEL sos_responders — koordinat dan instruksi untuk koordinasi responder
-- ----------------------------------------------------------------------------
--  Kenapa: Pendaki lain yang menerima alarm SOS (bukan admin/pengirim) bisa
--          menekan "Sudah ditangani". Tanpa fitur ini, mereka hanya membisukan
--          alarm lokal tanpa memberi tahu petugas. Dengan tabel ini, petugas
--          dapat melihat siapa saja yang merespons, dari mana, dan mengirim
--          instruksi balik.
--
--  Cara pakai: Supabase -> SQL Editor -> New query -> tempel semua -> Run.
-- ============================================================================

create table if not exists public.sos_responders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sos_alert_id uuid not null references public.sos_alerts(id) on delete cascade,
  responder_id uuid,
  responder_email text,
  responder_name text,
  lat double precision not null,
  lng double precision not null,
  distance_m integer not null,
  message_sent text,         -- instruksi dari admin ke responder
  status text not null default 'reported', -- reported | acknowledged
  responded_at timestamptz
);

-- Indeks: admin query responders per SOS
create index if not exists sos_responders_alert_idx on public.sos_responders (sos_alert_id, created_at desc);

-- RLS: Service Role (server) yang menulis/membaca
-- CATATAN PENTING: Setelah tabel dibuat, buat policy berikut di Supabase Dashboard:
--   SQL Editor -> paste dan jalankan:
--   create policy "Service role can access sos_responders" on sos_responders for all using (true) with check (true);
--   Penjelasan: policy ini mengizinkan server (service role) mengakses semua baris.
--   Client (browser) TIDAK bisa mengakses tabel ini secara langsung (keamanan).
alter table public.sos_responders enable row level security;

-- Verifikasi
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'sos_responders'
order by column_name;
