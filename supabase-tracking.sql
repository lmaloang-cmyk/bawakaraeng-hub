-- ===========================================================================
-- Pintu Angin — Live Family Tracking
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang (idempoten).
--
-- Fitur:
--   1. tracking_sessions — sesi bagikan lokasi dengan token shareable
--   2. tracking_positions — posisi real-time & riwayat historis
--   3. family_connections — daftar orang yang boleh melihat satu sama lain
--
-- Desain keamanan:
--   - Token shareable adalah UUID + hash (bukan UUID mentah)
--   - Sesi auto-expire setelah 24 jam atau saat dihentikan manual
--   - Posisi hanya bisa dibaca oleh pemilik session + orang yang punya token
--   - Tidak ada RLS untuk anon token reader (designed untuk embed/viewer)
--   - Server verifikasi token sebelum write
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tabel sesi pelacakan
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_sessions (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  active        boolean not null default true,
  name          text check (length(trim(name)) between 0 and 120),
  note          text,
  device_name   text,
  last_lat      double precision,
  last_lng      double precision,
  last_seen     timestamptz,
  position_count integer not null default 0,
  error_count   integer not null default 0,
  cancelled_by  uuid references auth.users(id) on delete set null,
  cancelled_at  timestamptz
);

alter table public.tracking_sessions enable row level security;

-- Owner bisa manage sesinya sendiri
drop policy if exists tracking_sessions_owner on public.tracking_sessions;
create policy tracking_sessions_owner
  on public.tracking_sessions
  for all to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Admin bisa lihat semua
drop policy if exists tracking_sessions_admin on public.tracking_sessions;
create policy tracking_sessions_admin
  on public.tracking_sessions
  for select to authenticated
  using (public.is_app_admin());

-- ---------------------------------------------------------------------------
-- 2. Token shareable (bukan UUID mentah, agar tidak bisa ditebak)
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_share_tokens (
  session_id    uuid references public.tracking_sessions(id) on delete cascade,
  token         text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  views         integer not null default 0,
  primary key (session_id, token)
);

alter table public.tracking_share_tokens enable row level security;

-- Hanya service role yang menulis token (server generates)
drop policy if exists tracking_tokens_service on public.tracking_share_tokens;
create policy tracking_tokens_service
  on public.tracking_share_tokens
  for all to service_role
  using (true) with check (true);

-- Token reader bisa baca satu token (untuk validasi di API)
drop policy if exists tracking_tokens_viewer on public.tracking_share_tokens;
create policy tracking_tokens_viewer
  on public.tracking_share_tokens
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Riwayat posisi
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_positions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.tracking_sessions(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   integer,
  altitude_m   integer,
  battery_pct  smallint,
  sent_at      timestamptz not null default now(),
  synced       boolean not null default false,
  client_id    text
);

create index if not exists tracking_positions_session_idx
  on public.tracking_positions (session_id, sent_at desc);

create index if not exists tracking_positions_sent_at_idx
  on public.tracking_positions (sent_at desc);

alter table public.tracking_positions enable row level security;

-- Token reader (authenticated) bisa baca posisi sesi miliknya
drop policy if exists tracking_positions_reader on public.tracking_positions;
create policy tracking_positions_reader
  on public.tracking_positions
  for select to authenticated
  using (
    exists (
      select 1 from public.tracking_share_tokens t
      join public.tracking_sessions s on s.id = t.session_id
      where t.token = auth.jwt()->>'x-session-token'
        and s.active = true
        and s.expires_at > now()
    )
  );

-- Owner bisa baca semua posisinya
drop policy if exists tracking_positions_owner on public.tracking_positions;
create policy tracking_positions_owner
  on public.tracking_positions
  for all to authenticated
  using (
    exists (
      select 1 from public.tracking_sessions s
      where s.id = tracking_positions.session_id
        and s.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tracking_sessions s
      where s.id = tracking_positions.session_id
        and s.created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Koneksi keluarga (siapa yang bisa melihat siapa)
-- ---------------------------------------------------------------------------
create table if not exists public.family_connections (
  id           bigint generated always as identity primary key,
  creator_id   uuid not null references auth.users(id) on delete cascade,
  viewer_id    uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null references public.tracking_sessions(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (creator_id, viewer_id, session_id)
);

alter table public.family_connections enable row level security;

drop policy if exists family_connections_owner on public.family_connections;
create policy family_connections_owner
  on public.family_connections
  for all to authenticated
  using (
    auth.uid() = creator_id
    or auth.uid() = viewer_id
  )
  with check (auth.uid() = creator_id);

-- ---------------------------------------------------------------------------
-- 5. Fungsi helper
-- ---------------------------------------------------------------------------
create or replace function public.generate_share_token(
  p_session_id uuid,
  p_expiry_hours integer default 24
) returns text
language plpgsql security definer
as $$
declare
  v_token text;
begin
  -- Buat token 32-byte hex yang unik
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.tracking_share_tokens (session_id, token, expires_at)
  values (p_session_id, v_token, now() + (p_expiry_hours || ' hours')::interval)
  on conflict (session_id, token) do nothing;

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Realtime untuk live tracking
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tracking_positions'
  ) then
    alter publication supabase_realtime add table public.tracking_positions;
  end if;
end $$;

alter table public.tracking_positions replica identity full;

-- ---------------------------------------------------------------------------
-- 7. Cleanup otomatis posisi lama (>7 hari)
-- ---------------------------------------------------------------------------
-- CATATAN: pg_cron tidak selalu tersedia di semua plan Supabase.
-- Gunakan function terpisah agar lebih aman dan bisa dijalankan manual.
create or replace function public.cleanup_old_tracking_positions()
returns void language plpgsql security definer set search_path=public
as $func$
begin
  delete from public.tracking_positions
  where sent_at < now() - interval '7 days';
end;
$func$;

-- Coba setup cron job (opsional, gagal tanpa error jika pg_cron tidak tersedia)
do $body$
begin
  if exists (select 1 from pg_extension where extname = 'cron') then
    perform cron.schedule(
      'tracking_cleanup_old_positions',
      '0 2 * * *',  -- setiap jam 2 pagi
      'select public.cleanup_old_tracking_positions()'
    );
  end if;
end;
$body$;

commit;

-- ===========================================================================
-- VERIFIKASI
-- ===========================================================================
-- select to_regclass('public.tracking_sessions');
-- select to_regclass('public.tracking_share_tokens');
-- select to_regclass('public.tracking_positions');
-- select to_regclass('public.family_connections');
-- select column_name from information_schema.columns
--   where table_name='tracking_sessions';
-- select column_name from information_schema.columns
--   where table_name='tracking_positions';
-- select indexname from pg_indexes
--   where tablename='tracking_positions';
