Kalokagathia

Kalokagathia is a local Vite + React + Three.js particle generator focused on monochrome motion graphics.



It supports a split workflow:



Private workspace mode: your own editable presets and library live in browser localStorage

Optional public exhibition mode: a bundled read-only library is loaded from public-library.json



It supports:



Multi-layer particle systems

Per-source particle counts and motion parameters

Nearby connection lines / plexus rendering

Audio-reactive motion using microphone input or shared tab/system audio

A standalone synth companion window that drives the visuals from a separate browser window without relying on screen-share capture

Global look controls for softness, glow halo, and depth fog

Camera control modes for auto, hybrid, or fully manual orbit behavior

Viewport render-quality profiles for draft, balanced, or cinematic editing

Motion search in the layer editor plus quick performance presets for heavy scenes

Screen-space FX including scanlines, grain, vignette, radial pulse, contact flash, interference bands, persistence ghosts, signal split, sweep glow, and sequence-driven modulation during preset playback with per-step drive scaling, enable overrides, and absolute strength overrides

Approximate inter-layer collision fields with layer-volume or per-source modes, optional audio-linked repulsion, and contact-driven glow/screen FX

High-resolution PNG export with optional transparent background

Browser-side WebM video export for the current scene or one full sequence pass

ZIP export of PNG frame sequences for the current scene or one full sequence pass

Local preset management for saving and reloading scene configurations

Preset browsing with search, derived category chips, and lightweight/heavy complexity badges

Preset sequence playback with per-step hold time, transition curve, keyframes, and looping

Starter preset packs for fluid, chaos, orbital, lattice, broadcast, noir, toroidal, symmetry, nebula, and monolith-focused looks when no private library has been saved yet



Motion coverage includes:



Noise and fluid-field families such as flow, curl, smoke, liquid, noise, ridged_mf

Attractor and chaos families such as lorenz, aizawa, rossler, thomas, euler

Orbital and geometric families such as orbit, spiral_motion, helix, phyllotaxis, rose_curve, lissajous, toroidal, pendulum, lattice, epicycle, gyre, crystal, ripple_ring, fold, kaleidoscope, braid, arc_wave, web, pulse_shell, mandala, ribbon, shear, spokes, breathing, torus_knot, clifford, hopalong, cellular, cyclone, petals, sheet, flare, moebius, harmonic, starburst, grid_wave, helio, zigzag, shockwave, filament, mirror_fold, radial_steps, coil, labyrinth, gyro, echo_ring, braidshell, crosscurrent, prism, tessellate, pulse_grid, tidal, beacon, caustic, pinwheel, nebula, fronds, gyroflower, monolith, runes, fanout, eddy, nova

Requirements

Node.js 18+

Canonical Project Docs

CURRENT_STATUS.md: current canonical project state

DOCS_INDEX.md: document routing and archive rules

REVIEW.md: current code review aligned to the actual source tree

REFACTOR_PLAN_LARGE_FILES.md: concrete split plan for oversized files



Historical phase notes and older progress logs were moved to docs/archive/root-history/.

Development

Install dependencies: npm install

Start the development server: npm run dev

Open the local URL shown by Vite

Project Layout

App.tsx: top-level orchestration and controller wiring

components: control panel UI, scene primitives, shader chunks, and scene wrappers

lib: state normalization, preset/library IO, audio/export/sequence controllers, and helper hooks

types: split domain type definitions with types.ts as the public barrel

scripts: public-library sync and verification scripts



Key scene files:



components/sceneParticleSystem.tsx: particle instancing and uniforms

components/sceneLineSystem.tsx: nearby connection line rendering

components/scenePhysicsLogic.ts: assembled GLSL physics chunk

components/sceneShaderParticlePoint.ts: particle point shaders

components/sceneShaderParticleLine.ts: line shaders



Key app/controller files:



lib/usePresetLibrary.ts: preset CRUD and dirty-state tracking

lib/useSequenceController.ts: sequence orchestration

lib/useAudioController.ts: microphone/shared-audio/internal-synth control

lib/useExportController.ts: WebM and frame export orchestration

macOS One-Click Launch

Double-click launch-kalokagathia.command

The launcher checks dependencies, starts Vite, and opens the correct browser URL automatically

Keep the terminal window open while the app is running

Production Build

Build the app: npm run build

Preview the build locally: npm run preview

GitHub Pages Deployment

This project can be published to GitHub Pages at a fixed file URL such as:



https://varelserjp-code.github.io/hp/kalokagathia.html



Recommended flow:



Create or use the repository varelserjp-code.github.io.

Push this project to the main branch of that repository.

In GitHub, open Settings -> Pages and set the source to GitHub Actions.

The included workflow will run on every push to main.



Build details:



npm run build:github-pages builds the full-featured Pages version.

npm run build:github-pages-public builds the read-only exhibition version with VITE_LIBRARY_SCOPE=public.

It then copies dist/index.html to dist/hp/kalokagathia.html.

