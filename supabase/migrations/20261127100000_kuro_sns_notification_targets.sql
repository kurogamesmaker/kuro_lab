-- Persist the exact post/reply target on SNS notifications so the shared notification
-- box and push/deep links can always open the originating content.

CREATE OR REPLACE FUNCTION public.kuro_notify_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  post_owner_id uuid;
BEGIN
  SELECT p.user_id INTO post_owner_id
  FROM public.posts AS p
  WHERE p.id = NEW.post_id;

  IF post_owner_id IS NOT NULL
     AND post_owner_id <> NEW.user_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      notification_details
    )
    VALUES (
      post_owner_id,
      NEW.user_id,
      'like',
      jsonb_build_object(
        'post_id', NEW.post_id,
        'source', 'post_like'
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_notify_post_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  post_owner_id uuid;
BEGIN
  SELECT p.user_id INTO post_owner_id
  FROM public.posts AS p
  WHERE p.id = NEW.post_id;

  IF post_owner_id IS NOT NULL
     AND post_owner_id <> NEW.user_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      notification_details
    )
    VALUES (
      post_owner_id,
      NEW.user_id,
      'reply',
      jsonb_build_object(
        'post_id', NEW.post_id,
        'reply_id', NEW.id,
        'source', 'post_reply'
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill targets for older notifications when the originating interaction
-- still exists. The trigger inserts both rows in the same transaction, so
-- their timestamps normally match; a small window tolerates timestamp precision.
WITH candidates AS (
  SELECT
    n.id AS notification_id,
    interaction.post_id,
    interaction.reply_id
  FROM public.notifications AS n
  CROSS JOIN LATERAL (
    SELECT
      pl.post_id,
      NULL::uuid AS reply_id,
      pl.created_at
    FROM public.post_likes AS pl
    JOIN public.posts AS p ON p.id = pl.post_id
    WHERE n.type = 'like'
      AND pl.user_id = n.actor_id
      AND p.user_id = n.recipient_id
      AND abs(extract(epoch FROM (pl.created_at - n.created_at))) <= 5
    ORDER BY abs(extract(epoch FROM (pl.created_at - n.created_at))), pl.created_at DESC
    LIMIT 1
  ) AS interaction
  WHERE n.type = 'like'
    AND n.notification_details = '{}'::jsonb

  UNION ALL

  SELECT
    n.id AS notification_id,
    interaction.post_id,
    interaction.reply_id
  FROM public.notifications AS n
  CROSS JOIN LATERAL (
    SELECT
      pr.post_id,
      pr.id AS reply_id,
      pr.created_at
    FROM public.post_replies AS pr
    JOIN public.posts AS p ON p.id = pr.post_id
    WHERE n.type = 'reply'
      AND pr.user_id = n.actor_id
      AND p.user_id = n.recipient_id
      AND abs(extract(epoch FROM (pr.created_at - n.created_at))) <= 5
    ORDER BY abs(extract(epoch FROM (pr.created_at - n.created_at))), pr.created_at DESC
    LIMIT 1
  ) AS interaction
  WHERE n.type = 'reply'
    AND n.notification_details = '{}'::jsonb
)
UPDATE public.notifications AS n
SET notification_details = jsonb_strip_nulls(jsonb_build_object(
  'post_id', c.post_id,
  'reply_id', c.reply_id,
  'source', CASE WHEN n.type = 'like' THEN 'post_like' ELSE 'post_reply' END
))
FROM candidates AS c
WHERE n.id = c.notification_id
  AND n.notification_details = '{}'::jsonb;
