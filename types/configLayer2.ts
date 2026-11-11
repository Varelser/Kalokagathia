import type { ConnectionRenderStyle, Layer2Type, MotionDagNode, MotionGraphStep, Layer3Source, ParticleBurstMode, ParticleBurstWaveform, ParticleSpriteMode, Position3D } from './scene';

export interface ParticleConfigLayer2 {
  layer2Enabled: boolean;
  layer2Color: string;
  layer2Source: Layer3Source;
  layer2ExecutionEngineOverride: 'auto' | 'cpu-geometry' | 'webgl-particle' | 'webgl-procedural-surface' | 'webgl-gpgpu' | 'webgpu-compute' | 'hybrid-runtime';
  layer2SourceCount: number;
  layer2SourceSpread: number;
  layer2SourcePositions: Position3D[];
  layer2Type: Layer2Type;
  layer2MediaLumaMap: number[];
  layer2MediaMapWidth: number;
  layer2MediaMapHeight: number;
  layer2MediaThreshold: number;
  layer2MediaDepth: number;
  layer2MediaInvert: boolean;
  layer2MediaFrameRate: number;
  layer2TextMapText: string;
  layer2TextMapFontFamily: string;
  layer2TextMapWeight: number;
  layer2TextMapSize: number;
  layer2TextMapPadding: number;
  layer2TextMapInvert: boolean;

  layer2MotionMix: boolean;
  layer2Motions: Layer2Type[];

  // Serial motion chain (free wiring stage 1): extra stages applied after
  // the layer's own motion (layer2Type / layer2Motions). Stage 1 is NOT
  // stored here; this array holds stages 2 and 3 only (max 2 entries).
  layer2MotionChainEnabled: boolean;
  layer2MotionChain: Layer2Type[];

  // Cross-layer motion routing (free wiring stage 2, method A): before its
  // own motion, this layer runs the source layer's full motion stack (its
  // stage 1 plus its chain) with the source layer's parameters. routeFrom
  // names the OTHER layer ('layer2' | 'layer3'); self-reference is invalid
  // and resolves to no routing.
  layer2MotionRouteEnabled: boolean;
  layer2MotionRouteFrom: 'layer2' | 'layer3' | null;

  // Cross-layer source routing (free wiring stage 2, method B): this
  // layer's particles are generated from the source layer's source shape
  // (shape kind, source count/positions/spread, media map), while counts,
  // sizes and motions stay this layer's own.
  layer2SourceRouteEnabled: boolean;
  layer2SourceRouteFrom: 'layer2' | 'layer3' | null;

  // Motion graph (free wiring stage 3): a bounded step program evaluated
  // after the layer's own motion stack (stage 1 + chain, with any routed
  // pre-stage). Steps fork/merge through prev/source/branch registers.
  layer2MotionGraphEnabled: boolean;
  layer2MotionGraph: MotionGraphStep[];
  layer2PositionFeedbackEnabled: boolean;
  layer2PositionFeedback: number;
  layer2PositionFeedbackDecay: number;
  layer2WarpEnabled: boolean;
  layer2WarpAmount: number;
  layer2WarpScale: number;
  layer2MotionDagEnabled: boolean;
  layer2MotionDag: MotionDagNode[];
  layer2MotionDagOutput: number;

  layer2Counts: number[];
  layer2Sizes: number[];
  layer2RadiusScales: number[];
  layer2FlowSpeeds: number[];
  layer2FlowAmps: number[];
  layer2FlowFreqs: number[];

  layer2Count: number;
  layer2BaseSize: number;
  layer2RadiusScale: number;
  layer2FlowSpeed: number;
  layer2FlowAmplitude: number;
  layer2FlowFrequency: number;
  layer2Complexity: number;
  layer2Trail: number;
  layer2Life: number;
  layer2LifeSpread: number;
  layer2LifeSizeBoost: number;
  layer2LifeSizeTaper: number;
  layer2Burst: number;
  layer2BurstPhase: number;
  layer2BurstMode: ParticleBurstMode;
  layer2BurstWaveform: ParticleBurstWaveform;
  layer2BurstSweepSpeed: number;
  layer2BurstSweepTilt: number;
  layer2BurstConeWidth: number;
  layer2EmitterOrbitSpeed: number;
  layer2EmitterOrbitRadius: number;
  layer2EmitterPulseAmount: number;
  layer2TrailDrag: number;
  layer2TrailTurbulence: number;
  layer2TrailDrift: number;
  layer2VelocityGlow: number;
  layer2VelocityAlpha: number;
  layer2FlickerAmount: number;
  layer2FlickerSpeed: number;
  layer2Streak: number;
  layer2SpriteMode: ParticleSpriteMode;

