import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { LodSystem } from '../lib/lodSystem';
import type { GpgpuAssetBundle } from './useGpgpuAssets';
import { MAX_TRAIL } from './gpgpuShaders';

export function runDepthSortPass(args: {
  config: ParticleConfig;
  gl: THREE.WebGLRenderer;
  camera: THREE.Camera;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  simMesh: THREE.Mesh;
  posTexture: THREE.Texture;
  texSize: number;
  sortRTA: THREE.WebGLRenderTarget | null;
  sortRTB: THREE.WebGLRenderTarget | null;
  sortDepthMat: THREE.ShaderMaterial;
  bitonicMat: THREE.ShaderMaterial;
}): THREE.Texture | null {
  const {
    config,
    gl,
    camera,
    simScene,
    simCamera,
    simMesh,
    posTexture,
    texSize,
    sortRTA,
    sortRTB,
    sortDepthMat,
    bitonicMat,
  } = args;

  if (!config.gpgpuSortEnabled || !sortRTA || !sortRTB) return null;

  sortDepthMat.uniforms.uPosTex.value = posTexture;
  sortDepthMat.uniforms.uViewMatrix.value.copy(camera.matrixWorldInverse);
  simMesh.material = sortDepthMat;
  gl.setRenderTarget(sortRTA);
  gl.render(simScene, simCamera);

  const logN = Math.log2(texSize * texSize);
  let spingA = true;
  bitonicMat.uniforms.uTexSizeF.value = texSize;
  for (let stage = 0; stage < logN; stage++) {
    for (let step = stage; step >= 0; step--) {
      const sIn = spingA ? sortRTA : sortRTB;
      const sOut = spingA ? sortRTB : sortRTA;
      bitonicMat.uniforms.uSortIn.value = sIn.texture;
      bitonicMat.uniforms.uStep.value = step;
      bitonicMat.uniforms.uStage.value = stage;
      simMesh.material = bitonicMat;
      gl.setRenderTarget(sOut);
      gl.render(simScene, simCamera);
      spingA = !spingA;
    }
  }

  return (spingA ? sortRTB : sortRTA).texture;
}

export function pushTrailFrame(args: {
  config: ParticleConfig;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  simMesh: THREE.Mesh;
  blitMat: THREE.ShaderMaterial;
  trailRTs: THREE.WebGLRenderTarget[];
  trailHead: MutableRefObject<number>;
  posTexture: THREE.Texture;
}): void {
  const { config, gl, simScene, simCamera, simMesh, blitMat, trailRTs, trailHead, posTexture } = args;
  if (!config.gpgpuTrailEnabled && !config.gpgpuRibbonEnabled && !config.gpgpuTubeEnabled) return;

  blitMat.uniforms.uTex.value = posTexture;
  simMesh.material = blitMat;
  gl.setRenderTarget(trailRTs[trailHead.current]);
  gl.render(simScene, simCamera);
  trailHead.current = (trailHead.current + 1) % MAX_TRAIL;
}

export function applyLodPolicy(args: {
  config: ParticleConfig;
  lodSystem: LodSystem;
  texSize: number;
  velSimMat: THREE.ShaderMaterial;
  drawGeo: THREE.BufferGeometry;
  streakGeo: THREE.BufferGeometry;
}): number {
  const { config, lodSystem, texSize, velSimMat, drawGeo, streakGeo } = args;
  const lodCount = config.autoLod ? lodSystem.getEffectiveCount(config.gpgpuCount) : config.gpgpuCount;
  const activeCount = Math.min(lodCount, texSize * texSize);

  if (config.autoLod && lodSystem.shouldSkipExpensive()) {
    velSimMat.uniforms.uNBodyEnabled.value = false;
    velSimMat.uniforms.uSphEnabled.value = false;
    velSimMat.uniforms.uBoidsEnabled.value = false;
  }

  drawGeo.setDrawRange(0, activeCount);
  streakGeo.setDrawRange(0, activeCount * 2);
  return activeCount;
}

