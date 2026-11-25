-- Persist a KURO GAMES notification only when the stored level actually increases.
-- XP ledger activity by itself does not create a notification.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_id_actor_id_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_recipient_id_actor_id_check
  CHECK ((type IN ('coin_reward', 'level_up')) OR (recipient_id <> actor_id));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'follow'::text,
    'follow_back'::text,
    'like'::text,
    'reply'::text,
    'message'::text,
    'mention'::text,
    'coin_reward'::text,
    'level_up'::text
  ]));

CREATE OR REPLACE FUNCTION private.kuro_notify_level_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous_level integer := 1;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A newly created level row can already represent a first-award level jump.
    IF NEW.current_level <= 1 THEN
      RETURN NEW;
    END IF;
  ELSE
    v_previous_level := greatest(coalesce(OLD.current_level, 1), 1);
    IF NEW.current_level <= v_previous_level THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    type,
    notification_details
  )
  VALUES (
    NEW.user_id,
    NEW.user_id,
    'level_up',
    jsonb_build_object(
      'fromLevel', v_previous_level,
      'toLevel', NEW.current_level,
      'source', 'kuro_level_system'
    )
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.kuro_notify_level_up() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS kuro_level_users_notify_level_up ON public.kuro_level_users;
CREATE TRIGGER kuro_level_users_notify_level_up
AFTER INSERT OR UPDATE OF current_level
ON public.kuro_level_users
FOR EACH ROW
EXECUTE FUNCTION private.kuro_notify_level_up();
