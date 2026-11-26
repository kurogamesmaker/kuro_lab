
DROP TRIGGER IF EXISTS kuro_any_matchmaking_clear_on_native_ack
  ON public.game_online_matchmaking;

DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_clear_on_native_ack();
DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_specific_run(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_run(uuid);
DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_ack(uuid,uuid);
DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_cancel(uuid);
DROP FUNCTION IF EXISTS public.kuro_any_matchmaking_dispatch(uuid,uuid,text,text);

DROP TABLE IF EXISTS public.kuro_any_matchmaking_queue;
