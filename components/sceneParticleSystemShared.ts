import type { ParticleConfig } from '../types';
import { getLayerRuntimeParticleFieldSnapshot, getLayerRuntimeSourceLayoutSnapshot } from '../lib/sceneRenderRouting';
import { resolveSourceRoute } from '../lib/motionRoute';
import type { AuxMode } from './particleData';

function getSpriteModeValue(mode: ParticleConfig['layer2SpriteMode']) {
  if (mode === 'ring') return 1;
  if (mode === 'spark') return 2;
  return 0;
}

function getBurstModeValue(mode: ParticleConfig['layer2BurstMode']) {
  if (mode === 'cone') return 1;
  if (mode === 'sweep') return 2;
  return 0;
}

function getBurstWaveformValue(mode: ParticleConfig['layer2BurstWaveform']) {
  if (mode === 'loop') return 1;
  if (mode === 'stutter') return 2;
  if (mode === 'heartbeat') return 3;
  return 0;
}

export type LayerParams = {
  speed: number;
  amp: number;
  freq: number;
  noise: number;
  complexity: number;
  evol: number;
  fid: number;
  oct: number;
  rad: number;
  size: number;
  grav: number;
  resistance: number;
  vis: number;
  fluid: number;
  affectPos: number;
  moveWithWind: number;
  neighborForce: number;
  collisionMode: number;
  collisionRadius: number;
  repulsion: number;
  trail: number;
  life: number;
  lifeSpread: number;
  lifeSizeBoost: number;
  lifeSizeTaper: number;
  burst: number;
  burstPhase: number;
  burstMode: number;
  burstWaveform: number;
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
  spriteMode: number;
  auxLife: number;
  mouseForce: number;
  mouseRadius: number;
  windX: number;
  windY: number;
  windZ: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  boundaryY: number;
  boundaryEnabled: number;
  boundaryBounce: number;
};

export function resolveLayerParams(
  config: ParticleConfig,
  layerIndex: 2 | 3,
  isAux: boolean,
  auxMode: AuxMode,
): LayerParams {
  const runtime = getLayerRuntimeParticleFieldSnapshot(config, layerIndex);

  const size = isAux
    ? (auxMode === 'spark' ? runtime.baseSize * (layerIndex === 2 ? 0.42 : 0.36) : runtime.baseSize * 0.6)
    : runtime.baseSize;

  const sparkTrailMin = layerIndex === 2 ? 0.85 : 0.9;
  const trail = isAux && auxMode === 'spark' ? Math.max(runtime.trail, sparkTrailMin) : runtime.trail;

  const burst = isAux && auxMode === 'spark' ? Math.max(runtime.burst, runtime.sparkBurst) : runtime.burst;

  const sparkStreakMin = layerIndex === 2 ? 1.2 : 1.25;
  const streak = isAux && auxMode === 'spark' ? Math.max(runtime.streak, sparkStreakMin) : runtime.streak;

  const spriteMode = isAux && auxMode === 'spark'
    ? getSpriteModeValue('spark')
    : getSpriteModeValue(runtime.spriteMode);

  const auxLife = auxMode === 'spark' ? runtime.sparkLife : runtime.auxLife;

  return {
    speed: runtime.flowSpeed,
    amp: runtime.flowAmplitude,
    freq: runtime.flowFrequency,
    noise: runtime.noiseScale,
    complexity: runtime.complexity,
    evol: runtime.evolution,
    fid: runtime.fidelity,
    oct: runtime.octaveMult,
    rad: config.sphereRadius * runtime.radiusScale,
    size,
    grav: runtime.gravity,
    resistance: runtime.resistance,
    vis: runtime.viscosity,
    fluid: runtime.fluidForce,
    affectPos: runtime.affectPos,
    moveWithWind: runtime.moveWithWind,
    neighborForce: runtime.interactionNeighbor,
    collisionMode: runtime.collisionMode === 'world' ? 1 : 0,
    collisionRadius: runtime.collisionRadius,
    repulsion: runtime.repulsion,
    trail,
    life: runtime.life,
    lifeSpread: runtime.lifeSpread,
    lifeSizeBoost: runtime.lifeSizeBoost,
    lifeSizeTaper: runtime.lifeSizeTaper,
    burst,
    burstPhase: runtime.burstPhase,
    burstMode: getBurstModeValue(runtime.burstMode),
    burstWaveform: getBurstWaveformValue(runtime.burstWaveform),
    burstSweepSpeed: runtime.burstSweepSpeed,
    burstSweepTilt: runtime.burstSweepTilt,
    burstConeWidth: runtime.burstConeWidth,
    emitterOrbitSpeed: runtime.emitterOrbitSpeed,
    emitterOrbitRadius: runtime.emitterOrbitRadius,
    emitterPulseAmount: runtime.emitterPulseAmount,
    trailDrag: runtime.trailDrag,
    trailTurbulence: runtime.trailTurbulence,
    trailDrift: runtime.trailDrift,
    velocityGlow: runtime.velocityGlow,
    velocityAlpha: runtime.velocityAlpha,
    flickerAmount: runtime.flickerAmount,
    flickerSpeed: runtime.flickerSpeed,
    streak,
    spriteMode,
    auxLife,
    mouseForce: runtime.mouseForce,
    mouseRadius: runtime.mouseRadius,
    windX: runtime.windX,
    windY: runtime.windY,
    windZ: runtime.windZ,
    spinX: runtime.spinX,
    spinY: runtime.spinY,
    spinZ: runtime.spinZ,
    boundaryY: runtime.boundaryY,
    boundaryEnabled: runtime.boundaryEnabled ? 1 : 0,
    boundaryBounce: runtime.boundaryBounce,
  };
}