  layer2ConnectionEnabled: boolean;
  layer2ConnectionDistance: number;
  layer2ConnectionOpacity: number;
  layer2LineVelocityGlow: number;
  layer2LineVelocityAlpha: number;
  layer2LineBurstPulse: number;
  layer2LineShimmer: number;
  layer2LineFlickerSpeed: number;
  layer2ConnectionStyle: ConnectionRenderStyle;
  layer2ConnectionWidth: number;
  layer2ConnectionSoftness: number;

  layer2Gravity: number;
  layer2Resistance: number;
  layer2SpinX: number;
  layer2SpinY: number;
  layer2SpinZ: number;
  layer2WindX: number;
  layer2WindY: number;
  layer2WindZ: number;

  layer2AffectPos: number;
  layer2NoiseScale: number;
  layer2OctaveMult: number;
  layer2Evolution: number;
  layer2MoveWithWind: number;
  layer2FluidForce: number;
  layer2Viscosity: number;
  layer2Fidelity: number;

  layer2InteractionNeighbor: number;
  layer2MouseForce: number;
  layer2MouseRadius: number;

  layer2CollisionMode: 'none' | 'world';
  layer2CollisionRadius: number;
  layer2Repulsion: number;
  layer2BoundaryEnabled: boolean;
  layer2BoundaryY: number;
  layer2BoundaryBounce: number;

  layer2AuxEnabled: boolean;
  layer2AuxCount: number;
  layer2AuxLife: number;
  layer2AuxDiffusion: number;
  layer2SparkEnabled: boolean;
  layer2SparkCount: number;
  layer2SparkLife: number;
  layer2SparkDiffusion: number;
  layer2SparkBurst: number;
  layer2GeomMode3D: 'billboard' | 'cube' | 'tetra' | 'icosa';
  layer2GeomScale3D: number;
  layer2SheetOpacity: number;
  layer2SheetFresnel: number;
  layer2SheetAudioReactive: number;
  layer2SheetWireframe: boolean;
  // Ghost Trail (time-offset copies)
  layer2GhostTrailEnabled: boolean;
  layer2GhostTrailCount: number;
  layer2GhostTrailDt: number;
  layer2GhostTrailFade: number;
  // Per-layer SDF
  layer2SdfEnabled: boolean;
  layer2SdfShape: 'sphere' | 'ring' | 'star' | 'hexagon';
  layer2SdfLightX: number;
  layer2SdfLightY: number;
  layer2SdfSpecular: number;
  layer2SdfShininess: number;
  layer2SdfAmbient: number;

