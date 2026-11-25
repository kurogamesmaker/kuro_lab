-- Restrict KURO COIN game rewards to server-verified online match victories.
-- Reuse the existing KURO COIN balance, ledger, game reward settings and notification trigger.
BEGIN;

-- Turn off all legacy CPU, solo, time-attack and other non-online reward rules.
UPDATE public.kuro_coin_game_rewards
SET enabled = false,
    updated_at = now()
WHERE NOT (
  (
    game_id IN (
      'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
      '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid
    )
    AND mode = 'wins-online'
    AND required_cpu_difficulty = 'NONE'
  )
  OR (
    game_id = '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
    AND mode = 'online'
    AND required_cpu_difficulty = 'NONE'
  )
);

-- Online win rewards are fixed payouts, not score- or completion-based rewards.
UPDATE public.kuro_coin_game_rewards
SET reward_type = 'fixed',
    score_tiers = '[]'::jsonb,
    updated_at = now()
WHERE (
  (
    game_id IN (
      'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
      '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid
    )
    AND mode = 'wins-online'
    AND required_cpu_difficulty = 'NONE'
  )
  OR (
    game_id = '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
    AND mode = 'online'
    AND required_cpu_difficulty = 'NONE'
  )
);

-- Add a disabled Daifugo online-win rule because its verified win event already exists.
INSERT INTO public.kuro_coin_game_rewards
  (game_id, mode, reward_amount, enabled, required_cpu_difficulty, reward_label, reward_type, score_tiers)
VALUES
  (
    '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid,
    'wins-online',
    0,
    false,
    'NONE',
    '大富豪 オンライン勝利報酬',
    'fixed',
    '[]'::jsonb
  )
ON CONFLICT (game_id, mode, required_cpu_difficulty) DO NOTHING;

-- Final award gate:
-- only trusted online winner events from UNON, Daifugo and Seven Stars may award KC.
-- The ledger's existing unique index continues to prevent duplicate awards.
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

COMMIT;