export function buildParticleGeometryKey(
  config: ParticleConfig,
  layerIndex: 1 | 2 | 3 | 4,
  isAux: boolean,
  auxMode: AuxMode,
) {
  return JSON.stringify([
    layerIndex,
    isAux,
    layerIndex === 1 ? [
      config.layer1Count, config.layer1SourceCount, config.layer1SourceSpread,
      config.layer1SourcePositions, config.layer1Counts, config.layer1Radii, config.layer1Sizes,
      config.layer1Volume, config.layer1Volumes,
      config.layer1PulseSpeeds, config.layer1PulseAmps, config.layer1Jitters,
    ] : layerIndex === 2 ? (() => {
      const runtime = getLayerRuntimeParticleFieldSnapshot(config, 2);
      const layout = getLayerRuntimeSourceLayoutSnapshot(config, 2, runtime.route);
      const shapeRoute = resolveSourceRoute(config, 2);
      const shapeRuntime = shapeRoute ? getLayerRuntimeParticleFieldSnapshot(config, shapeRoute) : runtime;
      const shapeLayout = shapeRoute ? getLayerRuntimeSourceLayoutSnapshot(config, shapeRoute, shapeRuntime.route) : layout;
      return [
        runtime.count, shapeLayout.sourceCount, shapeLayout.sourceSpread,
        shapeRuntime.source, shapeLayout.sourcePositions, runtime.mode,
        layout.motionMix, layout.motions, shapeLayout.counts, layout.radiusScales,
        layout.sizes, layout.flowSpeeds, layout.flowAmps, layout.flowFreqs,
        runtime.auxCount, runtime.auxDiffusion, runtime.sparkCount, runtime.sparkDiffusion, auxMode,
      ];
    })() : layerIndex === 3 ? (() => {
      const runtime = getLayerRuntimeParticleFieldSnapshot(config, 3);
      const layout = getLayerRuntimeSourceLayoutSnapshot(config, 3, runtime.route);
      const shapeRoute = resolveSourceRoute(config, 3);
      const shapeRuntime = shapeRoute ? getLayerRuntimeParticleFieldSnapshot(config, shapeRoute) : runtime;
      const shapeLayout = shapeRoute ? getLayerRuntimeSourceLayoutSnapshot(config, shapeRoute, shapeRuntime.route) : layout;
      return [
        runtime.count, shapeLayout.sourceCount, shapeLayout.sourceSpread,
        shapeRuntime.source, shapeLayout.sourcePositions, runtime.mode,
        layout.motionMix, layout.motions, shapeLayout.counts, layout.radiusScales,
        layout.sizes, layout.flowSpeeds, layout.flowAmps, layout.flowFreqs,
        runtime.auxCount, runtime.auxDiffusion, runtime.sparkCount, runtime.sparkDiffusion, auxMode,
      ];
    })() : [config.ambientCount, config.ambientSpread],
  ]);
}
