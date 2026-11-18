# Kalokagathia 公開スクリプト API 仕様（Public Script API）

外部サイト（note 記事・ブログ等）へ埋め込んだプレイヤーを、ホストページのスクリプトから制御するための公開仕様です。プロトコル版数: **1**。AI 制御カタログのスキーマ版数: **1**（`AI_CONTROL_CATALOG_VERSION`、コード正本は `lib/aiControlCatalog.ts`、プロトコルの実装正本は `lib/embedControl.ts`）。

安定性の宣言: 本仕様のメッセージ形状（名前空間・版数・コマンド名・必須フィールド）は、プロトコル版数を上げない限り変更しません。パラメータキーの追加・削除はアプリの版に従います（キーの正本は AI 制御カタログ）。

## 1. 埋め込み URL

```
https://monosphere.pages.dev/?embed=1#p=<presetId>   プリセットを再生
https://monosphere.pages.dev/?embed=1#c=<payload>    インライン config スナップショットを再生
https://monosphere.pages.dev/?embed=1                既定シーンを再生
```

`<iframe src="..." width="800" height="450" style="border:0" loading="lazy" allowfullscreen></iframe>` の形で貼り付けます。

## 2. postMessage 制御プロトコル

埋め込みプレイヤー（`?embed=1`）に対してのみ有効です。通常アプリはこのプロトコルを受け付けません。

送信形式: `iframe.contentWindow.postMessage(message, '*')`

すべてのメッセージは次の形を持ちます:

```json
{ "ns": "kalokagathia", "v": 1, "type": "<command>", ... }
```

名前空間（`ns`）または版数（`v`）が一致しないメッセージは無視されます。origin の白リストは持ちません（任意サイトへの埋め込みが前提のため）。代わりに、後述の検証規則そのものが安全境界です。

### コマンド

| type | 追加フィールド | 動作 |
|---|---|---|
| `setParam` | `key`, `value` | パラメータを1件変更する。値は AI 制御カタログの検証（キーの実在・型・数値範囲・列挙値）を通った場合のみ適用され、外れた指定は破棄されます |
| `applyPreset` | `id` | プリセット／スターターを ID 指定で適用する。任意の config を直接注入する手段はありません。未知の ID は破棄されます |
| `setUserParam` | `name`, `value` | ユーザーが宣言した User Parameter を名前で変更する。宣言されていない名前・検証を通らない値は破棄されます |
| `getState` | なし | 現在の状態を返信する（下記） |

### getState への返信

送信元の origin へ、次の形で返信します:

```json
{
  "ns": "kalokagathia", "v": 1, "type": "state",
  "presetId": "<現在のプリセット ID または null>",
  "isPlaying": true,
  "catalogVersion": 1,
  "userParameters": [ { "name": "<宣言名>", "value": "<現在値>" } ]
}
```

### 検証規則（安全境界）

- `setParam` の値は `lib/aiControlCatalog.ts` の検証をそのまま通します: 未知キー・型違い・範囲外の数値・不正な列挙値は破棄され、数値は範囲へクランプ＋刻みへスナップされます。
- `applyPreset` は ID のみを受けます。config 本体を含むメッセージは受理しません。
- 状態の変更はすべて通常の config 更新経路を通ります。実効 config への直接の重ね書き手段はありません。

## 3. 共有ハッシュ形式

- `#p=<presetId>`: プリセット／スターターの共有。
- `#c=<payload>`: config スナップショットの共有（base64url 圧縮 JSON、`lib/shareLink.ts` が正本）。

埋め込み URL はこのハッシュをそのまま使います。

## 4. その他の外部制御（既存・変更なし）

- AI 制御カタログ: 全キーの機械可読カタログ（`lib/aiControlCatalog.ts`）。スキーマ版数は本書冒頭のとおり。
- `/api/ai` リレー: AI タブからの問い合わせ用（IP レート制限あり）。ホストページ向けの公開 API ではありません。
- MIDI / OSC / Ableton Link: アプリ内の外部制御（`lib/midiControl.ts` / `lib/oscControl.ts` / `lib/linkSync.ts`）。本書の対象外です。
