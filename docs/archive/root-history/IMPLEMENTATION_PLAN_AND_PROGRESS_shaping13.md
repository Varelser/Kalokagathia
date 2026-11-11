IMPLEMENTATION PLAN AND PROGRESS shaping13

実施テーマ

fiber / mesh / thread 系の差の最終詰め。



今回の対象:



mesh_weave

spectral_mesh

aurora_threads

prism_threads

glyph_weave

今回の実装

1. sceneFiberFieldSystem.tsx の profile 化

components/sceneFiberFieldSystem.tsx



既存の散発的な mode 条件分岐をやめ、getFiberProfile(mode) に集約しました。



追加した差分軸:



densityBoost

lengthBase

tangentStretch

curlBoost

normalScale / bitangentScale / seedScale

verticalBias

radialLift / radialPull

planarPull

curtainAmount

braidAmount

quantize

waveAmplitude / waveFrequency / phaseSpeed

glow

bandFrequency / bandMix

prismAmount

gateAmount

shimmerScale

pulseMix

blending



これにより、geometry 側と shader 側の両方で mode 差が出るようにした。

2. fiber 系 mode の見た目差

mesh_weave

短めで緊張した織り

平面寄り

band 強め

spectral_mesh

発光増加

phase drift

prism tint 混入

軽い curtain / radial lift

aurora_threads

長尺化

curtain wave を強化

上方向バイアス

高発光

prism_threads

spectral split を強化

band を高周波化

prism tint を強化

中程度の curtain / phase drift

glyph_weave

平面吸着を強化

位置 quantize

gate 強化

additive ではなく NormalBlending

記号的・テキスト的な織りに寄せた

3. depictionArchitecture.ts 補完

lib/depictionArchitecture.ts



未登録だった glyph_weave を追加。



追加内容:



category: mesh

rendererKind: lines

motionClass: hybrid

visualMetaphor: text-coded woven strands

shapingFocus: glyph cadence / planar snap / signal gating

bestSources: text / grid

contrastAxis: continuous weave ↔ encoded glyph mesh

4. atlas bundle の追加

lib/expressionAtlasBundles.ts



追加:



prism-thread-video

glyph-weave-codex



目的:



prism / glyph 系を bundle から即呼び出せるようにする

見本密度を renderer 実装と連動させる

5. hybrid recipe の追加

lib/hybridExpressions.ts



追加:



glyph-thread

mesh-script

6. hybrid temporal variant の追加

lib/hybridTemporalVariants.ts



追加:



glyph-thread-unravel

mesh-script-resonate

7. starter preset の追加

lib/starterLibrary.ts



追加:



starter-prism-thread-video

starter-glyph-weave-codex

starter-mesh-aurora-grid



対応 sequence も追加。

検証

npm ci 実施

npm run typecheck 通過

npm run build 通過

build 出力

dist/assets/index-DV8amjSO.js 850.07 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-CHWVFiOB.js 113.60 kB

mode 見本密度の更新

starter 内の出現数:



mesh_weave: 2

spectral_mesh: 4

aurora_threads: 7

prism_threads: 2

glyph_weave: 2

更新ファイル

components/sceneFiberFieldSystem.tsx — 397行 / 18 KB

lib/depictionArchitecture.ts — 138行 / 18 KB

lib/expressionAtlasBundles.ts — 189行 / 10 KB

lib/hybridExpressions.ts — 274行 / 12 KB

lib/hybridTemporalVariants.ts — 372行 / 12 KB

lib/starterLibrary.ts — 3808行 / 129 KB

次の優先順位

次は line / deposition / glyph 周辺の最終詰めが効果的。



優先候補:



sceneLineSystem.tsx

sceneDepositionFieldSystem.tsx

sceneGlyphOutlineSystem.tsx

sceneBrushSurfaceSystem.tsx



特に contour_echo / drift_glyph_dust / sigil_dust / shell_script / ink_bleed の差をさらに詰めると、 「線・記号・刻印・残滓」系の見た目差が一段上がる。
