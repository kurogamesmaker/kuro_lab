const encoder = new TextEncoder();
const SUPABASE_FUNCTION = "kurogames-online";
const UNON_GAME_ID = "faa155cb-2143-4361-9a96-dc759d334e46";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_PLAYERS = 35;
const ROOM_IDLE_TTL_MS = 15 * 60 * 1000;

const UNON_RULES=(()=>{
const COLORS=["red","blue","yellow","green"],ACTIONS=["SKIP","REV","D2"];
const plus=c=>!!c&&["D2","W4"].includes(c.value);
function secureRng(){const b=new Uint32Array(1);globalThis.crypto.getRandomValues(b);return b[0]/4294967296}
function makeDeck(){const d=[];let n=0;const add=(color,value)=>d.push({id:"c"+n++,color,value});for(const c of COLORS){add(c,"0");for(let v=1;v<=9;v++){add(c,String(v));add(c,String(v))}for(const v of ACTIONS){add(c,v);add(c,v)}}for(let k=0;k<4;k++){add("wild","W");add("wild","W4")}return d}
function shuffle(a,rng){for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function smooth(a,rng){shuffle(a,rng);for(let i=2;i<a.length;i++){const c=a[i].color;if(c!=="wild"&&a[i-1].color===c&&a[i-2].color===c){let j=i+1;while(j<a.length&&a[j].color===c)j++;if(j<a.length)[a[i],a[j]]=[a[j],a[i]]}}return a}
const points=c=>/^\d$/.test(c.value)?+c.value:c.color==="wild"?50:20,clone=o=>JSON.parse(JSON.stringify(o));
function createGame({players,rng=secureRng,scoreMultiplier=2,ruleMode="official"}){if(!Array.isArray(players)||players.length<2||players.length>4)throw new Error("players must be 2-4");if(new Set(players.map(p=>p.userId)).size!==players.length)throw new Error("duplicate userId");
 let deck,hands,tries=0;do{deck=smooth(makeDeck(),rng);hands=players.map(()=>[]);for(let r=0;r<7;r++)hands.forEach(h=>h.push(deck.pop()));tries++}while(tries<300&&!hands.every(h=>{const c={};h.forEach(x=>{if(x.color!=="wild")c[x.color]=(c[x.color]||0)+1});const v=Object.values(c);return v.length>=3&&Math.max(...v)<=4}));
 let opening,blocked=["SKIP","REV","D2","W","W4"],guard=0;do{opening=deck.pop();if(blocked.includes(opening.value))deck.unshift(opening);guard++}while(blocked.includes(opening.value)&&guard<deck.length);
 return{ver:1,version:0,phase:"playing",scoreMultiplier,ruleMode:ruleMode==="local"?"local":"official",players:players.map((p,i)=>({userId:p.userId,name:String(p.name||"プレイヤー").slice(0,8),hand:hands[i]})),deck,pile:[opening],turn:0,direction:1,activeColor:opening.color,pendingDraw:0,drawn:null,unoPending:null}}
function take(s,rng){if(!s.deck.length&&s.pile.length>1){const top=s.pile.pop();s.deck=smooth(s.pile,rng);s.pile=[top]}return s.deck.pop()||null}
function give(s,idx,n,rng,ev){let k=0;for(;k<n;k++){const c=take(s,rng);if(!c)break;s.players[idx].hand.push(c)}if(k)ev.push({type:"draw",to:s.players[idx].userId,count:k});return k}
function advance(s,skip){const n=s.players.length;s.turn=(((s.turn+s.direction*(1+skip))%n)+n)%n;s.drawn=null}
function finish(s,wi,reason){s.phase="finished";let pts=0;s.players.forEach((p,i)=>{if(i!==wi)p.hand.forEach(c=>pts+=points(c))});const scores={};s.players.forEach(p=>scores[p.userId]=0);scores[s.players[wi].userId]=reason==="forfeit"?0:Math.round((pts+50)*s.scoreMultiplier);s.result={winnerId:s.players[wi].userId,scores,reason}}
function applyAction(state,actor,action,ctx={}){const rng=ctx.rng||secureRng,fail=(code,error)=>({ok:false,code,error});if(!action||typeof action!=="object")return fail("BAD_ACTION","不正な操作です");if(state.phase!=="playing")return fail("GAME_OVER","ゲームは終了しています");const s=clone(state),idx=s.players.findIndex(p=>p.userId===actor);if(idx<0)return fail("NOT_PLAYER","参加者ではありません");const ev=[];
 if(s.unoPending&&action.type!=="uno"&&action.type!=="uno_timeout")return fail("UNO_WINDOW","UNO宣言の判定中です。3秒後に続行できます");
 if(action.type==="uno"||action.type==="uno_timeout"){if(s.unoPending!==actor)return fail("NO_UNO_PENDING","UNO宣言の対象ではありません");s.unoPending=null;if(action.type==="uno")ev.push({type:"uno",who:actor});else{give(s,idx,2,rng,ev);ev.push({type:"uno-penalty",who:actor})}s.version++;return{ok:true,state:s,events:ev,result:s.result||null}}
 if(idx!==s.turn)return fail("NOT_YOUR_TURN","あなたの番ではありません");const me=s.players[idx],n=s.players.length,top=()=>s.pile[s.pile.length-1],can=c=>s.ruleMode==="local"&&s.pendingDraw>0?plus(c):(c.color==="wild"||c.color===s.activeColor||c.value===top().value);
 if(action.type==="draw"){if(s.drawn)return fail("ALREADY_DRAWN","すでにカードを引いています");if(s.ruleMode==="local"&&s.pendingDraw>0){const count=s.pendingDraw;s.pendingDraw=0;give(s,idx,count,rng,ev);ev.push({type:"stack-draw",to:actor,count})}else if(s.ruleMode==="local"){let c=null,count=0;while(count<108){c=take(s,rng);if(!c)break;me.hand.push(c);count++;if(can(c))break}if(count)ev.push({type:"draw",to:actor,count});if(c&&can(c))s.drawn=c.id;else advance(s,0)}else{const c=take(s,rng);if(c){me.hand.push(c);ev.push({type:"draw",to:actor,count:1})}if(c&&can(c))s.drawn=c.id;else advance(s,0)}}
 else if(action.type==="pass"){if(s.ruleMode==="local")return fail("LOCAL_NO_PASS","ローカルルールではパスできません");if(!s.drawn)return fail("NOT_DRAWN","カードを引いてからターンを終了できます");advance(s,0)}
 else if(action.type==="play"){const ids=action.cardIds;if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return fail("BAD_CARDS","カード指定が不正です");if(s.ruleMode!=="local"&&ids.length!==1)return fail("ONE_CARD_ONLY","公式ルールは1枚ずつ出してください");const cards=ids.map(id=>me.hand.find(c=>c.id===id));if(cards.some(c=>!c))return fail("NO_SUCH_CARD","持っていないカードです");if(!can(cards[0]))return fail("CANNOT_PLAY","そのカードは出せません");const same=cards.every(c=>c.value===cards[0].value),stack=s.ruleMode==="local"&&s.pendingDraw>0&&cards.every(plus);if(!same&&!stack)return fail("SAME_VALUE","同じ数字・記号か、重ね出しできる＋カードを選んでください");if(s.drawn){const drawn=me.hand.find(c=>c.id===s.drawn);if(!ids.includes(s.drawn)&&!(s.ruleMode==="local"&&drawn&&cards.every(c=>c.value===drawn.value)))return fail("ONLY_DRAWN","引いたカード、または同じ数字のカードを出してください")}if(cards.some(c=>c.color==="wild")&&!COLORS.includes(action.color))return fail("NEED_COLOR","色を選んでください");
 me.hand=me.hand.filter(c=>!ids.includes(c.id));let skip=0,extra=0;for(const c of cards){s.pile.push(c);s.activeColor=c.color==="wild"?action.color:c.color;if(c.value==="SKIP")skip++;else if(c.value==="REV"){s.direction*=-1;if(n===2)skip++}else if(c.value==="D2"){extra+=2;skip=1}else if(c.value==="W4"){extra+=4;skip=1}}ev.push({type:"play",by:actor,cards:cards.map(({id,color,value})=>({id,color,value})),color:s.activeColor});s.drawn=null;
 if(me.hand.length===0){const actionCard=cards.some(c=>["SKIP","REV","D2","W4","W"].includes(c.value));if(s.ruleMode==="local"&&actionCard){give(s,idx,2,rng,ev);ev.push({type:"action-finish-penalty",who:actor})}else{finish(s,idx,"win");ev.push({type:"win",by:actor})}}
 if(s.phase!=="finished"){if(extra&&s.ruleMode==="local"){s.pendingDraw+=extra;skip=0}else if(extra){const target=(((idx+s.direction)%n)+n)%n;give(s,target,extra,rng,ev)}if(me.hand.length===1){s.unoPending=actor;ev.push({type:"uno-pending",who:actor})}advance(s,skip)}}
 else return fail("UNKNOWN_ACTION","未対応の操作です");s.version++;return{ok:true,state:s,events:ev,result:s.result||null}}
function onLeave(state,userId,ctx={}){const rng=ctx.rng||secureRng;if(state.phase!=="playing")return{ok:true,state,events:[],result:state.result||null};const s=clone(state),idx=s.players.findIndex(p=>p.userId===userId);if(idx<0)return{ok:false,code:"NOT_PLAYER",error:"参加者ではありません"};const[left]=s.players.splice(idx,1),ev=[{type:"leave",who:userId}];s.deck=smooth(s.deck.concat(left.hand),rng);if(s.unoPending===userId)s.unoPending=null;if(idx<s.turn)s.turn--;else if(idx===s.turn){s.drawn=null;const n=s.players.length;s.turn=s.direction===1?idx%n:(idx-1+n)%n}if(s.players.length===1){finish(s,0,"forfeit");ev.push({type:"win",by:s.players[0].userId})}else if(s.turn>=s.players.length)s.turn=0;s.version++;return{ok:true,state:s,events:ev,result:s.result||null}}
function split(s){return{public:{ver:s.ver,version:s.version,phase:s.phase,ruleMode:s.ruleMode,players:s.players.map(p=>({userId:p.userId,name:p.name,handCount:p.hand.length})),turn:s.players[s.turn]?.userId||null,direction:s.direction,activeColor:s.activeColor,top:s.pile[s.pile.length-1],pileCount:s.pile.length,deckCount:s.deck.length,pendingDraw:s.pendingDraw,drawnPending:!!s.drawn,unoPending:s.unoPending||null,result:s.result||null},private:Object.fromEntries(s.players.map(p=>[p.userId,{hand:p.hand,drawn:s.drawn&&p.hand.some(c=>c.id===s.drawn)?s.drawn:null}])),server:{deck:s.deck,pile:s.pile.slice(0,-1)}}}
return{COLORS,createGame,applyAction,onLeave,split,points}})();

export { UNON_RULES };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin);
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin && originAllowed(request, env) ? origin : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    "vary": "origin",
  };
}
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}
async function issueTicket(claims, secret) {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return payload + "." + b64url(signature);
}
async function verifyTicket(ticket, secret) {
  if (typeof ticket !== "string" || ticket.length > 4096) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await hmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (!claims || typeof claims.sub !== "string" || !claims.sub ||
        typeof claims.room !== "string" || typeof claims.game !== "string" ||
        !Number.isInteger(claims.exp) || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (_) { return null; }
}
function validId(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}
async function getSupabaseUser(env, accessToken) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: "Bearer " + accessToken },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && typeof user.id === "string" && user.is_anonymous !== true ? user : null;
}
async function verifyRoomMembership(env, accessToken, gameId, roomId, userId) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/" + SUPABASE_FUNCTION, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_ANON_KEY,
      authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({ action: "room_poll", gameId, roomId, afterId: null }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  if (!data || data.error || data.roomStatus === "closed" || !Array.isArray(data.members) ||
      typeof data.hostUserId !== "string" || !data.hostUserId) return null;
  const member = data.members.find(member => member && String(member.userId || member.user_id || "") === userId);
  return member ? { ...member, isHost: data.hostUserId === userId } : null;
}
async function createTicket(request, env) {
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!originAllowed(request, env)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);
  if (!env.TICKET_SECRET || env.TICKET_SECRET.length < 32) return json({ error: "service_not_configured" }, 503, headers);
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.length > 8192) return json({ error: "unauthorized" }, 401, headers);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "request_too_large" }, 413, headers);
    body = JSON.parse(raw);
  } catch (_) { return json({ error: "invalid_json" }, 400, headers); }
  const { roomId, gameId } = body || {};
  if (!validId(roomId) || !/^[0-9a-f-]{36}$/i.test(String(gameId || ""))) {
    return json({ error: "invalid_room_or_game" }, 400, headers);
  }
  let user = null;
  try { user = await getSupabaseUser(env, token); } catch (_) { user = null; }
  if (!user) return json({ error: "unauthorized" }, 401, headers);
  let member;
  try { member = await verifyRoomMembership(env, token, gameId, roomId, user.id); } catch (_) { member = null; }
  if (!member) return json({ error: "room_membership_required" }, 403, headers);
  const meta = user.user_metadata || {};
  const name = String(member.user && member.user.username || meta.username || meta.handle || "プレイヤー").slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  const ticket = await issueTicket({ typ: "kuro_account", sub: user.id, name, room: roomId, game: gameId, host: member.isHost === true, iat: now, exp: now + 60 }, env.TICKET_SECRET);
  return json({ ticket, expiresAt: (now + 60) * 1000 }, 200, headers);
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
    this.tail = Promise.resolve();
    this.lifecycleTail = Promise.resolve();
    this.loaded = false;
    this.data = { state: null, updatedAt: null, unonGame: null, unonCrypto: null, unonActionIds: [], unoDeadline: null, idleDeadline: null };
    this.unonPrivateKey = null;
    this.unonCryptoPromise = null;
  }
  withLifecycleLock(task) {
    const run = this.lifecycleTail.then(task, task);
    this.lifecycleTail = run.catch(error => {
      console.error("[kuro-online-room] lifecycle task failed:", error);
    });
    return run;
  }
  async load() {
    if (this.loaded) return;
    const saved = await this.state.storage.get("room-state");
    if (saved && typeof saved === "object") this.data = { unonGame: null, unonCrypto: null, unonActionIds: [], unoDeadline: null, idleDeadline: null, ...saved };
    this.loaded = true;
  }
  async save() {
    await this.state.storage.put("room-state", this.data);
  }

  async scheduleAlarm() {
    const deadlines = [this.data.unoDeadline, this.data.idleDeadline].filter(value => Number.isFinite(value) && value > 0);
    if (deadlines.length) await this.state.storage.setAlarm(Math.min(...deadlines));
    else await this.state.storage.deleteAlarm();
  }
  async ensureUnonCrypto() {
    if (!this.data.unonCrypto) {
      if (!this.unonCryptoPromise) {
        this.unonCryptoPromise = (async () => {
          const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
          this.data.unonCrypto = {
            publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
            privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
          };
          await this.save();
        })().finally(() => { this.unonCryptoPromise = null; });
      }
      await this.unonCryptoPromise;
    }
    if (!this.unonPrivateKey) {
      this.unonPrivateKey = await crypto.subtle.importKey("jwk", this.data.unonCrypto.privateKey,
        { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    }
    return this.data.unonCrypto.publicKey;
  }
  async sealUnonPrivate(userId, value) {
    const roster = this.data.state && Array.isArray(this.data.state.players) ? this.data.state.players : [];
    const member = roster.find(item => item && item.id === userId);
    const pub = member && member.pub;
    if (!pub || pub.kty !== "EC" || pub.crv !== "P-256" || typeof pub.x !== "string" || typeof pub.y !== "string") {
      throw new Error("player_public_key_missing");
    }
    const epk = await this.ensureUnonCrypto();
    const remote = await crypto.subtle.importKey("jwk", pub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await crypto.subtle.deriveKey({ name: "ECDH", public: remote }, this.unonPrivateKey,
      { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
      encoder.encode(JSON.stringify(value))));
    const toBase64 = bytes => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    return { epk, iv: toBase64(iv), ct: toBase64(ciphertext) };
  }
  syncUnonRoomMetadata(game) {
    if (!game || !this.data.state || typeof this.data.state !== "object") return;
    this.data.state = {
      ...this.data.state,
      phase: game.phase === "finished" ? "finished" : "playing",
      matchId: game.matchId,
      game: null,
    };
  }
  async makeUnonPatch(userId, previousGame, nextGame, events, removeId, forceFull = false) {
    const nextSplit = UNON_RULES.split(nextGame);
    const previousSplit = previousGame ? UNON_RULES.split(previousGame) : null;
    const previousPublic = previousSplit && previousSplit.public;
    const nextPublic = nextSplit.public;
    const delta = {};
    if (!forceFull && previousPublic) {
      for (const key of Object.keys(nextPublic)) {
        if (!Object.prototype.hasOwnProperty.call(previousPublic, key) ||
            JSON.stringify(previousPublic[key]) !== JSON.stringify(nextPublic[key])) delta[key] = nextPublic[key];
      }
      for (const key of Object.keys(previousPublic)) {
        if (!Object.prototype.hasOwnProperty.call(nextPublic, key)) delta[key] = null;
      }
    }
    const previousPrivate = previousSplit && previousSplit.private[userId];
    const nextPrivate = nextSplit.private[userId];
    let privateEnvelope = null;
    if (nextPrivate && (!previousSplit || JSON.stringify(previousPrivate) !== JSON.stringify(nextPrivate))) {
      privateEnvelope = await this.sealUnonPrivate(userId, nextPrivate);
    }
    let winProof = null;
    const proofPeer = Array.from(this.sockets.values()).find(peer => peer.id === userId);
    const proofGameId = (proofPeer && proofPeer.gameId) || this.gameId || "";
    const proofRoomId = (proofPeer && proofPeer.roomId) || this.roomId || "";
    if (nextGame.phase === "finished" && nextGame.result &&
        nextGame.result.reason === "win" && nextGame.result.winnerId === userId) {
      if (proofGameId === UNON_GAME_ID &&
          UUID_RE.test(String(nextGame.matchId || "")) && validId(proofRoomId) &&
          typeof this.env.TICKET_SECRET === "string" && this.env.TICKET_SECRET.length > 0) {
        const now = Math.floor(Date.now() / 1000);
        winProof = await issueTicket({
          typ: "unon_win",
          sub: userId,
          room: proofRoomId,
          game: proofGameId,
          match: nextGame.matchId,
          iat: now,
          exp: now + 600,
        }, this.env.TICKET_SECRET);
        console.info("[kuro-online-room] UNON online win proof issued", {
          matchId: nextGame.matchId, userId, roomId: proofRoomId,
        });
      } else {
        console.error("[kuro-online-room] UNON online win proof context missing", {
          matchId: nextGame.matchId, userId, gameId: proofGameId,
          hasRoomId: !!proofRoomId, hasTicketSecret: !!this.env.TICKET_SECRET,
        });
      }
    }
    return {
      phase: nextGame.phase === "finished" ? "finished" : "playing",
      matchId: nextGame.matchId,
      version: nextGame.version,
      ...(forceFull || !previousPublic ? { public: nextPublic } : { publicDelta: delta }),
      events: Array.isArray(events) ? events.slice(0, 24) : [],
      removeId: removeId || null,
      privateEnvelope,
      winProof,
    };
  }
  async broadcastUnonPatch(previousGame, nextGame, events, removeId, sourceSocket) {
    const recipients = [];
    for (const [socket, peer] of this.sockets) {
      if (socket === sourceSocket || !nextGame.players.some(item => item.userId === peer.id)) continue;
      recipients.push({ socket, peer });
    }
    await Promise.all(recipients.map(async ({ socket, peer }) => {
      const data = await this.makeUnonPatch(peer.id, previousGame, nextGame, events, removeId, !previousGame);
      this.send(socket, { type: "message", message: {
        id: crypto.randomUUID(), from: "", type: "unon-patch", data, at: this.data.updatedAt,
      } });
    }));
  }
  unonFailure(ws, requestId, error, code = "UNON_ERROR") {
    this.send(ws, { type: "unon-result", requestId, result: { ok: false, code, error } });
  }
  async startUnonGame(ws, player, message) {
    const requestId = String(message.requestId || "");
    if (!player.isHost) return this.unonFailure(ws, requestId, "ホストだけがゲームを開始できます。", "FORBIDDEN");
    if (this.data.unonGame && this.data.unonGame.phase === "playing") {
      return this.unonFailure(ws, requestId, "ゲームはすでに進行中です。", "ALREADY_STARTED");
    }
    const roomState = this.data.state;
    const roster = roomState && Array.isArray(roomState.players) ? roomState.players : [];
    if (!roomState || roomState.phase !== "lobby" || roster.length < 2 || roster.length > 4 ||
        !roster.every(item => item && item.ready === true)) {
      return this.unonFailure(ws, requestId, "2〜4人が参加し、全員が準備OKになると開始できます。", "NOT_READY");
    }
    for (const item of roster) {
      if (!item.pub || item.pub.kty !== "EC" || item.pub.crv !== "P-256" ||
          typeof item.pub.x !== "string" || typeof item.pub.y !== "string") {
        return this.unonFailure(ws, requestId, "プレイヤーの暗号鍵を確認できません。再入室してください。", "KEY_MISSING");
      }
    }
    const ruleMode = message.ruleMode === "local" ? "local" : "official";
    let game;
    try {
      game = UNON_RULES.createGame({ players: roster.map(item => ({ userId: item.id, name: item.name })), ruleMode });
      game.matchId = crypto.randomUUID();
    } catch (error) {
      return this.unonFailure(ws, requestId, error && error.message || "ゲームを開始できません。");
    }
    const nextState = { ...roomState, phase: "playing", ruleMode, matchId: game.matchId, game: null };
    this.data = { ...this.data, state: nextState, unonGame: game, unonActionIds: [], unoDeadline: null,
      updatedAt: Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1) };
    await this.save();
    await this.scheduleAlarm();
    this.broadcast({ type: "state", state: nextState, updatedAt: this.data.updatedAt, from: player.id });
    const patch = await this.makeUnonPatch(player.id, null, game, [], null, true);
    this.send(ws, { type: "unon-result", requestId, result: { ok: true, patch, roomState: nextState, updatedAt: this.data.updatedAt } });
    await this.broadcastUnonPatch(null, game, [], null, ws);
  }
  async getUnonSnapshot(ws, player, message) {
    const requestId = String(message.requestId || "");
    const game = this.data.unonGame;
    if (!game || !game.players.some(item => item.userId === player.id)) {
      return this.send(ws, { type: "unon-result", requestId, result: { ok: false, inactive: true } });
    }
    const patch = await this.makeUnonPatch(player.id, null, game, [], null, true);
    this.send(ws, { type: "unon-result", requestId, result: { ok: true, active: true, patch, roomState: this.data.state } });
  }
  async submitUnonAction(ws, player, message) {
    const requestId = String(message.requestId || "");
    const actionId = message.actionId;
    const action = message.action;
    if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 80 ||
        !action || typeof action !== "object" || Array.isArray(action) ||
        !["play", "draw", "pass", "uno"].includes(action.type) ||
        (action.type === "play" && (!Array.isArray(action.cardIds) || action.cardIds.length < 1 || action.cardIds.length > 4 ||
          action.cardIds.some(id => typeof id !== "string" || id.length > 40) ||
          (action.color !== undefined && !UNON_RULES.COLORS.includes(action.color))))) {
      return this.unonFailure(ws, requestId, "操作データが正しくありません。", "BAD_ACTION");
    }
    const game = this.data.unonGame;
    if (!game || game.phase !== "playing") return this.unonFailure(ws, requestId, "ゲームは終了しています。", "GAME_OVER");
    if (!game.players.some(item => item.userId === player.id)) return this.unonFailure(ws, requestId, "参加者ではありません。", "NOT_PLAYER");
    const actionKey = player.id + ":" + actionId;
    const seen = Array.isArray(this.data.unonActionIds) ? this.data.unonActionIds : [];
    if (seen.includes(actionKey)) {
      const patch = await this.makeUnonPatch(player.id, null, game, [], null, true);
      return this.send(ws, { type: "unon-result", requestId, result: { ok: true, duplicate: true, patch, updatedAt: this.data.updatedAt } });
    }
    const applied = UNON_RULES.applyAction(game, player.id, action);
    if (!applied.ok) return this.send(ws, { type: "unon-result", requestId, result: applied });
    this.data.unonGame = applied.state;
    this.syncUnonRoomMetadata(applied.state);
    this.data.unonActionIds = seen.concat(actionKey).slice(-128);
    this.data.unoDeadline = applied.state.unoPending ? Date.now() + 3000 : null;
    this.data.updatedAt = Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1);
    await this.save();
    await this.scheduleAlarm();
    const patch = await this.makeUnonPatch(player.id, game, applied.state, applied.events, null, false);
    this.send(ws, { type: "unon-result", requestId, result: { ok: true, patch, updatedAt: this.data.updatedAt } });
    await this.broadcastUnonPatch(game, applied.state, applied.events, null, ws);
  }
  async removeUnonPlayer(ws, player, message) {
    const requestId = String(message.requestId || "");
    const targetId = message.userId;
    if (!player.isHost) return this.unonFailure(ws, requestId, "ホストだけが退出処理できます。", "FORBIDDEN");
    if (typeof targetId !== "string" || !targetId || targetId === player.id) return this.unonFailure(ws, requestId, "退出対象が正しくありません。", "BAD_PLAYER");
    const game = this.data.unonGame;
    const roomState = this.data.state || {};
    const roster = Array.isArray(roomState.players) ? roomState.players.filter(item => item.id !== targetId) : [];
    if (game && game.phase === "playing" && game.players.some(item => item.userId === targetId)) {
      const applied = UNON_RULES.onLeave(game, targetId);
      if (!applied.ok) return this.unonFailure(ws, requestId, applied.error, applied.code);
      this.data.unonGame = applied.state;
      this.data.state = { ...roomState, players: roster, phase: applied.state.phase, matchId: applied.state.matchId };
      this.data.unoDeadline = applied.state.unoPending ? Date.now() + 3000 : null;
      this.data.updatedAt = Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1);
      await this.save();
      await this.scheduleAlarm();
      this.broadcast({ type: "state", state: this.data.state, updatedAt: this.data.updatedAt, from: player.id });
      const patch = await this.makeUnonPatch(player.id, game, applied.state, applied.events, targetId, false);
      this.send(ws, { type: "unon-result", requestId, result: { ok: true, patch, roomState: this.data.state, updatedAt: this.data.updatedAt } });
      await this.broadcastUnonPatch(game, applied.state, applied.events, targetId, ws);
    } else {
      this.data.state = { ...roomState, players: roster };
      this.data.updatedAt = Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1);
      await this.save();
      this.broadcast({ type: "state", state: this.data.state, updatedAt: this.data.updatedAt, from: player.id });
      this.send(ws, { type: "unon-result", requestId, result: { ok: true, roomState: this.data.state, updatedAt: this.data.updatedAt } });
    }
  }
  async handleUnonAlarm() {
    const game = this.data.unonGame;
    if (!game || !game.unoPending || !this.data.unoDeadline || this.data.unoDeadline > Date.now()) return;
    const applied = UNON_RULES.applyAction(game, game.unoPending, { type: "uno_timeout" });
    this.data.unoDeadline = null;
    if (!applied.ok) return;
    this.data.unonGame = applied.state;
    this.syncUnonRoomMetadata(applied.state);
    this.data.updatedAt = Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1);
    await this.save();
    await this.scheduleAlarm();
    await this.broadcastUnonPatch(game, applied.state, applied.events, null, null);
  }
  players() {
    const unique = new Map();
    for (const player of this.sockets.values()) unique.set(player.id, player);
    return Array.from(unique.values());
  }
  send(ws, payload) {
    try { ws.send(JSON.stringify(payload)); return true; }
    catch (_) {
      const player = this.sockets.get(ws);
      this.removeSocket(ws, player && player.id || "");
      return false;
    }
  }
  broadcast(payload, exceptUserId = null) {
    const encoded = JSON.stringify(payload);
    for (const [ws, player] of this.sockets) {
      if (exceptUserId && player.id === exceptUserId) continue;
      try { ws.send(encoded); }
      catch (_) { this.removeSocket(ws, player.id); }
    }
  }
  async fetch(request) {
    const userId = request.headers.get("x-kuro-user-id") || "";
    const gameId = request.headers.get("x-kuro-game-id") || "";
    this.gameId = gameId;
    this.roomId = request.headers.get("x-kuro-room-id") || "";
    const userName = (request.headers.get("x-kuro-user-name") || "プレイヤー").slice(0, 40);
    const isHost = request.headers.get("x-kuro-user-host") === "1";
    if (!userId || !gameId) return json({ error: "trusted_identity_required" }, 401);
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket_required" }, 426);

    // Serialize new connections against the idle-cleanup alarm. A reconnect
    // cancels the pending cleanup before loading room state.
    return this.withLifecycleLock(async () => {
      await this.load();
      this.data.idleDeadline = null;
      await this.save();
      await this.scheduleAlarm();

      const distinct = new Set(Array.from(this.sockets.values(), p => p.id));
      if (!distinct.has(userId) && distinct.size >= MAX_PLAYERS) {
        return json({ error: "room_full" }, 409);
      }
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      server.accept();
      const player = { id: userId, name: userName, gameId, roomId: this.roomId, isHost, joinedAt: Date.now() };
      this.sockets.set(server, player);
      server.addEventListener("close", () => this.removeSocket(server, userId));
      server.addEventListener("error", () => this.removeSocket(server, userId));
      server.addEventListener("message", event => {
        this.tail = this.tail.then(() => this.onMessage(server, player, event.data)).catch(() => {
          this.send(server, { type: "error", error: "internal_error" });
        });
      });
      this.send(server, {
        type: "welcome",
        room: this.state.id.toString(),
        players: this.players(),
        state: this.data.state,
        updatedAt: this.data.updatedAt,
      });
      this.broadcast({ type: "players", players: this.players() }, userId);
      return new Response(null, { status: 101, webSocket: client });
    });
  }
  removeSocket(ws, userId) {
    const cleanup = this.withLifecycleLock(async () => {
      const removed = this.sockets.delete(ws);
      if (!removed) return;

      if (!Array.from(this.sockets.values()).some(p => p.id === userId)) {
        this.broadcast({ type: "players", players: this.players() });
      }
      if (this.sockets.size === 0) {
        // Keep a short reconnect grace period before removing persisted state.
        this.data.idleDeadline = Date.now() + ROOM_IDLE_TTL_MS;
        await this.save();
        await this.scheduleAlarm();
      }
    });
    // WebSocket event listeners are not request handlers; keep the alarm write alive.
    this.state.waitUntil(cleanup);
  }
  async alarm() {
    await this.withLifecycleLock(async () => {
      await this.load();
      if (this.data.unoDeadline && this.data.unoDeadline <= Date.now()) await this.handleUnonAlarm();
      if (this.sockets.size === 0 && this.data.idleDeadline && this.data.idleDeadline <= Date.now()) {
        await this.state.storage.deleteAll();
        this.loaded = false;
        this.unonPrivateKey = null;
        this.unonCryptoPromise = null;
        this.data = { state: null, updatedAt: null, unonGame: null, unonCrypto: null, unonActionIds: [], unoDeadline: null, idleDeadline: null };
        console.info("[kuro-online-room] cleared storage after idle timeout");
        return;
      }
      await this.scheduleAlarm();
    });
  }
  async onMessage(ws, player, raw) {
    if (!this.sockets.has(ws)) return;
    if (typeof raw !== "string" || encoder.encode(raw).byteLength > MAX_MESSAGE_BYTES) {
      this.send(ws, { type: "error", error: "message_too_large_or_invalid" });
      return;
    }
    let message;
    try { message = JSON.parse(raw); } catch (_) {
      this.send(ws, { type: "error", error: "invalid_json" });
      return;
    }
    if (!message || typeof message.type !== "string") {
      this.send(ws, { type: "error", error: "invalid_message" });
      return;
    }
    if (message.type === "ping") {
      this.send(ws, { type: "pong", at: Date.now() });
      return;
    }
    if (message.type === "leave") {
      try { ws.close(1000, "left"); } catch (_) {}
      return;
    }
    if (message.type === "get-state") {
      this.send(ws, { type: "state-result", requestId: String(message.requestId || ""), result: { state: this.data.state, updatedAt: this.data.updatedAt, roomStatus: "waiting" } });
      return;
    }
    if (message.type === "unon-start") return this.startUnonGame(ws, player, message);
    if (message.type === "unon-get") return this.getUnonSnapshot(ws, player, message);
    if (message.type === "unon-action") return this.submitUnonAction(ws, player, message);
    if (message.type === "unon-remove-player") return this.removeUnonPlayer(ws, player, message);
    if (message.type === "host-state-update") {
      const requestId = String(message.requestId || "");
      if (!player.isHost) {
        this.send(ws, { type: "state-result", requestId, result: { state: this.data.state, updatedAt: this.data.updatedAt, conflict: false, forbidden: true } });
        return;
      }
      if (!message.state || typeof message.state !== "object" || Array.isArray(message.state)) {
        this.send(ws, { type: "state-result", requestId, result: { state: this.data.state, updatedAt: this.data.updatedAt, conflict: false, invalid: true } });
        return;
      }
      const expected = message.expectedUpdatedAt || null;
      const current = this.data.updatedAt || null;
      // A host may migrate a pre-existing Supabase room snapshot into a new DO once.
      const legacySeed = player.isHost && current === null && expected !== null;
      if (expected !== current && !legacySeed) {
        this.send(ws, { type: "state-result", requestId, result: { state: this.data.state, updatedAt: this.data.updatedAt, conflict: true } });
        return;
      }
      this.data = { ...this.data, state: message.state, updatedAt: Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1) };
      await this.save();
      this.loaded = true;
      const result = { state: this.data.state, updatedAt: this.data.updatedAt, conflict: false, roomStatus: "waiting" };
      this.send(ws, { type: "state-result", requestId, result });
      this.broadcast({ type: "state", state: this.data.state, updatedAt: this.data.updatedAt, from: player.id }, player.id);
      return;
    }
    if (message.type === "host-game-patch") {
      const requestId = String(message.requestId || "");
      const patch = message.patch;
      const fail = (result) => this.send(ws, { type: "game-patch-result", requestId, result });
      if (!player.isHost) {
        fail({ forbidden: true });
        return;
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
          !["playing", "finished"].includes(patch.phase) ||
          typeof patch.matchId !== "string" || patch.matchId.length < 1 || patch.matchId.length > 100 ||
          !Number.isSafeInteger(patch.version) || patch.version < 0 ||
          !patch.public || typeof patch.public !== "object" || Array.isArray(patch.public) ||
          !Array.isArray(patch.public.players) ||
          !Array.isArray(patch.events) || patch.events.length > 24 ||
          !patch.privateUpdates || typeof patch.privateUpdates !== "object" || Array.isArray(patch.privateUpdates)) {
        fail({ invalid: true });
        return;
      }
      const publicIds = new Set(patch.public.players.map(item =>
        item && typeof item.userId === "string" ? item.userId : ""
      ).filter(Boolean));
      const updates = patch.privateUpdates;
      const updateIds = Object.keys(updates);
      if (updateIds.some(id => !publicIds.has(id))) {
        fail({ invalid: true });
        return;
      }
      for (const id of updateIds) {
        const envelope = updates[id];
        if (!envelope || typeof envelope !== "object" ||
            typeof envelope.iv !== "string" || envelope.iv.length > 128 ||
            typeof envelope.ct !== "string" || envelope.ct.length > 12000 ||
            !envelope.epk || typeof envelope.epk !== "object") {
          fail({ invalid: true });
          return;
        }
      }
      const removeId = typeof patch.removeId === "string" && patch.removeId.length <= 128
        ? patch.removeId
        : null;
      const currentState = this.data.state && typeof this.data.state === "object"
        ? this.data.state
        : {};
      const sameMatch = currentState.matchId === patch.matchId;
      const currentVersion = Number(currentState.game && currentState.game.version);
      if (sameMatch && Number.isSafeInteger(currentVersion) && patch.version <= currentVersion) {
        fail({ conflict: true, version: currentVersion });
        return;
      }

      // Persist the complete reconnect snapshot, but send only the public delta
      // and each recipient's own changed private-hand envelope over the socket.
      const privateState = sameMatch && currentState.game && currentState.game.priv &&
        typeof currentState.game.priv === "object"
        ? { ...currentState.game.priv }
        : {};
      for (const [id, envelope] of Object.entries(updates)) privateState[id] = envelope;
      if (removeId) delete privateState[removeId];
      const roster = Array.isArray(currentState.players)
        ? currentState.players.filter(item => !removeId || item.id !== removeId)
        : [];
      const nextState = {
        ...currentState,
        phase: patch.phase,
        matchId: patch.matchId,
        ...(removeId ? { players: roster } : {}),
        game: {
          version: patch.version,
          public: patch.public,
          priv: privateState,
          last: { events: patch.events },
        },
      };
      this.data = { ...this.data, state: nextState, updatedAt: Math.max(Date.now(), (Number(this.data.updatedAt) || 0) + 1) };
      await this.save();
      this.loaded = true;
      this.send(ws, {
        type: "game-patch-result",
        requestId,
        result: { ok: true, updatedAt: this.data.updatedAt, version: patch.version },
      });
      const common = {
        phase: patch.phase,
        matchId: patch.matchId,
        version: patch.version,
        public: patch.public,
        events: patch.events,
        removeId,
      };
      for (const [peerSocket, peer] of this.sockets) {
        if (peer.id === player.id) continue;
        this.send(peerSocket, {
          type: "message",
          message: {
            id: requestId,
            from: player.id,
            type: "unon-patch",
            data: {
              ...common,
              privateEnvelope: Object.prototype.hasOwnProperty.call(updates, peer.id)
                ? updates[peer.id]
                : null,
            },
            at: this.data.updatedAt,
          },
        });
      }
      return;
    }
    if (message.type === "message") {
      const eventType = String(message.messageType || "data");
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(eventType)) {
        this.send(ws, { type: "error", error: "invalid_event_type" });
        return;
      }
      const item = {
        id: crypto.randomUUID(),
        from: player.id,
        type: eventType,
        data: message.data === undefined ? null : message.data,
        at: Date.now(),
      };
      this.broadcast({ type: "message", message: item }, player.id);
      return;
    }
    this.send(ws, { type: "error", error: "unsupported_type" });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "kuro-online-room", transport: "cloudflare-durable-objects", auth: "signed-in-kurolab-account-only" });
    }
    if (url.pathname === "/guest-token" || url.pathname === "/guest/verify") {
      const headers = corsHeaders(request, env);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      return json({ error: "account_required", message: "オンライン対戦にはKUROアカウントへのログインが必要です。" }, 410, headers);
    }
    if (url.pathname === "/ticket") return createTicket(request, env);
    if (url.pathname === "/verify-unon-win" && request.method === "POST") {
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 8192) return json({ error: "proof_too_large" }, 413);
        body = JSON.parse(raw);
      } catch (_) {
        return json({ error: "invalid_json" }, 400);
      }
      const claims = await verifyTicket(body && body.proof, env.TICKET_SECRET || "");
      if (!claims || claims.typ !== "unon_win" || claims.game !== UNON_GAME_ID ||
          !UUID_RE.test(String(claims.sub || "")) ||
          !UUID_RE.test(String(claims.match || "")) ||
          !validId(claims.room)) {
        return json({ error: "invalid_or_expired_unon_win_proof" }, 403, { "cache-control": "no-store" });
      }
      return json({
        ok: true,
        claims: {
          typ: claims.typ,
          sub: claims.sub,
          room: claims.room,
          game: claims.game,
          match: claims.match,
          exp: claims.exp,
        },
      }, 200, { "cache-control": "no-store" });
    }
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,128})$/);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket_required" }, 426);
      const roomId = match[1];
      const claims = await verifyTicket(url.searchParams.get("ticket"), env.TICKET_SECRET || "");
      if (!claims || claims.typ !== "kuro_account" || claims.room !== roomId) return json({ error: "invalid_or_expired_ticket" }, 401);
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      headers.set("x-kuro-user-id", claims.sub);
      headers.set("x-kuro-user-name", claims.name || "プレイヤー");
      headers.set("x-kuro-user-host", claims.host === true ? "1" : "0");
      headers.set("x-kuro-game-id", claims.game);
      headers.set("x-kuro-room-id", roomId);
      const forwarded = new Request(request, { headers });
      const roomKey = claims.game + ":" + roomId;
      return env.ROOMS.get(env.ROOMS.idFromName(roomKey)).fetch(forwarded);
    }
    return json({ error: "not_found" }, 404);
  },
};
