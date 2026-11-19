# KUROGAMES 共通データ・通信仕様

## 初期化
KUROGAMESのゲームプレイヤー内で、認証ブリッジが利用可能になってから一度だけ初期化します。

```js
const { features } = await KuroGames.init({ gameId: "Studioに表示されるゲームID" });
```

以降の通信は必ず `KuroGames` SDK 経由にします。ゲームHTMLからSupabase REST、Realtime、GASのURLや認証トークンを直接扱わないでください。接続方式（Supabase / GAS）はKUROGAMES側の設定に任せます。

## プレイヤー個人のクラウドセーブ
```js
const save = await KuroGames.save.get("progress"); // 未保存なら null
await KuroGames.save.set("progress", { stage: 12, coins: 450 });
const keys = await KuroGames.save.list();
await KuroGames.save.delete("progress");
```

- データは「ゲームID × ログイン中のKUROアカウント × key」で分離。
- 1キー64KB以内、キー名は1〜64文字。
- 現在のアカウントのデータだけを読み書きできます。
- Studio設定でクラウドセーブを有効にしたゲームで利用できます。
- `KuroGames.storage` は `save` の別名API（get / set / remove / list）。

## ルーム通信
```js
const room = await KuroGames.multiplayer.createRoom({ maxPlayers: 8 });
// または const room = await KuroGames.multiplayer.joinRoom("A1B2C3");

const snapshot = await room.getState();
await room.updateState({ phase: "lobby", players: [] }, snapshot.updatedAt);

await room.send("player-ready", { ready: true });
const off = room.onMessage((event) => {
  if (event.type === "player-ready") console.log(event.data);
});
const offPlayers = room.onPlayersChange((players) => console.log(players));

off(); offPlayers();
await room.leave();
```

- ルームコードは6文字英数字、最大35人。
- `getState/updateState` は全員で共有するJSON状態。1状態128KB以内。
- `updateState(next, expectedUpdatedAt)` は楽観ロック。競合時は `{ conflict: true }` が返るので再取得して再計算。
- `send/onMessage` は一時イベント。1イベント32KB以内。重要な状態をイベントだけに保存しない。
- RealtimeとGASポーリングはSDK内部で切替。ゲーム側は同じAPIを使う。
- 退出時は `room.leave()` と購読解除を行う。

## 通信の設計ルール
1. `KuroGames.init({ gameId })` を先に実行。
2. 個人進行状況は `save`、ルーム共通の進行状況は `room.getState/updateState`。
3. 即時通知・演出だけを `room.send/onMessage` にする。
4. パスワード、秘密鍵、サービスロールキー、認証トークンをゲームデータに保存・送信しない。
5. クライアントの値を信用せず、勝敗・報酬・ランキングなど重要な判定はサーバー側で検証する。
6. ゲームごとにStudioのオンライン設定で必要な機能だけ有効化する。
7. 通信エラー、タイムアウト、競合を想定し、二重付与・二重登録を防ぐ。

## 機能フラグ
- `features.cloudSave`: 個人セーブ
- `features.multiplayer`: ルーム一覧・作成・参加・状態同期
- `features.ranking`: ランキング
