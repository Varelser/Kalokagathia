# iMac 起動確認チェックリスト（2026-11-09版）

対象: Drive `monosphere`（Kalokagathia）。所要時間の目安 30–45分。
結果はこのファイルにチェックと所見を書き込んで Drive に戻すか、チャットで Muse に伝えてください。

## 1. 起動
- [ ] `START_MONOSPHERE.command` で起動できる（または `npm install` → `npm start`）
- [ ] ブラウザに画面が出て、コンソールに赤いエラーが出ていない
- [ ] Play タブの GPU 診断で実GPU名が表示される（ソフトウェア描画になっていない）

## 2. 既存プリセットの回帰確認
- [ ] Frontier から2–3件（例: Frontier Liquid）を開いて、以前の見た目と大きく変わっていない
- [ ] Showcase の Living GPGPU — Boids Flock / Attractor Smooth Tube が動く
  - ※シェーダー欠陥3件の修正（11/08）で GPGPU / 堆積 / 反応拡散は「死んでいた時代」と見た目が変わっているのが正常

## 3. 生成プリセットの取り込み
- [ ] `generated-presets-20261109.json`（Ignition 01–48）を取り込める
- [ ] `generated-presets-20261109-r2.json`（Ignition 49–96）を取り込める
- [ ] `generated-presets-20261109-coverage-part1〜4.json`（Coverage 001–475）を取り込める（重い場合は part1 だけでも可）

## 4. 初点火サブシステムの抜き打ち確認（各1件、見た目と重さだけ見ればOK）
- [ ] Fluid: Ignition 07 — Fluid Uniform
- [ ] SPH: Ignition 15 — SPH Field
- [ ] Metaball: Ignition 22 — Metaball + Ambient Flow
- [ ] Volumetric: Ignition 05 — Volumetric Braidshell
- [ ] アトラクタ差し替え（thomas/rossler）: Ignition 12 — Attractor Swap Hopalong
- [ ] Magnetic: Ignition 16 — Magnetic Flow
- [ ] Elastic: Ignition 09 — Elastic Echo Ring
- [ ] Tube: Ignition 11 — Tube Corrosion Front
- [ ] SDF Collider + VField: Ignition 18 — SDF Collider + VField Swap Flow
- [ ] InterLayer Collision: Ignition 59 — InterLayer Collision Flow
- [ ] カバレッジ例: Coverage 001 — Cube × Aero

## 5. 記録
- [ ] 固まった・真っ黒になった・極端に重いプリセットの名前を記録（あれば）
- [ ] 特に良かったものの名前を記録（あれば）
- [ ] 全体を通しての感想を一言

## メモ
- 生成プリセットは「設定値として合法」なことだけを機械検証済み。実GPUでの見た目・性能はこの確認が初検証になる。
- 不具合のあるプリセット名が分かれば、Muse 側で原因切り分けと次回生成への反映ができる。
- この確認が終わるまで `monosphere-backup-20261107` は消さない方針（従来どおり）。
