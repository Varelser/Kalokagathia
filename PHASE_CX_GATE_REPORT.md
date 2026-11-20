# Phase CX — iMac 実GPUゲート報告（2026-11-20、#1 Muse が実施）

対象: Phase CX（ライブ動的解像度）を含む候補ビルド（ツリーは
CX＋CY＋CV、package 1.87.0）。実GPU = ANGLE Metal / AMD Radeon
Pro 5500 XT。ゲートスクリプト:
`~/workspace/kalokagathia-pro/phasecx_gate.mjs`（dynres ケース）。
identity と fps は同一バンドルに対する Phase CV ゲート
（`PHASE_CV_GATE_REPORT.md`）で実証済み（FROZEN 12フレーム差分0、
fps 33.6、エラー0）。

## dynres ケースの設計

- 重負荷: GPGPU 300,000 粒子＋bloom、renderQuality 'cinematic'、
  性能スコア 1.5 バケット（適応レンジ [1, 2]）。GPGPU 粒子数は
  性能スコアに入らないため、レンジは全開のまま負荷だけを掛けられる。
- 観測は retina 文脈（deviceScaleFactor 2、1920×1200）が必須。
  devicePixelRatio 1 の文脈ではキャンバスが DPR 1 を超えられず、
  適応そのものが観測できない（初回実行で確認した測定側の落とし穴。
  ハッシュ形式もアプリ正規の deflate 形式でなければならない —
  平 base64 のプローブは既定構成を測ってしまう）。

## 初回: 不合格 — settled 復元の実欠陥を検出

- 降格そのものは合格: DPR 2 → 1.02 → 1 と下がり、settled は
  `cinematic|s1.5|g1: 1` として保存された。
- しかし再読み込みでは、settled の 1 がマウント直後（約1.5秒）に
  一度適用された直後、約3秒で DPR 2 へ跳ね戻り、60秒観測しても
  二度と下がらなかった。
- 原因: R3F は config 駆動の再描画のたびに `dpr` prop を再適用する。
  コントローラのコアは「自分は既に下限にいる」と信じているため、
  外部から踏み潰されても再適用の判断が出ない（feed の候補値が
  applied と一致し続ける）。settled 復元の保証が再描画1回で
  無効化される実欠陥。

## 修正（統合側で実施、CX レーンへ台帳経由で通知）

- `lib/dynres.ts`: `DynResController.syncApplied(dpr)` を追加
  （外部適用値を開始点として取り込む。カウンタには触れない）。
- `components/DynResController.tsx`: useFrame で実キャンバス DPR
  （state.viewport.dpr）と core.applied の乖離を監視する。
  コアが権威を持つ（settled 適用済み or 判断発行済み）後は乖離を
  再主張で直し、権威を持つ前は syncApplied で外部値を取り込む。
- スイートは phasecx 30 → **35件**（syncApplied の単体3件＋配線
  ピン2件を追加）で全合格。

## 再実行: 合格

- 降格: 2 → 1.47 → 1.06 → 1（段階的に降格）。
- settled 開始: 再読み込みの全サンプルが 1（落ち着いた値から
  始まり維持される）。
- エラー 0。同一バンドルでの CV ゲート再実行も全合格
  （identity 差分0、groups 3経路ビット一致、panel、fps）。
