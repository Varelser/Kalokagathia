import type { ConnectionRenderStyle, Layer2Type, MotionDagNode, MotionGraphStep, Layer3Source, ParticleBurstMode, ParticleBurstWaveform, ParticleSpriteMode, Position3D } from './scene';

export interface ParticleConfigLayer3 {
  layer3Enabled: boolean;
  layer3Color: string;
  layer3Source: Layer3Source;
  layer3ExecutionEngineOverride: 'auto' | 'cpu-geometry' | 'webgl-particle' | 'webgl-procedural-surface' | 'webgl-gpgpu' | 'webgpu-compute' | 'hybrid-runtime';
  layer3SourceCount: number;
  layer3SourceSpread: number;
  layer3SourcePositions: Position3D[];
  layer3Type: Layer2Type;
  layer3MediaLumaMap: number[];
  layer3MediaMapWidth: number;
  layer3MediaMapHeight: number;
  layer3MediaThreshold: number;
  layer3MediaDepth: number;
  layer3MediaInvert: boolean;
  layer3MediaFrameRate: number;
  layer3TextMapText: string;
  layer3TextMapFontFamily: string;
  layer3TextMapWeight: number;
  layer3TextMapSize: number;
  layer3TextMapPadding: number;
  layer3TextMapInvert: boolean;

  layer3MotionMix: boolean;
  layer3Motions: Layer2Type[];

  // Serial motion chain (free wiring stage 1): see configLayer2.ts.
  layer3MotionChainEnabled: boolean;
  layer3MotionChain: Layer2Type[];

  // Cross-layer motion routing (free wiring stage 2, method A): before its
  // own motion, this layer runs the source layer's full motion stack (its
  // stage 1 plus its chain) with the source layer's parameters. routeFrom
  // names the OTHER layer ('layer2' | 'layer3'); self-reference is invalid
  // and resolves to no routing.
  layer3MotionRouteEnabled: boolean;
  layer3MotionRouteFrom: 'layer2' | 'layer3' | null;

  // Cross-layer source routing (free wiring stage 2, method B): this
  // layer's particles are generated from the source layer's source shape
  // (shape kind, source count/positions/spread, media map), while counts,
  // sizes and motions stay this layer's own.
  layer3SourceRouteEnabled: boolean;
  layer3SourceRouteFrom: 'layer2' | 'layer3' | null;

  // Motion graph (free wiring stage 3): a bounded step program evaluated
  // after the layer's own motion stack (stage 1 + chain, with any routed
  // pre-stage). Steps fork/merge through prev/source/branch registers.
  layer3MotionGraphEnabled: boolean;
  layer3MotionGraph: MotionGraphStep[];
  layer3PositionFeedbackEnabled: boolean;
  layer3PositionFeedback: number;
  layer3PositionFeedbackDecay: number;
  layer3WarpEnabled: boolean;
  layer3WarpAmount: number;
  layer3WarpScale: number;
  layer3MotionDagEnabled: boolean;
  layer3MotionDag: MotionDagNode[];
  layer3MotionDagOutput: number;

  layer3Counts: number[];
  layer3Sizes: number[];
  layer3RadiusScales: number[];
  layer3FlowSpeeds: number[];
  layer3FlowAmps: number[];
  layer3FlowFreqs: number[];

  layer3Count: number;
  layer3BaseSize: number;
  layer3RadiusScale: number;
  layer3FlowSpeed: number;
  layer3FlowAmplitude: number;
  layer3FlowFrequency: number;
  layer3Complexity: number;
  layer3Trail: number;
  layer3Life: number;
  layer3LifeSpread: number;
  layer3LifeSizeBoost: number;
  layer3LifeSizeTaper: number;
  layer3Burst: number;
  layer3BurstPhase: number;
  layer3BurstMode: ParticleBurstMode;
  layer3BurstWaveform: ParticleBurstWaveform;
  layer3BurstSweepSpeed: number;
  layer3BurstSweepTilt: number;
  layer3BurstConeWidth: number;
  layer3EmitterOrbitSpeed: number;
  layer3EmitterOrbitRadius: number;
  layer3EmitterPulseAmount: number;
  layer3TrailDrag: number;
  layer3TrailTurbulence: number;
  layer3TrailDrift: number;
  layer3VelocityGlow: number;
  layer3VelocityAlpha: number;
  layer3FlickerAmount: number;
  layer3FlickerSpeed: number;
  layer3Streak: number;
  layer3SpriteMode: ParticleSpriteMode;

