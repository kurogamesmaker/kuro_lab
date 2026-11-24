-- Remove stale Number Guess times which came from unverified/too-short
-- client records. Only server-verified best times remain eligible for ranking.
with verified as (
  select user_id,game_id,mode,min(score)::bigint as best_time_ms
  from public.game_scores
  where game_id='bb466662-5423-48e6-bbcc-d19da50ba818'::uuid
    and mode like 'number-time-%'
    and metadata->>'serverVerified'='number-guess-v1'
    and score between 500 and 3600000
  group by user_id,game_id,mode
),
target as (
  select s.user_id,s.game_id,s.mode,v.best_time_ms
  from public.kuro_game_user_stats s
  left join verified v on v.user_id=s.user_id and v.game_id=s.game_id and v.mode=s.mode
  where s.game_id='bb466662-5423-48e6-bbcc-d19da50ba818'::uuid
    and s.mode like 'number-time-%'
)
update public.kuro_game_user_stats s
set best_time_ms=t.best_time_ms,
    best_score=null,
    metadata=(s.metadata - 'verifiedRanking' - 'rankingEligible') ||
      case when t.best_time_ms is not null then
        jsonb_build_object(
          'metric','clear_time_ms',
          'verifiedRanking','number-guess-v1',
          'serverVerified','number-guess-v1'
        )
      else
        jsonb_build_object('metric','completion','rankingEligible',false)
      end,
    updated_at=now()
from target t
where s.user_id=t.user_id and s.game_id=t.game_id and s.mode=t.mode;
