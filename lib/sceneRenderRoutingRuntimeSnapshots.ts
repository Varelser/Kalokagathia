import type { ParticleConfig } from '../types';
import type { LayerExecutionRoute, LayerRuntimeBrushSnapshot, LayerRuntimeConfigSnapshot, LayerRuntimeCrystalDepositionSnapshot, LayerRuntimeCrystalSnapshot, LayerRuntimeDepositionSnapshot, LayerRuntimeErosionTrailSnapshot, LayerRuntimeFiberSnapshot, LayerRuntimeFogSnapshot, LayerRuntimeGhostTrailSnapshot, LayerRuntimeGlyphOutlineSnapshot, LayerRuntimeGrowthSnapshot, LayerRuntimeHullSnapshot, LayerRuntimeLineSnapshot, LayerRuntimeParticleFieldSnapshot, LayerRuntimeParticleVisualSnapshot, LayerRuntimePatchSnapshot, LayerRuntimeSdfSnapshot, LayerRuntimeSourceLayoutSnapshot, LayerRuntimeTemporalSnapshot, LayerRuntimeVoxelSnapshot } from './sceneRenderRoutingTypes';

import { getLayerRoute, getLayerRuntimeAuxEnabled, getLayerRuntimeColor, getLayerRuntimeConnectionEnabled, getLayerRuntimeConnectionStyle, getLayerRuntimeEnabled, getLayerRuntimeGeomMode3D, getLayerRuntimeGhostTrailEnabled, getLayerRuntimeGlyphOutlineEnabled, getLayerRuntimeMaterialStyle, getLayerRuntimeMediaLumaMap, getLayerRuntimeMode, getLayerRuntimeRadiusScale, getLayerRuntimeSource, getLayerRuntimeSparkEnabled, getLayerRuntimeTemporalProfile, getLayerRuntimeTemporalStrength } from './sceneRenderRoutingRuntimeAccessors';

export function getLayerRuntimeTemporalSnapshot(config: ParticleConfig, layerIndex: 2 | 3): LayerRuntimeTemporalSnapshot {
  return {
    enabled: getLayerRuntimeEnabled(config, layerIndex),
    profile: getLayerRuntimeTemporalProfile(config, layerIndex),
    strength: getLayerRuntimeTemporalStrength(config, layerIndex),
  };
}

export function getLayerRuntimeConfigSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeConfigSnapshot {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  return {
    route: resolvedRoute,
    enabled: getLayerRuntimeEnabled(config, layerIndex),
    profile: getLayerRuntimeTemporalProfile(config, layerIndex),
    strength: getLayerRuntimeTemporalStrength(config, layerIndex),
    mode: getLayerRuntimeMode(config, layerIndex, resolvedRoute),
    source: getLayerRuntimeSource(config, layerIndex),
    color: getLayerRuntimeColor(config, layerIndex),
    radiusScale: getLayerRuntimeRadiusScale(config, layerIndex),
    materialStyle: getLayerRuntimeMaterialStyle(config, layerIndex),
    geomMode3D: getLayerRuntimeGeomMode3D(config, layerIndex),
    mediaLumaMap: getLayerRuntimeMediaLumaMap(config, layerIndex),
    glyphOutlineEnabled: getLayerRuntimeGlyphOutlineEnabled(config, layerIndex),
    auxEnabled: getLayerRuntimeAuxEnabled(config, layerIndex),
    sparkEnabled: getLayerRuntimeSparkEnabled(config, layerIndex),
    connectionEnabled: getLayerRuntimeConnectionEnabled(config, layerIndex),
    connectionStyle: getLayerRuntimeConnectionStyle(config, layerIndex),
    ghostTrailEnabled: getLayerRuntimeGhostTrailEnabled(config, layerIndex),
  };
}

export function getLayerRuntimeSourceLayoutSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeSourceLayoutSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    count: layerIndex === 2 ? config.layer2Count : config.layer3Count,
    sourceCount: layerIndex === 2 ? config.layer2SourceCount : config.layer3SourceCount,
    sourceSpread: layerIndex === 2 ? config.layer2SourceSpread : config.layer3SourceSpread,
    counts: layerIndex === 2 ? config.layer2Counts : config.layer3Counts,
    sizes: layerIndex === 2 ? config.layer2Sizes : config.layer3Sizes,
    radiusScales: layerIndex === 2 ? config.layer2RadiusScales : config.layer3RadiusScales,
    flowSpeeds: layerIndex === 2 ? config.layer2FlowSpeeds : config.layer3FlowSpeeds,
    flowAmps: layerIndex === 2 ? config.layer2FlowAmps : config.layer3FlowAmps,
    flowFreqs: layerIndex === 2 ? config.layer2FlowFreqs : config.layer3FlowFreqs,
    motions: layerIndex === 2 ? config.layer2Motions : config.layer3Motions,
    motionMix: layerIndex === 2 ? config.layer2MotionMix : config.layer3MotionMix,
    motionChainEnabled: layerIndex === 2 ? config.layer2MotionChainEnabled : config.layer3MotionChainEnabled,
    motionChain: layerIndex === 2 ? config.layer2MotionChain : config.layer3MotionChain,
    sourcePositions: layerIndex === 2 ? config.layer2SourcePositions : config.layer3SourcePositions,
    mediaMapWidth: layerIndex === 2 ? config.layer2MediaMapWidth : config.layer3MediaMapWidth,
    mediaMapHeight: layerIndex === 2 ? config.layer2MediaMapHeight : config.layer3MediaMapHeight,
    mediaThreshold: layerIndex === 2 ? config.layer2MediaThreshold : config.layer3MediaThreshold,
    mediaDepth: layerIndex === 2 ? config.layer2MediaDepth : config.layer3MediaDepth,
    mediaInvert: layerIndex === 2 ? config.layer2MediaInvert : config.layer3MediaInvert,
  };
}

export function getLayerParticleLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3, extraDeps: readonly unknown[] = []): readonly unknown[] {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex);
  return [
    layerIndex,
    runtime.count,
    runtime.source,
    runtime.sourceCount,
    runtime.sourceSpread,
    runtime.counts,
    runtime.mediaLumaMap,
    runtime.mediaMapWidth,
    runtime.mediaMapHeight,
    runtime.mediaThreshold,
    runtime.mediaDepth,
    runtime.mediaInvert,
    runtime.sourcePositions,
    runtime.motionMix,
    runtime.motions,
    runtime.mode,
    runtime.radiusScales,
    runtime.flowSpeeds,
    runtime.flowAmps,
    runtime.flowFreqs,
    runtime.sizes,
    ...extraDeps,
  ] as const;
}

export function getLayerRuntimeParticleFieldSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeParticleFieldSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    baseSize: layerIndex === 2 ? config.layer2BaseSize : config.layer3BaseSize,
    flowSpeed: layerIndex === 2 ? config.layer2FlowSpeed : config.layer3FlowSpeed,
    flowAmplitude: layerIndex === 2 ? config.layer2FlowAmplitude : config.layer3FlowAmplitude,
    flowFrequency: layerIndex === 2 ? config.layer2FlowFrequency : config.layer3FlowFrequency,
    noiseScale: layerIndex === 2 ? config.layer2NoiseScale : config.layer3NoiseScale,
    complexity: layerIndex === 2 ? config.layer2Complexity : config.layer3Complexity,
    evolution: layerIndex === 2 ? config.layer2Evolution : config.layer3Evolution,
    fidelity: layerIndex === 2 ? config.layer2Fidelity : config.layer3Fidelity,
    octaveMult: layerIndex === 2 ? config.layer2OctaveMult : config.layer3OctaveMult,
    gravity: layerIndex === 2 ? config.layer2Gravity : config.layer3Gravity,
    resistance: layerIndex === 2 ? config.layer2Resistance : config.layer3Resistance,
    viscosity: layerIndex === 2 ? config.layer2Viscosity : config.layer3Viscosity,
    fluidForce: layerIndex === 2 ? config.layer2FluidForce : config.layer3FluidForce,
    affectPos: layerIndex === 2 ? config.layer2AffectPos : config.layer3AffectPos,
    moveWithWind: layerIndex === 2 ? config.layer2MoveWithWind : config.layer3MoveWithWind,
    interactionNeighbor: layerIndex === 2 ? config.layer2InteractionNeighbor : config.layer3InteractionNeighbor,
    collisionMode: layerIndex === 2 ? config.layer2CollisionMode : config.layer3CollisionMode,
    collisionRadius: layerIndex === 2 ? config.layer2CollisionRadius : config.layer3CollisionRadius,
    repulsion: layerIndex === 2 ? config.layer2Repulsion : config.layer3Repulsion,
    trail: layerIndex === 2 ? config.layer2Trail : config.layer3Trail,
    life: layerIndex === 2 ? config.layer2Life : config.layer3Life,
    lifeSpread: layerIndex === 2 ? config.layer2LifeSpread : config.layer3LifeSpread,
    lifeSizeBoost: layerIndex === 2 ? config.layer2LifeSizeBoost : config.layer3LifeSizeBoost,
    lifeSizeTaper: layerIndex === 2 ? config.layer2LifeSizeTaper : config.layer3LifeSizeTaper,
    burst: layerIndex === 2 ? config.layer2Burst : config.layer3Burst,
    sparkBurst: layerIndex === 2 ? config.layer2SparkBurst : config.layer3SparkBurst,
    burstPhase: layerIndex === 2 ? config.layer2BurstPhase : config.layer3BurstPhase,
    burstMode: layerIndex === 2 ? config.layer2BurstMode : config.layer3BurstMode,
    burstWaveform: layerIndex === 2 ? config.layer2BurstWaveform : config.layer3BurstWaveform,
    burstSweepSpeed: layerIndex === 2 ? config.layer2BurstSweepSpeed : config.layer3BurstSweepSpeed,
    burstSweepTilt: layerIndex === 2 ? config.layer2BurstSweepTilt : config.layer3BurstSweepTilt,
    burstConeWidth: layerIndex === 2 ? config.layer2BurstConeWidth : config.layer3BurstConeWidth,
    emitterOrbitSpeed: layerIndex === 2 ? config.layer2EmitterOrbitSpeed : config.layer3EmitterOrbitSpeed,
    emitterOrbitRadius: layerIndex === 2 ? config.layer2EmitterOrbitRadius : config.layer3EmitterOrbitRadius,
    emitterPulseAmount: layerIndex === 2 ? config.layer2EmitterPulseAmount : config.layer3EmitterPulseAmount,
    trailDrag: layerIndex === 2 ? config.layer2TrailDrag : config.layer3TrailDrag,
    trailTurbulence: layerIndex === 2 ? config.layer2TrailTurbulence : config.layer3TrailTurbulence,
    trailDrift: layerIndex === 2 ? config.layer2TrailDrift : config.layer3TrailDrift,
    velocityGlow: layerIndex === 2 ? config.layer2VelocityGlow : config.layer3VelocityGlow,
    velocityAlpha: layerIndex === 2 ? config.layer2VelocityAlpha : config.layer3VelocityAlpha,
    flickerAmount: layerIndex === 2 ? config.layer2FlickerAmount : config.layer3FlickerAmount,
    flickerSpeed: layerIndex === 2 ? config.layer2FlickerSpeed : config.layer3FlickerSpeed,
    streak: layerIndex === 2 ? config.layer2Streak : config.layer3Streak,
    spriteMode: layerIndex === 2 ? config.layer2SpriteMode : config.layer3SpriteMode,
    auxLife: layerIndex === 2 ? config.layer2AuxLife : config.layer3AuxLife,
    sparkLife: layerIndex === 2 ? config.layer2SparkLife : config.layer3SparkLife,
    auxCount: layerIndex === 2 ? config.layer2AuxCount : config.layer3AuxCount,
    auxDiffusion: layerIndex === 2 ? config.layer2AuxDiffusion : config.layer3AuxDiffusion,
    sparkCount: layerIndex === 2 ? config.layer2SparkCount : config.layer3SparkCount,
    sparkDiffusion: layerIndex === 2 ? config.layer2SparkDiffusion : config.layer3SparkDiffusion,
    mouseForce: layerIndex === 2 ? config.layer2MouseForce : config.layer3MouseForce,
    mouseRadius: layerIndex === 2 ? config.layer2MouseRadius : config.layer3MouseRadius,
    windX: layerIndex === 2 ? config.layer2WindX : config.layer3WindX,
    windY: layerIndex === 2 ? config.layer2WindY : config.layer3WindY,
    windZ: layerIndex === 2 ? config.layer2WindZ : config.layer3WindZ,
    spinX: layerIndex === 2 ? config.layer2SpinX : config.layer3SpinX,
    spinY: layerIndex === 2 ? config.layer2SpinY : config.layer3SpinY,
    spinZ: layerIndex === 2 ? config.layer2SpinZ : config.layer3SpinZ,
    boundaryY: layerIndex === 2 ? config.layer2BoundaryY : config.layer3BoundaryY,
    boundaryEnabled: layerIndex === 2 ? config.layer2BoundaryEnabled : config.layer3BoundaryEnabled,
    boundaryBounce: layerIndex === 2 ? config.layer2BoundaryBounce : config.layer3BoundaryBounce,
  };
}

export function getLayerRuntimeParticleVisualSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeParticleVisualSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    geomScale3D: layerIndex === 2 ? config.layer2GeomScale3D : config.layer3GeomScale3D,
    mediaDepth: layerIndex === 2 ? config.layer2MediaDepth : config.layer3MediaDepth,
  };
}

export function getLayerRuntimeSdfSnapshot(config: ParticleConfig, layerIndex: 2 | 3): LayerRuntimeSdfSnapshot {
  return {
    enabled: layerIndex === 2 ? config.layer2SdfEnabled : config.layer3SdfEnabled,
    shape: layerIndex === 2 ? config.layer2SdfShape : config.layer3SdfShape,
    lightX: layerIndex === 2 ? config.layer2SdfLightX : config.layer3SdfLightX,
    lightY: layerIndex === 2 ? config.layer2SdfLightY : config.layer3SdfLightY,
    specular: layerIndex === 2 ? config.layer2SdfSpecular : config.layer3SdfSpecular,
    shininess: layerIndex === 2 ? config.layer2SdfShininess : config.layer3SdfShininess,
    ambient: layerIndex === 2 ? config.layer2SdfAmbient : config.layer3SdfAmbient,
  };
}

export function getLayerRuntimeGhostTrailSnapshot(config: ParticleConfig, layerIndex: 2 | 3): LayerRuntimeGhostTrailSnapshot {
  return {
    enabled: layerIndex === 2 ? config.layer2GhostTrailEnabled : config.layer3GhostTrailEnabled,
    count: layerIndex === 2 ? config.layer2GhostTrailCount : config.layer3GhostTrailCount,
    dt: layerIndex === 2 ? config.layer2GhostTrailDt : config.layer3GhostTrailDt,
    fade: layerIndex === 2 ? config.layer2GhostTrailFade : config.layer3GhostTrailFade,
  };
}

export function getLayerRuntimeBrushSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeBrushSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2BrushOpacity : config.layer3BrushOpacity,
    layers: layerIndex === 2 ? config.layer2BrushLayers : config.layer3BrushLayers,
    scale: layerIndex === 2 ? config.layer2BrushScale : config.layer3BrushScale,
    jitter: layerIndex === 2 ? config.layer2BrushJitter : config.layer3BrushJitter,
    audioReactive: layerIndex === 2 ? config.layer2BrushAudioReactive : config.layer3BrushAudioReactive,
  };
}

export function getLayerRuntimeCrystalSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeCrystalSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2CrystalOpacity : config.layer3CrystalOpacity,
    scale: layerIndex === 2 ? config.layer2CrystalScale : config.layer3CrystalScale,
    density: layerIndex === 2 ? config.layer2CrystalDensity : config.layer3CrystalDensity,
    spread: layerIndex === 2 ? config.layer2CrystalSpread : config.layer3CrystalSpread,
    audioReactive: layerIndex === 2 ? config.layer2CrystalAudioReactive : config.layer3CrystalAudioReactive,
    wireframe: layerIndex === 2 ? config.layer2CrystalWireframe : config.layer3CrystalWireframe,
  };
}

export function getLayerRuntimeCrystalDepositionSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeCrystalDepositionSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2CrystalDepositionOpacity : config.layer3CrystalDepositionOpacity,
    crystalScale: layerIndex === 2 ? config.layer2CrystalDepositionCrystalScale : config.layer3CrystalDepositionCrystalScale,
    density: layerIndex === 2 ? config.layer2CrystalDepositionDensity : config.layer3CrystalDepositionDensity,
    relief: layerIndex === 2 ? config.layer2CrystalDepositionRelief : config.layer3CrystalDepositionRelief,
    audioReactive: layerIndex === 2 ? config.layer2CrystalDepositionAudioReactive : config.layer3CrystalDepositionAudioReactive,
    wireframe: layerIndex === 2 ? config.layer2CrystalDepositionWireframe : config.layer3CrystalDepositionWireframe,
  };
}

export function getLayerRuntimeVoxelSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeVoxelSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2VoxelOpacity : config.layer3VoxelOpacity,
    scale: layerIndex === 2 ? config.layer2VoxelScale : config.layer3VoxelScale,
    density: layerIndex === 2 ? config.layer2VoxelDensity : config.layer3VoxelDensity,
    snap: layerIndex === 2 ? config.layer2VoxelSnap : config.layer3VoxelSnap,
    audioReactive: layerIndex === 2 ? config.layer2VoxelAudioReactive : config.layer3VoxelAudioReactive,
    wireframe: layerIndex === 2 ? config.layer2VoxelWireframe : config.layer3VoxelWireframe,
  };
}

export function getLayerRuntimeErosionTrailSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeErosionTrailSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    trailCount: layerIndex === 2 ? config.layer2ErosionTrailDensity : config.layer3ErosionTrailDensity,
    opacity: layerIndex === 2 ? config.layer2ErosionTrailOpacity : config.layer3ErosionTrailOpacity,
    length: layerIndex === 2 ? config.layer2ErosionTrailLength : config.layer3ErosionTrailLength,
    drift: layerIndex === 2 ? config.layer2ErosionTrailDrift : config.layer3ErosionTrailDrift,
    audioReactive: layerIndex === 2 ? config.layer2ErosionTrailAudioReactive : config.layer3ErosionTrailAudioReactive,
  };
}

export function getLayerRuntimeDepositionSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeDepositionSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2DepositionOpacity : config.layer3DepositionOpacity,
    relief: layerIndex === 2 ? config.layer2DepositionRelief : config.layer3DepositionRelief,
    erosion: layerIndex === 2 ? config.layer2DepositionErosion : config.layer3DepositionErosion,
    bands: layerIndex === 2 ? config.layer2DepositionBands : config.layer3DepositionBands,
    audioReactive: layerIndex === 2 ? config.layer2DepositionAudioReactive : config.layer3DepositionAudioReactive,
    wireframe: layerIndex === 2 ? config.layer2DepositionWireframe : config.layer3DepositionWireframe,
  };
}

export function getLayerRuntimePatchSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimePatchSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    resolution: layerIndex === 2 ? config.layer2PatchResolution : config.layer3PatchResolution,
    opacity: layerIndex === 2 ? config.layer2PatchOpacity : config.layer3PatchOpacity,
    fresnel: layerIndex === 2 ? config.layer2PatchFresnel : config.layer3PatchFresnel,
    relax: layerIndex === 2 ? config.layer2PatchRelax : config.layer3PatchRelax,
    wireframe: layerIndex === 2 ? config.layer2PatchWireframe : config.layer3PatchWireframe,
    audioReactive: layerIndex === 2 ? config.layer2PatchAudioReactive : config.layer3PatchAudioReactive,
  };
}

export function getLayerRuntimeGrowthSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeGrowthSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2GrowthOpacity : config.layer3GrowthOpacity,
    length: layerIndex === 2 ? config.layer2GrowthLength : config.layer3GrowthLength,
    branches: layerIndex === 2 ? config.layer2GrowthBranches : config.layer3GrowthBranches,
    spread: layerIndex === 2 ? config.layer2GrowthSpread : config.layer3GrowthSpread,
    audioReactive: layerIndex === 2 ? config.layer2GrowthAudioReactive : config.layer3GrowthAudioReactive,
  };
}

