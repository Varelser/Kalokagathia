IMPLEMENTATION_PLAN_AND_PROGRESS_shaping24

Summary

This step expands source-aware shaping beyond line/fiber into:



SurfaceShellSystem

VolumeFogSystem

DepositionFieldSystem



The goal is to keep family differences legible even when the source is fixed to text / grid / ring / plane / cylinder / image / video / sphere.

What changed

1. Shared source-aware registry expanded

Updated:



lib/sourceAwareShaping.ts



Added:



withSourceAwareShellProfile()

withSourceAwareFogProfile()

withSourceAwareDepositionProfile()



This now provides source correction for:



line

fiber

shell

fog

deposition

2. Shell source-aware shaping

Updated:



components/sceneSurfaceShellSystem.tsx



Applied source-sensitive corrections to:



scale compression / expansion

ring bias

script warp

halo spread / sharpness

etch / band / grain emphasis

lacquer / flow behavior

blend mode choice



Practical effects:



text keeps inscription-like shell differences from collapsing into generic hulls

grid keeps architectonic / quantized shell behavior visible

ring strengthens halo / equator / orbital shell behavior

plane reads flatter and more plate-like

3. Fog source-aware shaping

Updated:



components/sceneVolumeFogSystem.tsx



Applied source-sensitive corrections to:



density / scale / depth

streak / grain / swirl

rune / ledger / soot / velvet contributions

core tightness / edge fade

blend mode choice



Practical effects:



text keeps rune/ledger fog differences visible

grid keeps slab/static fog from becoming generic haze

ring holds orbit-like fog bias better

plane stays more manuscript / ledger / soot-like

4. Deposition source-aware shaping

Updated:



components/sceneDepositionFieldSystem.tsx



Applied source-sensitive corrections to:



glyph grid

contour mix

band warp

soot / rune / velvet / vapor retention

plane flattening / ring rotation bias

blend mode choice



Practical effects:



text increases inscription retention

grid increases structural banding and quantized relief

ring increases contour/rim behavior

plane reinforces ledger/surface absorption

5. Comparison anchors added

Updated:



lib/expressionAtlasBundles.ts



Added source-fixed anchors:



source-text-shell-deposition-anchor

source-grid-shell-fog-anchor

source-ring-halo-fog-anchor

source-plane-fog-deposition-anchor



These are intended as comparison baselines rather than purely expressive bundles.

6. Hybrid and temporal comparison entries added

Updated:



lib/hybridExpressions.ts

lib/hybridTemporalVariants.ts



Added:



source-text-inscribed-body

source-grid-architectonic-shell

source-ring-orbit-shell-fog

source-plane-ledger-fog



Temporal variants:



source-text-inscribed-body-trace

source-grid-architectonic-shell-hold

source-ring-orbit-shell-fog-breathe

source-plane-ledger-fog-settle

7. Starter comparison presets added

Updated:



lib/starterLibrary.ts



Added presets:



starter-source-text-shell-deposition-contrast

starter-source-grid-shell-fog-contrast

starter-source-ring-halo-fog-contrast

starter-source-plane-fog-deposition-contrast



Added sequences for each preset as well.

Validation

Commands executed:



npm ci

npm run typecheck

npm run build



Result:



typecheck passed

production build passed



Build outputs:



dist/assets/index-C8C2z7Rl.js — 949.53 kB

dist/assets/particleDataWorker-CTcCR13N.js — 134.40 kB

dist/assets/index-CiiugB3f.css — 52.80 kB

File sizes

lib/sourceAwareShaping.ts — 525 lines / 13.6 KB

components/sceneSurfaceShellSystem.tsx — 429 lines / 22.4 KB

components/sceneVolumeFogSystem.tsx — 402 lines / 22.3 KB

components/sceneDepositionFieldSystem.tsx — 377 lines / 17.2 KB

lib/expressionAtlasBundles.ts — 507 lines / 26.7 KB

lib/hybridExpressions.ts — 431 lines / 17.9 KB

lib/hybridTemporalVariants.ts — 529 lines / 16.9 KB

lib/starterLibrary.ts — 4730 lines / 168.9 KB

Starter direct type counts after this step

shell_script: 13

ink_bleed: 13

calcified_skin: 4

static_smoke: 5

eclipse_halo: 12

dust_plume: 5

soot_veil: 8

Next best move

The next natural step is cross-family source-locked review:



lock source to text

lock source to grid

lock source to ring

compare shell / fog / deposition / fiber / line families under each lock

trim overlaps where two families still read too similarly



That step is less about adding features and more about final perceptual separation.
