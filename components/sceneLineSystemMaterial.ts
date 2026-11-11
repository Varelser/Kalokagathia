import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { resolveMotionChainCodes } from '../lib/motionChain';
import { resolveMotionRoute } from '../lib/motionRoute';
import { resolveMotionGraphVec4s } from '../lib/motionGraph';
import { resolveMotionDagPacked } from '../lib/motionDag';
import { resolveLayerParams } from './sceneParticleSystemShared';
import { getLayerRuntimeLineSnapshot } from '../lib/sceneRenderRouting';
import type { ShaderUniformMap } from './sceneShared';
import type { LineProfile } from './sceneLineSystemShared';

export function updateLineMaterial(mat: THREE.ShaderMaterial | null | undefined, config: ParticleConfig, layerIndex: 2 | 3, uniforms: ShaderUniformMap, connectionDistance: number, connectionOpacity: number, contactAmount: number, lineProfile: LineProfile) {
  if (!mat) return;
  const runtime = getLayerRuntimeLineSnapshot(config, layerIndex);
  const layerVelocityGlow = runtime.velocityGlow;
  const [chainType2, chainType3] = resolveMotionChainCodes(config, layerIndex);
  if (mat.uniforms.uMotionChainType2) mat.uniforms.uMotionChainType2.value = chainType2;
  if (mat.uniforms.uMotionChainType3) mat.uniforms.uMotionChainType3.value = chainType3;
  if (mat.uniforms.uWarpEnabled) mat.uniforms.uWarpEnabled.value = layerIndex === 2 ? (config.layer2WarpEnabled ? 1 : 0) : (config.layer3WarpEnabled ? 1 : 0);
  if (mat.uniforms.uWarpAmount) mat.uniforms.uWarpAmount.value = layerIndex === 2 ? config.layer2WarpAmount : config.layer3WarpAmount;
  if (mat.uniforms.uWarpScale) mat.uniforms.uWarpScale.value = layerIndex === 2 ? config.layer2WarpScale : config.layer3WarpScale;
  const graph = resolveMotionGraphVec4s(config, layerIndex);
  if (mat.uniforms.uGraphSteps) {
    const arr = mat.uniforms.uGraphSteps.value as THREE.Vector4[];
    for (let i = 0; i < graph.vec4s.length; i++) {
      const v = graph.vec4s[i];
      if (arr[i]) arr[i].set(v[0], v[1], v[2], v[3]);
    }
  }
  if (mat.uniforms.uGraphStepCount) mat.uniforms.uGraphStepCount.value = graph.count;
  const dag = resolveMotionDagPacked(config, layerIndex);
  if (mat.uniforms.uDagNodes) {
    const arr = mat.uniforms.uDagNodes.value as THREE.Vector4[];
    for (let i = 0; i < dag.vec4s.length; i++) {
      const v = dag.vec4s[i];
      if (arr[i]) arr[i].set(v[0], v[1], v[2], v[3]);
    }
  }
  if (mat.uniforms.uDagMotions) {
    const arr = mat.uniforms.uDagMotions.value as number[];
    for (let i = 0; i < dag.motions.length; i++) arr[i] = dag.motions[i];
  }
  if (mat.uniforms.uDagNodeCount) mat.uniforms.uDagNodeCount.value = dag.count;
  if (mat.uniforms.uDagOutput) mat.uniforms.uDagOutput.value = dag.output;
  const route = resolveMotionRoute(config, layerIndex);
  if (mat.uniforms.uMotionRouteType) mat.uniforms.uMotionRouteType.value = route ? route.codes[0] : -1;
  if (mat.uniforms.uMotionRouteChainType2) mat.uniforms.uMotionRouteChainType2.value = route ? route.codes[1] : -1;
  if (mat.uniforms.uMotionRouteChainType3) mat.uniforms.uMotionRouteChainType3.value = route ? route.codes[2] : -1;
  if (route) {
    const rp = resolveLayerParams(config, route.sourceLayer, false, 'aux');
    if (mat.uniforms.uRouteSpeed) mat.uniforms.uRouteSpeed.value = rp.speed;
    if (mat.uniforms.uRouteAmp) mat.uniforms.uRouteAmp.value = rp.amp;
    if (mat.uniforms.uRouteFreq) mat.uniforms.uRouteFreq.value = rp.freq;
    if (mat.uniforms.uRouteNoiseScale) mat.uniforms.uRouteNoiseScale.value = rp.noise;
    if (mat.uniforms.uRouteComplexity) mat.uniforms.uRouteComplexity.value = rp.complexity;
    if (mat.uniforms.uRouteEvolution) mat.uniforms.uRouteEvolution.value = rp.evol;
    if (mat.uniforms.uRouteFluidForce) mat.uniforms.uRouteFluidForce.value = rp.fluid;
    if (mat.uniforms.uRouteViscosity) mat.uniforms.uRouteViscosity.value = rp.vis;
    if (mat.uniforms.uRouteFidelity) mat.uniforms.uRouteFidelity.value = rp.fid;
    if (mat.uniforms.uRouteOctaveMult) mat.uniforms.uRouteOctaveMult.value = rp.oct;
    if (mat.uniforms.uRouteWind) mat.uniforms.uRouteWind.value.set(rp.windX, rp.windY, rp.windZ);
  }
  const layerVelocityAlpha = runtime.velocityAlpha;
  const layerBurstPulse = runtime.burstPulse;
  const layerLineShimmer = runtime.shimmer;
  const layerLineFlickerSpeed = runtime.flickerSpeed;
  const layerConnectionStyle = runtime.connectionStyle;
  const layerConnectionWidth = runtime.width;
  const layerConnectionSoftness = runtime.softness;
  const lineImpactBoost = config.interLayerContactFxEnabled && config.interLayerCollisionEnabled ? 1 + contactAmount * config.interLayerContactLineBoost : 1;
  Object.assign(mat.uniforms, {
    uTime: { value: uniforms.uTime.value },
    uAudioBassMotion: { value: uniforms.uAudioBassMotion.value },
    uAudioTrebleMotion: { value: uniforms.uAudioTrebleMotion.value },
    uAudioBassLine: { value: uniforms.uAudioBassLine.value },
    uAudioTrebleLine: { value: uniforms.uAudioTrebleLine.value },
    uAudioPulse: { value: uniforms.uAudioPulse.value },
    uAudioMorph: { value: uniforms.uAudioMorph.value },
    uAudioShatter: { value: uniforms.uAudioShatter.value },
    uAudioTwist: { value: uniforms.uAudioTwist.value },
    uAudioBend: { value: uniforms.uAudioBend.value },
    uAudioWarp: { value: uniforms.uAudioWarp.value },
  });
  mat.uniforms.uConnectDistance.value = connectionDistance;
  mat.uniforms.uOpacity.value = Math.min(1, connectionOpacity * lineImpactBoost * lineProfile.opacityMul);
  mat.uniforms.uLineVelocityGlow.value = layerVelocityGlow * lineProfile.glowMul;
  mat.uniforms.uLineVelocityAlpha.value = layerVelocityAlpha * lineProfile.alphaMul;
  mat.uniforms.uLineBurstPulse.value = layerBurstPulse * lineProfile.pulseMul;
  mat.uniforms.uLineShimmer.value = THREE.MathUtils.clamp(layerLineShimmer * lineProfile.shimmerMul, 0, 2);
  mat.uniforms.uLineFlickerSpeed.value = layerLineFlickerSpeed * lineProfile.flickerMul;
  mat.uniforms.uGlobalSpeed.value = uniforms.uGlobalSpeed.value;
  mat.uniforms.uGlobalAmp.value = uniforms.uGlobalAmp.value;
  mat.uniforms.uGlobalNoiseScale.value = uniforms.uGlobalNoiseScale.value;
  mat.uniforms.uGlobalComplexity.value = uniforms.uGlobalComplexity.value;
  mat.uniforms.uGlobalEvolution.value = uniforms.uGlobalEvolution.value;
  mat.uniforms.uGlobalFidelity.value = uniforms.uGlobalFidelity.value;
  mat.uniforms.uGlobalOctaveMult.value = uniforms.uGlobalOctaveMult.value;
  mat.uniforms.uGlobalFreq.value = uniforms.uGlobalFreq.value;
  mat.uniforms.uGlobalRadius.value = uniforms.uGlobalRadius.value;
  mat.uniforms.uGravity.value = uniforms.uGravity.value;
  mat.uniforms.uViscosity.value = uniforms.uViscosity.value;
  mat.uniforms.uFluidForce.value = uniforms.uFluidForce.value;
  mat.uniforms.uResistance.value = uniforms.uResistance.value;
  mat.uniforms.uMoveWithWind.value = uniforms.uMoveWithWind.value;
  mat.uniforms.uNeighborForce.value = uniforms.uNeighborForce.value;
  mat.uniforms.uCollisionMode.value = uniforms.uCollisionMode.value;
  mat.uniforms.uCollisionRadius.value = uniforms.uCollisionRadius.value;
  mat.uniforms.uRepulsion.value = uniforms.uRepulsion.value;
  mat.uniforms.uAffectPos.value = uniforms.uAffectPos.value;
  mat.uniforms.uWind.value = uniforms.uWind.value;
  mat.uniforms.uSpin.value = uniforms.uSpin.value;
  mat.uniforms.uBoundaryY.value = uniforms.uBoundaryY.value;
  mat.uniforms.uBoundaryEnabled.value = uniforms.uBoundaryEnabled.value;
  mat.uniforms.uBoundaryBounce.value = uniforms.uBoundaryBounce.value;
  mat.uniforms.uMouse.value = uniforms.uMouse.value;
  mat.uniforms.uMouseForce.value = uniforms.uMouseForce.value;
  mat.uniforms.uMouseRadius.value = uniforms.uMouseRadius.value;
  mat.uniforms.uInterLayerEnabled.value = uniforms.uInterLayerEnabled.value;
  mat.uniforms.uInterLayerColliderCount.value = uniforms.uInterLayerColliderCount.value;
  mat.uniforms.uInterLayerColliders.value = uniforms.uInterLayerColliders.value;
  mat.uniforms.uInterLayerStrength.value = uniforms.uInterLayerStrength.value;
  mat.uniforms.uInterLayerPadding.value = uniforms.uInterLayerPadding.value;
  mat.uniforms.uHueShift.value = (uniforms.uHueShift?.value ?? 0) + lineProfile.hueShiftAdd;
  if (mat.uniforms.uLineWidth) mat.uniforms.uLineWidth.value = layerConnectionWidth * lineProfile.widthMul;
  if (mat.uniforms.uLineSoftness) mat.uniforms.uLineSoftness.value = THREE.MathUtils.clamp(layerConnectionSoftness * lineProfile.softnessMul, 0.05, 2);
  if (mat.uniforms.uBrushStyle) mat.uniforms.uBrushStyle.value = layerConnectionStyle === 'filament' ? 1 : 0;
}

