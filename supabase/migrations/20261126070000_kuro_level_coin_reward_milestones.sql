-- KURO GAMES level milestone rewards paid in shared KURO COIN.
-- Rewards are granted only when a level is first crossed after a rule is active.
-- A unique claim per (user, level) prevents duplicate payments on retries or re-leveling.

CREATE TABLE IF NOT EXISTS public.kuro_level_coin_rewards (
  level integer PRIMARY KEY CHECK (level BETWEEN 2 AND 10000),
  reward_amount integer NOT NULL DEFAULT 0 CHECK (reward_amount BETWEEN 0 AND 1000000),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (NOT enabled OR reward_amount > 0)
);

CREATE TABLE IF NOT EXISTS public.kuro_level_coin_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level BETWEEN 2 AND 10000),
  reward_amount integer NOT NULL CHECK (reward_amount > 0 AND reward_amount <= 1000000),
  balance_after bigint NOT NULL DEFAULT 0 CHECK (balance_after >= 0),
  coin_ledger_id uuid REFERENCES public.kuro_coin_ledger(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, level)
);

CREATE INDEX IF NOT EXISTS kuro_level_coin_reward_claims_user_recent_idx
  ON public.kuro_level_coin_reward_claims(user_id, created_at DESC);

ALTER TABLE public.kuro_level_coin_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kuro_level_coin_reward_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kuro_level_coin_rewards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kuro_level_coin_reward_claims FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.kuro_level_coin_rewards TO service_role;

ALTER TABLE public.kuro_coin_ledger
  DROP CONSTRAINT IF EXISTS kuro_coin_ledger_transaction_type_check;
ALTER TABLE public.kuro_coin_ledger
  ADD CONSTRAINT kuro_coin_ledger_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'game_win_reward'::text,
    'admin_adjustment'::text,
    'shop_purchase'::text,
    'shop_refund'::text,
    'level_reward'::text
  ]));

CREATE OR REPLACE FUNCTION private.kuro_level_coin_reward_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous_level integer := 0;
  v_reward record;
  v_claim_id uuid;
  v_balance bigint;
  v_new_balance bigint;
  v_ledger_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_previous_level := 1;
  ELSE
    v_previous_level := greatest(coalesce(OLD.current_level, 1), 1);
    IF NEW.current_level <= v_previous_level THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR v_reward IN
    SELECT r.level, r.reward_amount
    FROM public.kuro_level_coin_rewards r
    WHERE r.enabled = true
      AND r.reward_amount > 0
      AND r.level > v_previous_level
      AND r.level <= NEW.current_level
    ORDER BY r.level
  LOOP
    INSERT INTO public.kuro_level_coin_reward_claims (
      user_id, level, reward_amount
    )
    VALUES (
      NEW.user_id, v_reward.level, v_reward.reward_amount
    )
    ON CONFLICT (user_id, level) DO NOTHING
    RETURNING id INTO v_claim_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.kuro_coin_balances(user_id, balance)
    VALUES (NEW.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT b.balance
      INTO v_balance
    FROM public.kuro_coin_balances b
    WHERE b.user_id = NEW.user_id
    FOR UPDATE;

    v_new_balance := v_balance + v_reward.reward_amount;

    INSERT INTO public.kuro_coin_ledger (
      user_id, amount, balance_after, transaction_type,
      description, metadata
    )
    VALUES (
      NEW.user_id,
      v_reward.reward_amount,
      v_new_balance,
      'level_reward',
      'レベル到達報酬：Lv.' || v_reward.level::text,
      jsonb_build_object(
        'source', 'kuro_level_milestone',
        'level', v_reward.level,
        'claimId', v_claim_id
      )
    )
    RETURNING id INTO v_ledger_id;

    UPDATE public.kuro_coin_balances
    SET balance = v_new_balance, updated_at = pg_catalog.now()
    WHERE user_id = NEW.user_id;

    UPDATE public.kuro_level_coin_reward_claims
    SET balance_after = v_new_balance, coin_ledger_id = v_ledger_id
    WHERE id = v_claim_id;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.kuro_level_coin_reward_on_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS kuro_level_users_coin_milestone_reward
  ON public.kuro_level_users;
CREATE TRIGGER kuro_level_users_coin_milestone_reward
AFTER INSERT OR UPDATE OF current_level
ON public.kuro_level_users
FOR EACH ROW
EXECUTE FUNCTION private.kuro_level_coin_reward_on_change();

CREATE OR REPLACE FUNCTION public.kuro_level_coin_rewards_replace(
  p_rewards jsonb,
  p_actor_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_level integer;
  v_amount integer;
  v_enabled boolean;
  v_levels integer[] := ARRAY[]::integer[];
  v_count integer := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  IF p_rewards IS NULL OR jsonb_typeof(p_rewards) <> 'array'
     OR jsonb_array_length(p_rewards) > 100 THEN
    RAISE EXCEPTION 'INVALID_LEVEL_COIN_REWARDS';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rewards)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item->'level') <> 'number'
       OR jsonb_typeof(v_item->'rewardAmount') <> 'number'
       OR jsonb_typeof(v_item->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_LEVEL_COIN_REWARD_ROW';
    END IF;

    v_level := (v_item->>'level')::integer;
    v_amount := (v_item->>'rewardAmount')::integer;
    v_enabled := (v_item->>'enabled')::boolean;

    IF v_level < 2 OR v_level > 10000
       OR v_amount < 0 OR v_amount > 1000000
       OR (v_enabled AND v_amount = 0)
       OR v_level = ANY(v_levels) THEN
      RAISE EXCEPTION 'INVALID_LEVEL_COIN_REWARD_VALUE';
    END IF;

    v_levels := array_append(v_levels, v_level);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.kuro_level_coin_rewards r
  WHERE NOT (r.level = ANY(v_levels));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rewards)
  LOOP
    v_level := (v_item->>'level')::integer;
    v_amount := (v_item->>'rewardAmount')::integer;
    v_enabled := (v_item->>'enabled')::boolean;

    INSERT INTO public.kuro_level_coin_rewards (
      level, reward_amount, enabled, updated_at, updated_by
    )
    VALUES (
      v_level, v_amount, v_enabled, pg_catalog.now(), p_actor_user_id
    )
    ON CONFLICT (level) DO UPDATE
    SET reward_amount = EXCLUDED.reward_amount,
        enabled = EXCLUDED.enabled,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_level_coin_rewards_replace(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kuro_level_coin_rewards_replace(jsonb, uuid)
  TO service_role;

COMMENT ON TABLE public.kuro_level_coin_rewards IS
  'KURO GAMES: Admin-configured one-time shared KURO COIN reward for first crossing a level.';
COMMENT ON TABLE public.kuro_level_coin_reward_claims IS
  'Immutable idempotency and audit record for each user-level milestone reward.';
