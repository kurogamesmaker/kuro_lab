import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 168 || p[1] === 0)) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("URLの形式が正しくありません"); }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("HTTP / HTTPSのURLのみ利用できます");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("このホストは確認できません");
  const literal = isIP(host);
  const addresses = literal ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(x => privateAddress(x.address))) throw new Error("ローカル・プライベートネットワークのアドレスは利用できません");
  return u;
}
async function fetchPublic(raw, method) {
  let current = raw, response;
  for (let i = 0; i < 4; i++) {
    await validatePublicUrl(current);
    response = await fetch(current, { method, redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "KURO-Lab-Toolbox/1.0", ...(method === "GET" ? { "Range": "bytes=0-1500000" } : {}) } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current };
    const location = response.headers.get("location");
    if (!location) return { response, url: current };
    current = new URL(location, current).href;
  }
  throw new Error("リダイレクトが多すぎます");
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!raw || raw.length > 1800) return res.status(400).json({ error: "有効なフィードURLを指定してください" });
  try {
    const { response } = await fetchPublic(raw, "GET");
    if (!response.ok) return res.status(502).json({ error: "フィード配信元がHTTP " + response.status + "を返しました" });
    const type = response.headers.get("content-type") || "";
    if (type && !/xml|rss|atom|text\/plain|octet-stream/i.test(type)) return res.status(415).json({ error: "RSS / Atom形式ではないようです" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1600000) return res.status(413).json({ error: "フィードが大きすぎます" });
    return res.status(200).setHeader("Content-Type", "application/xml; charset=utf-8").send(Buffer.from(bytes));
  } catch (error) {
    return res.status(400).json({ error: error && error.message ? error.message : "フィードを取得できませんでした" });
  }
}