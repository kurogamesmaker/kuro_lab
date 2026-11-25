-- Add server-verified Werewolf online match wins to the existing KURO COIN reward flow.
-- The authoritative Werewolf DB action writes score rows with source=server-validated-werewolf.
BEGIN;

INSERT INTO public.kuro_coin_game_rewards
  (game_id, mode, reward_amount, enabled, required_cpu_difficulty, reward_label, reward_type, score_tiers)
VALUES
  ('903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid,'werewolf_villager_wins',0,false,'NONE','人狼ゲーム 村人陣営オンライン勝利報酬','fixed','[]'::jsonb),
  ('903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid,'werewolf_wolf_wins',0,false,'NONE','人狼ゲーム 人狼陣営オンライン勝利報酬','fixed','[]'::jsonb)
ON CONFLICT (game_id, mode, required_cpu_difficulty) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kuro_coin_award_game_win(
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_submission_id uuid,
  p_cpu_difficulty text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_rule public.kuro_coin_game_rewards%rowtype;
  v_balance bigint;
  v_new_balance bigint;
  v_ledger_id uuid;
  v_cpu_key text := coalesce(nullif(upper(coalesce(p_cpu_difficulty, '')), ''), 'NONE');
BEGIN
  IF p_user_id IS NULL OR p_game_id IS NULL OR p_submission_id IS NULL
     OR p_mode IS NULL OR p_mode !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RETURN false;
  END IF;

  IF NOT (
    (
      p_game_id IN (
        'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
        '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid
      )
      AND p_mode = 'wins-online'
      AND v_cpu_key = 'NONE'
    )
    OR (
      p_game_id = '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
      AND p_mode = 'online'
      AND v_cpu_key = 'NONE'
    )
    OR (
      p_game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
      AND p_mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
      AND v_cpu_key = 'NONE'
    )
  ) THEN
    RETURN false;
  END IF;

  SELECT *
    INTO v_rule
  FROM public.kuro_coin_game_rewards
  WHERE game_id = p_game_id
    AND mode = p_mode
    AND required_cpu_difficulty = v_cpu_key
    AND enabled = true;

  IF NOT FOUND OR v_rule.reward_type <> 'fixed'
     OR v_rule.reward_amount <= 0 OR v_rule.reward_amount > 1000 THEN
    RETURN false;
  END IF;

  INSERT INTO public.kuro_coin_balances(user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance
    INTO v_balance
  FROM public.kuro_coin_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_balance := v_balance + v_rule.reward_amount;

  INSERT INTO public.kuro_coin_ledger(
    user_id, amount, balance_after, transaction_type,
    source_game_id, source_mode, source_submission_id,
    description, metadata
  )
  VALUES (
    p_user_id, v_rule.reward_amount, v_new_balance, 'game_win_reward',
    p_game_id, p_mode, p_submission_id,
    v_rule.reward_label,
    jsonb_build_object(
      'cpuDifficulty', v_cpu_key,
      'source', 'verified-online-win',
      'rewardType', 'fixed'
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.kuro_coin_balances
  SET balance = v_new_balance, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_coin_award_game_win(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kuro_coin_award_from_verified_werewolf_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
     AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
     AND NEW.score = 1
     AND NEW.metadata->>'source' = 'server-validated-werewolf' THEN
    PERFORM public.kuro_coin_award_game_win(
      NEW.user_id, NEW.game_id, NEW.mode, NEW.submission_id, NEW.cpu_difficulty
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_coin_award_from_verified_werewolf_score()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS kuro_coin_reward_from_verified_werewolf_score ON public.game_scores;
CREATE TRIGGER kuro_coin_reward_from_verified_werewolf_score
AFTER INSERT ON public.game_scores
FOR EACH ROW
WHEN (
  NEW.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
  AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
  AND NEW.score = 1
  AND NEW.metadata->>'source' = 'server-validated-werewolf'
)
EXECUTE FUNCTION public.kuro_coin_award_from_verified_werewolf_score();

COMMIT;
