# Kalokagathia

モノクロームに徹した、ブラウザで動く 3D パーティクル / 生成アートの実験場です。
React 19 + Three.js (WebGL) + GPGPU で、反応拡散・群れ・自己組織化などの数理モデルを
数百のプリセットとリアルタイムのパラメータ操作で探索できます。

[![Kalokagathia — Coverage 370: Cube × Fronds](https://monosphere.pages.dev/catalog/thumbs/coverage-370-cube-fronds-20261109.jpg)](https://monosphere.pages.dev/)

| [![Coverage 001 — Cube × Aero](https://monosphere.pages.dev/catalog/thumbs/coverage-001-cube-aero-20261109.jpg)](https://monosphere.pages.dev/share/coverage-001-cube-aero-20261109) | [![Ignition 05 — Volumetric Braidshell](https://monosphere.pages.dev/catalog/thumbs/ignition-05-volumetric-braidshell-20261109.jpg)](https://monosphere.pages.dev/share/ignition-05-volumetric-braidshell-20261109) | [![Theory: Domain Warp (Strong)](https://monosphere.pages.dev/catalog/thumbs/theory-warp-strong.jpg)](https://monosphere.pages.dev/share/theory-warp-strong) |
|---|---|---|
| Coverage 001 — Cube × Aero | Ignition 05 — Volumetric Braidshell | Theory: Domain Warp (Strong) |

プリセットは全 **746** 件。生成コレクションの一覧は[カタログ](https://monosphere.pages.dev/catalog/)で見られます（画像クリックで各プリセットの共有ページへ）。

- **公開デモ**: https://monosphere.pages.dev/
- **ライセンス**: MIT（`LICENSE` を参照）
- プリセットカタログ: 746 件（類似プリセット検索つき）

## できること

- 3 レイヤー構成の粒子シーン（Attractor / Reaction-Diffusion / GPGPU 群体など多数のモーション）
- プリセットの部分適用・ブレンド、進化ラボ（交叉・突然変異）、パラメータタイムライン、パラメータモーフィング再生
- AI タブ: 自然言語の指示からプリセット生成・パラメータ調整（BYOK、下記参照）
- プリセットのクラウド同期（任意、Neon Postgres、下記「アーキテクチャ」参照）

### UI（4辺分割レイアウト）

コントロールは画面の4辺に分散し、中央は常にキャンバスだけに保ちます。各辺は個別にたためます。

- **上**: 細いヘッダー（タイトル、今のプリセット名、PLAY / DESIGN / LAB の階層切替、Basic / Pro 切替、共有）
- **左**: 縦レール（デッキ切替、Wake Lock、Document PiP、全画面、鑑賞モード）
- **右**: プリセット棚（検索・カテゴリ・タグ絞り込み、ジャンル別セクション）
- **下**: 再生コントロールとマクロスライダー。詳細パラメータは下から開くシートに展開（高さはドラッグで調整可）

### プリセット棚と生成コレクション

- 内蔵ライブラリ **444件**をジャンル別セクションで格納（折りたたみ状態は記憶されます）
- 生成コレクション **746件**も棚に統合済み。「生成コレクション · Generated」グループに
  シリーズ別（Coverage / Ignition / Theory / Lenia / Particle Life / DLA / L-System /
  Raymarch / Audio FFT）で並び、実サムネイル付きカードからそのまま適用できます
- 746件分の目次は別ファイル（`generated-collection.json`、約66KB）として分離し、
  グループを初めて開く時（または検索時）にだけ読み込む遅延式なので、初回表示は軽いままです
- 棚のヘッダーには生成プリセットのカタログ（ギャラリー）へのリンクがあります

### プラットフォーム機能

- **Wake Lock**（再生中だけ画面を消さない）、**Document Picture-in-Picture**（キャンバスを小窓化）
- **全画面表示**、静止画の **PNG コピー**（クリップボード）、**Web Share**（共有シート）
- **File System Access** によるファイル保存、キーボードショートカット
- ローカル保存は **IndexedDB** ベース（保存データが自動削除されにくいよう `storage.persist()` も申請）
- PWA 対応（インストール可能。サービスワーカーはキャッシュせず常時最新版を取得する設計）

### カタログと共有ページ

- 生成プリセット746件のギャラリーを https://monosphere.pages.dev/catalog/ で公開
  （サムネイル一覧＋類似プリセット検索）。棚の「Catalog」リンクからも開けます
- 各プリセットには共有ページ（`/share/<id>`）と JSON（`/presets/<id>.json`）があり、
  共有リンクを開くとそのプリセットがシーンに読み込まれます
- `robots.txt` と `sitemap.xml`（トップ＋カタログ＋共有746ページ）を同梱。
  sitemap はビルド前に `scripts/build-sitemap.mjs` がプリセット実データから自動生成します
- 存在しないファイル（`.json` など拡張子付きパス）には、アプリ本体ではなく本物の 404 を返します

### 新しめの表現システム（2026-11 追加）

1. **Lenia** — 連続セルオートマトンを第 3 の反応モデルとして追加
2. **Particle Life** — GPGPU 速度シェーダで動く種間相互作用の自己組織化
3. **FFT オーディオ反応** — マイク/再生音声の周波数帯域（sub/low/mid/high/presence/level）を変調ソース化
4. **DLA レイヤー** — 拡散律速凝集（樹状結晶成長）の専用レイヤー
5. **L-system レイヤー** — 書き換え文法による分岐構造生成（5 種のルールセット）
6. **レイマーチング SDF レイヤー** — Mandelbulb 距離推定＋ブロブ/コラムのレイマーチ描画

## GPU ティアと推奨環境

起動時に GPU 名（WebGL レンダラ文字列）と簡易ベンチマークから GPU ティアを自動判定し、
重い機能の既定値と推奨警告に使います。判定は Play タブの「GPU Diagnostics」で確認でき、
手動で上書きもできます。警告はブロックせず、「この機能は ○○ 以上のGPU推奨」と知らせるだけです。

| ティア | 例 | 開ける既定値 |
|---|---|---|
| エントリー | Intel HD/UHD、Apple A 系、ソフトウェア描画 | レイマーチ scale 0.35 / steps 48、GPGPU 上限 512 |
| 標準 | Radeon Pro 5500 XT、Iris Xe、GTX 16 系、RTX 3050 | レイマーチ scale 0.5 / steps 64、GPGPU 上限 512 |
| 高性能 | Apple M Pro/無印、RTX 3060–4070、RX 6700–7800 | レイマーチ scale 0.75 / steps 96、GPGPU 上限 768 |
| フラッグシップ | Apple M Max/Ultra、RTX 4080/4090/5080/5090、RX 7900 | レイマーチ scale 1.0 / steps 128、GPGPU 上限 1024 |

- 推奨: WebGL2 対応ブラウザ（Chrome / Edge / Safari / Firefox の現行版）
- 重量級プリセット（一部は測定環境で 15fps 未満）は Lite 版プリセットも同梱しています

## AI 機能の使い方（BYOK）

AI タブは利用者自身の API キーで動きます（キーはブラウザ内にのみ保存され、サーバには保存されません）。

1. [Groq](https://console.groq.com/) または [Google AI Studio](https://aistudio.google.com/) で無料の API キーを取得
2. アプリの AI タブでキーを入力
3. 自然言語で指示（例:「もっと暗く、渦を強く」）するとプリセット生成・調整が行われます

公開デモでは共有リレー経由の試用も可能ですが、レート制限があります。本格利用は BYOK を推奨します。

## ローカル開発

```bash
npm install
npm run dev      # 開発サーバ
npm run build    # 型チェック + 本番ビルド（prebuild で生成コレクション目次と sitemap を再生成）
npm run typecheck
npm run verify:project-state  # ほか verify:* スクリプト群
```

プリセットカタログの再生成は `preset-analysis/` 配下の Python スクリプトで行います
（リポジトリにはソースデータの `generated-presets-*.json` を同梱）。

## アーキテクチャ

- **フロント**: Vite + React 19 + Three.js。Cloudflare Pages に静的配信（Direct Upload）。
  ローカルのプリセット・設定保存は IndexedDB が正本です。
- **リレー**: `public/_worker.js`（Pages Functions 相当の Worker）が `/api/ai`（AI プロキシ＋
  Durable Objects によるグローバルレート制限）と `/api/sync/*`（プリセット同期）を担当。
  秘密情報はすべて環境変数（`GROQ_API_KEY` 等）参照で、コードには含まれません。
  静的ファイルの配信もこの Worker が担い、無いファイルには実 404 を返します。
- **同期（任意）**: Neon Postgres に同期コードの SHA-256 ハッシュのみを保存し、
  プリセットを端末間で union / newest-wins マージします。既定は OFF です。
- **GPU ティア**: `lib/gpuTier.ts`（判定・分類表・ベンチマーク）、`lib/gpuTierWarnings.ts`（推奨警告）。

## 注意

- `public/icons/` の PWA アイコン画像（PNG）は、このリポジトリへの登録経路の制約で含まれていません。
  本番デモには含まれています。必要なら `public/manifest.webmanifest` の参照に合わせて画像を配置してください。
- 開発経緯の詳細なドキュメントは `docs/` と `CURRENT_STATUS.md` / `UPDATE_LOG.md` にあります。

## License

MIT — Copyright (c) 2026 Varelser
