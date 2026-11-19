# Phase CC 実施報告 — CSG 第1弾（判断分岐基盤の最後の1件）

2026-11-19 / ライブ v1.76.0（前版 v1.75.0 = Phase CB）

材料: #5 ランザルザーの最終統合版ブリーフ（台帳 reports/runs/2026-11-19-kalokagathia-csg-final.md、約48KB）を正本とし、補助に #10 NEW のゲート節確認（csg-final-gate-check-by-10.md）と watertight ゲート実測（csg-watertight-gate-by-10.md）、#9 30 の前提ドリフト再点検（crosscheck-by-9-round8.md、本実施を止めるドリフトなし）、#3 ミッドナイトの SDF 共存確認（csg-sdf-coexistence.md）。前提実測（版数 v1.75.0／キー 1,333／スターター 599／カタログ 1,659件）を着手前に再確認した。これで第11期の判断分岐基盤5件（GLSL＝BX／SDF＝BY／ポイントキャッシュ＝BZ／Pyro＝CA＋CB／CSG＝CC）は全て出荷済みになった。

## 実装（最終版ブリーフの「第1弾」の範囲）

### 基盤（Worker＋WASM）
- `manifold-3d@3.5.4` を導入し、専用 Worker（`workers/csgWorker.ts`）でのみ読み込む。クライアント（`lib/csg.ts`）は遅延生成・直列キュー・5秒タイムアウトで Worker を破棄再生成・結果キャッシュを持ち、**CSG が無効の間は Worker も WASM も一切読み込まれない**（ビルドでも `csgWorker-*.js` と `manifold-*.wasm` は別アセットとして分離され、初期バンドルに入らない）
- 構築コア（`lib/csgPrimitive.ts`）は Worker と Node テストの双方から使う単一実装。メッシュ被演算子の構築は `Manifold.ofMesh` の単一箇所で、`merge()` は使わない（溶接で黙って直してしまうと ゲート (b) の意味がなくなるため）

### watertight ゲート
- ゲート (a)（`lib/csgGate.ts`、純粋関数）: 有限チェック → 1e-6 溶接 → 辺センサス → Euler = 2×成分数。上限 100,000 面を超える入力は (a) を `skipped` とし (b)(c) が砦になる
- ゲート (b): 構築時の ManifoldError／status を `NOT_MANIFOLD` として理由文つきで返す（#10 の実測どおり、開いたグリッドメッシュ＝書き出しメッシュの形はここで落ちる）
- ゲート (c): 結果メッシュの再検査（Euler・成分数・不良辺）を Worker 内で実施し、結果表示にも載せる
- エラー分類は #10 のゲート節確認どおり「ManifoldError はメッセージによらず NOT_MANIFOLD、それ以外は UNKNOWN＋Worker 再生成」で確定

### 演算と取り込み
- プリミティブ5種（立方体・球・円柱・円錐・トーラス、規約はブリーフの数値表どおり）と和・差・積。UI（Graph タブの CSG セクション）からはプリミティブ同士、コア API ではメッシュ被演算子も扱える（メッシュの UI 導線は第2弾の範囲）
- 結果は `buildIndexedObjText` でインデックス化 OBJ テキスト化し、`gpgpuMorphObjSource` へ取り込む（#3 の共存確認どおり: 非インデックスだとモーフの法線がファセット化する／ゲート (a) を通ったメッシュは SDF のゲートも通る／中空結果は SDF では中身詰まり扱い・薄い結果は 96³、の注意書きを UI に明記）
- 同梱サンプルとして cube−sphere の結果 OBJ（体積 5.952390、153頂点・302三角）を定数埋め込み（`lib/csgSampleObj.ts`）

### 新規キー +10（合計 1,343）
`gpgpuCsgEnabled`（false）／`gpgpuCsgPrimitiveA`（'cube'）／`gpgpuCsgPrimitiveB`（'sphere'）／`gpgpuCsgOperation`（'difference'）／`gpgpuCsgSizeA`・`gpgpuCsgSizeB`（各 2）／`gpgpuCsgSegments`（32）／`gpgpuCsgOffsetBX`（1）・`gpgpuCsgOffsetBY`（0）・`gpgpuCsgOffsetBZ`（0）。全て既定で従来同一になる値

### スターター +1（合計 600）
`starter-csg-cube-minus-sphere`「CSG Cube Minus Sphere」: モーフ対象を同梱結果 OBJ にし、OBJ メッシュ描画 ON、CSG レシピキーも併記（開いてそのまま再実行できる形）

## テスト・ビルド
- 新規 `phasecc_test.mjs` **77件全合格**: ゲート (a) の合格条件ケース群（閉立方体／1三角欠け＝不良辺3・Euler 1／1面欠け／中空2成分＝Euler 4 で通過／NaN 拒否／非溶接立方体の通過／グリッド書き出しメッシュの拒否）、本番構築コアでの数値表（プリミティブ・演算・メッシュ被演算子の (b) 拒否・決定論・体積クロスチェック）、OBJ 往復、配線ピン、スターター検証、総数フロア
- 全65スイート（64＋新規）全合格、tsc 0、ビルド成功（バンドル `index-C0cUxtJ2.js`）

## 監査追記
- Houdini 監査 §1 Boolean（CSG）へ Phase CC 追記: × のまま据え置き、不足の中身のみ更新（「基盤自体がない」→ 第1弾で基盤は実在化、残る不足はシーン内メッシュの被演算子化・演算履歴・書き出し導線）。集計 71% 不変。Maxon 監査は無変更

## 出荷
- iMac 実GPUゲート **全ケース PASS・判定 go**（詳細は PHASE_CC_GATE_REPORT.md）: identity 差分 0、スターター形状の決定論ビット一致と表示実証、実パネル経由の和 12／差 5.9524／積 4 とモーフ取り込み、本番 Worker 資産プローブでの開メッシュ拒否、fps 60.2、verify:shaders PASS、エラー 0
- デプロイ `db003f1a`（`deploy.py --project-name monosphere` 明示、URL は monosphere サブドメインを確認）。配信ツリーは rsync --delete 全体不使用で dist を重ね（assets と index.html のみ先に除去）、カタログ／プリセット／share 各 1,659件の無事と、ライブでサムネイル image/jpeg・プリセット実 JSON・Worker／WASM（application/wasm）の正常応答を確認
- GitHub push `73a83494`（18ファイル）、同期記録 133件目を追記（CLI が自動追記しなかったため CB と同形式で手動追記）。遠隔 blob（lib/csgPrimitive.ts）の SHA がローカルと一致
- 両ホスト（本番＋デプロイ URL）とも新バンドル `index-C0cUxtJ2.js` を配信していることを即時確認。時間を置いた再確認は統合側の定例として実施

## 残・申し送り
- 杉の目視待ち: 新スターター「CSG Cube Minus Sphere」、Graph タブの CSG セクション
- 新スターターはカタログ未収録（次の収録ラウンドで撮影・収録する）
- 第2弾の範囲（未実施）: メッシュ被演算子の UI 導線、演算履歴、結果の書き出し
- ゲート脚本の初版がサマリ記述頼みで UI 文言と Worker プロトコルを取り違え、実コードを読み直して直した経緯は GATE 報告に明記した（アプリ側の不具合ではない）
