const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_FIELDS = "id,username,display_name,kuro_id,avatar_url,bio,created_at";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    }
  });
}

/**
 * Public, read-only KURO SNS profile/follow queries.
 * Supabase Auth remains the identity authority. Only public profile fields
 * are returned; no email, auth metadata, or private account settings are read.
 */
export async function handleKuroD1PublicProfiles(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db = env?.KURO_APP_DB;
  if (!db) return json({ error: "Cloudflare D1に接続できません。" }, 503);

  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "");
  if (!UUID_RE.test(id)) return json({ error: "プロフィールIDが正しくありません。" }, 400);

  const list = String(url.searchParams.get("list") || "");
  if (list) {
    if (list !== "followers" && list !== "following") {
      return json({ error: "一覧の種類が正しくありません。" }, 400);
    }
    try {
      const query = list === "followers"
        ? `SELECT p.${PROFILE_FIELDS.replace(/,/g, ",p.")} FROM follows f
           INNER JOIN profiles p ON p.id = f.follower_id
           WHERE f.following_id = ?
           ORDER BY f.created_at DESC LIMIT 100`
        : `SELECT p.${PROFILE_FIELDS.replace(/,/g, ",p.")} FROM follows f
           INNER JOIN profiles p ON p.id = f.following_id
           WHERE f.follower_id = ?
           ORDER BY f.created_at DESC LIMIT 100`;
      const result = await db.prepare(query).bind(id).all();
      return json({ rows: Array.isArray(result?.results) ? result.results : [], source: "cloudflare-d1" });
    } catch (error) {
      console.error("KURO D1 public follow list failed", error?.message || error);
      return json({ error: "フォロー一覧を取得できませんでした。" }, 503);
    }
  }

  const viewerId = String(url.searchParams.get("viewerId") || "");
  if (viewerId && !UUID_RE.test(viewerId)) return json({ error: "閲覧者IDが正しくありません。" }, 400);

  try {
    const [profile, followers, following, relation] = await Promise.all([
      db.prepare(`SELECT ${PROFILE_FIELDS} FROM profiles WHERE id = ? LIMIT 1`).bind(id).first(),
      db.prepare("SELECT COUNT(*) AS total FROM follows WHERE following_id = ?").bind(id).first(),
      db.prepare("SELECT COUNT(*) AS total FROM follows WHERE follower_id = ?").bind(id).first(),
      viewerId && viewerId !== id
        ? db.prepare("SELECT 1 AS is_following FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1").bind(viewerId, id).first()
        : Promise.resolve(null)
    ]);
    return json({
      profile: profile || null,
      counts: {
        followers: Number(followers?.total || 0),
        following: Number(following?.total || 0)
      },
      isFollowing: Boolean(relation),
      source: "cloudflare-d1"
    });
  } catch (error) {
    console.error("KURO D1 public profile read failed", error?.message || error);
    return json({ error: "プロフィールを取得できませんでした。" }, 503);
  }
}
