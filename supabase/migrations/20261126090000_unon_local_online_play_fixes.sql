-- Repair UNON local-mode online play UI to match the authoritative Durable Object rules.
DO $unon_local_fix$
DECLARE
  v_html text;
BEGIN
  SELECT html_content INTO v_html
  FROM public.game_studio_games
  WHERE id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  FOR UPDATE;
  IF v_html IS NULL THEN RAISE EXCEPTION 'UNON game HTML not found'; END IF;
  IF position($new_0$let sel=[],unoArmed=false,onlineWildIdx=-1,onlineWildCardIds=[],lastPlayIdx=-1,pendingSnap=null,prevSnap=null,pendingSkip=0,pendingDraw=0,playerCount=4,difficulty="normal",waitingEffectCard=null,setupOnly=true,isDealing=false,ruleMode="official",awaiting=false;$new_0$ in v_html) = 0 THEN
    IF position($old_0$let sel=[],unoArmed=false,onlineWildIdx=-1,lastPlayIdx=-1,pendingSnap=null,prevSnap=null,pendingSkip=0,pendingDraw=0,playerCount=4,difficulty="normal",waitingEffectCard=null,setupOnly=true,isDealing=false,ruleMode="official",awaiting=false;$old_0$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 0 did not match'; END IF;
    v_html := replace(v_html, $old_0$let sel=[],unoArmed=false,onlineWildIdx=-1,lastPlayIdx=-1,pendingSnap=null,prevSnap=null,pendingSkip=0,pendingDraw=0,playerCount=4,difficulty="normal",waitingEffectCard=null,setupOnly=true,isDealing=false,ruleMode="official",awaiting=false;$old_0$, $new_0$let sel=[],unoArmed=false,onlineWildIdx=-1,onlineWildCardIds=[],lastPlayIdx=-1,pendingSnap=null,prevSnap=null,pendingSkip=0,pendingDraw=0,playerCount=4,difficulty="normal",waitingEffectCard=null,setupOnly=true,isDealing=false,ruleMode="official",awaiting=false;$new_0$);
  END IF;

  IF position($new_0$ in v_html) = 0 THEN
    IF position($old_0$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 0 did not match'; END IF;
    v_html := replace(v_html, $old_0$, $new_0$);
  END IF;
  IF position($new_1$direction=pub.direction;activeColor=pub.activeColor;pendingDraw=Math.max(0,Math.floor(Number(pub.pendingDraw)||0));
 hasDrawn=!!pub.drawnPending&&turn===0;drawnCardIndex=null;$new_1$ in v_html) = 0 THEN
    IF position($old_1$direction=pub.direction;activeColor=pub.activeColor;
 hasDrawn=!!pub.drawnPending&&turn===0;drawnCardIndex=null;$old_1$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 1 did not match'; END IF;
    v_html := replace(v_html, $old_1$direction=pub.direction;activeColor=pub.activeColor;
 hasDrawn=!!pub.drawnPending&&turn===0;drawnCardIndex=null;$old_1$, $new_1$direction=pub.direction;activeColor=pub.activeColor;pendingDraw=Math.max(0,Math.floor(Number(pub.pendingDraw)||0));
 hasDrawn=!!pub.drawnPending&&turn===0;drawnCardIndex=null;$new_1$);
  END IF;

  IF position($new_1$ in v_html) = 0 THEN
    IF position($old_1$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 1 did not match'; END IF;
    v_html := replace(v_html, $old_1$, $new_1$);
  END IF;
  IF position($new_2$const mine=turn===0?(hasDrawn?(ruleMode==="local"?"引いたカードを出してください":"引いたカードを出すか、パスできます"):(ruleMode==="local"&&pendingDraw>0?`＋カードを重ねるか、${pendingDraw}枚引いて続行できます`:"あなたの番です")):`${PN(turn)} の番…`;
 setStatus(pre+mine)}$new_2$ in v_html) = 0 THEN
    IF position($old_2$setStatus(pre+(turn===0?(hasDrawn?"引いたカードを出すか、パスできます":"あなたの番です"):`${PN(turn)} の番…`))}$old_2$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 2 did not match'; END IF;
    v_html := replace(v_html, $old_2$setStatus(pre+(turn===0?(hasDrawn?"引いたカードを出すか、パスできます":"あなたの番です"):`${PN(turn)} の番…`))}$old_2$, $new_2$const mine=turn===0?(hasDrawn?(ruleMode==="local"?"引いたカードを出してください":"引いたカードを出すか、パスできます"):(ruleMode==="local"&&pendingDraw>0?`＋カードを重ねるか、${pendingDraw}枚引いて続行できます`:"あなたの番です")):`${PN(turn)} の番…`;
 setStatus(pre+mine)}$new_2$);
  END IF;

  IF position($new_2$ in v_html) = 0 THEN
    IF position($old_2$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 2 did not match'; END IF;
    v_html := replace(v_html, $old_2$, $new_2$);
  END IF;
  IF position($new_3$function onlinePick(i){
 const c=hands[0][i];if(!c||awaiting)return;
 if(ruleMode!=="local"){
  if(!canPlay(c)||(hasDrawn&&i!==drawnCardIndex))return;
  if(c.color==="wild"){onlineWildCardIds=[c.id];waitingColor=true;render();setStatus("色を選んでください");return}
  sendPlayCards([c.id]);return;
 }
 const plus=x=>!!x&&(x.value==="D2"||x.value==="W4");
 const compatible=(a,b)=>!!a&&!!b&&(a.value===b.value||(pendingDraw>0&&plus(a)&&plus(b)));
 const drawn=hasDrawn?hands[0][drawnCardIndex]:null;
 const allowedByDraw=idx=>!hasDrawn||idx===drawnCardIndex||!!(drawn&&hands[0][idx]&&hands[0][idx].value===drawn.value);
 if(sel.length){
  if(sel.includes(i)){
   if(hasDrawn&&i===drawnCardIndex&&sel.length>1)return;
   const next=sel.filter(k=>k!==i);
   if(!next.length)sel=[];
   else{
    const anchor=hasDrawn&&next.includes(drawnCardIndex)?drawnCardIndex:next.find(k=>canPlay(hands[0][k]));
    sel=anchor===undefined?[]:[anchor,...next.filter(k=>k!==anchor)];
   }
  }else{
   const first=hands[0][sel[0]];
   if(!allowedByDraw(i)||!compatible(first,c))return;
   sel.push(i);
  }
  render();
  setStatus(sel.length?`同じ数字・記号、または重ね出しできる＋カードを選択中（${sel.length}枚）。「出す」を押してください`:"カードを選んでください");
  return;
 }
 let anchor=i;
 if(hasDrawn){if(!drawn||!allowedByDraw(i))return;anchor=drawnCardIndex}
 else if(!canPlay(c)){
  anchor=hands[0].findIndex((x,k)=>k!==i&&x&&x.value===c.value&&canPlay(x));
  if(anchor<0)return;
 }
 const first=hands[0][anchor];if(!first||!canPlay(first))return;
 const group=[anchor];
 for(let k=0;k<hands[0].length;k++){
  if(k===anchor||!allowedByDraw(k))continue;
  if(compatible(first,hands[0][k]))group.push(k);
 }
 if(group.length>1){sel=hasDrawn?(i===anchor?[anchor]:[anchor,i]):(anchor===i?[i]:[anchor,i]);render();setStatus("同じ数字・記号、または＋カードを追加選択できます。「出す」を押してください");return}
 if(first.color==="wild"){onlineWildCardIds=[first.id];waitingColor=true;render();setStatus("色を選んでください");return}
 sendPlayCards([first.id]);
}
function sendPlayCards(cardIds,color){
 const ids=(Array.isArray(cardIds)?cardIds:[]).filter(id=>typeof id==="string");
 if(!ids.length||ids.length>12)return;
 const action={type:"play",cardIds:ids};if(color)action.color=color;
 unoArmed=false;lastPlayIdx=hands[0].findIndex(card=>card.id===ids[ids.length-1]);UnoOnline.act(action);
}$new_3$ in v_html) = 0 THEN
    IF position($old_3$function onlinePick(i){
 const c=hands[0][i];if(!c||!canPlay(c))return;if(hasDrawn&&i!==drawnCardIndex)return;
 if(c.color==="wild"){waitingColor=true;onlineWildIdx=i;render();setStatus("色を選んでください");return}
 sendPlay(i)}
function sendPlay(i,color){
 const c=hands[0][i];if(!c)return;const a={type:"play",cardIds:[c.id]};if(color)a.color=color;
 unoArmed=false;lastPlayIdx=i;UnoOnline.act(a)}$old_3$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 3 did not match'; END IF;
    v_html := replace(v_html, $old_3$function onlinePick(i){
 const c=hands[0][i];if(!c||!canPlay(c))return;if(hasDrawn&&i!==drawnCardIndex)return;
 if(c.color==="wild"){waitingColor=true;onlineWildIdx=i;render();setStatus("色を選んでください");return}
 sendPlay(i)}
function sendPlay(i,color){
 const c=hands[0][i];if(!c)return;const a={type:"play",cardIds:[c.id]};if(color)a.color=color;
 unoArmed=false;lastPlayIdx=i;UnoOnline.act(a)}$old_3$, $new_3$function onlinePick(i){
 const c=hands[0][i];if(!c||awaiting)return;
 if(ruleMode!=="local"){
  if(!canPlay(c)||(hasDrawn&&i!==drawnCardIndex))return;
  if(c.color==="wild"){onlineWildCardIds=[c.id];waitingColor=true;render();setStatus("色を選んでください");return}
  sendPlayCards([c.id]);return;
 }
 const plus=x=>!!x&&(x.value==="D2"||x.value==="W4");
 const compatible=(a,b)=>!!a&&!!b&&(a.value===b.value||(pendingDraw>0&&plus(a)&&plus(b)));
 const drawn=hasDrawn?hands[0][drawnCardIndex]:null;
 const allowedByDraw=idx=>!hasDrawn||idx===drawnCardIndex||!!(drawn&&hands[0][idx]&&hands[0][idx].value===drawn.value);
 if(sel.length){
  if(sel.includes(i)){
   if(hasDrawn&&i===drawnCardIndex&&sel.length>1)return;
   const next=sel.filter(k=>k!==i);
   if(!next.length)sel=[];
   else{
    const anchor=hasDrawn&&next.includes(drawnCardIndex)?drawnCardIndex:next.find(k=>canPlay(hands[0][k]));
    sel=anchor===undefined?[]:[anchor,...next.filter(k=>k!==anchor)];
   }
  }else{
   const first=hands[0][sel[0]];
   if(!allowedByDraw(i)||!compatible(first,c))return;
   sel.push(i);
  }
  render();
  setStatus(sel.length?`同じ数字・記号、または重ね出しできる＋カードを選択中（${sel.length}枚）。「出す」を押してください`:"カードを選んでください");
  return;
 }
 let anchor=i;
 if(hasDrawn){if(!drawn||!allowedByDraw(i))return;anchor=drawnCardIndex}
 else if(!canPlay(c)){
  anchor=hands[0].findIndex((x,k)=>k!==i&&x&&x.value===c.value&&canPlay(x));
  if(anchor<0)return;
 }
 const first=hands[0][anchor];if(!first||!canPlay(first))return;
 const group=[anchor];
 for(let k=0;k<hands[0].length;k++){
  if(k===anchor||!allowedByDraw(k))continue;
  if(compatible(first,hands[0][k]))group.push(k);
 }
 if(group.length>1){sel=hasDrawn?(i===anchor?[anchor]:[anchor,i]):(anchor===i?[i]:[anchor,i]);render();setStatus("同じ数字・記号、または＋カードを追加選択できます。「出す」を押してください");return}
 if(first.color==="wild"){onlineWildCardIds=[first.id];waitingColor=true;render();setStatus("色を選んでください");return}
 sendPlayCards([first.id]);
}
function sendPlayCards(cardIds,color){
 const ids=(Array.isArray(cardIds)?cardIds:[]).filter(id=>typeof id==="string");
 if(!ids.length||ids.length>12)return;
 const action={type:"play",cardIds:ids};if(color)action.color=color;
 unoArmed=false;lastPlayIdx=hands[0].findIndex(card=>card.id===ids[ids.length-1]);UnoOnline.act(action);
}$new_3$);
  END IF;

  IF position($new_3$ in v_html) = 0 THEN
    IF position($old_3$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 3 did not match'; END IF;
    v_html := replace(v_html, $old_3$, $new_3$);
  END IF;
  IF position($new_4$if(window.ONL){waitingColor=false;const ids=onlineWildCardIds.slice();onlineWildCardIds=[];onlineWildIdx=-1;render();sendPlayCards(ids,b.dataset.color);return}$new_4$ in v_html) = 0 THEN
    IF position($old_4$if(window.ONL){waitingColor=false;const i=onlineWildIdx;onlineWildIdx=-1;render();sendPlay(i,b.dataset.color);return}$old_4$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 4 did not match'; END IF;
    v_html := replace(v_html, $old_4$if(window.ONL){waitingColor=false;const i=onlineWildIdx;onlineWildIdx=-1;render();sendPlay(i,b.dataset.color);return}$old_4$, $new_4$if(window.ONL){waitingColor=false;const ids=onlineWildCardIds.slice();onlineWildCardIds=[];onlineWildIdx=-1;render();sendPlayCards(ids,b.dataset.color);return}$new_4$);
  END IF;

  IF position($new_4$ in v_html) = 0 THEN
    IF position($old_4$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 4 did not match'; END IF;
    v_html := replace(v_html, $old_4$, $new_4$);
  END IF;
  IF position($new_5$("playBtn").onclick=()=>{if(!sel.length||turn!==0||awaiting)return;const ix=[...sel];if(window.ONL){const cards=ix.map(i=>hands[0][i]).filter(Boolean),ids=cards.map(c=>c.id);if(!ids.length){sel=[];render();return}if(cards.some(c=>c.color==="wild")){sel=[];onlineWildCardIds=ids;waitingColor=true;render();setStatus("色を選んでください")}else{sendPlayCards(ids)}return}sel=[];play(0,ix)};$new_5$ in v_html) = 0 THEN
    IF position($old_5$("playBtn").onclick=()=>{if(!sel.length||turn!==0)return;const ix=[...sel];sel=[];play(0,ix)};$old_5$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 5 did not match'; END IF;
    v_html := replace(v_html, $old_5$("playBtn").onclick=()=>{if(!sel.length||turn!==0)return;const ix=[...sel];sel=[];play(0,ix)};$old_5$, $new_5$("playBtn").onclick=()=>{if(!sel.length||turn!==0||awaiting)return;const ix=[...sel];if(window.ONL){const cards=ix.map(i=>hands[0][i]).filter(Boolean),ids=cards.map(c=>c.id);if(!ids.length){sel=[];render();return}if(cards.some(c=>c.color==="wild")){sel=[];onlineWildCardIds=ids;waitingColor=true;render();setStatus("色を選んでください")}else{sendPlayCards(ids)}return}sel=[];play(0,ix)};$new_5$);
  END IF;

  IF position($new_5$ in v_html) = 0 THEN
    IF position($old_5$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 5 did not match'; END IF;
    v_html := replace(v_html, $old_5$, $new_5$);
  END IF;
  IF position($new_6$const n=hands.length,save={hands:hands.map(h=>h.slice()),pile:pile.slice(),turn,direction,activeColor,hasDrawn,drawnCardIndex,pendingDraw,sel:sel.slice(),prev:prevSnap};
 const undo=()=>{hands=save.hands;pile=save.pile;turn=save.turn;direction=save.direction;activeColor=save.activeColor;hasDrawn=save.hasDrawn;drawnCardIndex=save.drawnCardIndex;pendingDraw=save.pendingDraw;sel=save.sel;prevSnap=save.prev;awaiting=false;render()};
 if(a.type==="draw"){
  awaiting=true;
  if(ruleMode==="local"){render();setStatus("ローカルルールのドローを処理しています…")}
  else{hands[0].push({id:"?"+Date.now(),color:"pending",value:""});flyCards(0,1);bumpPrev(ONL.myId,1);render();setStatus("カードを引いています…")}}$new_6$ in v_html) = 0 THEN
    IF position($old_6$const n=hands.length,save={hands:hands.map(h=>h.slice()),pile:pile.slice(),turn,direction,activeColor,hasDrawn,drawnCardIndex,prev:prevSnap};
 const undo=()=>{hands=save.hands;pile=save.pile;turn=save.turn;direction=save.direction;activeColor=save.activeColor;hasDrawn=save.hasDrawn;drawnCardIndex=save.drawnCardIndex;prevSnap=save.prev;awaiting=false;render()};
 if(a.type==="draw"){
  awaiting=true;hands[0].push({id:"?"+Date.now(),color:"pending",value:""});flyCards(0,1);bumpPrev(ONL.myId,1);render();setStatus("カードを引いています…")}$old_6$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 6 did not match'; END IF;
    v_html := replace(v_html, $old_6$const n=hands.length,save={hands:hands.map(h=>h.slice()),pile:pile.slice(),turn,direction,activeColor,hasDrawn,drawnCardIndex,prev:prevSnap};
 const undo=()=>{hands=save.hands;pile=save.pile;turn=save.turn;direction=save.direction;activeColor=save.activeColor;hasDrawn=save.hasDrawn;drawnCardIndex=save.drawnCardIndex;prevSnap=save.prev;awaiting=false;render()};
 if(a.type==="draw"){
  awaiting=true;hands[0].push({id:"?"+Date.now(),color:"pending",value:""});flyCards(0,1);bumpPrev(ONL.myId,1);render();setStatus("カードを引いています…")}$old_6$, $new_6$const n=hands.length,save={hands:hands.map(h=>h.slice()),pile:pile.slice(),turn,direction,activeColor,hasDrawn,drawnCardIndex,pendingDraw,sel:sel.slice(),prev:prevSnap};
 const undo=()=>{hands=save.hands;pile=save.pile;turn=save.turn;direction=save.direction;activeColor=save.activeColor;hasDrawn=save.hasDrawn;drawnCardIndex=save.drawnCardIndex;pendingDraw=save.pendingDraw;sel=save.sel;prevSnap=save.prev;awaiting=false;render()};
 if(a.type==="draw"){
  awaiting=true;
  if(ruleMode==="local"){render();setStatus("ローカルルールのドローを処理しています…")}
  else{hands[0].push({id:"?"+Date.now(),color:"pending",value:""});flyCards(0,1);bumpPrev(ONL.myId,1);render();setStatus("カードを引いています…")}}$new_6$);
  END IF;

  IF position($new_6$ in v_html) = 0 THEN
    IF position($old_6$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 6 did not match'; END IF;
    v_html := replace(v_html, $old_6$, $new_6$);
  END IF;
  IF position($new_7$else if(a.type==="play"){
  if(Array.isArray(a.cardIds)&&a.cardIds.length>1){awaiting=true;sel=[];render();setStatus("選択したカードをまとめて出しています…");return undo}
  const i=hands[0].findIndex(c=>c.id===a.cardIds[0]);if(i<0)return null;$new_7$ in v_html) = 0 THEN
    IF position($old_7$else if(a.type==="play"){
  const i=hands[0].findIndex(c=>c.id===a.cardIds[0]);if(i<0)return null;$old_7$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 7 did not match'; END IF;
    v_html := replace(v_html, $old_7$else if(a.type==="play"){
  const i=hands[0].findIndex(c=>c.id===a.cardIds[0]);if(i<0)return null;$old_7$, $new_7$else if(a.type==="play"){
  if(Array.isArray(a.cardIds)&&a.cardIds.length>1){awaiting=true;sel=[];render();setStatus("選択したカードをまとめて出しています…");return undo}
  const i=hands[0].findIndex(c=>c.id===a.cardIds[0]);if(i<0)return null;$new_7$);
  END IF;

  IF position($new_7$ in v_html) = 0 THEN
    IF position($old_7$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 7 did not match'; END IF;
    v_html := replace(v_html, $old_7$, $new_7$);
  END IF;
  IF position($new_8$if(extra){if(ruleMode==="local")pendingDraw+=extra;else{const t=((direction%n)+n)%n,o=ONL.order&&ONL.order[t];for(let k=0;k<extra;k++)hands[t].push({color:"back",value:""});flyCards(t,extra);if(o)bumpPrev(o.userId,extra)}}$new_8$ in v_html) = 0 THEN
    IF position($old_8$if(extra){const t=((direction%n)+n)%n,o=ONL.order&&ONL.order[t];for(let k=0;k<extra;k++)hands[t].push({color:"back",value:""});flyCards(t,extra);if(o)bumpPrev(o.userId,extra)}$old_8$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 8 did not match'; END IF;
    v_html := replace(v_html, $old_8$if(extra){const t=((direction%n)+n)%n,o=ONL.order&&ONL.order[t];for(let k=0;k<extra;k++)hands[t].push({color:"back",value:""});flyCards(t,extra);if(o)bumpPrev(o.userId,extra)}$old_8$, $new_8$if(extra){if(ruleMode==="local")pendingDraw+=extra;else{const t=((direction%n)+n)%n,o=ONL.order&&ONL.order[t];for(let k=0;k<extra;k++)hands[t].push({color:"back",value:""});flyCards(t,extra);if(o)bumpPrev(o.userId,extra)}}$new_8$);
  END IF;

  IF position($new_8$ in v_html) = 0 THEN
    IF position($old_8$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 8 did not match'; END IF;
    v_html := replace(v_html, $old_8$, $new_8$);
  END IF;
  IF position($new_9$sel=[];waitingColor=false;onlineWildCardIds=[];humanUnoPending=false;finished=false;$new_9$ in v_html) = 0 THEN
    IF position($old_9$sel=[];waitingColor=false;humanUnoPending=false;finished=false;$old_9$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 9 did not match'; END IF;
    v_html := replace(v_html, $old_9$sel=[];waitingColor=false;humanUnoPending=false;finished=false;$old_9$, $new_9$sel=[];waitingColor=false;onlineWildCardIds=[];humanUnoPending=false;finished=false;$new_9$);
  END IF;

  IF position($new_9$ in v_html) = 0 THEN
    IF position($old_9$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 9 did not match'; END IF;
    v_html := replace(v_html, $old_9$, $new_9$);
  END IF;
  IF position($new_10$ruleMode=snap.public.ruleMode==="local"?"local":"official";difficulty="normal";sel=[];unoArmed=false;waitingColor=false;onlineWildCardIds=[];pendingDraw=0;pendingSnap=null;finished=false;humanUnoPending=false;hasDrawn=false;pile=[];$new_10$ in v_html) = 0 THEN
    IF position($old_10$ruleMode=snap.public.ruleMode==="local"?"local":"official";difficulty="normal";sel=[];unoArmed=false;waitingColor=false;pendingSnap=null;finished=false;humanUnoPending=false;hasDrawn=false;pile=[];$old_10$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 10 did not match'; END IF;
    v_html := replace(v_html, $old_10$ruleMode=snap.public.ruleMode==="local"?"local":"official";difficulty="normal";sel=[];unoArmed=false;waitingColor=false;pendingSnap=null;finished=false;humanUnoPending=false;hasDrawn=false;pile=[];$old_10$, $new_10$ruleMode=snap.public.ruleMode==="local"?"local":"official";difficulty="normal";sel=[];unoArmed=false;waitingColor=false;onlineWildCardIds=[];pendingDraw=0;pendingSnap=null;finished=false;humanUnoPending=false;hasDrawn=false;pile=[];$new_10$);
  END IF;

  IF position($new_10$ in v_html) = 0 THEN
    IF position($old_10$ in v_html) = 0 THEN RAISE EXCEPTION 'UNON local-mode patch 10 did not match'; END IF;
    v_html := replace(v_html, $old_10$, $new_10$);
  END IF;
  UPDATE public.game_studio_games SET html_content = v_html, updated_at = now()
  WHERE id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid;
END;
$unon_local_fix$;