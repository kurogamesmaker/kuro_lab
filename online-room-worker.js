export class Room {
 constructor(state,env){this.state=state;this.env=env;this.sockets=new Set();this.data={id:state.id.toString(),createdAt:Date.now(),players:[],state:null,messages:[],seq:0};this.loaded=false;}
 async load(){if(this.loaded)return;const saved=await this.state.storage.get("room-data");if(saved)this.data=saved;this.loaded=true;}
 async save(){await this.state.storage.put("room-data",this.data);}
 async fetch(req){
  await this.load();
  const url=new URL(req.url);
  if(url.pathname==="/health")return Response.json({ok:true,service:"kuro-online-room",room:this.data.id});
  if(req.headers.get("Upgrade")!=="websocket")return Response.json({error:"WebSocket required"},{status:426});
  const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();this.sockets.add(server);
  server.addEventListener("close",()=>this.sockets.delete(server));server.addEventListener("error",()=>this.sockets.delete(server));
  server.addEventListener("message",ev=>{this.onMessage(server,ev.data).catch(()=>{try{server.send(JSON.stringify({type:"error",error:"storage_error"}))}catch{}})});
  server.send(JSON.stringify({type:"welcome",room:this.data.id,players:this.data.players,state:this.data.state,messages:this.data.messages}));
  return new Response(null,{status:101,webSocket:client});
 }
 broadcast(payload){const encoded=JSON.stringify(payload);for(const ws of this.sockets){try{ws.send(encoded)}catch{this.sockets.delete(ws)}}}
 async onMessage(ws,raw){
  let msg;try{msg=JSON.parse(raw)}catch{ws.send(JSON.stringify({type:"error",error:"invalid_json"}));return}
  if(!msg||typeof msg.type!=="string"){ws.send(JSON.stringify({type:"error",error:"invalid_message"}));return}
  if(msg.type==="join"){
   const id=String(msg.playerId||"").slice(0,100),name=String(msg.name||"Player").slice(0,40);if(!id){ws.send(JSON.stringify({type:"error",error:"player_id_required"}));return}
   const player=this.data.players.find(p=>p.id===id);if(player)player.name=name;else this.data.players.push({id,name,joinedAt:Date.now()});
   await this.save();this.broadcast({type:"players",players:this.data.players});ws.send(JSON.stringify({type:"joined",playerId:id,players:this.data.players}));
  }else if(msg.type==="leave"){
   const id=String(msg.playerId||"");this.data.players=this.data.players.filter(p=>p.id!==id);await this.save();this.broadcast({type:"players",players:this.data.players});
  }else if(msg.type==="state"){
   this.data.state=msg.state;await this.save();this.broadcast({type:"state",state:this.data.state,from:String(msg.playerId||"")});
  }else if(msg.type==="message"){
   const message={id:++this.data.seq,from:String(msg.playerId||"").slice(0,100),type:String(msg.messageType||"data").slice(0,50),data:msg.data,at:Date.now()};
   this.data.messages.push(message);if(this.data.messages.length>100)this.data.messages.shift();await this.save();this.broadcast({type:"message",message});
  }else if(msg.type==="ping")ws.send(JSON.stringify({type:"pong",at:Date.now()}));
  else ws.send(JSON.stringify({type:"error",error:"unsupported_type"}));
 }
}
export default {async fetch(req,env){
 const url=new URL(req.url);if(url.pathname==="/health")return Response.json({ok:true,service:"kuro-online-room",transport:"cloudflare-durable-objects"});
 if(url.pathname.startsWith("/room/")){const id=url.pathname.split("/")[2];if(!id||id.length>128)return Response.json({error:"invalid_room_id"},{status:400});return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(req)}
 return Response.json({error:"not_found"},{status:404});
}};