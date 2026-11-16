# Changelog

All notable changes to Kalokagathia / Monosphere are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions
match the GitHub releases of this repository.

## [1.24.0] — 2026-11-17

Third-period plan Phase V: the Mir / OBJ mesh side — the imported
OBJ gains a polygon face, the terrain texture gains a dedicated
image input and a UV transform, and the terrain tunnel gains
forward travel.

### Added
- **OBJ Mesh** (7 new keys `gpgpuObjMesh*`, all default-off /
  identity): `gpgpuObjMeshEnabled`, `gpgpuObjMeshDisplay`
  ('wireframe' default / 'solid'), `gpgpuObjMeshRepeat` (1..64
  copies on a centred cube grid, spacing 2.15 in normalised
  units), `gpgpuObjMeshScale`, `gpgpuObjMeshPosX/Y/Z`,
  `gpgpuObjMeshRotY` (degrees), `gpgpuObjMeshOpacity`. The mesh
  reads the SAME `gpgpuMorphObjSource` text as the morph target
  (shared `lib/objMorph.ts` parser — no second copy of the data),
  is normalised exactly like the morph sampler (bbox centre,
  bounding-sphere radius 1) and scaled by the morph world scale,
  so mesh and point cloud coincide. Pure geometry builders live
  in `lib/objMesh.ts`. Enabled with no usable OBJ source draws
  nothing and the UI states that explicitly. Monochrome only.
- **Terrain texture detail** (4 new keys): `gpgpuTerrainTextureImage`
  (dedicated image source, data URL, <=256px via the UI; empty =
  the legacy Horizon background image is used, bit-identical),
  `gpgpuTerrainTextureRepeat`, `gpgpuTerrainTextureOffsetX/Y` —
  the standard UV transform (uv * repeat + offset) applied to
  whichever terrain map is active, procedural kinds included.
  Defaults ('' / 1 / 0 / 0) are the identity.
- **Tunnel cruise** (1 new key `gpgpuTunnelSpeed`, world units
  per second, 0 default): with the terrain tunnel on, the terrain
  phase scrolls toward the viewer through a second period-shifted
  copy of the same geometry, reading as endless forward flight.
  The camera itself never moves (Phase G export determinism); the
  scroll offset is a pure function of accumulated scene time
  (`tunnelScrollOffset` in `lib/terrainMesh.ts`), the component is
  remounted per deterministic job so exports reproduce the travel
  frame-for-frame, and speed 0 renders the legacy static tunnel
  bit-for-bit.
- Starters +3 (509 → 512): OBJ Mesh Knot Grid (wireframe 2x2x2
  with the morph cloud on the centre copy), Terrain Texture
  Repeat (grid x4, offset 0.25), Terrain Tunnel Cruise (speed 24).
  All monochrome. Config keys 982 → 996.

### Fixed
- **Terrain 'image' texture never became visible** (latent since
  the terrain mesh shipped in v1.18.0): the image loads
  asynchronously and is swapped into the mesh material, but a
  material first rendered without a map never recompiled with
  USE_MAP, so the terrain rendered untextured. The material is
  now keyed on map presence so it remounts when the texture
  lands. Found and proven in the Phase V real-GPU gate (probe
  build: texture loaded and set in state, surface still plain);
  the no-map form is unchanged and the default render stays
  bit-identical.

## [1.23.0] — 2026-11-16

Third-period plan Phase T: a 3D light object for the GPGPU points —
a point light with radial falloff, an optional spotlight cone, and
a Light emitter shape. Lighting multiplies the drawn brightness
only; the simulation is never touched.

