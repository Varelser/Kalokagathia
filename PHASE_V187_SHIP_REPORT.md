# v1.87.0 出荷記録（Phase CX＋CV＋CY 同梱便、2026-11-20）

統合・ゲート・出荷: #1 Muse（CX は別レーン実施、CV／CY は本レーン）。

## 同梱内容

- **Phase CX**: ライブ動的解像度（lib/dynres.ts）。詳細 PHASE_CX_REPORT.md。
- **Phase CV**: 名前付きグループ（述語／凍結／合成、キー2件追加で総数 1,361）。
  詳細 PHASE_CV_REPORT.md。
- **Phase CY**: Edge Output Mask スターターの maskMode を clip→shape へ
  （Phase CQ の裁定 (A)「意味は変えない」に従う再調整）。詳細
  `~/workspace/kalokagathia-pro/PHASE_CY_REPORT.md`。

## ゲート（iMac 実GPU、ANGLE Metal / AMD Radeon Pro 5500 XT、直列・単独）

- Phase CV ゲート: identity 差分0／groups 3経路（従来述語・名前付き述語・
  凍結）がビット一致／panel 実操作／fps 合格。詳細 PHASE_CV_GATE_REPORT.md。
- Phase CX ゲート: **settled 復元の実欠陥を検出** — R3F が config 駆動の
  再描画で dpr prop を再適用し、復元した settled DPR を範囲最大へ
  踏み戻す。コアは自値との乖離に気づけず再適用できなかった。
  修正（乖離の監視: 権威後は再主張、権威前は syncApplied で取込み）を
  統合側で実施し、phasecx スイートを 30→35件へ拡張。修正後の再ゲートで
  降格 2→1.47→1.06→1 と settled 開始（再読込で 1 を維持）を確認。
  詳細 PHASE_CX_GATE_REPORT.md。
- 最終バンドルでの全76スイート再実行: 全合格。型検査・本番ビルド合格
  （初期バンドル index-C4FFS29P.js、896.37 kB）。

## 出荷

- ステージング: site ツリーへ dist をコピー（assets/ と index.html のみ
  入替、静的 catalog/・share/・presets/ は保持。--delete 不使用）。
- アプリ便デプロイ: `e32f45fd-4ef3-4352-a72b-7e6fae82c87d`
  （https://e32f45fd.monosphere.pages.dev）。両ホストの index.html
  sha256 `a6644db4…` が dist と一致。
- CY カタログ収録: ライブ v1.87.0 で撮影（lit 7.9%、CM 時 0.3% から回復。
  姿は粒子で描く VARELSER ロゴタイプ）。重複対策として旧バッチ
  （v111-v164 starters）の同スターター記録を新バッチへ移設
  （preset JSON は maskMode 'shape' の現行記録が配信される）。
  カタログ 1,666 → **1,667**（未収録は Star Section Tube のみ）。
  カタログ便デプロイ: `a08e97ed-1833-4516-be66-2e7ce2f73406`。
  両ホストで thumb 200 image/jpeg／share 200／preset JSON の
  maskMode 'shape'／generated-collection 1,667／fps 1,667件／
  カタログ figure 1,667 を確認。アプリ index.html の sha は不変。
