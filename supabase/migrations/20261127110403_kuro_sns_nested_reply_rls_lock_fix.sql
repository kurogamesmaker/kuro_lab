-- Fix nested SNS reply creation under the current RLS policies.
-- A SELECT ... FOR KEY SHARE is filtered for authenticated callers because
-- post_replies has no UPDATE policy. Check parent visibility with a normal
-- SELECT and rely on the composite FK (parent_reply_id, post_id) ->
-- post_replies(id, post_id) for atomic parent/post integrity at INSERT time.
CREATE OR REPLACE FUNCTION public.kuro_create_post_reply(
  p_post_id uuid,
  p_content text,
  p_parent_reply_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''));
  v_reply_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ログイン状態を確認できません。再ログインしてください。'
      USING ERRCODE = '42501';
  END IF;

  IF p_post_id IS NULL THEN
    RAISE EXCEPTION '投稿を確認できません。ページを更新してください。'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_content) < 1 OR char_length(v_content) > 130 THEN
    RAISE EXCEPTION '返信は1〜130文字で入力してください。'
      USING ERRCODE = '22023';
  END IF;

  IF p_parent_reply_id IS NOT NULL THEN
    PERFORM 1
    FROM public.post_replies AS parent
    WHERE parent.id = p_parent_reply_id
      AND parent.post_id = p_post_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '返信先のコメントが存在しないか、別の投稿に属しています。'
        USING ERRCODE = '23503',
              DETAIL = 'The selected parent reply was not found for this post.';
    END IF;
  END IF;

  INSERT INTO public.post_replies (post_id, user_id, content, parent_reply_id)
  VALUES (p_post_id, v_user_id, v_content, p_parent_reply_id)
  RETURNING id INTO v_reply_id;

  RETURN v_reply_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_create_post_reply(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kuro_create_post_reply(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.kuro_create_post_reply(uuid, text, uuid) TO authenticated;
