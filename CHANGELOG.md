# Changelog

All notable changes to Kalokagathia / Monosphere are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions
match the GitHub releases of this repository.

## [1.11.0] — 2026-11-16

Horizon background (leftover plan Phase I): the background surface
gains gradient and image modes, closing the weakest remaining △ in
the Maxon coverage audit (Trapcode Horizon). Everything defaults to
the legacy solid background; existing presets render identically.

### Added
- **Background modes** (`backgroundMode`): `solid` (default — the
  legacy `backgroundColor` tone / `backgroundHex` behaviour,
  unchanged), `gradient`, and `image`. The Horizon background
  travels as a texture in `scene.background`, so PostFx applies over
  it and every existing background consumer keeps its semantics:
  deterministic transparent exports and the stream transparent
  variant never show it (their mattes stay clean), UnMult still
  derives alpha from a forced black background, and the stream
  chroma / black overrides win over Horizon.
- **Gradient mode**: two-colour gradient baked from
  `backgroundGradientColorA` / `backgroundGradientColorB`, as a
  linear gradient at `backgroundGradientAngle` (degrees, screen
  space; 0 = left→right, 90 = bottom→top) or a radial gradient
  (centre → edge), selected by `backgroundGradientType`. Five
  monochrome presets (Obsidian Fade, Ash Fall, Paper Fade, Mist
  Radial, Halo Radial) ship in the Display panel; arbitrary colours
  remain available through the two colour pickers.
- **Image mode**: a user image stored in the config as a data URL
  (`backgroundImageSource`, downscaled to ≤1024 px by the UI) is
  shown as the background, baked at the frame's aspect with
  `backgroundImageFit` — `cover` (fill, cropping the overflow) or
  `fit` (whole image, letterboxed over the solid colour). With no
  image set, the solid background shows and the UI states the
  fallback explicitly. 360° panorama mapping is out of scope.
- The CPU fallback view paints the gradient mode as well (image
  mode keeps the solid fade there — that path is display-only).
- Two starter presets: `starter-post-horizon-obsidian-fade`,
  `starter-post-horizon-mist-radial`. Config keys: 918 → 925;
  starter shelf: 485 → 487.

## [1.10.0] — 2026-11-16

Deterministic-export reproducibility (leftover plan Phase G): exports
of the same configuration are now bit-identical across runs, and the
SVG morph parser accepts group transforms.

### Fixed
- **Deterministic exports inherited the camera impulse rig's ambient
  drift.** The rig's z-drift term
  (`sin(t · speed · 0.47) · cameraImpulseDrift · 60`) is not gated by
  the impulse strength, so with the shipped defaults (impulse 0, burst
  boost 0.35, drift 0.2) the camera wandered ±12 units even with every
  burst source at zero; the rig also reads `clock.getElapsedTime()`,
  which THREE.Clock derives from the wall clock, so the render
  manager's clock resets never made the rig's phase deterministic.
  Identical exports therefore rendered from a different camera distance
  every run — the discrepancy the Phase E audit measured on the frozen
  layer-2 subject (mean absolute difference 0.105). The layer-2 layout
  itself was never at fault: it is fully hash-seeded and reproduces
  bit-exactly. While a deterministic job runs, the manager now sets a
  camera determinism lock (the same suppression pattern as the
  position-feedback and time-scale locks) and the rig pins the camera
  to the config's canonical position / target with no impulse, drift
  or fov terms. **Behaviour change, exports only:** deterministic
  renders now always use the canonical framing for the configuration
  (the framing a fresh load shows) instead of the live camera's
  approximate position ± drift. Live behaviour is unchanged. Verified
  on the iMac real GPU: cross-load, same-session, post-GPGPU and
  camera-feature-stress exports are all bit-identical (difference
  0.00000 on every frame).

### Added
- **SVG morph: `<g transform>` support.** The SVG parser
  (`lib/svgMorph.ts`) now maintains a group transform stack while
  scanning, composing nested group transforms with per-element
  transforms, so imported logos that wrap artwork in transformed
  groups form at the intended position, scale and orientation.
  Documents without `<g>` produce bit-identical point clouds to
  before (unit tests), and a group-transformed shape renders
  identically to the same shape with the transform baked into its
  coordinates (iMac real-GPU check, difference ≤ 0.00001).

### Verified
- **LightFX long renders** (Phase D leftover): 660-frame deterministic
  renders with Shine + Starglow (diagonal) + Lux (with cone) all on
  complete cleanly in opaque (16 s) and UnMult (31 s) modes; UnMult
  corners are alpha 0 and the Lux disc measures 0.52 centre luminance.