  layer3ConnectionEnabled: boolean;
  layer3ConnectionDistance: number;
  layer3ConnectionOpacity: number;
  layer3LineVelocityGlow: number;
  layer3LineVelocityAlpha: number;
  layer3LineBurstPulse: number;
  layer3LineShimmer: number;
  layer3LineFlickerSpeed: number;
  layer3ConnectionStyle: ConnectionRenderStyle;
  layer3ConnectionWidth: number;
  layer3ConnectionSoftness: number;

  layer3Gravity: number;
  layer3Resistance: number;
  layer3SpinX: number;
  layer3SpinY: number;
  layer3SpinZ: number;
  layer3WindX: number;
  layer3WindY: number;
  layer3WindZ: number;

  layer3AffectPos: number;
  layer3NoiseScale: number;
  layer3OctaveMult: number;
  layer3Evolution: number;
  layer3MoveWithWind: number;
  layer3FluidForce: number;
  layer3Viscosity: number;
  layer3Fidelity: number;

  layer3InteractionNeighbor: number;
  layer3MouseForce: number;
  layer3MouseRadius: number;

  layer3CollisionMode: 'none' | 'world';
  layer3CollisionRadius: number;
  layer3Repulsion: number;
  layer3BoundaryEnabled: boolean;
  layer3BoundaryY: number;
  layer3BoundaryBounce: number;

  layer3AuxEnabled: boolean;
  layer3AuxCount: number;
  layer3AuxLife: number;
  layer3AuxDiffusion: number;
  layer3SparkEnabled: boolean;
  layer3SparkCount: number;
  layer3SparkLife: number;
  layer3SparkDiffusion: number;
  layer3SparkBurst: number;
  layer3GeomMode3D: 'billboard' | 'cube' | 'tetra' | 'icosa';
  layer3GeomScale3D: number;
  layer3SheetOpacity: number;
  layer3SheetFresnel: number;
  layer3SheetAudioReactive: number;
  layer3SheetWireframe: boolean;
  // Ghost Trail (time-offset copies)
  layer3GhostTrailEnabled: boolean;
  layer3GhostTrailCount: number;
  layer3GhostTrailDt: number;
  layer3GhostTrailFade: number;
  // Per-layer SDF
  layer3SdfEnabled: boolean;
  layer3SdfShape: 'sphere' | 'ring' | 'star' | 'hexagon';
  layer3SdfLightX: number;
  layer3SdfLightY: number;
  layer3SdfSpecular: number;
  layer3SdfShininess: number;
  layer3SdfAmbient: number;

