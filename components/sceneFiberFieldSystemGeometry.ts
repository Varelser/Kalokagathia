import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import { generateParticleData } from './particleData';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import { withCrossFamilyFiberProfile, withSourceAwareFiberProfile } from '../lib/sourceAwareShaping';
import type { FiberLayout, FiberProfile } from './sceneFiberFieldSystemTypes';
import { getLayerFiberSettings, getLayerMode } from './sceneFiberFieldSystemTypes';
import { getFiberProfile } from './sceneFiberFieldSystemProfiles';
import { getLayerParticleLayoutDeps, getLayerRuntimeFiberSnapshot } from '../lib/sceneRenderRoutingRuntimeSnapshots';

const tempPos = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const tangent = new THREE.Vector3();
const normal = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const seedVec = new THREE.Vector3();
const radialVec = new THREE.Vector3();
const shellAxis = new THREE.Vector3();
const endPos = new THREE.Vector3();

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 91.173 + 17.137) * 43758.5453123);
}

function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

export function getLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeFiberSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.strandCount]);
}

export function buildFiberLayout(config: ParticleConfig, layerIndex: 2 | 3): FiberLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 4) return null;
  const settings = getLayerFiberSettings(config, layerIndex);
  const source = settings.source;
  const mode = getLayerMode(config, layerIndex);
  const profile = withCrossFamilyFiberProfile(withSourceAwareFiberProfile(getFiberProfile(mode), source), mode, source);
  const strandCount = Math.max(12, Math.min(512, Math.floor(settings.strandCount * profile.densityBoost)));
  const sampledIndices = new Uint32Array(strandCount);
  for (let i = 0; i < strandCount; i += 1) {
    sampledIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, strandCount - 1)) * Math.max(0, particleData.count - 1)));
  }
  return { particleData, sampledIndices, strandCount };
}

export function getFiberBlending(mode: ParticleConfig['layer2Type']) {
  return mode === 'static_lace' || mode === 'mesh_weave' || mode === 'cinder_web'
    ? THREE.NormalBlending
    : THREE.AdditiveBlending;
}

export function resolveFiberProfile(config: ParticleConfig, layerIndex: 2 | 3) {
  const layerMode = getLayerMode(config, layerIndex);
  const layerSource = getLayerFiberSettings(config, layerIndex).source;
  return {
    layerMode,
    layerSource,
    fiberProfile: withCrossFamilyFiberProfile(withSourceAwareFiberProfile(getFiberProfile(layerMode), layerSource), layerMode, layerSource),
  };
}

export function ensureFiberGeometry(line: THREE.LineSegments, geometryRef: MutableRefObject<THREE.BufferGeometry | null>, strandCount: number) {
  if (!geometryRef.current) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strandCount * 2 * 3), 3));
    geometry.setAttribute('fiberMix', new THREE.BufferAttribute(new Float32Array(strandCount * 2), 1));
    geometryRef.current = geometry;
    line.geometry = geometry;
  }
  return geometryRef.current;
}

