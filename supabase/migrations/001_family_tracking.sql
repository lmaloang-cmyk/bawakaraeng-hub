-- Family Tracking Tables (Idempotent)
-- Run this in Supabase SQL Editor
--
-- CATATAN PENTING
-- "create table if not exists" hanya melewati tabel yang sudah ada; perintah itu
-- TIDAK menambahkan kolom yang hilang. Database yang sebelumnya dibuat dengan
-- varian SQL lain (SETUP_TRACKING.sql dkk) karena itu bisa kekurangan kolom
-- seperti tracking_sessions.updated_at, dan trigger update_position_count() di
-- bawah akan menggagalkan SETIAP insert posisi dengan error 42703.
-- Karena itu setiap create table diikuti blok "alter table ... add column if not
-- exists" agar migrasi ini aman dijalankan pada database baru maupun lama.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. tracking_sessions table
create table if not exists tracking_sessions (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null,
  name text not null default 'Pelacakan Keluarga',
  note text default '',
  device_name text default '',
  active boolean not null default true,
  expires_at timestamptz not null,
  last_lat double precision,
  last_lng double precision,
  last_seen timestamptz,
  position_count integer not null default 0,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1b. Susulkan kolom yang hilang pada tabel lama.
--     updated_at adalah kolom yang dipakai trigger update_position_count().
alter table tracking_sessions add column if not exists name           text        not null default 'Pelacakan Keluarga';
alter table tracking_sessions add column if not exists note           text        default '';
alter table tracking_sessions add column if not exists device_name    text        default '';
alter table tracking_sessions add column if not exists active         boolean     not null default true;
alter table tracking_sessions add column if not exists last_lat       double precision;
alter table tracking_sessions add column if not exists last_lng       double precision;
alter table tracking_sessions add column if not exists last_seen      timestamptz;
alter table tracking_sessions add column if not exists position_count integer     not null default 0;
alter table tracking_sessions add column if not exists cancelled_by   uuid;
alter table tracking_sessions add column if not exists cancelled_at   timestamptz;
alter table tracking_sessions add column if not exists created_at     timestamptz not null default now();
alter table tracking_sessions add column if not exists updated_at     timestamptz not null default now();

-- Indexes for tracking_sessions
create index if not exists idx_tracking_sessions_created_by on tracking_sessions(created_by);
create index if not exists idx_tracking_sessions_active on tracking_sessions(active) where active = true;
create index if not exists idx_tracking_sessions_expires_at on tracking_sessions(expires_at);
create index if not exists idx_tracking_sessions_created_at on tracking_sessions(created_at desc);

-- 2. tracking_positions table
create table if not exists tracking_positions (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references tracking_sessions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  battery_pct integer,
  client_id text,
  sent_at timestamptz not null default now()
);

-- 2b. Susulkan kolom yang hilang pada tabel lama.
--     Pada database lama accuracy_m/altitude_m bisa bertipe integer; itu tetap
--     berfungsi karena Postgres membulatkan nilai pecahan saat insert.
alter table tracking_positions add column if not exists accuracy_m  double precision;
alter table tracking_positions add column if not exists altitude_m  double precision;
alter table tracking_positions add column if not exists battery_pct integer;
alter table tracking_positions add column if not exists client_id   text;
alter table tracking_positions add column if not exists sent_at     timestamptz not null default now();

-- Indexes for tracking_positions
create index if not exists idx_tracking_positions_session on tracking_positions(session_id);
create index if not exists idx_tracking_positions_sent_at on tracking_positions(sent_at desc);
create index if not exists idx_tracking_positions_session_sent on tracking_positions(session_id, sent_at desc);

-- 3. tracking_share_tokens table
create table if not exists tracking_share_tokens (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references tracking_sessions(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(session_id, token)
);

-- 3b. Susulkan kolom yang hilang pada tabel lama.
alter table tracking_share_tokens add column if not exists token      text;
alter table tracking_share_tokens add column if not exists expires_at timestamptz;
alter table tracking_share_tokens add column if not exists created_at timestamptz not null default now();

-- 3c. api/tracking.js melakukan upsert dengan Prefer: resolution=merge-duplicates,
--     yang mensyaratkan unique/primary key pada (session_id, token). Tanpa itu
--     PostgREST menolak dengan 42P10 dan token share gagal dibuat.
do $$
declare
  has_unique boolean;
begin
  select exists (
    select 1
    from pg_constraint
    where conrelid = 'tracking_share_tokens'::regclass
      and contype in ('p', 'u')
      and pg_get_constraintdef(oid) ilike '%(session_id, token)%'
  ) into has_unique;

  if not has_unique then
    alter table tracking_share_tokens
      add constraint tracking_share_tokens_session_token_key unique (session_id, token);
  end if;
end $$;

-- Index for tracking_share_tokens
create index if not exists idx_tracking_share_tokens_token on tracking_share_tokens(token);
create index if not exists idx_tracking_share_tokens_session on tracking_share_tokens(session_id);
create index if not exists idx_tracking_share_tokens_expires on tracking_share_tokens(expires_at);

-- Row Level Security (RLS) policies
alter table tracking_sessions enable row level security;
alter table tracking_positions enable row level security;
alter table tracking_share_tokens enable row level security;

-- Drop existing policies to make migration idempotent
drop policy if exists "Users can view own sessions" on tracking_sessions;
drop policy if exists "Users can insert own sessions" on tracking_sessions;
drop policy if exists "Users can update own active sessions" on tracking_sessions;
drop policy if exists "Users can cancel own sessions" on tracking_sessions;
drop policy if exists "Session owners can view positions" on tracking_positions;
drop policy if exists "Session owners can insert positions" on tracking_positions;
drop policy if exists "Anyone can view valid share tokens" on tracking_share_tokens;

-- Policies for tracking_sessions
create policy "Users can view own sessions"
  on tracking_sessions for select
  using (auth.uid() = created_by);

create policy "Users can insert own sessions"
  on tracking_sessions for insert
  with check (auth.uid() = created_by);

create policy "Users can update own active sessions"
  on tracking_sessions for update
  using (auth.uid() = created_by and active = true);

create policy "Users can cancel own sessions"
  on tracking_sessions for update
  using (auth.uid() = created_by);

-- Policies for tracking_positions
create policy "Session owners can view positions"
  on tracking_positions for select
  using (exists (
    select 1 from tracking_sessions
    where tracking_sessions.id = tracking_positions.session_id
    and tracking_sessions.created_by = auth.uid()
    and tracking_sessions.active = true
  ));

create policy "Session owners can insert positions"
  on tracking_positions for insert
  with check (exists (
    select 1 from tracking_sessions
    where tracking_sessions.id = tracking_positions.session_id
    and tracking_sessions.created_by = auth.uid()
    and tracking_sessions.active = true
  ));

-- Policies for tracking_share_tokens
create policy "Anyone can view valid share tokens"
  on tracking_share_tokens for select
  using (expires_at > now());

-- Function to update position count
create or replace function update_position_count()
returns trigger as $$
begin
  update tracking_sessions
  set 
    last_lat = new.lat,
    last_lng = new.lng,
    last_seen = new.sent_at,
    position_count = position_count + 1,
    updated_at = now()
  where id = new.session_id;
  return new;
end;
$$ language plpgsql;

-- Trigger for position count update
drop trigger if exists on_position_insert on tracking_positions;
create trigger on_position_insert
  after insert on tracking_positions
  for each row
  execute function update_position_count();