### Added
- **3D light** (11 new keys `gpgpuLight*`, all default-off /
  identity): `gpgpuLightEnabled`, `gpgpuLightPosX/Y/Z` (world
  position), `gpgpuLightIntensity` (brightness added at the centre),
  `gpgpuLightRadius` (falloff radius), `gpgpuLightConeEnabled`,
  `gpgpuLightConeAngleDeg` (half angle), `gpgpuLightDirX/Y/Z` (cone
  direction, normalised on use). The multiplier is
  `1 + intensity * falloff * cone`, with falloff `(1-(d/R)^2)^2`
  inside the radius and exactly 1 outside it, so disabled /
  intensity-0 / out-of-radius are all bit-exact identities. The
  cone feathers smoothly out to 1.25x the half angle. Pure
  functions live in `lib/gpgpuLight.ts` with a GLSL twin in the
  point shader; the factor is computed per particle in the vertex
  shader from the world position and multiplied into the fragment
  colour. Monochrome only (brightness, never colour). The PostFx
  Lux screen-space lights are unchanged.
- **Light emitter**: `gpgpuEmitShape` gains `'light'` — particles
  are emitted from the light position (a small ball of 5% of the
  bounce radius) and the age respawn re-emits there too, whether
  or not the light itself is enabled (Particular's Light Emitter
  semantics: the position is borrowed, the light need not shine).
  Other shapes' seeded data and respawn are byte-identical.
- Starters +3 (506 -> 509): Point Core, Cone Beam, Light Emitter
  (Source Point). Config keys 971 -> 982.
- Out of scope by design: shadows / occlusion (the point draw has
  no depth-bearing representation of the field to occlude with);
  the CPU fallback (its Canvas 2D draw has no per-particle
  brightness-from-position path); Aux / streak / trail draws.

## [1.22.0] — 2026-11-16

Third-period plan Phase U: particle quality — arbitrary sprite
images, 5-point age curves, and per-property Layer Maps.

### Added
- **Sprite image particles** (new key `gpgpuSpriteImage`, default
  ''): while an image is set, GPGPU point sprites take their shape
  from the image — luminance (times alpha) becomes the sprite alpha,
  monochrome only — with priority over `gpgpuPointShape`. The image
  is picked in the Point Shape block (downscaled to <=256px, stored
  as a data URL like the gradient image, PNG so alpha survives) and
  decoded by the new `lib/spriteImageTexture.ts`, which mirrors the
  gradient image's cache and row-flip conventions.
- **Age curves** (4 new keys): fixed-position 5-point curves over
  the normalised age (points at t = 0 / .25 / .5 / .75 / 1, linearly
  interpolated; pure functions in `lib/ageCurve.ts`, GLSL twin in the
  point shader). `gpgpuAgeCurveSizeEnabled` / `gpgpuAgeCurveSizePoints`
  (default [1,1,1,1,1]) and `gpgpuAgeCurveOpacityEnabled` /
  `gpgpuAgeCurveOpacityPoints` (default [1,1,1,1,1]). Each curve is a
  multiplier layered on the legacy age paths, so an all-ones curve is
  exactly the legacy behaviour even while enabled; the legacy keys
  (`gpgpuAgeSizeStart/End`, `gpgpuAgeFadeIn/Out`, `gpgpuAgeSizeCurve`)
  are unchanged. UI: five sliders plus preset chips （一定 / 右上がり /
  右下がり / 山 / 谷） per curve — no curve editor.
- **Layer Maps per property** (2 new keys): `gpgpuMapSizeAmount` and
  `gpgpuMapOpacityAmount` (both default 0). The gradient image
  (`gpgpuGradImageSource`, already plumbed into the point shader for
  the image colour driver) is sampled by particle position and its
  luminance modulates size and opacity individually:
  factor = mix(1, luma, amount). With no image set the amounts have
  no effect, and the UI states that explicitly.
- **Starters +3** (503 -> 506): a star-faced sprite image sample, a
  mountain age-curve sample, and a radial-blob Layer Map sample, all
  monochrome with tiny embedded images.
- Config keys total 964 -> 971. All new keys default to the legacy
  behaviour; the deterministic-render identity against v1.21.0 is
  bit-exact at defaults (iMac real-GPU gate).

## [1.21.0] — 2026-11-16

Third-period plan Phase S: an authored-path basis for the SVG morph
target, plus the Phase Q test-suite follow-up.

