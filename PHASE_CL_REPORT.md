# Phase CL 実施報告 — ポイントキャッシュ第2弾（A 属性保持＋B 色保持）

- 版: v1.85.0（2026-11-20）
- 起点: #4 db のポイントキャッシュ第2弾ブリーフ（ラウンド11）＋ #9 30 の照合（修正はブリーフへ反映済み）。司令塔裁定 (a)〜(f) を先行して確定し、実装した
- 結果: キー 1,358 → **1,359**（+1: `gpgpuAttrColorEnabled`、既定 false）、スターター 605 → **606**（+1: `starter-point-cache-color`）、カタログ 1,660 件（不変）

## 司令塔裁定（ブリーフの未決事項）

- (a) 属性列の上限は **4 列**（マニフェスト解釈時に超過を理由つきで拒否）
- (b) 色の規約名は **`colorR` / `colorG` / `colorB`**（大文字小文字を区別しない）
- (c) A（スカラー属性の保持）と B（色保持）は **Phase CL で同時出荷**
- (d) `perFrame` の区別は **維持**（perFrame:false の属性は全フレーム同一を検証し、1フレーム分だけ保持）
- (e) 色列は **raw のまま保持し、正規化の対象外**
- (f) マニフェストは **不変**（v2 の `attributes` 宣言と検証が既存）

## ブリーフの文面からの読み替え 2 件（実コード優先の原則による）

1. **同一性は文字列ではなく数値で担保**: ブリーフは DRAW シェーダをビルダー前提で書いていたが、実コードの `DRAW_VERT` / `DRAW_FRAG`（`components/gpgpuShaderPoints.ts`）は静的 const 文字列。したがって無効時の同一性は、既存の作法（vAttrBright / vLightMul / vShadowMul）どおり「`vAttrColor` は無効時にちょうど `vec3(1.0)`、乗算は常時実行」で担保した。identity ゲートで 12 フレーム差分 0 を実証
2. **色乗算の縫い目は `col *= vAttrBright;` の直後**: ブリーフ指定の `vec3 col = uColor;` 直後に置くと、後段の age／velocity／gradient の色経路に上書きされて常用構成で無言に無効化される。乗算チェーン内の vAttrBright 直後が、すべての色経路の後段で効く唯一の位置
- 付随判断: 色スロットはベイク時の式ステージを **通さない**（Phase BI の式は [0,1] にクランプされ raw の色を壊す）。色列の raw 値は他のスロットの式の変数としては従来どおり使える

## 実装

- `lib/pointCache.ts`: `POINT_CACHE_MAX_ATTRIBUTE_COLUMNS = 4` を公開し上限を強制。`PointCacheData` に `attrFrames`（フレーム×列×点）／`attrMins`／`attrMaxs` を追加。PLY フレーム解釈は属性列も返し、perFrame:false の属性は全フレーム同一を検証（不一致は属性名とファイル名を挙げて拒否）。クラウド構築は位置と同じ i0/i1/frac で属性も補間し、スカラー列は min/max で範囲正規化（定数列は 0.5）、色名列は normalized 側にも raw を保持。同梱サンプルは属性 [heat, colorR, colorG, colorB]（全て perFrame:true、決定的な値、位置は不変）を宣言
- `lib/attrPointCloud.ts`: `ATTR_COLOR_COLUMN_NAMES`／`isAttrColorColumnName`／`sampleAttrColumnRaw`（raw 値の読み取り。汎用 `buildCloud` は不変）
- `lib/gpgpuAttributes.ts`: `ATTR_COLOR_SLOT_NAMES`／`resolveAttrColorSlots`（3 名そろった場合のみ有効）。ベイクは色スロットに raw サンプラを使い式ステージをスキップ。`AttrConsumers.colorActive` を追加し anyActive へ統合
- `types/configGpgpu.ts`＋`lib/appStateDefaultGpgpu.ts`: 新キー `gpgpuAttrColorEnabled: boolean`（既定 false）。`lib/parameterDescriptions.ts`／`lib/aiControlCatalog.ts` に説明とカタログ項目を追加
- `components/gpgpuShaderPoints.ts`: DRAW_VERT に `uAttrColorEnabled`／`uAttrColorSlotR/G/B` と `varying vec3 vAttrColor` を追加（初期値 `vec3(1.0)`、割当は既存の `if (uAttrEnabled)` ブロック内で `kaloAttrChannel` 経由）。DRAW_FRAG は `col *= vAttrBright;` の直後に `col *= vAttrColor;`
- `components/useGpgpuDrawAssets.ts`／`components/gpgpuVisualUpdates.ts`／`components/useGpgpuRuntime.ts`: ユニフォームの追加と配線（colorActive 時のみスロット解決、ベイクへ `colorRawSlots` を渡し、attrSignature に `attrColor` を含める）
- `components/controlPanelGlobalDisplayGpgpuForcesCore.tsx`: Attributes 節にトグル「Attr → Color（色駆動 — Phase CL）」と説明（3 名必須・色は 4 スロット中 3 つを使用・ポイントキャッシュの色列はフレームごとに保持）
- `lib/starterLibraryPresetExtensionChunk05Gpgpu.ts`: スターター `starter-point-cache-color`（同梱サンプル、モーフ先 data、色駆動 ON、属性名 [colorR, colorG, colorB, heat]）

## 検証

- 新規スイート `phasecl_test.mjs`: **56 件全合格**（途中の 1 件の失敗は私のテスト前提の誤り — ポイントキャッシュのクラウドは色列を normalized 側にも raw で保持するのが設計で、0.5 の従来正規化は汎用 CSV クラウド側の挙動。テストを正本に合わせて修正済み）
- 全スイート: **73 スイート・失敗なし**。`npx tsc --noEmit` 正常終了
- 本番ビルド成功（バンドル `index-DIzf9IF2.js`）
- verify:shaders **PASS**（34 プリセット、失敗 0、コンソールエラー 0）
- iMac 実GPUゲート: **全ケース PASS**（詳細は PHASE_CL_GATE_REPORT.md）