export function syncVisualUniforms(args: {
  config: ParticleConfig;
  activeCount: number;
  assets: GpgpuAssetBundle;
  posTexture: THREE.Texture;
  velTexture: THREE.Texture;
  finalSortTex: THREE.Texture | null;
  texSize?: number;
}): void {
  const { config, activeCount, assets, posTexture, velTexture, finalSortTex, texSize } = args;
  const {
    drawMat,
    trailRTs,
    trailMats,
    trailHead,
    ribbonMats,
    tubeMats,
    streakMat,
    geomMat,
    volumetricGeo,
    volumetricMat,
  } = assets;

  drawMat.uniforms.uPosTex.value = posTexture;
  drawMat.uniforms.uVelTex.value = velTexture;
  drawMat.uniforms.uColor.value.setStyle(config.gpgpuColor);
  drawMat.uniforms.uSize.value = config.gpgpuSize;
  if (drawMat.uniforms.uKuramotoEnabled) drawMat.uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
  if (drawMat.uniforms.uKuramotoInfluence) drawMat.uniforms.uKuramotoInfluence.value = config.gpgpuKuramotoInfluence;
  if (drawMat.uniforms.uParticleLifeEnabled) drawMat.uniforms.uParticleLifeEnabled.value = config.gpgpuParticleLifeEnabled;
  if (drawMat.uniforms.uParticleLifeSpecies) drawMat.uniforms.uParticleLifeSpecies.value = Math.max(2, Math.min(6, Math.round(config.gpgpuParticleLifeSpecies)));
  if (texSize !== undefined && drawMat.uniforms.uTexSizeF) drawMat.uniforms.uTexSizeF.value = texSize;
  drawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
  drawMat.uniforms.uVelColorEnabled.value = config.gpgpuVelColorEnabled;
  drawMat.uniforms.uVelColorHueMin.value = config.gpgpuVelColorHueMin;
  drawMat.uniforms.uVelColorHueMax.value = config.gpgpuVelColorHueMax;
  drawMat.uniforms.uVelColorSaturation.value = config.gpgpuVelColorSaturation;
  drawMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
  drawMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
  drawMat.uniforms.uAgeFadeIn.value = config.gpgpuAgeFadeIn;
  drawMat.uniforms.uAgeFadeOut.value = config.gpgpuAgeFadeOut;
  drawMat.uniforms.uAgeColorEnabled.value = config.gpgpuAgeColorEnabled;
  drawMat.uniforms.uAgeColorYoung.value.setStyle(config.gpgpuAgeColorYoung);
  drawMat.uniforms.uAgeColorOld.value.setStyle(config.gpgpuAgeColorOld);
  drawMat.uniforms.uAgeSizeEnabled.value = config.gpgpuAgeSizeEnabled;
  drawMat.uniforms.uAgeSizeStart.value = config.gpgpuAgeSizeStart;
  drawMat.uniforms.uAgeSizeEnd.value = config.gpgpuAgeSizeEnd;
  drawMat.uniforms.uSortEnabled.value = config.gpgpuSortEnabled && finalSortTex !== null;
  drawMat.uniforms.uSortTex.value = finalSortTex;
  drawMat.blending = config.gpgpuSortEnabled ? THREE.NormalBlending : THREE.AdditiveBlending;

  if (config.gpgpuStreakEnabled) {
    streakMat.uniforms.uPosTex.value = posTexture;
    streakMat.uniforms.uVelTex.value = velTexture;
    streakMat.uniforms.uColor.value.setStyle(config.gpgpuColor);
    streakMat.uniforms.uOpacity.value = config.gpgpuStreakOpacity;
    streakMat.uniforms.uStreakLength.value = config.gpgpuStreakLength;
    streakMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
    streakMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
    streakMat.uniforms.uAgeFadeIn.value = config.gpgpuAgeFadeIn;
    streakMat.uniforms.uAgeFadeOut.value = config.gpgpuAgeFadeOut;
  }

  if (config.gpgpuTrailEnabled) {
    const trailLength = Math.min(MAX_TRAIL, Math.max(2, config.gpgpuTrailLength));
    for (let i = 0; i < MAX_TRAIL; i++) {
      const rtIdx = ((trailHead.current - 1 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const alpha = i < trailLength ? Math.pow(config.gpgpuTrailFade, i + 1) * config.gpgpuOpacity : 0;
      trailMats[i].uniforms.uPosTex.value = trailRTs[rtIdx].texture;
      trailMats[i].uniforms.uVelTex.value = velTexture;
      trailMats[i].uniforms.uColor.value.setStyle(config.gpgpuColor);
      trailMats[i].uniforms.uSize.value = config.gpgpuSize;
      trailMats[i].uniforms.uAlpha.value = alpha;
      trailMats[i].uniforms.uVelocityScale.value = config.gpgpuTrailVelocityScale;
      if (trailMats[i].uniforms.uKuramotoEnabled) trailMats[i].uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
      if (trailMats[i].uniforms.uKuramotoInfluence) trailMats[i].uniforms.uKuramotoInfluence.value = config.gpgpuKuramotoInfluence;
    }
  }

  if (config.gpgpuRibbonEnabled) {
    const trailLength = Math.min(MAX_TRAIL - 1, Math.max(2, config.gpgpuTrailLength));
    for (let i = 0; i < MAX_TRAIL - 1; i++) {
      const rtIdxB = ((trailHead.current - 1 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const rtIdxA = ((trailHead.current - 2 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const alpha = i < trailLength - 1 ? Math.pow(config.gpgpuTrailFade, i + 1) * config.gpgpuRibbonOpacity : 0;
      ribbonMats[i].uniforms.uPosTexA.value = trailRTs[rtIdxA].texture;
      ribbonMats[i].uniforms.uPosTexB.value = trailRTs[rtIdxB].texture;
      if (ribbonMats[i].uniforms.uVelTex) ribbonMats[i].uniforms.uVelTex.value = velTexture;
      if (ribbonMats[i].uniforms.uKuramotoEnabled) ribbonMats[i].uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
      if (ribbonMats[i].uniforms.uKuramotoInfluence) ribbonMats[i].uniforms.uKuramotoInfluence.value = config.gpgpuKuramotoInfluence;
      ribbonMats[i].uniforms.uColor.value.setStyle(config.gpgpuColor);
      ribbonMats[i].uniforms.uWidth.value = config.gpgpuRibbonWidth;
      ribbonMats[i].uniforms.uAlpha.value = alpha;
      ribbonMats[i].uniforms.uTaper.value = config.gpgpuRibbonTaper;
      ribbonMats[i].uniforms.uMaxSegLen.value = config.gpgpuRibbonMaxSegLen;
    }
  }

  if (config.gpgpuTubeEnabled) {
    const trailLength = Math.min(MAX_TRAIL - 1, Math.max(2, config.gpgpuTrailLength));
    for (let i = 0; i < MAX_TRAIL - 1; i++) {
      const rtIdxB = ((trailHead.current - 1 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const rtIdxA = ((trailHead.current - 2 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const alpha = i < trailLength - 1 ? Math.pow(config.gpgpuTrailFade, i + 1) * config.gpgpuTubeOpacity : 0;
      tubeMats[i].uniforms.uPosTexA.value = trailRTs[rtIdxA].texture;
      tubeMats[i].uniforms.uPosTexB.value = trailRTs[rtIdxB].texture;
      if (tubeMats[i].uniforms.uVelTex) tubeMats[i].uniforms.uVelTex.value = velTexture;
      if (tubeMats[i].uniforms.uKuramotoEnabled) tubeMats[i].uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
      if (tubeMats[i].uniforms.uKuramotoInfluence) tubeMats[i].uniforms.uKuramotoInfluence.value = config.gpgpuKuramotoInfluence;
      tubeMats[i].uniforms.uColor.value.setStyle(config.gpgpuColor);
      tubeMats[i].uniforms.uTubeRadius.value = config.gpgpuTubeRadius;
      tubeMats[i].uniforms.uAlpha.value = alpha;
      tubeMats[i].uniforms.uMaxSegLen.value = config.gpgpuRibbonMaxSegLen;
    }
  }

  if (config.gpgpuGeomMode !== 'point') {
    geomMat.uniforms.uPosTex.value = posTexture;
    geomMat.uniforms.uVelTex.value = velTexture;
    geomMat.uniforms.uColor.value.setStyle(config.gpgpuColor);
    geomMat.uniforms.uOpacity.value = config.gpgpuOpacity;
    geomMat.uniforms.uGeomScale.value = config.gpgpuBounceRadius * 0.02 * config.gpgpuGeomScale;
    geomMat.uniforms.uVelocityAlign.value = config.gpgpuGeomVelocityAlign ? 1 : 0;
  }

  if (config.gpgpuVolumetricEnabled) {
    volumetricGeo.instanceCount = activeCount;
    volumetricMat.uniforms.uPosTex.value = posTexture;
    volumetricMat.uniforms.uColor.value.setStyle(config.gpgpuVolumetricColor);
    volumetricMat.uniforms.uRadius.value = config.gpgpuVolumetricRadius;
    volumetricMat.uniforms.uDensity.value = config.gpgpuVolumetricDensity;
    volumetricMat.uniforms.uOpacity.value = config.gpgpuVolumetricOpacity;
    volumetricMat.uniforms.uSteps.value = config.gpgpuVolumetricSteps;
  }
}
