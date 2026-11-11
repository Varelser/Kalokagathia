# Kalokagathia

モノクロームに徹した、ブラウザで動く 3D パーティクル / 生成アートの実験場です。
React 19 + Three.js (WebGL) + GPGPU で、反応拡散・群れ・自己組織化などの数理モデルを
数百のプリセットとリアルタイムのパラメータ操作で探索できます。

- **公開デモ**: https://monosphere.pages.dev/
- **ライセンス**: MIT（`LICENSE` を参照）
- プリセットカタログ: 746 件（類似プリセット検索つき）

## できること

- 3 レイヤー構成の粒子シーン（Attractor / Reaction-Diffusion / GPGPU 群体など多数のモーション）
- プリセットの部分適用・ブレンド、進化ラボ（交叉・突然変異）、パラメータタイムライン、パラメータモーフィング再生
- AI タブ: 自然言語の指示からプリセット生成・パラメータ調整（BYOK、下記参照）
- プリセットのクラウド同期（任意、Neon Postgres、下記「アーキテクチャ」参照）

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
npm run build    # 型チェック + 本番ビルド
npm run typecheck
npm run verify:project-state  # ほか verify:* スクリプト群
```

プリセットカタログの再生成は `preset-analysis/` 配下の Python スクリプトで行います
（リポジトリにはソースデータの `generated-presets-*.json` を同梱）。

## アーキテクチャ

- **フロント**: Vite + React 19 + Three.js。Cloudflare Pages に静的配信（Direct Upload）。
- **リレー**: `public/_worker.js`（Pages Functions 相当の Worker）が `/api/ai`（AI プロキシ＋
  Durable Objects によるグローバルレート制限）と `/api/sync/*`（プリセット同期）を担当。
  秘密情報はすべて環境変数（`GROQ_API_KEY` 等）参照で、コードには含まれません。
- **同期（任意）**: Neon Postgres に同期コードの SHA-256 ハッシュのみを保存し、
  プリセットを端末間で union / newest-wins マージします。既定は OFF です。
- **GPU ティア**: `lib/gpuTier.ts`（判定・分類表・ベンチマーク）、`lib/gpuTierWarnings.ts`（推奨警告）。

## 注意

- `public/icons/` の PWA アイコン画像（PNG）は、このリポジトリへの登録経路の制約で含まれていません。
  本番デモには含まれています。必要なら `public/manifest.webmanifest` の参照に合わせて画像を配置してください。
- 開発経緯の詳細なドキュメントは `docs/` と `CURRENT_STATUS.md` / `UPDATE_LOG.md` にあります。

## License

MIT — Copyright (c) 2026 Varelser