### Added
- **Path placement for the SVG morph target** (new module
  `lib/pathGeometry.ts`): the imported SVG is also parsed as ordered
  subpaths with true arc-length tables, built by M2 adaptive
  subdivision (flatness judged on 16 interior sample points,
  eps = 0.001 in document coordinates) so the path basis does not
  inherit the legacy flatten's arc coarseness (-1.6e-03 on an ellipse
  half). Six new config keys (total 958 -> 964), all defaulting to
  the legacy behaviour: `gpgpuMorphPathMode` ('off' default / 'along'
  / 'writeOn'), `gpgpuMorphPathWriteOnStart` (0),
  `gpgpuMorphPathWriteOnEnd` (1), `gpgpuMorphPathTaper` (0),
  `gpgpuMorphPathTaperShape` ('linear' / 'smooth' / 'bell'),
  `gpgpuMorphPathSubpathMode` ('proportional' / 'even' / 'first').
  'along' assigns particle i to path position s in arc-length order;
  'writeOn' assigns inside the [start, end] window only (start > end
  collapses to a zero-width window at the start, never a fallback).
  Taper widens the placement band along the path normal (maximum
  width fixed at 0.1 normalised units, offset reuses the existing h2
  bake draw, so no new RNG consumption). With replicas, each copy
  receives one contiguous segment of the path. The path branch lives
  inside the shared morph bake, so the WebGL, WebGPU and CPU
  fallback paths all gain it at once; with mode 'off' the bake is
  byte-identical to v1.20.0 (unit-tested, including with replicas
  active). UI: a Path subsection inside Morph Targets, shown for the
  SVG target, with the extra controls collapsed while 'off'.
- **Starters +2** (501 -> 503): a tapered 'along' star and a
  'writeOn' 0-60% star, both monochrome.

### Fixed
- Phase Q unit test expectation followed the Phase Q identity fix
  (aux gravity factor order in the shader); the suite is back to
  19/19 with no application behaviour change.

## [1.20.0] — 2026-11-16

Second-period plan Phase R (final phase): the two sub-paths catch
up with the main WebGL path's morph.

### Added
- **CPU fallback morph**: the Canvas 2D fallback simulator now
  applies the morph attraction. It reuses the exact GPGPU morph
  bake (`buildGpgpuMorphTargetData`, texSize 64) at normalised
  scale, assigns each CPU particle its own baked target, and pulls
  it there with the velocity shader's force law (Y orbit with the
  baked replica phase, exponential snap factor). All bake-complete
  targets work: built-in shapes, terrain, OBJ, SVG, and — via the
  same media maps the GPU runtime assembles — text and image.
  Replica grammar is baked in as on the GPU path. No new config
  keys: the existing `gpgpuMorph*` keys are read as-is. With morph
  off, the CPU step is bit-identical to v1.19.0 (unit-tested
  against the legacy sim). Not ported: the OBJ normal kick (an
  emission pulse tied to the GPU age/respawn system, which the CPU
  sim does not have) and morph inside CPU attractor mode (the
  attractor branch keeps precedence).
- **WebGPU morph**: the WGSL velocity pass gains the morph
  attraction — the baked cloud rides a storage buffer with the
  same index layout as the position buffers, and the force law is
  the WebGL shader's, verbatim in structure. Morph joins the
  WebGPU capability registry as a supported feature (before this
  it was not even listed, so morph configs silently lost the
  force on the WebGPU path). With morph off the WGSL block is
  skipped entirely. Not ported to WGSL: the OBJ normal kick and
  every other WebGL-only force (unchanged from before).

### Notes
- No new config keys (958), no new starters (501), catalog
  unchanged (1,541). The WebGL path is untouched: the frozen
  deterministic render is bit-identical to v1.19.0.
- This closes the second-period plan (Phases M–R). The Maxon
  coverage audit does not cover these sub-paths; the Phase Q
  value (70%) stands as the second period's final coverage.

## [1.19.0] — 2026-11-16