  layer2MaterialStyle: 'classic' | 'glass' | 'hologram' | 'chrome' | 'halftone';
  layer2TemporalProfile: 'steady' | 'growth' | 'decay' | 'crystallize' | 'melt' | 'rupture' | 'oscillate' | 'accrete' | 'evaporate' | 'shed' | 'resonate' | 'condense' | 'ignite' | 'unravel' | 'accumulate' | 'exfoliate' | 'phase_shift' | 'inhale' | 'rewrite' | 'saturate' | 'delaminate' | 'anneal' | 'bifurcate' | 'recur' | 'percolate' | 'slump' | 'rebound' | 'fissure' | 'ossify' | 'intermittent' | 'hysteresis' | 'fatigue' | 'recover' | 'erupt' | 'latency' | 'emerge' | 'collapse' | 'regrow' | 'invert';
  layer2TemporalStrength: number;
  layer2TemporalSpeed: number;
  layer2BrushOpacity: number;
  layer2BrushLayers: number;
  layer2BrushScale: number;
  layer2BrushJitter: number;
  layer2BrushAudioReactive: number;
  layer2FiberOpacity: number;
  layer2FiberLength: number;
  layer2FiberDensity: number;
  layer2FiberCurl: number;
  layer2FiberAudioReactive: number;
  layer2GrowthOpacity: number;
  layer2GrowthBranches: number;
  layer2GrowthLength: number;
  layer2GrowthSpread: number;
  layer2GrowthAudioReactive: number;
  layer2DepositionOpacity: number;
  layer2DepositionRelief: number;
  layer2DepositionErosion: number;
  layer2DepositionBands: number;
  layer2DepositionAudioReactive: number;
  layer2DepositionWireframe: boolean;
  layer2CrystalOpacity: number;
  layer2CrystalScale: number;
  layer2CrystalDensity: number;
  layer2CrystalSpread: number;
  layer2CrystalAudioReactive: number;
  layer2CrystalWireframe: boolean;
  layer2CrystalDepositionOpacity: number;
  layer2CrystalDepositionCrystalScale: number;
  layer2CrystalDepositionDensity: number;
  layer2CrystalDepositionRelief: number;
  layer2CrystalDepositionAudioReactive: number;
  layer2CrystalDepositionWireframe: boolean;
  layer2ErosionTrailDensity: number;
  layer2ErosionTrailOpacity: number;
  layer2ErosionTrailLength: number;
  layer2ErosionTrailDrift: number;
  layer2ErosionTrailAudioReactive: number;
  layer2VoxelOpacity: number;
  layer2VoxelScale: number;
  layer2VoxelDensity: number;
  layer2VoxelSnap: number;
  layer2VoxelAudioReactive: number;
  layer2VoxelWireframe: boolean;
  layer2PatchOpacity: number;
  layer2PatchResolution: number;
  layer2PatchRelax: number;
  layer2PatchFresnel: number;
  layer2PatchAudioReactive: number;
  layer2PatchWireframe: boolean;
  layer2HullOpacity: number;
  layer2HullPointBudget: number;
  layer2HullJitter: number;
  layer2HullFresnel: number;
  layer2HullAudioReactive: number;
  layer2HullWireframe: boolean;
  layer2ReactionOpacity: number;
  layer2ReactionFeed: number;
  layer2ReactionKill: number;
  layer2ReactionScale: number;
  layer2ReactionWarp: number;
  layer2ReactionAudioReactive: number;
  layer2ReactionModel: 'gray-scott' | 'fhn' | 'lenia';
  layer2ReactionFhnEpsilon: number;
  layer2ReactionFhnA: number;
  layer2ReactionFhnB: number;
  layer2ReactionFhnGain: number;
  layer2ReactionLeniaMu: number;
  layer2ReactionLeniaSigma: number;
  layer2ReactionLeniaRadius: number;
  layer2ReactionLeniaDt: number;
  layer2ReactionLeniaKernel: 'ring' | 'double' | 'blob';
  layer2ReactionLeniaGain: number;
  layer2PhysarumSensorAngle: number;
  layer2PhysarumSensorDistance: number;
  layer2PhysarumTurnSpeed: number;
  layer2PhysarumSpeed: number;
  layer2PhysarumDeposit: number;
  layer2PhysarumDecay: number;
  layer2PhysarumOpacity: number;
  layer2PhysarumDisplay: 'sheet' | 'sphere';
  layer2DlaWalkers: number;
  layer2DlaSteps: number;
  layer2DlaStickiness: number;
  layer2DlaThickness: number;
  layer2DlaThicknessDecay: number;
  layer2DlaSeedShape: 'point' | 'line' | 'ring' | 'multi';
  layer2DlaSeed: number;
  layer2DlaOpacity: number;
  layer2LsysPreset: 'plant' | 'fern' | 'tree' | 'coral' | 'lightning';
  layer2LsysDepth: number;
  layer2LsysAngle: number;
  layer2LsysLengthDecay: number;
  layer2LsysSeed: number;
  layer2LsysWind: number;
  layer2LsysCurvature: number;
  layer2LsysOpacity: number;
  layer2RaymarchShape: 'mandelbulb' | 'blobs' | 'columns';
  layer2RaymarchScale: number;
  layer2RaymarchSteps: number;
  layer2RaymarchPower: number;
  layer2RaymarchRotation: number;
  layer2RaymarchDistance: number;
  layer2RaymarchOpacity: number;
  layer2FogOpacity: number;
  layer2FogDensity: number;
  layer2FogDepth: number;
  layer2FogScale: number;
  layer2FogDrift: number;
  layer2FogSlices: number;
  layer2FogGlow: number;
  layer2FogAnisotropy: number;
  layer2FogAudioReactive: number;
  layer2GlyphOutlineEnabled: boolean;
  layer2GlyphOutlineWidth: number;
  layer2GlyphOutlineOpacity: number;
  layer2GlyphOutlineDepthBias: number;
  layer2GlyphOutlineAudioReactive: number;

}
