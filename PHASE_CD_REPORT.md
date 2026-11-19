# Phase CD 実施報告 — GLSL 拡張 第1フェーズ（粒子頂点経路の登録）

2026-11-19 / ライブ v1.77.0（前版 v1.76.0 = Phase CC）

材料: #2 スタッフの実施計画（台帳 reports/runs/2026-11-19-kalokagathia-glsl-round5-plan.md）と第1フェーズ実施ブリーフ（2026-11-19-kalokagathia-glsl-round7-brief.md）を正本とし、補助に #11 白丸のブリーフ照合（glsl-brief-crosscheck-by-11.md、不一致は行番号の軽微1件のみ）、#8 dbgame の計画照合（glsl-plan-crosscheck-by-8.md）、第10ラウンドの #2 残件洗い出し（2-round10-glsl-remaining.md）。前提実測（版数 v1.76.0／キー 1,343／スターター 600／カタログ 1,659件／全65スイート合格）を着手前に再確認した。GLSL 拡張はこの第1フェーズ（粒子頂点）のみで、粒子フラグメント・ボリューム霧は第2フェーズの担当として含めていない。

## 実装判断（ブリーフ・計画の食い違いと未確定事項への回答）

1. **段名は `'particle-vertex'`**（実施計画の確定案）。第1フェーズブリーフ本文は `'vertex'` と書くが、実施計画が確定案として `particle-vertex` を採り、第2フェーズブリーフも計画側の命名（`particle-fragment`／`volume-fragment`）で揃えてある。#2 の決定事項 A1（別名を併存させない）への回答として計画側に統一した。既存段名（`simulation-fragment`／`post-fragment`）の「経路＋段」の形とも一致する
2. **`prevPos` にも同じ `disp` を加える**。`pos` のみだと、定数変位でも trailDelta と `vVelocity` に静的な変位分が混入し、存在しないストリークを捏造する。#11 白丸の照合留意への回答。変位は粒子ごとの位置オフセットであり、`prevPos` は同じ粒子の直前位置なので、両方へ加えるのが差分を粒子の運動だけに保つ形
3. **スターターは追加しない**（600 のまま）。ブリーフに指定がなく、#2 の洗い出し A4 でも未議論のため、今回の範囲に含めなかった
4. **レジストリ拡張は段の追加＋重複登録時の開発時警告のみ**。`vec4` 型と由来（source）フィールドはブリーフの線引きどおり今回は扱わない（第2フェーズ＝フラグメント経路の前提）
5. **AI カタログへは boolean（Enabled）のみ追加**。コード文字列キーにはカタログ種別が無い（`gpgpuCustomForceCode`／`postCustomGlslCode` と同じ扱い）

## 実装

### 共通基盤（`lib/glslInjection.ts`）
- 段の和集合へ `'particle-vertex'` を追加
- `registerGlslInjection` に重複登録時の開発時警告を追加（従来どおり後勝ちは維持）。二つのモジュールが一つの差し込み点を主張する配線ミスを、無言で通さないための変更
- `buildHarness` の doc コメントを「その段自身のシェーダ（フラグメント点はフラグメント、頂点点は頂点）」へ一般化（挙動変更なし）

### 新規登録モジュール（`lib/particlePointsVertexGlsl.ts`）
- 契約 `particle-points-vertex`（段 `particle-vertex`）: 読み `pos`（vec3）／`lifeProgress`（float）／`aVariant`（float）／`uTime`（float）、書き戻しは `disp`（vec3）のみ。バックエンドは WebGL のみ supported（WebGPU／CPU は unsupported を明示）。上限は共通の 4,000 文字
- 禁止トークンは契約別の理由文言: `gl_Position`／`gl_PointSize` は「disp に変位を入れてください」、`uniform` の理由は頂点側の読み取りインターフェースを列挙。その他は既存点と同趣旨（`#`／`void main`／`attribute`／`varying`／`precision`／テクスチャサンプリング）
- 例示コードはブリーフの既知の断片（粒子ごとに位相をずらした上下の揺れ、振幅 0.05）
- ハーネスは**頂点シェーダ**: 属性宣言は実シェーダ自身のもの（aPosition／aOffset／aData1〜3／aFeedbackIndex）を使い、断片は実縫い目と同じブロック構造（`disp` をブロック内で宣言）で受ける。対のフラグメントは最小形。コンパイル確認はコンパイルのみ（リンクはしない）という共通基盤の規則どおり

### 縫い目と組み立て（`components/sceneShaderParticlePointVertex.ts`）
- 目印コメント `// __CUSTOM_PARTICLE_VERTEX__` を、最後の `pos` 加算（音声パルス項）の直後・`mvPosition` 算出の直前へ設置。縫い目がモデルビュー変換の前にあるため、変位はビルボード経路（mvPosition 経由）とインスタンス3D分岐（`pos` を直接消費）の両方へ届く
- `buildParticleVertexShader(code)`: 空断片ではストック文字列をそのまま返し、そうでなければ目印を `{ vec3 disp = vec3(0.0); <断片> pos += disp; prevPos += disp; }` のブロックへ置換する

