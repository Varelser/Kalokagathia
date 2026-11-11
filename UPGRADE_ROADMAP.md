Rendering Upgrade Roadmap

Goal

Expand the app from a particle renderer into a broader rendering system without forcing every visual through one pipeline.

Phase 1 — Safe exposure and extension

Status: implemented in this pass.



Expose existing hidden 3D geometry controls for L2/L3.

Add a new geometry class: icosa.

Keep WebGL and the current data flow intact.

Phase 2 — Rendering mode registry

Status: implemented in this pass.



Add a registry describing each render class by category:

particles

lines

ribbons

tubes

metaballs

volumetric

instanced solids

Track support level:

stable

experimental

heavy

Use this registry to drive UI and future preset grouping.

Phase 3 — New render classes with high visual delta

Status: completed in this pass.



Priority order:



image/video driven particles

spline brush / filament lines

sheet / membrane surfaces

true reaction-diffusion mode

text / glyph driven instancing

Phase 4 — Capability-aware routing

Status: completed in this pass.



Separate render class from simulation class.

Introduce capability flags for:

WebGL stable

WebGPU preferred

export only

mobile risky

Phase 5 — Project serialization redesign

Status: completed in this pass (with optional browser-captured real-export follow-through left open).



Save mode id + source/simulation/primitive/shading/postfx blocks.

Add schema versioning and migration.

Normalize sparse / partial serialization blocks against current routing-aware fallbacks during import.

Add dedicated Phase 5 verification for sparse block recovery, legacy migration rebuilds, parse→round-trip stability, temp-file export/import round-trip, duplicate-ID repair, import diagnostics reporting, import ID remap preparation, post-remap manifest / serialization rebuild integrity, and minimal-change sequence-ID preservation.

Immediate next implementation target

Phase 5 is now treated as complete for core project serialization redesign. The repository has schema versioning + migration, sparse serialization normalization, dedicated verify:phase5 coverage, committed fixture files under fixtures/project-state/, shared export/import helpers, temp-file export/import round-trip checks, duplicate-ID / orphan repair diagnostics, post-remap manifest / serialization rebuild integrity checks, real-export fixture intake, manifest drift tracking, fingerprint drift tracking, and replace-vs-merge import semantics. Browser-captured real-export fixtures remain an optional follow-through path, not a blocker for Phase 5 completion, and can be added later under fixtures/project-state/real-export/ without changing the completion state.



Phase 3b: Brush / Filament connection lines implemented.



Phase 3c: video-driven particles / media luminance sampling — strengthened in this pass (luminance now drives layout + depth + particle size / alpha).



Phase 3e: sheet / membrane surface — implemented.



Phase 3d: true reaction-diffusion mode — strengthened in this pass (mode-specific diffusion/reaction coefficients plus relief / ridge / pit / wetness rendering for reaction_diffusion, cellular_front, corrosion_front, and biofilm_skin).



Phase 3f: text / glyph driven instancing — strengthened in this pass (text luminance now drives instanced solid scale banding, rotation, and depth layering when 3D solids are enabled).



Phase 3d: reaction-diffusion topology routing — strengthened in this pass (biofilm uses a swollen sphere shell, cellular front uses an open cylinder front, corrosion front uses a torus etch ring, and remaining reaction sources now choose plane/disc/ring/torus/cone/cube/sphere topologies through the dedicated render path).



Phase 3d / 3f follow-through: preset / quick preset / procedural grouping sync — strengthened in this pass (reaction-diffusion variants now surface through procedural mode grouping, biofilm / cellular quick presets, reaction-family controls, and guide-aware reset sources).



Phase 3 finish-through: starter / sequence / atlas exposure — completed in this pass (reaction-diffusion and biofilm variants now have dedicated starter presets, sequence steps, and expression atlas anchors, so the new render classes are exposed through baseline browsing surfaces as well as the procedural panel).



Phase 4 continuation: scene render branch plan introduced for Layer 2 / 3 and GPGPU outputs, and runtime scene selection / GPGPU output rendering / render mode summary now consume the same plan vocabulary.



Phase 4 progress: scene branch vocabulary is now carried into manifest execution snapshots, and subsystem mode lookups are being centralized via routing helpers rather than direct config.layerXType reads.



Phase 4 continuation: a shared LayerRuntimeConfigSnapshot now sits alongside scene branch plans, and hybrid / shell / volumetric subsystems have started consuming routing-owned mode/source/material/color/radiusScale helpers instead of re-reading raw config.layerX* fields in place.



