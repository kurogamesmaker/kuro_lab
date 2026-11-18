# KURO GAME STUDIO GAS Edition

## 役割
- 既存の **KURO SNS GAS Bridge** にGame Studioの画面表示機能を追加します。
- UI本体はKURO LabのGame Studioページをiframeで表示します。
- GAS版URLから開いたページには `transport=gas` が付与されます。
- Supabase通信は既存の経路を維持します。

`Browser → Cloudflare Worker /api/kuro-gas-proxy → 既存Apps Script doPost → Supabase`

## 重要：既存GASプロジェクトへ統合する
1. 既存のKURO SNS GAS Bridgeプロジェクトを開きます。
2. このフォルダの `Code.gs` の内容で既存の `Code.gs` を更新します。**既存の `doPost`、認証、許可パス、レート制限を含むプロキシ処理は残してあります。**
3. `Index.html` を同じGASプロジェクトに追加し、ファイル名を `Index` にします。
4. ウェブアプリを新しいバージョンとして再デプロイします。既存のデプロイURLを維持してください。
5. 既存の `KURO_GAS_PROXY_SECRET` スクリプトプロパティはそのまま維持します。新しく初期化したり、値を変更したりしないでください。
6. Cloudflare Workerの `KURO_GAS_WEB_APP_URL` とVercel側のsecretは変更しません。

## GAS版URL
同じウェブアプリURLに次のクエリを付けて開きます。
- `?page=studio` : ビジュアルエディター
- `?page=code` : コードエディター
- `?page=projects` : プロジェクト一覧
- `?page=games` : KURO GAMES
- `?health=1` : 既存プロキシのヘルスチェック

## セキュリティ・注意
- `doPost` は既存のSupabaseプロキシ処理を維持しています。別の `doPost` を追加しないでください。
- `KURO_GAS_PROXY_SECRET` はスクリプトプロパティで管理し、HTMLやGitHubへ書き込まないでください。
- Supabaseのservice_role/secret keyは使用しません。既存のpublishable key、ユーザーJWT、RLSを維持します。
- このリポジトリの変更だけではApps Scriptの実デプロイは完了しません。既存GASプロジェクトへの反映と再デプロイはApps Script側で行ってください。
