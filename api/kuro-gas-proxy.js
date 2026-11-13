const ALLOWED_PREFIXES = ['/rest/v1/', '/auth/v1/', '/storage/v1/'];
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

function validatePath(value) {
  const path = String(value || '');
  if (!path.startsWith('/') || path.includes('..') || path.includes('://')) throw new Error('Invalid Supabase path');
  if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) throw new Error('Supabase service is not allowed through this proxy');
  return path;
}
function sendJson(res, status, value) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(value);
}
async function callAppsScript(payload) {
  const gasUrl = process.env.KURO_GAS_WEB_APP_URL;
  const secret = process.env.KURO_GAS_PROXY_SECRET;
  if (!gasUrl || !secret) {
    const error = new Error('GAS connection is not configured');
    error.statusCode = 503;
    throw error;
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl)) {
    const error = new Error('KURO_GAS_WEB_APP_URL must be the deployed Apps Script /exec URL');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch(gasUrl, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ ...payload, secret }), redirect: 'follow'
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch (_) { throw new Error('Apps Script returned non-JSON. Check its web-app deployment access setting.'); }
  if (!result || (typeof result.status !== 'number' && result.service !== 'KURO SNS GAS Proxy')) throw new Error('Unexpected response from Apps Script');
  return result;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query && req.query.health === '1') {
      const gasUrl = process.env.KURO_GAS_WEB_APP_URL;
      const secret = process.env.KURO_GAS_PROXY_SECRET;
      if (!gasUrl || !secret) return sendJson(res, 200, { ready: false, reason: 'missing_environment_variables' });
      const ping = await fetch(gasUrl, { method: 'GET', redirect: 'follow' });
      const text = await ping.text();
      let data = {};
      try { data = JSON.parse(text); } catch (_) {}
      return sendJson(res, 200, { ready: Boolean(ping.ok && data.ok && data.service === 'KURO SNS GAS Proxy'), service: data.service || null });
    }

    if (req.method === 'GET') {
      const path = validatePath(req.query && req.query.resource);
      if (!path.startsWith('/storage/v1/object/public/avatars/')) return sendJson(res, 403, { error: 'Only public avatar images may be fetched here' });
      const result = await callAppsScript({ path, method: 'GET', headers: {}, bodyBase64: '', clientId: 'avatar-read' });
      if (result.isBinary && result.bodyBase64) {
        res.setHeader('Content-Type', result.headers && result.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
        return res.status(result.status || 200).send(Buffer.from(result.bodyBase64, 'base64'));
      }
      res.setHeader('Content-Type', result.headers && result.headers['content-type'] || 'application/json; charset=utf-8');
      return res.status(result.status || 502).send(result.bodyText || '');
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const path = validatePath(input.path);
    const method = String(input.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return sendJson(res, 405, { error: 'Supabase method is not allowed' });
    const result = await callAppsScript({
      path, method, headers: input.headers || {},
      bodyBase64: String(input.bodyBase64 || ''), clientId: String(input.clientId || 'anonymous')
    });
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, Number(error.statusCode) || 502, { ok: false, error: error.message || 'KURO GAS proxy failed' });
  }
};
module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
