IMPLEMENTATION PLAN AND PROGRESS — shaping14

今回の目的

line / deposition / glyph 系の差を最終詰めし、以下の mode で見た目差を強める。



contour_echo

ink_bleed

drift_glyph_dust

sigil_dust

shell_script

実施内容

1. deposition renderer の profile 化

対象: components/sceneDepositionFieldSystem.tsx



追加内容:



DepositionProfile / DEPOSITION_PROFILES を新設

deposition_field

stipple_field

ink_bleed

drift_glyph_dust

sigil_dust

seep_fracture



差分軸:



dotField

relief / erosion / bands / opacity の mode 別補正

scale / scaleY

rotation / pitch

dotScale / dotSoftness

bandWarp

bleedSpread

glyphGrid

contourMix

additive / normal blending 切替



shader 追加 uniform:



uDotScale

uDotSoftness

uBandWarp

uBleedSpread

uGlyphGrid

uContourMix



効果:



ink_bleed は滲み・溜まり・パリンプセスト感を強化

drift_glyph_dust は漂流する glyph residue 寄りに強化

sigil_dust は quantized な印章面・記号格子寄りに強化

2. patch renderer の profile 化

対象: components/sceneSurfacePatchSystem.tsx



追加内容:



PatchProfile / PATCH_PROFILES を新設

surface_patch

contour_echo

echo_rings

standing_interference

tremor_lattice



差分軸:



rippleMul

opacity / fresnel 補正

contourBands

contourSharpness

plateMix

echoMix

shearMix

planarPull

rotationMul



shader 追加 uniform:



uContourBands

uContourSharpness

uPlateMix

uEchoMix

uShearMix



効果:



contour_echo は平板感・等高線感・版面感を強化

echo_rings は輪唱的な ring echo を強化

standing_interference は standing band / shear を強化

3. shell_script の専用 shaping 強化

対象: components/sceneSurfaceShellSystem.tsx



変更:



shell_script profile を再調整

flattening / scan / band / etch を強化

manuscript shell としての差を強くした

4. depictionArchitecture の差分記述更新

対象: lib/depictionArchitecture.ts



更新対象:



ink_bleed

contour_echo

drift_glyph_dust

sigil_dust

shell_script



内容:



spatialSignature

shapingFocus

contrastAxis の文言を、今回の renderer 実装に合わせて更新

5. atlas / hybrid / temporal / starter の同期

対象:



lib/expressionAtlasBundles.ts

lib/hybridExpressions.ts

lib/hybridTemporalVariants.ts

lib/starterLibrary.ts



追加 atlas bundle:



contour-codex-plate

ink-glyph-palimpsest



追加 hybrid:



contour-script

ink-glyph



追加 temporal:



contour-script-resonance

ink-glyph-accretion



追加 starter preset:



starter-contour-script-manuscript

starter-ink-glyph-palimpsest

starter-sigil-shell-codex



追加 sequence:



starter-sequence-contour-script-manuscript

starter-sequence-ink-glyph-palimpsest

starter-sequence-sigil-shell-codex

検証

npm run typecheck 通過

npm run build 通過



build 出力:



dist/assets/index-tzPnm4DA.js 851.42 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-BRUfz8qv.js 113.89 kB

主要更新ファイル

components/sceneDepositionFieldSystem.tsx — 339行 / 14.7 KB

components/sceneSurfacePatchSystem.tsx — 335行 / 14.9 KB

components/sceneSurfaceShellSystem.tsx — 330行 / 15.7 KB

lib/depictionArchitecture.ts — 137行 / 17.1 KB

lib/expressionAtlasBundles.ts — 189行 / 9.1 KB

lib/hybridExpressions.ts — 274行 / 11.2 KB

lib/hybridTemporalVariants.ts — 372行 / 11.9 KB

lib/starterLibrary.ts — 3816行 / 128.6 KB

今回の到達点

deposition / patch / shell の3系統で dedicated profile を導入

line / glyph / script 系の差が parameter 差だけではなく shader 差として立つ状態に前進

atlas / hybrid / starter を renderer 強化と同期

次の優先順位

sceneLineSystem.tsx の dedicated profile 化

sceneGlyphOutlineSystem.tsx の mode 依存差分導入

controlPanelProceduralModeSettings.tsx で depictionArchitecture の差分表示を増やす

mode ごとの demo sheet / gallery density を 2本→4本に引き上げる
