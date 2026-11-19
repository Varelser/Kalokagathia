# Phase CL iMac 実GPUゲート報告

- 環境: iMac（Radeon Pro 5500 XT、ANGLE Metal）。候補 = CL の dist を `http://127.0.0.1:8851/` で配信、本番 v1.84.0（https://monosphere.pages.dev/）を旧版として比較
- ゲートスクリプト: `phasecl_gate.mjs`（CK のハーネスを継承）
- 総合: **ALL PASS、エラー 0**

## ケース結果

### identity — PASS
- FROZEN 構成で本番 v1.84.0 と候補 v1.85.0 を比較: **12 フレーム全て差分 0**
- 色名を割り当て属性ソースを data にしても色駆動 OFF の構成（COLOR_KEYS_IDLE）: **12 フレーム全て差分 0**（名前の割当だけでは何も変わらない）
- 候補の manifestVersion は `1.85.0`

### det — PASS
- 色スターター（starter-point-cache-color）を 2 回描画: sameMax **0**（ビット一致）
- 色駆動 OFF の変種は 12 フレーム全てで差分あり（最小 0.00286）— 駆動が実際に効いている

### fps — PASS
- 色スターター負荷で平均 **60.2 fps**、最小ウィンドウ 60

### ui — PASS（再実行 3 回目）
- 実パネル操作: Main タブ → Display セクションと Attributes サブグループを展開 → 「Attr → Color」トグルを実マウスクリックで OFF／ON
- 色の発散度（点灯ピクセルのチャンネル間平均発散）: ON **0.0221**（121,442 点灯ピクセル、カラフル判定 ≥0.015 を満たす）→ OFF **0.00038**（ほぼ 0 へ崩壊）→ 再 ON **0.0201**（復帰）

## ui ケースの失敗記録（いずれもゲートスクリプト側の不備で、製品の不具合ではない）

1. **実行 1**: トグルのラベルが見つからず失敗。原因は Attributes 節が Main タブ側にあるのに、実描画の初期タブ（Play）のまま探していたこと。製品側の証拠はこの時点で既に陽性（色駆動 ON の発散 0.0227）
2. **実行 2**: スクリプトの変数渡し忘れ（`page.evaluate` へ `wantOn` を引数で渡さず ReferenceError）で落下。修正後に再実行すると今度はトグルのボックスが 0×0（zero-box）
3. **zero-box の原因特定**: 実DOMプローブ（`phasecl_probe.mjs`）で祖先チェーンを実測し、トグルが **二重の折りたたみ**の奥にあることを確認した。外側は Display セクション（`.mg-fold`、見出し `.mg-h`）、内側は Attributes サブグループ（`.mg-fold2`、見出し `.mg-h2`。`styles.css:118` の `.mg-fold2 > *:not(.mg-keep2) { display: none !important; }`、開閉は `components/controlPanelTabs.tsx`）。従来の展開フォールバックは `.mg-h` しか扱わず内側が閉じたままだった
4. **修正と合格**: ラベルの祖先にある折りたたみ容器を外側から順に、その見出し（`.mg-h`／`.mg-h2`）のクリックで展開してから実マウスクリックする手順に直し、再実行 3 回目で全チェック合格（OFF の実クリックは `clicked (unfolded:Display|Attributes …)` と記録）

## 備考

- probe ケースは無し（CL に Worker の変更は無い）
- ゲート中のコンソールエラーは全実行を通じて 0（スクリプト側の例外を除く）