export function updateFiberGeometry({
  geometry,
  layout,
  config,
  layerIndex,
  settings,
  mode,
  profile,
  globalRadius,
  audioBoost,
  time,
}: {
  geometry: THREE.BufferGeometry;
  layout: FiberLayout;
  config: ParticleConfig;
  layerIndex: 2 | 3;
  settings: ReturnType<typeof getLayerFiberSettings>;
  mode: ParticleConfig['layer2Type'];
  profile: FiberProfile;
  globalRadius: number;
  audioBoost: number;
  time: number;
}) {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const mixAttr = geometry.getAttribute('fiberMix') as THREE.BufferAttribute;
  const baseCurlScale = settings.curl * globalRadius * 0.12 * profile.curlBoost * (1 + audioBoost * 0.8);
  const quantizeCell = globalRadius * 0.016 * profile.quantize;

  for (let i = 0; i < layout.strandCount; i += 1) {
    const sourceIndex = layout.sampledIndices[i] ?? 0;
    const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time });
    const estimatedNext = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: time + 0.018 });

    tempPos.set(estimated.x, estimated.y, estimated.z);
    nextPos.set(estimatedNext.x, estimatedNext.y, estimatedNext.z);
    tangent.copy(nextPos).sub(tempPos);
    if (tangent.lengthSq() < 1e-5) {
      tangent.set(signedHash(i + 0.1), signedHash(i + 0.2), signedHash(i + 0.3));
    }
    tangent.normalize();

    seedVec.set(signedHash(i * 1.17 + 0.3), signedHash(i * 2.31 + 1.3), signedHash(i * 3.97 + 2.1)).normalize();
    shellAxis.set(Math.abs(tangent.y) > 0.9 ? 1 : 0, Math.abs(tangent.y) > 0.9 ? 0 : 1, 0);
    normal.crossVectors(tangent, shellAxis).normalize();
    if (normal.lengthSq() < 1e-5) normal.copy(seedVec);
    bitangent.crossVectors(tangent, normal).normalize();
    radialVec.set(tempPos.x, 0, tempPos.z);
    if (radialVec.lengthSq() < 1e-5) radialVec.set(1, 0, 0);
    radialVec.normalize();

    const fiberSeed = i * 13.137;
    const curlA = signedHash(fiberSeed + time * (0.17 + profile.phaseSpeed * 0.05));
    const curlB = signedHash(fiberSeed + 4.2 + time * (0.13 + profile.phaseSpeed * 0.04));
    const weavePhaseBase = (i / Math.max(1, layout.strandCount - 1)) * Math.PI * 2 * Math.max(1, profile.waveFrequency);
    const weavePhase = weavePhaseBase + time * profile.phaseSpeed + signedHash(fiberSeed + 2.4) * 0.4;
    const waveA = Math.sin(weavePhase) * profile.waveAmplitude;
    const waveB = Math.cos(weavePhase * (1.0 + profile.braidAmount * 0.24)) * profile.waveAmplitude;
    const length = settings.length * profile.lengthBase * (1 + audioBoost * 0.75 + hash(fiberSeed + 8.1) * 0.25);

    const arborDepth = mode === 'branch_propagation' ? hash(Math.floor(i / 7) + 0.4) : 0;
    const arborSpread = mode === 'branch_propagation' ? (0.28 + arborDepth * 0.46) : 0;
    const arborLift = mode === 'branch_propagation' ? (0.04 + arborDepth * 0.1) : 0;

    endPos.copy(nextPos)
      .addScaledVector(tangent, length * profile.tangentStretch * (mode === 'branch_propagation' ? 0.78 + arborDepth * 0.22 : 1.0))
      .addScaledVector(normal, curlA * baseCurlScale * (1 + profile.normalBias) + waveA * globalRadius * (0.05 + profile.braidAmount * 0.035) + (mode === 'branch_propagation' ? signedHash(fiberSeed + 6.4) * globalRadius * settings.curl * arborSpread * 0.08 : 0))
      .addScaledVector(bitangent, curlB * baseCurlScale * (1 + profile.bitangentBias) + waveB * globalRadius * (0.04 + profile.braidAmount * 0.03) + (mode === 'branch_propagation' ? signedHash(fiberSeed + 8.1) * globalRadius * settings.curl * arborSpread * 0.05 : 0))
      .addScaledVector(seedVec, signedHash(fiberSeed + 11.9) * settings.curl * globalRadius * (0.02 + profile.seedBias * 0.03 + (mode === 'branch_propagation' ? 0.012 : 0.02)))
      .addScaledVector(radialVec, globalRadius * (Math.sin(weavePhase * 0.5) * profile.radialLift * 0.055 - profile.radialPull * 0.045));

    endPos.y += globalRadius * (profile.verticalBias * 0.1 + Math.sin(weavePhase * 0.7) * profile.curtainAmount * 0.06);
    if (mode === 'branch_propagation') {
      endPos.y += globalRadius * arborLift;
    }
    if (profile.canopyAmount > 0) {
      const canopyLift = (0.4 + 0.6 * Math.sin(weavePhase * 0.5 + fiberSeed * 0.07)) * globalRadius * 0.08 * profile.canopyAmount;
      endPos.y += canopyLift * (0.4 + Math.max(0.0, 1.0 - Math.abs(tangent.y)));
    }
    if (profile.stormAmount > 0) {
      const stormPhase = time * (0.7 + profile.phaseSpeed * 0.35) + fiberSeed * 0.19;
      endPos.x += Math.sin(stormPhase) * globalRadius * 0.08 * profile.stormAmount;
      endPos.z += Math.cos(stormPhase * 0.86) * globalRadius * 0.07 * profile.stormAmount;
    }
    if (profile.fanAmount > 0) {
      const fanSpread = signedHash(fiberSeed + 14.2) * globalRadius * 0.08 * profile.fanAmount * (0.25 + i / Math.max(1, layout.strandCount - 1));
      endPos.addScaledVector(normal, fanSpread).addScaledVector(bitangent, fanSpread * 0.55);
    }
    if (profile.spineAmount > 0) {
      const spineTarget = tempPos.clone().addScaledVector(tangent, length * 0.55);
      endPos.lerp(spineTarget, Math.min(0.8, profile.spineAmount * 0.32));
    }
    if (profile.droopAmount > 0) {
      endPos.y -= globalRadius * (0.05 + hash(fiberSeed + 18.4) * 0.09) * profile.droopAmount;
    }
    if (profile.planarPull > 0) {
      endPos.y = THREE.MathUtils.lerp(endPos.y, tempPos.y, Math.min(0.9, profile.planarPull * 0.55));
    }
    if (profile.fractureAmount > 0) {
      const fractureCell = Math.max(globalRadius * 0.018, quantizeCell || globalRadius * 0.018);
      endPos.x = Math.round(endPos.x / fractureCell) * fractureCell;
      endPos.y = THREE.MathUtils.lerp(endPos.y, Math.round(endPos.y / fractureCell) * fractureCell, Math.min(0.82, profile.fractureAmount * 0.7));
      endPos.z = Math.round(endPos.z / fractureCell) * fractureCell;
    } else if (quantizeCell > 0) {
      endPos.x = Math.round(endPos.x / quantizeCell) * quantizeCell;
      endPos.z = Math.round(endPos.z / quantizeCell) * quantizeCell;
    }

    const baseIndex = i * 2;
    positionAttr.setXYZ(baseIndex + 0, tempPos.x, tempPos.y, tempPos.z);
    positionAttr.setXYZ(baseIndex + 1, endPos.x, endPos.y, endPos.z);
    mixAttr.setX(baseIndex + 0, 0);
    mixAttr.setX(baseIndex + 1, 1);
  }

  positionAttr.needsUpdate = true;
  mixAttr.needsUpdate = true;
  geometry.computeBoundingSphere();
}

export function updateFiberMaterial(
  material: THREE.ShaderMaterial,
  settings: ReturnType<typeof getLayerFiberSettings>,
  profile: FiberProfile,
  pulse: number,
  bass: number,
) {
  const styleIndex = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
  material.uniforms.uColor.value.set(settings.color);
  material.uniforms.uOpacity.value = settings.opacity;
  material.uniforms.uPulse.value = pulse + bass * 0.2;
  material.uniforms.uMaterialStyle.value = styleIndex;
  material.uniforms.uGlow.value = profile.glow;
  material.uniforms.uBandFrequency.value = profile.bandFrequency;
  material.uniforms.uBandMix.value = profile.bandMix;
  material.uniforms.uPrismAmount.value = profile.prismAmount;
  material.uniforms.uGateAmount.value = profile.gateAmount;
  material.uniforms.uShimmerScale.value = profile.shimmerScale;
  material.uniforms.uPulseMix.value = profile.pulseMix;
  material.uniforms.uAlphaMul.value = profile.alphaMul;
  material.uniforms.uCharAmount.value = profile.charAmount;
}
