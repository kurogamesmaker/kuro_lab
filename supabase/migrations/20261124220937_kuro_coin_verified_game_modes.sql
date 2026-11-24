
CREATE TABLE IF NOT EXISTS public.kuro_coin_verified_game_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.game_studio_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode ~ '^[A-Za-z0-9_-]{1,40}$'),
  submission_id uuid NOT NULL,
  cpu_difficulty text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kuro_coin_verified_game_events_unique
    UNIQUE (game_id,user_id,mode,submission_id),
  CONSTRAINT kuro_coin_verified_game_events_cpu_check
    CHECK (cpu_difficulty IS NULL OR upper(cpu_difficulty) IN ('EASY','NORMAL','HARD','EXPERT'))
);

ALTER TABLE public.kuro_coin_verified_game_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kuro_coin_verified_game_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.kuro_coin_verified_game_events TO service_role;

DROP TRIGGER IF EXISTS enforce_temporary_account_suspension ON public.kuro_coin_verified_game_events;
CREATE TRIGGER enforce_temporary_account_suspension
BEFORE INSERT ON public.kuro_coin_verified_game_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_temporary_account_suspension();

CREATE OR REPLACE FUNCTION public.kuro_coin_award_from_verified_game_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.kuro_coin_award_game_win(
    NEW.user_id,
    NEW.game_id,
    NEW.mode,
    NEW.submission_id,
    NEW.cpu_difficulty
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_coin_award_from_verified_game_event() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS kuro_coin_reward_from_verified_game_event ON public.kuro_coin_verified_game_events;
CREATE TRIGGER kuro_coin_reward_from_verified_game_event
AFTER INSERT ON public.kuro_coin_verified_game_events
FOR EACH ROW EXECUTE FUNCTION public.kuro_coin_award_from_verified_game_event();

CREATE OR REPLACE FUNCTION public.kuro_coin_award_game_win(
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_submission_id uuid,
  p_cpu_difficulty text DEFAULT NULL
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
  v_cpu text := upper(coalesce(p_cpu_difficulty,''));
BEGIN
  IF p_user_id IS NULL OR p_game_id IS NULL OR p_submission_id IS NULL THEN
    RETURN false;
  END IF;

  -- Defense in depth: only server-verified modes can reach the reward engine.
  IF NOT (
    (
      p_game_id = '2dbd6773-2684-4f00-973e-c46acbc348e7'::uuid
      AND p_mode IN ('normal','vanish','gobble','reverse')
      AND v_cpu = 'HARD'
    )
    OR (
      p_game_id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
      AND p_mode = 'wins-online'
      AND v_cpu = ''
    )
    OR (
      p_game_id = '79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid
      AND p_mode IN ('easy','normal','hard')
      AND v_cpu = ''
    )
    OR (
      p_game_id = 'bb466662-5423-48e6-bbcc-d19da50ba818'::uuid
      AND p_mode IN ('number-classic-easy','number-time-easy','number-classic-normal','number-time-normal','number-classic-hard','number-time-hard','number-classic-expert','number-time-expert','number-classic-master','number-time-master','number-classic-legend','number-time-legend')
      AND v_cpu = ''
    )
    OR (
      p_game_id = '5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid
      AND p_mode IN ('normal_beginner','normal_intermediate','normal_advanced','sudden_beginner','sudden_intermediate','sudden_advanced','endless_beginner','endless_intermediate','endless_advanced')
      AND v_cpu = ''
    )
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_rule
  FROM public.kuro_coin_game_rewards
  WHERE game_id = p_game_id
    AND mode = p_mode
    AND enabled = true
    AND reward_amount > 0;

  IF NOT FOUND THEN RETURN false; END IF;

  IF v_rule.required_cpu_difficulty IS NOT NULL
     AND v_cpu <> v_rule.required_cpu_difficulty THEN
    RETURN false;
  END IF;

  INSERT INTO public.kuro_coin_balances(user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_balance
  FROM public.kuro_coin_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_balance := v_balance + v_rule.reward_amount;

  INSERT INTO public.kuro_coin_ledger(
    user_id, amount, balance_after, transaction_type,
    source_game_id, source_mode, source_submission_id,
    description, metadata
  ) VALUES (
    p_user_id, v_rule.reward_amount, v_new_balance, 'game_win_reward',
    p_game_id, p_mode, p_submission_id,
    v_rule.reward_label,
    jsonb_build_object('cpuDifficulty', v_cpu, 'source','verified-game-event')
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN RETURN false; END IF;

  UPDATE public.kuro_coin_balances
  SET balance = v_new_balance, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN true;
END;
$function$;

INSERT INTO public.kuro_coin_game_rewards
  (game_id,mode,reward_amount,enabled,required_cpu_difficulty,reward_label)
VALUES
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-easy',1,true,NULL,'数字当て（通常・easy）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-easy',2,true,NULL,'数字当て（タイムアタック・easy）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-normal',2,true,NULL,'数字当て（通常・normal）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-normal',3,true,NULL,'数字当て（タイムアタック・normal）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-hard',3,true,NULL,'数字当て（通常・hard）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-hard',4,true,NULL,'数字当て（タイムアタック・hard）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-expert',4,true,NULL,'数字当て（通常・expert）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-expert',5,true,NULL,'数字当て（タイムアタック・expert）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-master',5,true,NULL,'数字当て（通常・master）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-master',6,true,NULL,'数字当て（タイムアタック・master）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-classic-legend',6,true,NULL,'数字当て（通常・legend）クリア'),
  ('bb466662-5423-48e6-bbcc-d19da50ba818'::uuid,'number-time-legend',7,true,NULL,'数字当て（タイムアタック・legend）クリア'),
  ('79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid,'easy',2,true,NULL,'素因数分解（easy）クリア'),
  ('79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid,'normal',3,true,NULL,'素因数分解（normal）クリア'),
  ('79c9921a-d57a-45b1-8271-1ee7042801dc'::uuid,'hard',5,true,NULL,'素因数分解（hard）クリア'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'normal_beginner',1,true,NULL,'回転ずしタイピング（normal・beginner）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'normal_intermediate',2,true,NULL,'回転ずしタイピング（normal・intermediate）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'normal_advanced',3,true,NULL,'回転ずしタイピング（normal・advanced）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'sudden_beginner',1,true,NULL,'回転ずしタイピング（sudden・beginner）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'sudden_intermediate',2,true,NULL,'回転ずしタイピング（sudden・intermediate）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'sudden_advanced',3,true,NULL,'回転ずしタイピング（sudden・advanced）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'endless_beginner',2,true,NULL,'回転ずしタイピング（endless・beginner）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'endless_intermediate',3,true,NULL,'回転ずしタイピング（endless・intermediate）完了'),
  ('5c1e658b-f6d3-412a-8b97-61d2c0457e95'::uuid,'endless_advanced',4,true,NULL,'回転ずしタイピング（endless・advanced）完了')
ON CONFLICT (game_id,mode) DO NOTHING;
