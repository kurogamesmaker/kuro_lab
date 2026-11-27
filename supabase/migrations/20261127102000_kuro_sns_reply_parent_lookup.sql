-- Cover the composite self-reference foreign key and speed up loading direct replies.
CREATE INDEX IF NOT EXISTS post_replies_parent_post_idx
  ON public.post_replies (parent_reply_id, post_id);