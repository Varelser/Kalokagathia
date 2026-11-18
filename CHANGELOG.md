# Changelog

All notable changes to Kalokagathia / Monosphere are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions
match the GitHub releases of this repository.

## [1.66.0] — 2026-11-19

Ninth-term Phase BJ: the noise field generalised — a kind /
octave grammar for the field itself, and the field wired into
the map-source supply. Two new config keys, both defaulting to
the Phase AY field exactly; two new starters.

### Added
- **Field kind and octaves** (`gpgpuNoiseMapKind`:
  'perlin' / 'ridge' / 'turbulence', default 'perlin';
  `gpgpuNoiseMapOctaves`: 1–5, default 1). The field is now an
  fBm sum (frequency ×2, amplitude ×0.5 per octave, normalised
  by the amplitude sum) of kind-transformed gradient noise —
  perlin reads the octave value as-is, turbulence its absolute
  value, ridge one-minus-absolute — in both the TS reference
  (`lib/noiseFieldMap.ts`) and its GLSL twin
  (`kaloNoiseMap01`), so all three existing consumers (the
  'noise' gradient driver, size, displacement) read the
  generalised field. At the defaults the sum is the single
  octave over an amplitude sum of 1 with the identity reading,
  so every sample is bit-identical to the Phase AY field. The
  tile side's noise (`lib/texturePack.ts`) is untouched: the
  vocabulary matches, the definition stays independent.
- **Noise field map supply** (`'noise-field'`, a new
  `AfMapSourceKind`): the field as a static slice — the XY
  plane at z = 0, time 0, evolve not applied — rasterised from
  the field definition keys (scale / kind / octaves) by the
  same pure sampler, cached per definition like the text /
  path rasters. It reaches every source key that accepts the
  AF supplies: the raster mask (`gpgpuMaskSource`, including
  the kill mask and the feedback mask), the per-property Layer
  Map sources (color / size / opacity / displace), and the
  composite B layer (`postCompositeSource`). The mask picker
  captures the slice's numeric grid at assignment time, like
  text / path. Offered in the UI as 「ノイズ場（静的スライス）」
  so the static nature is stated where it is chosen.
- Starters: `starter-noise-ridge-octaves-relief` (ridge field
  over 3 octaves driving displacement + colour) and
  `starter-noise-field-mask-carve` (the 'noise-field' supply
  as a clip mask).

詳細は PHASE_BJ_REPORT.md（統合側で作成）。

## [1.65.0] — 2026-11-18

Ninth-term Phase BI: bake-time attribute arithmetic (stage 1
of the attribute-operations foundation). One new config key,
defaulting to no arithmetic anywhere; two new starters.

