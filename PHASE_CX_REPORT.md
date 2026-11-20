# Phase CX 実施報告 — ライブ動的解像度（Abyssal Garden 移植 A）

- 版: v1.87.0（2026-11-20、**未出荷**。iMac 実GPUゲートと出荷は関門として未実施）
- 起点: Noniv/abyssal-garden の静的精査 → 実験場 `~/workspace/abyssal-transfer-lab/` で独立試作（テスト11件＋統合シム）→ 杉の「次に進んで」で本体実施
- 結果: 新規 config キー **0件**（1,359 のまま）、スターター 606・カタログ 1,666 は不変

## 前提の実コード確認（実施前に当たったこと）
- 現行の DPR は `getAdaptiveDprRange()`（components/AppSceneCameraRig.tsx）が config の性能スコアから決める**静的な上限**で、R3F が devicePixelRatio をその範囲にクランプするだけ。実測フィードバックは存在しなかった → 本フェーズは置き換えではなく追加であることを確認。
- 土台は現行 v1.86.0（Phase CW 出荷済み）。フェーズ文字 CX は未使用を確認。

## 設計判断
1. **settled 値のキーはプリセットIDではなく性能シグネチャ**（renderQuality ＋ 性能スコアの0.5バケット ＋ GPGPUトグル）。理由: 実験場の結論は「型ごとに落ち着き先が違う」だったが、本体では temporal config が再生中に config を書き換え続け、プリセットIDも AppScene まで届いていない。同等の重さの config が落ち着き先を共有し、バケットを跨がないスライダー操作ではキーが揺れない形にした。
2. **静的レンジが外側の契約のまま**: 動的 DPR は `getAdaptiveDprRange()` の範囲の外に出ない。
3. **決定レンダーの同一性**: ジョブ中は DeterministicRenderManager が保持するカメラ決定性ロックを見て計測・変更を全面停止（既存の抑制フラグの作法に倣った）。書き出し経路自体は元々ジョブ解像度でオフスクリーン描画。
4. **配線はメインシーンだけ**: `AppScene` に `dynResEnabled`（既定 false）を追加し、`AppRootLayout` のメインシーンだけが有効化。埋め込み／比較シーンは従来どおり静的レンジのみ。
5. **計測はフレーム時間経路**（WebGL に移植性のある GPU タイマーがないため、原典のフォールバック規則を採用）: 54フレーム周期で平均化、遅い周期が2回連続で初めて降格、復帰は待ち（降格ごとに倍増、上限12周期）を置いて最大×1.15。キャンバスリサイズは高コストなので、適用は 0.02 以上の変化のときだけ・周期に最大1回。停止中／タブ非表示／250ms 超のヒカップは計測しない。開始直後と署名変更直後は2周期ウォームアップ。

## 実装
- `lib/dynres.ts`（新規）: `DynResController`（計測ループ）、`dynResSignature`、`loadDynResSettled`／`saveDynResSettled`（localStorage `kalokagathia.dynres.v1`、署名64件上限・古い順に追放、不正値は読込時に除去）。保存形式・プリセット・プロジェクトファイルには一切入らない。
- `components/DynResController.tsx`（新規）: Canvas 内コントローラ。マウント時と署名変更時に settled を即適用し、変更のたびに保存。
- `components/AppScene.tsx` / `AppSceneTypes.ts` / `AppRootLayout.tsx`: prop 追加とメインシーンでの有効化。
- `package.json` 1.86.0 → 1.87.0、`components/controlPanelPlayTabRender.tsx` の版定数も同期、CHANGELOG に [1.87.0] 項。

## 検証（VM 静的検証まで。実GPUは未実施）
- 新規スイート `~/workspace/kalokagathia-pro/phasecx_test.mjs`: **30件全合格**（署名の安定性／コントローラの降格・復帰・クランプ・ヒカップ無視／retarget／保存の往復・上限・不正値除去／配線ピン／総数）
- 全スイート: **76スイート全合格**（下記の版定数の一件を修正後に再実行して全件確認）
- `npx tsc --noEmit` 正常終了、本番ビルド成功（バンドル `index-KEiFNpfj.js`）、変更ファイルの eslint exit 0、`verify:project-state` exit 0

## 途中の所見2件（隠さず記録）
1. **復帰が天井に戻らない**: 初版の復帰設計（待ち上限24周期・上昇×1.08）では、床まで落ちた後に軽負荷を続けても 1.5 に届かなかった（テストで検出）。原典の復帰幅に寄せて待ち上限12周期・上昇×1.15 に調整し、全負荷域での往復を確認した。
2. **版定数の同期漏れで既存20スイートが失敗**: package.json の版だけ上げた初回全スイート実行で 56/76 合格・20件失敗。原因は `KALOKAGATHIA_APP_VERSION` 定数との不一致（私の同期漏れ）で、定数を 1.87.0 に揃えて失敗20件を再実行し全件合格を確認した。本体の挙動には無関係の検証側の整合だった。

## 残る関門（ここで止まる）
- **iMac 実GPUゲート（直列・単独）**: ①決定レンダーの identity（dynRes 有効なメインシーン経由でも従来と差分0）②重いプリセットで DPR が実際に下がり、軽いプリセットで settled から始まること ③回帰 fps・エラー0。
- ゲート合格後に、出荷（配信ツリーへのステージング／デプロイ／GitHub push／CURRENT_STATUS 現行化）を行うかどうかは杉の指示待ち。現行ライブ v1.86.0 は不変。
- 後続フェーズ候補: B（クラッシュフラグ式セーフモード、本実験場で試作済み）→ C（ベンチ＋視覚批評パック）。
