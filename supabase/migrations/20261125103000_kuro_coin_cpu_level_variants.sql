-- KURO COIN: separate reward rules for each server-verified CPU difficulty.
-- Existing non-CPU rewards are retained using the NONE sentinel.

ALTER TABLE public.kuro_coin_game_rewards
  DROP CONSTRAINT IF EXISTS kuro_coin_game_rewards_pkey;
ALTER TABLE public.kuro_coin_game_rewards
  DROP CONSTRAINT IF EXISTS kuro_coin_game_rewards_required_cpu_difficulty_check;

ALTER TABLE public.kuro_coin_game_rewards
  ADD CONSTRAINT kuro_coin_game_rewards_required_cpu_difficulty_check
  CHECK (required_cpu_difficulty IS NULL OR required_cpu_difficulty IN ('NONE','EASY','NORMAL','HARD','EXPERT'));

UPDATE public.kuro_coin_game_rewards
SET required_cpu_difficulty='NONE'
WHERE required_cpu_difficulty IS NULL;

ALTER TABLE public.kuro_coin_game_rewards
  ALTER COLUMN required_cpu_difficulty SET DEFAULT 'NONE',
  ALTER COLUMN required_cpu_difficulty SET NOT NULL;

ALTER TABLE public.kuro_coin_game_rewards
  DROP CONSTRAINT IF EXISTS kuro_coin_game_rewards_required_cpu_difficulty_check;
ALTER TABLE public.kuro_coin_game_rewards
  ADD CONSTRAINT kuro_coin_game_rewards_required_cpu_difficulty_check
  CHECK (required_cpu_difficulty IN ('NONE','EASY','NORMAL','HARD','EXPERT'));

ALTER TABLE public.kuro_coin_game_rewards
  ADD CONSTRAINT kuro_coin_game_rewards_pkey
  PRIMARY KEY (game_id,mode,required_cpu_difficulty);

INSERT INTO public.kuro_coin_game_rewards
  (game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label,reward_type,score_tiers)