### Added
- **Bake-time attribute expressions** (`gpgpuAttrExprs`, one
  expression per attribute slot, default all empty). When a
  slot's expression is non-empty, the Phase AJ expression
  language evaluates it once per particle at bake time: the
  variables are the slot names (an earlier slot reads its
  computed result, a later slot its source value, a slot reads
  its own source value) plus `x` (the slot's own source value)
  and `t` = 0. The result is clamped to [0, 1] and baked into
  the same static attribute texture, so every existing
  consumer (size / brightness / force drives, the group gate)
  reads computed attributes with no consumer-side change. An
  expression that fails to compile or yields a non-finite
  result leaves the slot at its source value. The expression
  language gained an additive extra-variables path
  (`compileExpression(text, extraVars)` /
  `evaluateCompiledExpressionWithVars`); the x / t-only
  behaviour is unchanged, and with all four expressions empty
  the bake never enters the expression code path, so the
  default output is bit-identical to v1.64.0. Stage 2
  (per-stage dynamic processing) is not included.
- **Starters** `starter-attr-expr-product-size` (hash × radius
  drives size, species/radius mean drives brightness) and
  `starter-attr-expr-group-gravity` (radius² gates gravity to
  the outer shell).

## [1.64.0] — 2026-11-18

Eighth-term Phase BG: vertical text layout (tategaki columns)
for the layer-2 TextMap raster. Four new config keys, all
defaulting to the legacy horizontal rendering exactly; one new
starter.

### Added
- **Vertical text layout** (`layer2TextMapVertical`, default
  off): when on, the text raster is laid out as columns —
  glyphs placed one by one, top → bottom, columns proceeding
  right → left (column 0 holds the head of the text and is the
  rightmost). `layer2TextMapColumnLength` (0 = one column per
  newline segment) wraps columns by glyph count, newlines
  always break columns, `layer2TextMapColumnGap` and
  `layer2TextMapLetterSpacing` set the column step and glyph
  advance as ratios of the glyph size. The layout is computed
  by pure functions (`lib/textColumnLayout.ts`) shared by both
  text drawing paths — `extractTextLumaMap` (numeric grid:
  morph bake, CPU fallback, mask capture) and
  `rasterizeTextCanvas` (GPU texture supply) — so every
  consumer sees the same picture. With the flag off, both
  paths run the legacy line layout verbatim. All glyphs stay
  upright: no tate-chu-yoko, no ruby, no kinsoku processing,
  no page-level multi-column typesetting.
- **Starter** `starter-text-vertical-morph`: a text morph in
  vertical columns (「型而上学」 in two columns of 3 + 1).

## [1.63.0] — 2026-11-18

Eighth-term Phase BF: 2D Boolean for the raster mask — a soft
boolean combine of the current mask with a captured operand.
Four new config keys, all defaulting to no change in rendering;
one new starter.

### Added
- **Mask boolean combine** (new lib `lib/shapeBoolean.ts`):
  two luma grids A (the current `gpgpuMaskMap`) and B (a
  captured operand) combine per pixel — union = max,
  intersection = min, difference = a×(1−b), xor = |a−b| —
  which matches the boolean truth table exactly on binary
  inputs and keeps antialiasing on grey inputs. B is
  resampled (nearest) to A's grid; an empty B acts as the
  empty set (union/difference/xor keep A, intersection
  yields all zero). The combine runs capture-style, like the
  existing mask supplies: capture B through the existing
  routes (image / text / path fill / terrain-derived), pick
  the operation (`gpgpuMaskBoolOp`, default 'union'), and
  "合成してマスクに適用" writes the result into both
  `gpgpuMaskMap` and `gpgpuMaskSource` (rendered data URL),
  so bake/shape consumers and the GPU clip agree. A is
  replaced by the result; B (`gpgpuMaskBoolOperandMap` /
  `Width` / `Height`) is kept, so the operation can be
  changed and re-applied. Out of scope: mesh CSG, vector
  boolean, layer-side masks, per-frame live recombine.
- **Starter** `starter-gpgpu-raster-mask-boolean-crescent`:
  a ring minus a disc (difference) crescent mask in shape
  mode, with the operand embedded for re-combining.

## [1.62.0] — 2026-11-18

Eighth-term Phase BE: the GPGPU colour gradient ramp gains an
arbitrary stop list. Two new config keys, both defaulting to
the legacy behaviour exactly; one new starter.

### Added
- **Gradient stop list** (`gpgpuGradStopPositions` /
  `gpgpuGradStopColors`, both default empty): when the list
  resolves to at least two valid stops, the gradient LUT is
  built from the list (2–16 stops, positions clamped to [0,1],
  ends pinned to 0 and 1, piecewise-linear interpolation —
  the same fill the 5-stop path already used). When the list
  is empty or invalid, the legacy 3-/5-stop derivation runs
  verbatim, so existing presets render bit-identically (proven
  by unit byte-equality tests and on the iMac real-GPU gate:
  a list seeded from the legacy layout renders with zero
  frame difference against the legacy path). The Aux/Color
  panel gains a stop-list editor: seed the list from the
  current legacy stops, edit each stop's position and colour
  by row, add (up to 16) and delete stops, or clear the list
  to return to the legacy 3-/5-stop editors. While the list
  is active it defines the whole ramp and the legacy colour
  keys are not read. Scope: the GPGPU gradient LUT only —
  the output-grade 3-point ramp and the layer-side preset
  gradient are unchanged.

## [1.61.0] — 2026-11-18

Seventh-term Phase BC (the final phase of the term):
whitewater — a foam layer derived from the FLIP field. Five
new config keys, all defaulting to the legacy behaviour
exactly; two new starters.

### Added
- **Whitewater — foam derived from the FLIP field**
  (`gpgpuWhitewaterEnabled`, default off; `Amount` /
  `Threshold` / `Life` / `Size`): a dedicated 64×64 GPU pool
  whose inactive slots probe one hashed field cell per tick
  and spawn there when the cell's agitation — vorticity
  magnitude (central differences) plus convergence (negative
  divergence, the pressure solver's own stencil) — passes the
  threshold. Spawn probability is proportional to the foam
  factor, so foam density tracks the field quantity: still
  water spawns nothing. Foam particles are born with the
  field's PIC velocity plus a small upward pop, are carried by
  the flow, shrink and die within their short life. The system
  is strictly one-way: foam reads the projected field and
  never writes back into the FLIP pipeline or the main pool.
  Honest scope: the FLIP layer is a 2D planar (xz) solver, so
  foam lives on a thin sheet around the field plane — no free
  surface, no curvature / energy criterion, and no foam /
  spray separation (a single foam population).

## [1.60.0] — 2026-11-18

Seventh-term Phase BB: the Vellum constraints learn to pull,
and the grains learn their angle. Four new config keys, all
defaulting to the legacy behaviour exactly; two new starters.

### Added
- **Stitch — velocity coupling for Vellum**
  (`gpgpuVellumStitch`, default 0): a dedicated pass
  (`SIM_VELLUM_VEL_FRAG`) runs after the constraint projection
  and blends each texel's velocity toward the average of its
  live structural neighbours, so a pull on one end of the sheet
  accelerates the other end through the links — momentum
  exchange along the seams, where Phase AR's solver was
  position-only. Torn links do not transmit; pinned texels act
  as zero-velocity anchors. At 0 the pass never runs and the
  frame is verbatim Phase AR.
- **Glue — bake-point bonds for Vellum** (`gpgpuVellumGlue`,
  default 0; `gpgpuVellumGlueBreak`, default 0 = unbreakable):
  a zero-rest-length distance link from each texel to its own
  bake point, solved inside the projection with its own rate,
  so the cloth can be glued to its baked shape. With a break
  threshold set, a bond whose texel strays farther than the
  threshold (world units) releases monotonically — survival is
  tracked in the state texture's .b channel, and the state pool
  now also allocates while breakable glue is live.
- **Angle of repose, direct specification**
  (`gpgpuGrainsReposeAngle`, degrees, default 0 = off): while
  set, the grains solver's friction coefficient is
  μ = tan(angle) and the key overrides `gpgpuGrainsFriction`
  (single resolution point: `lib/gpgpuGrains.ts`). A slope
  steeper than the specified angle slides, a gentler one rests
  — monotonic in the key, where the Phase AQ emergence from
  friction alone measured non-monotonic. At 0 the friction key
  rules exactly as before.
- **Starters**: `starter-vellum-stitched-cloth` (the silk sheet
  with stitch coupling at 0.8 — gusts swing the sheet as one
  connected body) and `starter-grains-repose-pile` (the grain
  pile with a 35° repose specified directly over a deliberately
  low friction key).

## [1.59.0] — 2026-11-18

Seventh-term Phase BA: the rigid-body floor stands on the
terrain. One new config key, defaulting to off (the legacy flat
plane exactly); two new starters.

### Added
- **Published terrain heightfield** (`lib/terrainHeightfield.ts`):
  the erosion bake's field (Phase AP's `ErodedTerrainField`,
  129×129 over [-1.05, +1.05]^2) published as a CPU-referenceable
  array in world units — resolution, domain, row order and the
  bilinear/clamped sampling rule are part of the module's
  contract. The field exists only while the erosion grammar is
  active (plane mode); otherwise publication returns null. The
  existing attribute-texture / derived-map paths are unchanged:
  the particle collider and slope force still read their GPU
  texture bake, which is built from the same base grid through
  the same erosion sim (cell-for-cell agreement by construction,
  not a shared array).
- **Terrain floor for rigid bodies** (`gpgpuRigidFloorTerrain`,
  default off): while on and a published field exists, the RBD
  floor collision samples the heightfield at the body's centre
  (bilinear), applies the contact impulse along the field's
  gradient normal, and the sleep support test reads the same
  ground height. Positional correction stays vertical and the
  collision shape stays the bounding sphere, so a large body can
  still intersect a steep slope beside its centre. Fallbacks,
  all to the flat plane at `gpgpuFloorY`: key off, erosion off,
  tunnel mode. Sphere approximation, glue and sleep behaviour
  are otherwise unchanged.
- **Starters**: `starter-rbd-terrain-landing` (a glued shell
  lands intact on an eroded landscape and sleeps in a hollow)
  and `starter-rbd-terrain-debris` (weak glue — chunks break on
  the slopes, roll down and settle in the carved valleys).

## [1.58.0] — 2026-11-18

Seventh-term Phase AZ: parallax, on the conditional spike's
"feasible" verdict. Five new config keys, every one defaulting
to 0 (the legacy framing exactly); two new starters.

### Added
- **Parallax layer shift** (`parallaxLayer1`, `parallaxLayer2`,
  `parallaxLayer3`, `parallaxAmbient`, `parallaxGpgpu`): the
  scene's five layer families — Layer 1, Layer 2, Layer 3, the
  ambient layer and the GPGPU family (core + smooth tubes +
  light volume + metaballs, which share one shift so their
  readback coupling stays aligned) — are wrapped in plain
  groups under the SceneGroup, and each group is translated by
  (camera position − the config's default camera position) ×
  its factor as the camera orbits, pans or dollies (pure math
  in `lib/parallax.ts`, driver in
  `components/sceneParallaxGroup.tsx`). Factor 0 leaves the
  wrapper at the identity, so the composed world matrices are
  numerically the legacy ones and the render is bit-identical.
  Deterministic renders pin the camera to the default position,
  so the delta is zero and exports never carry parallax at any
  factor. The SceneGroup's auto-rotation is not a drive signal
  (that would be differential rotation, not parallax).
  Non-participants, by design: the raymarch system (its SDF
  scene is camera-anchored and never followed the SceneGroup
  rotation either), TerrainMesh / ObjMesh (world-anchored,
  outside the SceneGroup), the background and screen-space
  passes, and the CPU fallback renderer.
- **Starters**: `starter-parallax-layer-drift` (three layers
  with graded factors over a gentle camera impulse) and
  `starter-parallax-gpgpu-depth` (a GPGPU sphere counter-shifted
  against the ambient dust).

## [1.57.0] — 2026-11-18

Seventh-term Phase AY: the noise field becomes a map source.
Four new config keys, every one defaulting to the legacy
behaviour; the gradient gains a 'noise' driver value; two new
starters.

### Added
- **Noise field map** (`gpgpuNoiseMapScale`, `gpgpuNoiseMapEvolve`,
  `gpgpuNoiseMapSizeAmount`, `gpgpuNoiseMapDisplaceAmount`): the
  scalar noise field the curl force is built from (the velocity
  pass's vnoise; TS reference in `lib/noiseFieldMap.ts`) can now
  be consumed as data, not only as a force. The field value at a
  particle's own position modulates its size (Layer Map factor
  form) and displaces it radially (the Phase X formula, while
  the texture displacement path is inactive), and the new
  **'noise' gradient driver** reads the same field as the colour
  ramp's input — colour decided by the spatial field, not by
  age or a per-particle random seed.
- **Field time evolution**: the sample point carries an offset
  of direction * evolve * time on the render clock, so with
  evolve > 0 the colours, sizes and displacement drift as the
  field evolves — no rebake and no config snapshot, and the
  deterministic render reproduces the field at any given time
  exactly. Evolve 0 (default) is a static field; with the
  amounts at 0 and the driver at its default the draw never
  samples the field and stays bit-identical.

## [1.56.0] — 2026-11-18

Seventh-term Phase AX: the remaining emission-side grammar
bundle. Fifteen new config keys, every one defaulting to the
legacy behaviour; two new starters.

### Added
- **Distance-based emission order** (`gpgpuSpawnOrderMode`):
  'distance' / 'distanceFar' release the spawn gate's pool in
  order of the particles' initial distance from the origin
  (the gate value becomes the max-normalised initial distance,
  baked into a static texture at seed time) instead of the
  legacy hash order. 'hash' (default) is bit-identical.
- **Pulse cycles + probability** (`gpgpuSpawnPulseCycles`,
  `gpgpuSpawnPulseProbability`): the periodic burst can stop
  after N cycles (0 = unlimited) and each cycle fires only
  when a deterministic per-cycle hash falls below the
  probability (1 = every cycle). At the defaults the pulse
  time delegates to the Phase AH function verbatim.
- **Spawn burst event** (`gpgpuSpawnEvent*`): a directly
  authored burst — at the authored time, the authored fraction
  of the live pool respawns at once and is handed a directly
  specified initial velocity (magnitude + radial→random spread
  blend). A single event, not a list; parked (unborn)
  particles are not touched.
- **Foliage scatter finishing** (`gpgpuMorphScatterScaleRandom`,
  `gpgpuMorphScatterRotRandom`, `gpgpuMorphScatterBend`):
  per-particle scale / azimuth randomisation of the scatter
  companion normal and a downhill posture bend, on top of the
  Phase AI grammar. This is an orientation finish on a point
  cloud — there is no per-species mesh swap and no mesh bend.
- **Sprite rotation** (`gpgpuSpriteRotInitial`,
  `gpgpuSpriteRotSpeed`, `gpgpuSpriteRotDamping`,
  `gpgpuSpriteRotRandom`): the point sprite itself rotates
  with particle age — initial angle + angular speed with
  exponential damping and a per-particle seed spread. Applies
  to sprite images and procedural point shapes alike; all
  defaults 0 keep the legacy sampling verbatim.

## [1.55.0] — 2026-11-18

Seventh-term Phase AW: the remaining drawing-side grammar
bundle. Twelve new config keys, every one defaulting to the
legacy behaviour; two new starters.

### Added
- **Polygon morph target** (`gpgpuMorphTarget: 'polygon'`,
  `gpgpuMorphPolygonSides` 3–12): a regular-polygon plate
  inscribed in the unit circle, area-uniform fill, appended at
  the end of the target list so every existing target's bake
  stays bit-identical.
- **Error-diffusion dither mode** (`postDitherMode`):
  'diffusion' switches the ordered-dither pass to a
  Floyd–Steinberg-style approximation — a fragment shader
  cannot run the sequential scan, so the incoming error is
  estimated one tap deep from the already-scanned neighbours'
  quantization errors (FS weights 7/3/5/1). 'bayer' (default)
  is the Phase AD pass verbatim.
- **Moire post stage** (`postMoire*`): two regular patterns
  (grid / rings / lines), the second rotated by Angle and
  shifted by Phase, multiplied into the interference field
  and mixed over the frame. Sits after 'cellular', before
  'feedback', in every stack profile.
- **Preset transition shapes** (`presetTransitionShape`):
  crossfade (default, the legacy uniform morph) / wipe /
  dissolve / circle stagger the per-key progress of a preset
  morph (window 0.35, endpoints exact); the target config's
  shape governs.
- **Gradient stop positions** (`gpgpuGradQuarterPos` /
  `gpgpuGradThreeQuarterPos`): the Phase AH extra stops move
  off their fixed 0.25 / 0.75; at the defaults the 5-stop LUT
  is bit-identical to Phase AH, and unspecified stops keep the
  legacy 3-stop fill at any positions.
- **Path jitter** (`layer1LineJitterPaths`): the Phase AH line
  jitter amount also displaces path drawing — L-System line
  geometry and the morph bake's path placements (SVG path /
  contour) — via a position hash, so shared joints stay glued
  and polylines never tear. The amount key is modulation-
  routable, so routes move the paths with the lines.

### Fixed
- **Stale test expectations (era pins)**: the Phase AU / AR
  suites' totals pins are brought current (1,258 keys / 569
  starters); the Phase X2 suite's signature expectation gains
  AW's two appended bake-input fields; the Phase AM suite's
  append-only target check now expects 'polygon' last. The
  Phase AM suite's own totals pins (1,206 / 553) predate this
  phase and remain stale, untouched.

## [1.54.0] — 2026-11-18

Seventh-term Phase AV: behaviour-zero maintenance. No behaviour
change, no new config keys, no new starters.

### Fixed
- **Stale test expectations**: the Phase AR suite's totals pins
  still held the AR-era values (1,230 keys / 561 starters) and
  are updated to the current measured totals (1,246 / 567); the
  Phase X2 CPU-port suite's morph signature expectation still
  predated Phase AM and now includes AM's six bake-input fields
  in their current position. Both suites pass in full again.
- **Velocity shader split**: `gpgpuShaderSimulationVelocity.ts`
  (71,378 B) is split into a thin concatenation shell (1,861 B)
  over five verbatim chunk modules (preamble / helpers / main
  forces / main SPH+Grains / main tail), the same pattern as the
  Forces split in v1.39.1. The assembled `SIM_VEL_FRAG` string
  is byte-identical to the pre-split shader (length 70,447,
  sha256 pinned by the new Phase AV test).

## [1.53.1] — 2026-11-18

Maintenance release: the depiction honesty note catches up with
the sixth-term solver phases. No behaviour change.

### Fixed
- **Depiction honesty note** (`lib/depictionCoverageTargets.ts`):
  the roadmap-8E note claimed engine-wide that there is no
  position-based-dynamics constraint solver and no destruction
  physics, which stopped being true in Phase AR (v1.50.0, Vellum)
  and Phase AU (v1.53.0, RBD). The note now separates the
  layer-mode look-classifications from what exists elsewhere in
  the engine: `SHADER_EMULATED_SOLVER_FAMILIES` is reduced to
  `mpm-material` (there is still no material-point simulation
  anywhere), and a new `LIMITED_REAL_SOLVER_FAMILIES` names
  `pbd-solver` and `destruction-fracture` with their limits
  spelled out (Jacobi position projection, not XPBD compliance;
  bounding-sphere rigid bodies, not mesh collision or
  stress-based fracture). Coverage targets and the mode resolver
  are unchanged.

