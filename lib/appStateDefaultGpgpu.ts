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
  gpgpuCustomForceCtrlValues: {},
  gpgpuForceOrder: '',
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
  gpgpuGeomMetalness: 0.0,
  gpgpuGeomRoughness: 1.0,
  gpgpuSceneEnvIntensity: 0.0,
  // GEOM custom GLSL (Phase 16 stage 4): off / empty = stock shaders.
  gpgpuGeomCustomVertexEnabled: false,
  gpgpuGeomCustomVertexCode: '',
  gpgpuGeomCustomFragmentEnabled: false,
  gpgpuGeomCustomFragmentCode: '',
  // Foliage split (Phase 16 stage 5): 'follow' = gpgpuGeomMode.
  gpgpuGeomSpecies2Mode: 'follow' as const,
  gpgpuGeomSpecies3Mode: 'follow' as const,
  gpgpuGeomSpecies4Mode: 'follow' as const,
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
  // Extended attribute slots (Phase 18 stage 1): names /
  // sources mirror the first set's defaults; while no enabled
  // pass reads an ext slot name the second texture is never
  // built, so these keys are inert at the defaults.
  gpgpuAttrNames2: ['i', 'j', 'k', 'l'],
  gpgpuAttrSources2: ['hash', 'species', 'radius', 'height'],
  gpgpuAttrExprs2: ['', '', '', ''],
  // Attribute chain stage (Phase 18 stage 1): disabled and all
  // expressions empty — the chain pass is never built and the
  // stage-1 texture reaches consumers verbatim.
  gpgpuAttrChainEnabled: false,
  gpgpuAttrChainExprs: ['', '', '', ''],
  gpgpuAttrSizeSlot: -1,
  gpgpuAttrSizeAmount: 1,
  gpgpuAttrBrightSlot: -1,
  gpgpuAttrBrightAmount: 1,
  // Colour drive (Phase CL): disabled — while disabled (or
  // while any of colorR/G/B is unassigned) the draw runs the
  // legacy path bit-identically.
  gpgpuAttrColorEnabled: false,
  gpgpuAttrForceSlot: -1,
  gpgpuAttrForceAmount: 1,
  gpgpuGroupEnabled: false,
  gpgpuGroupSlot: 0,
  gpgpuGroupMode: 'above' as const,
  gpgpuGroupLow: 0.25,
  gpgpuGroupHigh: 0.75,
  gpgpuGroupTarget: 'all' as const,
  gpgpuGroupInvert: false,
  gpgpuGroupsData: '',
  gpgpuGroupRef: '',
  gpgpuGroupKillEnabled: false,
  gpgpuGroupColorEnabled: false,
  gpgpuKillBoundary: false,
  gpgpuKillMask: false,
  // Collision life (Phase 15): 0 / off = no contact cost.
  gpgpuCollisionLifeLoss: 0,
  gpgpuCollisionKill: false,
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
  gpgpuAttractorSpaceMode: 'legacy' as const,
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
  // Surface selectivity (Phase 15): 0 = isotropic cohesion (AB).
  gpgpuSphSurfaceSelectivity: 0,
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
  // Position projection (Phase 19): full strength while Grains
  // is on; Grains off never reaches the segment.
  gpgpuGrainsProjection: 1,
  // Neighbourhood scan (Phase 19): 0 = legacy subsample.
  gpgpuGrainsNeighborhood: 0,
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
  gpgpuPyroVolumeRender: 'fog' as const,
  gpgpuPyroVolumeSteps: 0,
  gpgpuPyroVolumeDensity: 1.0,
  gpgpuPyroVolumeShadowSteps: 0,
  // Phase CC: CSG panel state (see types/configGpgpu.ts).
  // Disabled = no worker, no WASM, bit-identical output.
  gpgpuCsgEnabled: false,
  gpgpuCsgPrimitiveA: 'cube' as const,
  gpgpuCsgPrimitiveB: 'sphere' as const,
  gpgpuCsgOperation: 'difference' as const,
  gpgpuCsgSizeA: 2,
  gpgpuCsgSizeB: 2,
  gpgpuCsgSegments: 32,
  gpgpuCsgOffsetAX: 0,
  gpgpuCsgOffsetAY: 0,
  gpgpuCsgOffsetAZ: 0,
  gpgpuCsgOffsetBX: 1,
  gpgpuCsgOffsetBY: 0,
  gpgpuCsgOffsetBZ: 0,
  gpgpuCsgExtrudeProfile: 'square' as const,
  gpgpuCsgExtrudeHeight: 1,
  gpgpuCsgExtrudeTwist: 0,
  gpgpuCsgExtrudeScaleTop: 1,
  gpgpuCsgExtrudeDivisions: 0,
  gpgpuCsgMeshObjText: `v 1.4700 0.0000 0.0000
v 1.3470 0.0000 0.2970
v 1.0500 0.0000 0.4200
v 0.7530 0.0000 0.2970
v 0.6300 0.0000 0.0000
v 0.7530 0.0000 -0.2970
v 1.0500 0.0000 -0.4200
v 1.3470 0.0000 -0.2970
v 1.3244 0.6378 0.0000
v 1.2136 0.5844 0.2970
v 0.9460 0.4556 0.4200
v 0.6784 0.3267 0.2970
v 0.5676 0.2733 0.0000
v 0.6784 0.3267 -0.2970
v 0.9460 0.4556 -0.4200
v 1.2136 0.5844 -0.2970
v 0.9165 1.1493 0.0000
v 0.8398 1.0531 0.2970
v 0.6547 0.8209 0.4200
v 0.4695 0.5887 0.2970
v 0.3928 0.4926 0.0000
v 0.4695 0.5887 -0.2970
v 0.6547 0.8209 -0.4200
v 0.8398 1.0531 -0.2970
v 0.3271 1.4331 0.0000
v 0.2997 1.3132 0.2970
v 0.2336 1.0237 0.4200
v 0.1676 0.7341 0.2970
v 0.1402 0.6142 0.0000
v 0.1676 0.7341 -0.2970
v 0.2336 1.0237 -0.4200
v 0.2997 1.3132 -0.2970
v -0.3271 1.4331 0.0000
v -0.2997 1.3132 0.2970
v -0.2336 1.0237 0.4200
v -0.1676 0.7341 0.2970
v -0.1402 0.6142 0.0000
v -0.1676 0.7341 -0.2970
v -0.2336 1.0237 -0.4200
v -0.2997 1.3132 -0.2970
v -0.9165 1.1493 0.0000
v -0.8398 1.0531 0.2970
v -0.6547 0.8209 0.4200
v -0.4695 0.5887 0.2970
v -0.3928 0.4926 0.0000
v -0.4695 0.5887 -0.2970
v -0.6547 0.8209 -0.4200
v -0.8398 1.0531 -0.2970
v -1.3244 0.6378 0.0000
v -1.2136 0.5844 0.2970
v -0.9460 0.4556 0.4200
v -0.6784 0.3267 0.2970
v -0.5676 0.2733 0.0000
v -0.6784 0.3267 -0.2970
v -0.9460 0.4556 -0.4200
v -1.2136 0.5844 -0.2970
v -1.4700 0.0000 0.0000
v -1.3470 0.0000 0.2970
v -1.0500 0.0000 0.4200
v -0.7530 0.0000 0.2970
v -0.6300 0.0000 0.0000
v -0.7530 0.0000 -0.2970
v -1.0500 0.0000 -0.4200
v -1.3470 0.0000 -0.2970
v -1.3244 -0.6378 0.0000
v -1.2136 -0.5844 0.2970
v -0.9460 -0.4556 0.4200
v -0.6784 -0.3267 0.2970
v -0.5676 -0.2733 0.0000
v -0.6784 -0.3267 -0.2970
v -0.9460 -0.4556 -0.4200
v -1.2136 -0.5844 -0.2970
v -0.9165 -1.1493 0.0000
v -0.8398 -1.0531 0.2970
v -0.6547 -0.8209 0.4200
v -0.4695 -0.5887 0.2970
v -0.3928 -0.4926 0.0000
v -0.4695 -0.5887 -0.2970
v -0.6547 -0.8209 -0.4200
v -0.8398 -1.0531 -0.2970
v -0.3271 -1.4331 0.0000
v -0.2997 -1.3132 0.2970
v -0.2336 -1.0237 0.4200
v -0.1676 -0.7341 0.2970
v -0.1402 -0.6142 0.0000
v -0.1676 -0.7341 -0.2970
v -0.2336 -1.0237 -0.4200
v -0.2997 -1.3132 -0.2970
v 0.3271 -1.4331 0.0000
v 0.2997 -1.3132 0.2970
v 0.2336 -1.0237 0.4200
v 0.1676 -0.7341 0.2970
v 0.1402 -0.6142 0.0000
v 0.1676 -0.7341 -0.2970
v 0.2336 -1.0237 -0.4200
v 0.2997 -1.3132 -0.2970
v 0.9165 -1.1493 0.0000
v 0.8398 -1.0531 0.2970
v 0.6547 -0.8209 0.4200
v 0.4695 -0.5887 0.2970
v 0.3928 -0.4926 0.0000
v 0.4695 -0.5887 -0.2970
v 0.6547 -0.8209 -0.4200
v 0.8398 -1.0531 -0.2970
v 1.3244 -0.6378 0.0000
v 1.2136 -0.5844 0.2970
v 0.9460 -0.4556 0.4200
v 0.6784 -0.3267 0.2970
v 0.5676 -0.2733 0.0000
v 0.6784 -0.3267 -0.2970
v 0.9460 -0.4556 -0.4200
v 1.2136 -0.5844 -0.2970
f 1 9 2
f 9 10 2
f 2 10 3
f 10 11 3
f 3 11 4
f 11 12 4
f 4 12 5
f 12 13 5
f 5 13 6
f 13 14 6
f 6 14 7
f 14 15 7
f 7 15 8
f 15 16 8
f 8 16 1
f 16 9 1
f 9 17 10
f 17 18 10
f 10 18 11
f 18 19 11
f 11 19 12
f 19 20 12
f 12 20 13
f 20 21 13
f 13 21 14
f 21 22 14
f 14 22 15
f 22 23 15
f 15 23 16
f 23 24 16
f 16 24 9
f 24 17 9
f 17 25 18
f 25 26 18
f 18 26 19
f 26 27 19
f 19 27 20
f 27 28 20
f 20 28 21
f 28 29 21
f 21 29 22
f 29 30 22
f 22 30 23
f 30 31 23
f 23 31 24
f 31 32 24
f 24 32 17
f 32 25 17
f 25 33 26
f 33 34 26
f 26 34 27
f 34 35 27
f 27 35 28
f 35 36 28
f 28 36 29
f 36 37 29
f 29 37 30
f 37 38 30
f 30 38 31
f 38 39 31
f 31 39 32
f 39 40 32
f 32 40 25
f 40 33 25
f 33 41 34
f 41 42 34
f 34 42 35
f 42 43 35
f 35 43 36
f 43 44 36
f 36 44 37
f 44 45 37
f 37 45 38
f 45 46 38
f 38 46 39
f 46 47 39
f 39 47 40
f 47 48 40
f 40 48 33
f 48 41 33
f 41 49 42
f 49 50 42
f 42 50 43
f 50 51 43
f 43 51 44
f 51 52 44
f 44 52 45
f 52 53 45
f 45 53 46
f 53 54 46
f 46 54 47
f 54 55 47
f 47 55 48
f 55 56 48
f 48 56 41
f 56 49 41
f 49 57 50
f 57 58 50
f 50 58 51
f 58 59 51
f 51 59 52
f 59 60 52
f 52 60 53
f 60 61 53
f 53 61 54
f 61 62 54
f 54 62 55
f 62 63 55
f 55 63 56
f 63 64 56
f 56 64 49
f 64 57 49
f 57 65 58
f 65 66 58
f 58 66 59
f 66 67 59
f 59 67 60
f 67 68 60
f 60 68 61
f 68 69 61
f 61 69 62
f 69 70 62
f 62 70 63
f 70 71 63
f 63 71 64
f 71 72 64
f 64 72 57
f 72 65 57
f 65 73 66
f 73 74 66
f 66 74 67
f 74 75 67
f 67 75 68
f 75 76 68
f 68 76 69
f 76 77 69
f 69 77 70
f 77 78 70
f 70 78 71
f 78 79 71
f 71 79 72
f 79 80 72
f 72 80 65
f 80 73 65
f 73 81 74
f 81 82 74
f 74 82 75
f 82 83 75
f 75 83 76
f 83 84 76
f 76 84 77
f 84 85 77
f 77 85 78
f 85 86 78
f 78 86 79
f 86 87 79
f 79 87 80
f 87 88 80
f 80 88 73
f 88 81 73
f 81 89 82
f 89 90 82
f 82 90 83
f 90 91 83
f 83 91 84
f 91 92 84
f 84 92 85
f 92 93 85
f 85 93 86
f 93 94 86
f 86 94 87
f 94 95 87
f 87 95 88
f 95 96 88
f 88 96 81
f 96 89 81
f 89 97 90
f 97 98 90
f 90 98 91
f 98 99 91
f 91 99 92
f 99 100 92
f 92 100 93
f 100 101 93
f 93 101 94
f 101 102 94
f 94 102 95
f 102 103 95
f 95 103 96
f 103 104 96
f 96 104 89
f 104 97 89
f 97 105 98
f 105 106 98
f 98 106 99
f 106 107 99
f 99 107 100
f 107 108 100
f 100 108 101
f 108 109 101
f 101 109 102
f 109 110 102
f 102 110 103
f 110 111 103
f 103 111 104
f 111 112 104
f 104 112 97
f 112 105 97
f 105 1 106
f 1 2 106
f 106 2 107
f 2 3 107
f 107 3 108
f 3 4 108
f 108 4 109
f 4 5 109
f 109 5 110
f 5 6 110
f 110 6 111
f 6 7 111
f 111 7 112
f 7 8 112
f 112 8 105
f 8 1 105`,
  gpgpuCsgExtrudeCustomText: '0, 1.1\n-0.2939, 0.4045\n-1.0462, 0.3399\n-0.4755, -0.1545\n-0.6466, -0.8899\n0, -0.5\n0.6466, -0.8899\n0.4755, -0.1545\n1.0462, 0.3399\n0.2939, 0.4045',
  gpgpuCsgFinish: 'none' as const,
  gpgpuCsgRefineDivisions: 2,
  gpgpuCsgMeshObjTextB: '',
  gpgpuCsgMorphBackupObjText: '',
  gpgpuCsgHistoryJson: '',
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
  // General steering avoidance (Phase 15): 0 = off.
  gpgpuSteerAvoid: 0,
  gpgpuSteerAvoidRange: 0,
  // Crowd steering (Phase 20 stage 2): off = byte-identical.
  gpgpuSteerSeekEnabled: false,
  gpgpuSteerSeekMode: 'seek' as const,
  gpgpuSteerSeekStrength: 1,
  gpgpuSteerSeekMaxSpeed: 1,
  gpgpuSteerSeekMaxForce: 0,
  gpgpuSteerSeekTargetX: 0,
  gpgpuSteerSeekTargetY: 0,
  gpgpuSteerSeekTargetZ: 0,
  gpgpuSteerSeekTarget1X: 0,
  gpgpuSteerSeekTarget1Y: 0,
  gpgpuSteerSeekTarget1Z: 0,
  gpgpuSteerSeekSlowingRadius: 50,
  gpgpuSteerSeekStateSlot: 0,
  gpgpuSteerSeekStateThreshold: 0.5,
  gpgpuSteerSeekPath: '',
  gpgpuSteerSeekPathLookAhead: 20,
  gpgpuSteerSeekPathRadius: 0,
  // Spring (to spawn pos)
  gpgpuSpringEnabled: false,
  gpgpuSpringStrength: 1.0,
  // Morph Targets (Kinetix integration B1a)
  gpgpuMorphEnabled: false,
  gpgpuMorphTarget: 'trefoil' as const,
  gpgpuMorphNoiseMapEnabled: false,
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
  // Erosion mask (Phase 20 stage 3): off by default (identity).
  gpgpuMorphTerrainErosionMaskMode: 'off' as const,
  gpgpuMorphTerrainErosionMaskStrength: 1,
  gpgpuMorphTerrainErosionMaskInvert: false,
  gpgpuMorphTerrainErosionMaskLow: 0,
  gpgpuMorphTerrainErosionMaskHigh: 1,
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
  // PCG rule graph (Phase 18 stage 3): off and default graph.
  gpgpuPcgGraphEnabled: false,
  gpgpuPcgGraphData: '',
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
  // Vertical text on path (Phase 17): OFF = AF2 single-line layout.
  gpgpuMorphTextOnPathVertical: false,
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
  // Fragment collection (Phase 17 stage 4): '' = no saved division.
  gpgpuFragmentCollectionJson: '',
  // Fragment restore (Phase 20 stage 1): off = saved division never applied.
  gpgpuFragmentCollectionRestoreEnabled: false,
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
  // Fiber root source / groom field (Phase 15): defaults = AG/AL paths.
  gpgpuMorphFiberRootSource: 'morph' as const,
  gpgpuMorphFiberGroomField: 'uniform' as const,
  gpgpuMorphFiberGroomFieldScale: 1.0,
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
  // XPBD completion (Phase 19 stage 3): 'legacy' + zeros keep
  // every new pass uncreated and the frame verbatim legacy.
  gpgpuVellumSolverMode: 'legacy' as const,
  gpgpuVellumCompliance: 0,
  gpgpuVellumBendCompliance: 0,
  gpgpuVellumVolumeEnabled: false,
  gpgpuVellumVolumeRatio: 1,
  gpgpuVellumVolumeCompliance: 0,
  gpgpuVellumTearGap: 0,
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
  // Scene depth occlusion (Phase 16 stage 1): 0 = no depth capture.
  gpgpuDepthOcclusion: 0,
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
  gpgpuShadowMapStrength: 0,
  gpgpuShadowMapBias: 0.001,
  gpgpuShadowMapSoftness: 1,
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
  gpgpuNoiseFieldSupplyTime: 0,
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
  // Vector Boolean (Phase 17 stage 2): derived keys only — the
  // composition runs in the CSG worker on the UI button press
  // and stores its result SVG here; the defaults (no B, no
  // result) keep every existing render bit-identical.
  gpgpuVectorBoolOp: 'union' as const,
  gpgpuVectorBoolSourceB: '',
  gpgpuVectorBoolResultSvg: '',
  // Text extrusion (Phase 17 stage 3): input keys only — the
  // extrusion runs on the UI button press; the defaults (empty
  // text) keep every existing render bit-identical. Flatness
  // 0.001 is PATH_ARC_EPSILON (lib/pathGeometry.ts), read in
  // glyph (em) units by lib/textExtrude.ts.
  gpgpuTextExtrudeText: '',
  gpgpuTextExtrudeDepth: 0.4,
  gpgpuTextExtrudeFlatness: 0.001,
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
  gpgpuFlipVorticityEnabled: false,
  gpgpuFlipVorticityEpsilon: 0.5,
  gpgpuFlipMode: '2d' as const,
  gpgpuFlip3dResolution: 0,
  gpgpuFlipViscosity: 0,
  gpgpuFlipSurfaceTension: 0,
  gpgpuDensityCompEnabled: false,
  gpgpuDensityCompTarget: 0.5,
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
  // XPBD joints + stress breaking (Phase 20 stage 1): off by
  // default — identity.
  gpgpuRigidJointEnabled: false,
  gpgpuRigidJointCompliance: 0,
  gpgpuRigidJointBreakThreshold: 0,
  gpgpuRigidStressBreakEnabled: false,
  gpgpuRigidStressPropagation: 0.5,
  gpgpuRigidConvexEnabled: false,
  // Cluster colouring (Phase 20 stage 1): off = legacy draw.
  gpgpuRigidClusterColorEnabled: false,
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
  gpgpuTubeDrawFraction: 1,
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
