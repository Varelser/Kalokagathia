export interface ParticleConfigGpgpu {
  gpgpuEnabled: boolean;
  gpgpuCount: number;
  gpgpuGravity: number;
  gpgpuTurbulence: number;
  gpgpuBounce: number;
  gpgpuBounceRadius: number;
  gpgpuSeed: number;
  gpgpuCustomForceEnabled: boolean;
  gpgpuCustomForceCode: string;
  gpgpuSize: number;
  gpgpuSpeed: number;
  gpgpuColor: string;
  gpgpuOpacity: number;
  gpgpuAudioReactive: boolean;
  gpgpuAudioBlast: number;
  // Trail
  gpgpuTrailEnabled: boolean;
  gpgpuTrailLength: number;
  gpgpuTrailFade: number;
  gpgpuTrailVelocityScale: number;
  // Instanced Geometry
  gpgpuGeomMode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone';
  gpgpuGeomVelocityAlign: boolean;
  gpgpuGeomScale: number;
  // Geometry material extras (Kinetix integration B1b): procedural
  // environment reflection approximation for the crystal look (no PMREM),
  // per-instance self-rotation, and velocity stretch (meshStretch).
  // All default to 0 = legacy geometry behaviour.
  gpgpuGeomEnvReflect: number;
  gpgpuGeomSpinSpeed: number;
  gpgpuGeomStretch: number;
  // Point sprite shape (Kinetix integration B1b): 'soft' keeps the legacy
  // gaussian disc; the other values select the shared SDF/mask shape set
  // that the layer point shader also exposes via sdfShape.
  gpgpuPointShape: 'soft' | 'sphere' | 'ring' | 'star' | 'hexagon' | 'diamond' | 'flare' | 'cloud' | 'bokeh' | 'crosshair' | 'iris' | 'lightning';
  // N-Body
  gpgpuNBodyEnabled: boolean;
  gpgpuNBodyStrength: number;
  gpgpuNBodyRepulsion: number;
  gpgpuNBodySoftening: number;
  gpgpuNBodySampleCount: number;
  // Velocity color gradient
  gpgpuVelColorEnabled: boolean;
  gpgpuVelColorHueMin: number;
  gpgpuVelColorHueMax: number;
  gpgpuVelColorSaturation: number;
  // Life/Age
  gpgpuAgeEnabled: boolean;
  gpgpuAgeMax: number;
  gpgpuAgeFadeIn: number;
  gpgpuAgeFadeOut: number;
  // Lifecycle grammar (Phase AB, lib/gpgpuLifecycle.ts): the spawn
  // gate meters how the fixed pool joins the simulation — burst is
  // the fraction live at t = 0, rate releases the remainder
  // (pool fraction per second). Burst 1 (default) disables the
  // gate entirely. The kill conditions respawn a particle
  // immediately when it leaves the bounce sphere (boundary) or
  // sits in a rejected raster-mask region (mask, the Phase X mask
  // keys below, evaluated with the draw clip's rule); both default
  // OFF. The global drag is the rate of the pool-wide damping
  // factor (1 - rate * dt) — default 1.1 is the legacy fixed
  // damping, bit-identical — and the global max speed (0 = off)
  // promotes the Particle Life cap semantics to the whole pool.
  gpgpuSpawnRate: number;
  gpgpuSpawnBurst: number;
  gpgpuKillBoundary: boolean;
  gpgpuKillMask: boolean;
  gpgpuDrag: number;
  gpgpuMaxSpeed: number;
  // Curl Noise
  gpgpuCurlEnabled: boolean;
  gpgpuCurlStrength: number;
  gpgpuCurlScale: number;
  // Curl field symmetry (Kinetix integration B1b): folds the field
  // sampling coordinates before the curl is evaluated (Kinetix
  // sampleSymmetricCurl). 'none' (default) samples exactly as before.
  gpgpuCurlSymmetry: 'none' | 'mirrorX' | 'radial4' | 'radial6' | 'octahedral';
  // Curl field flavour + octave composition (Kinetix integration B3):
  // 'curl' with 1 octave is the exact legacy field. 'ridged' applies
  // Kinetix's per-component ridge shaping to the curl vector, 'vortex'
  // adds a tangential swirl around Y (Kinetix computeCurlNoise modes).
  // Octaves 2/3 add the 2.13x / 4.27x curl octaves at 0.45 / 0.22 gain,
  // mirroring Kinetix's sampleCurlOctave composition.
  gpgpuCurlMode: 'curl' | 'ridged' | 'vortex';
  gpgpuCurlOctaves: number;
  // Curl field evolution speed (Phase AC): multiplies the field's
  // time offset. 1 (default) is the legacy evolution rate exactly
  // (×1.0 is an IEEE identity); 0 freezes the field in time.
  gpgpuCurlSpeed: number;
  // Boids
  gpgpuBoidsEnabled: boolean;
  gpgpuBoidsSeparation: number;
  gpgpuBoidsAlignment: number;
  gpgpuBoidsCohesion: number;
  gpgpuBoidsRadius: number;
  // Strange Attractor
  gpgpuAttractorEnabled: boolean;
  gpgpuAttractorType: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda' | 'chua';
  gpgpuAttractorStrength: number;
  gpgpuAttractorScale: number;
  // Vortex
  gpgpuVortexEnabled: boolean;
  gpgpuVortexStrength: number;
  gpgpuVortexTilt: number;
  // Wind
  gpgpuWindEnabled: boolean;
  gpgpuWindStrength: number;
  gpgpuWindX: number;
  gpgpuWindY: number;
  gpgpuWindZ: number;
  gpgpuWindGust: number;
  // Gravity Well
  gpgpuWellEnabled: boolean;
  gpgpuWellStrength: number;
  gpgpuWellSoftening: number;
  gpgpuWellOrbit: number;
  // Multiple wells (Kinetix integration B3, Kinetix attractorCount):
  // count 1 (default) is the exact legacy single well at the origin.
  // Counts 2-4 place that many wells on a slowly rotating ring of
  // radius gpgpuWellSpread, each with the same strength/softening and
  // tangential orbit term as the single well.
  gpgpuWellCount: number;
  gpgpuWellSpread: number;
  // Elastic Spring
  gpgpuElasticEnabled: boolean;
  gpgpuElasticStrength: number;
  // Magnetic (Lorentz)
  gpgpuMagneticEnabled: boolean;
  gpgpuMagneticStrength: number;
  gpgpuMagneticBX: number;
  gpgpuMagneticBY: number;
  gpgpuMagneticBZ: number;
  // SPH Fluid
  gpgpuSphEnabled: boolean;
  gpgpuSphPressure: number;
  gpgpuSphViscosity: number;
  gpgpuSphRadius: number;
  gpgpuSphRestDensity: number;
  // Surface tension (Phase AB): a cohesion term in the SPH force
  // sum — neighbours pull the particle toward themselves with the
  // kernel weight, so a droplet holds together. An approximation
  // (no curvature model); 0 (default) = off, legacy SPH.
  gpgpuSphSurfaceTension: number;
  // Vector Field
  gpgpuVFieldEnabled: boolean;
  gpgpuVFieldType: 'dipole' | 'saddle' | 'spiral' | 'source' | 'abc' | 'gyre' | 'worley';
  gpgpuVFieldStrength: number;
  gpgpuVFieldScale: number;
  // Lévy flight (rare heavy-tailed impulses)
  gpgpuLevyEnabled: boolean;
  gpgpuLevyStrength: number;
  gpgpuLevyRate: number;
  // Kuramoto phase synchronization (phase lives in velocity texture .w)
  gpgpuKuramotoEnabled: boolean;
  gpgpuKuramotoCoupling: number;
  gpgpuKuramotoSpread: number;
  gpgpuKuramotoRadius: number;
  gpgpuKuramotoInfluence: number;
  // Particle Life (species interaction matrix force)
  gpgpuParticleLifeEnabled: boolean;
  gpgpuParticleLifePreset: 'cells' | 'snakes' | 'community' | 'random';
  gpgpuParticleLifeSpecies: number;
  gpgpuParticleLifeStrength: number;
  gpgpuParticleLifeRadius: number;
  gpgpuParticleLifeFriction: number;
  gpgpuParticleLifeSeed: number;
  // Behaviour semantics (Phase AA1, lib/particleLifeBehavior.ts):
  // a cyclic predator chain over the species — species i pursues
  // species (i+1) mod n and evades species (i-1) mod n — gated by a
  // vision cone (range + angle around the velocity direction), a
  // per-particle Meander wander term, and an optional max-speed
  // clamp applied inside the Particle Life block. Every default
  // (pursue / evade / meander 0, max speed 0 = uncapped) leaves the
  // legacy matrix-only behaviour bit-identical.
  gpgpuParticleLifePursue: number;
  gpgpuParticleLifeEvade: number;
  gpgpuParticleLifeVisionRange: number;
  gpgpuParticleLifeVisionAngle: number;
  gpgpuParticleLifeMaxSpeed: number;
  gpgpuParticleLifeMeanderAmount: number;
  gpgpuParticleLifeMeanderScale: number;
  // Obstacle avoidance (Phase AB): the third Steering term — a
  // push along the SDF collider's normal, quadratic in the
  // proximity inside the vision range. 0 (default) = off; only
  // acts while the SDF collider is enabled. TS twin:
  // obstacleAvoidForce in lib/particleLifeBehavior.ts.
  gpgpuParticleLifeAvoid: number;
  // Spring (to spawn pos)
  gpgpuSpringEnabled: boolean;
  gpgpuSpringStrength: number;
  // Morph Targets (Kinetix integration B1a): per-particle target points
  // baked into a float texture; the velocity shader pulls each particle
  // toward its assigned target with the Kinetix morph spring law.
  gpgpuMorphEnabled: boolean;
  gpgpuMorphTarget: 'trefoil' | 'torusKnot' | 'galaxy' | 'mobius' | 'geodesic' | 'crown' | 'blackhole' | 'klein' | 'cymatic' | 'gyroid' | 'dnaRibbon' | 'hypercube' | 'mandelbulb' | 'shell' | 'text' | 'image' | 'svg' | 'obj' | 'terrain';
  // SVG import (Pro-2): the imported SVG document's source text. Like
  // the TextMap text it lives in the config so it persists with
  // projects / presets; the point cloud is re-sampled from it
  // deterministically at bake time (lib/svgMorph.ts).
  gpgpuMorphSvgSource: string;
  // OBJ import (Phase J): the imported Wavefront OBJ document's
  // source text, held in the config exactly like the SVG source; the
  // surface point cloud is re-sampled from it deterministically at
  // bake time (lib/objMorph.ts).
  gpgpuMorphObjSource: string;
  // OBJ sampling mode (Phase O): 'surface' (default) is the Phase J
  // area-weighted surface distribution, bit-identical to before;
  // 'vertices' places samples on the mesh vertices themselves;
  // 'volume' fills the interior of a closed mesh (a non-closed mesh
  // falls back to 'surface', which the UI states explicitly).
  gpgpuMorphObjSampleMode: 'surface' | 'vertices' | 'volume';
  // OBJ normal initial speed (Phase O): at (re)placement — the
  // simulation-start envelope and the age-respawn frame — particles
  // receive this velocity along their baked sample normal. 0
  // (default) disables the kick entirely (bit-identical legacy).
  gpgpuMorphObjNormalSpeed: number;
  gpgpuMorphStrength: number;
  gpgpuMorphScale: number;
  gpgpuMorphJitter: number;
  gpgpuMorphOrbitSpeed: number;
  // Replica grammar (Phase K): the baked morph cloud is split into
  // chained copies with cumulative translation / Y-rotation /
  // geometric-scale steps, plus a per-copy orbit phase offset — an
  // Echospace-style offset chain (lib/gpgpuMorphTargets.ts). Count 1
  // (the default) reproduces the legacy bake bit-for-bit. This is a
  // static bake-time grammar over one shared simulation: it does NOT
  // model Parent/Child dynamic child emitters (each copy would need
  // its own force/lifetime state).
  gpgpuMorphReplicaCount: number;
  gpgpuMorphReplicaSpacing: number;
  gpgpuMorphReplicaAxis: 'x' | 'y' | 'z';
  gpgpuMorphReplicaRotation: number;
  gpgpuMorphReplicaScaleStep: number;
  gpgpuMorphReplicaPhaseStep: number;
  // Replica age phase (Phase M): per-copy offset of the particle
  // lifecycle phase, as a fraction (0..1) of gpgpuAgeMax. Applied
  // to the initial age scatter and to the respawn restart age in
  // the position pass, keyed by the same contiguous replica blocks
  // as the bake. 0 (default) / count 1 reproduces the legacy
  // initial data and respawn behaviour bit-for-bit.
  gpgpuMorphReplicaAgeStep: number;
  // Replica independent simulation (Phase W2, method (a) state
  // separation): each replica block gets its own simulation stack
  // (own position/velocity state, own pass, own field seed and
  // clock offset) whose results merge back into the shared layout
  // every frame. Divergence scales the per-copy seed/time offsets
  // (0 = same field realization and clock as the shared sim,
  // modulo neighbour confinement to the copy's own stack).
  // false (default) keeps the single shared simulation and
  // reproduces the legacy behaviour bit-for-bit.
  gpgpuMorphReplicaIndependent: boolean;
  gpgpuMorphReplicaDivergence: number;
  // Terrain (Phase L, Mir-style): the 'terrain' morph target places
  // particles on a seeded fractal height field (value-noise fBm,
  // lib/gpgpuMorphTargets.ts). The field is a pure function of
  // (gpgpuSeed, terrain seed, amplitude, frequency, octaves), so the
  // bake stays deterministic. Height-driven colour comes from the
  // gradient 'height' driver below. These keys only take effect when
  // gpgpuMorphTarget is 'terrain'; every other target ignores them.
  gpgpuMorphTerrainAmplitude: number;
  gpgpuMorphTerrainFrequency: number;
  gpgpuMorphTerrainOctaves: number;
  gpgpuMorphTerrainSeed: number;
  // Authored path placement (Phase S): the svg morph target viewed
  // as an ordered path (lib/pathGeometry.ts) instead of an unordered
  // cloud. 'off' (default) keeps the legacy seeded random pick over
  // the resampled outline, byte-identical to v1.20.0. 'along' assigns
  // particle i to path position s in order; 'writeOn' assigns inside
  // the [WriteOnStart, WriteOnEnd] window (3D-Stroke style). Taper
  // widens the placement band along the path normal (0 = on-path).
  // SubpathMode distributes s across multiple subpaths. Only the svg
  // target reads these keys; every other target ignores them.
  gpgpuMorphPathMode: 'off' | 'along' | 'writeOn' | 'stamp';
  gpgpuMorphPathWriteOnStart: number;
  gpgpuMorphPathWriteOnEnd: number;
  gpgpuMorphPathTaper: number;
  gpgpuMorphPathTaperShape: 'linear' | 'smooth' | 'bell';
  gpgpuMorphPathSubpathMode: 'proportional' | 'even' | 'first';
  // Shape stamping (Phase AA3, lib/stampPlacement.ts): path mode
  // 'stamp' places a small shape at equal arc-length intervals
  // along the authored path instead of distributing points along
  // it. Spacing is the path fraction per stamp (count =
  // round(1/spacing), 1..64); size is the shape radius in
  // normalised cloud units; shape 'obj' stamps the imported OBJ
  // sample cloud (falling back to 'disc' without a usable source);
  // align rotates each stamp onto the path tangent. Only read in
  // 'stamp' mode, so every other mode is untouched.
  gpgpuMorphStampSpacing: number;
  gpgpuMorphStampSize: number;
  gpgpuMorphStampShape: 'disc' | 'ring' | 'star' | 'diamond' | 'obj';
  gpgpuMorphStampAlign: boolean;
  // Form-dedicated deformation (Phase AA2, lib/formDeformation.ts):
  // a placement deformation over the baked base form — Disperse
  // (per-point loosening, radial or along an axis), Twist (rotation
  // around an axis proportional to the coordinate along it) and
  // Fractal Field (seeded fBm displacement with an evolution
  // offset). Applied in the bake before the replica grammar; all
  // amounts 0 (the defaults) skip it entirely and the bake is
  // bit-identical to before. This is a dedicated Form grammar,
  // separate from the Flow / Vortex motion systems.
  gpgpuMorphDisperseAmount: number;
  gpgpuMorphDisperseDirection: 'radial' | 'x' | 'y' | 'z';
  gpgpuMorphTwistAmount: number;
  gpgpuMorphTwistAxis: 'x' | 'y' | 'z';
  gpgpuMorphFractalAmount: number;
  gpgpuMorphFractalFrequency: number;
  gpgpuMorphFractalEvolution: number;
  // Terrain Mesh (Phase P, Mir-style): a polygon mesh system that
  // shares the terrain height field above (terrainHeightAt with the
  // same field-seed mixing as the morph bake, so the mesh landscape
  // and the 'terrain' point terrain are the same landscape). The
  // mesh is a plain scene object displaced on a 128x128 grid with
  // computeVertexNormals shading; it is NOT part of the GPGPU
  // simulation and mounts only when enabled. Disabled (default)
  // mounts nothing and the render is bit-identical to before.
  gpgpuTerrainMeshEnabled: boolean;
  /** Display form: shaded polygon mesh / wireframe / points cloud
   *  over the same displaced geometry. */
  gpgpuTerrainMeshDisplay: 'shaded' | 'wireframe' | 'points';
  /** Tunnel mode: wrap the field around a cylinder (x becomes the
   *  circumference, z the depth, height the radial relief) and view
   *  it from inside. The field is cross-fade tiled on both wrapped
   *  axes so the wrap is seamless. */
  gpgpuTerrainMeshTunnel: boolean;
  /** Surface texture: 'none' (default, plain shaded colour),
   *  'gradient' / 'grid' procedural monochrome canvas textures, or
   *  'image' (the Horizon background image source, reused as map). */
  gpgpuTerrainMeshTexture: 'none' | 'gradient' | 'grid' | 'image';
  /** Mesh size multiplier over the morph world scale (the point
   *  terrain's extent), 1 = same footprint as the point terrain. */
  gpgpuTerrainMeshScale: number;
  gpgpuTerrainMeshOpacity: number;
  /** Shading brightness multiplier (material colour / light gain). */
  gpgpuTerrainMeshBrightness: number;
  // Terrain texture detail (Phase V): the 'image' texture kind
  // gains a DEDICATED image source. When gpgpuTerrainTextureImage
  // is empty the Horizon background image is used exactly as
  // before (bit-identical legacy); a non-empty dedicated source
  // takes precedence and the UI says so. Repeat / offset apply
  // the standard UV transform (uv * repeat + offset) to whichever
  // map is active — procedural kinds included; the defaults
  // (1 / 0 / 0) are the identity transform.
  gpgpuTerrainTextureImage: string;
  gpgpuTerrainTextureRepeat: number;
  gpgpuTerrainTextureOffsetX: number;
  gpgpuTerrainTextureOffsetY: number;
  // Tunnel cruise (Phase V): forward travel through the terrain
  // tunnel, in world units per second. The terrain phase scrolls
  // (the camera itself stays pinned — Phase G determinism); the
  // phase is a deterministic function of accumulated scene time,
  // and speed 0 renders exactly the legacy static tunnel. Only
  // read when gpgpuTerrainMeshTunnel is on.
  gpgpuTunnelSpeed: number;
  // Terrain slope force (Phase AE): particles flow downhill
  // along the terrain gradient (the derived gradient bake in
  // lib/terrainDerivedMaps.ts). Resolved CPU-side like the kill
  // mask: the force exists only while the terrain mesh is enabled
  // in plane mode. Disabled (default) = no force, bit-identical.
  gpgpuSlopeForceEnabled: boolean;
  gpgpuSlopeForceStrength: number;
  // OBJ Mesh (Phase V, Mir-style mesh side of the OBJ import): the
  // imported OBJ (the SAME gpgpuMorphObjSource text the morph
  // target reads — one shared data source, never a second copy)
  // drawn as an actual polygon mesh next to the particles, with a
  // grid of repeated copies and a placement transform. The mesh
  // is normalised exactly like the morph sampler (bbox centre,
  // bounding-sphere radius 1) and scaled by the morph world scale,
  // so mesh and point cloud coincide. Disabled (default) mounts
  // nothing; enabled with no usable OBJ source draws nothing and
  // the UI states that explicitly.
  gpgpuObjMeshEnabled: boolean;
  /** Display form: wireframe lines / solid shaded polygons. */
  gpgpuObjMeshDisplay: 'wireframe' | 'solid';
  /** Grid repetition count (1..64, arranged as a centred cube
   *  grid — see lib/objMesh.ts). */
  gpgpuObjMeshRepeat: number;
  /** Size multiplier over the morph world scale. */
  gpgpuObjMeshScale: number;
  gpgpuObjMeshPosX: number;
  gpgpuObjMeshPosY: number;
  gpgpuObjMeshPosZ: number;
  /** Y rotation in degrees. */
  gpgpuObjMeshRotY: number;
  gpgpuObjMeshOpacity: number;
  // OBJ repetition grammar (Phase AA3, lib/objMesh.ts): the repeat
  // layout gains a 'radial' mode (copies on a circle, each facing
  // outward) next to the legacy centred cube 'grid', plus the
  // replica-style per-copy chain — each copy i additionally rotates
  // by RepeatRotation * i degrees and scales by
  // RepeatScaleStep^i. Defaults ('grid' / 0 / 1) reproduce the
  // Phase V layout exactly.
  gpgpuObjMeshRepeatMode: 'grid' | 'radial';
  gpgpuObjMeshRepeatRotation: number;
  gpgpuObjMeshRepeatScaleStep: number;
  // Verlet Integration
  gpgpuVerletEnabled: boolean;
  // SDF Collider ('gyroid' added by Kinetix integration B3: the TPMS
  // gyroid surface as a signed-distance collider, Kinetix 'gyro')
  gpgpuSdfEnabled: boolean;
  gpgpuSdfShape: 'sphere' | 'box' | 'torus' | 'capsule' | 'gyroid';
  gpgpuSdfX: number;
  gpgpuSdfY: number;
  gpgpuSdfZ: number;
  gpgpuSdfSize: number;
  gpgpuSdfBounce: number;
  // Floor plane bounce (Kinetix integration B3, Kinetix floorBounce /
  // floorY / floorRestitution): a horizontal floor at gpgpuFloorY that
  // reflects velocity in the velocity pass and clamps position in the
  // position pass. Disabled by default (the sphere bound was the only
  // GPGPU boundary before).
  gpgpuFloorEnabled: boolean;
  gpgpuFloorY: number;
  gpgpuFloorBounce: number;
  // Aux event emission (Kinetix integration B3): a second, smaller
  // GPU particle pool whose particles are spawned by EVENTS in the
  // main pool — deathBurst on main-particle death (age wrap, needs the
  // Life System), bounceSplash on sphere/floor bounce, sparkTrail as
  // continuous spark shedding from live main particles (Kinetix
  // auxMode). 'none' (default) runs no aux passes at all. The layer
  // Aux/Spark systems are unrelated and keep working as before.
  gpgpuAuxMode: 'none' | 'deathBurst' | 'bounceSplash' | 'sparkTrail' | 'birthBurst';
  gpgpuAuxCount: number;
  gpgpuAuxIntensity: number;
  gpgpuAuxLife: number;
  gpgpuAuxSpeed: number;
  gpgpuAuxSize: number;
  // Child-emitter independence (Phase Q, Parent/Child): the Aux pool
  // is a full second simulation spawned by parent events; these keys
  // give the CHILD its own physics and look instead of sharing the
  // parent's. Every default reproduces the legacy shared behaviour
  // exactly: gravity scale 1 (same softened gravity), extra drag 0,
  // curl 0 (term omitted), colour '' (inherit the parent colour).
  gpgpuAuxGravityScale: number;
  gpgpuAuxDrag: number;
  gpgpuAuxCurl: number;
  gpgpuAuxColor: string;
  // Aux chain (Phase W1, grandchild emitters): the Aux pool's own
  // events can spawn a SECOND aux pool (level 2 = grandchildren),
  // and — at depth 3 — a third (level 3), each an identical 128x128
  // pool running the same two-pass machinery against the previous
  // level's frame-start textures. Depth is capped at 3 by design
  // (texture pairs and draw cost grow per level). Levels >= 2 share
  // ONE parameter set (the gpgpuAux2* keys): level 3 re-applies the
  // level-2 settings recursively instead of growing a third key
  // family. 'none' Aux2 mode (default) breaks the chain — no deeper
  // pool is allocated or run, and depth 1 (default) is exactly the
  // legacy single-pool behaviour.
  gpgpuAuxDepth: number;
  gpgpuAux2Mode: 'none' | 'deathBurst' | 'bounceSplash' | 'sparkTrail' | 'birthBurst';
  gpgpuAux2Intensity: number;
  gpgpuAux2Life: number;
  gpgpuAux2Speed: number;
  gpgpuAux2Size: number;
  gpgpuAux2GravityScale: number;
  gpgpuAux2Drag: number;
  gpgpuAux2Curl: number;
  gpgpuAux2Color: string;
  // Emission Shape ('light' added by Phase T: particles are emitted
  // from the 3D light's position — a pure position reference, like
  // Particular's Light Emitter; it works whether or not the light
  // itself is enabled).
  gpgpuEmitShape: 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone' | 'light';
  // 3D Light (Phase T): a single monochrome point light / spotlight
  // that multiplies the DRAWN brightness of GPGPU points (see
  // lib/gpgpuLight.ts). It never touches the simulation — positions
  // and velocities are unchanged, only the rendered colour scales.
  // Disabled by default; intensity 0 is also an exact identity.
  // This is separate from the PostFx Lux screen-space lights, which
  // are unchanged.
  gpgpuLightEnabled: boolean;
  gpgpuLightPosX: number;
  gpgpuLightPosY: number;
  gpgpuLightPosZ: number;
  /** Brightness added at the light's centre (multiplier 1 + this). */
  gpgpuLightIntensity: number;
  /** Falloff radius in world units; outside it the multiplier is 1. */
  gpgpuLightRadius: number;
  /** Restrict the light to a cone (spotlight) around the direction. */
  gpgpuLightConeEnabled: boolean;
  /** Cone half angle in degrees (feather is a fixed 1.25x band). */
  gpgpuLightConeAngleDeg: number;
  gpgpuLightDirX: number;
  gpgpuLightDirY: number;
  gpgpuLightDirZ: number;
  // Visible light volume + light trail (Phase Y): a volumetric
  // cone / sphere drawn IN the scene at the 3D light's position
  // (lib/lightVolume.ts), plus a ribbon along the light's movement
  // history (lib/lightTrail.ts). Both are draw-only — they never
  // touch the simulation. Disabled by default and, for the volume,
  // intensity 0 is also an exact identity: with both off the scene
  // mounts nothing extra and the render is bit-identical to
  // v1.29.0. Honest limit: the volume does NOT intersect scene
  // depth (no occlusion / shadowing) — edges are softened by the
  // softness key instead; the UI and the changelog say so.
  gpgpuLightVolumeEnabled: boolean;
  gpgpuLightVolumeShape: 'cone' | 'sphere';
  /** Volume brightness; 0 draws nothing even when enabled. */
  gpgpuLightVolumeIntensity: number;
  /** Cone length / sphere radius, in world units. */
  gpgpuLightVolumeLength: number;
  /** Cone half angle in degrees (sphere ignores it). */
  gpgpuLightVolumeAngle: number;
  /** Raymarch-style axial steps (1..32): smoothness vs cost. */
  gpgpuLightVolumeSteps: number;
  /** Edge softness 0..1 (depth-fade substitute; no depth test). */
  gpgpuLightVolumeSoftness: number;
  gpgpuLightTrailEnabled: boolean;
  /** Trail ribbon full width in world units. */
  gpgpuLightTrailWidth: number;
  /** Trail fade exponent: alpha ~ u^fade along old -> new. */
  gpgpuLightTrailFade: number;
  // Occlusion-map shadow + fog self-shadow (Phase Z): an
  // occlusion-map approximation baked from the terrain height
  // field and the OBJ bounding sphere against the Phase T light
  // object — NOT a full shadow map, and the UI says so
  // (「シャドウ（遮蔽マップ近似）」). Disabled by default and
  // strength 0 is also an exact identity, so with the defaults
  // the render is bit-identical to v1.30.0. Flame colour /
  // temperature are out of scope (monochrome policy).
  gpgpuShadowEnabled: boolean;
  /** Shadow darkness 0..1; 0 keeps every receiver bit-identical. */
  gpgpuShadowStrength: number;
  /** Penumbra softness 0..1 of the baked occlusion. */
  gpgpuShadowSoftness: number;
  /** Terrain height field casts occlusion. */
  gpgpuShadowSourceTerrain: boolean;
  /** OBJ mesh (bounding sphere) casts occlusion. */
  gpgpuShadowSourceObj: boolean;
  /** Fog / volumetric self-shadow strength; 0 = legacy fog. */
  gpgpuFogSelfShadow: number;
  /** Secondary march steps for the fog self-shadow (1..16). */
  gpgpuFogShadowSteps: number;
  // Color over Lifetime
  gpgpuAgeColorEnabled: boolean;
  gpgpuAgeColorYoung: string;
  gpgpuAgeColorOld: string;
  // Kinetix Color gradient (Kinetix integration B2): a 3-stop gradient
  // (start/mid/end) sampled through a 256px LUT in the point shader,
  // driven by life / velocity / spatial position / prism / image /
  // blackbody / height (Phase L: world Y, for terrain-style height
  // shading; reuses gpgpuGradSpatialScale as its scale). Opt-in only
  // — when disabled the legacy colour paths
  // (single colour, age 2-stop, velocity hue) run exactly as before.
  // The 'image' driver samples a user image (gpgpuGradImageSource)
  // by particle position in the point shader; while no image is set
  // (or it is still loading) it falls back to the life driver, and
  // the UI says so explicitly.
  gpgpuGradEnabled: boolean;
  gpgpuGradDriver: 'life' | 'velocity' | 'spatial' | 'prism' | 'image' | 'blackbody' | 'height';
  gpgpuGradStart: string;
  gpgpuGradMid: string;
  gpgpuGradEnd: string;
  gpgpuGradPreset: string;
  gpgpuGradSpatialScale: number;
  // Source image for the 'image' gradient driver, held in the config
  // as a data URL (downscaled to <=256px by the UI) so it persists
  // with presets / projects like the SVG morph source does. Empty
  // string = no image (the driver falls back to life).
  gpgpuGradImageSource: string;
  // Sprite image (Phase U): when non-empty, GPGPU point sprites take
  // their shape from this image — luminance (times alpha) modulates
  // the sprite alpha, monochrome only. While set it takes priority
  // over gpgpuPointShape; empty string = procedural shapes as before.
  // Held as a data URL (downscaled to <=256px by the UI) so it
  // persists with presets / projects like the gradient image does.
  gpgpuSpriteImage: string;
  // Sprite sheet / flipbook (Phase AD): the sprite image can be
  // a cols x rows sheet whose frame advances per particle —
  // driven by normalised age (one sweep per life), by a fixed
  // fps clock, or fixed randomly per particle seed. The defaults
  // (1x1) make the sheet UV remap an exact identity, so existing
  // single-image sprites are bit-identical. See
  // lib/spriteSheet.ts for the pure frame math.
  gpgpuSpriteSheetCols: number;
  gpgpuSpriteSheetRows: number;
  gpgpuSpriteFrameMode: 'age' | 'fps' | 'random';
  gpgpuSpriteFrameFps: number;
  gpgpuSpriteLoop: boolean;
  // Point material blending (Kinetix integration B2): 'additive' is the
  // legacy default; 'normal' is the Kinetix Normal blend. The sort-based
  // transparency path still forces Normal while sorting is on.
  gpgpuBlendMode: 'additive' | 'normal';
  // Size over Lifetime
  gpgpuAgeSizeEnabled: boolean;
  gpgpuAgeSizeStart: number;
  gpgpuAgeSizeEnd: number;
  // Size curve shape (Kinetix integration B1b): 'linear' is the legacy
  // start->end interpolation; 'bell' rises end->start->end over the life
  // (sin(pi * t)), matching Kinetix's bell SizeCurve.
  gpgpuAgeSizeCurve: 'linear' | 'bell';
  // Age curves (Phase U): fixed-position 5-point curves over the
  // normalised age (points at t = 0 / .25 / .5 / .75 / 1, linearly
  // interpolated; see lib/ageCurve.ts). Each curve is a multiplier
  // layered on the legacy age paths, so an all-ones curve (the
  // default) is exactly the legacy behaviour even while enabled.
  gpgpuAgeCurveSizeEnabled: boolean;
  gpgpuAgeCurveSizePoints: number[];
  gpgpuAgeCurveOpacityEnabled: boolean;
  gpgpuAgeCurveOpacityPoints: number[];
  // Age curve drive-target extension (Phase AC): the same
  // Enabled+Points grammar aimed at the simulation — Velocity
  // multiplies the particle velocity, Force multiplies the
  // built-in force accumulation, Rotation multiplies the
  // geometry spin rate (via the curve's closed-form integral).
  gpgpuAgeCurveVelocityEnabled: boolean;
  gpgpuAgeCurveVelocityPoints: number[];
  gpgpuAgeCurveForceEnabled: boolean;
  gpgpuAgeCurveForcePoints: number[];
  gpgpuAgeCurveRotationEnabled: boolean;
  gpgpuAgeCurveRotationPoints: number[];
  // Layer Maps per property (Phase U): the gradient image
  // (gpgpuGradImageSource, sampled by particle position through the
  // existing MediaLumaMap-style plumbing) modulates size / opacity
  // individually. factor = mix(1, luma, amount), so 0 (the default)
  // is identity and 1 makes luminance the multiplier itself. With no
  // image set the amounts have no effect (the UI says so explicitly).
  gpgpuMapSizeAmount: number;
  gpgpuMapOpacityAmount: number;
  // Per-property Layer Map sources + raster mask (Phase X): each
  // source is a data URL like gpgpuGradImageSource; '' falls back
  // to the common map (gpgpuGradImageSource) for that property, so
  // the Phase U single-map configuration keeps its exact meaning.
  // The colour source, when set, replaces the common image as the
  // 'image' gradient driver's input. Displacement offsets baked
  // points radially by (luma - 0.5) * amount * bounceRadius in the
  // draw vertex shader (0 = identity). The mask's numeric luma map
  // (gpgpuMaskMap + width/height) is captured at import time by the
  // UI, following the layer2MediaLumaMap precedent; the bake and
  // the layer media placement consume it deterministically.
  gpgpuMapSizeSource: string;
  gpgpuMapOpacitySource: string;
  gpgpuMapColorSource: string;
  gpgpuMapDisplaceSource: string;
  gpgpuMapDisplaceAmount: number;
  gpgpuMaskSource: string;
  gpgpuMaskMode: 'off' | 'clip' | 'shape';
  gpgpuMaskThreshold: number;
  gpgpuMaskInvert: boolean;
  gpgpuMaskMap: number[];
  gpgpuMaskMapWidth: number;
  gpgpuMaskMapHeight: number;
  // Mouse Force ('paint' added by Kinetix integration B3: particles
  // are continuously re-emitted at the pointer position — a
  // deterministic per-tick hash gate in the velocity/position passes
  // teleports a small fraction of the pool to the brush each tick and
  // gives them a fresh random velocity, Kinetix's pointer paint).
  gpgpuMouseEnabled: boolean;
  gpgpuMouseStrength: number;
  gpgpuMouseRadius: number;
  gpgpuMouseMode: 'attract' | 'repel' | 'swirl' | 'paint';
  gpgpuMousePaintRate: number;
  // Streak Rendering
  gpgpuStreakEnabled: boolean;
  gpgpuStreakLength: number;
  gpgpuStreakOpacity: number;
  // Sort-based Transparency (GPU Bitonic Sort)
  gpgpuSortEnabled: boolean;
  // Fluid Advection (Navier-Stokes simplified)
  gpgpuFluidEnabled: boolean;
  gpgpuFluidDiffuse: number;
  gpgpuFluidDecay: number;
  gpgpuFluidStrength: number;
  gpgpuFluidInfluence: number;
  gpgpuFluidScale: number;
  gpgpuFluidExtForce: boolean;
  // WebGPU Compute Backend
  gpgpuWebGPUEnabled: boolean;
  gpgpuExecutionPreference: 'auto' | 'webgl' | 'webgpu';
  // Metaballs (Marching Cubes isosurface)
  gpgpuMetaballEnabled: boolean;
  gpgpuMetaballResolution: number;
  gpgpuMetaballStrength: number;
  gpgpuMetaballIsoLevel: number;
  gpgpuMetaballColor: string;
  gpgpuMetaballStyle: 'classic' | 'glass' | 'hologram' | 'chrome' | 'halftone';
  gpgpuMetaballOpacity: number;
  gpgpuMetaballWireframe: boolean;
  gpgpuMetaballParticleLimit: number;
  gpgpuMetaballMetalness: number;
  gpgpuMetaballRoughness: number;
  gpgpuMetaballSubtract: number;
  gpgpuMetaballUpdateSkip: number;
  // Ribbon Trail
  gpgpuRibbonEnabled: boolean;
  gpgpuRibbonWidth: number;
  gpgpuRibbonTaper: number;
  gpgpuRibbonOpacity: number;
  gpgpuRibbonMaxSegLen: number;
  // Tube Trail (circular cross-section)
  gpgpuTubeEnabled: boolean;
  gpgpuTubeRadius: number;
  gpgpuTubeOpacity: number;
  // Smooth Tube (CatmullRom per-particle subset)
  gpgpuSmoothTubeEnabled: boolean;
  gpgpuSmoothTubeCount: number;
  gpgpuSmoothTubeRadius: number;
  // Cross-section taper (Phase AA3, lib/smoothTubeProfile.ts):
  // the oldest history ring thins toward (1 - taper) of the base
  // radius; the newest ring always keeps it. 0 = constant radius
  // (legacy).
  gpgpuSmoothTubeTaper: number;
  gpgpuSmoothTubeHistory: number;
  gpgpuSmoothTubeColor: string;
  gpgpuSmoothTubeOpacity: number;
  // Volumetric Ray Marching
  gpgpuVolumetricEnabled: boolean;
  gpgpuVolumetricRadius: number;
  gpgpuVolumetricDensity: number;
  gpgpuVolumetricColor: string;
  gpgpuVolumetricOpacity: number;
  gpgpuVolumetricSteps: number;
}
