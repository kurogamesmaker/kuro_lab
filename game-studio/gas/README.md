# KURO GAME STUDIO GAS Edition

## 役割
- このApps ScriptプロジェクトはGAS版の入口を提供します。
- UI本体はKURO LabのGame Studioページをiframeで表示します。
- GAS版URLから開いたページには `transport=gas` が付与されます。
- Game StudioのSupabase Auth / Data API通信は、ブラウザから直接Supabaseへ送らず、次の経路を通ります。

`Browser → https://kurolab.cc.cd/api/kuro-gas-proxy → Apps Script Web App → Supabase`

## デプロイ
1. Google Apps Scriptで新しいプロジェクトを作成します。
2. `Code.gs` の内容をスクリプトファイルに貼り付けます。
3. `Index.html` の内容をHTMLファイルに貼り付け、ファイル名を `Index` にします。
4. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選びます。
5. 実行ユーザーは自分、アクセスできるユーザーは既存KURO GASリレーの設定と同じ範囲にします。
6. デプロイURLを既存Cloudflare Workerの `KURO_GAS_WEB_APP_URL` に設定します。既存リレーと同じGASを使う場合は、既存URLを維持してください。
7. `KURO_GAS_PROXY_SECRET` は既存の秘密値を維持し、HTMLやGitHubへ書き込まないでください。

## 注意
- このリポジトリにあるのはGAS版のソースです。Google Apps Scriptへの実デプロイはApps Scriptエディタ側で行う必要があります。
- 既存KURO GASリレーのURL/secretを変更する必要はありません。既存リレーをそのまま使うのが基本です。
- Supabaseのservice_role/secret keyはブラウザにもHTMLにも置きません。既存のRLSとユーザーJWTを維持します。
