import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivate(ip) {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 168 || p[1] === 0 || p[1] === 2)) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51)) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
}
async function resolvePublic(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error("URLの形式が正しくありません"); }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("HTTP / HTTPSのURLのみ利用できます");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("このホストは確認できません");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(x => isPrivate(x.address))) throw new Error("ローカル・プライベートネットワークのアドレスは利用できません");
  return { url: u, host, address: addresses[0].address };
}
function requestOnce(raw, method, maxBytes) {
  return resolvePublic(raw).then(function(target) {
    const u = target.url, family = isIP(target.address), transport = u.protocol === "https:" ? https : http;
    return new Promise(function(resolve, reject) {
      let size = 0, chunks = [];
      const req = transport.request({
        protocol: u.protocol, hostname: target.host, port: u.port || undefined,
        path: u.pathname + u.search, method, servername: family ? undefined : target.host,
        headers: { "User-Agent": "KURO-Lab-Toolbox/1.0", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", ...(method === "GET" ? { "Range": "bytes=0-1600000" } : {}) },
        lookup: function(hostname, options, callback) {
          if (options && options.all) callback(null, [{ address: target.address, family }]);
          else callback(null, target.address, family);
        }
      }, function(response) {
        response.on("data", function(chunk) {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(new Error("応答データが大きすぎます")); return; }
          chunks.push(chunk);
        });
        response.on("end", function() {
          resolve({ status: response.statusCode || 0, statusText: response.statusMessage || "", headers: response.headers, body: Buffer.concat(chunks), url: u.href });
        });
      });
      req.setTimeout(8000, function() { req.destroy(new Error("接続がタイムアウトしました")); });
      req.on("error", reject);
      req.end();
    });
  });
}
async function fetchPublic(raw, method, maxBytes, depth) {
  if (depth > 3) throw new Error("リダイレクトが多すぎます");
  const result = await requestOnce(raw, method, maxBytes);
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
    const next = new URL(result.headers.location, result.url).href;
    return fetchPublic(next, method === "HEAD" && result.status === 303 ? "GET" : method, maxBytes, depth + 1);
  }
  return result;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!raw || raw.length > 1800) return res.status(400).json({ error: "有効なURLを指定してください" });
  const started = Date.now();
  try {
    let result = await fetchPublic(raw, "HEAD", 20000, 0);
    if (result.status === 405 || result.status === 501) result = await fetchPublic(raw, "GET", 10000, 0);
    return res.status(200).json({
      ok: result.status >= 200 && result.status < 400,
      status: result.status,
      statusText: result.statusText,
      finalUrl: result.url,
      elapsedMs: Date.now() - started
    });
  } catch (error) {
    return res.status(502).json({ error: error && error.message ? error.message : "接続できませんでした" });
  }
}