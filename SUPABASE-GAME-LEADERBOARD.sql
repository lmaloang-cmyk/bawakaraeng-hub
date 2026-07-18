-- DONT PANIC: leaderboard sepanjang waktu
create table if not exists public.game_leaderboard (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null check (game_key in ('flyer','ngopi')),
  player_name text not null check (char_length(player_name) between 1 and 80),
  best_score integer not null check (best_score between 0 and 100000),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key)
);
alter table public.game_leaderboard enable row level security;
drop policy if exists "leaderboard readable" on public.game_leaderboard;
create policy "leaderboard readable" on public.game_leaderboard for select to anon, authenticated using (true);
revoke all on public.game_leaderboard from anon, authenticated;
grant select on public.game_leaderboard to anon, authenticated;
create or replace function public.submit_game_score(p_game_key text,p_score integer,p_player_name text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Login diperlukan'; end if;
 if p_game_key not in ('flyer','ngopi') or p_score < 0 or p_score > 100000 then raise exception 'Skor tidak valid'; end if;
 insert into public.game_leaderboard(user_id,game_key,player_name,best_score,updated_at) values(auth.uid(),p_game_key,left(trim(p_player_name),80),p_score,now())
 on conflict(user_id,game_key) do update set player_name=excluded.player_name,best_score=excluded.best_score,updated_at=now() where excluded.best_score>public.game_leaderboard.best_score;
end; $$;
revoke all on function public.submit_game_score(text,integer,text) from public;
grant execute on function public.submit_game_score(text,integer,text) to authenticated;
