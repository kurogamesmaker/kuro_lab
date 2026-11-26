-- Expose microsecond-level best times in the shared public profile without
-- changing the return shape of the legacy profile stats RPC.
create or replace function public.kuro_get_public_profile_game_stats_precise(p_user_id uuid)
returns table(
  game_id uuid,
  game_title text,
  game_icon text,
  mode text,
  plays bigint,
  wins bigint,
  losses bigint,
  draws bigint,
  best_score bigint,
  best_time_ms bigint,
  best_time_us bigint,
  total_time_ms bigint,
  last_played_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    s.game_id,
    g.title as game_title,
    case
      when g.icon ~* '^data:image/(png|webp|jpeg|gif);base64,' then null
      else g.icon
    end as game_icon,
    s.mode,
    coalesce(s.plays, 0)::bigint,
    coalesce(s.wins, 0)::bigint,
    coalesce(s.losses, 0)::bigint,
    coalesce(s.draws, 0)::bigint,
    s.best_score,
    s.best_time_ms,
    s.best_time_us,
    s.total_time_ms,
    s.last_played_at
  from public.kuro_game_user_stats s
  join public.game_studio_games g
    on g.id = s.game_id
   and g.status = 'published'
  where p_user_id is not null
    and s.user_id = p_user_id
    and coalesce(s.metadata->>'internalRankingMode','false') <> 'true'
    and exists (
      select 1 from public.profiles p where p.id = p_user_id
    )
    and (
      coalesce(s.plays, 0) > 0
      or coalesce(s.wins, 0) > 0
      or coalesce(s.losses, 0) > 0
      or coalesce(s.draws, 0) > 0
      or s.best_score is not null
      or s.best_time_ms is not null
      or s.best_time_us is not null
    )
  order by g.title asc, s.mode asc;
$function$;

grant execute on function public.kuro_get_public_profile_game_stats_precise(uuid) to anon, authenticated, service_role;