SELECT '2dbd6773-2684-4f00-973e-c46acbc348e7'::uuid,mode,0,false,cpu,'ゲーム勝利報酬','fixed','[]'::jsonb
FROM (VALUES
  ('normal','EASY'),('normal','NORMAL'),('vanish','EASY'),('vanish','NORMAL'),
  ('gobble','EASY'),('gobble','NORMAL'),('reverse','EASY'),('reverse','NORMAL')
) AS v(mode,cpu)
ON CONFLICT (game_id,mode,required_cpu_difficulty) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kuro_coin_award_from_verified_tictactoe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.result = 'win' THEN
    PERFORM public.kuro_coin_award_game_win(
      NEW.user_id, NEW.game_id, NEW.rule, NEW.submission_id, NEW.cpu_difficulty
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_coin_award_game_win(
  p_user_id uuid,p_game_id uuid,p_mode text,p_submission_id uuid,p_cpu_difficulty text DEFAULT NULL::text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_rule public.kuro_coin_game_rewards%rowtype;
  v_balance bigint;
  v_new_balance bigint;
  v_ledger_id uuid;
  v_cpu text := upper(coalesce(p_cpu_difficulty,''));
  v_cpu_key text := coalesce(nullif(upper(coalesce(p_cpu_difficulty,'')),''),'NONE');
  v_verified_score integer;
  v_reward_amount integer;
  v_reward_metadata jsonb := '{}'::jsonb;
  v_score_tier jsonb;
BEGIN
  IF p_user_id IS NULL OR p_game_id IS NULL OR p_submission_id IS NULL THEN RETURN false; END IF;

  IF NOT (
    (p_game_id='2dbd6773-2684-4f00-973e-c46acbc348e7'::uuid AND p_mode IN ('normal','vanish','gobble','reverse') AND v_cpu IN ('EASY','NORMAL','HARD'))
    OR (p_game_id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid AND p_mode='wins-online' AND v_cpu='')
    OR (p_game_id='79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid AND p_mode IN ('easy','normal','hard') AND v_cpu='')
    OR (p_game_id='bb466662-5423-48e6-bbcc-d19da50ba818'::uuid AND p_mode IN ('number-classic-easy','number-time-easy','number-classic-normal','number-time-normal','number-classic-hard','number-time-hard','number-classic-expert','number-time-expert','number-classic-master','number-time-master','number-classic-legend','number-time-legend') AND v_cpu='')
    OR (p_game_id='5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid AND p_mode IN ('normal_beginner','normal_intermediate','normal_advanced','sudden_beginner','sudden_intermediate','sudden_advanced','endless_beginner','endless_intermediate','endless_advanced') AND v_cpu='')
  ) THEN RETURN false; END IF;

  SELECT * INTO v_rule FROM public.kuro_coin_game_rewards
  WHERE game_id=p_game_id AND mode=p_mode AND required_cpu_difficulty=v_cpu_key AND enabled=true;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_rule.reward_type='score_tier' THEN
    IF p_game_id NOT IN ('79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid,'5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid) THEN RETURN false; END IF;
    SELECT e.verified_score INTO v_verified_score FROM public.kuro_coin_verified_game_events e
    WHERE e.game_id=p_game_id AND e.user_id=p_user_id AND e.mode=p_mode AND e.submission_id=p_submission_id LIMIT 1;
    IF v_verified_score IS NULL OR jsonb_typeof(v_rule.score_tiers)<>'array' THEN RETURN false; END IF;
    SELECT x.tier INTO v_score_tier FROM jsonb_array_elements(v_rule.score_tiers) AS x(tier)
    WHERE coalesce((x.tier->>'enabled')::boolean,true)
      AND v_verified_score>=coalesce(nullif(x.tier->>'minScore','')::integer,0)
      AND (nullif(x.tier->>'maxScore','') IS NULL OR v_verified_score<=(x.tier->>'maxScore')::integer)
    ORDER BY coalesce(nullif(x.tier->>'minScore','')::integer,0) DESC LIMIT 1;
    IF v_score_tier IS NULL THEN RETURN false; END IF;
    v_reward_amount:=coalesce((v_score_tier->>'rewardAmount')::integer,0);
    IF v_reward_amount<=0 OR v_reward_amount>1000 THEN RETURN false; END IF;
    v_reward_metadata:=jsonb_build_object('verifiedScore',v_verified_score,'scoreTier',v_score_tier,'rewardType','score_tier');
  ELSE
    v_reward_amount:=v_rule.reward_amount;
    IF v_reward_amount<=0 OR v_reward_amount>1000 THEN RETURN false; END IF;
    v_reward_metadata:=jsonb_build_object('rewardType','fixed');
  END IF;

  INSERT INTO public.kuro_coin_balances(user_id,balance) VALUES(p_user_id,0) ON CONFLICT(user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM public.kuro_coin_balances WHERE user_id=p_user_id FOR UPDATE;
  v_new_balance:=v_balance+v_reward_amount;

  INSERT INTO public.kuro_coin_ledger(user_id,amount,balance_after,transaction_type,source_game_id,source_mode,source_submission_id,description,metadata)
  VALUES(
    p_user_id,v_reward_amount,v_new_balance,'game_win_reward',p_game_id,p_mode,p_submission_id,
    CASE WHEN v_rule.reward_type='score_tier' THEN coalesce(nullif(v_rule.reward_label,''),'スコア報酬')||'（'||v_verified_score::text||'点）' ELSE v_rule.reward_label END,
    jsonb_build_object('cpuDifficulty',v_cpu_key,'source','verified-game-event')||v_reward_metadata
  )
  ON CONFLICT DO NOTHING RETURNING id INTO v_ledger_id;
  IF v_ledger_id IS NULL THEN RETURN false; END IF;
  UPDATE public.kuro_coin_balances SET balance=v_new_balance,updated_at=now() WHERE user_id=p_user_id;
  RETURN true;
END;
$function$;
