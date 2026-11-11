IMPLEMENTATION PLAN AND PROGRESS — shaping25

Summary

Added cross-family review shaping on top of source-aware shaping.

Applied mode+source contrast passes to line / fiber / shell / fog / deposition.

Added review anchors to atlas bundles / hybrid recipes / temporal variants / starter presets for fixed-source comparison.

Verified with npm run typecheck and npm run build.

What was strengthened

Cross-family contrast layer

A new contrast pass was added in lib/sourceAwareShaping.ts so profiles are no longer only adjusted by source. They are also adjusted by specific collision-prone mode pairs.



Key contrast targets:



text: shell_script, ink_bleed, drift_glyph_dust, glyph_weave, rune_smoke

grid: calcified_skin, static_smoke, static_lace, mesh_weave, deposition_field, stipple_field

ring: eclipse_halo, spectral_mesh, signal_braid, dust_plume, mirage_smoke

plane: soot_veil, ink_bleed, velvet_ash, resin_shell

Renderer wiring

The new contrast layer is now composed into:



sceneLineSystem.tsx

sceneFiberFieldSystem.tsx

sceneSurfaceShellSystem.tsx

sceneVolumeFogSystem.tsx

sceneDepositionFieldSystem.tsx

Review anchors added

Added fixed-source review entries so similar families can be compared directly.



Atlas bundles:



review-text-shell-ink-anchor

review-grid-calcified-static-anchor

review-ring-eclipse-spectral-anchor

review-plane-soot-ink-anchor



Hybrid recipes:



review-text-inscription-split

review-grid-architectonic-split

review-ring-orbit-split

review-plane-ledger-split



Temporal variants:



review-text-inscription-split-trace

review-grid-architectonic-split-hold

review-ring-orbit-split-breathe

review-plane-ledger-split-settle



Starter presets:



starter-review-text-inscription-split

starter-review-grid-architectonic-split

starter-review-ring-orbit-split

starter-review-plane-ledger-split

Validation

npm ci ✅

npm run typecheck ✅

npm run build ✅



Build output:



dist/assets/index-CyPlFhJB.js — 962.19 kB

dist/assets/particleDataWorker-Crb-vYCI.js — 136.61 kB

dist/assets/index-CiiugB3f.css — 52.80 kB

Starter direct type count

shell_script: 14

ink_bleed: 15

calcified_skin: 5

static_smoke: 6

eclipse_halo: 13

spectral_mesh: 8

soot_veil: 9

velvet_ash: 4

Updated files

lib/sourceAwareShaping.ts — 832 lines / 22.4 KB

components/sceneLineSystem.tsx — 522 lines / 28.9 KB

components/sceneFiberFieldSystem.tsx — 402 lines / 19.5 KB

components/sceneSurfaceShellSystem.tsx — 428 lines / 22.5 KB

components/sceneVolumeFogSystem.tsx — 401 lines / 22.3 KB

components/sceneDepositionFieldSystem.tsx — 376 lines / 17.3 KB

lib/expressionAtlasBundles.ts — 555 lines / 29.8 KB

lib/hybridExpressions.ts — 466 lines / 19.5 KB

lib/hybridTemporalVariants.ts — 564 lines / 18.2 KB

lib/starterLibrary.ts — 4826 lines / 173.3 KB

Next useful step

Run the new review presets side by side and tighten the remaining collisions inside the same source bucket, especially text and grid.
