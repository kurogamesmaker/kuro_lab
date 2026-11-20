const SUPABASE_URL = 'https://cprvpphlfpmiegjiutjn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn';
const ALLOWED_PREFIXES = ['/rest/v1/', '/auth/v1/', '/storage/v1/'];
const ALLOWED_FUNCTIONS = new Set(['/functions/v1/admin-console','/functions/v1/pro-access','/functions/v1/send-chat-push','/functions/v1/kurogames-online','/functions/v1/kurogames-secret']);
const ALLOWED_METHODS = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD']);

function validatePath(value) {
  const path = String(value || '');
  if (!path.startsWith('/') || path.includes('..') || path.includes('://')) throw new Error('Invalid Supabase path');
  const pathname = path.split('?')[0];
  if (!ALLOWED_PREFIXES.some(prefix => pathname.startsWith(prefix)) && !ALLOWED_FUNCTIONS.has(pathname)) {
    throw new Error('Supabase service is not allowed');
  }
  const target = new URL(path, SUPABASE_URL);
  if (target.origin !== SUPABASE_URL) throw new Error('Invalid Supabase origin');
  return target;
}
function decodeBase64(value) { return Buffer.from(String(value || ''), 'base64'); }
function encodeBase64(bytes) { return Buffer.from(bytes).toString('base64'); }
function safeHeaders(input) {
  const allowed = new Set(['authorization','apikey','content-type','accept','prefer','range','if-match','if-none-match','cache-control','accept-profile','content-profile','x-client-info','x-client-version','x-upsert','x-storage-api-version']);
  const h = new Headers();
  Object.entries(input || {}).forEach(([k,v]) => { if (allowed.has(k.toLowerCase()) && v != null) h.set(k,String(v)); });
  if (!h.has('apikey')) h.set('apikey',SUPABASE_KEY);
  if (!h.has('authorization')) h.set('authorization','Bearer '+SUPABASE_KEY);
  return h;
}
function json(res,status,value) { res.setHeader('Cache-Control','no-store'); return res.status(status).json(value); }
async function proxy(payload) {
  const target=validatePath(payload.path);
  const method=String(payload.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw Object.assign(new Error('Method not allowed'),{statusCode:405});
  const body=(!['GET','HEAD'].includes(method) && payload.bodyBase64) ? decodeBase64(payload.bodyBase64) : undefined;
  const upstream=await fetch(target.href,{method,headers:safeHeaders(payload.headers),body,redirect:'manual'});
  const headers={};
  ['content-type','cache-control','etag','content-range','accept-ranges','last-modified','location','x-request-id'].forEach(k=>{const v=upstream.headers.get(k);if(v)headers[k]=v;});
  const bytes=Buffer.from(await upstream.arrayBuffer());
  const type=String(upstream.headers.get('content-type')||'application/octet-stream');
  const isBinary=!/(json|text|xml|javascript|form|csv)/i.test(type);
  return {status:upstream.status,headers,isBinary,bodyBase64:isBinary?encodeBase64(bytes):'',bodyText:isBinary?'':bytes.toString('utf8'),service:'KURO Cloudflare Supabase Proxy'};
}
module.exports = async function handler(req,res) {
  try {
    if (req.method==='GET' && req.query && req.query.health==='1') return json(res,200,{ready:true,service:'KURO Cloudflare Supabase Proxy',transport:'cloudflare-worker'});
    if (req.method==='GET') {
      const target=validatePath(req.query && req.query.resource);
      if (!target.pathname.startsWith('/storage/v1/object/public/avatars/')) return json(res,403,{error:'Only public avatar images may be fetched here'});
      const upstream=await fetch(target.href,{headers:safeHeaders({})});
      const bytes=Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');
      res.setHeader('Cache-Control','public, max-age=300, stale-while-revalidate=600');
      return res.status(upstream.status).send(bytes);
    }
    if (req.method!=='POST') return json(res,405,{error:'Method not allowed'});
    const input=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
    return json(res,200,await proxy(input));
  } catch(error) {
    return json(res,Number(error.statusCode)||502,{ok:false,error:error.message||'KURO Cloudflare proxy failed'});
  }
};
module.exports.config={api:{bodyParser:{sizeLimit:'4mb'}}};
