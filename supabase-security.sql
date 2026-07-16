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

-- Daftar individu yang dilarang mengajukan SIMAKSI / masuk kawasan. Hanya admin yang boleh melihat dan mengubah daftar ini.
create table if not exists public.user_blacklist (
  id bigint generated always as identity primary key,
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  user_email text,
  user_id uuid,
  reason text not null check (length(trim(reason)) between 3 and 600),
  blacklisted_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.user_blacklist enable row level security;
drop policy if exists "blacklist admin read" on public.user_blacklist;
drop policy if exists "blacklist admin insert" on public.user_blacklist;
drop policy if exists "blacklist admin update" on public.user_blacklist;
drop policy if exists "blacklist admin delete" on public.user_blacklist;
create policy "blacklist admin read" on public.user_blacklist for select to authenticated using (public.is_app_admin());
create policy "blacklist admin insert" on public.user_blacklist for insert to authenticated with check (public.is_app_admin());
create policy "blacklist admin update" on public.user_blacklist for update to authenticated using (public.is_app_admin()) with check (public.is_app_admin());
create policy "blacklist admin delete" on public.user_blacklist for delete to authenticated using (public.is_app_admin());

create or replace function public.is_blacklisted_current_user()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(
  select 1 from public.user_blacklist b
  where b.active=true
    and (b.expires_at is null or b.expires_at > now())
    and (b.user_id=auth.uid() or lower(coalesce(b.user_email,''))=lower(coalesce(auth.jwt()->>'email','')))
) $$;
revoke all on function public.is_blacklisted_current_user() from public;
grant execute on function public.is_blacklisted_current_user() to anon, authenticated;

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
  execute $p$create policy "simaksi owner insert" on public.simaksi for insert to authenticated with check (user_id=auth.uid() and not public.is_blacklisted_current_user() and astatus='baru' and jml between 1 and 20)$p$;
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
  -- Beberapa instalasi lama belum memiliki kolom pemilik pesan.
  -- Tambahkan kolom ini sebelum policy yang menggunakan auth.uid() dibuat.
  execute 'alter table public.messages add column if not exists user_id uuid';
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
create index if not exists user_blacklist_email_idx on public.user_blacklist(lower(user_email));
create index if not exists user_blacklist_user_idx on public.user_blacklist(user_id);
-- Identitas opsional untuk pencatatan administratif pendaki.
alter table public.user_blacklist add column if not exists identity_number text;
alter table public.user_blacklist add column if not exists phone text;
create index if not exists user_blacklist_identity_idx on public.user_blacklist(identity_number);

-- Pengecekan publik hanya mengembalikan status izin dan masa larangan.
-- Nama, KTP, serta alasan pelanggaran tidak pernah dikembalikan ke pengguna.
create or replace function public.check_climbing_eligibility(p_identity_number text)
returns table(is_allowed boolean, expires_at timestamptz)
language plpgsql stable security definer set search_path=public
as $$
declare v_ktp text := regexp_replace(coalesce(p_identity_number,''), '\D', '', 'g');
begin
  if length(v_ktp) <> 16 then raise exception 'Nomor KTP harus 16 digit'; end if;
  return query
  select not exists(
    select 1 from public.user_blacklist b
    where b.identity_number=v_ktp and b.active=true
      and (b.expires_at is null or b.expires_at > now())
  ), (
    select b.expires_at from public.user_blacklist b
    where b.identity_number=v_ktp and b.active=true
      and (b.expires_at is null or b.expires_at > now())
    order by b.expires_at nulls first limit 1
  );
end;
$$;
revoke all on function public.check_climbing_eligibility(text) from public;
grant execute on function public.check_climbing_eligibility(text) to anon, authenticated;


-- SIMAKSI: unggah bukti pembayaran oleh pemohon.
-- Simpan gambar terkompresi maksimum sekitar 1 MB. Untuk skala besar, pindahkan
-- aset ini ke Supabase Storage private dan simpan path-nya, bukan data URI.
alter table public.simaksi add column if not exists payment_proof text;
alter table public.simaksi add column if not exists payment_submitted_at timestamptz;

create or replace function public.submit_simaksi_payment(p_code text, p_payment_proof text)
returns void language plpgsql security definer set search_path=public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Autentikasi diperlukan'; end if;
  if coalesce(length(p_code),0) < 5 then raise exception 'Kode pengajuan tidak valid'; end if;
  if coalesce(length(p_payment_proof),0) < 100 or length(p_payment_proof) > 1500000 then
    raise exception 'Ukuran bukti pembayaran tidak valid';
  end if;
  if p_payment_proof !~ '^data:image/(jpeg|png|webp);base64,' then
    raise exception 'Format bukti pembayaran harus JPEG, PNG, atau WebP';
  end if;
  update public.simaksi
     set payment_proof=p_payment_proof,
         payment_submitted_at=now(),
         stage='menunggu_konfirmasi'
   where code=upper(trim(p_code))
     and user_id=v_uid
     and stage='diverifikasi';
  if not found then
    raise exception 'Pengajuan tidak ditemukan atau belum siap menerima bukti pembayaran';
  end if;
end;
$$;
revoke all on function public.submit_simaksi_payment(text,text) from public;
grant execute on function public.submit_simaksi_payment(text,text) to authenticated;