Parent/Child (second-period plan Phase Q): the B3 Aux pool — a
second GPU simulation with its own position/velocity textures,
spawned by parent-particle events (death / bounce / trail) — stops
sharing the parent's physics and look, and becomes a complete
child emitter.

### Added
- **Child gravity scale** (`gpgpuAuxGravityScale`, default 1):
  multiplies the child's softened gravity. 1 is the legacy shared
  behaviour, 0 makes children weightless, negative values give
  anti-gravity (children rise while parents fall).
- **Child drag** (`gpgpuAuxDrag`, default 0): extra velocity
  damping for the child pool only. 0 is the legacy drag exactly.
- **Child curl** (`gpgpuAuxCurl`, default 0): a deterministic,
  position-only vortex force (Y-axis tangential swirl plus a fixed
  sinusoidal shear) in the child's velocity pass. No time and no
  randomness, so the deterministic renderer reproduces it frame
  for frame; at 0 the term is omitted entirely.
- **Child colour** (`gpgpuAuxColor`, default '' = inherit): the
  child pool's draw colour, independent of the parent's
  `gpgpuColor`. The empty default inherits the parent colour,
  exactly as before.
- The Aux UI section is now headed "Child Emitter" (子エミッタ)
  and labels the four keys as the child's own physics / look.
  Key names are unchanged (compatibility kept).
- Config keys 954 → 958. Starters +2 (501), both monochrome:
  death-born children rising against gravity in light grey, and
  bounce-born children lingering in a dragged vortex.

### Notes
- The Phase K replica grammar remains a static bake grammar, and
  N-level nesting (grandchildren) is out of scope, as recorded in
  the Phase Q report. The child is a single full second
  simulation, not a per-replica simulation.

## [1.18.0] — 2026-11-16

Mir terrain mesh (second-period plan Phase P): the Phase L point
terrain gains its polygon counterpart — a dedicated mesh system
that shares the same seeded height field, closing the audit's
Mir row (polygon terrain + normal shading), the tunnel, texture
mapping, and surface display switching in one system.

### Added
- **Terrain Mesh system** (`gpgpuTerrainMeshEnabled`, default
  off): a 128x128 grid displaced by `terrainHeightAt` with the
  bake's exact field-seed mixing (extracted as
  `terrainFieldSeedFor`, so the mesh landscape and the 'terrain'
  point terrain are the same landscape — ridges line up, proven
  by unit test), vertex normals from `computeVertexNormals`, and
  MeshStandardMaterial shading under lights that mount with the
  system. Off mounts nothing at all: the legacy render is
  bit-identical.
- **Display switching** (`gpgpuTerrainMeshDisplay`): 'shaded'
  (default) / 'wireframe' / 'points' over the same geometry.
- **Tunnel mode** (`gpgpuTerrainMeshTunnel`): the field wraps a
  cylinder interior (x = circumference, z = depth, height =
  radial relief). The field is cross-fade tiled on both wrapped
  axes, so the circumference closes seamlessly and the depth
  repeats every length — spatial repetition inside one static
  length; there is no scrolling.
- **Texture mapping** (`gpgpuTerrainMeshTexture`): 'none'
  (default, plain shading) / 'gradient' (monochrome ramp +
  contour bands) / 'grid' (survey grid) procedural canvas
  textures, or 'image' reusing the Horizon background image
  source as the surface map (plain shading until one is set,
  which the UI states explicitly).
- **Size / opacity / brightness** (`gpgpuTerrainMeshScale`,
  `gpgpuTerrainMeshOpacity`, `gpgpuTerrainMeshBrightness`).
- Config keys 947 → 954. Starters +2 (499): a shaded mesh range
  synced with the point terrain, and a grid-textured tunnel,
  both monochrome.

### Notes
- The terrain field parameters stay the shared
  `gpgpuMorphTerrain*` keys; the Terrain Mesh UI section edits
  the same keys, so point and mesh terrains can never drift apart.

## [1.17.0] — 2026-11-16

OBJ emission modes + normal initial velocity (second-period plan
Phase O): the Phase J OBJ morph target gains the two pieces the
Maxon audit named as missing — sampling-mode switching and a
normal-direction initial velocity — completing the OBJ emitter.