- **Pointer paint** (B3 leftover): with `gpgpuMouseMode: 'paint'` at
  the default rate, brushing a circle on the iMac real GPU raised the
  swept annulus's lit ratio from 0.179 to 0.303 (+69%) and its mean
  luminance 2.0×, persisting at least 3 s; the mouse-disabled control
  run stayed flat. No fix was needed.

## [1.9.1] — 2026-11-16

Internal refactoring only — **no behavior changes**. The Play tab's
5,482-line `controlPanelPlayTab.tsx` (258 KB) was split verbatim into
responsibility-based sibling modules (shared / shelf / generation /
tools / I/O / stage / graph / render); every moved line is
byte-identical to v1.9.0, verified by a full line-multiset audit and
an iMac real-GPU deterministic-render comparison against the v1.9.0
bundle (max per-frame mean absolute difference 0.002, raster noise;
render manifests identical).

### Changed
- Split `components/controlPanelPlayTab.tsx` into
  `controlPanelPlayTab{Shared,Shelf,Generation,Tools,Io,Stage,Graph,Render}.tsx`;
  the original file now only hosts the tab composition (`PlayTabContent`,
  `DeferredMount`) and re-exports `PresetShelf` for existing importers.
  No UI text, behavior, or export output changes.

## [1.9.0] — 2026-11-16

LightFX (improvement plan Phase D): the Trapcode Shine / Starglow /
Lux family arrives as a single new post stage, closing the largest
remaining gap in the Maxon coverage audit. Everything defaults OFF;
with all sub-effects off the stage is not inserted and the output is
identical to before.

### Added
- **Shine** — screen-space light rays: highlights above a threshold
  are accumulated along the ray from the shared light position
  through each pixel, smearing bright objects into rays that emanate
  from the source (`postShineEnabled / Intensity / Length /
  Threshold`, light position via `postLightX / postLightY`).
- **Starglow** — star glints on highlights: the bright-pass is
  streak-blurred horizontally and vertically, with an optional
  diagonal pair for 8-point stars (`postStarglowEnabled / Intensity
  / Length / Threshold / Diagonal`).
- **Lux** — the light source made visible: a neutral-white glow disc
  with a hot core at the light position, plus an optional
  screen-space cone (`postLuxEnabled / Intensity / Size /
  ConeLength / ConeAngle / ConeSpread`). The source position is the
  manual UV position, deliberately not a projection of the GPGPU
  well positions — the simulation time base is not visible to the
  post chain, so a projected position could drift in deterministic
  renders.
- The stage sits immediately after Bloom in every stack profile and
  before the output grade, so deterministic renders (opaque and
  UnMult) and the brand single-colour mode apply to the finished
  light. Streaks and glints are extracted from the frame itself, so
  the monochrome discipline holds — colour only ever comes from the
  existing gradient / brand paths.
- Three starter presets: `starter-post-lightfx-shine-logo`,
  `starter-post-lightfx-starglow-field`, `starter-post-lightfx-lux-spot`.

## [1.8.0] — 2026-11-16

Pro-1 completion (improvement plan Phase C): the deterministic
renderer gains delivery resolution presets and a measured loop seam,
and the UnMult path is verified at long-render scale.