### 配線（`components/sceneParticleSystem.tsx` ほか）
- 粒子システムのコンポーネントが所有者となり、既存2点と同じ作法で: 検証 → 実GLコンパイル確認（頂点ハーネス＋最小フラグメント対）→ 合格時のみ有効シェーダ文字列を差し替える。適用済みコードの ref で重複確認を避け、失敗時は状態ストアへ error を通知して前の動作版を維持する
- 差し替え先は本体マテリアルとゴーストマテリアルの両方（ゴーストは同じ粒子の過去位置なので一緒に変位させる）。マテリアルの key にシェーダ文字列のハッシュを含め、差し替え時に確実に再コンパイルさせる（ShaderMaterial は `vertexShader` プロパティの代入だけでは再コンパイルしないため）

### 設定キー +2（合計 1,345）
`particlePointsVertexGlslEnabled`（false）／`particlePointsVertexGlslCode`（''）。型は `types/configCore.ts`、既定値は `lib/appStateDefaultViewDisplay.ts`、説明文と AI カタログ（boolean のみ）を追加

### UI
`components/controlPanelGlobalDisplayParticleVertexCustom.tsx` の `ParticleVertexGlslBlock` を、Custom Force ブロックの直後（GPGPU Forces/Maps セクション内）へ設置。既存2ブロックと同型: 下書き textarea＋「適用」＋「例を読み込む」＋状態表示（適用中／「適用できませんでした（前のシェーダを維持しています）: …」）。注記には契約（読み値と disp）と CPU フォールバックでの不適用を明記

## テスト・ビルド
- 新規 `phasecd_test.mjs` **52件全合格**: レジストリ形状（3点・段名・変数表・disp が唯一の書き込み可能変数・バックエンド・上限）、検証（例示と既知断片の合格、各禁止トークンの理由文言、上限メッセージ、トークン的に清いがコンパイル不良の断片は静的検証を通ること）、ハーネスのバイト固定と実シェーダの属性宣言との一致、縫い目位置と組み立て関数のソースピン、既存2点の不変（カスタムフォースのハーネス出力バイト同一を含む）、重複登録の警告と後勝ち、配線ピン、既定値、総数フロア
  - なお頂点シェーダモジュールは Node から直接 import できない（物理チャンク経由でアプリ状態ライブラリを引き、バンドラ定義が必要）ため、その部分はソースピンで固定した。実行時の組み立て結果は実GPUゲートの効果・決定論ケースが実証している
- 全66スイート（65＋新規）全合格、`totals_current_test.mjs` を 1,345／600 へ更新、tsc 0、ビルド成功（バンドル `index-BBPNC9aY.js`）

## 監査追記
- Unity 監査 §4（カスタムシェーダ記述・描画側）へ Phase CD 追記: △ のまま、不足の中身のみ更新（「頂点シェーダにスロットはない」は解消、残る不足はフラグメント全体の差し替え＝第2フェーズ）。集計 89%（◎31／△9／×0）不変。Maxon 監査（88%、最終確定）は無変更

## 出荷
- iMac 実GPUゲート **全ケース PASS・判定 go**（詳細は PHASE_CD_GATE_REPORT.md）: identity 差分 0、効果と決定論（ビルボード／インスタンス3D）、実パネルでの適用・検証理由・フォールバック（リンク済みプログラム単位で未差し替えを確認）、例示コードの適用中表示、fps 60.2（頂点 ON 59.8）、verify:shaders PASS、エラー 0
- デプロイ `e4e2b2f4`（`deploy.py --project-name monosphere --dir` 明示、返却 URL が monosphere サブドメインであることを確認）。配信ツリーへは rsync --delete の全体使用なしで dist を重ね（assets と index.html のみ先に除去）、カタログ／プリセット／share 各 1,659件の無事、両ホストで新バンドル・サムネイル image/jpeg・プリセット実 JSON・カタログ索引（count 1,659）を即時＋遅延で再確認
- GitHub push `ee25cc4e`（16ファイル、Varelser/Kalokagathia、書き込みアカウント指定）、同期記録 134件目を追記（CC と同形式で手動追記）

## ブリーフとの食い違い（隠さない）
- 段名: ブリーフ本文 `'vertex'` vs 実施計画の確定案 `'particle-vertex'` → 計画側を採用（上記 判断1）
- インスタンス3D分岐の入口行: ブリーフ／#11 照合の :309 は分岐内で `pos` を消費する行で、分岐入口は現行 :302 付近。縫い目の位置そのもの（最後の pos 加算の後・mvPosition の前）はブリーフ指定どおりで影響なし
- 実施計画（round5-plan）の末尾欠落は #8 の照合どおりで、設計照合への影響なし

## 残件・申し送り
- 杉の目視待ち: パネルの Particle Vertex GLSL ブロック（GPGPU セクション内、Custom Force の直後）
- GLSL 拡張 第2フェーズ（粒子フラグメント＋ボリューム霧）は未実施。着手時は霧系ファイルが Phase CB で変更済みのため、縫い目と `vSlice` 宣言の現況を実コードで再特定すること（#2 の洗い出し B5）。第2フェーズの前提として `vec4` 型と由来フィールドのレジストリ拡張が残る
- スターター追加の要否は未議論（#2 の洗い出し A4）。追加する場合はカタログ収録ラウンドとセットで