### Added
- **OBJ sample mode** (`gpgpuMorphObjSampleMode`, 'surface'
  default / 'vertices' / 'volume'): 'surface' is the Phase J
  area-weighted surface distribution, bit-identical (the new
  sampler reproduces the Phase J cloud draw-for-draw, proven by
  unit test). 'vertices' places samples on the mesh vertices
  themselves. 'volume' fills the interior of a closed mesh by
  seeded rejection sampling with a ray-parity inside test
  (attempt-capped; a non-closed mesh falls back to 'surface' and
  both the sampler result and the UI state that explicitly).
- **OBJ normal speed** (`gpgpuMorphObjNormalSpeed`, default 0):
  the sampler now also returns per-sample normals (authored `vn`
  wins per-vertex, else the area-weighted face-normal average;
  volume samples take the nearest face's normal), baked into a
  companion normal texture alongside the morph target texture.
  The velocity shader applies the normal velocity ONLY at
  (re)placement — the simulation-start envelope and the
  age-respawn frame — never as a continuous force, so the morph
  spring re-forms the shape afterwards. 0 disables the kick
  entirely and keeps the legacy path bit-identical.
- Config keys 945 → 947. Starters +2 (497): a volume-filled
  sphere and a normal-burst sphere, both monochrome.

### Notes
- The Phase J surface path (`sampleObjPointCloud`) is untouched;
  existing OBJ presets render bit-identically (unit test + iMac
  real-GPU gate).

## [1.16.0] — 2026-11-16

Horizon 360° (second-period plan Phase N): the Horizon image
background gains an equirectangular projection, so a panorama
becomes a true camera-following environment instead of a flat
backdrop.

### Added
- **Image projection** (`backgroundImageProjection`, 'flat' default
  / 'equirect'): 'flat' is the Phase I plane backdrop exactly (the
  image baked at the frame aspect with cover/fit). 'equirect'
  decodes the source at its native size, loads it with
  `THREE.EquirectangularReflectionMapping` and sets it as
  `scene.background` — three.js renders it on the inside of the
  background sphere, so the visible slice follows the camera.
  A 2:1 panorama is recommended; other aspects are stretched over
  the sphere rather than failing. The fit key is ignored in
  equirect mode.
- **Equirect yaw** (`backgroundEquirectYaw`, degrees, default 0):
  rotates the panorama horizontally via
  `scene.backgroundRotation.y` (the three.js scene-background
  rotation API), reset to zero whenever equirect is not active.
- Config keys 943 → 945. No new starters (bundling a background
  image would bloat every config that carries it).

### Notes
- The existing background semantics are unchanged: deterministic
  renders keep transparent = background dropped, unmult = black
  matte, opaque = background included (the Phase G camera pin
  makes equirect renders reproducible frame-for-frame); stream
  mode still suppresses Horizon; still captures keep the texture
  for opaque and drop it for transparent.

## [1.15.0] — 2026-11-16

Light, colour and chain finishing (second-period plan Phase M):
Starglow gains a deterministic shimmer, layer 2/3 points gain an
age-driven gradient, and the replica grammar gains an age phase.
Every new key defaults to the legacy behaviour.

### Added
- **Starglow shimmer** (`postStarglowShimmer`, amount 0–1, default
  0; `postStarglowShimmerSpeed`, default 1): the glint streaks are
  modulated per direction (horizontal / vertical / diagonal groups
  phase-shifted by thirds of a cycle) and per screen cell (a
  position hash), so glints twinkle independently instead of the
  whole frame blinking. The time base is a frame counter inside
  the LightFX pass — no wall clock — so deterministic renders are
  reproducible frame-for-frame. Amount 0 keeps the legacy
  accumulation formula exactly (the shimmer factors are 1.0 and the
  weight sum is the legacy one).
- **Layer gradients** (`layer2GradEnabled` / `layer3GradEnabled`,
  default OFF; `layer2GradPreset` / `layer3GradPreset`, default
  'sumie'): layer 2/3 points can take their colour from the
  existing 3-stop gradient LUT (Kinetix gradient presets), driven
  by normalised age (the layer life progress, vLife). The LUT
  machinery is the same as the GPGPU gradient's
  (`lib/kinetixGradients.ts`); OFF keeps the single layer colour +
  opacity exactly. Layer 1 is out of scope: it does not run the
  layer life system this driver reads, and its colour path is the
  pulse system's own.
- **Replica age phase** (`gpgpuMorphReplicaAgeStep`, 0–1 fraction
  of the lifecycle, default 0): each morph replica copy's
  particles start their lifecycle offset by r × step of
  `gpgpuAgeMax` — applied both to the initial age scatter
  (`lib/gpgpuInitialData.ts`, index-pure, no extra RNG draws) and
  to the respawn restart age in the position pass, keyed by the
  same contiguous replica blocks as the bake. With step 0 or a
  single copy, initial data and respawn behaviour are
  bit-identical to v1.14.0.
- **Starters**: `starter-post-lightfx-starglow-shimmer` (monochrome
  Starglow field with shimmer) and `starter-layer2-age-gradient-sumie`
  (monochrome layer-2 sphere ageing through the Sumi Ink ramp) —
  built-in starters 493 → 495. Config keys 936 → 943.

### Notes
- The layer gradient's age is the layer Life progress: with a
  layer's Life at 0 the age does not advance and the gradient sits
  at its start stop (the UI states this). Per-layer custom stops
  were not added; the preset list is the selection mechanism, as
  with the GPGPU gradient's preset-first flow.

## [1.14.0] — 2026-11-16

Terrain (leftover plan Phase L, final phase): the GPGPU morph system
gains a Mir-style fractal terrain target, and the gradient system a
height driver to shade it. The morph-off default path and every
existing morph target's bake are bit-identical to v1.13.0 ('terrain'
is appended to the target list, so existing bake seeds do not move).

