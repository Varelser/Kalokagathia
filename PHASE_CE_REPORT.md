# Phase CE 実施報告 — GLSL 拡張 第2フェーズ（粒子フラグメント経路＋ボリューム霧経路の登録）

2026-11-19 / ライブ v1.78.0（前版 v1.77.0 = Phase CD）

材料: #2 スタッフの第2フェーズ実施ブリーフ（台帳 reports/runs/2026-11-19-kalokagathia-glsl-round8-brief.md）を正本とし、補助に #11 白丸のブリーフ照合（glsl-brief2-crosscheck-by-11.md、**不一致0件**）、Phase CD の実施報告・ゲート報告。前提実測（版数 v1.77.0／キー 1,345／スターター 600／カタログ 1,660件／全66スイート合格）を着手前に再確認した。GLSL 拡張はこの第2フェーズで完了し、登録は全5点（カスタムフォース／ポスト／粒子頂点／粒子フラグメント／ボリューム霧）となった。

## 実装判断（ブリーフと実コードの食い違いへの回答）

1. **霧ファイルは Phase CB で変更済みだった**（CD の申し送りどおり、着手前に実コードで再特定）。Pyro グリッド供給が入り、`alpha *= 1.0 + min(gridDens, 24.0) * uPyroDensityAmount;` が uDensity 乗算と端フェードの間に挿入され、フラグメントへ `varying vec3 vWorldPos` も追加されていた。ブリーフのアンカーは「uDensity 乗算の直後・フェードの直前」だが、契約の意味（密度適用の完了後・フェード前）を現行コードで最も忠実に保つ位置として、**Pyro 密度乗算の直後・端フェードの直前**へ縫い目を置いた
2. **`vSlice` のフラグメント側宣言欠落は現行でも事実**。頂点は宣言・書き込み済みだが、フラグメントは vUv と vWorldPos のみで、断片が vSlice を読むには宣言が要る。有効時のみ生成側で `varying float vSlice;` を追加し、無効時はストックのシェーダ文字列とバイト同一を保った（identity の前提）
3. **由来（source）フィールドは入れない**。CD の申し送りでは第2フェーズの前提候補とされたが、正本ブリーフ §2-5 が明示的に範囲外と線引きしているため、ブリーフに従った。レジストリ拡張は段2件の追加と変数型 `vec4` の追加のみ
4. **スターターは追加しない**（600 のまま）。ブリーフに指定がないため、CD と同じ判断
5. **AI カタログへは boolean（Enabled）のみ追加**。コード文字列キーにはカタログ種別が無い（既存3点と同じ扱い）

## 実装

### 共通基盤（`lib/glslInjection.ts`）
- 段の和集合へ `'particle-fragment'`／`'volume-fragment'` を追加、変数型の和集合へ `'vec4'` を追加（粒子フラグメントの書き戻し `color` の型）。既存3点の契約・ハーネス・挙動は不変

### 新規登録モジュール A（`lib/particlePointsFragmentGlsl.ts`）
- 契約 `particle-points-fragment`（段 `particle-fragment`）: 読み `vUv`（vec2）／`vLife`／`vVelocity`／`vAlpha`／`uTime`、書き戻しは `color`（vec4）のみ。バックエンドは WebGL のみ supported、上限は共通の 4,000 文字
- 禁止トークンは共通分＋経路固有: `gl_FragColor`（「color を書き換えてください」）／`discard`（「color.a を下げてください」）／テクスチャサンプリング。`uniform` の理由は粒子フラグメント側の読み取りインターフェースを列挙
- 例示は色反転＋寿命フェード。ハーネスは本番の縫い目と同型のブロック（合成→断片→分割）で、チェック頂点は最小形

### 新規登録モジュール B（`lib/volumeFogGlsl.ts`）
- 契約 `volume-fog-fragment`（段 `volume-fragment`）: 読み `vUv`／`vSlice`／`uTime`、書き戻しは `alpha`（float）のみ。禁止トークンは共通分＋`gl_FragColor`（「alpha を書き換えてください」）／`discard`（「alpha を 0 にしてください」）／テクスチャ
- 例示は vSlice 位相の明滅。ハーネスは alpha ローカル＋裸ブロック（霧の縫い目は代入先が既存のローカル変数そのもののため、合成・分割が無い）

### 縫い目 A（`components/sceneShaderParticlePointFragment.ts`）
- 目印 `// __CUSTOM_PARTICLE_FRAGMENT__` を2か所: Kinetix マスク分岐（uSdfShape >= 4）の alpha 再代入の直後・早期書き込みの直前と、SDF ブロックの後・最終書き込みの直前。分岐ごとに置くのではなく生成側で両方を置換するため、どちらの経路を通っても合成済みの最終色へ効く。各経路の組み込み discard は、その経路が通る縫い目より前にある
- `buildParticleFragmentShader(code)`: 空なら定数をそのまま返し、そうでなければ両目印を `{ vec4 color = vec4(finalColor, alpha); <断片> finalColor = color.rgb; alpha = color.a; }` へ置換

### 縫い目 B（`components/sceneVolumeFogSystemShaders.ts`）
- 目印 `// __CUSTOM_VOLUME_FOG__` を Pyro 密度乗算の直後・端フェードの直前へ1か所
- `buildVolumeFogShader(code)`: 空なら定数をそのまま返し、そうでなければ `varying vec3 vWorldPos;` の直後へ `varying float vSlice;` を追加（有効時のみ）＋目印をブロックへ置換

