(function () {
  "use strict";

  const SUPABASE_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_BYPUfB0lrh26Jv8_6ZQnpQ_wfAKOVyn";
  const PROJECT_REF = "cprvpphlfpmiegjiutjn";
  const $ = (id) => document.getElementById(id);

  function sessionClientId() {
    try {
      let value = sessionStorage.getItem("kuro_account_client_id");
      if (!value) {
        value = "account-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
        sessionStorage.setItem("kuro_account_client_id", value);
      }
      return value;
    } catch (_) {
      return "account-settings";
    }
  }

  async function kuroRelayFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== SUPABASE_URL) return fetch(request);

    const bytes = new Uint8Array(await request.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    const proxy = await fetch("/api/cloudflare-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: url.pathname + url.search,
        method: request.method,
        headers,
        bodyBase64: bytes.length ? btoa(binary) : "",
        clientId: sessionClientId()
      })
    });
    let result;
    try { result = await proxy.json(); }
    catch (_) { throw new Error("Cloudflare中継サーバーの応答を読み取れませんでした。"); }
    if (!proxy.ok || !result || typeof result.status !== "number") {
      throw new Error(result && result.error || "Cloudflare中継通信に失敗しました。");
    }
    let body = null;
    if (result.isBinary && result.bodyBase64) {
      const raw = atob(result.bodyBase64);
      const output = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
      body = output;
    } else if (result.bodyText !== undefined && ![204, 205, 304].includes(result.status)) {
      body = result.bodyText;
    }
    return new Response(body, {
      status: result.status,
      headers: result.headers || { "Content-Type": "application/json" }
    });
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    $("accountLoggedOut").hidden = false;
    $("accountLoggedOut").querySelector("p").textContent = "認証システムを読み込めませんでした。ページを再読み込みしてください。";
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { fetch: kuroRelayFetch },
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });

  let currentUser = null;
  let accountHasPassword = false;
  let busy = false;

  function setStatus(id, message, kind) {
    const node = $(id);
    node.textContent = message || "";
    node.classList.toggle("error", kind === "error");
    node.classList.toggle("success", kind === "success");
  }

  function setBusy(button, state, text) {
    button.disabled = state;
    if (text) button.textContent = text;
  }

  function getProviders(user) {
    const providers = user && user.app_metadata && user.app_metadata.providers;
    return Array.isArray(providers) ? providers.map((value) => String(value)) : [];
  }

  function getReadableName(profile, user) {
    return (profile && (profile.display_name || profile.username))
      || (user && user.user_metadata && (user.user_metadata.display_name || user.user_metadata.username || user.user_metadata.full_name))
      || "KUROアカウント";
  }

  async function loadAccount() {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      $("accountLoggedOut").hidden = false;
      $("accountUser").hidden = true;
      $("accountPasswordCard").hidden = true;
      $("accountDeleteCard").hidden = true;
      return;
    }
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.is_anonymous) {
      $("accountLoggedOut").hidden = false;
      $("accountUser").hidden = true;
      $("accountPasswordCard").hidden = true;
      $("accountDeleteCard").hidden = true;
      return;
    }

    currentUser = data.user;
    const providers = getProviders(currentUser);
    accountHasPassword = currentUser.app_metadata?.kuro_password_configured === true || (providers.includes("email") && currentUser.user_metadata?.kuro_password_configured !== false);
    const needsSetup = !accountHasPassword;

    let profile = null;
    const { data: profileData, error: profileError } = await client
      .from("profiles")
      .select("username,display_name")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (!profileError) profile = profileData;

    $("accountDisplayName").textContent = getReadableName(profile, currentUser);
    $("accountUser").hidden = false;
    $("accountLoggedOut").hidden = true;
    $("accountPasswordCard").hidden = false;
    $("accountDeleteCard").hidden = false;

    $("accountPasswordIntro").textContent = needsSetup
      ? "このアカウントにはまだパスワードが設定されていません。ここで設定すると、KUROLAB・SNS・GAMES共通で使えます。"
      : "KUROLAB・KURO SNS・KURO GAMES共通のパスワードを変更します。";
    $("accountCurrentWrap").hidden = needsSetup;
    $("accountCurrentPassword").required = !needsSetup;
    $("accountPasswordSubmit").textContent = needsSetup ? "パスワードを設定" : "パスワードを変更";
    $("accountDeletePasswordWrap").hidden = !accountHasPassword;
    $("accountDeletePassword").required = accountHasPassword;
    $("accountDeleteReauthHint").hidden = accountHasPassword;
    $("accountDeleteSubmit").disabled = true;

    if (new URLSearchParams(location.search).get("setup") === "1" && needsSetup) {
      setStatus("accountPasswordStatus", "初回パスワードを設定すると、共通アカウントの準備が完了します。", "success");
    }
  }

  $("accountPasswordForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy || !currentUser) return;
    const currentPassword = $("accountCurrentPassword").value;
    const newPassword = $("accountNewPassword").value;
    const confirmPassword = $("accountConfirmPassword").value;
    if (newPassword.length < 8 || newPassword.length > 72) {
      setStatus("accountPasswordStatus", "新しいパスワードは8〜72文字で入力してください。", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("accountPasswordStatus", "確認用パスワードが一致しません。", "error");
      return;
    }

    busy = true;
    const button = $("accountPasswordSubmit");
    const original = button.textContent;
    setBusy(button, true, "確認中…");
    setStatus("accountPasswordStatus", "", "");
    try {
      if (accountHasPassword && !currentPassword) throw new Error("現在のパスワードを入力してください。");
      setBusy(button, true, "本人確認中…");
      const { data: changed, error: changeError } = await client.functions.invoke("change-password", {
        body: {
          currentPassword: accountHasPassword ? currentPassword : undefined,
          newPassword,
          confirmPassword
        }
      });
      if (changeError) throw new Error(await readFunctionError(changeError));
      if (!changed || changed.success !== true) throw new Error(changed && changed.error || "パスワードを変更できませんでした。");
      const refreshed = await client.auth.getUser();
      if (refreshed.error || !refreshed.data.user) throw new Error("パスワードは変更されました。再ログインして状態を更新してください。");
      currentUser = refreshed.data.user;
      accountHasPassword = currentUser.app_metadata?.kuro_password_configured === true || (getProviders(currentUser).includes("email") && currentUser.user_metadata?.kuro_password_configured !== false);
      $("accountCurrentPassword").value = "";
      $("accountNewPassword").value = "";
      $("accountConfirmPassword").value = "";
      $("accountCurrentWrap").hidden = !accountHasPassword;
      $("accountCurrentPassword").required = accountHasPassword;
      $("accountPasswordIntro").textContent = accountHasPassword
        ? "KUROLAB・KURO SNS・KURO GAMES共通のパスワードを変更します。"
        : "パスワードを設定しました。次回から共通アカウントでログインできます。";
      $("accountPasswordSubmit").textContent = accountHasPassword ? "パスワードを変更" : "パスワードを設定";
      $("accountDeletePasswordWrap").hidden = !accountHasPassword;
      $("accountDeletePassword").required = accountHasPassword;
      $("accountDeleteReauthHint").hidden = accountHasPassword;
      setStatus("accountPasswordStatus", "パスワードを設定・変更しました。KUROLAB・SNS・GAMESで共通して使えます。", "success");
    } catch (error) {
      console.error("KURO account password update failed", error);
      setStatus("accountPasswordStatus", error && error.message || "パスワードを変更できませんでした。", "error");
    } finally {
      busy = false;
      setBusy(button, false, original);
      if (accountHasPassword) button.textContent = "パスワードを変更";
    }
  });

  function updateDeleteButton() {
    const ready = $("accountDeleteAgree").checked
      && $("accountDeletePhrase").value.trim() === "削除する";
    $("accountDeleteSubmit").disabled = !ready || busy;
  }
  $("accountDeleteAgree").addEventListener("change", updateDeleteButton);
  $("accountDeletePhrase").addEventListener("input", updateDeleteButton);

  async function readFunctionError(error) {
    if (error && error.context && typeof error.context.json === "function") {
      try {
        const payload = await error.context.json();
        if (payload && payload.error) return payload.error;
      } catch (_) {}
    }
    return error && error.message || "アカウントを削除できませんでした。";
  }

  $("accountDeleteForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy || !currentUser) return;
    updateDeleteButton();
    if ($("accountDeleteSubmit").disabled) return;

    const password = $("accountDeletePassword").value;
    if (accountHasPassword && !password) {
      setStatus("accountDeleteStatus", "本人確認のため、現在のパスワードを入力してください。", "error");
      return;
    }

    const accepted = window.confirm("KUROLAB・SNS・GAMES共通アカウントと関連データを削除します。この操作は取り消せません。続けますか？");
    if (!accepted) return;

    busy = true;
    const button = $("accountDeleteSubmit");
    setBusy(button, true, "削除しています…");
    setStatus("accountDeleteStatus", "本人確認と削除処理を実行しています。画面を閉じないでください。", "");
    try {
      const { data, error } = await client.functions.invoke("delete-account", {
        body: {
          confirmation: "削除する",
          password: accountHasPassword ? password : undefined
        }
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!data || data.success !== true) throw new Error(data && data.error || "削除を完了できませんでした。");
      try { await client.auth.signOut({ scope: "local" }); } catch (_) {}
      try { localStorage.removeItem("sb-" + PROJECT_REF + "-auth-token"); } catch (_) {}
      $("accountPasswordCard").hidden = true;
      $("accountDeleteCard").hidden = true;
      $("accountUser").hidden = true;
      $("accountLoggedOut").hidden = false;
      $("accountLoggedOut").querySelector("strong").textContent = "アカウントを削除しました";
      $("accountLoggedOut").querySelector("p").textContent = "KUROLAB共通アカウントと関連データの削除が完了しました。トップページへ移動できます。";
      $("accountLoggedOut").querySelector("a").textContent = "KUROLABトップへ";
      $("accountLoggedOut").querySelector("a").href = "/";
      setStatus("accountDeleteStatus", "アカウントを削除しました。", "success");
    } catch (error) {
      console.error("KURO account deletion failed", error);
      setStatus("accountDeleteStatus", error && error.message || "アカウントを削除できませんでした。", "error");
    } finally {
      busy = false;
      if (!currentUser) button.disabled = true;
      else {
        button.textContent = "アカウントを削除する";
        updateDeleteButton();
      }
    }
  });

  client.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT" && currentUser) {
      currentUser = null;
      $("accountUser").hidden = true;
      $("accountPasswordCard").hidden = true;
      $("accountDeleteCard").hidden = true;
      $("accountLoggedOut").hidden = false;
    }
  });

  loadAccount().catch(function (error) {
    console.error("KURO account page load failed", error);
    $("accountLoggedOut").hidden = false;
    $("accountLoggedOut").querySelector("p").textContent = "アカウント情報を読み込めませんでした。ページを再読み込みしてください。";
  });
})();