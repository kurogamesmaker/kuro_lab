(function () {
  "use strict";

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var modal = null;
  var content = null;
  var requestId = 0;
  var snsMoreAction = null;
  var currentProfile = null;
  var viewerUser = null;
  var viewerFollowsProfile = false;
  var chatConversationId = null;
  var chatRefreshTimer = null;
  var chatSending = false;

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

  function formatMessageTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function stopChatRefresh() {
    if (chatRefreshTimer) window.clearInterval(chatRefreshTimer);
    chatRefreshTimer = null;
    chatConversationId = null;
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
      if (event.target === modal || event.target.closest(".kuro-profile-close")) {
        close();
        return;
      }
      var more = event.target.closest(".kuro-profile-sns-more");
      if (more && !more.hidden) {
        var action = snsMoreAction;
        close();
        if (typeof action === "function") {
          Promise.resolve().then(action).catch(function (error) {
            console.warn("KURO SNS profile detail open failed:", error);
          });
        }
        return;
      }
      if (event.target.closest(".kuro-profile-follow-toggle")) {
        toggleFollow().catch(showSocialError);
        return;
      }
      var listButton = event.target.closest("[data-kuro-profile-list]");
      if (listButton) {
        showFollowList(listButton.getAttribute("data-kuro-profile-list")).catch(showSocialError);
        return;
      }
      var listUser = event.target.closest("[data-kuro-profile-list-user]");
      if (listUser) {
        event.preventDefault();
        event.stopPropagation();
        var nextId = listUser.getAttribute("data-kuro-profile-list-user");
        open(nextId).catch(showSocialError);
        return;
      }
      if (event.target.closest(".kuro-profile-chat-open")) {
        var targetId = currentProfile && String(currentProfile.id || "");
        if (!UUID_RE.test(targetId)) {
          setSocialStatus("チャットを開けませんでした。プロフィールを再読み込みしてください。");
          return;
        }
        stopChatRefresh();
        var chatUrl = new URL("/sns/v2/", window.location.origin);
        chatUrl.searchParams.set("chat", targetId);
        window.location.assign(chatUrl.href);
        return;
      }
      if (event.target.closest(".kuro-profile-chat-close")) {
        stopChatRefresh();
        var chatPanel = content.querySelector(".kuro-profile-chat-panel");
        if (chatPanel) chatPanel.remove();
        return;
      }
      if (event.target.closest(".kuro-profile-chat-refresh")) {
        loadChatMessages().catch(showSocialError);
      }
    });
    modal.addEventListener("submit", function (event) {
      if (event.target && event.target.id === "kuroProfileChatForm") {
        event.preventDefault();
        sendChatMessage().catch(showSocialError);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal && !modal.hidden) close();
    });
    return modal;
  }

  function showSocialError(error) {
    console.error("KURO profile social action failed:", error);
    var status = content && content.querySelector("#kuroProfileSocialStatus");
    if (status) status.textContent = error && error.message ? error.message : "操作に失敗しました。時間をおいて再度お試しください。";
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    snsMoreAction = null;
    stopChatRefresh();
  }

  function renderStats(rows) {
    if (!Array.isArray(rows)) rows = [];
    var totalPlays = 0, totalWins = 0, gameMap = new Map();
    rows.forEach(function (row) {
      totalPlays += Number(row.plays) || 0;
      totalWins += Number(row.wins) || 0;
      var key = String(row.game_id || row.game_title || "");
      if (!gameMap.has(key)) {
        gameMap.set(key, { title: row.game_title || "KUROゲーム", icon: row.game_icon || "", rows: [] });
      }
      gameMap.get(key).rows.push(row);
    });
    var groups = Array.from(gameMap.values());
    var summary =
      '<div class="kuro-profile-summary kuro-profile-summary-compact">' +
        '<div><strong>' + totalPlays.toLocaleString("ja-JP") + '</strong><span>総プレイ数</span></div>' +
        '<div><strong>' + totalWins.toLocaleString("ja-JP") + '</strong><span>総勝利数</span></div>' +
        '<div><strong>' + groups.length.toLocaleString("ja-JP") + '</strong><span>プレイしたゲーム</span></div>' +
      '</div>';
    if (!groups.length) {
      return summary + '<div class="kuro-profile-empty">まだ表示できるゲーム記録はありません。</div>';
    }
    var tableRows = groups.map(function (game) {
      var imageUrl = safeImageUrl(game.icon);
      var iconText = String(game.icon || "").trim();
      var icon = imageUrl
        ? '<img src="' + escapeHtml(imageUrl) + '" alt="" class="kuro-profile-table-icon-image">'
        : '<span class="kuro-profile-table-icon-fallback">' + escapeHtml(iconText || "🎮") + '</span>';
      return game.rows.map(function (row) {
        var plays = Number(row.plays) || 0;
        var wins = Number(row.wins) || 0;
        var losses = Number(row.losses) || 0;
        var draws = Number(row.draws) || 0;
        var best = row.best_time_ms != null
          ? formatTime(row.best_time_ms)
          : row.best_score != null
            ? Number(row.best_score).toLocaleString("ja-JP")
            : "—";
        return '<tr>' +
          '<td><div class="kuro-profile-table-game">' + icon + '<strong>' + escapeHtml(game.title) + '</strong></div></td>' +
          '<td class="kuro-profile-table-mode">' + escapeHtml(modeLabel(row.mode)) + '</td>' +
          '<td class="kuro-profile-table-number">' + plays.toLocaleString("ja-JP") + '</td>' +
          '<td class="kuro-profile-table-number">' + wins.toLocaleString("ja-JP") + '</td>' +
          '<td class="kuro-profile-table-number">' + losses.toLocaleString("ja-JP") + '</td>' +
          '<td class="kuro-profile-table-number">' + draws.toLocaleString("ja-JP") + '</td>' +
          '<td class="kuro-profile-table-best">' + escapeHtml(best) + '</td>' +
        '</tr>';
      }).join("");
    }).join("");
    return summary +
      '<div class="kuro-profile-table-wrap">' +
        '<table class="kuro-profile-record-table">' +
          '<thead><tr><th>ゲーム</th><th>モード</th><th>プレイ</th><th>勝利</th><th>敗北</th><th>引分</th><th>最高記録</th></tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  async function getSignedInUser(db) {
    if (!db || !db.auth || typeof db.auth.getUser !== "function") return null;
    try {
      var result = await db.auth.getUser();
      var user = result && result.data && result.data.user;
      return user && !user.is_anonymous ? user : null;
    } catch (_) {
      return null;
    }
  }

  async function getFollowCounts(db, userId) {
    var results = await Promise.all([
      db.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
      db.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId)
    ]);
    return {
      followers: results[0].error ? null : Number(results[0].count || 0),
      following: results[1].error ? null : Number(results[1].count || 0)
    };
  }

  function renderSocial(profile, counts, isSelf, signedIn) {
    var followers = counts.followers == null ? "—" : counts.followers.toLocaleString("ja-JP");
    var following = counts.following == null ? "—" : counts.following.toLocaleString("ja-JP");
    var actions = isSelf
      ? '<div class="kuro-profile-own-label">あなたのプロフィール</div>'
      : '<div class="kuro-profile-social-actions">' +
          '<button type="button" class="kuro-profile-follow-toggle">' + (signedIn ? (viewerFollowsProfile ? "フォロー中 · 解除" : "＋ フォロー") : "ログインしてフォロー") + '</button>' +
          '<button type="button" class="kuro-profile-chat-open">チャット</button>' +
        '</div>';
    return '<aside class="kuro-profile-social-side">' +
      '<div class="kuro-profile-follow-stats">' +
        '<button type="button" data-kuro-profile-list="following"><strong>' + following + '</strong><span>フォロー中</span></button>' +
        '<button type="button" data-kuro-profile-list="followers"><strong>' + followers + '</strong><span>フォロワー</span></button>' +
      '</div>' +
      actions +
      '<p class="kuro-profile-social-status" id="kuroProfileSocialStatus" role="status" aria-live="polite"></p>' +
    '</aside>';
  }


  async function open(userId, options) {
    var id = String(userId || "");
    if (!UUID_RE.test(id)) throw new Error("プロフィールIDが正しくありません。");
    stopChatRefresh();
    var db = getDb();
    var host = getModal();
    var thisRequest = ++requestId;
    var moreButton = host.querySelector(".kuro-profile-sns-more");
    snsMoreAction = options && typeof options.onSnsMore === "function" ? options.onSnsMore : null;
    moreButton.hidden = !snsMoreAction;
    content.innerHTML = '<div class="kuro-profile-loading">プロフィールを読み込み中…</div>';
    host.hidden = false;
    host.querySelector(".kuro-profile-dialog").focus();
    currentProfile = null;
    viewerUser = null;
    viewerFollowsProfile = false;
    if (!db) {
      content.innerHTML = '<div class="kuro-profile-error">プロフィール通信を開始できません。ページを再読み込みしてください。</div>';
      return;
    }
    try {
      var results = await Promise.all([
        db.from("profiles").select("id,username,display_name,kuro_id,avatar_url,bio,created_at").eq("id", id).maybeSingle(),
        db.rpc("kuro_get_public_profile_game_stats", { p_user_id: id }),
        getFollowCounts(db, id),
        getSignedInUser(db),
        db.functions.invoke("kuro-public-coin-balance", { body: { userId: id } }).catch(function (error) { return { data: null, error: error }; }),
        db.rpc("kuro_get_public_store_cosmetics", { p_user_id: id }).catch(function (error) { return { data: {}, error: error }; })
      ]);
      if (thisRequest !== requestId) return;
      var profileResult = results[0], statsResult = results[1], coinBalanceResult = results[4];
      var cosmeticsResult = results[5];
      var cosmetics = cosmeticsResult && !cosmeticsResult.error && cosmeticsResult.data && typeof cosmeticsResult.data === "object" ? cosmeticsResult.data : {};
      if (profileResult.error) throw profileResult.error;
      if (!profileResult.data) {
        content.innerHTML = '<div class="kuro-profile-error">プロフィールが見つかりませんでした。</div>';
        return;
      }
      var profile = profileResult.data;
      currentProfile = profile;
      viewerUser = results[3];
      if (viewerUser && viewerUser.id !== id) {
        var followResult = await db.from("follows").select("follower_id").eq("follower_id", viewerUser.id).eq("following_id", id).maybeSingle();
        if (!followResult.error) viewerFollowsProfile = !!followResult.data;
      }
      if (thisRequest !== requestId) return;
      var isSelf = !!viewerUser && viewerUser.id === id;
      var name = profile.display_name || profile.username || "KUROユーザー";
      var handle = profile.username ? "@" + profile.username : "KUROユーザー";
      var equippedAvatar = cosmetics.avatar && typeof cosmetics.avatar === "object" ? cosmetics.avatar : null;
      var equippedFrame = cosmetics.frame && typeof cosmetics.frame === "object" ? cosmetics.frame : null;
      var equippedBackground = cosmetics.background && typeof cosmetics.background === "object" ? cosmetics.background : null;
      var equippedTheme = cosmetics.theme && typeof cosmetics.theme === "object" ? cosmetics.theme : null;
      var avatarUrl = safeImageUrl(equippedAvatar && equippedAvatar.imageUrl) || safeImageUrl(profile.avatar_url);
      var avatar = avatarUrl
        ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" class="kuro-profile-avatar-image">'
        : equippedAvatar && equippedAvatar.icon
          ? '<span class="kuro-profile-avatar-fallback kuro-profile-avatar-item">' + escapeHtml(equippedAvatar.icon) + '</span>'
          : '<span class="kuro-profile-avatar-fallback">' + escapeHtml(Array.from(name)[0] || "👤") + '</span>';
      var frameRarity = equippedFrame && ["common","rare","epic","legendary"].includes(String(equippedFrame.rarity)) ? String(equippedFrame.rarity) : "";
      var frameClass = frameRarity ? " kuro-profile-frame-" + frameRarity : "";
      var backgroundImage = safeImageUrl(equippedBackground && equippedBackground.imageUrl);
      var backgroundIcon = equippedBackground && !backgroundImage ? String(equippedBackground.icon || "✦") : "";
      var backgroundStyle = backgroundImage
        ? ' style="background-image:linear-gradient(90deg,rgba(10,15,29,.9),rgba(10,15,29,.52)),url(\'' + escapeHtml(backgroundImage) + '\')"'
        : "";
      var themeClass = equippedTheme && equippedTheme.itemKey === "neon-theme"
        ? " kuro-profile-theme-neon"
        : equippedTheme && equippedTheme.itemKey === "kuro-classic-theme"
          ? " kuro-profile-theme-classic"
          : equippedTheme && ["rare","epic","legendary"].includes(String(equippedTheme.rarity))
            ? " kuro-profile-theme-" + String(equippedTheme.rarity)
            : "";
      var backgroundClass = equippedBackground && equippedBackground.itemKey === "midnight-background"
        ? " kuro-profile-background-midnight"
        : equippedBackground && equippedBackground.itemKey === "cyber-background"
          ? " kuro-profile-background-cyber"
          : equippedBackground && ["rare","epic","legendary"].includes(String(equippedBackground.rarity))
            ? " kuro-profile-background-" + String(equippedBackground.rarity)
            : "";
      var cosmeticChips = ["avatar","frame","background","theme"].map(function (slot) {
        var item = cosmetics[slot];
        return item && item.name
          ? '<span class="kuro-profile-cosmetic-chip"><span>' + escapeHtml(item.icon || "✦") + '</span>' + escapeHtml(item.name) + '</span>'
          : "";
      }).join("");
      var cosmeticBanner = equippedBackground
        ? '<div class="kuro-profile-cosmetic-banner' + backgroundClass + '"' + backgroundStyle + '><span class="kuro-profile-cosmetic-banner-icon">' + escapeHtml(backgroundIcon || (backgroundImage ? "" : "✦")) + '</span><span><small>PROFILE BACKGROUND</small><strong>' + escapeHtml(equippedBackground.name || "背景") + '</strong></span></div>'
        : "";
      var bio = String(profile.bio || "").trim();
      var bioHtml = bio
        ? escapeHtml(bio).replace(/\r\n|\r|\n/g, "<br>")
        : '<span class="kuro-profile-muted">自己紹介はまだ設定されていません。</span>';
      var coinBalance = coinBalanceResult && !coinBalanceResult.error ? Number(coinBalanceResult.data && coinBalanceResult.data.balance) : NaN;
      var coinBalanceLabel = Number.isFinite(coinBalance)
        ? Math.max(0, Math.floor(coinBalance)).toLocaleString("ja-JP") + "P"
        : "—P";
      var joined = profile.created_at ? new Date(profile.created_at) : null;
      var joinedLabel = joined && !Number.isNaN(joined.getTime())
        ? '<span class="kuro-profile-joined">KUROメンバー · ' + joined.toLocaleDateString("ja-JP") + ' 登録</span>'
        : "";
      content.innerHTML =
        '<div class="kuro-profile-custom-theme' + themeClass + '">' +
        cosmeticBanner +
        (cosmeticChips ? '<section class="kuro-profile-cosmetic-strip" aria-label="装備中アイテム">' + cosmeticChips + '</section>' : '') +
        '<section class="kuro-profile-identity">' +
          '<div class="kuro-profile-identity-main"><div class="kuro-profile-avatar' + frameClass + '">' + avatar + '</div>' +
          '<div class="kuro-profile-names"><h3>' + escapeHtml(name) + '</h3><p>' + escapeHtml(handle) + '</p>' +
          '<small>KURO ID：' + escapeHtml(profile.kuro_id || "未設定") + '</small>' + joinedLabel + '</div></div>' +
          renderSocial(profile, results[2], isSelf, !!viewerUser) +
        '</section>' +
        '<section class="kuro-profile-bio"><h3>自己紹介</h3><p>' + bioHtml + '</p></section>' +
        '<section class="kuro-profile-coin-balance" aria-label="公開KURO COIN残高">' +
          '<div class="kuro-profile-coin-copy"><span class="kuro-profile-coin-icon" aria-hidden="true">🪙</span><div><strong>KURO COIN</strong><small>公開残高</small></div></div>' +
          '<strong class="kuro-profile-coin-value">' + escapeHtml(coinBalanceLabel) + '</strong>' +
        '</section>' +
        '<div class="kuro-profile-social-panel kuro-profile-social-panel-wide" id="kuroProfileSocialPanel" hidden></div>' +
        '<section class="kuro-profile-records"><div class="kuro-profile-section-head"><h3>ゲーム記録</h3><span>ゲーム別・モード別</span></div>' +
          (statsResult.error
            ? '<div class="kuro-profile-error">ゲーム記録を読み込めませんでした。少し時間をおいて再度お試しください。</div>'
            : renderStats(statsResult.data || [])) +
        '</section>' +
        '</div>';
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error("KURO common profile load failed:", error);
      content.innerHTML = '<div class="kuro-profile-error">プロフィールを読み込めませんでした。通信状態を確認して、もう一度お試しください。</div>';
    }
  }

  async function refreshProfile() {
    if (!currentProfile) return;
    var id = currentProfile.id;
    var options = snsMoreAction ? { onSnsMore: snsMoreAction } : null;
    await open(id, options);
  }

  async function toggleFollow() {
    var db = getDb();
    if (!db || !currentProfile) return;
    var user = await getSignedInUser(db);
    if (!user) {
      setSocialStatus("フォローするにはKUROアカウントでログインしてください。");
      openSignIn();
      return;
    }
    if (user.id === currentProfile.id) {
      setSocialStatus("自分自身はフォローできません。");
      return;
    }
    var targetId = currentProfile.id;
    var button = content.querySelector(".kuro-profile-follow-toggle");
    if (button) button.disabled = true;
    try {
      var existing = await db.from("follows").select("follower_id").eq("follower_id", user.id).eq("following_id", targetId).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        var removed = await db.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetId);
        if (removed.error) throw removed.error;
      } else {
        var inserted = await db.from("follows").insert({ follower_id: user.id, following_id: targetId });
        if (inserted.error) throw inserted.error;
        try {
          var reverse = await db.from("follows").select("follower_id").eq("follower_id", targetId).eq("following_id", user.id).maybeSingle();
          var noticeType = reverse.data ? "follow_back" : "follow";
          await db.from("notifications").insert({ recipient_id: targetId, actor_id: user.id, type: noticeType });
        } catch (noticeError) {
          console.warn("KURO follow notification skipped:", noticeError);
        }
        if (db.functions && typeof db.functions.invoke === "function") {
          db.functions.invoke("send-chat-push", { body: { type: "follow", targetUserId: targetId } })
            .catch(function (pushError) { console.warn("KURO follow push skipped:", pushError); });
        }
      }
      await refreshProfile();
    } catch (error) {
      if (button) button.disabled = false;
      setSocialStatus("フォローを更新できませんでした。通信状態を確認してください。");
      throw error;
    }
  }

  function setSocialStatus(message) {
    var status = content && content.querySelector("#kuroProfileSocialStatus");
    if (status) status.textContent = message || "";
  }

  function openSignIn() {
    if (typeof window.openAuthModal === "function") {
      window.openAuthModal("signin");
      return;
    }
    var button = document.getElementById("kuroAccountOpen") || document.getElementById("portal-account-button");
    if (button && typeof button.click === "function") button.click();
  }

  async function showFollowList(kind) {
    if (kind !== "followers" && kind !== "following") return;
    if (!currentProfile) return;
    var db = getDb();
    var targetId = currentProfile.id;
    var panel = content.querySelector("#kuroProfileSocialPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="kuro-profile-loading">一覧を読み込み中…</div>';
    var isFollowers = kind === "followers";
    var key = isFollowers ? "follower_id" : "following_id";
    var filterKey = isFollowers ? "following_id" : "follower_id";
    var result = await db.from("follows").select("follower_id,following_id,created_at").eq(filterKey, targetId).order("created_at", { ascending: false }).limit(100);
    if (result.error) throw result.error;
    var ids = (result.data || []).map(function (row) { return row[key]; });
    if (!ids.length) {
      panel.innerHTML = '<div class="kuro-profile-list-head"><strong>' + (isFollowers ? "フォロワー" : "フォロー中") + '</strong><button type="button" class="kuro-profile-list-close" aria-label="閉じる">×</button></div><p class="kuro-profile-empty">' + (isFollowers ? "まだフォロワーはいません。" : "まだフォローしているユーザーはいません。") + '</p>';
      panel.querySelector(".kuro-profile-list-close").addEventListener("click", function () { panel.hidden = true; });
      return;
    }
    var profileResult = await db.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
    if (profileResult.error) throw profileResult.error;
    var byId = Object.create(null);
    (profileResult.data || []).forEach(function (profile) { byId[profile.id] = profile; });
    var rows = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    panel.innerHTML =
      '<div class="kuro-profile-list-head"><strong>' + (isFollowers ? "フォロワー" : "フォロー中") + '</strong><button type="button" class="kuro-profile-list-close" aria-label="閉じる">×</button></div>' +
      '<div class="kuro-profile-list-items">' + rows.map(function (profile) {
        var avatarUrl = safeImageUrl(profile.avatar_url);
        var avatar = avatarUrl
          ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" class="kuro-profile-list-avatar">'
          : '<span class="kuro-profile-list-avatar kuro-profile-list-fallback">' + escapeHtml(Array.from(profile.display_name || profile.username || "👤")[0] || "👤") + '</span>';
        return '<button type="button" class="kuro-profile-list-user" data-kuro-profile-list-user="' + escapeHtml(profile.id) + '">' + avatar +
          '<span><strong>' + escapeHtml(profile.display_name || profile.username || "KUROユーザー") + '</strong><small>@' + escapeHtml(profile.username || "user") + '</small></span><span class="kuro-profile-list-arrow">›</span></button>';
      }).join("") + '</div>';
    panel.querySelector(".kuro-profile-list-close").addEventListener("click", function () { panel.hidden = true; });
  }

  async function openDirectChat() {
    var db = getDb();
    if (!db || !currentProfile) return;
    var user = await getSignedInUser(db);
    if (!user) {
      setSocialStatus("チャットを使うにはKUROアカウントでログインしてください。");
      openSignIn();
      return;
    }
    if (user.id === currentProfile.id) {
      setSocialStatus("自分自身とのチャットは開始できません。");
      return;
    }
    stopChatRefresh();
    var targetId = currentProfile.id;
    var panel = content.querySelector("#kuroProfileSocialPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML =
      '<section class="kuro-profile-chat-panel">' +
        '<div class="kuro-profile-chat-head"><div><strong>チャット</strong><small>' + escapeHtml(currentProfile.display_name || currentProfile.username || "KUROユーザー") + '</small></div><div class="kuro-profile-chat-head-actions"><button type="button" class="kuro-profile-chat-refresh" aria-label="更新">↻</button><button type="button" class="kuro-profile-chat-close" aria-label="閉じる">×</button></div></div>' +
        '<div class="kuro-profile-chat-messages" id="kuroProfileChatMessages"><p class="kuro-profile-loading">会話を準備しています…</p></div>' +
        '<form id="kuroProfileChatForm" class="kuro-profile-chat-form"><input id="kuroProfileChatInput" type="text" maxlength="1000" autocomplete="off" placeholder="メッセージを入力…" required><button type="submit">送信</button></form>' +
        '<p class="kuro-profile-chat-note" id="kuroProfileChatStatus" role="status" aria-live="polite">1対1のKURO SNSチャットを共通で使用します。</p>' +
      '</section>';
    try {
      var pair = [user.id, targetId].sort();
      var lookup = await db.from("chat_conversations").select("id,user_a,user_b").eq("user_a", pair[0]).eq("user_b", pair[1]).maybeSingle();
      if (lookup.error) throw lookup.error;
      var conversation = lookup.data;
      if (!conversation) {
        var created = await db.from("chat_conversations").insert({ user_a: pair[0], user_b: pair[1], created_by: user.id }).select("id,user_a,user_b").single();
        if (created.error) {
          var retry = await db.from("chat_conversations").select("id,user_a,user_b").eq("user_a", pair[0]).eq("user_b", pair[1]).maybeSingle();
          if (retry.error || !retry.data) throw created.error;
          conversation = retry.data;
        } else {
          conversation = created.data;
        }
      }
      if (!conversation || !conversation.id) throw new Error("チャットの会話を作成できませんでした。");
      chatConversationId = conversation.id;
      await loadChatMessages();
      chatRefreshTimer = window.setInterval(function () {
        if (!modal || modal.hidden || !chatConversationId) return;
        loadChatMessages().catch(function (error) { console.warn("KURO profile chat refresh failed:", error); });
      }, 5000);
      var input = content.querySelector("#kuroProfileChatInput");
      if (input) input.focus();
    } catch (error) {
      var messages = content.querySelector("#kuroProfileChatMessages");
      if (messages) messages.innerHTML = '<p class="kuro-profile-error">チャットを開始できませんでした。ログイン状態とチャット権限を確認してください。</p>';
      throw error;
    }
  }

  async function loadChatMessages() {
    var db = getDb();
    var conversationId = chatConversationId;
    var box = content && content.querySelector("#kuroProfileChatMessages");
    if (!db || !conversationId || !box) return;
    var result = await db.from("chat_messages").select("id,sender_id,content,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(60);
    if (result.error) throw result.error;
    var rows = (result.data || []).slice().reverse();
    if (!rows.length) {
      box.innerHTML = '<p class="kuro-profile-chat-empty">まだメッセージはありません。最初のメッセージを送ってみましょう。</p>';
      return;
    }
    var wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = rows.map(function (row) {
      var mine = !!viewerUser && row.sender_id === viewerUser.id;
      return '<div class="kuro-profile-chat-line ' + (mine ? "is-mine" : "is-peer") + '"><div class="kuro-profile-chat-bubble">' +
        '<p>' + escapeHtml(row.content).replace(/\r\n|\r|\n/g, "<br>") + '</p><time>' + escapeHtml(formatMessageTime(row.created_at)) + '</time></div></div>';
    }).join("");
    if (wasNearBottom || rows.length) box.scrollTop = box.scrollHeight;
  }

  async function sendChatMessage() {
    if (chatSending) return;
    var db = getDb();
    var input = content && content.querySelector("#kuroProfileChatInput");
    var status = content && content.querySelector("#kuroProfileChatStatus");
    var message = String(input && input.value || "").trim();
    if (!db || !chatConversationId || !viewerUser || !message) return;
    if (Array.from(message).length > 1000) {
      if (status) status.textContent = "メッセージは1000文字以内で入力してください。";
      return;
    }
    chatSending = true;
    var button = content.querySelector("#kuroProfileChatForm button");
    if (button) button.disabled = true;
    try {
      var result = await db.from("chat_messages").insert({
        conversation_id: chatConversationId,
        sender_id: viewerUser.id,
        content: message
      }).select("id").single();
      if (result.error) throw result.error;
      var conversationId = chatConversationId;
      await db.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
      input.value = "";
      if (status) status.textContent = "送信しました。";
      await loadChatMessages();
      if (db.functions && typeof db.functions.invoke === "function" && currentProfile) {
        db.functions.invoke("send-chat-push", { body: { messageId: result.data.id } })
          .catch(function (pushError) { console.warn("KURO chat push skipped:", pushError); });
      }
    } catch (error) {
      if (status) status.textContent = "送信できませんでした。内容を確認して再度お試しください。";
      throw error;
    } finally {
      chatSending = false;
      if (button) button.disabled = false;
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
    open(userId).catch(showSocialError);
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
