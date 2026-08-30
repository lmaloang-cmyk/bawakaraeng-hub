-- DONT PANIC leaderboard hotfix
-- Jalankan SEKALI di Supabase SQL Editor setelah SQL leaderboard utama.

create or replace function public.submit_game_score(
  p_game_key text,
  p_score integer,
  p_player_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login diperlukan';
  end if;

  if p_game_key not in ('flyer', 'ngopi')
     or p_score < 0
     or p_score > 100000 then
    raise exception 'Skor tidak valid';
  end if;

  insert into public.game_leaderboard (
    user_id, game_key, player_name, best_score, updated_at
  )
  values (
    auth.uid(), p_game_key, left(trim(p_player_name), 80), p_score, now()
  )
  on conflict (user_id, game_key)
  do update set
    player_name = excluded.player_name,
    best_score = excluded.best_score,
    updated_at = now()
  where excluded.best_score > public.game_leaderboard.best_score;
end;
$$;

revoke all on function public.submit_game_score(text, integer, text) from public;
grant execute on function public.submit_game_score(text, integer, text) to authenticated;
