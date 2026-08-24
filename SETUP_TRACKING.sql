-- ============================================
-- FAMILY TRACKING - SUPABASE MIGRATION (FIXED)
-- ============================================
-- Copy paste ini ke Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncoueeeskzslldppsbvx/editor/sql
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. tracking_sessions table (created_by is UUID to match auth.uid())
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
  cancelled_by text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
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

-- Indexes
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

-- Indexes
create index if not exists idx_tracking_share_tokens_token on tracking_share_tokens(token);
create index if not exists idx_tracking_share_tokens_session on tracking_share_tokens(session_id);
create index if not exists idx_tracking_share_tokens_expires on tracking_share_tokens(expires_at) where expires_at > now();

-- Row Level Security (RLS)
alter table tracking_sessions enable row level security;
alter table tracking_positions enable row level security;
alter table tracking_share_tokens enable row level security;

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

-- Function to auto-update position count
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

-- Trigger
create trigger on_position_insert
  after insert on tracking_positions
  for each row
  execute function update_position_count();
