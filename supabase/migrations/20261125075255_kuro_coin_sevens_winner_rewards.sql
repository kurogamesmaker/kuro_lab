-- Seven Stars final placement is calculated and persisted by trusted server-side RPCs.
-- Award only the winner; use room_id as the idempotent submission key.
CREATE OR REPLACE FUNCTION public.kuro_coin_reward_from_sevens_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.placement <> 1 THEN RETURN NEW; END IF;
  INSERT INTO public.kuro_coin_verified_game_events(
    game_id,user_id,mode,submission_id,cpu_difficulty,verified_score
  )
  VALUES(NEW.game_id,NEW.user_id,'online',NEW.room_id,NULL,NULL)
  ON CONFLICT (game_id,user_id,mode,submission_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_coin_reward_from_sevens_result() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kuro_coin_reward_from_sevens_result() FROM anon,authenticated,service_role;

DROP TRIGGER IF EXISTS kuro_coin_reward_from_sevens_winner ON public.game_sevens_results;
CREATE TRIGGER kuro_coin_reward_from_sevens_winner
AFTER INSERT ON public.game_sevens_results
FOR EACH ROW
WHEN (NEW.placement = 1)
EXECUTE FUNCTION public.kuro_coin_reward_from_sevens_result();

INSERT INTO public.kuro_coin_game_rewards(
  game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label,reward_type,score_tiers
)
VALUES(
  '4ccccb72-d5db-4098-a7d4-1c28a0755e7b','online',5,true,'NONE',
  '七並べ オンライン1位報酬','fixed','[]'::jsonb
)
ON CONFLICT (game_id,mode,required_cpu_difficulty) DO NOTHING;