### 配線
- 粒子: `sceneParticleSystem.tsx` に CD の頂点 effect と同型のフラグメント effect（検証→実GLコンパイル確認→合格時のみ差し替え、失敗時は前の動作版維持＋状態ストア通知）を追加。`fragmentShader` state を本体マテリアル（key に両シェーダのハッシュを含む）とゴーストマテリアル（任意引数、既定は定数）へ渡す
- 霧: `sceneVolumeFogSystemRuntime.ts` に同型の検証・差し替え effect を実装。実効文字列は `sceneVolumeFogSystemRender.tsx` 経由で `createVolumeFogMaterial` の任意引数（既定は定数）へ渡り、全スライスが同じ文字列から作られる。**マテリアルの破棄・再生成は描画コンポーネントの render 内で行う**（ゲートで検出した競合の修正。詳細はゲート報告）
- 設定キー +4（合計 **1,349**）: `particlePointsFragmentGlslEnabled/Code`、`volumeFogGlslEnabled/Code`（いずれも既定 false／''）。型・既定値・説明文・AI カタログ（boolean のみ）へ追加
- UI: `ParticleFragmentGlslBlock`／`VolumeFogGlslBlock` を頂点ブロックの直後へ設置（既存ブロックと同型）。霧ブロックの注記には「全スライスに効く」ことと再生成が重い経路である旨を明記

## ゲートで見つけて直した実不具合（隠さない）
霧のマテリアル破棄を effect 内で行う初版では、静置したライブセッションで**2回目以降の差し替えが画面へ届かなかった**（状態表示は「適用中」になるが、描画は破棄済みの旧マテリアルを出し続ける）。iMac 実GPUゲートのリンク済みプログラム記録（陽性対照）で検出し、独立プローブで再現を確認したうえで、破棄・再生成を描画コンポーネントの render 内へ移して修正、該当ケースを再実行して全 PASS を確認した。詳細は PHASE_CE_GATE_REPORT.md。

## テスト・ビルド
- 新規 `phasece_test.mjs` **96件全合格**: レジストリ5件と新2契約の形状（color が vec4 で唯一の書き戻し／alpha が唯一の書き戻し）、検証（discard 拒否を含む各理由文言）、ハーネスのバイト固定、両シェーダモジュールの直接 import による組み立て検証（粒子: 目印2か所・両分岐の位置・discard との前後関係／霧: 有効時のみ vSlice 宣言が足され無効時はバイト同一、縫い目が密度適用後・フェード前）、既存3点の不変、配線ピン（霧の render 内リセットを含む）、既定値、総数フロア＋版数
- `phasecd_test.mjs` の配線ピン1件を CE の配線拡張（ゴースト生成へ fragmentShader を追加）に合わせて更新
- 全67スイート（66＋新規）全合格、`totals_current_test.mjs` を 1,349／600 へ更新、tsc 0、ビルド成功（バンドル `index-5ViRjTxz.js`）

## 監査追記
- Unity 監査 §4（カスタムシェーダ記述・描画側）へ Phase CE 追記: △ のまま、不足の中身のみ更新（「フラグメント全体の差し替え」が粒子フラグメント＋霧で縮小）。集計 89%（◎31／△9／×0）不変。Maxon 監査（88%、最終確定）は無変更

## 出荷
- iMac 実GPUゲート **全ケース PASS・判定 go**（詳細は PHASE_CE_GATE_REPORT.md）: identity 差分 0、粒子フラグメントの効果（0.1273）と決定論、マスク分岐への効果（0.0923、マスク場面自体の差分 0.0354 で分岐の描画を実証）、霧の効果（alpha=0 で約 0.102、vSlice バンディング約 0.058、一様スケールとの差約 0.041）と決定論、両経路の実パネル適用・検証理由・フォールバック（リンク済みプログラム単位）、例示の適用中表示と霧例示の実リンク、fps 60.2（粒子 ON 59.6／霧 ON 60.2）、verify:shaders PASS、エラー 0
- デプロイ `823879ec`（`deploy.py --project-name monosphere --dir` 明示、返却 URL が monosphere サブドメインであることを確認）。配信ツリーへは rsync --delete の全体使用なしで dist を重ね（assets と index.html のみ先に除去）、カタログ／プリセット／share 各 **1,660件**の無事、両ホストで新バンドル・サムネイル image/jpeg・プリセット実 JSON を即時＋遅延で再確認
- GitHub push `833e2b48`（22ファイル、Varelser/Kalokagathia、書き込みアカウント指定）、同期記録 **136件目**を追記（従来と同形式で手動追記）

## ブリーフとの食い違い（隠さない）
- 霧の縫い目位置: ブリーフのアンカー（uDensity 乗算の直後）に対し、現行コードでは Pyro 密度乗算の直後に置いた（上記 判断1。契約の意味は保存）
- 由来（source）フィールド: CD 申し送りの前提候補に対し、正本ブリーフ §2-5 の範囲外指定に従い入れなかった（上記 判断3）
- ブリーフ基準版（v1.74.0、`59f0ad33`）から霧ファイルが Phase CB で変わっていた点は、#11 白丸の照合（不一致0件）がブリーフ内部の整合を保証し、実コードとの差分は本報告の判断1・2で吸収した

## 残件・申し送り
- 杉の目視待ち: パネルの Particle Fragment GLSL ブロックと Volume Fog GLSL ブロック（GPGPU セクション内、頂点ブロックの後ろ）
- GLSL 拡張（第1・第2フェーズ）はこれで完了。残る GLSL 系の未実施は、ブリーフで範囲外とされた由来フィールドと、監査 §4 の残件（フラグメント「全体」の差し替え、GPU テクスチャ／パスのユーザー接続）のみ
- ELEVENTH_PLAN.md の実施ログには Phase CD の完了行が見当たらなかった（本報告と同期記録 134件目が CD の正本記録）。CE の完了行は同ファイルへ追記済み