export function createBrushLineUniforms(_config: ParticleConfig, uniforms: ShaderUniformMap, layerConnectionStyle: ParticleConfig['layer2ConnectionStyle']) {
  return { ...uniforms, uConnectDistance: { value: 50 }, uOpacity: { value: 0.2 }, uAudioBassMotion: { value: 0 }, uAudioTrebleMotion: { value: 0 }, uAudioBassLine: { value: 0 }, uAudioTrebleLine: { value: 0 }, uAudioPulse: { value: 0 }, uAudioMorph: { value: 0 }, uAudioShatter: { value: 0 }, uAudioTwist: { value: 0 }, uAudioBend: { value: 0 }, uAudioWarp: { value: 0 }, uLineVelocityGlow: { value: 0 }, uLineVelocityAlpha: { value: 0 }, uLineBurstPulse: { value: 0 }, uLineShimmer: { value: 0 }, uLineFlickerSpeed: { value: 1 }, uHueShift: { value: 0 }, uLineWidth: { value: 0.7 }, uLineSoftness: { value: 0.65 }, uBrushStyle: { value: layerConnectionStyle === 'filament' ? 1 : 0 } };
}

export function createClassicLineUniforms(uniforms: ShaderUniformMap) {
  return { ...uniforms, uConnectDistance: { value: 50 }, uOpacity: { value: 0.2 }, uAudioBassMotion: { value: 0 }, uAudioTrebleMotion: { value: 0 }, uAudioBassLine: { value: 0 }, uAudioTrebleLine: { value: 0 }, uAudioPulse: { value: 0 }, uAudioMorph: { value: 0 }, uAudioShatter: { value: 0 }, uAudioTwist: { value: 0 }, uAudioBend: { value: 0 }, uAudioWarp: { value: 0 }, uLineVelocityGlow: { value: 0 }, uLineVelocityAlpha: { value: 0 }, uLineBurstPulse: { value: 0 }, uLineShimmer: { value: 0 }, uLineFlickerSpeed: { value: 1 }, uHueShift: { value: 0 } };
}