  layer3MaterialStyle: 'classic' | 'glass' | 'hologram' | 'chrome' | 'halftone';
  layer3TemporalProfile: 'steady' | 'growth' | 'decay' | 'crystallize' | 'melt' | 'rupture' | 'oscillate' | 'accrete' | 'evaporate' | 'shed' | 'resonate' | 'condense' | 'ignite' | 'unravel' | 'accumulate' | 'exfoliate' | 'phase_shift' | 'inhale' | 'rewrite' | 'saturate' | 'delaminate' | 'anneal' | 'bifurcate' | 'recur' | 'percolate' | 'slump' | 'rebound' | 'fissure' | 'ossify' | 'intermittent' | 'hysteresis' | 'fatigue' | 'recover' | 'erupt' | 'latency' | 'emerge' | 'collapse' | 'regrow' | 'invert';
  layer3TemporalStrength: number;
  layer3TemporalSpeed: number;
  layer3BrushOpacity: number;
  layer3BrushLayers: number;
  layer3BrushScale: number;
  layer3BrushJitter: number;
  layer3BrushAudioReactive: number;
  layer3FiberOpacity: number;
  layer3FiberLength: number;
  layer3FiberDensity: number;
  layer3FiberCurl: number;
  layer3FiberAudioReactive: number;
  layer3GrowthOpacity: number;
  layer3GrowthBranches: number;
  layer3GrowthLength: number;
  layer3GrowthSpread: number;
  layer3GrowthAudioReactive: number;
  layer3DepositionOpacity: number;
  layer3DepositionRelief: number;
  layer3DepositionErosion: number;
  layer3DepositionBands: number;
  layer3DepositionAudioReactive: number;
  layer3DepositionWireframe: boolean;
  layer3CrystalOpacity: number;
  layer3CrystalScale: number;
  layer3CrystalDensity: number;
  layer3CrystalSpread: number;
  layer3CrystalAudioReactive: number;
  layer3CrystalWireframe: boolean;
  layer3CrystalDepositionOpacity: number;
  layer3CrystalDepositionCrystalScale: number;
  layer3CrystalDepositionDensity: number;
  layer3CrystalDepositionRelief: number;
  layer3CrystalDepositionAudioReactive: number;
  layer3CrystalDepositionWireframe: boolean;
  layer3ErosionTrailDensity: number;
  layer3ErosionTrailOpacity: number;
  layer3ErosionTrailLength: number;
  layer3ErosionTrailDrift: number;
  layer3ErosionTrailAudioReactive: number;
  layer3VoxelOpacity: number;
  layer3VoxelScale: number;
  layer3VoxelDensity: number;
  layer3VoxelSnap: number;
  layer3VoxelAudioReactive: number;
  layer3VoxelWireframe: boolean;
  layer3PatchOpacity: number;
  layer3PatchResolution: number;
  layer3PatchRelax: number;
  layer3PatchFresnel: number;
  layer3PatchAudioReactive: number;
  layer3PatchWireframe: boolean;
  layer3HullOpacity: number;
  layer3HullPointBudget: number;
  layer3HullJitter: number;
  layer3HullFresnel: number;
  layer3HullAudioReactive: number;
  layer3HullWireframe: boolean;
  layer3ReactionOpacity: number;
  layer3ReactionFeed: number;
  layer3ReactionKill: number;
  layer3ReactionScale: number;
  layer3ReactionWarp: number;
  layer3ReactionAudioReactive: number;
  layer3ReactionModel: 'gray-scott' | 'fhn' | 'lenia';
  layer3ReactionFhnEpsilon: number;
  layer3ReactionFhnA: number;
  layer3ReactionFhnB: number;
  layer3ReactionFhnGain: number;
  layer3ReactionLeniaMu: number;
  layer3ReactionLeniaSigma: number;
  layer3ReactionLeniaRadius: number;
  layer3ReactionLeniaDt: number;
  layer3ReactionLeniaKernel: 'ring' | 'double' | 'blob';
  layer3ReactionLeniaGain: number;
  layer3PhysarumSensorAngle: number;
  layer3PhysarumSensorDistance: number;
  layer3PhysarumTurnSpeed: number;
  layer3PhysarumSpeed: number;
  layer3PhysarumDeposit: number;
  layer3PhysarumDecay: number;
  layer3PhysarumOpacity: number;
  layer3PhysarumDisplay: 'sheet' | 'sphere';
  layer3DlaWalkers: number;
  layer3DlaSteps: number;
  layer3DlaStickiness: number;
  layer3DlaThickness: number;
  layer3DlaThicknessDecay: number;
  layer3DlaSeedShape: 'point' | 'line' | 'ring' | 'multi';
  layer3DlaSeed: number;
  layer3DlaOpacity: number;
  layer3LsysPreset: 'plant' | 'fern' | 'tree' | 'coral' | 'lightning';
  layer3LsysDepth: number;
  layer3LsysAngle: number;
  layer3LsysLengthDecay: number;
  layer3LsysSeed: number;
  layer3LsysWind: number;
  layer3LsysCurvature: number;
  layer3LsysOpacity: number;
  layer3RaymarchShape: 'mandelbulb' | 'blobs' | 'columns';
  layer3RaymarchScale: number;
  layer3RaymarchSteps: number;
  layer3RaymarchPower: number;
  layer3RaymarchRotation: number;
  layer3RaymarchDistance: number;
  layer3RaymarchOpacity: number;
  layer3FogOpacity: number;
  layer3FogDensity: number;
  layer3FogDepth: number;
  layer3FogScale: number;
  layer3FogDrift: number;
  layer3FogSlices: number;
  layer3FogGlow: number;
  layer3FogAnisotropy: number;
  layer3FogAudioReactive: number;
  layer3GlyphOutlineEnabled: boolean;
  layer3GlyphOutlineWidth: number;
  layer3GlyphOutlineOpacity: number;
  layer3GlyphOutlineDepthBias: number;
  layer3GlyphOutlineAudioReactive: number;

}
