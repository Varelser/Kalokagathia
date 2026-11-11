import type { ParticleConfig, ProjectExecutionRoutingSnapshot } from '../types';
import type { ProceduralSystemId } from './proceduralModeRegistry';

export type LayerExecutionRoute = ProjectExecutionRoutingSnapshot & {
  key: 'layer2' | 'layer3';
};

export type GpgpuExecutionRoute = ProjectExecutionRoutingSnapshot & {
  key: 'gpgpu';
};

export interface LayerRuntimeTemporalSnapshot {
  enabled: boolean;
  profile: ParticleConfig['layer2TemporalProfile'];
  strength: number;
}

export interface LayerRuntimeConfigSnapshot extends LayerRuntimeTemporalSnapshot {
  route: LayerExecutionRoute;
  mode: ParticleConfig['layer2Type'];
  source: ParticleConfig['layer2Source'];
  color: string;
  radiusScale: number;
  materialStyle: ParticleConfig['layer2MaterialStyle'];
  geomMode3D: ParticleConfig['layer2GeomMode3D'];
  mediaLumaMap: number[];
  glyphOutlineEnabled: boolean;
  auxEnabled: boolean;
  sparkEnabled: boolean;
  connectionEnabled: boolean;
  connectionStyle: ParticleConfig['layer2ConnectionStyle'];
  ghostTrailEnabled: boolean;
}

export interface LayerRuntimeDepositionSnapshot extends LayerRuntimeConfigSnapshot {
  opacity: number;
  relief: number;
  erosion: number;
  bands: number;
  audioReactive: number;
  wireframe: boolean;
}

export interface LayerRuntimePatchSnapshot extends LayerRuntimeConfigSnapshot {
  resolution: number;
  opacity: number;
  fresnel: number;
  relax: number;
  wireframe: boolean;
  audioReactive: number;
}

export interface LayerRuntimeGrowthSnapshot extends LayerRuntimeConfigSnapshot {
  opacity: number;
  length: number;
  branches: number;
  spread: number;
  audioReactive: number;
}

export interface LayerRuntimeFogSnapshot extends LayerRuntimeConfigSnapshot {
  opacity: number;
  density: number;
  depth: number;
  scale: number;
  drift: number;
  slices: number;
  glow: number;
  anisotropy: number;
  audioReactive: number;
}

export interface LayerRuntimeSourceLayoutSnapshot extends LayerRuntimeConfigSnapshot {
  count: number;
  sourceCount: number;
  sourceSpread: number;
  counts: number[];
  sizes: number[];
  radiusScales: number[];
  flowSpeeds: number[];
  flowAmps: number[];
  flowFreqs: number[];
  motions: ParticleConfig['layer2Motions'];
  motionMix: ParticleConfig['layer2MotionMix'];
  motionChainEnabled: ParticleConfig['layer2MotionChainEnabled'];
  motionChain: ParticleConfig['layer2MotionChain'];
  sourcePositions: ParticleConfig['layer2SourcePositions'];
  mediaMapWidth: number;
  mediaMapHeight: number;
  mediaThreshold: number;
  mediaDepth: number;
  mediaInvert: boolean;
}

export interface LayerRuntimeParticleFieldSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  baseSize: number;
  flowSpeed: number;
  flowAmplitude: number;
  flowFrequency: number;
  noiseScale: number;
  complexity: number;
  evolution: number;
  fidelity: number;
  octaveMult: number;
  gravity: number;
  resistance: number;
  viscosity: number;
  fluidForce: number;
  affectPos: number;
  moveWithWind: number;
  interactionNeighbor: number;
  collisionMode: ParticleConfig['layer2CollisionMode'];
  collisionRadius: number;
  repulsion: number;
  trail: number;
  life: number;
  lifeSpread: number;
  lifeSizeBoost: number;
  lifeSizeTaper: number;
  burst: number;
  sparkBurst: number;
  burstPhase: number;
  burstMode: ParticleConfig['layer2BurstMode'];
  burstWaveform: ParticleConfig['layer2BurstWaveform'];
  burstSweepSpeed: number;
  burstSweepTilt: number;
  burstConeWidth: number;
  emitterOrbitSpeed: number;
  emitterOrbitRadius: number;
  emitterPulseAmount: number;
  trailDrag: number;
  trailTurbulence: number;
  trailDrift: number;
  velocityGlow: number;
  velocityAlpha: number;
  flickerAmount: number;
  flickerSpeed: number;
  streak: number;
  spriteMode: ParticleConfig['layer2SpriteMode'];
  auxLife: number;
  sparkLife: number;
  auxCount: number;
  auxDiffusion: number;
  sparkCount: number;
  sparkDiffusion: number;
  mouseForce: number;
  mouseRadius: number;
  windX: number;
  windY: number;
  windZ: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  boundaryY: number;
  boundaryEnabled: boolean;
  boundaryBounce: number;
}

export interface LayerRuntimeParticleVisualSnapshot extends LayerRuntimeConfigSnapshot {
  geomScale3D: number;
  mediaDepth: number;
}

export interface LayerRuntimeSdfSnapshot {
  enabled: boolean;
  shape: ParticleConfig['layer2SdfShape'];
  lightX: number;
  lightY: number;
  specular: number;
  shininess: number;
  ambient: number;
}

export interface LayerRuntimeGhostTrailSnapshot {
  enabled: boolean;
  count: number;
  dt: number;
  fade: number;
}

export interface LayerRuntimeBrushSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  opacity: number;
  layers: number;
  scale: number;
  jitter: number;
  audioReactive: number;
}

export interface LayerRuntimeCrystalSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  opacity: number;
  scale: number;
  density: number;
  spread: number;
  audioReactive: number;
  wireframe: boolean;
}

export interface LayerRuntimeCrystalDepositionSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  opacity: number;
  crystalScale: number;
  density: number;
  relief: number;
  audioReactive: number;
  wireframe: boolean;
}

export interface LayerRuntimeVoxelSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  opacity: number;
  scale: number;
  density: number;
  snap: number;
  audioReactive: number;
  wireframe: boolean;
}

export interface LayerRuntimeErosionTrailSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  trailCount: number;
  opacity: number;
  length: number;
  drift: number;
  audioReactive: number;
}

export interface LayerRuntimeHullSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  pointBudget: number;
  jitter: number;
  audioReactive: number;
  opacity: number;
  fresnel: number;
  wireframe: boolean;
}

export interface LayerRuntimeGlyphOutlineSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  depthBias: number;
  opacity: number;
  width: number;
  audioReactive: number;
}

export interface LayerRuntimeFiberSnapshot extends LayerRuntimeSourceLayoutSnapshot {
  strandCount: number;
  opacity: number;
  length: number;
  curl: number;
  audioReactive: number;
}

export interface LayerRuntimeLineSnapshot extends LayerRuntimeConfigSnapshot {
  connectionDistance: number;
  connectionOpacity: number;
  velocityGlow: number;
  velocityAlpha: number;
  burstPulse: number;
  shimmer: number;
  flickerSpeed: number;
  width: number;
  softness: number;
}

export interface LayerSceneRenderPlan {
  route: LayerExecutionRoute;
  particleCore: boolean;
  proceduralSystemId: ProceduralSystemId | null;
  hybridSystemId: ProceduralSystemId | null;
  glyphOutline: boolean;
  auxParticles: boolean;
  sparkParticles: boolean;
  instancedSolids: boolean;
  connectionStyle: string | null;
  ghostTrail: boolean;
  sceneBranches: string[];
}

export interface GpgpuRenderOutputPlan {
  route?: GpgpuExecutionRoute;
  core: boolean;
  pointSprites: boolean;
  instancedSolids: boolean;
  trailPoints: boolean;
  ribbons: boolean;
  tubes: boolean;
  streakLines: boolean;
  smoothTubes: boolean;
  metaballs: boolean;
  volumetric: boolean;
  sceneBranches: string[];
}

