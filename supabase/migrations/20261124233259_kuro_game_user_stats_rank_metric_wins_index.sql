create index if not exists kuro_game_user_stats_rank_metric_wins_idx
  on public.kuro_game_user_stats (game_id, mode, metric, wins desc)
  where metric = 'wins';
