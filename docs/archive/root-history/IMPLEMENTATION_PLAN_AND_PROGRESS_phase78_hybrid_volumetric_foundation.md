Phase 78 — Hybrid Volumetric Foundation

Goal

Add the first real new execution foundation after routing/foundation setup, without breaking the current procedural families.

Why this first

Volumetric rendering is the highest-leverage next base because it expands:



volume fog beyond slice planes

future SDF / cavity / melt / dissolve paths

later granular-fluid-cloud hybrids



It also fixes a runtime gap from the previous routing stage: volume-fog modes could resolve away from webgl-procedural-surface without a layer-local renderer to take over.

Implemented in this phase

Added VolumetricFieldSystem as a new layer-local hybrid volumetric renderer.

Routed volume-fog family to hybrid-runtime when volumetric runtime is active.

Connected AppScene so hybrid volume layers render through the new system.

Files changed

components/sceneVolumetricFieldSystem.tsx

components/AppScene.tsx

lib/executionFoundation.ts

IMPLEMENTATION_PLAN_AND_PROGRESS_phase78_hybrid_volumetric_foundation.md

Validation

node node_modules/typescript/bin/tsc --noEmit

node node_modules/vite/bin/vite.js build

Notes

This is intentionally narrow:



not yet a full WebGPU compute foundation

not yet a general SDF field runtime

not yet replacing slice fog for every volume mode



It is the first real post-foundation execution path that can be selected by runtime routing.

Next

Add diagnostics surfacing for hybrid volumetric path.

Introduce shared volumetric field uniforms / source resolver.

Choose the next true execution base:

WebGPU compute particle/grid runtime, or

SDF/raymarch field runtime expansion.