### Added
- **Morph target `terrain`** (`gpgpuMorphTarget`): particles tile
  the XZ domain on the bake grid and take the height of a seeded
  fractal field (value-noise fBm, `terrainHeightAt` in
  `lib/gpgpuMorphTargets.ts` — integer-lattice hash, smoothstep
  interpolation, gain-normalized octaves) as their Y, forming a
  landscape surface point cloud. Four new config keys —
  `gpgpuMorphTerrainAmplitude` (elevation range, default 0.55),
  `gpgpuMorphTerrainFrequency` (feature scale, default 1.6),
  `gpgpuMorphTerrainOctaves` (1–6, default 4) and
  `gpgpuMorphTerrainSeed` (field offset, default 0). The field is a
  pure function of (gpgpuSeed, terrain seed, parameters), so the
  same config always grows the same terrain; the Phase K replica
  grammar applies to terrain like any other target.
- **Gradient driver `height`** (`gpgpuGradDriver`): the 3-stop LUT
  is driven by world Y (centred on 0, scaled by the existing
  `gpgpuGradSpatialScale` slider) — valleys take the start colour,
  peaks the end colour. This is the terrain's elevation shading and
  works for any content with vertical structure.
- **UI** in the Morph section: a Terrain block (amplitude /
  frequency / octaves / seed sliders) shown for the terrain target,
  and a Height option in the gradient Driver select.
- **Starters**: `starter-gpgpu-morph-terrain-range` (mountain range
  with monochrome elevation shading) and
  `starter-gpgpu-morph-terrain-valley-mist` (gentle field, bright
  haze pooled in the valleys) — built-in starters 491 → 493.

### Notes
- The terrain is a point sampling of the height field, not a
  polygon mesh: there is no normal-based mesh shading, no tunnel
  form and no texture mapping onto a surface. In Maxon-audit terms
  the Mir terrain row therefore lands at △ (fractal height field
  achieved as a particle surface), not ◎.

## [1.13.0] — 2026-11-16

