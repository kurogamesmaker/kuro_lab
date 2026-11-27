-- Add reply threading to KURO SNS without changing the existing post reply API.
ALTER TABLE public.post_replies
  ADD COLUMN IF NOT EXISTS parent_reply_id uuid;

-- Composite target prevents replies from pointing at a reply belonging to another post.
ALTER TABLE public.post_replies
  ADD CONSTRAINT post_replies_id_post_id_unique UNIQUE (id, post_id);

ALTER TABLE public.post_replies
  ADD CONSTRAINT post_replies_parent_same_post_fkey
  FOREIGN KEY (parent_reply_id, post_id)
  REFERENCES public.post_replies (id, post_id)
  ON DELETE CASCADE;

ALTER TABLE public.post_replies
  ADD CONSTRAINT post_replies_parent_not_self_check
  CHECK (parent_reply_id IS NULL OR parent_reply_id <> id);

CREATE INDEX IF NOT EXISTS post_replies_post_parent_created_idx
  ON public.post_replies (post_id, parent_reply_id, created_at);

-- Keep post-author notifications, and also notify the author of the reply being answered.
-- If both users are the same, the post-author notification is the only notification created.
CREATE OR REPLACE FUNCTION public.kuro_notify_post_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  post_owner_id uuid;
  parent_owner_id uuid;
  reply_source text;
BEGIN
  SELECT p.user_id
    INTO post_owner_id
  FROM public.posts AS p
  WHERE p.id = NEW.post_id;

  IF NEW.parent_reply_id IS NOT NULL THEN
    SELECT parent_reply.user_id
      INTO parent_owner_id
    FROM public.post_replies AS parent_reply
    WHERE parent_reply.id = NEW.parent_reply_id
      AND parent_reply.post_id = NEW.post_id;
  END IF;

  reply_source := CASE
    WHEN NEW.parent_reply_id IS NULL THEN 'post_reply'
    ELSE 'reply_to_reply'
  END;

  IF post_owner_id IS NOT NULL AND post_owner_id <> NEW.user_id THEN
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
      jsonb_strip_nulls(jsonb_build_object(
        'post_id', NEW.post_id,
        'reply_id', NEW.id,
        'parent_reply_id', NEW.parent_reply_id,
        'source', reply_source
      ))
    );
  END IF;

  IF parent_owner_id IS NOT NULL
     AND parent_owner_id <> NEW.user_id
     AND parent_owner_id IS DISTINCT FROM post_owner_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      notification_details
    )
    VALUES (
      parent_owner_id,
      NEW.user_id,
      'reply',
      jsonb_strip_nulls(jsonb_build_object(
        'post_id', NEW.post_id,
        'reply_id', NEW.id,
        'parent_reply_id', NEW.parent_reply_id,
        'source', 'reply_to_reply'
      ))
    );
  END IF;

  RETURN NEW;
END;
$function$;
