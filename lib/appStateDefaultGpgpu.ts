import type { ParticleConfig } from '../types';

export const APP_STATE_DEFAULT_GPGPU: Partial<ParticleConfig> = {
  // GPGPU Layer
  gpgpuEnabled: false,
  gpgpuCount: 65536,
  gpgpuGravity: 0.2,
  gpgpuTurbulence: 0.4,
  gpgpuBounce: 0.65,
  gpgpuBounceRadius: 150,
  gpgpuSeed: 1,
  gpgpuCustomForceEnabled: false,
  gpgpuCustomForceCode: '',
  gpgpuSize: 1.5,
  gpgpuSpeed: 1.0,
  gpgpuColor: '#88aaff',
  gpgpuOpacity: 0.7,
  gpgpuAudioReactive: false,
  gpgpuAudioBlast: 1.5,
  gpgpuTrailEnabled: false,
  gpgpuTrailLength: 8,
  gpgpuTrailFade: 0.75,
  gpgpuTrailVelocityScale: 1.0,
  gpgpuGeomMode: 'point' as const,
  gpgpuGeomVelocityAlign: false,
  gpgpuGeomScale: 1.0,
  // Geometry material extras + point shape (Kinetix integration B1b)
  gpgpuGeomEnvReflect: 0.0,
  // Image-based lighting (Phase AL): 0 = legacy fragment path.
  gpgpuGeomIblIntensity: 0.0,
  gpgpuGeomSpinSpeed: 0.0,
  gpgpuGeomSpinRandom: 0,
  gpgpuGeomStretch: 0.0,
  gpgpuPointShape: 'soft' as const,
  gpgpuNBodyEnabled: false,
  gpgpuNBodyStrength: 1.0,
  gpgpuNBodyRepulsion: 5.0,
  gpgpuNBodySoftening: 2.0,
  gpgpuNBodySampleCount: 16,
  gpgpuVelColorEnabled: false,
  gpgpuVelColorHueMin: 200,
  gpgpuVelColorHueMax: 360,
  gpgpuVelColorSaturation: 0.9,
  gpgpuAgeEnabled: false,
  gpgpuAgeMax: 8.0,
  gpgpuAgeFadeIn: 0.1,
  gpgpuAgeFadeOut: 0.2,
  // Lifecycle grammar (Phase AB): burst 1 disables the spawn gate
  // (whole pool live at t = 0, the legacy behaviour); kills off;
  // drag 1.1 is the legacy fixed damping; max speed 0 = uncapped.
  gpgpuSpawnRate: 1.0,
  gpgpuSpawnBurst: 1.0,
  gpgpuSpawnPulseInterval: 0,
  gpgpuSpawnPulseDuty: 0.3,
  // Pulse cycles + probability (Phase AX): 0 cycles = unlimited,
  // probability 1 = every cycle fires — both legacy.
  gpgpuSpawnPulseCycles: 0,
  gpgpuSpawnPulseProbability: 1,
  // Spawn order (Phase AX): 'hash' = the legacy hash order.
  gpgpuSpawnOrderMode: 'hash' as const,
  // Spawn burst event (Phase AX): disabled = no event.
  gpgpuSpawnEventEnabled: false,
  gpgpuSpawnEventTime: 2,
  gpgpuSpawnEventCount: 0.3,
  gpgpuSpawnEventSpeed: 2,
  gpgpuSpawnEventSpread: 0.5,
  // Emission curve (Phase AJ): disabled, identity curve, 8 s period.
  gpgpuFreeCurvePoints: [0, 1, 1, 1],
  gpgpuEmissionCurveEnabled: false,
  gpgpuEmissionCurvePeriod: 8,
  // Named point attributes (Phase AK): slot names / generation
  // sources, every drive off (slot -1), group disabled — while no
  // consumer is active the attribute texture is never built and
  // the legacy path runs verbatim.
  gpgpuAttrNames: ['a', 'b', 'c', 'd'],
  gpgpuAttrSources: ['hash', 'species', 'radius', 'height'],
  // Bake-time attribute arithmetic (Phase BI): all empty = no
  // arithmetic, the bake is the legacy one bit-for-bit.
  gpgpuAttrExprs: ['', '', '', ''],
  // Dynamic attribute re-evaluation (Phase BO): disabled and a
  // 1-frame interval — while disabled the pass is never built
  // and the bake is the legacy one bit-for-bit.
  gpgpuAttrDynEnabled: false,
  gpgpuAttrDynInterval: 1,
  // Attribute feedback (Phase BV): disabled — while disabled
  // (or while no expression references p) the feedback pass is
  // never built and the stage-2 / bake behaviour is bit-for-bit
  // the legacy one.
  gpgpuAttrFeedbackEnabled: false,
  gpgpuAttrSizeSlot: -1,
  gpgpuAttrSizeAmount: 1,
  gpgpuAttrBrightSlot: -1,
  gpgpuAttrBrightAmount: 1,
  gpgpuAttrForceSlot: -1,
  gpgpuAttrForceAmount: 1,
  gpgpuGroupEnabled: false,
  gpgpuGroupSlot: 0,
  gpgpuGroupMode: 'above' as const,
  gpgpuGroupLow: 0.25,
  gpgpuGroupHigh: 0.75,
  gpgpuGroupTarget: 'all' as const,
  gpgpuGroupInvert: false,
  gpgpuKillBoundary: false,
  gpgpuKillMask: false,
  gpgpuDrag: 1.1,
  gpgpuMaxSpeed: 0,
  gpgpuCurlEnabled: false,
  gpgpuCurlStrength: 1.0,
  gpgpuCurlScale: 0.008,
  gpgpuCurlSymmetry: 'none' as const,
  // Curl flavour + octaves (B3): legacy field by default.
  gpgpuCurlMode: 'curl' as const,
  gpgpuCurlOctaves: 1,
  gpgpuCurlSpeed: 1.0,
  gpgpuBoidsEnabled: false,
  gpgpuBoidsSeparation: 1.0,
  gpgpuBoidsAlignment: 0.5,
  gpgpuBoidsCohesion: 0.3,
  gpgpuBoidsRadius: 30.0,
  gpgpuAttractorEnabled: false,
  gpgpuAttractorType: 'lorenz' as const,
  gpgpuAttractorStrength: 1.0,
  gpgpuAttractorScale: 8.0,
  // Vortex
  gpgpuVortexEnabled: false,
  gpgpuVortexStrength: 1.0,
  gpgpuVortexTilt: 0.0,
  // Wind
  gpgpuWindEnabled: false,
  gpgpuWindStrength: 1.0,
  gpgpuWindX: 1.0,
  gpgpuWindY: 0.0,
  gpgpuWindZ: 0.0,
  gpgpuWindGust: 0.3,
  // Wind volume (Phase AL): placed sphere localising the wind.
  gpgpuWindVolumeEnabled: false,
  gpgpuWindVolumeX: 0.0,
  gpgpuWindVolumeY: 0.0,
  gpgpuWindVolumeZ: 0.0,
  gpgpuWindVolumeRadius: 60.0,
  gpgpuWindVolumeStrength: 1.0,
  // Gravity Well
  gpgpuWellEnabled: false,
  gpgpuWellStrength: 1.0,
  gpgpuWellSoftening: 10.0,
  gpgpuWellOrbit: 0.5,
  // Multiple wells (B3): 1 = legacy single well at the origin.
  gpgpuWellCount: 1,
  gpgpuWellSpread: 70.0,
  // Elastic Spring
  gpgpuElasticEnabled: false,
  gpgpuElasticStrength: 0.5,
  // Magnetic
  gpgpuMagneticEnabled: false,
  gpgpuMagneticStrength: 1.0,
  gpgpuMagneticBX: 0.0,
  gpgpuMagneticBY: 1.0,
  gpgpuMagneticBZ: 0.0,
  // SPH Fluid
  gpgpuSphEnabled: false,
  gpgpuSphPressure: 3.0,
  gpgpuSphViscosity: 0.5,
  gpgpuSphRadius: 40.0,
  gpgpuSphRestDensity: 2.0,
  // Surface tension (Phase AB, cohesion approximation): 0 = off.
  gpgpuSphSurfaceTension: 0,
  // Grains (Phase AQ, DEM-style contact solver): disabled = off.
  gpgpuGrainsEnabled: false,
  gpgpuGrainsSize: 8.0,
  gpgpuGrainsStiffness: 2.0,
  gpgpuGrainsFriction: 0.6,
  gpgpuGrainsCohesion: 0,
  gpgpuGrainsRestitution: 0,
  gpgpuGrainsRestDamping: 0.5,
  // Angle of repose, direct (Phase BB): 0 = off (friction rules).
  gpgpuGrainsReposeAngle: 0,
  // Pyro (Phase AS, particle-side temperature / buoyancy solver):
  // disabled = off. Buoyancy is in gravity units (1.2 at full
  // temperature out-lifts the default gravity 0.2 and gravity 1.0
  // alike); Cooling is the exponent of the age cooling curve.
  gpgpuPyroEnabled: false,
  gpgpuPyroTemperature: 1.0,
  gpgpuPyroBuoyancy: 1.2,
  gpgpuPyroCooling: 1.0,
  gpgpuPyroDisturbance: 1.0,
  gpgpuPyroDisturbanceHeat: 1.0,
  // Phase CA: Pyro grid solver (see types/configGpgpu.ts).
  // Disabled = no allocation, no passes, bit-identical output.
  gpgpuPyroGridEnabled: false,
  gpgpuPyroGridResolution: 0,
  gpgpuPyroGridJacobiIterations: 16,
  // Phase CB: coupling / vorticity / combustion (all inert at 0).
  gpgpuPyroGridBlend: 0,
  gpgpuPyroGridTransfer: 1.0,
  gpgpuPyroVorticityEpsilon: 0,
  gpgpuPyroFuelRate: 0,
  // Phase CC: CSG panel state (see types/configGpgpu.ts).
  // Disabled = no worker, no WASM, bit-identical output.
  gpgpuCsgEnabled: false,
  gpgpuCsgPrimitiveA: 'cube' as const,
  gpgpuCsgPrimitiveB: 'sphere' as const,
  gpgpuCsgOperation: 'difference' as const,
  gpgpuCsgSizeA: 2,
  gpgpuCsgSizeB: 2,
  gpgpuCsgSegments: 32,
  gpgpuCsgOffsetBX: 1,
  gpgpuCsgOffsetBY: 0,
  gpgpuCsgOffsetBZ: 0,
  gpgpuCsgExtrudeProfile: 'square' as const,
  gpgpuCsgExtrudeHeight: 1,
  gpgpuCsgExtrudeTwist: 0,
  gpgpuCsgExtrudeScaleTop: 1,
  gpgpuCsgExtrudeDivisions: 0,
  gpgpuCsgFinish: 'none' as const,
  // Vector Field
  gpgpuVFieldEnabled: false,
  gpgpuVFieldType: 'spiral' as const,
  gpgpuVFieldStrength: 1.0,
  gpgpuVFieldScale: 0.005,
  gpgpuLevyEnabled: false,
  gpgpuLevyStrength: 2.0,
  gpgpuLevyRate: 6.0,
  gpgpuKuramotoEnabled: false,
  gpgpuKuramotoCoupling: 2.0,
  gpgpuKuramotoSpread: 1.0,
  gpgpuKuramotoRadius: 60,
  gpgpuKuramotoInfluence: 0.8,
  // Particle Life
  gpgpuParticleLifeEnabled: false,
  gpgpuParticleLifePreset: 'cells' as const,
  gpgpuParticleLifeSpecies: 4,
  gpgpuParticleLifeStrength: 1.0,
  gpgpuParticleLifeRadius: 60,
  gpgpuParticleLifeFriction: 0.85,
  gpgpuParticleLifeSeed: 1,
  // Behaviour semantics (Phase AA1): all behaviour terms off /
  // uncapped by default — the matrix-only legacy behaviour.
  gpgpuParticleLifePursue: 0,
  gpgpuParticleLifeEvade: 0,
  gpgpuParticleLifeVisionRange: 120,
  gpgpuParticleLifeVisionAngle: 360,
  gpgpuParticleLifeMaxSpeed: 0,
  gpgpuParticleLifeMeanderAmount: 0,
  gpgpuParticleLifeMeanderScale: 1,
  // Obstacle avoidance (Phase AB): 0 = off (Steering stays
  // pursue / evade only, the Phase AA behaviour).
  gpgpuParticleLifeAvoid: 0,
  // Spring (to spawn pos)
  gpgpuSpringEnabled: false,
  gpgpuSpringStrength: 1.0,
  // Morph Targets (Kinetix integration B1a)
  gpgpuMorphEnabled: false,
  gpgpuMorphTarget: 'trefoil' as const,
  gpgpuMorphStrength: 3.0,
  gpgpuMorphScale: 1.0,
  gpgpuMorphJitter: 0.12,
  gpgpuMorphOrbitSpeed: 0.3,
  gpgpuMorphSvgSource: '',
  gpgpuMorphObjSource: '',
  // OBJ modes (Phase O): surface / 0 reproduce Phase J bit-for-bit.
  gpgpuMorphObjSampleMode: 'surface' as const,
  gpgpuMorphObjNormalSpeed: 0,
  gpgpuMorphReplicaCount: 1,
  gpgpuMorphReplicaSpacing: 0.6,
  gpgpuMorphReplicaAxis: 'x' as const,
  gpgpuMorphReplicaRotation: 0,
  gpgpuMorphReplicaScaleStep: 1,
  gpgpuMorphReplicaPhaseStep: 0,
  gpgpuMorphReplicaAgeStep: 0,
  // Replica independent sim (Phase W2): off by default = the
  // shared simulation, bit-identical to v1.25.0.
  gpgpuMorphReplicaIndependent: false,
  gpgpuMorphReplicaDivergence: 1,
  // Terrain (Phase L): seeded fBm height field for the 'terrain'
  // morph target. Only read when the target is 'terrain'.
  gpgpuMorphTerrainAmplitude: 0.55,
  gpgpuMorphTerrainFrequency: 1.6,
  gpgpuMorphTerrainOctaves: 4,
  gpgpuMorphTerrainSeed: 0,
  // Terrain recipes (Phase AI): 'fbm' default = the Phase L field.
  gpgpuMorphTerrainKind: 'fbm' as const,
  gpgpuMorphTerrainTerraceSteps: 6,
  // Terrain erosion (Phase AP): Water 0 + Thermal 0 = the grammar
  // resolves to null and the field stays the analytic original.
  gpgpuMorphTerrainErosionWater: 0,
  gpgpuMorphTerrainErosionDroplets: 1,
  gpgpuMorphTerrainErosionDeposit: 0.3,
  gpgpuMorphTerrainErosionThermal: 0,
  gpgpuMorphTerrainErosionTalus: 0.5,
  gpgpuMorphTerrainErosionThermalPasses: 24,
  gpgpuMorphTerrainErosionSeed: 0,
  // Terrain scatter grammar (Phase AI): off by default; the
  // sub-keys at these values resolve to the legacy tiling anyway.
  gpgpuMorphScatterEnabled: false,
  gpgpuMorphScatterDensity: 1,
  gpgpuMorphScatterHeightMin: 0,
  gpgpuMorphScatterHeightMax: 1,
  gpgpuMorphScatterSlopeMax: 1,
  gpgpuMorphScatterAlignNormal: 0,
  gpgpuMorphScatterSpecies: 1,
  // Scatter finishing (Phase AX): all 0 = the Phase AI bake verbatim.
  gpgpuMorphScatterScaleRandom: 0,
  gpgpuMorphScatterRotRandom: 0,
  gpgpuMorphScatterBend: 0,
  // Terrain collider (Phase AI): off by default = legacy path.
  gpgpuTerrainColliderEnabled: false,
  gpgpuTerrainColliderBounce: 0.5,
  gpgpuTerrainColliderFriction: 0.25,
  // Path placement (Phase S): 'off' default = legacy random pick.
  // Only read when the morph target is 'svg'.
  gpgpuMorphPathMode: 'off' as const,
  gpgpuMorphPathWriteOnStart: 0,
  gpgpuMorphPathWriteOnEnd: 1,
  gpgpuMorphPathTaper: 0,
  gpgpuMorphPathTaperShape: 'linear' as const,
  gpgpuMorphPathSubpathMode: 'proportional' as const,
  // Path offset (Phase AM): 0 = the authored geometry itself.
  gpgpuMorphPathOffset: 0,
  gpgpuMorphTextOnPathEnabled: false,
  gpgpuMorphTextOnPathDelay: 0,
  gpgpuMorphTextOnPathSize: 1,
  // Per-glyph deformation (Phase AM): all 0 = AF2 bake verbatim.
  gpgpuMorphTextOnPathGlyphScale: 0,
  gpgpuMorphTextOnPathGlyphRotate: 0,
  gpgpuMorphTextOnPathGlyphFade: 0,
  // Contour target (Phase AM): trace the TextMap raster at the
  // media threshold by default.
  gpgpuMorphContourSource: 'text' as const,
  gpgpuMorphContourThreshold: 0.3,
  gpgpuMorphPolygonSides: 6,
  // Voronoi fracture (Phase AG): off = legacy bake bit-identical.
  gpgpuMorphFractureEnabled: false,
  gpgpuMorphFractureCells: 12,
  gpgpuMorphFractureSeed: 1,
  gpgpuMorphFractureGap: 0.25,
  // Morph-surface fibers (Phase AG): off = nothing drawn.
  gpgpuMorphFiberEnabled: false,
  gpgpuMorphFiberCount: 600,
  gpgpuMorphFiberLength: 0.35,
  gpgpuMorphFiberCurl: 0.4,
  // Fiber grooming (Phase AL): zero direction / 0 var = AG behaviour.
  gpgpuMorphFiberGroomX: 0.0,
  gpgpuMorphFiberGroomY: 0.0,
  gpgpuMorphFiberGroomZ: 0.0,
  gpgpuMorphFiberGroomAlign: 0.0,
  gpgpuMorphFiberLengthVar: 0.0,
  // Shape stamping (Phase AA3): only read in path mode 'stamp'.
  gpgpuMorphStampSpacing: 0.125,
  gpgpuMorphStampSize: 0.18,
  gpgpuMorphStampShape: 'disc' as const,
  gpgpuMorphStampAlign: true,
  // Form-dedicated deformation (Phase AA2): all amounts 0 = the
  // bake skips the deformation entirely (bit-identical legacy).
  gpgpuMorphDisperseAmount: 0,
  gpgpuMorphDisperseDirection: 'radial' as const,
  gpgpuMorphTwistAmount: 0,
  gpgpuMorphTwistAxis: 'y' as const,
  gpgpuMorphFractalAmount: 0,
  gpgpuMorphFractalFrequency: 1.5,
  gpgpuMorphFractalEvolution: 0,
  // Terrain Mesh (Phase P): disabled by default — mounts nothing.
  gpgpuTerrainMeshEnabled: false,
  gpgpuTerrainMeshDisplay: 'shaded' as const,
  gpgpuTerrainMeshTunnel: false,
  gpgpuTerrainMeshTexture: 'none' as const,
  gpgpuTerrainMeshScale: 1,
  gpgpuTerrainMeshOpacity: 1,
  gpgpuTerrainMeshBrightness: 1,
  // Terrain texture detail (Phase V): '' dedicated image = legacy
  // background-image reuse; repeat 1 / offsets 0 = identity UV.
  gpgpuTerrainTextureImage: '',
  gpgpuTerrainTextureRepeat: 1,
  gpgpuTerrainTextureOffsetX: 0,
  gpgpuTerrainTextureOffsetY: 0,
  // Tunnel cruise (Phase V): 0 = the legacy static tunnel.
  gpgpuTunnelSpeed: 0,
  // Terrain slope force (Phase AE): off by default; resolved
  // CPU-side against the live terrain (mesh on, plane mode).
  gpgpuSlopeForceEnabled: false,
  gpgpuSlopeForceStrength: 1.0,
  // OBJ Mesh (Phase V): disabled by default — mounts nothing.
  gpgpuObjMeshEnabled: false,
  gpgpuObjMeshDisplay: 'wireframe' as const,
  gpgpuObjMeshRepeat: 1,
  gpgpuObjMeshScale: 1,
  gpgpuObjMeshPosX: 0,
  gpgpuObjMeshPosY: 0,
  gpgpuObjMeshPosZ: 0,
  gpgpuObjMeshRotY: 0,
  gpgpuObjMeshOpacity: 1,
  // OBJ repetition grammar (Phase AA3): grid / 0 / 1 = Phase V layout.
  gpgpuObjMeshRepeatMode: 'grid' as const,
  gpgpuObjMeshRepeatRotation: 0,
  gpgpuObjMeshRepeatScaleStep: 1,
  // Verlet Integration
  gpgpuVerletEnabled: false,
  // Vellum constraint solver (Phase AR): all defaults keep the
  // solver off and every legacy path verbatim.
  gpgpuVellumEnabled: false,
  gpgpuVellumMode: 'sheet' as const,
  gpgpuVellumStiffness: 0.8,
  gpgpuVellumBend: 0.3,
  gpgpuVellumSubsteps: 2,
  gpgpuVellumPin: 'top' as const,
  gpgpuVellumPressure: 0,
  gpgpuVellumTear: 0,
  gpgpuVellumDamping: 0.05,
  // Constraint usages (Phase BB): 0 = off (legacy position-only).
  gpgpuVellumStitch: 0,
  gpgpuVellumGlue: 0,
  gpgpuVellumGlueBreak: 0,
  // SDF Collider
  gpgpuSdfEnabled: false,
  gpgpuSdfShape: 'sphere' as const,
  gpgpuSdfX: 0.0,
  gpgpuSdfY: 0.0,
  gpgpuSdfZ: 0.0,
  gpgpuSdfSize: 80.0,
  gpgpuSdfBounce: 0.5,
  // Mesh SDF Collider (Phase BY): off by default (no bake, no
  // texture, legacy path).
  gpgpuMeshSdfEnabled: false,
  gpgpuMeshSdfResolution: 64,
  gpgpuMeshSdfBounce: 0.5,
  gpgpuMeshSdfFriction: 0.25,
  // Point cache playback (Phase BZ): off by default (the driver
  // never runs, the attribute cloud is never touched).
  pointCacheEnabled: false,
  pointCacheLoop: true,
  pointCacheBundledSample: false,
  // Floor bounce (B3): off by default.
  gpgpuFloorEnabled: false,
  gpgpuFloorY: -110.0,
  gpgpuFloorBounce: 0.62,
  // Aux event emission (B3): off by default.
  gpgpuAuxMode: 'none' as const,
  gpgpuAuxCount: 4096,
  gpgpuAuxIntensity: 1.0,
  gpgpuAuxLife: 0.75,
  gpgpuAuxSpeed: 26.0,
  gpgpuAuxSize: 1.1,
  // Child-emitter independence (Phase Q): defaults = legacy shared
  // behaviour (gravity x1, no extra drag, no curl, colour inherited).
  gpgpuAuxGravityScale: 1.0,
  gpgpuAuxDrag: 0,
  gpgpuAuxCurl: 0,
  gpgpuAuxColor: '',
  // Aux chain (Phase W1): depth 1 + Aux2 'none' = the legacy
  // single-pool chain. The Aux2 defaults mirror the level-1
  // defaults (intensity 1, life 0.75, speed 26, size 1.1, gravity
  // scale 1, drag 0, curl 0, colour inherited) so opting into a
  // chain starts from the same behaviour one level down.
  gpgpuAuxDepth: 1,
  gpgpuAux2Mode: 'none' as const,
  gpgpuAux2Intensity: 1.0,
  gpgpuAux2Life: 0.75,
  gpgpuAux2Speed: 26.0,
  gpgpuAux2Size: 1.1,
  gpgpuAux2GravityScale: 1.0,
  gpgpuAux2Drag: 0,
  gpgpuAux2Curl: 0,
  gpgpuAux2Color: '',
  // Emission Shape
  gpgpuEmitShape: 'sphere' as const,
  // 3D Light (Phase T): disabled by default — the draw path is
  // bit-identical to before until the user opts in (and intensity 0
  // stays an exact identity even when enabled).
  gpgpuLightEnabled: false,
  gpgpuLightPosX: 0,
  gpgpuLightPosY: 0,
  gpgpuLightPosZ: 0,
  gpgpuLightIntensity: 1,
  gpgpuLightRadius: 3,
  gpgpuLightConeEnabled: false,
  gpgpuLightConeAngleDeg: 30,
  gpgpuLightDirX: 0,
  gpgpuLightDirY: -1,
  gpgpuLightDirZ: 0,
  // Visible light volume + trail (Phase Y): both off by default
  // (and volume intensity 0) — the scene mounts nothing extra and
  // the render is bit-identical to v1.29.0 until opted in.
  gpgpuLightVolumeEnabled: false,
  gpgpuLightVolumeShape: 'cone' as const,
  gpgpuLightVolumeIntensity: 0,
  gpgpuLightVolumeLength: 120,
  gpgpuLightVolumeAngle: 28,
  gpgpuLightVolumeSteps: 12,
  gpgpuLightVolumeSoftness: 0.5,
  gpgpuLightTrailEnabled: false,
  gpgpuLightTrailWidth: 6,
  gpgpuLightTrailFade: 1.5,
  // Occlusion-map shadow + fog self-shadow (Phase Z): shadow off
  // and strength / self-shadow 0 by default — nothing bakes, no
  // receiver changes, and the render is bit-identical to v1.30.0
  // until opted in.
  gpgpuShadowEnabled: false,
  gpgpuShadowStrength: 0,
  gpgpuShadowSoftness: 0.5,
  gpgpuShadowSourceTerrain: true,
  gpgpuShadowSourceObj: true,
  gpgpuFogSelfShadow: 0,
  gpgpuFogShadowSteps: 4,
  // Color over Lifetime
  gpgpuAgeColorEnabled: false,
  gpgpuAgeColorYoung: '#00aaff',
  gpgpuAgeColorOld: '#ff4400',
  // Kinetix Color gradient (B2): disabled by default — monochrome /
  // legacy colour behaviour is unchanged until the user opts in.
  // Default stops are the Kinetix 'nebula' gradient values.
  gpgpuGradEnabled: false,
  gpgpuGradDriver: 'life' as const,
  gpgpuGradStart: '#e0f2fe',
  gpgpuGradMid: '#38bdf8',
  gpgpuGradEnd: '#8b5cf6',
  gpgpuGradQuarter: '',
  gpgpuGradThreeQuarter: '',
  gpgpuGradQuarterPos: 0.25,
  gpgpuGradThreeQuarterPos: 0.75,
  // Arbitrary stop list (Phase BE): both empty = the ramp is derived
  // from the legacy keys above, so existing configs stay bit-identical.
  // When the pair resolves (>= 2 valid pairs), the list alone defines
  // the ramp and the legacy colour keys are not consulted.
  gpgpuGradStopPositions: [],
  gpgpuGradStopColors: [],
  gpgpuGradPreset: 'nebula',
  gpgpuGradSpatialScale: 0.008,
  gpgpuGradImageSource: '',
  // Sprite image (Phase U): empty = procedural point shapes as before.
  gpgpuSpriteImage: '',
  // Sprite sheet (Phase AD): 1x1 = the legacy single image,
  // bit-identical; age-driven frames are the default mode.
  gpgpuSpriteSheetCols: 1,
  gpgpuSpriteSheetRows: 1,
  gpgpuSpriteFrameMode: 'age' as const,
  gpgpuSpriteFrameFps: 12,
  gpgpuSpriteLoop: true,
  // Sprite rotation (Phase AX): all 0 = un-rotated legacy sampling.
  gpgpuSpriteRotInitial: 0,
  gpgpuSpriteRotSpeed: 0,
  gpgpuSpriteRotDamping: 0,
  gpgpuSpriteRotRandom: 0,
  gpgpuBlendMode: 'additive' as const,
  // Size over Lifetime
  gpgpuAgeSizeEnabled: false,
  gpgpuAgeSizeStart: 2.0,
  gpgpuAgeSizeEnd: 0.2,
  gpgpuAgeSizeCurve: 'linear' as const,
  // Age curves (Phase U): disabled by default; the all-ones point
  // lists are the identity multiplier even when enabled.
  gpgpuAgeCurveSizeEnabled: false,
  gpgpuAgeCurveSizePoints: [1, 1, 1, 1, 1],
  gpgpuAgeCurveOpacityEnabled: false,
  gpgpuAgeCurveOpacityPoints: [1, 1, 1, 1, 1],
  // Age curve drive targets (Phase AC): disabled by default and
  // all-ones points, so both layers of the identity hold.
  gpgpuAgeCurveVelocityEnabled: false,
  gpgpuAgeCurveVelocityPoints: [1, 1, 1, 1, 1],
  gpgpuAgeCurveForceEnabled: false,
  gpgpuAgeCurveForcePoints: [1, 1, 1, 1, 1],
  gpgpuAgeCurveRotationEnabled: false,
  gpgpuAgeCurveRotationPoints: [1, 1, 1, 1, 1],
  // Layer Maps per property (Phase U): 0 = no modulation.
  gpgpuMapSizeAmount: 0,
  gpgpuMapOpacityAmount: 0,
  // Per-property Layer Map sources + raster mask (Phase X): every
  // source '' (common-map fallback), displacement 0 and mask 'off'
  // reproduce the Phase W2 behaviour bit-for-bit.
  gpgpuMapSizeSource: '',
  gpgpuMapOpacitySource: '',
  gpgpuMapColorSource: '',
  gpgpuMapDisplaceSource: '',
  gpgpuMapDisplaceAmount: 0,
  // Noise field map (Phase AY): amounts 0 and evolve 0 — no
  // consumer samples the field, so the draw is bit-identical;
  // colour joins through the 'noise' gradient driver value.
  gpgpuNoiseMapScale: 0.01,
  gpgpuNoiseMapEvolve: 0,
  gpgpuNoiseMapSizeAmount: 0,
  gpgpuNoiseMapDisplaceAmount: 0,
  // Noise field grammar (Phase BJ): kind 'perlin' and a single
  // octave are the Phase AY field exactly.
  gpgpuNoiseMapKind: 'perlin',
  gpgpuNoiseMapOctaves: 1,
  gpgpuMaskSource: '',
  gpgpuMaskMode: 'off' as const,
  gpgpuMaskThreshold: 0.5,
  gpgpuMaskInvert: false,
  gpgpuMaskMap: [],
  gpgpuMaskMapWidth: 0,
  gpgpuMaskMapHeight: 0,
  // Raster-mask Boolean composition (Phase BF): the operand grid
  // is captured like the mask itself; composition runs only when
  // the user presses the combine button in the UI (capture-time,
  // never per frame), so the defaults keep every existing render
  // bit-identical.
  gpgpuMaskBoolOp: 'union' as const,
  gpgpuMaskBoolOperandMap: [],
  gpgpuMaskBoolOperandWidth: 0,
  gpgpuMaskBoolOperandHeight: 0,
  gpgpuPathRasterStrokeWidth: 0.045,
  // Mouse Force
  gpgpuMouseEnabled: false,
  gpgpuMouseStrength: 2.0,
  gpgpuMouseRadius: 150.0,
  gpgpuMouseMode: 'attract' as const,
  gpgpuMousePaintRate: 0.6,
  gpgpuMouseMultiTouch: false,
  // Streak Rendering
  gpgpuStreakEnabled: false,
  gpgpuStreakLength: 15.0,
  gpgpuStreakOpacity: 0.6,
  // Sort-based Transparency
  gpgpuSortEnabled: false,
  // Fluid Advection
  gpgpuFluidEnabled: false,
  gpgpuFluidDiffuse: 0.02,
  gpgpuFluidDecay: 0.01,
  gpgpuFluidStrength: 1.0,
  gpgpuFluidInfluence: 0.8,
  gpgpuFluidScale: 1.5,
  gpgpuFluidExtForce: false,
  gpgpuFlipEnabled: false,
  gpgpuFlipBlend: 0.95,
  gpgpuFlipPressureIterations: 16,
  gpgpuFlipTransfer: 1.0,
  // Whitewater (Phase BC): off by default — identity.
  gpgpuWhitewaterEnabled: false,
  gpgpuWhitewaterAmount: 1.0,
  gpgpuWhitewaterThreshold: 0.3,
  gpgpuWhitewaterLife: 0.7,
  gpgpuWhitewaterSize: 1.6,
  // Rigid bodies (Phase AU): off by default — identity.
  gpgpuRigidEnabled: false,
  gpgpuRigidRestitution: 0.2,
  gpgpuRigidFriction: 0.5,
  gpgpuRigidGlueEnabled: true,
  gpgpuRigidGlueStrength: 45,
  gpgpuRigidStartSleeping: false,
  gpgpuRigidFloorTerrain: false,
  // WebGPU Compute Backend
  gpgpuWebGPUEnabled: false,
  gpgpuExecutionPreference: 'auto',
  // Metaballs
  gpgpuMetaballEnabled: false,
  gpgpuMetaballResolution: 28,
  gpgpuMetaballStrength: 1.2,
  gpgpuMetaballIsoLevel: 80,
  gpgpuMetaballColor: '#88aaff',
  gpgpuMetaballStyle: 'classic',
  gpgpuMetaballOpacity: 0.75,
  gpgpuMetaballWireframe: false,
  gpgpuMetaballParticleLimit: 1024,
  gpgpuMetaballMetalness: 0.5,
  gpgpuMetaballRoughness: 0.2,
  gpgpuMetaballSubtract: 12,
  gpgpuMetaballUpdateSkip: 1,
  // Ribbon Trail
  gpgpuRibbonEnabled: false,
  gpgpuRibbonWidth: 4.0,
  gpgpuRibbonTaper: 0.8,
  gpgpuRibbonOpacity: 0.5,
  gpgpuRibbonMaxSegLen: 80.0,
  // Tube Trail
  gpgpuTubeEnabled: false,
  gpgpuTubeRadius: 3.0,
  gpgpuTubeOpacity: 0.6,
  // Smooth Tube
  gpgpuSmoothTubeEnabled: false,
  gpgpuSmoothTubeCount: 32,
  gpgpuSmoothTubeRadius: 2.0,
  gpgpuSmoothTubeTaper: 0,
  gpgpuSmoothTubeHistory: 12,
  gpgpuSmoothTubeColor: '#aaccff',
  gpgpuSmoothTubeOpacity: 0.7,
  gpgpuSmoothTubeSectionShape: 'circle' as const,
  gpgpuSmoothTubeSectionSides: 6,
  gpgpuSmoothTubeSectionInnerRatio: 0.6,
  // Section / ribbon profiles (Phase AM): identity curve assets.
  gpgpuSmoothTubeSectionProfile: [0, 1, 1, 1],
  gpgpuSmoothTubeWidthProfile: [0, 1, 1, 1],
  gpgpuSmoothTubeHeightProfile: [0, 1, 1, 1],
  gpgpuFieldGlyphEnabled: false,
  gpgpuFieldGlyphGrid: 16,
  gpgpuFieldGlyphLength: 0.5,
  // Volumetric Ray Marching
  gpgpuVolumetricEnabled: false,
  gpgpuVolumetricRadius: 12.0,
  gpgpuVolumetricDensity: 2.0,
  gpgpuVolumetricColor: '#aaccff',
  gpgpuVolumetricOpacity: 0.8,
  gpgpuVolumetricSteps: 8,
};
