-- FIX: Sos_alerts RLS policy — menghilangkan 403 Forbidden saat SOS dikirim
-- Jalankan di Supabase SQL Editor. Aman dijalankan berulang kali.

-- Policy agar klien (anon & authenticated) bisa INSERT ke sos_alerts
-- Service role (server) sudah punya akses default, tapi klien butuh policy eksplisit
-- untuk jalur langsung dari browser (mis. saat testing atau fallback).
drop policy if exists "sos_insert_anon" on public.sos_alerts;
create policy "sos_insert_anon"
  on public.sos_alerts
  for insert
  to anon, authenticated
  with check (true);

-- Policy agar klien bisa SELECT (diperlukan untuk polling nearby)
drop policy if exists "sos_select_anon" on public.sos_alerts;
create policy "sos_select_anon"
  on public.sos_alerts
  for select
  to anon, authenticated
  using (active = true and created_at > now() - interval '30 minutes');

-- Policy agar pengguna bisa UPDATE SOS miliknya sendiri
drop policy if exists "sos_update_own" on public.sos_alerts;
create policy "sos_update_own"
  on public.sos_alerts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Verifikasi
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where tablename = 'sos_alerts'
order by policyname;
