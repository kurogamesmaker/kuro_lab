import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEFAULT_URL = "https://cprvpphlfpmiegjiutjn.supabase.co";
const DEFAULT_KEY = "sb_publishable_BYPUfB0lrh26jV8_6ZQnpQ_wfAKOVyn";
const FUNCTION_NAME = "kurogames-online";

let client = null;
let gameId = null;
let gameConfig = null;

function ensureReady() {
  if (!client || !gameId) throw new Error("先に KuroGames.init({ gameId }) を実行してください。");
}

async function invoke(action, params = {}) {
  ensureReady();
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
    body: { action, gameId, ...params },
  });
  if (error) {
    const message = error.message || "KUROGAMES ONLINEとの通信に失敗しました。";
    throw new Error(message);
  }
  if (data && data.error) throw new Error(data.error);
  return data ?? {};
}

const KuroGames = {
  async init(options = {}) {
    const nextGameId = options.gameId;
    if (typeof nextGameId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nextGameId)) {
      throw new Error("gameIdが正しくありません。Studioのオンライン設定画面からコピーしてください。");
    }
    gameId = nextGameId;
    client = createClient(options.url || DEFAULT_URL, options.publishableKey || DEFAULT_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: options.fetch ? { fetch: options.fetch } : undefined,
    });
    gameConfig = await invoke("get_config");
    return { gameId, game: gameConfig.game, features: gameConfig.features };
  },

  get config() {
    return gameConfig;
  },

  auth: {
    async getUser() {
      ensureReady();
      const { data, error } = await client.auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") throw error;
      return data?.user ?? null;
    },
    onChange(callback) {
      ensureReady();
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (typeof callback === "function") callback({ event, user: session?.user ?? null });
      });
      return () => data.subscription.unsubscribe();
    },
  },

  ranking: {
    async submit(score, options = {}) {
      if (!Number.isSafeInteger(Number(score))) throw new TypeError("scoreは整数で指定してください。");
      const submissionId = crypto.randomUUID();
      return invoke("score_submit", {
        score: Number(score),
        mode: options.mode || "default",
        metadata: options.metadata || {},
        submissionId,
      });
    },
    async get(options = {}) {
      const result = await invoke("leaderboard", {
        mode: options.mode || "default",
        limit: options.limit || 20,
      });
      return result.scores || [];
    },
  },

  save: {
    async get(key = "default") {
      const result = await invoke("save_get", { key });
      return result.value;
    },
    async set(key, value) {
      return invoke("save_set", { key: key || "default", value });
    },
    async delete(key = "default") {
      return invoke("save_delete", { key });
    },
  },

  async refreshConfig() {
    gameConfig = await invoke("get_config");
    return gameConfig;
  },
};

if (typeof window !== "undefined") window.KuroGames = KuroGames;
export { KuroGames };
export default KuroGames;