Replica grammar (leftover plan Phase K): the GPGPU morph bake gains
an offset-replication grammar — the shape point cloud is chained
into copies with cumulative translation / rotation / scale steps,
plus a per-copy orbit phase offset (an Echospace-style time-offset
chain). The morph-off default path and replica count 1 reproduce the
legacy bake bit-for-bit; existing presets render identically.

### Added
- **Replica grammar** for every morph target (built-ins, text /
  image, SVG, OBJ): six new config keys — `gpgpuMorphReplicaCount`
  (1–8, default 1), `gpgpuMorphReplicaSpacing` (per-step translation,
  normalized units), `gpgpuMorphReplicaAxis` (`x` / `y` / `z`),
  `gpgpuMorphReplicaRotation` (per-step Y rotation, degrees),
  `gpgpuMorphReplicaScaleStep` (per-step geometric ratio) and
  `gpgpuMorphReplicaPhaseStep` (per-step orbit phase offset,
  degrees). The bake (`lib/gpgpuMorphTargets.ts`) splits the fixed
  texSize² point budget into contiguous blocks — one per copy — so
  the total particle count never grows; each copy's phase offset is
  baked into the morph texel alpha and applied by the velocity
  shader as a time shift of the orbit angle, so copies follow the
  leader's motion with a constant delay. Deterministic: same config,
  same chain.
- **UI** in the Morph section: a Replicas block (count slider, and
  spacing / axis / rotation / scale / phase controls when count > 1).
- **Starters**: `starter-gpgpu-morph-replica-knot-chain` (trefoil ×4
  with rotation + phase steps) and
  `starter-gpgpu-morph-replica-sphere-scale` (geodesic ×5 geometric
  scale series) — built-in starters 489 → 491.

### Notes
- The grammar is a static bake over one shared simulation. It does
  not model Particular-style Parent/Child emitters: a copy has no
  forces, lifetime or emission of its own — dynamic child emission
  would need per-copy simulation state and stays out of scope.

## [1.12.0] — 2026-11-16

OBJ input (leftover plan Phase J): the GPGPU morph system gains an
imported-mesh target, closing the OBJ-emitter gap shared by
Particular, Form and Mir in the Maxon coverage audit. The morph-off
default path is unchanged; existing presets render identically.

### Added
- **Morph target `obj`** (`gpgpuMorphTarget`): a Wavefront OBJ
  document's surface becomes the morph point cloud, reusing the B1a
  morph plumbing (baked target texture, exponential approach). The
  OBJ source text is stored in the config (`gpgpuMorphObjSource`),
  exactly like the SVG morph source, so it persists with projects
  and travels with presets; the cloud is re-sampled deterministically
  at bake time — same source, same cloud.
- **OBJ parser** (`lib/objMorph.ts`, dependency-free): `v` / `f`
  lines with every common face index form (`v`, `v/vt`, `v//vn`,
  `v/vt/vn`, negative relative indices); polygon faces are
  fan-triangulated; normals / texture coordinates / materials are
  skipped and malformed lines ignored. Sampling is uniform over the
  surface (area-weighted triangle pick, seeded RNG — deterministic),
  8,192 points, normalised to bounding-sphere radius 1 around the
  bounding-box centre, matching the built-in targets' sizing.
- **Import UI** in the Morph section: file open (.obj), paste field,
  and a status line reporting vertex / face / triangle counts. With
  no usable OBJ the bake falls back to a sphere shell and the UI
  states the fallback explicitly (no silent substitution).
- **Samples & starters**: two procedurally authored sample meshes
  ship as constants — an icosphere (42 v / 80 f) and a torus-knot
  tube (420 v / 420 quad faces) — with starters
  `starter-gpgpu-morph-obj-sphere` and `starter-gpgpu-morph-obj-knot`
  (built-in starters 487 → 489).

### Notes
- OBJ vertex sampling as an emitter/base-form is the same cloud;
  mesh *rendering* (shaded geometry) remains the mesh export /
  geometry modes' job. Mir's OBJ repeat/transform grammar is out of
  scope here (replication grammar is Phase K).

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