export function getLayerRuntimeFogSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeFogSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    opacity: layerIndex === 2 ? config.layer2FogOpacity : config.layer3FogOpacity,
    density: layerIndex === 2 ? config.layer2FogDensity : config.layer3FogDensity,
    depth: layerIndex === 2 ? config.layer2FogDepth : config.layer3FogDepth,
    scale: layerIndex === 2 ? config.layer2FogScale : config.layer3FogScale,
    drift: layerIndex === 2 ? config.layer2FogDrift : config.layer3FogDrift,
    slices: layerIndex === 2 ? config.layer2FogSlices : config.layer3FogSlices,
    glow: layerIndex === 2 ? config.layer2FogGlow : config.layer3FogGlow,
    anisotropy: layerIndex === 2 ? config.layer2FogAnisotropy : config.layer3FogAnisotropy,
    audioReactive: layerIndex === 2 ? config.layer2FogAudioReactive : config.layer3FogAudioReactive,
  };
}

export function getLayerRuntimeHullSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeHullSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    pointBudget: layerIndex === 2 ? config.layer2HullPointBudget : config.layer3HullPointBudget,
    jitter: layerIndex === 2 ? config.layer2HullJitter : config.layer3HullJitter,
    audioReactive: layerIndex === 2 ? config.layer2HullAudioReactive : config.layer3HullAudioReactive,
    opacity: layerIndex === 2 ? config.layer2HullOpacity : config.layer3HullOpacity,
    fresnel: layerIndex === 2 ? config.layer2HullFresnel : config.layer3HullFresnel,
    wireframe: layerIndex === 2 ? config.layer2HullWireframe : config.layer3HullWireframe,
  };
}

export function getLayerRuntimeGlyphOutlineSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeGlyphOutlineSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    depthBias: layerIndex === 2 ? config.layer2GlyphOutlineDepthBias : config.layer3GlyphOutlineDepthBias,
    opacity: layerIndex === 2 ? config.layer2GlyphOutlineOpacity : config.layer3GlyphOutlineOpacity,
    width: layerIndex === 2 ? config.layer2GlyphOutlineWidth : config.layer3GlyphOutlineWidth,
    audioReactive: layerIndex === 2 ? config.layer2GlyphOutlineAudioReactive : config.layer3GlyphOutlineAudioReactive,
  };
}

export function getLayerRuntimeFiberSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeFiberSnapshot {
  const runtime = getLayerRuntimeSourceLayoutSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    strandCount: layerIndex === 2 ? config.layer2FiberDensity : config.layer3FiberDensity,
    opacity: layerIndex === 2 ? config.layer2FiberOpacity : config.layer3FiberOpacity,
    length: layerIndex === 2 ? config.layer2FiberLength : config.layer3FiberLength,
    curl: layerIndex === 2 ? config.layer2FiberCurl : config.layer3FiberCurl,
    audioReactive: layerIndex === 2 ? config.layer2FiberAudioReactive : config.layer3FiberAudioReactive,
  };
}

export function getLayerRuntimeLineSnapshot(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerRuntimeLineSnapshot {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex, route);
  return {
    ...runtime,
    connectionDistance: layerIndex === 2 ? config.layer2ConnectionDistance : config.layer3ConnectionDistance,
    connectionOpacity: layerIndex === 2 ? config.layer2ConnectionOpacity : config.layer3ConnectionOpacity,
    velocityGlow: layerIndex === 2 ? config.layer2LineVelocityGlow : config.layer3LineVelocityGlow,
    velocityAlpha: layerIndex === 2 ? config.layer2LineVelocityAlpha : config.layer3LineVelocityAlpha,
    burstPulse: layerIndex === 2 ? config.layer2LineBurstPulse : config.layer3LineBurstPulse,
    shimmer: layerIndex === 2 ? config.layer2LineShimmer : config.layer3LineShimmer,
    flickerSpeed: layerIndex === 2 ? config.layer2LineFlickerSpeed : config.layer3LineFlickerSpeed,
    width: layerIndex === 2 ? config.layer2ConnectionWidth : config.layer3ConnectionWidth,
    softness: layerIndex === 2 ? config.layer2ConnectionSoftness : config.layer3ConnectionSoftness,
  };
}
