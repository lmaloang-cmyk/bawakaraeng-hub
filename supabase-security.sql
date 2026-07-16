-- Bawakaraeng Hub v16 — jalankan sekali di Supabase SQL Editor.
-- Kebijakan ini menjadikan database sebagai lapisan otorisasi utama.

create table if not exists public.app_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

insert into public.app_admins(email) values
 ('songkranveo@gmail.com'),
 ('songkrangveo@gmail.com'),
 ('upik.zulkiflie@gmail.com')
on conflict do nothing;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.app_admins a where a.email=lower(coalesce(auth.jwt()->>'email',''))) $$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

drop policy if exists "admin reads own membership" on public.app_admins;
create policy "admin reads own membership" on public.app_admins for select to authenticated
using (email=lower(coalesce(auth.jwt()->>'email','')));

-- Helper menerapkan RLS hanya bila tabel aplikasi sudah ada.
do $$
begin
 if to_regclass('public.reports') is not null then
  execute 'alter table public.reports enable row level security';
  execute 'drop policy if exists "reports public approved" on public.reports';
  execute 'drop policy if exists "reports owner read" on public.reports';
  execute 'drop policy if exists "reports authenticated insert" on public.reports';
  execute 'drop policy if exists "reports admin update" on public.reports';
  execute 'drop policy if exists "reports admin delete" on public.reports';
  execute $p$create policy "reports public approved" on public.reports for select to anon, authenticated using (astatus='disetujui' or user_id=auth.uid() or public.is_app_admin())$p$;
  execute $p$create policy "reports authenticated insert" on public.reports for insert to authenticated with check (user_id=auth.uid() and astatus='baru' and length(coalesce(description,'')) between 5 and 500)$p$;
  execute $p$create policy "reports admin update" on public.reports for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin())$p$;
  execute $p$create policy "reports admin delete" on public.reports for delete to authenticated using (public.is_app_admin())$p$;
 end if;

 if to_regclass('public.simaksi') is not null then
  execute 'alter table public.simaksi enable row level security';
  execute 'drop policy if exists "simaksi owner admin read" on public.simaksi';
  execute 'drop policy if exists "simaksi owner insert" on public.simaksi';
  execute 'drop policy if exists "simaksi admin update" on public.simaksi';
  execute 'drop policy if exists "simaksi admin delete" on public.simaksi';
  execute $p$create policy "simaksi owner admin read" on public.simaksi for select to authenticated using (user_id=auth.uid() or public.is_app_admin())$p$;
  execute $p$create policy "simaksi owner insert" on public.simaksi for insert to authenticated with check (user_id=auth.uid() and astatus='baru' and jml between 1 and 20)$p$;
  execute $p$create policy "simaksi admin update" on public.simaksi for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin())$p$;
  execute $p$create policy "simaksi admin delete" on public.simaksi for delete to authenticated using (public.is_app_admin())$p$;
 end if;

 if to_regclass('public.jurnal') is not null then
  execute 'alter table public.jurnal enable row level security';
  execute 'drop policy if exists "jurnal owner admin read" on public.jurnal';
  execute 'drop policy if exists "jurnal owner insert" on public.jurnal';
  execute 'drop policy if exists "jurnal owner update" on public.jurnal';
  execute 'drop policy if exists "jurnal owner admin delete" on public.jurnal';
  execute $p$create policy "jurnal owner admin read" on public.jurnal for select to authenticated using (user_id=auth.uid() or public.is_app_admin())$p$;
  execute $p$create policy "jurnal owner insert" on public.jurnal for insert to authenticated with check (user_id=auth.uid() and astatus='baru')$p$;
  execute $p$create policy "jurnal owner update" on public.jurnal for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid())$p$;
  execute $p$create policy "jurnal owner admin delete" on public.jurnal for delete to authenticated using (user_id=auth.uid() or public.is_app_admin())$p$;
 end if;

 if to_regclass('public.messages') is not null then
  execute 'alter table public.messages enable row level security';
  execute 'drop policy if exists "messages public read" on public.messages';
  execute 'drop policy if exists "messages authenticated insert" on public.messages';
  execute 'drop policy if exists "messages admin delete" on public.messages';
  execute $p$create policy "messages public read" on public.messages for select to anon, authenticated using (true)$p$;
  execute $p$create policy "messages authenticated insert" on public.messages for insert to authenticated with check (user_id=auth.uid() and channel in ('umum','jalur','tanya','jualbeli') and length(coalesce(body,'')) between 1 and 1000)$p$;
  execute $p$create policy "messages admin delete" on public.messages for delete to authenticated using (public.is_app_admin())$p$;
 end if;
end $$;

-- Disarankan: tambahkan indeks bila belum ada.
create index if not exists app_admins_email_idx on public.app_admins(email);