Phase 4 progress: routing helpers now provide runtime snapshots for temporal state and multiple procedural surface families (deposition / patch / growth / fog), moving more subsystem configuration reads behind a shared execution vocabulary.



Phase 4 continuation: runtime source-layout snapshots now cover crystal aggregate, crystal deposition, voxel lattice, erosion trail, and brush surface families, so more subsystem density / opacity / source-layout reads now flow through shared routing helpers.



Phase 4 continuation: the central scene routing helper has now been split into Types / Runtime / Plans, and shell / glyph / fiber / line families have started reading runtime state through routing-owned snapshots instead of local config.layerX* branching.



Phase 4 continuation: particle-core runtime state (sceneParticleSystem* / particleData) now consumes routing-owned particle field / visual / SDF / ghost-trail snapshots, removing another concentrated band of raw config.layerX* reads from the render/runtime path.



Phase 4 continuation: execution snapshots now carry scene branches directly from projectExecutionRouting, and serialization blocks use the same routing map so project export preserves a richer execution digest (requested/resolved/path/render/simulation/override/procedural/hybrid/branch/note tokens) under serialization schema v2.



Phase 4 hardening: project export/import verification now has a Node-only route (verify:project-state) that checks routing-map ↔ manifest ↔ serialization consistency, round-trip parse retention, and legacy migration rebuilds without requiring Playwright browsers.



Phase 4 hardening: project-state helpers were decoupled from starter-library initialization, and execution snapshot scene-branch derivation was adjusted to avoid route self-recursion during verification/bundling.



Phase 5 drift report: npm run generate:phase5-drift-report



Phase 5 now checks project fingerprint stability across parse/serialize/parse round-trips, not only counts.



Phase 5 追補: docs/archive/phase5-import-report.json を追加し、replace / merge 両モードでの exact preset / sequence ID change、duplicate source ID の可視化、orphan drop を fixture ごとに固定した。



Phase 5 追補: docs/archive/phase5-import-report.json に compare / aggregate summary を追加し、retain / remap / drop / payload-preserve の比較を強化した。



Phase 5 追補: docs/archive/phase5-real-export-readiness-report.json を追加し、optional real-export fixture の failure reason を細分化した。report は statusCounts と entry ごとの drift field 詳細も保持する。



Phase 5 execution readiness: npm run generate:phase5-execution-readiness-report writes docs/archive/phase5-execution-readiness-report.json, separating repo-level readiness (lockfile sync) from environment blockers (node_modules, real-export fixture presence).



Phase 5 evidence index: npm run generate:phase5-evidence-index writes docs/archive/phase5-evidence-index.json, centralizing completion criteria, import/drift coverage, readiness blockers, and remaining closure steps in one file.



Phase 5 closeout checklist: npm run generate:phase5-closeout-checklist writes docs/archive/phase5-closeout-checklist.json, separating repo-complete, execution-ready, real-export-committed, and execution-proven closure states.

Phase 5 proof intake

docs/archive/phase5-proof-intake.json tracks whether the four execution-proof logs (npm-ci.log, verify-project-state.log, verify-phase5.log, build.log) have been captured under docs/archive/phase5-proof-input/.

This keeps execution-proven closeout separate from repo-level completion and makes the remaining closeout work mechanically checkable.

Phase 5 auto-closeout: `npm run generate:phase5-auto-closeout

generate:phase5-refresh-closeoutwritesdocs/archive/phase5-auto-closeout.json`, automatically promoting status from repo-ready to execution-ready to execution-proven once proof logs verify successfully and a real export fixture is present.



Phase 5 operator handoff: run npm run generate:phase5-operator-handoff after proof logs or browser real-export fixtures are added.



Phase 5 final closure can also be read from docs/archive/phase5-final-closeout.json, regenerated with npm run generate:phase5-final-closeout.

Addendum (2026-11-08): Phases 1–5 above are complete, including the Phase 5 closeout machinery. Work after Phase 5 is NOT tracked in this document: the library upgrade (React 19 / three 0.187 / Vite 8), the Play-tab expression roadmap (Phases 6–9: discovery, control, data/input, output), and the 2026-11-08 feature run (modulation engine, GPU feedback, deterministic video render, node graph view, coverage completion, command palette, and more) are recorded in UPDATE_LOG.md, which is the canonical log from 2026-11-07 onward. Current state summary lives in CURRENT_STATUS.md (2026-11-08 addendum). Still gated: full WebGPU migration, pending performance measurements on the user's Intel iMac.
