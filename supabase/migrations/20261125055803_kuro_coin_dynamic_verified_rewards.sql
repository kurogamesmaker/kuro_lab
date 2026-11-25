-- Allow coin_reward notifications to use the recipient as their own actor.
-- The older notifications_no_self constraint contradicted the explicit
-- coin_reward exception in notifications_recipient_id_actor_id_check.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_no_self;

-- Reward eligibility is driven by an Admin-configured mode row plus a
-- trusted server-written verification event. This removes the per-game ID
-- allowlist, which otherwise required a database code edit for every game.
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
  v_cpu_key text := coalesce(nullif(upper(coalesce(p_cpu_difficulty,'')),''),'NONE');
  v_verified_score integer;
  v_reward_amount integer;
  v_reward_metadata jsonb := '{}'::jsonb;
  v_score_tier jsonb;
  v_score_unit integer;
  v_score_points integer;
BEGIN
  IF p_user_id IS NULL OR p_game_id IS NULL OR p_submission_id IS NULL
     OR p_mode IS NULL OR p_mode !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RETURN false;
  END IF;

  -- Only a trusted server path can write verification events:
  -- anon/authenticated have no INSERT privilege on the verified event tables.
  SELECT *
    INTO v_rule
  FROM public.kuro_coin_game_rewards
  WHERE game_id = p_game_id
    AND mode = p_mode
    AND required_cpu_difficulty = v_cpu_key
    AND enabled = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_rule.reward_type IN ('score_tier','score_ratio') THEN
    SELECT e.verified_score
      INTO v_verified_score
    FROM public.kuro_coin_verified_game_events e
    WHERE e.game_id = p_game_id
      AND e.user_id = p_user_id
      AND e.mode = p_mode
      AND e.submission_id = p_submission_id
    LIMIT 1;

    IF v_verified_score IS NULL OR jsonb_typeof(v_rule.score_tiers) <> 'array' THEN
      RETURN false;
    END IF;

    IF v_rule.reward_type = 'score_ratio' THEN
      v_score_unit := coalesce(nullif(v_rule.score_tiers->0->>'minScore','')::integer,0);
      v_score_points := coalesce(nullif(v_rule.score_tiers->0->>'rewardAmount','')::integer,0);

      IF v_score_unit < 1 OR v_score_points < 1 OR v_score_points > 1000 THEN
        RETURN false;
      END IF;

      v_reward_amount := floor(v_verified_score::numeric / v_score_unit)::integer * v_score_points;
      IF v_reward_amount <= 0 OR v_reward_amount > 1000 THEN
        RETURN false;
      END IF;

      v_reward_metadata := jsonb_build_object(
        'verifiedScore',v_verified_score,
        'scoreUnit',v_score_unit,
        'scorePoints',v_score_points,
        'rewardType','score_ratio'
      );
    ELSE
      SELECT x.tier
        INTO v_score_tier
      FROM jsonb_array_elements(v_rule.score_tiers) AS x(tier)
      WHERE coalesce((x.tier->>'enabled')::boolean,true)
        AND v_verified_score >= coalesce(nullif(x.tier->>'minScore','')::integer,0)
        AND (
          nullif(x.tier->>'maxScore','') IS NULL
          OR v_verified_score <= (x.tier->>'maxScore')::integer
        )
      ORDER BY coalesce(nullif(x.tier->>'minScore','')::integer,0) DESC
      LIMIT 1;

      IF v_score_tier IS NULL THEN
        RETURN false;
      END IF;

      v_reward_amount := coalesce((v_score_tier->>'rewardAmount')::integer,0);
      IF v_reward_amount <= 0 OR v_reward_amount > 1000 THEN
        RETURN false;
      END IF;

      v_reward_metadata := jsonb_build_object(
        'verifiedScore',v_verified_score,
        'scoreTier',v_score_tier,
        'rewardType','score_tier'
      );
    END IF;
  ELSE
    v_reward_amount := v_rule.reward_amount;
    IF v_reward_amount <= 0 OR v_reward_amount > 1000 THEN
      RETURN false;
    END IF;
    v_reward_metadata := jsonb_build_object('rewardType','fixed');
  END IF;

  INSERT INTO public.kuro_coin_balances(user_id,balance)
  VALUES(p_user_id,0)
  ON CONFLICT(user_id) DO NOTHING;

  SELECT balance
    INTO v_balance
  FROM public.kuro_coin_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_balance := v_balance + v_reward_amount;

  INSERT INTO public.kuro_coin_ledger(
    user_id,amount,balance_after,transaction_type,
    source_game_id,source_mode,source_submission_id,description,metadata
  )
  VALUES(
    p_user_id,v_reward_amount,v_new_balance,'game_win_reward',
    p_game_id,p_mode,p_submission_id,
    CASE
      WHEN v_rule.reward_type IN ('score_tier','score_ratio')
        THEN coalesce(nullif(v_rule.reward_label,''),'スコア報酬') || '（' || v_verified_score::text || '点）'
      ELSE v_rule.reward_label
    END,
    jsonb_build_object('cpuDifficulty',v_cpu_key,'source','verified-game-event') || v_reward_metadata
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
