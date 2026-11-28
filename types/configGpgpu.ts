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
  // KCB1: slider values for ctrl() declarations in the custom force
  // snippet (id -> value). Empty record = every control sits at its
  // declared default, i.e. no behaviour change for existing data.
  gpgpuCustomForceCtrlValues: Record<string, number>;
  // Force application order (Phase 18 stage 2): comma-separated chunk names; '' = default order (bit-identical).
  gpgpuForceOrder: string;
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
  // Trail mechanism (Limit plan stage 4, slice S6): 'history'
  // (default) is the legacy snapshot ring — 16 position RTs,
  // byte-identical in every respect. 'aux' re-sources the
  // trail from the level-1 Aux pool instead: each Aux slot
  // sheds a short-lived child from its parent main particle
  // on its own emit tick (lib/trailAux.ts is the semantics'
  // source of truth). The emit keys are read only in 'aux'
  // mode; gpgpuTrailAuxLife 0 derives the child life from
  // gpgpuTrailLength (length * interval / 60 seconds).
  gpgpuTrailMode: 'history' | 'aux';
  gpgpuTrailEmitInterval: number;
  gpgpuTrailEmitRate: number;
  gpgpuTrailAuxLife: number;
  // Instanced Geometry
  gpgpuGeomMode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone' | 'obj';
  gpgpuGeomVelocityAlign: boolean;
  gpgpuGeomScale: number;
  // Geometry material extras (Kinetix integration B1b): procedural
  // environment reflection approximation for the crystal look (no PMREM),
  // per-instance self-rotation, and velocity stretch (meshStretch).
  // All default to 0 = legacy geometry behaviour.
  gpgpuGeomEnvReflect: number;
  // Image-based lighting (Phase AL): equirect sampling of the
  // background (image source, or the horizon gradient baked as an
  // equirect) as diffuse + reflection light on the instanced
  // geometry. 0 (default) = the legacy fragment path verbatim.
  gpgpuGeomIblIntensity: number;
  // PBR grammar (Phase 16 stage 2): GEOM fragment F0 / specular.
  // Defaults metalness 0 / roughness 1 = legacy spec pow24*0.35 exactly.
  gpgpuGeomMetalness: number;
  gpgpuGeomRoughness: number;
  // Scene IBL (Phase 16 stage 3): PMREM scene.environment for the
  // Standard family. 0 (default) = scene.environment never set.
  gpgpuSceneEnvIntensity: number;
  // GEOM custom GLSL (Phase 16 stage 4): user snippets spliced into
  // GEOM_VERT / GEOM_FRAG (lib/geomCustomGlsl.ts). Disabled / empty
  // (defaults) = the stock shader strings verbatim.
  gpgpuGeomCustomVertexEnabled: boolean;
  gpgpuGeomCustomVertexCode: string;
  gpgpuGeomCustomFragmentEnabled: boolean;
  gpgpuGeomCustomFragmentCode: string;
  // Foliage split (Phase 16 stage 5): per-species geometry modes for
  // scatter species zones 2..4. 'follow' (default) resolves to
  // gpgpuGeomMode, so species 1 (gpgpuGeomMode) stays the canonical
  // shape and old presets are unchanged.
  gpgpuGeomSpecies2Mode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone' | 'obj' | 'follow';
  gpgpuGeomSpecies3Mode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone' | 'obj' | 'follow';
  gpgpuGeomSpecies4Mode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone' | 'obj' | 'follow';
  // Per-zone OBJ sources (limit plan stage 4, slice S1): when a
  // species zone resolves to 'obj' and its zone source is
  // non-empty, that document builds the zone's base geometry;
  // '' (default) follows the single gpgpuMorphObjSource, so
  // default configs build byte-identical geometry to before.
  gpgpuGeomSpecies2ObjSource: string;
  gpgpuGeomSpecies3ObjSource: string;
  gpgpuGeomSpecies4ObjSource: string;
  gpgpuGeomSpinSpeed: number;
  // Spin random range (Phase AH): per-particle multiplier spread
  // around the spin speed. 0 = every instance at exactly the base
  // speed (bit-identical legacy spin).
  gpgpuGeomSpinRandom: number;
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
  // Spawn pulse (Phase AH): the release clock advances only during
  // the first duty fraction of each interval cycle. Interval 0 =
  // off (the legacy linear release, bit-identical).
  gpgpuSpawnPulseInterval: number;
  gpgpuSpawnPulseDuty: number;
  // Pulse cycles + probability (Phase AX): the periodic burst can
  // be limited to a number of cycles (0 = unlimited, the legacy
  // behaviour) and each cycle can be gated by a deterministic
  // probability (1 = every cycle fires, the legacy behaviour).
  // Both live in the pulse-time function (lib/gpgpuLifecycle.ts),
  // so at the defaults the threshold expressions are the legacy
  // ones verbatim.
  gpgpuSpawnPulseCycles: number;
  gpgpuSpawnPulseProbability: number;
  // Spawn order (Phase AX): what the spawn gate compares the
  // release threshold against. 'hash' (default) is the legacy
  // per-texel hash order. 'distance' releases in order of the
  // particle's initial distance from the origin (near first),
  // 'distanceFar' far first — the gate value is the max-normalised
  // initial distance, baked into a static texture by the runtime
  // (lib/gpgpuLifecycle.ts, buildSpawnDistanceValues).
  gpgpuSpawnOrderMode: 'hash' | 'distance' | 'distanceFar';
  // Spawn burst event (Phase AX): a directly authored burst — at
  // `gpgpuSpawnEventTime` seconds into the spawn epoch, the
  // fraction `gpgpuSpawnEventCount` of the LIVE pool (chosen by a
  // deterministic per-texel hash) respawns at once through the
  // shared respawn block, and the velocity pass hands those
  // particles a directly specified initial velocity: magnitude
  // `gpgpuSpawnEventSpeed` (velocity units, the morph-kick scale),
  // direction blended from radial-outward to a hash-random sphere
  // direction by `gpgpuSpawnEventSpread` (which also jitters the
  // magnitude). Disabled (default) = no event ever fires.
  gpgpuSpawnEventEnabled: boolean;
  gpgpuSpawnEventTime: number;
  gpgpuSpawnEventCount: number;
  gpgpuSpawnEventSpeed: number;
  gpgpuSpawnEventSpread: number;
  // Spawn allocator (Grammar 2.0 stage 2, E2): the release
  // rate as an ABSOLUTE count (particles per second) instead
  // of the legacy pool fraction per second. 0 (default) = off:
  // the legacy fraction key drives the gate and every string
  // is the shipped one. Above 0 it replaces the gate's rate
  // term (the burst / pulse grammar still applies); the
  // allocator's semantics live in lib/gpgpuSpawnAllocator.ts.
  gpgpuSpawnRateAbsolute: number;
  // Spawn envelope (Grammar 2.0 stage 2, E2): an authored
  // window over the spawn epoch — before `Start` the release
  // clock does not advance, inside the window it advances at
  // the free curve's value (the curve asset below, over the
  // normalised window), and at/after `Stop` it stops for good
  // (Stop 0 = no stop: after Start the curve's tail value 1
  // applies, i.e. the plain clock). Disabled (default) = the
  // legacy clock verbatim. The clock is accumulated CPU-side
  // (advanceSpawnEnvelopeClock) and consumed by both sim
  // passes as uSpawnClockTime.
  gpgpuSpawnEnvelopeEnabled: boolean;
  gpgpuSpawnEnvelopeStart: number;
  gpgpuSpawnEnvelopeStop: number;
  gpgpuSpawnEnvelopeCurve: number[];
  // Rule spawn gate (Grammar 2.0 stage 2, E2): while on, a
  // main-pool particle whose live-rule spawn pulse (REP mask
  // bit 13, slice 1D-3) stands re-births through the shared
  // respawn block — the main-pool opening of the connection
  // the Aux ruleSpawn mode already consumes. Off (default) =
  // the shipped strings; the flag additionally requires an
  // effective live rule list with a spawn action.
  gpgpuSpawnRuleGateEnabled: boolean;
  // Emission curve (Phase AJ): a free control-point curve asset
  // (lib/freeCurve.ts, flat [t, v, …] pairs) whose value over a
  // repeating period gates the age respawn probabilistically, so
  // the rebirth rate itself follows the drawn curve. Disabled =
  // the legacy respawn, bit-identical; an all-ones curve is the
  // identity even while enabled.
  gpgpuFreeCurvePoints: number[];
  gpgpuEmissionCurveEnabled: boolean;
  gpgpuEmissionCurvePeriod: number;
  // Named point attributes (Phase AK): four named scalar channels
  // per particle (lib/gpgpuAttributes.ts), baked at generation
  // time into a static texture and read by the velocity pass (the
  // force drive / the group gate) and the points readout (the
  // size / brightness drives). The position / velocity layout is
  // untouched; every drive defaults to off, and while no consumer
  // is active the attribute texture is not even built, so the
  // legacy behaviour is bit-identical. Slot selectors are -1 (off)
  // or 0..3; a drive also needs a non-zero amount.
  gpgpuAttrNames: string[];
  gpgpuAttrSources: string[];
  // Bake-time attribute arithmetic (Phase BI): one expression
  // per slot ('' = none), evaluated once at bake time against
  // the slot names and x (the slot's own source value), with
  // the result clamped to [0, 1] and baked into the same
  // static texture. All-empty is the legacy bake, bit-identical.
  gpgpuAttrExprs: string[];
  // Dynamic attribute re-evaluation (Phase BO, stage 2): while
  // enabled, a GPU pass re-evaluates the slot expressions every
  // gpgpuAttrDynInterval frames with t = the sim clock opened to
  // the expressions, and the consumers read the re-evaluated
  // texture instead of the bake. Disabled (the default) never
  // builds the pass, so the legacy bake runs bit-identically.
  gpgpuAttrDynEnabled: boolean;
  gpgpuAttrDynInterval: number;
  // Attribute feedback (Phase BV): while enabled, the stage-2
  // re-evaluation becomes stateful — the expression language
  // gains the reserved variable p (the slot's own value in the
  // previous evaluation's output), so accumulation / decay can
  // be written. Shares the gpgpuAttrDynInterval cadence; the
  // state advances once per evaluation, and p starts from the
  // bake value. Disabled (the default), or with no expression
  // referencing p, the feedback pass is never built and the
  // stage-2 / bake behaviour is bit-identical.
  gpgpuAttrFeedbackEnabled: boolean;
  // Extended attribute slots (Phase 18 stage 1): slots 4..7
  // with their own names / sources / bake-time expressions,
  // baked into a SECOND attribute texture that is built only
  // while an enabled pass (dynamic / feedback / chain) reads
  // an ext slot name. The first texture's layout and every
  // slots-0..3 consumer are untouched; the drive selectors
  // below stay 0..3 in this stage.
  gpgpuAttrNames2: string[];
  gpgpuAttrSources2: string[];
  gpgpuAttrExprs2: string[];
  // Attribute chain stage (Phase 18 stage 1): a second
  // expression stage whose input is the stage-1 output texture
  // (the dynamic / feedback result when present, else the
  // bake). Its expressions see x = the slot's stage-1 value,
  // the slot names (sequential, same rule as the bake), the
  // ext slot names, the sim quantities (vel / age / rad) and
  // t. Disabled (the default), or with every expression empty,
  // the chain pass is never built and consumers read the
  // stage-1 texture verbatim. Shares the gpgpuAttrDynInterval
  // cadence with the stage-1 re-evaluation.
  gpgpuAttrChainEnabled: boolean;
  gpgpuAttrChainExprs: string[];
  gpgpuAttrSizeSlot: number;
  gpgpuAttrSizeAmount: number;
  gpgpuAttrBrightSlot: number;
  gpgpuAttrBrightAmount: number;
  // Colour drive (Phase CL): tints each point by the RAW values
  // of the colorR / colorG / colorB attribute columns. Resolves
  // off unless all three names are assigned to slots.
  gpgpuAttrColorEnabled: boolean;
  gpgpuAttrForceSlot: number;
  gpgpuAttrForceAmount: number;
  // Attribute groups (Phase AK): a membership test on one slot's
  // value gates the selected built-in forces per particle.
  gpgpuGroupEnabled: boolean;
  gpgpuGroupSlot: number;
  gpgpuGroupMode: 'below' | 'above' | 'band';
  gpgpuGroupLow: number;
  gpgpuGroupHigh: number;
  gpgpuGroupTarget: 'all' | 'gravity' | 'turbulence' | 'curl' | 'wind' | 'morph';
  gpgpuGroupInvert: boolean;
  // Named groups (Phase CV): the definition library as one
  // serialised JSON string (lib/gpgpuGroups.ts; '' = no groups)
  // and the id of the group the force gate uses ('' = the legacy
  // predicate above). Snapshot payloads ride local saves and
  // presets, never share links.
  gpgpuGroupsData: string;
  gpgpuGroupRef: string;
  // Particle rules (G10): the rule list as one serialised JSON
  // string (lib/gpgpuParticleRules.ts; '' = no rules = legacy
  // behaviour).
  gpgpuParticleRules: string;
  // Live particle rules (Grammar 2.0 stage 1, slice 1A): the
  // live rule list as one serialised JSON string
  // (lib/gpgpuParticleRulesLive.ts; '' = no live rules = the
  // rule evaluation pass never exists = legacy behaviour), and
  // the REP re-evaluation interval in frames (the
  // gpgpuAttrDynInterval cadence discipline).
  gpgpuParticleRulesLive: string;
  // Pipeline graph (limit plan stage 5, slice S3): the
  // pipeline-graph-v1 JSON for the same configuration the
  // live-rules / force-order keys express in row-list form
  // (lib/pipelinePersist.ts; '' = no graph = legacy
  // row-list-only configuration).
  gpgpuPipelineGraph: string;
  gpgpuRuleEvalInterval: number;
  // Phase DG: the named group referenced by gpgpuGroupRef also
  // drives two more consumers — a position-pass kill (non-members
  // respawn) and the draw-side attribute colour (members only).
  // Both default OFF, keeping every existing config identical.
  gpgpuGroupKillEnabled: boolean;
  gpgpuGroupColorEnabled: boolean;
  gpgpuKillBoundary: boolean;
  gpgpuKillMask: boolean;
  // Collision life (Phase 15, Unity §1): contact with a collider
  // (sphere shell / SDF / mesh SDF / floor / terrain) in the
  // position pass consumes life at this rate (extra age seconds
  // per second of contact), or kills outright when the toggle is
  // on. Both default off — no contact bookkeeping runs and the
  // output is bit-identical.
  gpgpuCollisionLifeLoss: number;
  gpgpuCollisionKill: boolean;
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
  gpgpuAttractorSpaceMode: 'legacy' | 'spread' | 'frame' | 'ring';
  gpgpuAttractor2Enabled: boolean;
  gpgpuAttractor2Type: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda' | 'chua';
  gpgpuAttractor2Strength: number;
  gpgpuAttractor2Scale: number;
  gpgpuAttractor2SpaceMode: 'legacy' | 'spread' | 'frame' | 'ring';
  gpgpuAttractor3Enabled: boolean;
  gpgpuAttractor3Type: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda' | 'chua';
  gpgpuAttractor3Strength: number;
  gpgpuAttractor3Scale: number;
  gpgpuAttractor3SpaceMode: 'legacy' | 'spread' | 'frame' | 'ring';
  gpgpuAttractor4Enabled: boolean;
  gpgpuAttractor4Type: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda' | 'chua';
  gpgpuAttractor4Strength: number;
  gpgpuAttractor4Scale: number;
  gpgpuAttractor4SpaceMode: 'legacy' | 'spread' | 'frame' | 'ring';
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
  // Wind volume (Phase AL): a placed spherical region that
  // localises the global wind (direction / gust are inherited from
  // the wind keys above) with the light-style (1-(d/R)^2)^2
  // falloff. Default off = the velocity pass is verbatim legacy.
  gpgpuWindVolumeEnabled: boolean;
  gpgpuWindVolumeX: number;
  gpgpuWindVolumeY: number;
  gpgpuWindVolumeZ: number;
  gpgpuWindVolumeRadius: number;
  gpgpuWindVolumeStrength: number;
  // Field instances + layers (Grammar 2.0 stage 2, B1):
  // serialised JSON lists (lib/gpgpuFieldInstances.ts) — placed
  // vortex / well / wind instances with position, radius and
  // strength, grouped into weighted layers whose per-particle
  // modulation rides an attribute slot. Empty strings (the
  // defaults) = no instances, the velocity pass is verbatim
  // legacy.
  gpgpuFieldInstances: string;
  gpgpuFieldLayers: string;
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
  // Surface selectivity (Phase 15, Houdini §7): weights the
  // cohesion by the particle's density deficit
  // (1 - density / restDensity), so the pull acts on the
  // droplet's surface instead of isotropically everywhere.
  // 0 (default) = the Phase AB isotropic cohesion, bit-identical.
  gpgpuSphSurfaceSelectivity: number;
  // Surface tension, Akinci form (Phase 24, design §9-1
  // candidate E): a two-term model in the same SPH sample loop —
  // the Akinci spline-kernel cohesion (weakly repulsive at very
  // short range, attractive through the mid range) plus a
  // curvature term from the colour field (its gradient is the
  // surface normal, its Laplacian over the gradient magnitude
  // the curvature estimate). Adds to the AB cohesion above;
  // each model zeroes independently. 0 (default) = off: the
  // Akinci chunks exist only in the variant shader string, so
  // the stock velocity shader stays byte-identical.
  gpgpuSphSurfaceTensionAkinci: number;
  // Grains (Phase AQ): a DEM-style penalty contact + Coulomb
  // friction solver in the velocity pass — grain-grain contact
  // resolved as forces over the same statistical subsample
  // neighbourhood as SPH. Phase 19 completes the two AQ limits:
  // a position projection segment in the position pass
  // (gpgpuGrainsProjection) and an optional complete
  // neighbourhood scan (gpgpuGrainsNeighborhood), both below.
  // Size is the grain diameter in world units (the SPH radius'
  // unit system). Enabled false (default) = the block is skipped
  // and the pass is verbatim legacy. The angle of repose was an
  // emergent value of Friction in Phase AQ; Phase BB adds the
  // direct specification below.
  gpgpuGrainsEnabled: boolean;
  gpgpuGrainsSize: number;
  gpgpuGrainsStiffness: number;
  gpgpuGrainsFriction: number;
  gpgpuGrainsCohesion: number;
  gpgpuGrainsRestitution: number;
  gpgpuGrainsRestDamping: number;
  // Angle of repose, direct specification (Phase BB): degrees,
  // 0 (default) = off — the friction key rules and the repose is
  // its emergent value, exactly as Phase AQ. While > 0 the key
  // OVERRIDES Friction: the solver runs with μ = tan(angle)
  // (lib/gpgpuGrains.ts is the single resolution point), so a
  // slope steeper than the angle slides and a gentler one rests,
  // monotonically in the key.
  gpgpuGrainsReposeAngle: number;
  // Position projection (Phase 19): 0..1 strength of the
  // position-pass Jacobi projection segment (half the overlap per
  // pair member, per pass). 1 (default) = full projection while
  // Grains is on — a Grains-on behaviour change only; Grains off,
  // or 0 here, is the exact legacy position pass.
  gpgpuGrainsProjection: number;
  // Neighbourhood scan (Phase 19): 0 (default) = the Phase AQ
  // statistical subsample (max 64 over the first texture row's
  // span); 1 = the complete scan — the whole position texture in
  // texel order up to the scan budget, deterministic integer
  // stride beyond it. Applies to the Grains contact loop and the
  // projection segment only; SPH keeps the subsample either way.
  gpgpuGrainsNeighborhood: number;
  // Pile solver (Grains Stage C): the density-constraint recipe
  // ported from the H8 prototype — support radius h = Size x
  // SupportScale, rest density rho0 = the touching-FCC-lattice
  // kernel density at that h, times RestDensityFactor, tangential
  // friction inside every solver iteration of the position stage,
  // and XSPH velocity smoothing gated on the neighbourhood having
  // settled. Enabled false (default) = no pile passes run, no
  // variant string is built and every legacy path is verbatim.
  // The single resolution point is resolveGrainsPilePlan in
  // lib/gpgpuGrains.ts.
  gpgpuGrainsPileEnabled: boolean;
  // Solver iterations of the pile position stage (1..6).
  gpgpuGrainsIterations: number;
  // Support-radius factor: h = gpgpuGrainsSize x this (1..3).
  gpgpuGrainsSupportScale: number;
  // Rest-density factor: rho0 = lattice density x this (0.8..1.4).
  gpgpuGrainsRestDensityFactor: number;
  // XSPH smoothing strength (0..1); 0 disables XSPH even while
  // the pile solver is on. The settle gate itself is automatic.
  gpgpuGrainsXsphStrength: number;
  // Velocity-update blend (0..1, default 1): after the pile
  // iterations, the velocity texture is blended toward the
  // velocity reconstructed from the frame's actual displacement
  // (PBF-style), so the position solve's energy removal reaches
  // the velocity field. 0 disables the update. Inactive while
  // Verlet or rigid bodies are on. Resolved in
  // resolveGrainsPilePlan (lib/gpgpuGrains.ts).
  gpgpuGrainsVelocityBlend: number;
  // Grains DEM engine (solver research stage 2-1): a force-based
  // DEM solver with per-contact history, implemented as a WGSL
  // compute path next to the position-based legacy solver above.
  // Default OFF everywhere; no preset enables it. While DEM is
  // active it owns the grains solve on the WebGPU route and the
  // legacy position-solver keys (Stiffness / Cohesion /
  // RestDamping / Projection / Neighborhood / Iterations /
  // SupportScale / RestDensityFactor / XsphStrength /
  // VelocityBlend / VelocityMode) plus Pile resolve off.
  // Resolved in resolveGrainsDemPlan (lib/gpgpuGrains.ts);
  // design of record: GRAINS_DEM_INTEGRATION_DESIGN.md.
  gpgpuGrainsDemEnabled: boolean;
  // Max DEM substeps per frame (8..128, default 64); the fixed
  // substep is 1/(60*64) s and excess frame time is dropped.
  gpgpuGrainsDemSubsteps: number;
  // Multiplier on the DEM normal stiffness kn (default 1).
  gpgpuGrainsDemStiffness: number;
  // Tangential-to-normal stiffness ratio kt/kn (default 0.5).
  gpgpuGrainsDemTangentialRatio: number;
  // Rolling-resistance torque cap coefficient: the cap is
  // coeff x R x normal force (dimensionless). Default 0.46 is
  // the stage-1 spike's proven point rescaled to product units;
  // final calibration is stage 2-2 work.
  gpgpuGrainsDemRollingFriction: number;
  // Cundall local (non-viscous) damping (default 0 = off).
  gpgpuGrainsDemLocalDamping: number;
  // Per-particle contact history slots K (4..16, default 12).
  gpgpuGrainsDemHistorySlots: number;
  // Auto quality: drop the substep cap 64 -> 48 -> 32 when the
  // GPU frame time stays high (default on).
  gpgpuGrainsDemAutoQuality: boolean;
  // Pyro (Phase AS): a particle-side temperature / buoyancy
  // solver in the velocity pass. Each particle's temperature is
  // derived deterministically from its normalised age —
  // T = Temperature × (1 − ageNorm) ^ Cooling — and drives a
  // buoyancy acceleration (in gravity units, gain kept separate
  // from gravity itself) plus temperature-linked stirring: the
  // existing curl block's effective strength is modulated by the
  // temperature, and an independent temperature-weighted curl
  // term stirs hot particles even with curl off. No grid density
  // / temperature field, no pressure projection, no heat
  // conduction, no combustion — the smoke density is the particle
  // distribution itself. Enabled false (default) = every block
  // is skipped and the pass is verbatim legacy.
  gpgpuPyroEnabled: boolean;
  gpgpuPyroTemperature: number;
  gpgpuPyroBuoyancy: number;
  gpgpuPyroCooling: number;
  gpgpuPyroDisturbance: number;
  gpgpuPyroDisturbanceHeat: number;
  // Phase CA: Pyro grid solver (atlas-packed 3D stable-fluids
  // grid alongside the particle solver). Enabled allocates the
  // grid targets and steps the full solver (advection, buoyancy,
  // pressure projection); disabled allocates nothing and runs no
  // pass, so output is bit-identical. Resolution 0 = auto by GPU
  // tier (entry 32 / standard 48 / high+flagship 64; 96 manual,
  // flagship only). Jacobi iterations clamp to [0, 32].
  gpgpuPyroGridEnabled: boolean;
  gpgpuPyroGridResolution: number;
  gpgpuPyroGridJacobiIterations: number;
  // Phase CB: grid -> particle coupling (G2P in the FLIP pattern;
  // blend 0 = PIC, 1 = FLIP; the shader block only runs while
  // blend > 0, so the default keeps output bit-identical),
  // vorticity confinement strength epsilon (0 = the two passes
  // do not exist), and the combustion fuel rate (0 = no fuel is
  // emitted or burned; the scalar b channel stays zero).
  gpgpuPyroGridBlend: number;
  gpgpuPyroGridTransfer: number;
  gpgpuPyroVorticityEpsilon: number;
  gpgpuPyroFuelRate: number;
  // Phase 19 stage 4: Pyro volume raymarch render path. The
  // render selector defaults to 'fog' — the legacy fog-feed
  // rendering, bit-identical, and the new box-march system
  // (components/scenePyroVolumeSystem.tsx) never mounts. In
  // 'raymarch' mode the grid's scalar atlas is marched through
  // the domain cube (Beer-Lambert); steps 0 = tier default
  // (entry 16 / standard 24 / high+flagship 32, manual 8..64),
  // density is the extinction scale (1 = a full domain crossing
  // at density 1 accumulates optical depth 1), shadow steps 0
  // = no self-shadow secondary march (max 8). The solver files
  // are untouched; this stage only reads the published atlas.
  gpgpuPyroVolumeRender: 'fog' | 'raymarch';
  gpgpuPyroVolumeSteps: number;
  gpgpuPyroVolumeDensity: number;
  gpgpuPyroVolumeShadowSteps: number;
  // Phase CC: CSG (manifold-3d in a lazily-created worker).
  // The enabled flag only arms the Graph-tab CSG panel; the
  // worker and WASM load on the first explicit execution, and
  // nothing in the render path reads these keys, so with the
  // defaults the output is bit-identical. Operands are the two
  // primitives below (size = cube edge / sphere diameter /
  // cylinder+cone height / torus scale; B carries the offset).
  gpgpuCsgEnabled: boolean;
  gpgpuCsgPrimitiveA: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'extrude' | 'mesh';
  gpgpuCsgPrimitiveB: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'extrude' | 'mesh';
  gpgpuCsgOperation: 'union' | 'difference' | 'intersection';
  gpgpuCsgSizeA: number;
  gpgpuCsgSizeB: number;
  gpgpuCsgSegments: number;
  gpgpuCsgOffsetAX: number;
  gpgpuCsgOffsetAY: number;
  gpgpuCsgOffsetAZ: number;
  gpgpuCsgOffsetBX: number;
  gpgpuCsgOffsetBY: number;
  gpgpuCsgOffsetBZ: number;
  gpgpuCsgExtrudeProfile: 'square' | 'circle' | 'polygon' | 'custom';
  gpgpuCsgExtrudeHeight: number;
  gpgpuCsgExtrudeTwist: number;
  gpgpuCsgExtrudeScaleTop: number;
  gpgpuCsgExtrudeDivisions: number;
  gpgpuCsgExtrudeCustomText: string;
  gpgpuCsgMeshObjText: string;
  gpgpuCsgMeshObjTextB: string;
  gpgpuCsgFinish: 'none' | 'hull' | 'refine';
  gpgpuCsgRefineDivisions: number;
  gpgpuCsgMorphBackupObjText: string;
  gpgpuCsgHistoryJson: string;
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
  // Predator-Prey semantics (Grammar 2.0 stage 2, slice B6,
  // lib/gpgpuPredation.ts): the outcome layer over the
  // behaviour chain — while enabled, generated live rules
  // (appended after the user's own) true-kill prey with a
  // predator in range (or, in 'convert' outcome, transition
  // them to the assimilated state) and pulse spawn for
  // predators with prey in range. Range / species reuse the
  // Particle Life keys above. Disabled (default) = no rules
  // generated, bit-identical to legacy.
  gpgpuPredationEnabled: boolean;
  gpgpuPredationOutcome: 'kill' | 'convert';
  gpgpuPredationBirth: boolean;
  gpgpuPredationStrike: number;
  // B6 follow-up: consecutive evaluations the strike must
  // hold (1 = immediate, the identity) and the activation
  // grace in seconds (0 = none, the identity).
  gpgpuPredationStrikeFrames: number;
  gpgpuPredationGraceSeconds: number;
  gpgpuParticleLifeVisionRange: number;
  gpgpuParticleLifeVisionAngle: number;
  gpgpuParticleLifeMaxSpeed: number;
  gpgpuParticleLifeMeanderAmount: number;
  gpgpuParticleLifeMeanderScale: number;
  // Meander promotion (Grammar 2.0 stage 2, slice B7,
  // lib/gpgpuMeander.ts): the wander term's standalone
  // enable. While on (and Amount > 0) the term runs as its
  // own 'meander' force chunk outside the Particle Life
  // block — Particle Life itself may stay off — and the
  // block's internal copy is suppressed so the term applies
  // exactly once. Off (default) = the term lives only inside
  // the Particle Life block, bit-identical to legacy.
  gpgpuMeanderEnabled: boolean;
  // Obstacle avoidance (Phase AB): the third Steering term — a
  // push along the SDF collider's normal, quadratic in the
  // proximity inside the vision range. 0 (default) = off; only
  // acts while the SDF collider is enabled. TS twin:
  // obstacleAvoidForce in lib/particleLifeBehavior.ts.
  gpgpuParticleLifeAvoid: number;
  // General steering avoidance (Phase 15, Houdini §3): the same
  // normal-push law as the Particle Life avoidance above, but
  // applied to every particle independently of the Life switch.
  // 0 (default) = off, bit-identical. Range 0 = automatic
  // (1.5 * SDF size). When both avoids are on, they add.
  gpgpuSteerAvoid: number;
  gpgpuSteerAvoidRange: number;
  // Crowd state machine + lanes (Round 84 gap 2, stage 1):
  // IDLE / MOVE / AVOID as a memoryless transition law over the
  // steering modes, plus lane grammar on the path mode. The
  // crowd layer wraps the steer-seek chunk, so it takes effect
  // only while steering is enabled. Off (default) keeps every
  // shader string byte-identical.
  gpgpuCrowdEnabled: boolean;
  // AVOID entry range; 0 = Phase 15 fallback (1.5 * SDF size).
  gpgpuCrowdAvoidRange: number;
  // AVOID exit range = entry * (1 + hysteresis).
  gpgpuCrowdAvoidHysteresis: number;
  gpgpuCrowdIdleSpeed: number;
  gpgpuCrowdIdleSpeedOut: number;
  // Arrival radius for IDLE; 0 = the steer slowing radius.
  gpgpuCrowdIdleRadius: number;
  gpgpuCrowdIdleDamping: number;
  gpgpuCrowdLaneCount: number;
  gpgpuCrowdLaneWidth: number;
  gpgpuCrowdLaneOffset: number;
  gpgpuCrowdLaneLateralGain: number;
  gpgpuCrowdLaneLookAheadScale: number;
  // Multi-obstacle crowd avoidance (crowd multi-obstacle stage):
  // while on, the crowd state machine also treats the mesh SDF
  // colliders (the multi-body atlas bodies, or the single mesh
  // body) as obstacles, selecting the smallest-sd body per frame
  // (the position pass's min synthesis). Off (default) the crowd
  // sees only the analytic SDF primitive, exactly as Gate 43.
  gpgpuCrowdMultiObstacleEnabled: boolean;
  // Crowd steering (Phase 20 stage 2, Houdini §3): the GPU wiring
  // of lib/steering.ts — seek / arrive / path following / two-state
  // switching as a velocity-pass force ('steer-seek'). Disabled
  // (default) keeps every shader string byte-identical: the block
  // exists only in the Phase 20 variant strings. Mode ids:
  // seek 0, arrive 1, path 2, state 3 (state reads the attribute
  // slot StateSlot: state 0 seeks Target, state 1 arrives at
  // Target1 — steeringForState's defaults). Path is a
  // semicolon-separated "x,y,z;x,y,z;…" list (max 8 points);
  // PathRadius 0 = always steer toward the path target (the
  // steering.ts law verbatim), > 0 = steer only outside the
  // corridor. MaxForce 0 = no clamp (steering.ts semantics).
  gpgpuSteerSeekEnabled: boolean;
  gpgpuSteerSeekMode: 'seek' | 'arrive' | 'path' | 'state';
  gpgpuSteerSeekStrength: number;
  gpgpuSteerSeekMaxSpeed: number;
  gpgpuSteerSeekMaxForce: number;
  gpgpuSteerSeekTargetX: number;
  gpgpuSteerSeekTargetY: number;
  gpgpuSteerSeekTargetZ: number;
  gpgpuSteerSeekTarget1X: number;
  gpgpuSteerSeekTarget1Y: number;
  gpgpuSteerSeekTarget1Z: number;
  gpgpuSteerSeekSlowingRadius: number;
  gpgpuSteerSeekStateSlot: number;
  gpgpuSteerSeekStateThreshold: number;
  gpgpuSteerSeekPath: string;
  gpgpuSteerSeekPathLookAhead: number;
  gpgpuSteerSeekPathRadius: number;
  // Path assets (Grammar 2.0 stage 2, B2): the path list as a
  // first-class asset (lib/gpgpuPathAssets.ts) — extra authored
  // paths as a JSON list, an authored SVG document whose
  // subpaths become paths, and the attribute slot that picks
  // a particle's path (-1 = every particle follows path 0).
  // All inert at their defaults (the legacy string alone is
  // the asset, supplied exactly as before).
  gpgpuSteerSeekPaths: string;
  gpgpuSteerSeekPathSvg: string;
  gpgpuSteerSeekPathSvgScale: number;
  gpgpuSteerSeekPathSlot: number;
  // Speed / relative drag / Spin (Grammar 2.0 stage 2, B3;
  // lib/gpgpuSpeedDragSpin.ts is the single resolution
  // point). Target speed: the velocity tail's final magnitude
  // setting (0 = off, the legacy clamps-only behaviour).
  // Relative drag: the 'rel-drag' force chunk relaxing the
  // velocity toward the wind velocity (rate 0 = off; the wind
  // speed is a velocity-unit magnitude along the legacy wind
  // direction). Spin: the accumulated angle / angular-velocity
  // channel in a dedicated ping-pong RT pair, consumed by the
  // two draw rotation systems (disabled = the analytic forms).
  // The three Slot keys modulate per particle through the
  // attribute slots (-1 = no modulation).
  gpgpuTargetSpeed: number;
  gpgpuTargetSpeedBlend: number;
  gpgpuTargetSpeedSlot: number;
  gpgpuRelDragRate: number;
  gpgpuRelDragWindSpeed: number;
  gpgpuRelDragSlot: number;
  gpgpuSpinEnabled: boolean;
  gpgpuSpinSpeed: number;
  gpgpuSpinRandom: number;
  gpgpuSpinDamping: number;
  gpgpuSpinSlot: number;
  // Orientation channel (Limit plan stage 4, S2;
  // lib/gpgpuOrient.ts is the single resolution point): a
  // full quaternion posture accumulated in a dedicated
  // ping-pong RT pair, consumed by the instanced-geometry
  // vertex innermost (align ∘ spin ∘ orient). Mode 'axis'
  // rotates about the fixed axis (0,1,0); 'velocity' about
  // the particle's velocity direction. The speed key is in
  // rad/s (unlike the Spin key's deg/s). Disabled = no pass,
  // no draw variant, byte-identical stock strings.
  gpgpuOrientEnabled: boolean;
  gpgpuOrientMode: 'axis' | 'velocity';
  gpgpuOrientSpeed: number;
  gpgpuOrientRandom: number;
  gpgpuOrientDamping: number;
  gpgpuOrientSlot: number;
  gpgpuSpringEnabled: boolean;
  gpgpuSpringStrength: number;
  // Morph Targets (Kinetix integration B1a): per-particle target points
  // baked into a float texture; the velocity shader pulls each particle
  // toward its assigned target with the Kinetix morph spring law.
  gpgpuMorphEnabled: boolean;
  gpgpuMorphTarget: 'trefoil' | 'torusKnot' | 'galaxy' | 'mobius' | 'geodesic' | 'crown' | 'blackhole' | 'klein' | 'cymatic' | 'gyroid' | 'dnaRibbon' | 'hypercube' | 'mandelbulb' | 'shell' | 'text' | 'image' | 'svg' | 'obj' | 'terrain' | 'data' | 'contour' | 'polygon';
  // Morph text font (Grammar 2.0 stage 2, E3): the font family
  // NAME the 'text' morph bake rasterises with, saved in the
  // config so a preset reproduces its text cloud (and its text
  // emission) without a session-only font selection. '' (the
  // default) falls back to the layer-2 TextMap family
  // (layer2TextMapFontFamily) — the legacy source, bit-identical.
  // Only the name is stored; a custom font FILE's bytes remain
  // session-only, as before.
  gpgpuMorphTextFont: string;
  // Noise-field morph supply (Phase 15, TD §1): on the 'image'
  // target, the bake's media map comes from the noise field's
  // static slice (lib/mapSourceSupply getNoiseFieldLuma) instead
  // of the layer-2 media snapshot. False = legacy snapshot path,
  // bit-identical.
  gpgpuMorphNoiseMapEnabled: boolean;
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
  // Terrain generation recipes (Phase AI): 'fbm' (default) is the
  // Phase L field bit-for-bit; 'ridge' / 'terrace' / 'cellular'
  // reshape the one shared height field, so the morph bake, the
  // terrain mesh, the derived maps and the collider all grow the
  // same landscape. TerraceSteps is only read by 'terrace'.
  gpgpuMorphTerrainKind: 'fbm' | 'ridge' | 'terrace' | 'cellular';
  gpgpuMorphTerrainTerraceSteps: number;
  // Terrain erosion (Phase AP): the generated height field is
  // re-carved by an iterative simulation at bake time — droplet
  // hydraulic erosion (Water / Droplets / Deposit / Seed) plus
  // thermal talus relaxation (Thermal / Talus / ThermalPasses).
  // The eroded field is ONE object every consumer reads (morph
  // bake, terrain mesh, derived maps + collider, shadow
  // occlusion, scatter), so the landscape never splits. Water 0
  // and Thermal 0 (defaults) resolve the whole grammar to null
  // and every consumer runs the analytic field verbatim, so the
  // legacy landscape stays bit-identical. Plane mode only: in
  // tunnel mode the config-side builders strip the erosion
  // options (the collider / slope-force precedent).
  gpgpuMorphTerrainErosionWater: number;
  gpgpuMorphTerrainErosionDroplets: number;
  gpgpuMorphTerrainErosionDeposit: number;
  gpgpuMorphTerrainErosionThermal: number;
  gpgpuMorphTerrainErosionTalus: number;
  gpgpuMorphTerrainErosionThermalPasses: number;
  gpgpuMorphTerrainErosionSeed: number;
  // Erosion mask (Phase 20 stage 3): an automatically generated
  // band over the pre-erosion height / slope / curvature that
  // scales erosion per cell. Mode 'off' (default) = no mask and
  // the Phase AP landscape stays bit-identical.
  gpgpuMorphTerrainErosionMaskMode: 'off' | 'height' | 'slope' | 'curvature' | 'image' | 'drawn';
  /** Erosion mask image (Phase 30): the luma grid the panel
   *  captured on assignment (129x129, row 0 = the fz = -E side,
   *  values 0..1). Empty = no image; mode 'image' without a
   *  valid grid resolves to no mask. */
  gpgpuMorphTerrainErosionMaskImageGrid: number[];
  /** Hand-drawn erosion mask (Round 83 gap 1): the same
   *  129x129 luma grid shape, painted on the panel canvas.
   *  Held separately from the image grid so the two can be
   *  switched between; mode 'drawn' without a valid grid
   *  resolves to no mask, exactly like 'image'. */
  gpgpuMorphTerrainErosionMaskDrawnGrid: number[];
  gpgpuMorphTerrainErosionMaskStrength: number;
  gpgpuMorphTerrainErosionMaskInvert: boolean;
  gpgpuMorphTerrainErosionMaskLow: number;
  gpgpuMorphTerrainErosionMaskHigh: number;
  // Terrain scatter grammar (Phase AI): a foliage-style placement
  // grammar for the terrain morph target — density / height band /
  // slope cap drive the bake's acceptance resampling, the aligned
  // normal writes the terrain normal into the companion cloud,
  // and the species count splits the height range into species
  // zones whose class scales the normal magnitude. Every key at
  // its default resolves the grammar to null, so the bake stays
  // bit-identical to the legacy grid tiling.
  gpgpuMorphScatterEnabled: boolean;
  gpgpuMorphScatterDensity: number;
  gpgpuMorphScatterHeightMin: number;
  gpgpuMorphScatterHeightMax: number;
  gpgpuMorphScatterSlopeMax: number;
  gpgpuMorphScatterAlignNormal: number;
  gpgpuMorphScatterSpecies: number;
  // Scatter finishing (Phase AX): per-particle randomisation and
  // posture bend on top of the Phase AI grammar, all applied to
  // the companion normal (the engine's per-particle orientation /
  // class channel). Scale random multiplies the species magnitude
  // by a deterministic per-particle factor in [1-r, 1+r]; rotation
  // random spins the normal's azimuth by up to ±r·π; bend leans
  // the normal toward downhill (and writes a leaning normal even
  // at alignment 0). All 0 (defaults) = the Phase AI bake verbatim.
  // NOTE: this is an orientation/posture finish on a point cloud,
  // not a mesh deformation. (Per-species mesh swap arrived in
  // Phase 16 stage 5 via the bake's speciesData channel and the
  // gpgpuGeomSpecies{2,3,4}Mode keys.)
  gpgpuMorphScatterScaleRandom: number;
  gpgpuMorphScatterRotRandom: number;
  gpgpuMorphScatterBend: number;
  // PCG rule graph (Phase 18 stage 3, lib/pcgGraph.ts): opens the
  // scatter pipeline's fixed order as a node list. Enabled false
  // (default) = the legacy scatter path verbatim; data '' = the
  // default graph, which evaluates bit-identically to legacy.
  gpgpuPcgGraphEnabled: boolean;
  gpgpuPcgGraphData: string;
  // Terrain collider (Phase AI): particles bounce / rest on the
  // height field itself (velocity reflection with restitution +
  // tangential friction in the velocity pass, surface push-out in
  // the position pass, sampling the derived collider bake). Only
  // live while the terrain mesh is enabled in plane mode (the
  // same gate as the slope force). Off (default) = the exact
  // legacy path; the terrain was NOT a particle collider before
  // this phase (occlusion source / slope force / morph target
  // only).
  gpgpuTerrainColliderEnabled: boolean;
  gpgpuTerrainColliderBounce: number;
  gpgpuTerrainColliderFriction: number;
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
  // Path offset (Phase AM, lib/pathGeometry.ts): every subpath
  // is shifted sideways by this distance (normalised units,
  // positive = left of travel = outward for CCW closed paths)
  // before placement, in every path mode. 0 = the authored
  // geometry itself (identity).
  gpgpuMorphPathOffset: number;
  // Text on path (Phase AF2, lib/gpgpuTextOnPath.ts): with the
  // path target active, the layer-2 TextMap string is laid out
  // glyph by glyph along the authored path — each glyph's luma
  // raster becomes a particle block centred on the path, in
  // reading order. Delay staggers the glyphs' arc-length slots
  // (0 = evenly spaced, the plain along placement); Size scales
  // the glyph cell against the path pitch. Deterministic: glyph
  // blocks never consume the shared bake RNG stream. Default off
  // = the legacy path bake, bit-identical.
  gpgpuMorphTextOnPathEnabled: boolean;
  gpgpuMorphTextOnPathDelay: number;
  gpgpuMorphTextOnPathSize: number;
  // Per-glyph deformation (Phase AM, lib/gpgpuTextOnPath.ts):
  // each glyph's local placement is scaled / rotated by a
  // deterministic per-index amount, and Fade thins glyphs by
  // dropping a per-glyph fraction of their particles back to
  // the plain path placement (density fade — the bake's alpha
  // channel belongs to the replica phase). All 0 (defaults) =
  // the deform option is absent and the AF2 bake is verbatim.
  gpgpuMorphTextOnPathGlyphScale: number;
  gpgpuMorphTextOnPathGlyphRotate: number;
  gpgpuMorphTextOnPathGlyphFade: number;
  // Vertical text on path (Phase 17, lib/gpgpuTextOnPath.ts):
  // the string is planned as vertical columns by the shared
  // TextMap layout and laid along the path in column reading
  // order, each glyph upright against the path's progression.
  // Default OFF = the AF2 single-line layout bit-identical.
  gpgpuMorphTextOnPathVertical: boolean;
  // Contour target (Phase AM, lib/contourTrace.ts): the
  // 'contour' morph target traces the outline of a luma source
  // (marching squares) into paths and places particles along
  // them. Source selects which luma grid is traced ('text' =
  // the layer-2 TextMap raster, 'image' = the layer-2 media
  // luma map); Threshold is the marching-squares level (0.3 =
  // the media grammar's threshold).
  gpgpuMorphContourSource: 'text' | 'image';
  gpgpuMorphContourThreshold: number;
  // Polygon morph target (Phase AW): the number of sides of the
  // regular-polygon plate the 'polygon' target bakes (3..12).
  // Only consulted by the polygon target; every other target
  // ignores it, so the default changes nothing elsewhere.
  gpgpuMorphPolygonSides: number;
  // Voronoi fracture (Phase AG, lib/voronoiFracture.ts): a
  // post-pass over the morph bake — the cloud is partitioned
  // into seeded Voronoi cells and each cell is shrunk toward its
  // centroid and pushed away from the shape centre by Gap.
  // Deterministic (same cloud + seed → same division). Default
  // off = the legacy bake, bit-identical on every routing.
  gpgpuMorphFractureEnabled: boolean;
  gpgpuMorphFractureCells: number;
  gpgpuMorphFractureSeed: number;
  gpgpuMorphFractureGap: number;
  // Fragment collection (Phase 17 stage 4, lib/fragmentCollection.ts):
  // one saved fracture division as a named asset — JSON string
  // holding the bake signature, the per-particle cell assignment
  // (RLE + base64) and the glue-bond clusters. Empty = nothing
  // saved, which keeps every routing bit-identical; the stored
  // form is only ever compared against the current bake
  // conditions, never silently applied.
  gpgpuFragmentCollectionJson: string;
  // Fragment restore (Phase 20 stage 1): while on (AND the
  // rigid solver is on), a saved collection whose signature
  // matches the current bake conditions exactly is fed back
  // into the bake as the division; a mismatch is refused and
  // reported, never silently applied. Default off = the legacy
  // bake, bit-identical.
  gpgpuFragmentCollectionRestoreEnabled: boolean;
  // Morph-surface fibers (Phase AG, lib/morphFiber.ts): strands
  // grown from the morph bake's surface points along their
  // normals (radial fallback), drawn by an independent overlay
  // component. Purely additive rendering — the simulation never
  // reads it. Default off = nothing drawn, bit-identical.
  gpgpuMorphFiberEnabled: boolean;
  gpgpuMorphFiberCount: number;
  gpgpuMorphFiberLength: number;
  gpgpuMorphFiberCurl: number;
  // Fiber grooming (Phase AL): a global groom direction the strand
  // tangents align toward (zero vector = no grooming), plus a
  // per-strand length distribution width. Both default to the
  // Phase AG behaviour byte-for-byte (no extra rng draws at 0).
  gpgpuMorphFiberGroomX: number;
  gpgpuMorphFiberGroomY: number;
  gpgpuMorphFiberGroomZ: number;
  gpgpuMorphFiberGroomAlign: number;
  gpgpuMorphFiberLengthVar: number;
  // Fiber root source (Phase 15, Houdini §11): which surface the
  // strands root on. 'morph' (default) is the Phase AG path,
  // byte-identical. 'emit' roots on the initial (spawn) cloud —
  // fibers then work with morph disabled. 'terrain' roots on the
  // morph terrain heightfield (the bake's terrain target with the
  // current terrain parameters), also without morph enabled.
  gpgpuMorphFiberRootSource: 'morph' | 'emit' | 'terrain';
  // Groom field (Phase 15, Houdini §11): how the groom direction
  // varies across the surface. 'uniform' (default) is the Phase
  // AL global vector, byte-identical. The other modes evaluate a
  // direction per root position (radial / swirl around Y / a trig
  // noise field at GroomFieldScale) — position functions only,
  // never rng draws, so strand picks stay identical.
  gpgpuMorphFiberGroomField: 'uniform' | 'noise' | 'radial' | 'swirl';
  gpgpuMorphFiberGroomFieldScale: number;
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
  // OBJ vertex deformation (Phase 30, §11-3 T4,
  // lib/objMeshDeform.ts): analytic deformation injected into
  // the mesh materials. 'off' (default) injects nothing and
  // the mesh renders exactly as before.
  gpgpuObjMeshDeformMode: 'off' | 'wave' | 'twist' | 'bend';
  /** Deformation depth 0..1 (per-mode mapping in the lib). */
  gpgpuObjMeshDeformAmount: number;
  /** Spatial frequency multiplier 0..3. */
  gpgpuObjMeshDeformFrequency: number;
  /** Phase speed 0..2; 0 = a static deformed shape. */
  gpgpuObjMeshDeformSpeed: number;
  // Verlet Integration
  gpgpuVerletEnabled: boolean;
  // Vellum constraint solver (Phase AR): a PBD-family distance-
  // constraint solve over the pool's texel grid. While Enabled,
  // the pool's initial data is a structured grid bake (sheet /
  // shell — lib/gpgpuVellum.ts) so texel adjacency is the cloth
  // topology, and a dedicated projection pass iterates distance
  // constraints (structural / shear / bend) with pinning, a
  // normal-direction pressure force and optional link tearing.
  // CPU-side resolution while Enabled: age respawn / kill
  // conditions / spawn gate / morph attraction / replica stacks /
  // pointer paint are suppressed (they would break the grid);
  // Verlet is NOT forced (the projection is integrator-
  // independent). Enabled false (default) = every path verbatim
  // legacy. This is a position-projection solver, not XPBD:
  // stiffness is an effective rate, there is no compliance unit
  // and no self-collision.
  gpgpuVellumEnabled: boolean;
  gpgpuVellumMode: 'sheet' | 'shell';
  gpgpuVellumStiffness: number;
  gpgpuVellumBend: number;
  gpgpuVellumSubsteps: number;
  gpgpuVellumPin: 'none' | 'top' | 'corners' | 'topCorners';
  gpgpuVellumPressure: number;
  gpgpuVellumTear: number;
  gpgpuVellumDamping: number;
  // Constraint usages (Phase BB): stitch and glue. Stitch is a
  // velocity-coupling pass over the structural links — after the
  // projection each texel's velocity blends toward its live-link
  // neighbours' average, so pulls transmit as momentum along the
  // seams. 0 (default) = the pass never runs and velocities are
  // verbatim legacy (the AR solver was position-only). Glue is a
  // zero-rest-length distance link from each texel to its own
  // bake point inside the projection (glue-to-target; the target
  // is the pool's baked shape), with an optional break threshold
  // in world units of displacement from the bake point
  // (0 = unbreakable). Both 0 (defaults) = verbatim legacy.
  gpgpuVellumStitch: number;
  gpgpuVellumGlue: number;
  gpgpuVellumGlueBreak: number;
  // XPBD completion (Phase 19 stage 3): solver mode switch.
  // 'legacy' (default) runs the AR/BB passes verbatim — the new
  // passes and pools are never created. 'xpbd' reinterprets
  // Substeps as XPBD substeps and solves the same links with
  // per-constraint Δλ accumulation and physical compliance
  // (lib/xpbdConstraints.ts). The compliance keys are the XPBD
  // α in physical units (cell mass = 1); 0 = rigid. Volume keys
  // add a single global volume-preservation constraint (shell
  // mode only — an open sheet has no volume). TearGap pushes the
  // two sides of a dead link apart in the projection and doubles
  // as the crack-visualisation switch (no separate key).
  gpgpuVellumSolverMode: 'legacy' | 'xpbd';
  gpgpuVellumCompliance: number;
  gpgpuVellumBendCompliance: number;
  gpgpuVellumVolumeEnabled: boolean;
  gpgpuVellumVolumeRatio: number;
  gpgpuVellumVolumeCompliance: number;
  gpgpuVellumTearGap: number;
  // SDF Collider ('gyroid' added by Kinetix integration B3: the TPMS
  // gyroid surface as a signed-distance collider, Kinetix 'gyro')
  gpgpuSdfEnabled: boolean;
  gpgpuSdfShape: 'sphere' | 'box' | 'torus' | 'capsule' | 'gyroid';
  gpgpuSdfX: number;
  gpgpuSdfY: number;
  gpgpuSdfZ: number;
  gpgpuSdfSize: number;
  gpgpuSdfBounce: number;
  // Mesh SDF Collider (Phase BY): the imported OBJ mesh (the SAME
  // gpgpuMorphObjSource the morph target reads) baked into a
  // signed distance grid on the CPU and sampled as a 3D texture
  // by the sim passes — an arbitrary closed mesh as a collider,
  // in a separate slot next to the analytic SDF above (both may
  // be live; the analytic push-out applies first). The bake is
  // async and the collider exists only while it has completed,
  // so disabled / baking / open-mesh all resolve to the legacy
  // path. Placement is the morph placement (origin, morph world
  // scale) — see lib/meshSdfCollider.ts. Disabled by default.
  gpgpuMeshSdfEnabled: boolean;
  /** Bake resolution (one of 32 / 48 / 64 / 96 / 128). */
  gpgpuMeshSdfResolution: number;
  gpgpuMeshSdfBounce: number;
  gpgpuMeshSdfFriction: number;
  // Multi-body mesh SDF (atlas of up to 4 bodies in the single
  // uMeshSdfTex slot; body 1 is the single collider above, bodies
  // 2-4 have their own OBJ source / offset / scale). Master switch
  // off = the single-body path is untouched. See
  // lib/meshSdfCollider.ts (buildMeshSdfAtlas).
  gpgpuMeshSdfMultiEnabled: boolean;
  gpgpuMeshSdfBody2ObjSource: string;
  gpgpuMeshSdfBody2OffsetX: number;
  gpgpuMeshSdfBody2OffsetY: number;
  gpgpuMeshSdfBody2OffsetZ: number;
  /** Multiplier of meshSdfWorldScale(config) for this body. */
  gpgpuMeshSdfBody2Scale: number;
  gpgpuMeshSdfBody2Bounce: number;
  gpgpuMeshSdfBody2Friction: number;
  gpgpuMeshSdfBody3ObjSource: string;
  gpgpuMeshSdfBody3OffsetX: number;
  gpgpuMeshSdfBody3OffsetY: number;
  gpgpuMeshSdfBody3OffsetZ: number;
  gpgpuMeshSdfBody3Scale: number;
  gpgpuMeshSdfBody3Bounce: number;
  gpgpuMeshSdfBody3Friction: number;
  gpgpuMeshSdfBody4ObjSource: string;
  gpgpuMeshSdfBody4OffsetX: number;
  gpgpuMeshSdfBody4OffsetY: number;
  gpgpuMeshSdfBody4OffsetZ: number;
  gpgpuMeshSdfBody4Scale: number;
  gpgpuMeshSdfBody4Bounce: number;
  gpgpuMeshSdfBody4Friction: number;
  // Point cache playback (Phase BZ): an imported numbered-PLY
  // point cache (lib/pointCache.ts) follows the shared sequence
  // clock and drives the attribute point cloud frame by frame
  // through the transient setter, so the morph 'data' target and
  // the attribute 'data' source animate. Disabled by default —
  // the driver never runs and the cloud is never touched.
  pointCacheEnabled: boolean;
  /** Wrap at the cache's own duration (ANDed with the manifest's
   *  loop declaration); off clamps on the last frame. */
  pointCacheLoop: boolean;
  /** Use the bundled sample cache when no file cache is loaded
   *  (the BZ starter's source). A loaded file cache wins. */
  pointCacheBundledSample: boolean;
  // Retimer (Grammar 2.0 stage 3, slice S2 —
  // lib/cacheRetimer.ts): a playback-side frame mapping for
  // the cache playback above (rate / range / reverse /
  // interpolation override), shared by point caches and by
  // state caches played through the same path. Playback
  // only — the simulation's timeScale is a separate
  // mechanism and is never touched. Disabled by default:
  // the driver resolves no retimer and the legacy mapping
  // runs untouched.
  pointCacheRetimerEnabled: boolean;
  /** Playback rate multiplier (> 0). 1 is the legacy speed. */
  pointCacheRetimerRate: number;
  /** First frame of the retimed range (0-based). */
  pointCacheRetimerStartFrame: number;
  /** Last frame of the retimed range; -1 means the cache's
   *  own last frame. */
  pointCacheRetimerEndFrame: number;
  /** Play the range backwards (from its end to its start). */
  pointCacheRetimerReverse: boolean;
  /** Interpolation override: 'inherit' keeps the manifest's
   *  declared interpolation (the legacy behaviour). */
  pointCacheRetimerInterpolation: 'inherit' | 'linear' | 'nearest';
  // Skinning (stage 3 S6): parameters of the isosurface
  // export that turns a held state cache into a mesh
  // series (lib/stateCacheSkinning.ts). Export-action
  // parameters only — nothing else reads them, and the
  // density kernel's own scale stays with the existing
  // SPH keys (gpgpuSphRadius / gpgpuSphRestDensity) and
  // the bounds key (gpgpuBounceRadius).
  /** Density-grid nodes per axis for the skinning export. */
  stateCacheSkinningResolution: number;
  /** Iso level of the skinning export, in field units
   *  (SPH kernel sum / rest density). */
  stateCacheSkinningIsoLevel: number;
  /** Particle-count limit of the skinning export; a cache
   *  above it is refused with the reason. */
  stateCacheSkinningMaxParticles: number;
  // Trail geometry (stage 3 S7): parameters of the export
  // that turns a held state cache into per-particle trail
  // tube documents (lib/stateCacheTrailGeometry.ts).
  // Export-action parameters only — nothing else reads
  // them, and no display trail key is bridged (the drawing
  // tubes' radii are draw parameters, not a definition
  // this data path shares).
  /** Tube radius of the trail geometry export, in world units. */
  stateCacheTrailRadius: number;
  /** Cross-section vertices per ring of the trail tube
   *  (integer, 3..32). */
  stateCacheTrailRadialSegments: number;
  /** Particle-count limit of the trail export; a cache
   *  above it is refused with the reason. */
  stateCacheTrailMaxParticles: number;
  /** History frame limit of the trail export; a longer
   *  cache contributes its most recent frames (the
   *  trailing window, stated in the export result). */
  stateCacheTrailMaxFrames: number;
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
  gpgpuAuxMode: 'none' | 'deathBurst' | 'bounceSplash' | 'sparkTrail' | 'birthBurst' | 'ruleSpawn' | 'emit';
  gpgpuAuxCount: number;
  gpgpuAuxIntensity: number;
  gpgpuAuxLife: number;
  gpgpuAuxSpeed: number;
  gpgpuAuxSize: number;
  // Child emitter (Grammar 2.0 stage 1, slice 1D-2): the 'emit'
  // mode turns a living source particle into an emitter that
  // sheds this level's particles at a rate (per second, rolled
  // per 60 Hz tick as rate/60) with a shaped velocity
  // distribution. The keys are read only while the mode is
  // 'emit'; the defaults (rate 30, sphere, spread 0.5) never
  // engage otherwise, and the mode itself defaults to the
  // legacy modes above ('none' included), so an untouched
  // config is bit-identical to before.
  gpgpuAuxEmitRate: number;
  gpgpuAuxEmitShape: 'sphere' | 'cone' | 'disc' | 'point';
  gpgpuAuxEmitSpread: number;
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
  // Spawn inheritance (Grammar 2.0 stage 1, slice 1D-1): at spawn
  // time the velocity pass's decision is mirrored into a per-level
  // inheritance texture (parent attribute slots 0/1/2 + species),
  // which the chain copies down particle-by-particle and the draw
  // can blend into the level colour. Every default reproduces the
  // legacy behaviour: velocity scale 1 (the legacy trail / birth
  // coefficients unchanged), colour mix 0 (the level colour alone),
  // slots 1 (the inheritance texture is generated while Aux runs).
  gpgpuAuxInheritVelScale: number;
  gpgpuAuxInheritColor: number;
  gpgpuAuxInheritSlots: number;
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
  gpgpuAux2Mode: 'none' | 'deathBurst' | 'bounceSplash' | 'sparkTrail' | 'birthBurst' | 'emit';
  gpgpuAux2Intensity: number;
  gpgpuAux2Life: number;
  gpgpuAux2Speed: number;
  gpgpuAux2Size: number;
  // Child emitter (slice 1D-2): the Aux2 counterparts of the
  // emit keys above, shared by chain levels 2 and 3 exactly
  // like the rest of the Aux2 set.
  gpgpuAux2EmitRate: number;
  gpgpuAux2EmitShape: 'sphere' | 'cone' | 'disc' | 'point';
  gpgpuAux2EmitSpread: number;
  gpgpuAux2GravityScale: number;
  gpgpuAux2Drag: number;
  gpgpuAux2Curl: number;
  gpgpuAux2Color: string;
  // Emission Shape ('light' added by Phase T: particles are emitted
  // from the 3D light's position — a pure position reference, like
  // Particular's Light Emitter; it works whether or not the light
  // itself is enabled).
  gpgpuEmitShape: 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone' | 'light';
  // Respawn shape (Grammar 2.0 stage 2, E1): 'auto' = the
  // legacy respawn placement; any other value places respawns
  // through the shared bake shape law (lib/gpgpuEmitShapes.ts).
  gpgpuRespawnShape: 'auto' | 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone' | 'light';
  // Distribution operators (Grammar 2.0 stage 2, B5): a JSON
  // list of fixed operators (power / invert / stratify /
  // cluster) layered over the shape law's placed point, in
  // the bake and the respawn alike (lib/gpgpuDistribution.ts).
  // '' (default) = no layer — bit-identical legacy placement.
  gpgpuEmitDistribution: string;
  // Shader seed (Grammar 2.0 stage 2, B5): the opt-in that
  // lets a seed reach the respawn hash draws (judgment 3 —
  // seeds reach shaders only through a new key's opt-in).
  // 0 (default) = off; the legacy hash phase stands.
  gpgpuShaderSeed: number;
  // Emission source (Grammar 2.0 stage 2, E3): where (re)births
  // are placed FROM. 'shape' (default) is the legacy analytic
  // shape law above (bit-identical). 'morph' draws placements
  // from the morph target's sample cloud — the same baked cloud
  // the morph force targets, used at birth instead of as a
  // target (lib/gpgpuEmissionSource.ts). 'bitmap' draws from a
  // sample cloud built from the layer-2 media luma map by the
  // ported CPU media sampler. 'path' places on the steering
  // path polyline (the gpgpuSteerSeekPath point list, shared
  // with Path Follow) with the bake's initial velocity along
  // the path tangent.
  gpgpuEmitSource: 'shape' | 'morph' | 'bitmap' | 'path';
  // Bitmap emission cloud (E3): the ported CPU sampler's
  // threshold / relief depth / invert (defaults = the CPU
  // layer sampler's media defaults). Only read while the
  // emission source is 'bitmap'.
  gpgpuEmitBitmapThreshold: number;
  gpgpuEmitBitmapDepth: number;
  gpgpuEmitBitmapInvert: boolean;
  // Path emission (E3): the bake's initial speed along the
  // path tangent. 0 keeps the legacy velocity draws. Only
  // read while the emission source is 'path'.
  gpgpuEmitPathSpeed: number;
  // Emission mask (E3): while on, placements (bake + respawn)
  // are gated by the Phase X raster mask — the bake consults
  // the config mask grid, the respawn consults the mask
  // texture with the kill mask's own UV rule / threshold /
  // invert. Off (default) = no gating anywhere.
  gpgpuEmitMaskEnabled: boolean;
  // Emitter transform (stage 2, E0): position / rotation in
  // degrees / uniform scale of the emitter frame, applied to
  // placements on the bake and the respawn alike. The
  // defaults (0 / 0 / 1) are the identity transform.
  gpgpuEmitterPosX: number;
  gpgpuEmitterPosY: number;
  gpgpuEmitterPosZ: number;
  gpgpuEmitterRotX: number;
  gpgpuEmitterRotY: number;
  gpgpuEmitterRotZ: number;
  gpgpuEmitterScale: number;
  // Emitter initial velocity (Grammar 2.0 stage 2, E2): the
  // general port of the spawn event's directly specified
  // velocity. 'cube' (default) is the legacy bake scatter
  // (±2 cube, no respawn reset — every string and array is
  // the shipped one). 'directed' hands each (re)birth the
  // velocity of lib/gpgpuLifecycle.ts directedInitialVelocity:
  // direction blended from the authored axis toward a hash
  // sphere direction by Spread, magnitude Speed jittered by
  // the same blend. Applies at the bake and on the spawn-gate
  // activation frame; age respawns keep the legacy no-reset.
  gpgpuEmitterVelMode: 'cube' | 'directed';
  gpgpuEmitterVelDirX: number;
  gpgpuEmitterVelDirY: number;
  gpgpuEmitterVelDirZ: number;
  gpgpuEmitterVelSpeed: number;
  gpgpuEmitterVelSpread: number;
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
  // Light units 2-4 (Grammar 2.0 stage 2, E4): the Phase T
  // light becomes a unit list (lib/gpgpuLightUnits.ts is the
  // single resolution point). Unit 1 IS the legacy light above;
  // units 2-4 are point lights (no cone) with their own
  // position / radius / intensity, mirroring unit 1's defaults
  // and shipping disabled, so every existing config resolves
  // bit-identically. Enabled extra units join the points draw
  // (multiplicatively) and the Phase Z occlusion bake's light
  // list. The volume / trail / true shadow map stay unit-1
  // features.
  gpgpuLight2Enabled: boolean;
  gpgpuLight2PosX: number;
  gpgpuLight2PosY: number;
  gpgpuLight2PosZ: number;
  gpgpuLight2Intensity: number;
  gpgpuLight2Radius: number;
  gpgpuLight3Enabled: boolean;
  gpgpuLight3PosX: number;
  gpgpuLight3PosY: number;
  gpgpuLight3PosZ: number;
  gpgpuLight3Intensity: number;
  gpgpuLight3Radius: number;
  gpgpuLight4Enabled: boolean;
  gpgpuLight4PosX: number;
  gpgpuLight4PosY: number;
  gpgpuLight4PosZ: number;
  gpgpuLight4Intensity: number;
  gpgpuLight4Radius: number;
  // Which light unit the 'light' emit shape places around
  // (1-4, default 1 = the legacy light position). A pure
  // position reference like the legacy behaviour: the named
  // unit's draw enable is not consulted.
  gpgpuEmitLightUnit: number;
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
  // Scene depth occlusion (Phase 16 stage 1): strength of the
  // depth-based fade applied to LightVolume and the Lux cone from
  // the shared scene depth capture (lib/sceneDepth.ts). 0 (default)
  // = the capture never mounts and both consumers run their legacy
  // formulas verbatim.
  gpgpuDepthOcclusion: number;
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
  // True shadow map (Phase 22 stage 4, wiring stage 1;
  // Phase 23, wiring stage 2): the Phase T light's viewpoint
  // depth, captured only while the strength is positive
  // (components/LightShadowCapture.tsx) and received by the
  // terrain mesh (stage 1) and the GPGPU points (stage 2,
  // behind the shadowMap draw-shader variant). This is the
  // ONLY feature called a shadow map; the Phase Z feature
  // above stays an occlusion-map approximation. 0 (default)
  // = the capture never mounts, the store stays null and no
  // receiver shader carries the chunk — bit-identical to
  // v2.03.0.
  /** Shadow map darkness 0..1; 0 keeps every receiver identical. */
  gpgpuShadowMapStrength: number;
  /** Depth comparison bias (acne avoidance). */
  gpgpuShadowMapBias: number;
  /** PCF blur radius in texels; 0 = hard shadow. */
  gpgpuShadowMapSoftness: number;
  /** Particle self-shadowing (limit plan stage 4, slice S4):
   *  while true, the main pool casts into the shadow map —
   *  the geometry instances via a dedicated instanced depth
   *  material and the points via a dedicated point-size depth
   *  draw, both rendered by LightShadowCapture into the same
   *  target after the scene pass. False (default) = the
   *  capture is byte-identical to before this slice: particles
   *  never cast and no caster pass exists. Only takes effect
   *  while the capture is mounted (strength > 0). */
  gpgpuShadowMapCastParticles: boolean;
  /** Diameter multiplier for the points depth draw (the geom
   *  instances cast at their true instanced scale and ignore
   *  this). Resolved with a clamp in lib/lightShadowMap.ts. */
  gpgpuShadowMapParticleSize: number;
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
  gpgpuGradDriver: 'life' | 'velocity' | 'spatial' | 'prism' | 'image' | 'blackbody' | 'height' | 'noise';
  gpgpuGradStart: string;
  gpgpuGradMid: string;
  gpgpuGradEnd: string;
  // Extra gradient stops (Phase AH): fixed positions 0.25 / 0.75.
  // Empty string = unspecified; both empty reproduces the legacy
  // 3-stop LUT bit-for-bit.
  gpgpuGradQuarter: string;
  gpgpuGradThreeQuarter: string;
  // Stop positions for the extra stops (Phase AW): defaults are
  // the Phase AH fixed positions (0.25 / 0.75), so every existing
  // preset resolves bit-identically. Only consulted while the
  // matching stop colour is specified.
  gpgpuGradQuarterPos: number;
  gpgpuGradThreeQuarterPos: number;
  // Arbitrary stop list (Phase BE): parallel arrays of positions
  // (0..1) and colours. Both empty = derive the ramp from the legacy
  // keys above (bit-identical); a resolved list (>= 2 valid pairs)
  // replaces the legacy stops entirely.
  gpgpuGradStopPositions: number[];
  gpgpuGradStopColors: string[];
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
  gpgpuSpriteFrameMode: 'age' | 'fps' | 'random' | 'channel';
  gpgpuSpriteFrameFps: number;
  // Sprite frame channel drive (Limit plan stage 4, S3,
  // lib/spriteSheet.ts): in 'channel' mode a per-particle
  // channel value (age ratio / speed / attribute slot / live
  // state id / live rule bits), divided by the range and
  // clamped to [0, 1], sweeps the sheet like age mode sweeps
  // normAge. The defaults (ageRatio / slot -1 / range 1) are
  // inert: the draw variant stands only in 'channel' mode, so
  // every legacy mode keeps its byte-identical strings.
  gpgpuSpriteFrameChannel: 'ageRatio' | 'speed' | 'attr' | 'state' | 'rule';
  gpgpuSpriteFrameSlot: number;
  gpgpuSpriteFrameRange: number;
  gpgpuSpriteLoop: boolean;
  // Sprite rotation (Phase AX, lib/spriteRotation.ts): the point
  // sprite itself rotates with the particle's age — angle =
  // initial + speed · ∫exp(−damping·a)da, so damping bleeds the
  // spin off over the life. Random spreads the per-particle speed
  // multiplier by the particle seed (×[1−r, 1+r]). All defaults
  // (0 / 0 / 0 / 0) keep the legacy un-rotated sampling verbatim:
  // the draw shader only rotates while initial or speed is set.
  // The geometry spin (gpgpuGeomSpin*) is a separate, older path.
  gpgpuSpriteRotInitial: number;
  gpgpuSpriteRotSpeed: number;
  gpgpuSpriteRotDamping: number;
  gpgpuSpriteRotRandom: number;
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
  // Age free curves (Grammar 2.0 stage 2, B4): per-target free
  // control-point assets (lib/freeCurve.ts flat [t, v, …] form)
  // over the same normalised age. While a target's FreeEnabled
  // is on (and the target itself is enabled), the free curve
  // replaces the 5-point curve as that target's evaluation
  // source; off (the default) the 5-point path is untouched.
  // Resolution: lib/gpgpuAgeFreeCurves.ts.
  gpgpuAgeCurveSizeFreeEnabled: boolean;
  gpgpuAgeCurveSizeFreePoints: number[];
  gpgpuAgeCurveOpacityFreeEnabled: boolean;
  gpgpuAgeCurveOpacityFreePoints: number[];
  gpgpuAgeCurveVelocityFreeEnabled: boolean;
  gpgpuAgeCurveVelocityFreePoints: number[];
  gpgpuAgeCurveForceFreeEnabled: boolean;
  gpgpuAgeCurveForceFreePoints: number[];
  gpgpuAgeCurveRotationFreeEnabled: boolean;
  gpgpuAgeCurveRotationFreePoints: number[];
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
  // Noise field map (Phase AY): the scalar noise field (the
  // velocity pass's vnoise, lib/noiseFieldMap.ts) as a map
  // source for the points draw. Scale is the field frequency
  // over world position; evolve is the field's time-evolution
  // rate (0 = static field). The size / displacement amounts
  // gate their consumers (0 = the legacy path, the field is
  // never sampled); colour consumes the field through the
  // 'noise' gradient driver instead of a dedicated amount.
  gpgpuNoiseMapScale: number;
  gpgpuNoiseMapEvolve: number;
  // Noise-field supply time (Phase 15, TD §1): the static slice
  // the supply path (layer maps, morph bake) rasterises is taken
  // at this field time — the field's evolve offset applied at
  // t = this value. 0 = the legacy z=0/time-0 slice, bit-identical.
  // Live per-frame regeneration is deliberately not offered (the
  // slice stays a deterministic snapshot; see Phase AH notes).
  gpgpuNoiseFieldSupplyTime: number;
  gpgpuNoiseMapSizeAmount: number;
  gpgpuNoiseMapDisplaceAmount: number;
  // Noise field grammar (Phase BJ): the field's kind (the
  // octave reading: perlin / ridge / turbulence) and its fBm
  // octave count (1–5). The defaults ('perlin', 1) reproduce
  // the Phase AY field bit-for-bit. The same pair also shapes
  // the 'noise-field' map supply slice.
  gpgpuNoiseMapKind: string;
  gpgpuNoiseMapOctaves: number;
  gpgpuMaskSource: string;
  gpgpuMaskMode: 'off' | 'clip' | 'shape';
  gpgpuMaskThreshold: number;
  gpgpuMaskInvert: boolean;
  gpgpuMaskMap: number[];
  gpgpuMaskMapWidth: number;
  gpgpuMaskMapHeight: number;
  // Raster-mask Boolean composition (Phase BF): a second
  // captured luminance grid (the operand) plus the selected op.
  // The UI combines operand into gpgpuMaskMap on demand
  // (lib/shapeBoolean.ts); nothing consumes these keys per
  // frame, so they never change a render by themselves.
  gpgpuMaskBoolOp: import('../lib/shapeBoolean').MaskBoolOp;
  gpgpuMaskBoolOperandMap: number[];
  gpgpuMaskBoolOperandWidth: number;
  gpgpuMaskBoolOperandHeight: number;
  // Vector Boolean composition (Phase 17 stage 2): the geometric
  // counterpart of the raster Boolean above. A is the morph SVG
  // source (gpgpuMorphSvgSource, reused), B is the SVG text
  // below; the composition runs in the CSG worker over
  // manifold-3d CrossSection only when the UI button is pressed,
  // and the resulting SVG is stored as a derived key. Nothing
  // consumes these keys per frame.
  gpgpuVectorBoolOp: import('../lib/vectorBoolean').VectorBoolOp;
  gpgpuVectorBoolSourceB: string;
  gpgpuVectorBoolResultSvg: string;
  // Text extrusion (Phase 17 stage 3): the string set in an
  // uploaded font (TTF/OTF, held in session memory only — the
  // font bytes are NOT a config key) is extruded through the
  // CrossSection path when the UI button is pressed and the
  // result is taken into the morph path. Nothing consumes
  // these keys per frame.
  gpgpuTextExtrudeText: string;
  gpgpuTextExtrudeDepth: number;
  gpgpuTextExtrudeFlatness: number;
  // Path raster supply stroke width (Phase AF2): the stroke
  // radius of the 'path-raster' internal supply, in normalised
  // cloud units. 0.045 is the Phase AF fixed convention, so the
  // default keeps every existing render bit-identical; the fill
  // modes are source-string suffixes (path-raster:fill-evenodd /
  // path-raster:fill-nonzero), not keys.
  gpgpuPathRasterStrokeWidth: number;
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
  /** Multi-pointer interference (Phase AO): when on, up to 4
   *  simultaneous pointers each exert the mouse force; off keeps
   *  the single-pointer path verbatim. */
  gpgpuMouseMultiTouch: boolean;
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
  // FLIP layer (Phase AT): particle<->grid transfer + Jacobi
  // pressure projection on the 2D (xz) fluid field. All keys
  // are inert unless gpgpuFlipEnabled (and the fluid field) is
  // on; defaults keep the legacy one-way field sample verbatim.
  gpgpuFlipEnabled: boolean;
  gpgpuFlipBlend: number;
  gpgpuFlipPressureIterations: number;
  gpgpuFlipTransfer: number;
  // Vorticity confinement (Phase DL, DD5a): two extra passes
  // on the composite field before the pressure projection
  // (curl, then the Fedkiw confinement force). Inert unless
  // the FLIP layer is on AND this toggle is on AND epsilon
  // > 0; the defaults keep the projected field byte-identical.
  gpgpuFlipVorticityEnabled: boolean;
  gpgpuFlipVorticityEpsilon: number;
  // FLIP 3D completion (Phase 19 stage 2): the opt-in 3D grid
  // mode. '2d' (default) = the Phase AT planar layer above,
  // verbatim — no 3D target is allocated and no 3D pass runs.
  // '3d' swaps the grid for an atlas-packed 3D FLIP solver
  // (lib/flip3d.ts / components/gpgpuShaderSimulationFlip3d.ts)
  // with a particle-derived free surface; the 2D field still
  // advects as before but no longer carries the FLIP transfer.
  gpgpuFlipMode: '2d' | '3d';
  // 3D grid resolution: 0 (default) = GPU-tier auto via the
  // shared pyro atlas resolution rule (entry 32 / standard 48 /
  // high+flagship 64; 96 manual, flagship only).
  gpgpuFlip3dResolution: number;
  // Grid viscosity (Phase 19 stage 2): dynamic-viscosity-style
  // coefficient in cells^2/s for the implicit (Helmholtz) grid
  // viscosity solve. 0 (default) = the viscosity passes do not
  // exist. 3D mode only.
  gpgpuFlipViscosity: number;
  // Grid surface tension (Phase 19 stage 2): CSF coefficient
  // sigma for the curvature force on the free surface. 0
  // (default) = neither the curvature nor the force pass
  // exists. 3D mode only.
  gpgpuFlipSurfaceTension: number;
  gpgpuDensityCompEnabled: boolean;
  gpgpuDensityCompTarget: number;
  // Whitewater (Phase BC): foam points derived from the FLIP
  // field — a one-way dependent pool that spawns where the
  // field's vorticity + convergence pass the threshold. All
  // keys are inert unless gpgpuWhitewaterEnabled (and the
  // fluid field + FLIP layer) is on; the default (off) keeps
  // every path verbatim. The foam lives on the 2D field plane:
  // no foam/spray separation.
  gpgpuWhitewaterEnabled: boolean;
  gpgpuWhitewaterAmount: number;
  gpgpuWhitewaterThreshold: number;
  gpgpuWhitewaterLife: number;
  gpgpuWhitewaterSize: number;
  // Rigid body solver (Phase AU): CPU solver (≤64 bodies from
  // the fracture bake's cell assignment) + small texture supply
  // + position-pass consumption. All keys are inert unless
  // gpgpuRigidEnabled is on AND a morph cloud exists to bind;
  // the default (off) keeps every path verbatim.
  gpgpuRigidEnabled: boolean;
  gpgpuRigidRestitution: number;
  gpgpuRigidFriction: number;
  gpgpuRigidGlueEnabled: boolean;
  gpgpuRigidGlueStrength: number;
  gpgpuRigidStartSleeping: boolean;
  // Terrain floor (Phase BA): while on, the solver's floor is
  // the published erosion heightfield (lib/terrainHeightfield.ts)
  // instead of the flat plane at gpgpuFloorY. No published field
  // (erosion off / tunnel mode) falls back to the plane, and the
  // default (off) keeps the plane path verbatim.
  gpgpuRigidFloorTerrain: boolean;
  gpgpuRigidFloorMultiSample: boolean;
  // Static boxes (UE5 #35 G-D stage D2): a JSON array of static
  // OBB colliders, { c: centre, h: half extents, e: Euler
  // degrees } per box (see parseRigidStaticBoxes in
  // lib/rigidBodies.ts). '' (the default) places none and keeps
  // every step verbatim.
  gpgpuRigidStaticBoxes: string;
  // XPBD joints + stress breaking (Phase 20 stage 1): joints
  // are XPBD centre-distance constraints built with the glue
  // adjacency rule, and stress breaking replaces the legacy
  // glue break conditions with per-bond stress + propagation.
  // Both are inert unless their switch is on; the defaults
  // (off / α 0 / threshold 0 = unbreakable) keep every legacy
  // path verbatim.
  gpgpuRigidJointEnabled: boolean;
  gpgpuRigidJointCompliance: number;
  gpgpuRigidJointBreakThreshold: number;
  // Anchored joints (UE5 #35 G-C): off / 0 keep the centre-
  // distance joints verbatim.
  gpgpuRigidJointAnchorEnabled: boolean;
  gpgpuRigidJointAngleLimitDeg: number;
  gpgpuRigidStressBreakEnabled: boolean;
  gpgpuRigidStressPropagation: number;
  // OBB shape collision (Phase 20 stage 1): while on, the
  // pair narrow phase and the floor test use each body's
  // fitted OBB (lib/rigidObb.ts) instead of its bounding
  // sphere. The default (off) keeps the sphere paths verbatim.
  gpgpuRigidConvexEnabled: boolean;
  // OBB box inertia (Round 84 gap 6, stage 1): while on (AND
  // the Convex key is on), shaped bodies answer angular
  // responses with the box inertia tensor instead of the
  // sphere tensor. Off (default) is bit-identical to before.
  gpgpuRigidConvexInertia: boolean;
  // Field force coupling (Round 84 gap 3, stage 1): while on,
  // the curl field twin is sampled at each body's centre once
  // per frame and applied to the solver as an external
  // acceleration. Off (default) is bit-identical to before.
  // Source: only 'curl' is wired in stage 1.
  gpgpuRigidForceEnabled: boolean;
  gpgpuRigidForceSource: string;
  gpgpuRigidForceScale: number;
  // Coupling stage 1b: torque from the surface-point sample
  // (off = stage 1 verbatim) and the wake-by-force threshold
  // in world/s² (0 = force never wakes, stage 1 behaviour).
  gpgpuRigidForceTorque: boolean;
  gpgpuRigidForceWakeThreshold: number;
  // Coupling stage 2: free particles mixed into rigid mode —
  // a hash-split subset (fraction of the pool) that is NOT
  // attached to a body and collides with the body spheres.
  // Off (default) is bit-identical to before.
  gpgpuRigidFreeEnabled: boolean;
  gpgpuRigidFreeFraction: number;
  // Cluster colouring (Phase 20 stage 1): while on (AND the
  // rigid solver is on AND a cell texture exists), the points
  // draw takes each particle's base colour from its body's
  // static bake-time cluster colour (cell texture .w → LUT).
  // Default off = the legacy draw strings, bit-identical.
  gpgpuRigidClusterColorEnabled: boolean;
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
  gpgpuTubeDrawFraction: number;
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
  // Cross-section profile (Phase AF2, lib/tubeSectionProfile.ts):
  // the ring shape swept along the tube. 'circle' with 6 sides is
  // the legacy ring, bit-identical; 'polygon' uses Sides vertices;
  // 'star' alternates outer / inner (InnerRatio) vertices, 2 x
  // Sides points. The length profile stays with Taper above.
  gpgpuSmoothTubeSectionShape: 'circle' | 'polygon' | 'star' | 'custom';
  gpgpuSmoothTubeSectionSides: number;
  gpgpuSmoothTubeSectionInnerRatio: number;
  // Arbitrary section profile + ribbon profiles (Phase AM):
  // 'custom' sections read their radial scale from a free-curve
  // profile over the ring angle; the width (N) and height (B)
  // ring components scale along the tube's length by their own
  // free-curve profiles. All three are flat [t, v, …] curve
  // assets (lib/freeCurve.ts); the identity asset [0, 1, 1, 1]
  // (the default) makes every one of them an exact no-op.
  gpgpuSmoothTubeSectionProfile: number[];
  gpgpuSmoothTubeWidthProfile: number[];
  gpgpuSmoothTubeHeightProfile: number[];
  // Flow-field glyph overlay (Phase AF2,
  // lib/fieldGlyphSampling.ts + components/
  // sceneGpgpuFieldGlyphs.tsx): the curl field drawn as line
  // glyphs on a z=0 grid inside the bounce radius — segment
  // direction follows the field, length scales with its strength
  // times Length. Display-only overlay; default off.
  gpgpuFieldGlyphEnabled: boolean;
  gpgpuFieldGlyphGrid: number;
  gpgpuFieldGlyphLength: number;
  // Volumetric Ray Marching
  gpgpuVolumetricEnabled: boolean;
  gpgpuVolumetricRadius: number;
  gpgpuVolumetricDensity: number;
  gpgpuVolumetricColor: string;
  gpgpuVolumetricOpacity: number;
  gpgpuVolumetricSteps: number;
}
