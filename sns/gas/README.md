# KURO SNS GAS 中継版 セットアップ

通信経路：ブラウザー → kurolab.cc.cd のVercel API → Google Apps Script → Supabase。

旧版 /sns/ は残し、新版 /sns/gas/ で同じSupabaseプロジェクト・データを使用します。

## 1. Apps Scriptを作成
1. Google Apps Scriptでスタンドアロンプロジェクトを作成。
2. Code.gsをコード.gsへ貼り付け。
3. プロジェクト設定でappsscript.jsonを表示し、このフォルダーのマニフェストに置き換える。
4. initializeProxySecretを実行して権限承認。実行ログに出る秘密値をコピーする。

## 2. Webアプリとしてデプロイ
1. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」。
2. 実行ユーザーは「自分」、アクセスできるユーザーは「全員」。
3. デプロイ後のURL（末尾が /exec）を控える。GAS側の秘密値はScript Propertiesに保存される。

## 3. Vercel環境変数
kuro-labプロジェクトのProduction環境に次の2つを登録する。
- KURO_GAS_WEB_APP_URL：Apps Scriptの /exec URL
- KURO_GAS_PROXY_SECRET：initializeProxySecretの実行ログに出た秘密値

その後、Vercelを再デプロイする。/api/kuro-gas-proxy?health=1 が ready:true を返せば中継先に接続できている。

## 4. Supabase
Google/Appleログインを利用する場合は、Authentication → URL Configuration → Redirect URLsに https://kurolab.cc.cd/sns/gas/ を追加する。OAuth認証画面への遷移自体はSupabaseへ直接移動するため、学校ネットワークがSupabaseドメインを遮断している場合は動作しない可能性がある。

## 動作と制限
- service_role/secret keyは使用しない。Supabase publishable keyと各利用者のJWTを中継し、データ保護は既存RLSに従う。
- Realtime WebSocketはGASで中継できないため、チャットとグループチャットは約8秒、通知は約30秒ごとにHTTP再取得する。
- GASの実行時間・URL Fetch割当、Vercelのリクエストサイズ上限がある。大きなファイル・高負荷用途には適さない。
- 学校などがGASドメインも遮断している場合、この経路も利用できない。
- 旧版は /sns/ に残し、新版画面からいつでも戻れる。
