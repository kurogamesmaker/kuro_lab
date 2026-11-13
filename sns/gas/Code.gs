/**
 * KURO SNS GAS Bridge
 * Browser -> Vercel API -> this Apps Script -> Supabase.
 * Do not add Supabase service_role or secret keys here.
 */
const KURO_SUPABASE_URL = 'https://cprvpphlfpmiegjiutjn.supabase.co';
const KURO_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn';
const KURO_SECRET_PROPERTY = 'KURO_GAS_PROXY_SECRET';
const KURO_ALLOWED_PREFIXES = ['/rest/v1/', '/auth/v1/', '/storage/v1/'];
const KURO_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const KURO_ALLOWED_REQUEST_HEADERS = [
  'accept', 'accept-profile', 'authorization', 'cache-control',
  'content-profile', 'content-type', 'prefer', 'range', 'range-unit',
  'x-client-info', 'x-upsert', 'content-range', 'x-signature'
];
const KURO_ALLOWED_RESPONSE_HEADERS = [
  'content-type', 'content-range', 'cache-control', 'etag',
  'last-modified', 'content-disposition', 'preference-applied',
  'x-total-count', 'location'
];

function doGet() {
  return kuroJsonOutput({ ok: true, service: 'KURO SNS GAS Proxy', version: 1 });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return kuroJsonOutput({ ok: false, status: 400, headers: {}, bodyText: '{"message":"Missing request body"}' });
    }
    if (e.postData.length > 4 * 1024 * 1024) {
      return kuroJsonOutput({ ok: false, status: 413, headers: {}, bodyText: '{"message":"Request is too large"}' });
    }
    var input = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty(KURO_SECRET_PROPERTY);
    if (!expectedSecret || !kuroConstantTimeEquals(String(input.secret || ''), expectedSecret)) {
      return kuroJsonOutput({ ok: false, status: 403, headers: {}, bodyText: '{"message":"GAS proxy authentication failed"}' });
    }
    var path = kuroValidatePath(input.path);
    var method = String(input.method || 'GET').toUpperCase();
    if (KURO_ALLOWED_METHODS.indexOf(method) === -1) {
      return kuroJsonOutput({ ok: false, status: 405, headers: {}, bodyText: '{"message":"Method not allowed"}' });
    }
    var clientId = String(input.clientId || 'anonymous').slice(0, 120);
    if (!kuroWithinRateLimit(clientId)) {
      return kuroJsonOutput({ ok: false, status: 429, headers: {}, bodyText: '{"message":"Too many requests. Please retry shortly."}' });
    }
    var requestHeaders = {};
    var suppliedHeaders = input.headers || {};
    Object.keys(suppliedHeaders).forEach(function(name) {
      var lower = String(name).toLowerCase();
      if (KURO_ALLOWED_REQUEST_HEADERS.indexOf(lower) !== -1) requestHeaders[lower] = String(suppliedHeaders[name]);
    });
    requestHeaders['apikey'] = KURO_SUPABASE_PUBLISHABLE_KEY;
    if (!requestHeaders['authorization']) requestHeaders['authorization'] = 'Bearer ' + KURO_SUPABASE_PUBLISHABLE_KEY;
    var options = { method: method.toLowerCase(), headers: requestHeaders, muteHttpExceptions: true, followRedirects: true };
    if (method !== 'GET' && method !== 'HEAD') {
      var encoded = String(input.bodyBase64 || '');
      options.payload = encoded ? Utilities.base64Decode(encoded) : '';
      if (requestHeaders['content-type']) options.contentType = requestHeaders['content-type'];
    }
    var upstream = UrlFetchApp.fetch(KURO_SUPABASE_URL + path, options);
    var status = upstream.getResponseCode();
    var allHeaders = upstream.getAllHeaders();
    var responseHeaders = {};
    Object.keys(allHeaders).forEach(function(name) {
      var lower = String(name).toLowerCase();
      if (KURO_ALLOWED_RESPONSE_HEADERS.indexOf(lower) !== -1) responseHeaders[lower] = String(allHeaders[name]);
    });
    var contentType = String(responseHeaders['content-type'] || '');
    var binary = /^(image\/|audio\/|video\/|application\/octet-stream|application\/pdf)/i.test(contentType);
    var result = { ok: status >= 200 && status < 400, status: status, headers: responseHeaders, isBinary: binary };
    if (binary) result.bodyBase64 = Utilities.base64Encode(upstream.getContent());
    else result.bodyText = upstream.getContentText();
    return kuroJsonOutput(result);
  } catch (error) {
    return kuroJsonOutput({
      ok: false, status: 502,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ message: 'KURO GAS proxy error', detail: String(error && error.message || error) })
    });
  }
}

function kuroValidatePath(value) {
  var path = String(value || '');
  if (!path || path.charAt(0) !== '/' || path.indexOf('..') !== -1 || path.indexOf('://') !== -1) throw new Error('Invalid upstream path');
  var allowed = KURO_ALLOWED_PREFIXES.some(function(prefix) { return path.indexOf(prefix) === 0; });
  if (!allowed) throw new Error('Upstream path is not allowed');
  return path;
}

function kuroWithinRateLimit(clientId) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clientId, Utilities.Charset.UTF_8);
  var key = 'kuro_rate_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(key) || 0);
  if (count >= 180) return false;
  cache.put(key, String(count + 1), 60);
  return true;
}

function kuroConstantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function kuroJsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function initializeProxySecret() {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty(KURO_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    properties.setProperty(KURO_SECRET_PROPERTY, secret);
  }
  Logger.log('Set Vercel KURO_GAS_PROXY_SECRET to: ' + secret);
  return 'Proxy secret is initialized. Copy the value from the execution log to Vercel.';
}
