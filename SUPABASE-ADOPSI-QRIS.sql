-- ADOPSI POHON: jalankan sekali di Supabase SQL Editor.
-- Kode sertifikat hanya dapat diterbitkan oleh akun yang tercantum pada app_admins.

create table if not exists public.adoption_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  package_name text not null,
  amount integer not null check (amount > 0),
  quantity integer not null check (quantity > 0),
  status text not null default 'menunggu_bukti' check (status in ('menunggu_bukti','terverifikasi','ditolak')),
  adoption_code text unique,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
alter table public.adoption_requests enable row level security;
drop policy if exists "adoption user creates" on public.adoption_requests;
drop policy if exists "adoption user reads own" on public.adoption_requests;
drop policy if exists "adoption admin reads" on public.adoption_requests;
drop policy if exists "adoption admin updates" on public.adoption_requests;
create policy "adoption user creates" on public.adoption_requests for insert to authenticated with check (user_id = auth.uid());
create policy "adoption user reads own" on public.adoption_requests for select to authenticated using (user_id = auth.uid());
create policy "adoption admin reads" on public.adoption_requests for select to authenticated using (public.is_app_admin());
create policy "adoption admin updates" on public.adoption_requests for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create index if not exists adoption_requests_user_idx on public.adoption_requests(user_id, created_at desc);
create index if not exists adoption_requests_code_idx on public.adoption_requests(adoption_code);