### Added
- **Resolution presets for deterministic renders** — alongside the
  legacy "current canvas size", the Play tab now offers 1920×1080
  (16:9), 3840×2160 (4K), 1080×1920 (9:16) and 1080×1080 (1:1). The
  renderer is resized with the pixel ratio pinned to 1 for the
  duration of the job (the canvas's on-screen CSS size is unchanged)
  and restored afterwards; the size actually captured and the preset
  label are recorded in every render.json.
- **Loop seam measurement** — with the loop option on, the renderer
  steps one probe frame at exactly one period after frame 0 and
  records the pixel difference in render.json and in the UI: drift
  (probe vs frame 0) and jump (last frame vs frame 0). This is a
  measurement, not a guarantee — time-driven content whose period
  divides the loop length measures ~0 drift, while stateful
  simulations accumulate and report their real seam.

### Verified
- **UnMult long render** — a 660-frame UnMult export with the brand
  single-colour mode enabled was completed end to end on a real GPU
  (600 + 60 ZIP parts, manifest backgroundMode / unmult fields,
  memory behaviour and duration recorded in the Phase C gate report).

## [1.7.1] — 2026-11-16

Correctness fixes from the v1.7.0 audit (improvement plan Phase A):
features that could be selected but did nothing now work, and the
public copy can no longer drift from the real preset count.

### Added
- **Image gradient driver** — the Kinetix Color gradient's `image`
  driver (id 4, reserved in B2) is implemented: pick an image in the
  GPGPU panel and each particle takes the colour of the image at its
  own position (world XY mapped over the bounce sphere), mirroring
  Kinetix's image colour mode. The image is downscaled to ≤256px and
  stored in the config as a data URL (`gpgpuGradImageSource`), so it
  persists with presets and projects like the SVG morph source.
  While no image is set the driver still falls back to the life
  gradient, but the panel now says so explicitly — the silent
  fallback flagged in the audit is gone.

### Changed
- **Preset counts in the page metadata are injected at build time**
  from `public/generated-collection.json` (the `__PRESET_COUNT__`
  token in index.html), replacing the hand-written "750" that had
  gone stale in the description / og:description. If the index
  cannot be read, the count phrase is dropped rather than left
  wrong.

### Fixed
- **starter-kinetix-metallic-crystals no longer blows out to
  white.** The geometry material is additive and double-sided, so
  the B4-converted values (bright default colour, opacity 0.88,
  env-reflect 0.55) stacked faces past clipping — 47% of lit pixels
  measured near-white — and morph jitter 0.35 scattered the cubes
  off the torus-knot tube into a filled ball. The preset now uses a
  darker steel colour, lower opacity, smaller cubes, tighter jitter
  (0.15) and gentler bloom / chromatic aberration, so individual
  crystals and the knot structure read clearly (0% blown pixels).

## [1.7.0] — 2026-11-16

Transparent delivery with full post-processing (Pro-1.1), and
logo/brand work for client delivery (Pro-2): SVG morph targets and
a single-colour brand mode.

### Added
- **Pro-1.1 UnMult transparent delivery** — the deterministic
  renderer gains a third background mode: alongside opaque and the
  legacy transparent matte, "transparent + PostFx (UnMult)" renders
  on black with the full PostFx stack, then derives alpha from
  luminance (alpha = max(r,g,b) through a smoothstep threshold
  curve, fixed at 0.05–0.30) at the capture step only, so glow and
  bloom survive into transparent PNG sequences. On a real GPU the
  exported light energy measured 5.1× the legacy transparent path.
  The mode is recorded in each part's `render.json` manifest
  (`backgroundMode` / `unmult` / `unmultSmoothstep`). Video formats
  cannot carry alpha, so transparent modes and video are mutually
  exclusive in the UI rather than silently falling back to black.
- **SVG morph target (Pro-2)** — a dependency-free SVG parser
  (`lib/svgMorph.ts`) samples an imported logo (file upload or
  pasted text; path commands M/L/H/V/C/S/Q/T/A/Z plus basic
  shapes and element transforms) into an 8,192-point cloud by arc
  length and feeds it to the existing morph bake as the new `svg`
  target, so particles form the logo itself. The SVG source is
  stored in the config (`gpgpuMorphSvgSource`) and travels with
  presets. Ships with a bundled star sample and the starter preset
  `starter-gpgpu-morph-svg-logo`.
- **Brand single-colour mode (Pro-2)** — an opt-in duotone in the
  output-grade stage maps luminance through a black → brand colour
  → white ramp (midpoint at the brand colour's own luminance), for
  one-client-colour delivery over the monochrome base. Default
  `#c8372d`; when off, the stage is not inserted and output is
  identical to before. Applies to the live view and to
  deterministic renders, including UnMult exports.

## [1.6.0] — 2026-11-16

Pro delivery rendering, a CPU fallback for weak machines, and the
Kinetix integration (morph targets, colour gradients, event-driven
Aux emission).

### Added
- **Pro-1 delivery renderer** — the deterministic renderer's cap rose
  from 240 to 3,600 frames (1–30 s, 12/24/30/60 fps); ZIP sequence
  export now streams in 600-frame parts with continuous frame
  numbering across parts, video export is capped explicitly at 1,800
  frames, and a warmup period (default 30 frames, stepped but not
  captured) suppresses the ignition transient. Each part's
  `render.json` manifest now records the app version, the actual
  resolution, warmup frames, part numbering and the determinism
  boundary.
- **CPU fallback mode** — for machines where WebGL is unavailable or
  software-rendered: a Canvas 2D renderer (up to 4,000 particles)
  that reuses the deterministic CPU layouts and ports the attractor
  ODEs, so a preset still reads as itself. Activates automatically
  when a software renderer is detected, or manually from the Play
  tab's GPU diagnostics; the WebGL canvas is not mounted while it is
  active.
- **Morph targets (Kinetix integration B1)** — a GPGPU attraction
  force that pulls particles onto a target point cloud baked into a
  float texture: 16 shapes (trefoil, torus knot, gyroid, klein,
  hypercube, cymatic and more, plus text / image targets reusing the
  existing media maps). Field symmetry sampling
  (mirrorX / radial4 / radial6 / octahedral), seven new sprite
  shapes, torus / cone geometry particles with an environment
  reflection option, bell size curve, geometry spin and stretch.
- **Colour gradients (B2, opt-in)** — a unified 3-point gradient
  (start / mid / end) sampled through a 256 px LUT, with six drivers
  (life / velocity / spatial / prism / image / blackbody) and
  Kinetix's ten gradient presets carried over value-for-value. The
  default look stays monochrome; colour is enabled explicitly.
  Also: arbitrary background colour with five stage presets, a
  radial-blur post pass, and an exposure + ACES output grade
  (defaults reproduce the previous output exactly).
- **Event-driven Aux emission (B3)** — a GPU Aux pool that emits on
  particle death (deathBurst), on bounce (bounceSplash) or
  continuously (sparkTrail); a pointer `paint` mouse-force mode;
  lissajous / figure-8 emitter orbits; up to four attractor wells;
  ridged / vortex curl fields; a gyroid SDF collider; GPGPU floor
  bounce; named VEX deform presets; and a global time scale
  (locked to 1 during deterministic renders).
- **Kinetix preset pack (B4)** — all 26 Kinetix studio presets
  converted into the starter library (481 presets total), and
  curated mutation adjustments in the preset breeding mutator.

### Fixed
- **GPGPU age synchronisation** — initial particle ages were uniform,
  so every particle respawned on the same frame and age-driven
  colour pulsed across the whole field (~7 s period). Initial ages
  are now scattered with the seeded RNG: age colour / size and
  deathBurst now follow per-particle lifecycles. Verified on a real
  GPU (iMac gate, all 14 cases plus the fix re-check PASS).

## [1.5.0] — 2026-11-14

Phase 8 — OBS stream mode: a pure-picture player for live compositors.

### Added
- **Stream mode** (`?stream=1`) — boots straight into a chrome-free
  player (no panels, no controls, no first-visit poster) built to be
  loaded as an OBS Browser Source; playback is forced on. The top
  share bar gained a 配信 button that copies the stream URL for the
  current scene.
- **Transparent variant** (default `?stream=1`) — the scene renders
  onto an alpha matte for direct overlay compositing. Honest
  limitation: full-PostFx transparency is impossible by design — the
  app's custom post passes (feedback / kaleidoscope / slit-scan)
  hard-code opaque alpha (`vec4(rgb, 1.0)`) and the composer buffer
  clears at alpha 1 — so the transparent variant bypasses PostFx and
  renders the scene directly (renderer alpha, clear alpha 0, no scene
  background). Effects that live inside the scene still render.
- **Chroma / black variants** (`?stream=1&bg=key` / `&bg=black`) —
  solid pure green (0, 255, 0) or black background with the **full
  PostFx chain** intact, for OBS's Chroma Key filter or a plain
  backdrop.

Verified on a real GPU (ANGLE Metal, stage9 smoke): transparent
corners read back alpha 0 across the whole empty matte; chroma
corners read back exactly (0, 255, 0, 255); embed and kiosk modes
unaffected.

## [1.4.0] — 2026-11-14

Phase 7 — the app talks back: MIDI output for live rigs, and a receive
link from the companion Noise app.

### Added
- **MIDI output** — the Play tab's MIDI section gains an output
  subsection (device selector, channel, base CC, step note; settings
  persist in the browser). Three things are sent back to the selected
  port: macro positions as CC (base CC + macro index, coalesced to
  roughly one send per 30 ms), a step-note pulse every time the
  sequence lands on a new item (internal playback, MIDI clock, Ableton
  Link, note actions and manual clicks all share the item-load path,
  so each landed step fires exactly one pulse), and a Program Change
  whose number is the loaded preset's index in the current shelf
  order — enough to keep motorised faders and DAW-side program
  changes in step with the visuals.
- **Noise link receiver** — with the "Varelser Link" toggle enabled in
  the Noise app (another tab of the same browser), its playback state
  and levels (master, layers 1–3, binaural) arrive over
  BroadcastChannel and become modulation sources: the Modulation
  section shows a "Noise Link:" status line and its source selector
  gains a "Noise連携" group, so the noise bed can breathe through the
  particle scene. Nothing is received while Noise is not broadcasting.

### Integration notes
- MIDI output pairs with the input side shipped in 1.3.0 (note
  actions, clock sync) for two-way live setups — the same wiring the
  Meikyoshisui guide uses for DAW live performance — and tempo sync
  remains available via MIDI clock or the Ableton Link bridge
  (`tools/link-bridge/`). As in 1.3.0, endpoint behaviour is verified
  against virtual ports in the real-GPU smoke; a physical-controller
  pass remains a user-side check.

## [1.3.0] — 2026-11-14

Phase 6.5 / 6.6 — external-control synchronisation for live performance:

### Added
- **MIDI note actions** — keyboard / pad notes can be learned and assigned
  to five actions (next / previous preset, advance sequence one step,
  sequence play / stop, randomize) alongside the existing CC mapping for
  knobs and faders. Note On only; assignments persist in the browser.
- **MIDI clock sync** — the sequence can follow an external MIDI clock
  (Start / Continue / Stop, BPM detection) with a selectable step
  division, via the new "Sequence Sync" source selector in the Play tab's
  MIDI section. Steps advance through the same path as clicking a
  sequence item, so the internal timer never double-advances.
- **Ableton Link sync** — the same Sequence Sync selector can follow an
  Ableton Link session through a small local bridge
  (`tools/link-bridge/`, a dependency-light Node script bridging the
  Link session to the browser over WebSocket). If the bridge is not
  running the UI degrades gracefully and no steps are driven.
  Interop note: the bridge and its protocol handling are verified, and
  the browser client is verified against the bridge; a joint session
  check against Ableton Live itself is still pending (no Live in the
  build environment).

## [1.2.0] — 2026-11-14

Phase 6 ("ultimate") — five additions on top of the 1.1.0 feature set:

### Added
- **OpenRouter BYOK** — the AI tab now accepts a visitor's own OpenRouter
  API key (called directly from the browser, never via the site relay),
  alongside Groq and Gemini.
- **Global Undo / Redo** — header buttons and Ctrl/Cmd+Z /
  Shift+Ctrl/Cmd+Z step through parameter-config history.
- **Mesh export (OBJ / STL)** — surface layers (membrane, tubes) can be
  exported as mesh files for Blender / 3D printing, in addition to the
  existing point-cloud PLY, SVG, PNG and video exports.
- **Embed player** — `/?embed=1#p=<presetId>` plays a single preset in a
  chrome-free player with play / fullscreen controls, ready to iframe
  into notes and other sites.
- **Kiosk mode** — `/?kiosk=1` runs a canvas-only attract loop with
  auto-rotating presets for unattended exhibition use.

## [1.1.0] — 2026-11-14

### Added
- **Chua catalog integration** — the 4 Chua double-scroll presets (2 GPGPU
  attractor, 2 motion) join the generated collection: **746 → 750 presets**,
  each with a catalog thumbnail, a share page and a per-preset JSON. New
  "Chua" series in the preset shelf and the catalog.
- `<meta name="description">` on the app entry page.
- English overview section in the README.

## [1.0.0] — 2026-11-14

First tagged release: the live site at https://monosphere.pages.dev/ as of
2026-11-14, with its full source published in this repository.

### Highlights
- Four-edge UI (slim header / left rail / right preset shelf / bottom deck +
  expandable sheet), Basic / Pro modes — the canvas centre is never covered
- Built-in library of 444 presets + generated collection of 746 presets with
  real thumbnails, lazy-loaded into the shelf (series: Coverage, Ignition,
  Theory, Lenia, Particle Life, DLA, L-System, Raymarch, Audio FFT)
- Chua circuit (double-scroll attractor) as both a scene motion and a GPGPU
  attractor type
- Evolution Lab (crossover / mutation), parameter timeline & morphing
  playback, partial preset apply & blending
- AI tab: natural-language preset generation and parameter control
  (BYOK: Groq / Gemini, direct from the browser; optional site relay)
- Optional cloud sync of user presets (Neon Postgres)
- Every preset has a share page with OGP cards; the site ships robots.txt
  and sitemap.xml (748 URLs); the Pages worker returns real 404s for
  missing files while keeping the SPA fallback for app routes
- Platform features: Wake Lock, Document Picture-in-Picture, Web Share,
  PNG clipboard copy, fullscreen, PWA

### Notes
- Not yet in this repo: `.github/workflows/deploy-pages.yml` and the binary
  PWA icon PNGs under `public/` (the live deployment includes both).
