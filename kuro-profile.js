(function () {
  "use strict";

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var modal = null;
  var content = null;
  var requestId = 0;
  var snsMoreAction = null;

  function getDb() {
    return window.kuroSNSDB || window.kuroGamesDB || window.kuroPortalDB || null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(String(value), window.location.origin);
      if (url.protocol === "https:" || (url.protocol === "http:" && url.origin === window.location.origin)) return url.href;
    } catch (_) {}
    return "";
  }

  function modeLabel(mode) {
    var labels = {
      "default": "通常", "normal": "通常", "solo": "ソロ", "online": "オンライン",
      "bot": "CPU戦", "wins-bot": "CPU戦", "wins-online": "オンライン",
      "wins-solo": "ソロ", "time": "タイムアタック",
      "number-time-easy": "タイムアタック（かんたん）",
      "number-time-normal": "タイムアタック（ふつう）",
      "number-time-hard": "タイムアタック（むずかしい）",
      "number-attack-easy": "通常（かんたん）",
      "number-attack-normal": "通常（ふつう）",
      "number-attack-hard": "通常（むずかしい）",
      "vanish": "消えるルール", "gobble": "食べるルール", "reverse": "リバース",
      "beginner": "初級", "intermediate": "中級", "advanced": "上級"
    };
    if (labels[mode]) return labels[mode];
    return String(mode || "通常").replace(/[_-]+/g, " ");
  }

  function formatTime(ms) {
    var value = Math.max(0, Number(ms) || 0);
    var minutes = Math.floor(value / 60000);
    var seconds = Math.floor((value % 60000) / 1000);
    var millis = Math.floor(value % 1000);
    return minutes + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
  }

  function getModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "kuroCommonProfileModal";
    modal.className = "kuro-profile-overlay";
    modal.hidden = true;
    modal.innerHTML =
      '<section class="kuro-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="kuroProfileTitle" tabindex="-1">' +
        '<header class="kuro-profile-topbar"><div><span class="kuro-profile-eyebrow">KURO COMMON PROFILE</span><h2 id="kuroProfileTitle">プロフィール</h2></div>' +
        '<button type="button" class="kuro-profile-close" aria-label="プロフィールを閉じる">×</button></header>' +
        '<main class="kuro-profile-content" id="kuroProfileContent"><div class="kuro-profile-loading">プロフィールを読み込み中…</div></main>' +
        '<footer class="kuro-profile-footer"><button type="button" class="kuro-profile-sns-more" hidden>SNSの投稿を見る</button><span>KURO IDで共通のプロフィール</span></footer>' +
      '</section>';
    document.body.appendChild(modal);
    content = modal.querySelector("#kuroProfileContent");
    modal.addEventListener("click", function (event) {
      if (event.target === modal || event.target.closest(".kuro-profile-close")) close();
      var more = event.target.closest(".kuro-profile-sns-more");
      if (more && !more.hidden) {
        var action = snsMoreAction;
        close();
        if (typeof action === "function") {
          Promise.resolve().then(action).catch(function (error) {
            console.warn("KURO SNS profile detail open failed:", error);
          });
        }
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal && !modal.hidden) close();
    });
    return modal;
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    snsMoreAction = null;
  }

  function renderStats(rows) {
    if (!Array.isArray(rows)) rows = [];
    var totalPlays = 0, totalWins = 0, gameMap = new Map();
    rows.forEach(function (row) {
      var plays = Number(row.plays) || 0;
      var wins = Number(row.wins) || 0;
      totalPlays += plays;
      totalWins += wins;
      var key = String(row.game_id || row.game_title || "");
      if (!gameMap.has(key)) {
        gameMap.set(key, { title: row.game_title || "KUROゲーム", icon: row.game_icon || "", rows: [] });
      }
      gameMap.get(key).rows.push(row);
    });
    var groups = Array.from(gameMap.values());
    var summary =
      '<div class="kuro-profile-summary">' +
        '<div><strong>' + totalPlays.toLocaleString("ja-JP") + '</strong><span>総プレイ数</span></div>' +
        '<div><strong>' + totalWins.toLocaleString("ja-JP") + '</strong><span>総勝利数</span></div>' +
        '<div><strong>' + groups.length.toLocaleString("ja-JP") + '</strong><span>プレイしたゲーム</span></div>' +
      '</div>';
    if (!groups.length) {
      return summary + '<div class="kuro-profile-empty">まだ表示できるゲーム記録はありません。</div>';
    }
    var cards = groups.map(function (game) {
      var gamePlays = 0, gameWins = 0, gameLosses = 0, gameDraws = 0;
      game.rows.forEach(function (row) {
        gamePlays += Number(row.plays) || 0;
        gameWins += Number(row.wins) || 0;
        gameLosses += Number(row.losses) || 0;
        gameDraws += Number(row.draws) || 0;
      });
      var iconText = String(game.icon || "").trim();
      if (!iconText || /^https?:\/\//i.test(iconText)) iconText = "🎮";
      var modeRows = game.rows.map(function (row) {
        var detail = [];
        var plays = Number(row.plays) || 0;
        var wins = Number(row.wins) || 0;
        var losses = Number(row.losses) || 0;
        var draws = Number(row.draws) || 0;
        if (plays) detail.push("プレイ " + plays.toLocaleString("ja-JP"));
        if (wins) detail.push("勝利 " + wins.toLocaleString("ja-JP"));
        if (losses) detail.push("敗北 " + losses.toLocaleString("ja-JP"));
        if (draws) detail.push("引分 " + draws.toLocaleString("ja-JP"));
        if (row.best_time_ms != null) detail.push("ベスト " + formatTime(row.best_time_ms));
        else if (row.best_score != null) detail.push("ベスト " + Number(row.best_score).toLocaleString("ja-JP"));
        if (!detail.length) detail.push("記録あり");
        return '<div class="kuro-profile-mode"><span>' + escapeHtml(modeLabel(row.mode)) + '</span><small>' + escapeHtml(detail.join("  ·  ")) + '</small></div>';
      }).join("");
      return '<article class="kuro-profile-game">' +
        '<div class="kuro-profile-game-head"><span class="kuro-profile-game-icon">' + escapeHtml(iconText) + '</span><div class="kuro-profile-game-title"><strong>' + escapeHtml(game.title) + '</strong><small>プレイ ' + gamePlays.toLocaleString("ja-JP") + ' · 勝利 ' + gameWins.toLocaleString("ja-JP") + (gameLosses ? ' · 敗北 ' + gameLosses.toLocaleString("ja-JP") : "") + (gameDraws ? ' · 引分 ' + gameDraws.toLocaleString("ja-JP") : "") + '</small></div></div>' +
        '<div class="kuro-profile-modes">' + modeRows + '</div></article>';
    }).join("");
    return summary + '<div class="kuro-profile-games">' + cards + '</div>';
  }

  async function open(userId, options) {
    var id = String(userId || "");
    if (!UUID_RE.test(id)) throw new Error("プロフィールIDが正しくありません。");
    var db = getDb();
    var host = getModal();
    var thisRequest = ++requestId;
    var moreButton = host.querySelector(".kuro-profile-sns-more");
    snsMoreAction = options && typeof options.onSnsMore === "function" ? options.onSnsMore : null;
    moreButton.hidden = !snsMoreAction;
    content.innerHTML = '<div class="kuro-profile-loading">プロフィールを読み込み中…</div>';
    host.hidden = false;
    host.querySelector(".kuro-profile-dialog").focus();
    if (!db) {
      content.innerHTML = '<div class="kuro-profile-error">プロフィール通信を開始できません。ページを再読み込みしてください。</div>';
      return;
    }
    try {
      var results = await Promise.all([
        db.from("profiles").select("id,username,display_name,kuro_id,avatar_url,bio,created_at").eq("id", id).maybeSingle(),
        db.rpc("kuro_get_public_profile_game_stats", { p_user_id: id })
      ]);
      if (thisRequest !== requestId) return;
      var profileResult = results[0], statsResult = results[1];
      if (profileResult.error) throw profileResult.error;
      if (!profileResult.data) {
        content.innerHTML = '<div class="kuro-profile-error">プロフィールが見つかりませんでした。</div>';
        return;
      }
      var profile = profileResult.data;
      var name = profile.display_name || profile.username || "KUROユーザー";
      var handle = profile.username ? "@" + profile.username : "KUROユーザー";
      var avatarUrl = safeImageUrl(profile.avatar_url);
      var avatar = avatarUrl
        ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" class="kuro-profile-avatar-image">'
        : '<span class="kuro-profile-avatar-fallback">' + escapeHtml(Array.from(name)[0] || "👤") + '</span>';
      var bio = String(profile.bio || "").trim();
      var bioHtml = bio
        ? escapeHtml(bio).replace(/\r\n|\r|\n/g, "<br>")
        : '<span class="kuro-profile-muted">自己紹介はまだ設定されていません。</span>';
      var joined = profile.created_at ? new Date(profile.created_at) : null;
      var joinedLabel = joined && !Number.isNaN(joined.getTime())
        ? '<span class="kuro-profile-joined">KUROメンバー · ' + joined.toLocaleDateString("ja-JP") + ' 登録</span>'
        : "";
      content.innerHTML =
        '<section class="kuro-profile-identity"><div class="kuro-profile-avatar">' + avatar + '</div><div class="kuro-profile-names"><h3>' + escapeHtml(name) + '</h3><p>' + escapeHtml(handle) + '</p><small>KURO ID：' + escapeHtml(profile.kuro_id || "未設定") + '</small>' + joinedLabel + '</div></section>' +
        '<section class="kuro-profile-bio"><h3>自己紹介</h3><p>' + bioHtml + '</p></section>' +
        '<section class="kuro-profile-records"><div class="kuro-profile-section-head"><h3>ゲーム記録</h3><span>ゲーム別・モード別</span></div>' +
          (statsResult.error
            ? '<div class="kuro-profile-error">ゲーム記録を読み込めませんでした。少し時間をおいて再度お試しください。</div>'
            : renderStats(statsResult.data || [])) +
        '</section>';
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error("KURO common profile load failed:", error);
      content.innerHTML = '<div class="kuro-profile-error">プロフィールを読み込めませんでした。通信状態を確認して、もう一度お試しください。</div>';
    }
  }

  function openSelf() {
    var db = getDb();
    if (!db) return;
    db.auth.getUser().then(function (result) {
      var user = result && result.data && result.data.user;
      if (result && !result.error && user && !user.is_anonymous) return open(user.id);
      return null;
    }).catch(function (error) {
      console.warn("KURO own profile lookup failed:", error);
    });
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest("[data-kuro-profile-user], [data-kuro-profile-self]")
      : null;
    if (!target) return;
    if (target.hasAttribute("data-kuro-profile-self")) {
      event.preventDefault();
      openSelf();
      return;
    }
    var userId = target.getAttribute("data-kuro-profile-user");
    if (!userId) return;
    event.preventDefault();
    event.stopPropagation();
    open(userId).catch(function (error) {
      console.warn("KURO profile trigger failed:", error);
    });
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var target = event.target && event.target.closest
      ? event.target.closest("[data-kuro-profile-self]")
      : null;
    if (!target) return;
    event.preventDefault();
    openSelf();
  });

  window.KuroProfile = { open: open, close: close };
})();
