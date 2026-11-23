# KCB2 — Kalokagathia 単体コード書き出し (standalone exporter)

Casberry 導入候補2の実装。Kalokagathia のプリセットから、**外部ライブラリ無し・単一ファイル HTML**（Raw WebGL の points 描画）を生成する独立 Node CLI。本体ツリー（monosphere-audit / kalokagathia-casberry/project）には一切触れない。

## 使い方

```sh
# プリセットJSONから
node kcb2-export.mjs --preset ~/workspace/monosphere-audit/site/presets/starter-gpgpu-morph-galaxy.json --out samples/starter-gpgpu-morph-galaxy

# #c= ペイロードから（ペイロード文字列そのもの／#c= 付き／URLごとでも可）
node kcb2-export.mjs --payload '#c=abcd1234...' --out out/shared [--id my-name]
```

出力は `<out>/<id>.html` と `<out>/<id>.manifest.json` の2点。

## 再現範囲（対応サブセット）

- 粒子数 `gpgpuCount`、seed `gpgpuSeed`、初期分布（emit shape 7種）
  - 初期位置は本家の `lib/gpgpuInitialData.ts`（mulberry32、`lib/seededRng.ts`）と**同一の乱数描画順**で生成し、先頭 `gpgpuCount` 個の粒子位置・初期 age が本家とビット一致する（`verify.mjs` が本家 TS を実走して照合）
  - 位置は `gpgpuBounceRadius` で正規化して描画
- 点サイズ（`gpgpuSize` × `baseSize`）、不透明度 `gpgpuOpacity`、背景色（`backgroundHex` 優先、次に `backgroundColor`）
- 回転（`rotationSpeedX/Y` を rad/秒へ換算＋`manualRotationX/Y/Z`）
- 色付け: 単色 `gpgpuColor`／グラデーション `gpgpuGrad*`（停止点リスト or 従来3〜5点、driver は age）／age 色 `gpgpuAgeColor*`
- ブレンド `gpgpuBlendMode`（additive / normal）
- アニメーションは基本形のみ: 回転＋初期速度方向への微振動（shimmer）。**GPGPU 物理の再現ではない**

## 対象外（黙って落とさない）

GPGPU 物理・ポストFX・モーフ・レイヤー等は再現しない。入力 config に含まれていた未対応キーは**全件** manifest の `unsupportedKeys` に列挙され、近似したキーは `approximatedKeys` に理由付きで入る。生成 HTML のヘッダーコメントにも同旨を明記。

## 検証

```sh
node verify.mjs   # 決定性（同一入力→同一バイト）／seed再現（本家TSと照合）／ヘッドレス描画（エラー0・非空ピクセル）
```

生成サンプル3件は `samples/` 配下（manifest 同梱）。
