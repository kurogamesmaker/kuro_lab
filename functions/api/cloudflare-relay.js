const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const ALLOWED_PREFIXES = ["/rest/v1/","/auth/v1/","/storage/v1/"];
const ALLOWED_FUNCTIONS = new Set(["/functions/v1/admin-console","/functions/v1/pro-access","/functions/v1/send-chat-push","/functions/v1/kurogames-online","/functions/v1/kurogames-secret","/functions/v1/username-auth","/functions/v1/kurogames-activity","/functions/v1/change-password"]);
const ALLOWED_METHODS = new Set(["GET","POST","PUT","PATCH","DELETE","HEAD"]);
function json(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function validatePath(value) {
  const path=String(value||"");
  if(!path.startsWith("/")||path.includes("..")||path.includes("://"))throw new Error("Invalid Supabase path");
  const pathname=path.split("?")[0];
  if(!ALLOWED_PREFIXES.some(prefix=>pathname.startsWith(prefix))&&!ALLOWED_FUNCTIONS.has(pathname))throw new Error("Supabase service is not allowed");
  const target=new URL(path,SUPABASE_URL);
  if(target.origin!==SUPABASE_URL)throw new Error("Invalid Supabase origin");
  return target;
}
function decodeBase64(value) {
  const binary=atob(String(value||""));const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function encodeBase64(bytes) {
  let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return btoa(binary);
}
function safeHeaders(input) {
  const allowed=new Set(["authorization","apikey","content-type","accept","prefer","range","if-match","if-none-match","cache-control","accept-profile","content-profile","x-client-info","x-client-version","x-upsert","x-storage-api-version"]);
  const h=new Headers();for(const [k,v] of Object.entries(input||{}))if(allowed.has(k.toLowerCase())&&v!=null)h.set(k,String(v));
  if(!h.has("apikey"))h.set("apikey",SUPABASE_KEY);if(!h.has("authorization"))h.set("authorization","Bearer "+SUPABASE_KEY);
  return h;
}
async function checkActiveSuspension(headers) {
  const authorization=headers.get("authorization")||"";
  if(!/^Bearer\\s+.+/i.test(authorization))return null;
  const authHeaders=new Headers({apikey:headers.get("apikey")||SUPABASE_KEY,authorization});
  const userResponse=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:authHeaders});
  if(!userResponse.ok)return null;
  const user=await userResponse.json().catch(()=>null);
  if(!user||!user.id||user.is_anonymous)return null;
  const now=new Date().toISOString();
  const query=new URLSearchParams({
    select:"id,ends_at",
    user_id:"eq."+user.id,
    revoked_at:"is.null",
    starts_at:"lte."+now,
    ends_at:"gt."+now,
    limit:"1"
  });
  const statusResponse=await fetch(SUPABASE_URL+"/rest/v1/account_suspensions?"+query.toString(),{headers:authHeaders});
  if(!statusResponse.ok)throw Object.assign(new Error("アカウントの利用状態を確認できません。時間をおいて再度お試しください。"),{status:503});
  const rows=await statusResponse.json().catch(()=>[]);
  return Array.isArray(rows)&&rows.length?rows[0]:null;
}
function isSuspensionAllowedWrite(pathname,method) {
  if(pathname==="/rest/v1/account_suspension_appeals"&&method==="POST")return true;
  if(pathname==="/rest/v1/account_suspension_appeal_messages"&&method==="POST")return true;
  if(pathname==="/rest/v1/admin_message_reads"&&["POST","PATCH","DELETE"].includes(method))return true;
  if(pathname==="/functions/v1/change-password")return true;
  if(pathname==="/rest/v1/usage_events"&&method==="POST")return true;
  return false;
}
async function proxy(payload) {
  const target=validatePath(payload.path),method=String(payload.method||"GET").toUpperCase();
  if(!ALLOWED_METHODS.has(method))throw Object.assign(new Error("Method not allowed"),{status:405});
  const headers=safeHeaders(payload.headers);
  if(!["GET","HEAD"].includes(method)&&
     (target.pathname.startsWith("/rest/v1/")||target.pathname.startsWith("/functions/v1/"))&&
     !isSuspensionAllowedWrite(target.pathname,method)) {
    const suspension=await checkActiveSuspension(headers);
    if(suspension) {
      return {status:403,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
        isBinary:false,bodyBase64:"",bodyText:JSON.stringify({code:"ACCOUNT_TEMPORARILY_SUSPENDED",error:"このアカウントは一時停止中です。解除予定："+suspension.ends_at+"。問い合わせは一時停止画面から行えます。",ends_at:suspension.ends_at}),service:"KURO account suspension guard"};
    }
  }
  const body=!["GET","HEAD"].includes(method)&&payload.bodyBase64?decodeBase64(payload.bodyBase64):undefined;
  const upstream=await fetch(target.href,{method,headers,body,redirect:"manual"});
  const headers={};for(const k of ["content-type","cache-control","etag","content-range","accept-ranges","last-modified","location","x-request-id","preference-applied"]){const v=upstream.headers.get(k);if(v)headers[k]=v;}
  const bytes=new Uint8Array(await upstream.arrayBuffer()),type=String(upstream.headers.get("content-type")||"application/octet-stream");
  const isBinary=!/(json|text|xml|javascript|form|csv)/i.test(type);
  return {status:upstream.status,headers,isBinary,bodyBase64:isBinary?encodeBase64(bytes):"",bodyText:isBinary?"":new TextDecoder().decode(bytes),service:"KURO Cloudflare Supabase Proxy"};
}
export async function onRequest(context) {
  const {request}=context;try {
    const url=new URL(request.url);
    if(request.method==="GET"&&url.searchParams.get("health")==="1")return json({ready:true,service:"KURO Cloudflare Supabase Proxy",transport:"cloudflare-worker",realtimeProxy:true});
    if(request.method==="GET") {
      const target=validatePath(url.searchParams.get("resource"));
      if(!target.pathname.startsWith("/storage/v1/object/public/"))return json({error:"Only public Storage objects may be fetched here"},403);
      const upstream=await fetch(target.href,{headers:safeHeaders({})});
      return new Response(await upstream.arrayBuffer(),{status:upstream.status,headers:{"Content-Type":upstream.headers.get("content-type")||"application/octet-stream","Cache-Control":"public, max-age=300, stale-while-revalidate=600"}});
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    return json(await proxy(await request.json()));
  }catch(error){return json({ok:false,error:error&&error.message||"KURO Cloudflare proxy failed"},Number(error&&error.status)||502);}
}
