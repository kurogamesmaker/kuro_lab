alter table public.kuro_game_user_stats
  add column if not exists metric text
  generated always as (
    case
      when lower(mode) ~ '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
        or lower(coalesce(metadata->>'metric','')) in ('time','time_ms','clear_time_ms','duration_ms')
        then 'time'
      when lower(mode) ~ '(^|[_-])(wins?|victories)([_-]|$)'
        or lower(coalesce(metadata->>'metric','')) in ('wins','win','win_count')
        then 'wins'
      else 'score'
    end
  ) stored;

create index if not exists kuro_game_user_stats_rank_metric_score_idx
  on public.kuro_game_user_stats (game_id, mode, metric, best_score desc)
  where best_score is not null;

create index if not exists kuro_game_user_stats_rank_metric_time_idx
  on public.kuro_game_user_stats (game_id, mode, metric, best_time_ms asc)
  where best_time_ms is not null;

comment on column public.kuro_game_user_stats.metric is
  'Generated canonical ranking metric for each user/game/mode aggregate: wins, score, or time. Mode semantics take precedence over legacy metadata.';
