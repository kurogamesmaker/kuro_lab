const ALLOWED_ORIGINS = new Set([
  "https://kurolab.cc.cd",
  "https://www.kurolab.cc.cd",
  "https://admin.kurolab.cc.cd"
]);
const TOOL_NAMES = new Set(["admin","center","shop-studio","game-studio","security-monitor"]);

function cors(origin: string | null): Record<string,string> {
  const headers: Record<string,string> = {
    "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Cache-Control":"no-store",
    "Vary":"Origin"
  };
  if(origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"]=origin;
  return headers;
}

function reply(body: unknown,status=200,origin: string|null=null) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8"}
  });
}

// Compatibility entry point only. Authorization, risk evaluation and audit
// storage are performed by the Cloudflare Worker against the private D1 DB.
Deno.serve(async (req: Request) => {
  const origin=req.headers.get("Origin");
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors(origin)});
  if(req.method!=="POST") return reply({error:"Method not allowed"},405,origin);
  if(!origin || !ALLOWED_ORIGINS.has(origin)) return reply({error:"Origin not allowed"},403,origin);
  const authorization=req.headers.get("Authorization")||"";
  if(!authorization.startsWith("Bearer ")) return reply({error:"認証情報がありません。"},401,origin);

  let body: Record<string,unknown>;
  try {
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>4096) return reply({error:"Request too large"},413,origin);
    const parsed=raw?JSON.parse(raw):{};
    if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Invalid body");
    body=parsed as Record<string,unknown>;
  } catch {
    return reply({error:"Invalid JSON body"},400,origin);
  }

  const action=typeof body.action==="string"?body.action:"check";
  const tool=typeof body.tool==="string"?body.tool:"";
  if(!["check","events"].includes(action) || !TOOL_NAMES.has(tool)) {
    return reply({error:"操作または保護対象の指定が正しくありません。"},400,origin);
  }

  const headers=new Headers({
    "Authorization":authorization,
    "Origin":origin,
    "Content-Type":"application/json",
    "Accept":"application/json"
  });
  for(const name of ["User-Agent","Sec-CH-UA-Platform","Accept-Language","X-Real-IP","CF-Connecting-IP"]) {
    const value=req.headers.get(name);
    if(value) headers.set(name,value);
  }

  try {
    const upstream=await fetch("https://kurolab.cc.cd/api/kuro-d1/security-gate",{
      method:"POST",
      headers,
      body:JSON.stringify({action,tool}),
      signal:AbortSignal.timeout(10000)
    });
    const payload=await upstream.json().catch(()=>({}));
    return reply(payload,upstream.status,origin);
  } catch(error) {
    console.error("[kuro-security-gate] Cloudflare D1 request failed",error);
    return reply({
      allowed:false,decision:"error",
      message:"セキュリティ検証を完了できませんでした。安全のためアクセスを停止しました。"
    },503,origin);
  }
});
