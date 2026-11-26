-- Also check host-side start quorum after publishing the host's own key.
-- The Durable Object does not echo its own state broadcast to the sender.
DO $unon_host_key_start$
DECLARE
  v_html text;
BEGIN
  SELECT html_content INTO v_html
  FROM public.game_studio_games
  WHERE id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  FOR UPDATE;
  IF v_html IS NULL THEN RAISE EXCEPTION 'UNON game not found'; END IF;
  IF position($old$ const pub=await ensureClientKey();publicKeysByUser.set(UID,pub);
 const durable=await readDurableState(conn);
 if(isHostConnection(conn)){
  if(!durable.state||!Array.isArray(durable.state.players))await persistHostLobby(null,conn);
  else if(durable.state.phase==="lobby")await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 }else await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 await pollRoom();
$old$ in v_html)>0 THEN
    v_html:=replace(v_html,$old$ const pub=await ensureClientKey();publicKeysByUser.set(UID,pub);
 const durable=await readDurableState(conn);
 if(isHostConnection(conn)){
  if(!durable.state||!Array.isArray(durable.state.players))await persistHostLobby(null,conn);
  else if(durable.state.phase==="lobby")await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 }else await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 await pollRoom();
$old$,$new$ const pub=await ensureClientKey();publicKeysByUser.set(UID,pub);
 const durable=await readDurableState(conn);
 if(isHostConnection(conn)){
  if(!durable.state||!Array.isArray(durable.state.players))await persistHostLobby(null,conn);
  else if(durable.state.phase==="lobby")await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 }else await conn.send("unon-key",{pub:pub,ruleMode:ruleModeNow()});
 // A host may be the last client to publish its key. The DO does not echo
 // the sender's state event, so check quorum locally after publishing it.
 if(isHostConnection(conn)){
  try{await maybeStartLobby(conn)}
  catch(e){console.warn("UNON 鍵登録後の開始確認:",e)}
 }
 await pollRoom();
$new$);
    UPDATE public.game_studio_games
    SET html_content=v_html,updated_at=now()
    WHERE id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid;
  ELSIF position($new$ // A host may be the last client to publish its key.$new$ in v_html)=0 THEN
    RAISE EXCEPTION 'UNON key registration anchor not found';
  END IF;
END
$unon_host_key_start$;