## [1.53.0] — 2026-11-18

Sixth-term Phase AU: rigid-body dynamics (RBD) — a CPU
rigid-body solver over the Voronoi fracture cells, the sixth
and final of the solver-class phases. Six new config keys
(total 1,240 → 1,246), two new starters (565 → 567).

### Added
- **Rigid bodies** (`gpgpuRigid*`, Enabled default off): the
  fracture bake's cells become up to 64 rigid bodies, stepped
  by a deterministic CPU solver at a fixed 1/120 s substep
  inside the render frame. Bodies translate and rotate
  (sphere-approximation inertia from the cells' second
  moments), collide with each other (bounding-sphere pairs
  with per-pair rest distances so deeply overlapping cells do
  not explode apart), the floor and the bounce sphere,
  restitution and Coulomb friction (`gpgpuRigidRestitution`,
  `gpgpuRigidFriction`), sleeping with impact / glue-break /
  support-loss wake-up, and glue bonds between initially
  touching cells that hold the assembly together and break on
  impact Δv or strain (`gpgpuRigidGlueEnabled`,
  `gpgpuRigidGlueStrength`). `gpgpuRigidStartSleeping` starts
  the bodies asleep. The solver's state reaches the GPU as a
  small body texture; the position pass overrides each bound
  particle to its body's rigid transform and the velocity
  pass to the rigid surface velocity, so the cloud moves as
  solid pieces. Honest limits: bounding-sphere collision
  only — no convex hulls or mesh collision, no constraint
  joints, no friction stacking; the floor is flat (the
  eroded height field is not a collider in this version);
  while RBD is bound the Vellum resolution is forced off and
  the respawn / kill / morph lifecycle is suppressed (a
  respawn would shred body membership), and replica stacks
  are suppressed (the solver owns the single pool). WebGPU
  compute declares 'rigid-bodies' unsupported and routes to
  WebGL; the CPU fallback treats it as a no-op.

## [1.52.0] — 2026-11-18

Sixth-term Phase AT: the FLIP layer — a grid pressure solver
for the fluid field, the fifth of the solver-class phases.
Four new config keys (total 1,236 → 1,240), two new starters
(563 → 565).

### Added
- **FLIP layer** (`gpgpuFlip*`, Enabled default off, requires
  the fluid field): the existing 64×64 advection field becomes
  a two-way coupled FLIP grid. Particles splat momentum onto
  the grid (P2G, bilinear shares accumulated into a float
  transfer target with additive blending), the composite grid
  velocity (advected field mixed with the momentum average by
  coverage) is made divergence-free by a Jacobi pressure
  projection (`gpgpuFlipPressureIterations`, 0–32, default
  16), and the velocity pass reads the result back (G2P) as a
  PIC/FLIP blend (`gpgpuFlipBlend`, 0 = PIC … 1 = FLIP) applied
  at `gpgpuFlipTransfer` strength. The projection's discrete
  operators are MAC-consistent (backward-difference
  divergence, forward-difference gradient), so the compact
  Laplacian the Jacobi iteration solves is the one the
  projection actually cancels. Honest limits: this is a 2D
  planar (xz) FLIP layer, not Houdini's 3D solver — no free
  surface, no y-pressure, grid viscosity stays with SPH, no
  whitewater; and plain Jacobi inside 32 iterations removes
  cell/mid-scale divergence effectively but barely touches
  the smoothest bulk modes (residuals measured in the Phase
  AT gate report). While FLIP is on, the legacy one-way field
  sample is replaced by the transfer (no double forcing) and
  replica stacks are suppressed (the splat reads the shared
  pool). WebGPU compute declares 'flip' unsupported and
  routes to WebGL; the CPU fallback treats it as a no-op.

## [1.51.0] — 2026-11-18

Sixth-term Phase AS: the Pyro solver — a particle-side
temperature / buoyancy solver in the velocity pass, the fourth
of the solver-class phases. Six new config keys (total
1,230 → 1,236), two new starters (561 → 563).

### Added
- **Pyro solver** (`gpgpuPyro*`, Enabled default off): each
  particle's temperature is derived deterministically from its
  normalised age — T = Temperature × (1 − ageNorm) ^ Cooling —
  with no new textures, passes or state. The temperature drives
  a buoyancy acceleration in the velocity pass (its own term in
  gravity units, so hot particles rise against a gravity that
  stays downward — replacing the legacy starter trick of a
  negative gravity) and temperature-linked stirring: the curl
  block's effective strength is modulated by the temperature
  (Disturbance Heat), and an independent temperature-weighted
  curl term (Disturbance) stirs hot particles even with curl
  off. Honest limits: this is a particle-side solver, not a
  grid volume solver — no density / temperature field, no
  pressure projection, no heat conduction between particles,
  no combustion model. The smoke density is the particle
  distribution itself; the age-driven blackbody gradient stays
  in sync with the temperature by construction. WebGPU compute
  declares 'pyro' unsupported and routes to WebGL; the CPU
  fallback treats it as a no-op (like SPH / Grains).

## [1.50.0] — 2026-11-18

Sixth-term Phase AR: the Vellum solver — PBD-family distance-
constraint projection over the particle pool's texel grid, the
third of the solver-class phases. Nine new config keys (total
1,221 → 1,230), two new starters (559 → 561).

### Added
- **Vellum solver** (`gpgpuVellum*`, Enabled default off): while
  on, the pool re-bakes into a structured grid — a flat Sheet or
  a spherical Shell — and a dedicated projection pass runs
  `Substeps` Jacobi iterations (1–4, default 2) of distance-
  constraint projection (structural / shear / bend links against
  the baked rest lengths, per-texel corrections averaged over
  the live-link count — the plain sum diverges at stiffness 1,
  measured) after the position pass each frame. Pin fixes texels
  to their rest pose (top edge / corners / both); Pressure is a
  face-normal force in the velocity pass; Damping bleeds
  velocity per frame; Tear severs structural links whose strain
  exceeds the threshold (monotonic — only a re-bake resets).
  While the solver is on, age respawn, kill conditions, the
  spawn gate, morph attraction, replica independent stacks and
  pointer painting are resolved off to protect the grid.
  Honest limits: this is PBD-family position projection, not a
  strict XPBD compliance solve (stiffness is the effective value
  of correction rate × iterations and shifts with dt); the
  averaged Jacobi iteration converges slowly for long-wavelength
  pulls, so residual stretch remains; there is no self-collision;
  pressure is a normal force, not volume preservation. The
  WebGPU path declares `vellum` in the capability registry and
  routes to WebGL; the CPU fallback is a no-op (SPH parity).
- **Starters**: `starter-vellum-silk-cloth` (a sheet pinned
  along the top edge, hanging and fluttering in the wind) and
  `starter-vellum-balloon` (an unpinned shell inflated by
  pressure).

## [1.49.0] — 2026-11-18

Sixth-term Phase AQ: the Grains solver — grain-grain contact
and friction as an actual solve, the second of the solver-class
phases. Seven new config keys (total 1,214 → 1,221), two new
starters (557 → 559).

