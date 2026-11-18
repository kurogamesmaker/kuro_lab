# KURO GAS 共通ブリッジ（SNS + GAME STUDIO）

このフォルダーを、KURO SNSとKURO GAME STUDIOで共有する唯一のApps Scriptコード置き場とします。

## 共通構成
- `Code.gs`：SNSのSupabase中継処理とGame Studioの画面ルーティングを統合した唯一のエントリーポイント
- `Index.html`：Game Studio GAS版の画面シェル
- `index.html`：Webサイト側のSNS GAS入口（PC/スマホ振り分け）。Apps ScriptのHTMLファイル `Index` とは別物です。
- `appsscript.json`：Apps Scriptマニフェスト

## 既存SNS中継を維持
既存の `doPost`、Supabase publishable key、許可パス、許可HTTPメソッド、レート制限、`KURO_GAS_PROXY_SECRET` の参照方法は維持しています。新しいScript Propertyや新しい秘密値は不要です。

既存のヘルスチェックも維持しています。
- GAS WebアプリURL（パラメータなし）：従来どおりJSONヘルスチェック
- `?health=1`：従来どおりJSONヘルスチェック

## GAME STUDIOのGAS画面
同じWebアプリURLに次のパラメータを付けます。
- `?page=studio`：ビジュアルエディター
- `?page=code`：コードエディター
- `?page=projects`：プロジェクト一覧
- `?page=games`：KURO GAMES

Game Studioの画面本体は `kurolab.cc.cd` からiframeで読み込み、`transport=gas` を付けて既存のSupabase中継経路を利用します。

## 再デプロイ
1. 既存KURO SNS GASプロジェクトを開く。
2. このフォルダーの `Code.gs` で既存コードを置き換える。
3. `Index.html` を同じGASプロジェクトに追加する（HTMLファイル名は `Index`）。
4. 既存の `KURO_GAS_PROXY_SECRET` Script Propertyはそのまま維持する。再生成しない。
5. 既存Webアプリデプロイを「新バージョン」で更新する。デプロイURLは維持する。
6. 既存のCloudflare Worker / Vercel環境変数 `KURO_GAS_WEB_APP_URL` と `KURO_GAS_PROXY_SECRET` は変更しない。

## セキュリティと制限
- service_role / secret keyは使用しません。
- SNSのAPI中継は既存のVercel API経由です。
- Game StudioのUI本体はiframeです。Apps Script内に全ページのコードを複製しているわけではありません。
- 実際のGAS反映・再デプロイ後に、SNSログイン/投稿/チャットとGame Studioのログイン/公開をそれぞれ確認してください。