The final published URL becomes https://varelserjp-code.github.io/hp/kalokagathia.html.



If you want to test the same output locally:



Run npm run build:github-pages

Open dist/hp/kalokagathia.html with a local static server, or deploy the generated dist folder to Pages.

Netlify Deployment

This app can be deployed to Netlify as a static Vite site.



Build command: npm run build

Publish directory: dist

Node version: 20



The repository includes netlify.toml, so Netlify should detect the correct settings automatically.



If you want Netlify to behave like the read-only exhibition build, set VITE_LIBRARY_SCOPE=public. Otherwise it will run in the default full-featured mode.



Recommended flow:



Push this project to GitHub.

Create a new site in Netlify and import that repository.

Confirm the build command is npm run build and the publish directory is dist.

Deploy.



Notes for production hosting:



Netlify serves over HTTPS by default, which is required for microphone access in browsers.

Shared tab/system audio capture still depends on browser support and the browser share dialog. Deployment does not remove that limitation.

Browser downloads such as PNG, ZIP, and WebM exports continue to run client-side after deployment.

Private/local authoring data stays in browser localStorage in private mode only.

Public deployment presets are sourced from public-library.json.

Private/Public Split

Recommended workflow:



Work locally in the default private mode.

Start from the bundled starter presets, or keep your own editable presets in browser localStorage.

Export the library JSON from the private build when you want to publish.

Run npm run sync:public-library -- path/to/exported-library.json.

Deploy to Netlify. Use VITE_LIBRARY_SCOPE=public only when you want the read-only exhibition variant.



The sync command normalizes the exported payload and writes it into public-library.json by default. You can pass a second path if you want to generate a different target file.



Example:



npm run sync:public-library -- ./exports/kalokagathia-library-2026-03-07.json



To test the public exhibition build locally, run npm run dev:public and open the Vite URL it prints.



The public build now behaves as an exhibition mode: scene parameters, randomize/reset actions, and sequence editing are locked, while preset loading, morphing, playback, and exports remain available.

Verification Scripts

Core verification flow:



Verify project-state manifest / execution routing / serialization consistency without a browser: npm run verify:project-state

Verify Phase 4 end-to-end checks (build + verify:project-state + verify:export): npm run verify:phase4

Verify Phase 5 import/export hardening, sparse serialization recovery, real fixture-file parity, temp-file export/import round-trip, duplicate-ID repair, and import-ID remap stability: npm run verify:phase5

Regenerate the committed Phase 5 JSON fixtures under fixtures/project-state/ after changing project payload expectations: npm run generate:phase5-fixtures



Browser / media / export checks:



Verify transparent PNG export: npm run verify:export

Verify audio reactivity with a deterministic fake analyzer: npm run verify:audio

Verify inter-layer collision contact, impact FX, and audio-linked repulsion: npm run verify:collision

Verify shared-audio mode with a mocked browser share stream: npm run verify:shared-audio

Verify preset library export/import and sequence persistence: npm run verify:library

Verify the bundled public library is normalized and internally consistent: npm run verify:public-library

Verify the public exhibition UI is locked while playback/export actions remain available: APP_URL=http://127.0.0.1:3000/ npm run verify:public-ui

Verify browser-side WebM export for current and sequence modes: npm run verify:video

Verify PNG frame zip export for current and sequence modes: npm run verify:frames



Notes:



verify:project-state and verify:phase5, generate:phase5-completion-report do not require a browser runtime. They are the first checks to run after project-serialization changes.

verify:phase5 now reads the committed fixture files in fixtures/project-state/, fails if they drift from the current expected payloads, writes temp exported JSON files to exercise disk round-trip plus preset/sequence ID remap preparation, and also checks duplicate-ID repair, orphan-sequence dropping, precise import-inspection errors, and import diagnostics reporting.

prepareImportedProjectData() now supports explicit import modes: replace for full workspace replacement and merge for collision-aware intake. The UI import path uses replace, so stable preset/sequence IDs are preserved instead of being remapped against the outgoing workspace.

fixtures/project-state/real-export/ is reserved for browser UI export captures. When .json files are present there, verify:phase5 inspects them, enforces the export file-name pattern, and checks serialize→parse stability without requiring the browser path in this environment.

npm run generate:phase5-real-export-manifest rebuilds fixtures/project-state/real-export/manifest.json, storing a SHA-256 hash and summary counts for each committed browser export so verify:phase5 can detect stale or drifted captures.

verify:export still prefers the real app UI path first. If Chromium navigation is policy-blocked in the current sandbox, it falls back to the node canvas harness and keeps the PNG alpha assertions alive.

Browser-driven scripts expect the app to be running locally. If your dev server is not on the default URL, set APP_URL.



Examples:



npm run verify:phase5



APP_URL=http://127.0.0.1:3000/ npm run verify:export

Notes

Microphone input requires browser permission when using real audio input.

Transparent export is available from the control panel via Transparent BG.

