IMPLEMENTATION_PLAN_AND_PROGRESS_shaping11

今回の実施対象

最優先だった次の3点を実装した。



sceneSurfaceShellSystem.tsx の専用 shaping 強化

sceneVolumeFogSystem.tsx の専用 shaping 強化

starter preset の見本密度補強

実装内容

1. shell 系 renderer の専用 shaping 強化

components/sceneSurfaceShellSystem.tsx



mode ごとの ShellProfile を導入

既存の散発的 ternary 分岐を profile ベースに整理

追加した差分軸

scaleX / scaleY / scaleZ

radialLift

ringLift

spikeStrength

quantize

droop

mirrorWarp

scriptWarp

scanScale

bandStrength

grainStrength

haloSpread

edgeTint

etchStrength

shader uniform を追加

uScanScale

uBandStrength

uGrainStrength

uHaloSpread

uEdgeTint

uEtchStrength

2. shell 系で差を強めた mode

特に次を強化した。



mirror_skin

横方向の伸びと反射的な flattening

scan/band の強化

shell_script

etch / band / scriptWarp を追加

manuscript 的な刻線を強化

eclipse_halo

Y 圧縮 + equator ring lift

halo rim を強化

resin_shell

sag / smooth bias を強化

matte ではなく滑らかな coating 方向へ寄せた

calcified_skin

quantize と wire exposure を強化

residue_skin

droop + residue grain を強化

membrane_pollen

porous / spike 系差を追加

spore_halo

halo と grain を増やして clean halo と差別化

3. fog 系 renderer の専用 shaping 強化

components/sceneVolumeFogSystem.tsx



mode ごとの FogProfile を導入

既存の長い ternary を profile ベースに整理

追加した差分軸

sliceMul

opacityMul / opacityAdd

densityMul

scaleMul

driftMul / driftAdd

glowMul / glowAdd

anisotropyAdd

planeScaleMul

depthMul

streak

grain

swirl

verticalBias

coreTightness

pulseNoise

ember

blending

shader uniform を追加

uStreak

uGrain

uSwirl

uVerticalBias

uCoreTightness

uPulseNoise

uEmber

4. fog 系で差を強めた mode

特に次を強化した。



ion_rain

強い streak

downward bias

高 anisotropy

velvet_ash

dense / matte / tight core

additive ではなく normal blending 寄り

static_smoke

grain と pulseNoise を最大級に設定

organic smoke との差を強化

ember_drift

ember color contribution

upward drift

charge_veil

electric streak / glow / anisotropy を強化

mirage_smoke

swirl と scale bloom を強化

soot_veil

matte soot 的な normal blending と grain を追加

ashfall

downward particulate bias を強化

vapor_canopy

upper canopy bias を追加

5. depictionArchitecture の拡張

lib/depictionArchitecture.ts



分類辞書に留まっていたものを、より「描写台帳」寄りに拡張した。



追加フィールド:



spatialSignature

shapingFocus

bestSources

contrastAxis

6. control panel で depictionArchitecture を可視化

components/controlPanelProceduralModeSettings.tsx



表示追加:



Spatial signature

Contrast axis

Best sources

Shaping focus

7. starter preset の見本密度補強

lib/starterLibrary.ts



追加した preset:



starter-contour-plate-echo

starter-ember-drift-manuscript

starter-ion-rain-video

starter-mesh-weave-cylinder

starter-ribbon-veil-ring

starter-stipple-relief-sigil

starter-resin-eclipse-shell



追加した sequence:



starter-sequence-contour-plate-echo

starter-sequence-ember-drift-manuscript

starter-sequence-ion-rain-video

starter-sequence-mesh-weave-cylinder

starter-sequence-ribbon-veil-ring

starter-sequence-stipple-relief-sigil

starter-sequence-resin-eclipse-shell

カバレッジ結果

starter preset 内の 0 本 mode を埋めた。



contour_echo: 0 → 1

ember_drift: 0 → 1

ion_rain: 0 → 1

mesh_weave: 0 → 1

ribbon_veil: 0 → 1

stipple_field: 0 → 1



強化対象の shell / fog mode も見本密度を上げた。



shell_script: 3 → 4

eclipse_halo: 3 → 4

resin_shell: 1 → 2

検証

npm run typecheck 通過

npm run build 通過



build output:



dist/assets/index-xIMhETtM.js 831.90 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-D8kYrmIt.js 111.54 kB

次の優先候補

次は次の順が妥当。



sceneCrystalAggregateSystem.tsx の fracture / bloom 差の最終詰め

sceneVoxelLatticeSystem.tsx の lattice family 差の最終詰め

sceneFiberFieldSystem.tsx の weave / thread / glyph 差の最終詰め

atlas / hybrid / temporal variant の未接続 mode を補完