### Added
- **Grains solver** (`gpgpuGrains*`, Enabled default off): a
  DEM-style penalty contact + Coulomb friction solve inside the
  WebGL velocity pass, over the same statistical subsample
  neighbourhood as SPH (max 64 samples, no new passes, no new
  textures). Per sampled neighbour closer than the grain
  diameter (Size, world units — the SPH radius' unit system):
  a penalty repulsion of overlap × Stiffness, tangential
  friction capped at Friction × the contact's normal push
  (below the cap the contact sticks), an offset-proportional
  Cohesion pull at the gentle Phase AB gain, Restitution on the
  approaching normal velocity, and Rest Damping that bleeds
  velocity from slow grains in contact so a pile settles.
  Honest limits: there is no position projection, so deep
  compression keeps some interpenetration; the neighbourhood
  is statistical, so sparse single contacts can be missed;
  and the angle of repose is an emergent value of the friction
  coefficient (measured on the real-GPU gate), not a key.
  The WebGPU path declares `grains` in the capability registry
  and routes to WebGL; the CPU fallback is a no-op (SPH parity).
- **Starters**: `starter-grains-pile` (a rain of grains stacking
  into a mound on the floor) and
  `starter-grains-cohesive-clumps` (cohesion on — wet-sand
  clumps instead of a loose rain).

## [1.48.0] — 2026-11-18

Sixth-term Phase AP: terrain erosion simulation — the first of
the solver-class phases. The generated height field is re-carved
by an iterative simulation at bake time. Seven new config keys
(total 1,207 → 1,214), two new starters (555 → 557).

### Added
- **Terrain erosion** (`lib/gpgpuMorphTargets.ts`,
  `gpgpuMorphTerrainErosion*`, both strengths default 0):
  seeded droplet hydraulic erosion (Water / Droplets / Deposit /
  Seed — 30,000 base droplets, hard budget 60,000) plus thermal
  talus relaxation (Thermal / Talus / ThermalPasses, hard budget
  80 passes), run once on the field's own 129×129 grid when the
  terrain is baked. The output is ONE eroded field with a
  bilinear sampler, and every consumer of the landscape reads
  it — the morph bake, the terrain mesh, the derived maps (and
  with them the terrain collider and the slope force), the
  shadow occlusion and the scatter grammar — so the carved
  landscape never splits. Per-frame cost is zero; the worst-case
  bake (max droplets + max passes) measures ~0.2 s. With both
  strengths at 0 the grammar resolves to null and every consumer
  runs the analytic field verbatim (bit-identical legacy
  landscape). Plane mode only: in tunnel mode the config-side
  builders strip the erosion options, following the collider /
  slope-force precedent. No WebGPU capability declaration is
  needed: erosion lives in the shared CPU bake and the derived
  supply, which resolve identically on every path.
- **Starters**: `starter-terrain-eroded-canyon` (hydraulic
  carving on the point terrain) and
  `starter-terrain-talused-ridge` (thermal relaxation on the
  ridge mesh).

## [1.47.0] — 2026-11-18

Sixth-term Phase AO: input and the public surface. Four items:
multi-touch simultaneous interference, the embed script API as a
published spec, declared User Parameters, and the imported OBJ as
a particle geometry. One new config key (total 1,206 → 1,207),
two new starters (553 → 555).

### Added
- **Multi-touch interference** (`lib/multiPointer.ts`,
  `gpgpuMouseMultiTouch`, default off): pointer input is now
  tracked as an insertion-ordered set of up to 4 pointers
  (Pointer Events). The first pointer drives the legacy
  single-pointer path verbatim; with the key on, the velocity /
  position shaders apply the same falloff law to every pointer
  (`uMousePosMulti[4]` / `uMouseCount`, inert at count 0), and
  paint brushes are picked per particle from the tracked set by
  the shared gate hash. Strength / radius / mode stay shared.
  The WebGPU path declares `multi-touch` in the capability
  registry and routes to WebGL; layers 2/3 keep their single
  pointer (documented limitation).
- **Embed script API** (`lib/embedControl.ts`, `PUBLIC_API.md`):
  a namespaced postMessage protocol (`kalokagathia`, v1) for the
  embed player only — `setParam` (validated through the AI
  control catalog, unchanged), `applyPreset` (ID only, no config
  injection), `setUserParam` (declared names only), `getState`
  (replies to the sender's origin). The catalog gains a public
  schema version constant (`AI_CONTROL_CATALOG_VERSION` = 1) and
  the spec is listed in DOCS_INDEX.md. No new config keys.
- **User Parameters** (`lib/userParameters.ts`): declarations
  `{ id, label, group, key, defaultValue }` cut existing catalog
  keys out onto a public surface (Global tab section), persisted
  under their own localStorage key
  (`kalokagathia.userParameters.v1`). Ranges come from the
  catalogs; values write through the normal config path. Zero
  declarations = no surface, no writes. Project-file inclusion
  is out of scope for this phase.
- **OBJ particle geometry** (`gpgpuGeomMode: 'obj'`): the
  imported OBJ (the morph source document) becomes the
  per-particle shape, scaled to the built-in shapes' radius
  class (0.7). A new triangle budget (4,096) bounds the source;
  empty / unparseable / over-budget sources fall back to the
  octahedron base and the panel note states which case applies.

## [1.46.0] — 2026-11-18

Sixth-term Phase AN: the editing base — sequence tracks and
keyframes. Any numeric parameter (including the camera keys) can
now be laid out as a keyframe track on the sequence's time axis and
is evaluated while a sequence plays. Tracks are a setup-side
grammar, not config keys: they persist under their own localStorage
key (`kalokagathia.sequenceTracks.v1`, the modulation pattern),
apply only during sequence playback, and only in the effective
config layer after modulation — config state is never written, so
track overrides cannot fight the preset morph loop. With an empty
track set the evaluation is never called and the effective config
is the legacy path verbatim. No new config keys (total stays
1,206) and no new starters (stays 553).

### Added
- **Sequence tracks** (`lib/sequenceTracks.ts`): tracks over the
  numeric parameter catalog plus the camera keys the catalog never
  carried (cameraDistance from the Global Display slider range,
  manualRotation* as radian angles). Keyframes carry an absolute
  pass time, a value clamped to the catalog range, and the easing
  used toward them; evaluation is a pure function of time with end
  holds and no extrapolation. Sanitization sorts keyframes,
  collapses same-time duplicates (last wins), enforces one track
  per key, and caps tracks (16) and keyframes per track (64).
- **Sequence clock**: playback anchors an absolute pass time at
  segment seams (playback start = 0, each morph start = the item's
  segment start, loop wrap = −transition so the reading runs
  continuously from the previous pass's tail) and publishes it to a
  shared store at ~50ms. Anchoring at every seam means no drift.
- **Tracks editor** in the Sequence section: catalog search to add
  a track, keyframe markers on the pass timeline, add-key-at-
  playhead capture from the current config, and numeric time /
  value / easing editing. Editing is locked in the public build;
  tracks still apply there during playback. Tracks are not yet
  bundled into project files (same treatment as the modulation
  setup).

## [1.45.0] — 2026-11-18

Sixth-term Phase AM: 2D foundation extensions — the contour of a
luma source vectorised into a morph target, per-glyph deformation
for text on a path, the remaining sweep/loft profiles, a two-layer
composite post stage, and the 2D small bundle (dashed lines, path
offset, pixel sort, a discrete cellular automaton, glitch). The
data-mosh half of the glitch row (frame-to-frame motion transfer)
stays out of scope, as planned. Twenty-nine new config keys
(1,177 → 1,206) and two new starters (551 → 553). Every addition
is default-off / default-identity and resolves to the legacy path
verbatim while off: the new post stages are absent from the stack,
the contour target appends after 'data' without touching the seed
order of the existing targets, the glyph deform option is null at
zero amounts, the path offset returns the authored geometry
reference at 0, and the tube profiles are the identity curve asset.

### Added
- **Contour morph target** (`gpgpuMorphTarget: 'contour'` /
  `gpgpuMorphContourSource` / `gpgpuMorphContourThreshold`):
  marching squares over the layer-2 TextMap raster or the media
  luma map, chained into polylines in the media mapping and placed
  like an authored path (no RNG draws; shell fallback when no
  outline exists). New lib `lib/contourTrace.ts`.
- **Per-glyph deformation** (`gpgpuMorphTextOnPathGlyphScale` /
  `gpgpuMorphTextOnPathGlyphRotate` /
  `gpgpuMorphTextOnPathGlyphFade`): each glyph's scale / rotation
  / fade drawn from a deterministic integer hash of its index;
  the fade is a density expression (faded particles keep the
  plain path placement), because the bake's alpha channel is the
  replica phase's.
- **Custom tube section + ribbon profiles**
  (`gpgpuSmoothTubeSectionShape: 'custom'` /
  `gpgpuSmoothTubeSectionProfile` /
  `gpgpuSmoothTubeWidthProfile` /
  `gpgpuSmoothTubeHeightProfile`): the section's radial scale
  from a free curve over the ring angle; the ribbon's width (N)
  and height (B) components scaled along the tube by their own
  free curves, edited with the Phase AJ curve editor.
- **Composite post stage** (`postCompositeEnabled` /
  `postCompositeSource` / `postCompositeMode` /
  `postCompositeMix`): the frame blended with an AF supply
  texture (text-raster / path-raster / edge-output) under eight
  blend modes; a bit-identical passthrough while the layer is
  not ready.
- **Glitch post stage** (`postGlitchEnabled` /
  `postGlitchAmount` / `postGlitchBands` / `postGlitchRate`):
  horizontal bands displaced by a deterministic (band, time
  quantum) hash plus a fine row jitter; the quantum comes from
  the pass's own frame counter.
- **Pixel sort post stage** (`postPixelSortEnabled` /
  `postPixelSortDirection` / `postPixelSortLow` /
  `postPixelSortHigh` / `postPixelSortPasses`): odd-even
  transposition compare-exchange inside the luminance span,
  iterated in an internal ping-pong; out-of-span pixels are
  barriers. Stateless across frames.
- **Cellular automaton post stage** (`postCellularEnabled` /
  `postCellularRule` / `postCellularCellSize` /
  `postCellularSeedThreshold` / `postCellularMix`): a B/S-rule
  automaton (life / highlife / daynight / seeds / maze / coral)
  on a low-resolution ping-pong state texture, seeded from the
  current frame's luminance on enable and on rule / size /
  threshold changes.
- **Dashed lines** (`layer1LineDashLength` /
  `layer1LineDashGap`): both line shaders carry a dash
  coordinate (segment arc length + midpoint hash phase) and
  discard the gap spans; length 0 is the solid legacy line.
- **Path offset** (`gpgpuMorphPathOffset`): every morph path
  mode places on the miter-joined parallel offset of the
  authored geometry; 0 returns the geometry itself.
- Starters: "Contour Text Outline (Vectorised Raster)" and
  "Cellular Life Field (Seeded Automaton)".

## [1.44.0] — 2026-11-18

Sixth-term Phase AL: rendering extensions — an escape-time
fractal post stage, image-based lighting from the background, a
placed wind volume, and the remaining fiber grooming grammar.
Twenty-one new config keys (1,156 → 1,177) and two new starters
(549 → 551). Every addition is default-off and resolves to the
legacy path verbatim while off: the fractal stage is absent from
the post stack, the IBL branch in the geometry fragment shader is
skipped at intensity 0, the wind-volume block in the velocity
pass is skipped while disabled, and the fiber builder consumes
no extra rng draws at the grooming defaults.

### Added
- **Escape-time fractal post stage** (`postFractalEnabled` /
  `postFractalKind` / `postFractalCenterX` / `postFractalCenterY`
  / `postFractalZoom` / `postFractalIterations` /
  `postFractalJuliaX` / `postFractalJuliaY` / `postFractalMix`):
  Mandelbrot / Julia escape-time fields rendered as monochrome
  luminance (interior white, smooth escape bands) and mixed over
  the frame. A separate foundation from Phase AG's recursive
  L-system figures.
- **Image-based lighting** (`gpgpuGeomIblIntensity`): the
  background — the equirect image, or the horizon gradient baked
  as an equirect — sampled as diffuse + fresnel-weighted
  reflection light on the instanced geometry. Single-tap
  approximation (no roughness mip chain).
- **Wind volume** (`gpgpuWindVolumeEnabled` /
  `gpgpuWindVolumeX` / `gpgpuWindVolumeY` / `gpgpuWindVolumeZ` /
  `gpgpuWindVolumeRadius` / `gpgpuWindVolumeStrength`): a placed
  sphere that localises the global wind (direction and gust are
  inherited) with the light-style (1−(d/R)²)² falloff. Declared
  to the WebGPU capability registry, so WebGPU sessions route to
  WebGL while it is on.
- **Fiber grooming** (`gpgpuMorphFiberGroomX` /
  `gpgpuMorphFiberGroomY` / `gpgpuMorphFiberGroomZ` /
  `gpgpuMorphFiberGroomAlign` / `gpgpuMorphFiberLengthVar`): a
  global groom direction the strand growth aligns toward, plus a
  deterministic per-strand length distribution for the Phase AG
  morph-surface fibers.

### Not in this release
- Noise-texture time evolution (deferred from Phase AH) was
  re-evaluated and deferred again: the applied map is a config
  snapshot and every consumer bakes on config change, so no
  natural per-frame regeneration path exists; the viable route
  is a map-source foundation change, out of this phase's scope.
  Recorded in PHASE_AL_BRIEF.md.

## [1.43.0] — 2026-11-18

Sixth-term Phase AK: the attribute foundation — named point
attributes, an attribute-conditioned group gate, and an external
point cloud kept with its columns. Fifteen new config keys
(1,141 → 1,156), two new starters (547 → 549), and one new morph
target ('data', appended to the enumeration so every seeded
target keeps its identity). The position / velocity texture
layouts are untouched: attributes ride a new static RGBA float
texture in the same supply form as the initial-position texture,
baked deterministically at generation time. The texture is built
only while a consumer is active; with every drive off and the
group disabled, no texture exists and every path runs the legacy
code verbatim.

### Added
- **Named point attributes** (`gpgpuAttrNames` /
  `gpgpuAttrSources`): four attribute slots, each with a user
  name and a generation source — hash (the shader species hash's
  TS twin), index, species, radius, height, age, target (the
  morph bake's radial distance) and data (a named column of the
  registered attribute point cloud). All values are 0..1 and
  fixed at generation time.
- **Attribute drives**: size (`gpgpuAttrSizeSlot` /
  `gpgpuAttrSizeAmount`) and brightness
  (`gpgpuAttrBrightSlot` / `gpgpuAttrBrightAmount`) in the draw
  pass, and a force drive (`gpgpuAttrForceSlot` /
  `gpgpuAttrForceAmount`) that scales only the built-in force
  delta in the velocity pass (the Phase AC capture discipline).
  The factor form is mix(1, attribute, amount); slot −1 or
  amount 0 resolves off.
- **Attribute group gate** (`gpgpuGroupEnabled` /
  `gpgpuGroupSlot` / `gpgpuGroupMode` / `gpgpuGroupLow` /
  `gpgpuGroupHigh` / `gpgpuGroupTarget` / `gpgpuGroupInvert`):
  a below / above / band condition (inclusive boundaries) on
  one attribute decides per-particle membership; the chosen
  force family (all / gravity / turbulence / curl / wind /
  morph) applies only to members.
- **Attribute point cloud** (Play tab → Data Source): CSV /
  JSON registered as a point cloud keeps its positions and its
  columns (`lib/attrPointCloud.ts`, persisted like the signal
  table). Positions feed the new morph target 'data' (shell
  fallback while unregistered); columns feed the 'data'
  attribute source by name (case-insensitive).
- Velocity-side attribute consumers route WebGPU-preference
  sessions to WebGL (capability registry: attr-force /
  attr-group); the draw drives work on every path. The CPU
  fallback does not read the new keys.

## [1.42.0] — 2026-11-18

Sixth-term Phase AJ: the signal grammar completed — expressions,
data columns, CHOP-style chains, and the remaining curve DI.
Three new config keys (1,138 → 1,141), two new starters
(545 → 547). The modulation-side grammar lives in the modulation
setup (performance state, not config keys), so it does not move
the key count. Every default reproduces the legacy behaviour:
the modulation engine is off by default and routes without the
new fields take the pre-AJ path bit-for-bit, and the emission
curve is disabled with an identity curve asset.

### Added
- **Expression sources** (modulation): a route's source can now
  be a sandboxed expression over a wrapped source — a hand-written
  recursive-descent evaluator (no eval) with variables x (input)
  and t (time), arithmetic, comparisons, ternary, and a function
  set (sin / clamp / smoothstep / …). Invalid expressions and
  non-finite results fall back to the raw input value.
- **Data column sources** (modulation): CSV / JSON loaded in the
  Data Source section can also be registered as a column table
  (columns preserved, `lib/dataTable.ts`); a route can then read
  a named column as a time-series signal, normalised by the
  column's range.
- **CHOP-style chains** (modulation): each route can carry up to
  four chain stages — spring (a driven 2nd-order stage), trim
  (range remap), filter (one-pole lowpass in Hz) — applied in
  order between the source and the existing lag, with the same
  deterministic state discipline as the lag.
- **Free curve asset + emission curve drive**
  (`gpgpuFreeCurvePoints` / `gpgpuEmissionCurveEnabled` /
  `gpgpuEmissionCurvePeriod`): a curve with freely placed control
  points (2–8 knots, piecewise-linear) stored as a config asset.
  Its first drive target is emission: over a repeating period,
  the curve value probabilistically gates the age respawn (a
  deterministic per-tick hash, the pointer-paint form), so the
  rebirth rate follows the drawn curve. Declared to the WebGPU
  capability registry (`emission-curve`) so enabled sessions
  route to WebGL.

## [1.41.0] — 2026-11-18

Sixth-term Phase AI: the terrain completed — the three items the
Phase AE brief replacement dropped (terrain collider, terrain
generation recipes, terrain scatter grammar) are recovered.
Twelve new config keys (1,126 → 1,138), two new starters
(543 → 545). Every new key defaults to the legacy behaviour —
with all keys at their defaults the render is bit-identical to
v1.40.0 by construction (the fBm recipe is the legacy height
function verbatim, the default scatter resolves to the identity,
and the collider's disabled uniform keeps the legacy sim path).

### Added
- **Terrain generation recipes** (`gpgpuMorphTerrainKind` /
  `gpgpuMorphTerrainTerraceSteps`): the height field's pure
  function gains three recipes beside the legacy fBm — `ridge`
  (folded ridged multifractal), `terrace` (quantised fBm with a
  smooth riser at each step's top edge) and `cellular` (Worley
  F1 cells). Every consumer (morph bake, terrain mesh, derived
  maps, occlusion, collider) reads the same function, so the
  whole terrain changes shape together.
- **Terrain collider** (`gpgpuTerrainColliderEnabled` /
  `gpgpuTerrainColliderBounce` / `gpgpuTerrainColliderFriction`):
  particles now collide with the height field. A dedicated
  collider bake in the derived-map set packs the height as a
  16-bit value plus the gradient; the velocity pass reflects the
  normal component with restitution and damps the tangential
  component with friction (so particles settle on slopes), and
  the position pass pushes particles back onto the surface.
  Active when the terrain mesh is on in plane mode — the same
  resolution as the slope force; declared to the WebGPU
  capability registry like the slope force.
- **Terrain scatter grammar** (`gpgpuMorphScatterEnabled` /
  `Density` / `HeightMin` / `HeightMax` / `SlopeMax` /
  `AlignNormal` / `Species`): the terrain bake resamples each
  candidate up to five times and keeps it with probability
  density × height-band × slope-limit, so the point cloud gains
  habitats. Align Normal tilts the bake normals onto the
  surface; Species splits the band into zones that scale the
  emission-kick class. All-default scatter is the identity.

## [1.40.0] — 2026-11-17

Sixth-term Phase AH: the remaining small grammar of emission,
rotation, generation, colour and lines. Seven new config keys
(1,119 → 1,126), two new starters (541 → 543). Every new key
defaults to the legacy behaviour — with all keys at their
defaults the render is bit-identical to v1.39.1 by construction
(each feature keeps the legacy expression on its default branch).

### Added
- **Periodic spawn bursts** (`gpgpuSpawnPulseInterval` /
  `gpgpuSpawnPulseDuty`): the spawn gate's release clock now
  advances only during the first duty fraction of each interval
  cycle (pulse time is a pure function in `lib/gpgpuLifecycle.ts`
  with GLSL twins in both simulation passes), so a held-back
  pool is released in waves. Interval 0 = off.
- **Geometry spin random range** (`gpgpuGeomSpinRandom`): each
  geometry instance's spin speed is multiplied by a per-particle
  factor in [1 − r, 1 + r] from a second texel hash, applied
  before both the plain spin and the age-curve integral path.
  0 = uniform speed, as before.
- **Noise texture seed** (`textureNoiseSeed`): the texture
  pack's cloud-noise lattice is offset by a seed-derived shift.
  Seed 0 reproduces the legacy map bit-for-bit. (Time evolution
  of the noise was evaluated and deferred: applied maps are
  config snapshots, so per-frame regeneration has no natural
  ride on the existing path.)
- **Five-stop gradient ramp** (`gpgpuGradQuarter` /
  `gpgpuGradThreeQuarter`): the GPGPU gradient LUT gains
  optional stops at 1/4 and 3/4. Both unspecified = the legacy
  3-stop LUT, bit-identical.
- **Hand-drawn line jitter** (`layer1LineJitter`): the Classic
  and Brush line shaders displace each endpoint by a static
  deterministic hash offset (no time term, so strokes never
  boil). 0 = legacy lines.
- Starters: `starter-spawn-pulse-waves`,
  `starter-gradient-five-stop`.

### Not in this release
- Parallax layer coefficients were evaluated and deferred:
  all layers render inside a single SceneGroup with no
  per-layer transform node, so coefficients have no natural
  insertion point without restructuring the scene graph.

## [1.39.1] — 2026-11-17

Maintenance release: no new features, no new config keys, no
behaviour change. Base is the actually-shipped v1.39.0; with all
keys at their defaults the render is bit-identical to v1.39.0
(verified on the iMac real-GPU gate: FROZEN deterministic render,
all 12 frames at 0.00000). Config keys stay at 1,119 and starters
at 541.

### Changed
- **Forces panel split** (pure refactor, Phase E method): the
  largest file in the tree, `components/controlPanelGlobalDisplayGpgpuForces.tsx`
  (131,729 bytes / 1,946 lines), is split verbatim into a
  1,026-byte composing shell plus seven sibling modules
  (ForcesCore / ForcesMorph / ForcesAuxColor / ForcesMaps /
  ForcesMapBlocks / ForcesImportBlocks / ForcesCustom, largest
  28,612 bytes). A non-empty-line multiset audit proves no line
  of the original was lost or altered; the public export
  (`GlobalDisplayGpgpuForcesSection`) is unchanged.

### Fixed (test harness, outside the app bundle)
- **CPU port comparison tests restored**: the Phase R and
  Phase X2 bit-identity tests compared against legacy CPU sims
  kept as `.bak` files, which the AUDIT1390 `.bak` purge deleted.
  The genuine pre-change sims were recovered from this
  repository's own history (v1.19.0 and v1.27.1) and are now kept
  as permanent fixtures outside the app tree. The Phase X2
  signature expectations were updated to the current signature
  form (Phase AA added 11 morph fields in v1.32.0); both suites
  now pass in full (Phase R 26/26, Phase X2 27/27), with all
  bit-identity assertions unchanged.

## [1.39.0] — 2026-11-17

Phase AG (fifth period, final phase): generation and fracture
become grammar — a seeded Voronoi fracture over the morph bake,
the L-system rule grammar opened to editing, classic 2D fractal
rule texts shipped with it, and fibers grown from the morph
surface. Base is the actually-shipped v1.38.0. With all new
keys at their defaults the render is bit-identical to v1.38.0
(verified on the iMac real-GPU gate: FROZEN deterministic
render, all 12 frames at 0.00000). 10 new config keys (1,119
total), starters +2 (541 total).

### Added
- **Voronoi fracture** (`gpgpuMorphFractureEnabled` / `Cells` /
  `Seed` / `Gap`, pure logic in `lib/voronoiFracture.ts`): a
  post-pass inside the shared morph bake partitions the baked
  cloud into Voronoi cells around seeded sites drawn from the
  cloud itself, then shrinks each cell toward its centroid and
  pushes it away from the shape centre by Gap. Deterministic —
  same cloud + seed → same division — and because the pass lives
  in the shared builder, the WebGPU, WebGL and CPU routings all
  consume the identical fractured cloud. Applies to every morph
  target (text / image / svg / obj / terrain / shapes).
- **L-system rule opening** (`layer2LsysCustomRules` /
  `layer3LsysCustomRules`, parser in `lib/lSystem.ts`): the
  five fixed rulesets (plant / fern / tree / coral / lightning —
  confirmed on inspection) can now be replaced by an editable
  rule string (`axiom = X; X = ...; F = ...`, `|` for stochastic
  alternatives). The default '' is the preset exactly; invalid
  text falls back to the preset safely and can never throw.
- **2D fractal rule texts** (`L_SYSTEM_FRACTAL_RULES`): Koch
  curve, Koch snowflake, dragon curve, Sierpinski arrowhead and
  Hilbert curve as one-click rule texts (with suggested angle /
  depth) in the L-system panel — recursive figures drawn through
  the opened grammar.
- **Morph-surface fibers** (`gpgpuMorphFiberEnabled` / `Count` /
  `Length` / `Curl`, strand builder in `lib/morphFiber.ts`,
  overlay in `components/sceneGpgpuMorphFibers.tsx`): strands
  rooted on the morph bake's surface points, growing along the
  surface normals (OBJ companion normals, radial fallback) with
  a seeded tangent bend. Display-only and deterministic; the
  simulation never reads it.

## [1.38.0] — 2026-11-17

Phase AF2 (fifth period, the Phase AF original-plan items):
the four grammar pieces the AF wiring phase left behind — a
sweep section profile, text laid out on the morph path, a
filled vector mask, and a glyph view of the flow field. Base is
the actually-shipped v1.37.0. With all new keys at their
defaults the render is bit-identical to v1.37.0 (verified on
the iMac real-GPU gate: FROZEN deterministic render, all 12
frames at 0.00000). 10 new config keys (1,109 total), starters
+2 (539 total).

### Added
- **Sweep / Loft section profile** (`gpgpuSmoothTubeSectionShape`
  / `SectionSides` / `SectionInnerRatio`, pure ring generation
  in `lib/tubeSectionProfile.ts`): the Smooth Tube's swept ring
  can be a circle with a chosen vertex count, a polygon, or a
  star (alternating inner radius). 'circle' with 6 sides is the
  legacy ring, bit-identical; the length profile stays with the
  existing tube taper.
- **Text on path** (`gpgpuMorphTextOnPathEnabled` / `Delay` /
  `Size`, layout in `lib/gpgpuTextOnPath.ts`): with the svg
  morph target in 'along' or 'writeOn' path mode, the layer-2
  TextMap string is laid out glyph by glyph along the authored
  path — each character's luma raster becomes a particle block
  centred on the path. Delay staggers the glyphs' arc-length
  slots (virtual-slot layout; gap particles keep the plain path
  placement), so a write-on window sweep reveals the characters
  one by one. Deterministic for a given seed.
- **Vector mask fill** (source suffixes `path-raster:fill-evenodd`
  / `path-raster:fill-nonzero` on the Phase AF path supply, in
  `lib/mapSourceSupply.ts`): the authored SVG's closed subpaths
  are filled by the SVG fill rules and composited with the
  stroke, so the path supply works as a filled vector mask for
  every map / mask consumer. The stroke radius is now the key
  `gpgpuPathRasterStrokeWidth` (default 0.045, the Phase AF
  fixed convention — existing renders unchanged).
- **Flow-field glyphs** (`gpgpuFieldGlyphEnabled` / `Grid` /
  `Length`): the curl field drawn as line glyphs on a z = 0
  grid inside the bounce radius — direction follows the field,
  length scales with its strength. The overlay's vertex shader
  reuses the velocity shader's curl GLSL chunk verbatim and
  shares the simulation clock, so the glyphs show the field
  the particles actually feel; TS twins of the field live in
  `lib/fieldGlyphSampling.ts`. Display only.

## [1.37.0] — 2026-11-17

Phase AF (fifth period, fifth phase): paths, text and masks,
wired together — the shapes the app already authors become
sources for the consumers that already read maps. No new
generator is added; the phase is wiring, following the Phase AE
sentinel-supply pattern. Base is the actually-shipped v1.36.0.
With all new keys at their defaults the render is bit-identical
to v1.36.0 (verified on the iMac real-GPU gate: FROZEN
deterministic render, all 12 frames at 0.00000). 2 new config
keys (1,099 total), starters +2 (537 total).

### Added
- **Text raster supply** (`text-raster` sentinel,
  `lib/mapSourceSupply.ts`): the current layer-2 TextMap text
  and font settings — the same raster the 'text' morph target
  bakes — can be assigned to any Layer Map or to the raster /
  kill mask. The supply tracks text edits live; the mask block
  also captures the numeric luma grid at assignment time for
  the bake / placement consumers.
- **Path raster supply** (`path-raster` sentinel): the authored
  SVG path geometry (gpgpuMorphSvgSource, normalised cloud
  space) is rasterised by a pure distance-field function —
  same SVG in, bit-identical grid out — and supplied the same
  way, independent of the morph target / path mode selection.
  The captured numeric grid also feeds the morph bake and
  placement, so the path doubles as a placement density source.
- **Edge output supply** (`edge-output` sentinel): a new
  pass-through capture stage (components/edgeCapturePass.ts,
  active only while some source requests it, last in every
  stack profile) copies the finished frame's Sobel field into
  a persistent target that the map / mask consumers sample.
  Display and supply are independent — the edge display need
  not be on, and supplying edges changes no pixel. Consumers
  read the previous frame's field (one frame of lag); the
  field has no numeric bake grid, so the bake / placement
  consumers keep their legacy behaviour for this source.
- **Feedback mask** (`postFeedbackMaskEnabled`,
  `postFeedbackMaskStrength`): the raster mask source — image,
  terrain-derived, text, path or edge — modulates the feedback
  decay spatially (white mask = full decay). An unready source
  leaves the decay unmodulated.

## [1.36.0] — 2026-11-17

Phase AE (fifth period, fourth phase): terrain, put to work —
the height field stops being only a surface and becomes a
source of derived information. Base is the actually-shipped
v1.35.0. With all new keys at their defaults the render is
bit-identical to v1.35.0 (verified on the iMac real-GPU gate:
FROZEN deterministic render, all 12 frames at 0.00000). 2 new
config keys (1,097 total), starters +2 (535 total).

### Added
- **Terrain derived maps** (`lib/terrainDerivedMaps.ts`): the
  terrain field is sampled on the mesh's own vertex grid and
  differentiated once, deterministically — a normal map, a
  slope map (gradient magnitude normalised by the field's own
  maximum) and a curvature map (signed Laplacian, mid grey =
  flat). The same terrain parameters bake bit-identically.
  Each map can be exported as a PNG from the Terrain section,
  and can be assigned to any Layer Map or to the raster / kill
  mask through an internal supply (a sentinel source that
  resolves to the live bake and tracks the terrain parameters
  — no image file round-trip).
- **Terrain slope force** (`gpgpuSlopeForceEnabled`,
  `gpgpuSlopeForceStrength`): particles flow downhill along
  the derived gradient bake, proportional to the local slope.
  Resolved CPU-side like the kill mask: the force exists only
  while the terrain mesh is enabled in plane mode. On the
  WebGPU path the feature is declared in the capability
  registry (`slope-force`) and routes to WebGL instead of
  silently dropping the effect.

## [1.35.0] — 2026-11-17

Phase AD (fifth period, third phase): 2D post & sprites —
flipbook sprite sheets, the print-style tonal post trio
(posterize / ordered dither / halftone), a Sobel edge pass, an
image-driven displace pass, and parameterized texture-pack
noise. Base is the actually-shipped v1.34.0. With all new keys
at their defaults the render is bit-identical to v1.34.0
(verified on the iMac real-GPU gate: FROZEN deterministic
render, all 12 frames at 0.00000). 21 new config keys (1,095
total), starters +2 (533 total).

### Added
- **Flipbook sprite sheets** (`gpgpuSpriteSheetCols/Rows`,
  `gpgpuSpriteFrameMode`, `gpgpuSpriteFrameFps`,
  `gpgpuSpriteLoop`; `lib/spriteSheet.ts`): the sprite image
  can be a cols x rows sheet; the frame advances by normalised
  age, by a fixed fps clock, or sits fixed per particle seed.
  At 1x1 the UV remap is the exact identity, so existing
  single-image sprites are bit-identical.
- **Posterize / Ordered Dither / Halftone post stages**
  (`postPosterize*`, `postDither*`, `postHalftone*`;
  `lib/postFxMath.ts` CPU twins): print-style tonal finishes
  in the post stack, after feedback and before output grade.
- **Edge Detect post stage** (`postEdge*`): Sobel gradient
  with a threshold and overlay / edge-only modes — the entry
  point to outline extraction (vectorising is Phase AF).
- **Displace post stage** (`postDisplace*`): the gradient
  image warps the frame (channel pair selectable, red/green
  by default), placed before feedback so feedback smears the
  displaced frame. No image ready = exact pass-through.
- **Parameterized texture-pack noise** (`textureNoiseKind`,
  `textureNoisePeriod`, `textureNoiseOctaves`): the cloud
  noise tile gains kind (value / ridge / turbulence), period
  and octave controls. The defaults reproduce the pre-AD map
  bit-for-bit.

## [1.34.0] — 2026-11-17

Phase AC (fifth period, second phase): the signal & time grammar —
an internal noise channel, per-route lag, envelope sources, the
age curves aimed at the simulation itself, and a keyed curl
evolution speed. Base is the actually-shipped v1.33.0. With all
new keys and routes at their defaults the render is bit-identical
to v1.33.0 (verified on the iMac real-GPU gate: FROZEN
deterministic render, all 12 frames at 0.00000). 7 new config
keys (1,074 total), starters +2 (531 total).

### Added
- **Internal noise channel** (modulation source `vnoise`;
  `lib/modulation.ts`): a deterministic 1D value-noise fBm
  (seed / rate / octaves on the source itself), a pure function
  of (seed, time) so deterministic renders reproduce it exactly.
  Distinct from the external Noise app link, which is untouched.
- **Lag / smoothing** (route `lag`, seconds): a first-order lag
  on any modulation route. State initialises to the first sampled
  input and re-initialises when time runs backwards, so the
  output is a pure function of the (time, input) sequence since
  then. Lag 0 (default) bypasses the filter entirely.
- **Envelope sources** (modulation source `envelope`): the
  audioPulse idea generalised — attack/decay one-shots fired by
  a manual Trigger button, the audio pulse band's rising edge,
  or any MIDI note-on (hooked into the existing note-on path).
- **Age curves for the simulation** (`gpgpuAgeCurveVelocity*` /
  `gpgpuAgeCurveForce*` / `gpgpuAgeCurveRotation*`, same
  Enabled+Points grammar as Size/Opacity): Velocity multiplies
  the final velocity, Force multiplies the built-in force
  accumulation only (gravity…morph; collisions, mouse, paint,
  floor, fluid and custom force stay unscaled), Rotation
  multiplies the geometry spin rate via the curve's closed-form
  integral (`integrateAgeCurve`, TS/GLSL twins). A flat curve is
  suppressed in the passes, so enabling one still runs the exact
  legacy path. The WebGPU registry declares `age-curve-sim` for
  the two sim curves; the Aux chain shaders are out of scope, as
  with Phase AB's keys.
- **Curl evolution speed** (`gpgpuCurlSpeed`, default 1.0): the
  curl field's time offset is keyed; ×1.0 is an exact IEEE
  identity and 0 freezes the field. Declared as `curl-speed` to
  the WebGPU registry when non-default.
- **Starters +2**: AgeCurve Velocity Fade and Curl Slow
  Evolution; the modulation starter set gains an internal-noise
  route (presets cannot carry modulation setups).

## [1.33.0] — 2026-11-17

Phase AB (fifth period, first phase): the lifecycle grammar —
spawn / kill / global drag & max speed — plus obstacle avoidance
and SPH surface tension. Base is the actually-shipped v1.32.0.
With all new keys at their defaults the render is bit-identical
to v1.32.0 (verified on the iMac real-GPU gate: FROZEN
deterministic render, all 12 frames at 0.00000). 8 new config
keys (1,067 total), starters +2 (529 total).

### Added
- **Spawn gate** (`gpgpuSpawnBurst` / `gpgpuSpawnRate`;
  `lib/gpgpuLifecycle.ts` + GLSL twins in both sim passes): the
  fixed pool no longer has to start whole. Burst is the fraction
  live at t = 0; the remainder is released linearly at Rate
  (pool fraction per second) under a deterministic per-particle
  hash, so deterministic renders reproduce the release exactly.
  Unreleased particles are parked off-screen with zero velocity
  and frozen age; the release frame respawns them through the
  shared respawn block.
- **Birth Burst aux event** (`gpgpuAuxMode` / `gpgpuAux2Mode`
  gain `birthBurst`): a main (or aux) particle that (re)spawned
  on the previous frame — age wrap, spawn-gate activation or a
  kill — emits a gentle burst at its new position. The three
  existing event modes are byte-untouched.
- **Kill conditions** (`gpgpuKillBoundary` / `gpgpuKillMask`):
  a particle that leaves the bounce sphere, or sits in a
  rejected raster-mask region (the Phase X mask, evaluated with
  the draw clip's own UV rule, threshold and invert keys),
  respawns immediately instead of bouncing / living on.
- **Global drag & max speed** (`gpgpuDrag` / `gpgpuMaxSpeed`):
  the Particle Life block's semantics promoted to the whole
  pool. Drag is the rate of the global damping factor
  (1 − rate × dt); the default 1.1 is the legacy fixed damping,
  value for value. Max speed (0 = off) clamps after the legacy
  350 hard clamp, before damping.
- **Obstacle avoidance** (`gpgpuParticleLifeAvoid`;
  `lib/particleLifeBehavior.ts` + GLSL twin): the third Steering
  term — a push along the SDF collider's normal, quadratic in
  the proximity inside the vision range, so swarms bend around
  an obstacle before contact. Completes the Steering set
  (pursue / evade / avoid).
- **SPH surface tension** (`gpgpuSphSurfaceTension`): a cohesion
  term in the SPH force sum — neighbours pull the particle
  toward themselves with the kernel weight, so droplets hold
  together. This is a cohesion APPROXIMATION, not a full
  surface-tension model.

### Notes
- The new lifecycle features live in the WebGL passes. On the
  WebGPU path they are declared in the capability registry
  (spawn-gate / kill-conditions / global-velocity-limit /
  particle-life-avoid / sph-surface-tension), so a config using
  them routes to WebGL instead of silently losing the effect.
  The mask kill also stays off in the replica-stack path (no
  mask texture is threaded there) and on the CPU fallback.

## [1.32.0] — 2026-11-17

Phase AA (fourth period, final phase): behaviour semantics and
dedicated Form deformation, plus path stamping and the OBJ
repetition grammar. Base is the actually-shipped v1.31.0. With
all new keys at their defaults the render is bit-identical to
v1.31.0 (verified on the iMac real-GPU gate: FROZEN
deterministic render, all 12 frames at 0.00000). 22 new config
keys (1,059 total), starters +5 (527 total).

### Added
- **Particle Life behaviour** (`gpgpuParticleLifePursue` /
  `Evade` / `VisionRange` / `VisionAngle` / `MaxSpeed` /
  `MeanderAmount` / `MeanderScale`, 7 new keys;
  `lib/particleLifeBehavior.ts` + GLSL twin): a cyclic predator
  chain over the species — species i pursues species (i+1) mod n
  and evades species (i-1) mod n — as an additive term on top of
  the existing interaction matrix (the matrix itself is
  unchanged). Behaviour targets are gated by vision (range +
  cone around the velocity direction), the velocity inside the
  Particle Life block can be capped, and Meander is a
  per-particle wander (own phase per particle), not a global
  modulation.
- **Form-dedicated deformation** (`gpgpuMorphDisperse*` /
  `Twist*` / `Fractal*`, 7 new keys;
  `lib/formDeformation.ts`): Disperse (per-point loosening,
  radial or axial), Twist (rotation around an axis proportional
  to the coordinate along it) and Fractal Field (seeded fBm
  displacement with an evolution offset) applied to the baked
  base form before the replica grammar — a dedicated placement
  grammar, separate from the Flow / Vortex motion systems.
- **Path stamping** (path mode `stamp` + `gpgpuMorphStamp*`,
  4 new keys; `lib/stampPlacement.ts`): shapes (disc / ring /
  star / diamond / imported-OBJ point cloud) stamped at equal
  arc-length intervals along the authored SVG path, optionally
  aligned to the path tangent.
- **Smooth Tube taper** (`gpgpuSmoothTubeTaper`, 1 new key;
  `lib/smoothTubeProfile.ts`): the history tube's cross-section
  thins toward the oldest ring; 0 keeps the constant radius.
- **OBJ repetition grammar** (`gpgpuObjMeshRepeatMode` /
  `RepeatRotation` / `RepeatScaleStep`, 3 new keys;
  `lib/objMesh.ts`): the OBJ mesh repetition gains a radial
  layout and the replica-style per-copy chain (rotation step ×
  i, scale step ^ i). Grid / 0 / 1 reproduces the Phase V layout
  exactly.
- Starters +5 (527 total): predator chase, meander swarm, twist
  knot form, star stamps, OBJ radial chain.

### Honest limits
- The pursue / evade chain is cyclic and fixed (i → i+1); there
  is no free per-pair behaviour matrix, and the max speed is a
  single key rather than per-species values.
- The behaviour terms run on the WebGL velocity pass; the
  WebGPU and CPU sub-paths keep the matrix-only behaviour
  (the same sub-path convention as earlier phases).
- Stamp shapes live in the path plane (the OBJ stamp keeps its
  sampled depth); stamps are a bake-time placement, not a
  live geometry instancer.
- The radial OBJ layout is a single ring; per-copy transforms
  are translation + Y rotation + uniform scale only.

## [1.31.0] — 2026-11-17

Phase Z (fourth period): shadows and smoke — an occlusion-map
shadow approximation and fog self-shadowing. With the defaults
off (and strength / self-shadow at 0) the render is
bit-identical to v1.30.0 (verified on the iMac real-GPU gate:
FROZEN deterministic render, all 12 frames at 0.00000).

### Added
- **Shadow (occlusion-map approximation)** (`gpgpuShadow*`, 5
  new keys): occlusion toward the Phase T 3D light is baked
  from the terrain height field (horizon march) and the OBJ
  mesh (bounding-sphere approximation) into a deterministic
  64x64 grid (`lib/shadowOcclusion.ts`), and the SAME bake
  attenuates three receivers — GPGPU points (vertex sample,
  height-attenuated), the terrain mesh (per-vertex colours),
  and the Phase Y light volume (fragment sample). Strength and
  softness are keyed; each occluder can be toggled. Labelled
  honestly in the UI as シャドウ（遮蔽マップ近似）— this is
  NOT a full shadow map.
- **Fog self-shadow** (`gpgpuFogSelfShadow` /
  `gpgpuFogShadowSteps`, 2 new keys): each volumetric smoke
  sample is attenuated by the density integrated from the
  sample toward the light (secondary march, keyed 1–16 steps),
  so the far side of a smoke sphere sinks while the lit side
  stays bright. Strength 0 skips the march entirely.
- Starters +2 (522 total): a terrain-occlusion shadow example
  and a self-shadowed fog example.

### Honest limits
- Occlusion casters are only the terrain height field and the
  OBJ bounding sphere; particles and volumes receive but never
  cast. The bake covers the terrain mesh's XZ footprint at
  64x64; tunnel-mode terrain does not receive (no single light
  horizon in the wrapped frame). Occlusion applies only
  against the Phase T light object, never the fixed-direction
  lights.
- Flame colour / temperature remain out of scope by design
  (monochrome policy) — the smoke row of the Maxon audit keeps
  that as a stated reason.

## [1.30.0] — 2026-11-17

Phase Y (fourth period): visible light — a volumetric beam for
the Phase T 3D light (Lux) and a ribbon along the light's
trajectory (Tao light-trajectory path). Both are draw-only and
mount only when enabled, so with the defaults off the render is
bit-identical to v1.29.0 (verified on the iMac real-GPU gate:
FROZEN deterministic render, all 12 frames at 0.00000).

### Added
- **Volumetric light cone / sphere** (`gpgpuLightVolume*`, 7 new
  keys): a dedicated mesh at the 3D light's position, shaded by
  accumulating an analytic density over a keyed number of axial
  steps (1–32, smoothness vs cost) — the beam is visible in
  empty space, follows the light's direction key (cone) and
  reads the light's position live. Sphere shape gives a point
  glow volume with the volume length as its radius.
- **Light trail ribbon** (`gpgpuLightTrail*`, 3 new keys): the
  light's per-frame position history is resampled by arc length
  through the Phase S path basis (chord table + taper) into a
  fading ribbon — width and fade are keyed. Pure and
  deterministic: the same history rebuilds bit-identically.
- Starters +2 (520 total): a volumetric cone example and a
  light-trail ribbon example.

### Honest limits
- The volume does **not** intersect scene depth: there is no
  occlusion or shadowing, and edges are softened by the
  softness key instead of a depth fade. The UI says so next to
  the controls.
- The trail ribbon is planar (built in the XY plane the camera
  faces; a purely vertical, XY-degenerate history draws
  nothing) and has no tube cross-section.
- The volume/trail draw does not affect particles — particle
  lighting remains Phase T's brightness multiplier.

## [1.29.0] — 2026-11-17

Phase X3 (fourth period, leftover #3): the WebGPU compute path
gains the WebGL force set it was missing. Every port is a verbatim
force law from the WebGL velocity/position shaders, gated exactly
like the WebGL branch, and closed inside the WebGPU path — the
WebGL path is untouched (its frozen deterministic renders stay
bit-identical). Configs whose features remain WebGL-only now route
to WebGL through the capability registry instead of silently
losing the effect.

### Added
- **OBJ normal initial velocity on the WebGPU path** (Phase O
  parity, the mandatory item of leftover #3): the WGSL velocity
  pass reads the baked companion normal cloud (a storage buffer
  fed by the same bake as the target cloud, refreshed on every
  re-bake) and applies the same emission-style kick — velocity
  mixed toward the sample normal (rotated by the morph orbit
  angle) under an exp(-t · 4.5) envelope from the last (re)bake or
  speed-key change. The WebGL shader's second trigger (full
  strength on the age-respawn frame) cannot fire here because the
  age lifecycle itself stays WebGL-only; with age off — the only
  configs that reach this path — the semantics are identical.
- **The remaining WebGL forces on the WebGPU path**: audio blast,
  N-body, curl (field symmetry, octaves, ridged/vortex modes),
  boids, strange attractors (all 12 types), Lévy flight, vortex,
  wind, gravity wells (single + ring), elastic, magnetic, SPH,
  vector fields (all 7 types), spring to spawn position (backed
  by an initial-position buffer), SDF collider (velocity
  reflection + position push-out, all 5 shapes), floor bounce,
  mouse force including pointer paint (velocity re-seed +
  position teleport under the shared paint gate), Kuramoto phase
  synchronisation (the phase now travels in the velocity buffer's
  w channel, as in WebGL), Particle Life (species matrix as a
  storage buffer), and the Verlet integrator (frame-start
  positions snapshotted into a previous-position buffer before
  the position pass, mirroring the WebGL blit pass).

### Fixed
- **Capability registry inventory** (silent-drop class of bug):
  Kuramoto, Particle Life, Lévy flight, floor bounce, user custom
  forces and the Aux event pools exist in the WebGL shaders but
  were never listed as requested features, so WebGPU-preferred
  configs using them lost the effect without any fallback or
  notice. They are now declared: the four portable ones are
  implemented (above), while custom force (user GLSL cannot be
  compiled to WGSL) and Aux (WebGL FBO passes) are declared
  unsupported and route to WebGL.

### Remaining WebGL-only (declared, not silent)
- Age lifecycle (advance + respawn re-emission), the fluid field
  (its solver is a WebGL FBO advection pass), user GLSL custom
  forces, the Aux event pools, and the Phase W2 replica
  independent simulation. The capability registry reports each of
  these as unsupported, so such configs run on WebGL with the
  effect intact.

## [1.28.0] — 2026-11-17

Phase X2 (fourth period, leftover #4): the CPU fallback renderer
gains the three GPGPU behaviours Phase R left unported, each with
the WebGL path's semantics. The WebGL path is untouched (its frozen
deterministic renders stay bit-identical), and every addition is
inert unless the corresponding feature is enabled.

### Added
- **OBJ normal initial velocity on the CPU path** (Phase O parity):
  the CPU morph bake now also produces the companion normal cloud,
  and the CPU step applies the same emission-style kick as the
  velocity shader — velocity mixed toward the particle's baked
  sample normal (rotated by the morph orbit angle) under an
  exp(-t · 4.5) envelope from (re)placement or the last speed-key
  change, at full strength on the age-respawn frame. Speed 0 (the
  default) skips the kick entirely.
- **Morph attraction inside attractor mode on the CPU path**: the
  attractor branch of the CPU step now composes the morph
  relaxation (and the normal kick) after the attractor force, in
  attractor units, against the start-of-step position — the same
  composition the velocity shader performs in one pass. Previously
  the CPU attractor mode ignored morph entirely.
- **Age lifecycle and replica age phase on the CPU path** (Phase M
  parity): the CPU sim now tracks per-particle age while the Life
  system is on — seeded scatter identical in form to the WebGL
  initial data, replica-block phase offsets applied both at seed
  time and at every lifecycle wrap, respawn at the layout home
  (the CPU emitter analogue), and the points shader's fade-in/out
  envelope applied to the CPU scene's per-particle alpha, so
  replicas pulse with their phase separation on the fallback path
  too. With the age system off, the CPU step is operation-for-
  operation the legacy computation.

## [1.27.1] — 2026-11-17

Phase X1 (fourth period, leftover #7): deterministic renders of
free-flight GPGPU subjects (notably with Aux deathBurst) could
diverge slightly between independent sessions of the same bundle.
Two setup races at the start of a deterministic job caused it, and
both are now closed to the job path; live playback is untouched.

### Fixed
- **One-step-ahead simulation**: the freshly remounted GPGPU system
  could receive one stray live frame during job setup (a pending
  RAF / the frameloop change landing after it subscribed). Its
  delta, seconds long after the setup stall, clamps to 0.05 — exactly
  one job step — so the whole export ran one step ahead in roughly
  one session in six. While a job is active, the render manager now
  marks job activity and feeds a step index before every legitimate
  advance (`lib/sceneRotationDeterminism.ts`); the GPGPU system
  skips any frame that arrives while a job is active but no step is
  fed.
- **One-frame rotation shift**: SceneGroup accumulates the auto
  rotation per useFrame call, and whether the remounted group fired
  on the first stepped frame raced the remount, shifting some
  exports by exactly one frame of rotationSpeed. During a job the
  group now derives the accumulated rotation from the fed step index
  (speed x (step + 1); the +1 is the group's mount frame, matching
  the unshifted exports bit-for-bit).

### Verification
- AUX identity subject (free flight + deathBurst): 12 independent
  sessions now render bit-identical on all frames (was: divergence
  classes at 0.00513 / 0.02582 mean-abs-diff). The fixed output is
  bit-identical to the pre-fix unshifted class, so Aux statistics
  are unchanged by construction. FROZEN identity vs v1.26.0 stays
  0.00000; aux chain (W1) and replica independent sim (W2) subjects
  stay bit-identical across sessions. No config keys added.

## [1.27.0] — 2026-11-17

Phase X (fourth period, first phase): Layer Maps go per-property
and a raster mask grammar is added. Defaults reproduce v1.26.0
bit-for-bit (identity gate: 0.00000 over all frames).

### Added
- **Per-property Layer Map sources** (4 new string keys, default
  ''): `gpgpuMapSizeSource` / `gpgpuMapOpacitySource` /
  `gpgpuMapColorSource` / `gpgpuMapDisplaceSource`. A set source
  replaces the common gradient image for that property only; an
  unset property falls back to the common map, so the Phase U
  single-map configuration keeps its exact meaning. The colour
  source becomes the 'image' gradient driver's input. Textures
  are held in a new multi-source cache (lib/mapImageTexture.ts);
  unused maps are never bound.
- **Displacement map** (`gpgpuMapDisplaceAmount`, 0..1, default
  0): the displacement map's luminance offsets the drawn point
  radially by (luma - 0.5) * amount * bounceRadius in the draw
  vertex shader — the map-space twin of the media relief the bake
  applies to text/image targets.
- **Raster mask** (`gpgpuMaskSource` string, `gpgpuMaskMode`
  'off'|'clip'|'shape' default 'off', `gpgpuMaskThreshold` default
  0.5, `gpgpuMaskInvert` default false, plus the derived numeric
  luma map `gpgpuMaskMap` / `gpgpuMaskMapWidth` /
  `gpgpuMaskMapHeight` captured at import time, following the
  layer2MediaLumaMap precedent). 'shape' draws morph placement
  from the mask image itself by seeded acceptance sampling
  (probability = luminance); 'clip' relocates baked points in
  rejected regions into the mask and the draw fragment shader
  discards live positions in rejected regions. The same mask
  filters the layer media placement with the same meaning.
  Shape baking is deterministic (seeded; re-bakes bit-identical).
- Starters +2 (516 -> 518): per-property maps (radial blob for
  size, star for opacity, blob displacement) and a ring raster
  mask in shape mode.

### Honest limits
- Maps are consumed as luminance only (monochrome rule); the
  colour map feeds the image driver's luminance-driven paths via
  the driver input, it does not tint by hue.
- The mask's fragment clip needs the mask image itself
  (gpgpuMaskSource); a preset carrying only the numeric map gets
  bake + media placement but no fragment clip (the UI says so).
- Aux pools, streaks, trails and geometry modes draw through
  their own shaders and do not apply the per-property maps or the
  mask, as with the Phase U maps before them.

## [1.26.0] — 2026-11-17

Phase W2 (second half of the user-elected full Phase W): per-replica
independent simulation. Method **(a) state separation** was adopted
after a measured micro-benchmark on the iMac's real GPU (see
PHASE_W2_REPORT.md): with 8 full-size replica stacks the velocity +
position passes still hold 60 fps under rAF pacing (burst throughput
~140–216 steps/s at 256² texels per stack), and the extra render-
target memory is ~32 MB at the default texture size (~128 MB at the
512² maximum) — both inside the brief's criteria, so the cheaper
force-only divergence (b) was not needed.

### Added
- **Replica independent sim** (2 new keys, defaults reproduce the
  legacy shared simulation bit-for-bit): `gpgpuMorphReplicaIndependent`
  (boolean, default false) and `gpgpuMorphReplicaDivergence`
  (0..1, default 1). With the key on (morph on, replica count > 1),
  each replica block runs its own simulation stack — its own
  position/velocity state textures, Verlet history, and pass
  materials — seeded from the same initial data, then merged back
  into the shared texture layout every frame, so drawing, trails,
  aux pools (including the W1 chain), depth sort and readback all
  work unchanged on the merged state.
- Divergence scales the per-copy field seed offset and clock offset
  (copy 0 is always exactly zero). At divergence 0 every copy runs
  the same field realization on the same clock as the shared sim;
  at 1 the copies fully decorrelate under curl/turbulence/wind.
- Starters +2 (514 -> 516): three trefoil copies at one anchor
  drifting apart under curl at full divergence, and a four-copy
  spaced chain at intermediate divergence (0.45).

### Honest limits of the independent mode
- Neighbour forces (N-body, boids, SPH, particle life, Kuramoto)
  sample the copy's own stack while the mode is on: interactions
  are confined to each copy instead of spanning the whole cloud.
  This is inherent to state separation, not an approximation.
- The WebGPU compute path and the CPU fallback do not implement
  the independent sim (the key is ignored there, the same class of
  limitation as the Phase R WGSL omissions); while the mode is on,
  the frame runs on the WebGL path.
- A custom force shader swapped into the shared velocity material
  at runtime is not mirrored into the per-copy materials.
- Divergence changes apply live (no reseed); the per-copy initial
  data is always the shared initial layout's own block, identical
  to what the shared sim starts from.

## [1.25.0] — 2026-11-17

Phase W1 (first half of the user-elected full Phase W): grandchild
emitters — the Aux event pool chains into a second (and third) aux
pool, so a child's own events spawn grandchildren.

### Added
- **Aux chain** (10 new keys, all default-off / identity):
  `gpgpuAuxDepth` (1..3, default 1 = the legacy single pool) and
  the shared level->=2 parameter set `gpgpuAux2Mode` ('none'
  default / 'deathBurst' / 'bounceSplash' / 'sparkTrail'),
  `gpgpuAux2Intensity`, `gpgpuAux2Life`, `gpgpuAux2Speed`,
  `gpgpuAux2Size`, `gpgpuAux2GravityScale`, `gpgpuAux2Drag`,
  `gpgpuAux2Curl`, `gpgpuAux2Color` ('' = inherit the child's
  resolved colour). Level 3 re-applies the level-2 settings
  recursively — there is no third key family. Depth is capped at
  3 by design (each level costs a full 128x128 texture quad plus
  a draw); the UI states the cap honestly as 最大3段.
- Each chain level is the same GPU-closed two-pass pool machinery
  (`components/gpgpuShaderAux.ts` chain shaders) reading the
  previous level's frame-start textures, with per-level hash salts
  so sibling levels do not roll identical gates. Because an aux
  source carries its own life per particle, chain deathBurst
  fires on the frame the source's age crosses its own life.
  Chain pools are allocated only while the depth reaches them;
  at the defaults nothing is allocated, run, or drawn, and the
  legacy level-1 shaders are byte-untouched, so depth-1 output
  is bit-identical to v1.24.0. Pure chain resolution (active
  levels, colour inheritance, event predicates) lives in
  `lib/auxChain.ts`.
- Starters +2 (512 -> 514): two-stage death-burst chain and
  three-stage cascade, both monochrome.

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