Video export is available from the Main tab and downloads a .webm capture from the browser.

When FX -> Audio Source is set to Shared Tab / System, the browser can analyze the shared synth/app audio directly.

When FX -> Audio Source is set to Internal Synth, WebM export includes that synth audio track.

PNG frame export is available from the Main tab and downloads a .zip archive of numbered frames.

Audio controls are available under the FX tab.

The FX tab can use microphone input, shared tab/system audio, or the optional built-in browser synth.

The FX tab also includes Standalone Synth, which opens a separate synth window and feeds audio analysis back into the main scene.

On macOS, shared-audio capture depends on browser support. Chromium browsers generally work best for tab audio or screen audio with the browser share dialog.

If a shared app window or system surface does not expose an audio track, prefer the Standalone Synth mode instead of relying on screen-share capture.

Microphone and shared-audio capture can be embedded into WebM exports when those inputs are active.

Standalone Synth keeps live playback in its companion window, and WebM export mirrors the synth settings into an internal capture track when that mode is active.

Shared audio mode surfaces connection errors directly in the FX tab and includes a short 4-step YouTube Live workflow.

Presets are managed from the Main tab and are stored in browser localStorage.

The preset browser supports free-text search plus derived categories such as Fluid, Chaos, Orbit, Pulse, Plexus, and Heavy.

The motion selector supports free-text search in addition to category grouping.

Sequence playback is configured from the Main tab, including a clickable and draggable compact timeline view, a live playback position marker, drag reordering, step duplication, per-step easing curves, a live curve preview, and captured keyframes, and is also stored in browser localStorage.

The display tab exposes camera mode and render-quality controls, while layer tabs surface a simple load estimate to help during heavy look development.

The display tab also includes Optimize Edit, Balanced, and Cinematic shortcuts to quickly shift the viewport budget while exploring dense looks.

Extending Motion Types

To add a new particle motion mode, update these four places together:



types/scene.ts Layer2Type

components/sceneMotionMap.ts numeric shader mapping

components/scenePhysicsMotionChunk.ts GLSL behavior in applyMotion

components/controlPanelPartsMotion.tsx UI labels and icons



That path keeps the UI, CPU-side particle data generation, randomizer, and shader behavior aligned.



Phase 5 drift report: npm run generate:phase5-drift-report

Phase 5 now checks project fingerprint stability across parse/serialize/parse round-trips, not only counts.

Phase 5 completion report

npm run generate:phase5-completion-report writes docs/archive/phase5-completion-report.json.



This report marks core Phase 5 completion criteria as done and treats browser-captured real-export fixtures as an optional follow-through rather than a gate. The evidence list now also points at the real-export readiness report.



Phase 5 追補: docs/archive/phase5-import-report.json を追加し、replace / merge 両モードでの exact preset / sequence ID change、duplicate source ID の可視化、orphan drop を fixture ごとに固定した。



npm run generate:phase5-import-report now writes compareSummary and aggregateSummary, so fixture-by-fixture retain/remap/drop counts can be compared without reading the full exact-ID tables.



npm run generate:phase5-real-export-readiness-report writes docs/archive/phase5-real-export-readiness-report.json, classifying optional real-export fixtures by failure reason (invalid-json, invalid-project-payload, manifest-entry-missing, manifest-sha256-drift, manifest-metadata-drift, roundtrip-drift) and recording statusCounts, metadata drift fields, and round-trip drift fields per file.



Phase 5 execution readiness: npm run generate:phase5-execution-readiness-report writes docs/archive/phase5-execution-readiness-report.json, separating repo-level readiness (lockfile sync) from environment blockers (node_modules, real-export fixture presence).



Phase 5 evidence index: npm run generate:phase5-evidence-index writes docs/archive/phase5-evidence-index.json, centralizing completion criteria, import/drift coverage, readiness blockers, and remaining closure steps in one file.



Phase 5 closeout checklist: npm run generate:phase5-closeout-checklist writes docs/archive/phase5-closeout-checklist.json, separating repo-complete, execution-ready, real-export-committed, and execution-proven closure states.

Phase 5 proof intake

docs/archive/phase5-proof-intake.json tracks whether the four execution-proof logs (npm-ci.log, verify-project-state.log, verify-phase5.log, build.log) have been captured under docs/archive/phase5-proof-input/.

This keeps execution-proven closeout separate from repo-level completion and makes the remaining closeout work mechanically checkable.

Phase 5 auto-closeout: npm run generate:phase5-auto-closeout writes docs/archive/phase5-auto-closeout.json, automatically promoting status from repo-ready to execution-ready to execution-proven once proof logs verify successfully and a real export fixture is present.



Phase 5 closeout refresh pipeline: npm run generate:phase5-refresh-closeout



Phase 5 operator handoff: run npm run generate:phase5-operator-handoff after proof logs or browser real-export fixtures are added.



Phase 5 final closure can also be read from docs/archive/phase5-final-closeout.json, regenerated with npm run generate:phase5-final-closeout.
