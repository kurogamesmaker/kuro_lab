-- Route UNON lobby consensus through the host SDK.
-- The host SDK marks game_online_rooms.status='playing' before it sends unon-start.
-- This prevents matchmaking from attaching a late third/fourth player to a game
-- that has already started inside the Durable Object.
DO $unon_three_player_lock$
DECLARE
  v_html text;
  v_changed boolean := false;
BEGIN
  SELECT html_content INTO v_html
  FROM public.game_studio_games
  WHERE id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  FOR UPDATE;

  IF v_html IS NULL THEN RAISE EXCEPTION 'UNON game not found'; END IF;

  IF position($old_state$   members=uiMembers(conn.getPlayers());updateMembers(members,votes);
   if(state.phase==="lobby"&&previousRosterCount>=2&&state.players.length<2){
    const notice="相手が退出しました。もう一度マッチングするか、新しい参加者を待ってください。";
    if(mode==="match")$("mstat").textContent=notice;else $("rmsg").textContent=notice;
   }
$old_state$ in v_html)>0 THEN
    v_html := replace(v_html,
      $old_state$   members=uiMembers(conn.getPlayers());updateMembers(members,votes);
   if(state.phase==="lobby"&&previousRosterCount>=2&&state.players.length<2){
    const notice="相手が退出しました。もう一度マッチングするか、新しい参加者を待ってください。";
    if(mode==="match")$("mstat").textContent=notice;else $("rmsg").textContent=notice;
   }
$old_state$,
      $new_state$   members=uiMembers(conn.getPlayers());updateMembers(members,votes);
   // The DO records votes and broadcasts lobby state. Only the host starts,
   // so its SDK can lock the Supabase matchmaking room before unon-start.
   if(state.phase==="lobby"&&isHostConnection(conn)){
    try{await maybeStartLobby(conn)}
    catch(e){console.warn("UNON ロビー開始:",e);const target=mode==="match"?$("mstat"):$("rmsg");if(target)target.textContent=e.message||"対戦を開始できませんでした。"}
   }
   if(state.phase==="lobby"&&previousRosterCount>=2&&state.players.length<2){
    const notice="相手が退出しました。もう一度マッチングするか、新しい参加者を待ってください。";
    if(mode==="match")$("mstat").textContent=notice;else $("rmsg").textContent=notice;
   }
$new_state$);
    v_changed := true;
  ELSIF position($new_state$   // The DO records votes and broadcasts lobby state. Only the host starts,$new_state$ in v_html)=0 THEN
    RAISE EXCEPTION 'UNON room-state handler anchor not found';
  END IF;

  IF position($old_vote$  else{(mode==="match"?$("mstat"):$("rmsg")).textContent=kind==="ready"?"準備OKを送りました。みんなを待っています。":"開始を送りました。全員の操作を待っています。"}
$old_vote$ in v_html)>0 THEN
    v_html := replace(v_html,
      $old_vote$  else{(mode==="match"?$("mstat"):$("rmsg")).textContent=kind==="ready"?"準備OKを送りました。みんなを待っています。":"開始を送りました。全員の操作を待っています。"}
$old_vote$,
      $new_vote$  else{
   const statusNode=mode==="match"?$("mstat"):$("rmsg");
   statusNode.textContent=kind==="ready"?"準備OKを送りました。みんなを待っています。":"開始を送りました。全員の操作を待っています。";
   // The final vote may have been sent by the host itself, which receives no
   // echo from the DO. Check locally as well as on peer state broadcasts.
   if(isHostConnection(room)){
    try{await maybeStartLobby(room)}
    catch(startError){statusNode.textContent=startError.message||"対戦を開始できませんでした。"}
   }
  }
$new_vote$);
    v_changed := true;
  ELSIF position($new_vote$   // The final vote may have been sent by the host itself,$new_vote$ in v_html)=0 THEN
    RAISE EXCEPTION 'UNON submitVote anchor not found';
  END IF;

  IF v_changed THEN
    UPDATE public.game_studio_games
    SET html_content=v_html,updated_at=now()
    WHERE id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid;
  END IF;
END
$unon_three_player_lock$;
