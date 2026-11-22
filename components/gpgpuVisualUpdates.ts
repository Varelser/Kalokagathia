import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { LodSystem } from '../lib/lodSystem';
import type { GpgpuAssetBundle } from './useGpgpuAssets';
import { MAX_TRAIL, TUBE_SIDES } from './gpgpuShaders';
import { ATTRACTOR_RING_Z_SHIFT } from '../lib/attractorSpace';
import { tubeLayerAlphaB1 as tubeLayerAlpha, trailDrawCount } from '../lib/trailAlpha';
import { fillGradientLutDataResolved, gradientStopsLutKey } from '../lib/kinetixGradients';
import { getGradImageTexture } from '../lib/gradImageTexture';
import { resolveMapSourceTexture } from '../lib/terrainDerivedMaps';
import { resolveMapSource } from '../lib/layerMask';
import { getSpriteImageTexture } from '../lib/spriteImageTexture';
import { normalizeSpriteFrameFps, normalizeSpriteSheetDimension, spriteFrameModeIndex } from '../lib/spriteSheet';
import { isAgeCurveIdentity, normalizeAgeCurvePoints } from '../lib/ageCurve';
import { normalizeLightDir } from '../lib/gpgpuLight';
import { bakeShadowOcclusionMap, buildShadowScene } from '../lib/shadowOcclusion';
import { normalizeAttrNames, normalizeAttrSlot, resolveAttrColorSlots, resolveAttrConsumers } from '../lib/gpgpuAttributes';
import { parseGpgpuGroups, resolveGroupGate } from '../lib/gpgpuGroups';
import { resolveIblEnvironment } from '../lib/iblEnvironment';
import { horizonEquirectYawRadians } from '../lib/horizonBackground';
import { clampNoiseMapAmount, clampNoiseMapEvolve, clampNoiseMapOctaves, clampNoiseMapScale, noiseMapKindIndex, normalizeNoiseMapKind } from '../lib/noiseFieldMap';

// Occlusion-map shadow (Phase Z): the bake is a pure function of
// the shadow-relevant config, so it is cached by that config's
// fingerprint and rebuilt only when the fingerprint changes. The
// DataTexture is shared by the point draw; the terrain mesh and
// the light volume bake the same scene on their own side.
let shadowCacheKey = '';
let shadowCacheTex: THREE.DataTexture | null = null;
let shadowCacheExtent = 1;
let shadowCacheHeightScale = 1;
function getShadowOcclusionTexture(config: ParticleConfig): THREE.DataTexture | null {
  if (!config.gpgpuShadowEnabled || !(config.gpgpuShadowStrength > 0)) return null;
  const key = JSON.stringify([
    config.gpgpuMorphTerrainAmplitude, config.gpgpuMorphTerrainFrequency,
    config.gpgpuMorphTerrainOctaves, config.gpgpuMorphTerrainSeed, config.gpgpuSeed,
    config.gpgpuMorphScale, config.gpgpuBounceRadius, config.gpgpuTerrainMeshScale,
    config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ,
    config.gpgpuShadowSourceTerrain, config.gpgpuShadowSourceObj, config.gpgpuShadowSoftness,
    config.gpgpuObjMeshEnabled, config.gpgpuObjMeshScale, config.gpgpuObjMeshRepeat,
    config.gpgpuObjMeshPosX, config.gpgpuObjMeshPosY, config.gpgpuObjMeshPosZ,
    config.gpgpuMorphObjSource,
    // Terrain erosion (Phase AP): the occluder follows the
    // carved field, so the erosion params are part of the key.
    config.gpgpuMorphTerrainErosionWater, config.gpgpuMorphTerrainErosionDroplets,
    config.gpgpuMorphTerrainErosionDeposit, config.gpgpuMorphTerrainErosionThermal,
    config.gpgpuMorphTerrainErosionTalus, config.gpgpuMorphTerrainErosionThermalPasses,
    config.gpgpuMorphTerrainErosionSeed, config.gpgpuTerrainMeshTunnel,
  ]);
  if (key !== shadowCacheKey) {
    const bake = bakeShadowOcclusionMap(buildShadowScene(config), 64);
    const tex = new THREE.DataTexture(bake.data, bake.resolution, bake.resolution, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    shadowCacheTex?.dispose();
    shadowCacheTex = tex;
    shadowCacheExtent = bake.extent;
    shadowCacheHeightScale = bake.heightScale;
    shadowCacheKey = key;
  }
  return shadowCacheTex;
}

const GRAD_DRIVER_IDS: Record<ParticleConfig['gpgpuGradDriver'], number> = {
  life: 0,
  velocity: 1,
  spatial: 2,
  prism: 3,
  image: 4,
  blackbody: 5,
  height: 6,
  // Noise field (Phase AY): the ramp input is the field value
  // at the particle's own position (lib/noiseFieldMap.ts).
  noise: 7,
};

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
  // Named attributes (Phase AK): the attribute texture, or null
  // while no consumer is active — null resolves the draw drives
  // off and keeps the legacy draw bit-identical.
  attrTexture?: THREE.Texture | null;
  texSize?: number;
  time?: number;
  // Density compensation (Phase DN): drawing-buffer size in
  // physical pixels (gl.domElement.width/height at the call
  // site), read fresh every frame so resize / DPR changes and
  // the deterministic renderer's export resize are followed.
  viewportSizePx?: { x: number; y: number };
}): void {
  const { config, activeCount, assets, posTexture, velTexture, finalSortTex, texSize, time } = args;
  const {
    drawMat,
    trailRTs,
    trailMats,
    trailHead,
    ribbonMats,
    ribbonGeo,
    tubeMats,
    tubeGeo,
    streakMat,
    geomMat,
    instGeo,
    volumetricGeo,
    volumetricMat,
  } = assets;

  // Ring (attractor space mode): every visual material that
  // samples the population's positions gets the same draw-side
  // -z offset, so the legacy band is drawn centred as a ring.
  // 0 in every other mode, which keeps those paths identical.
  const ringOffsetZ = config.gpgpuAttractorEnabled && config.gpgpuAttractorSpaceMode === 'ring'
    ? ATTRACTOR_RING_Z_SHIFT
    : 0;
  if (drawMat.uniforms.uRingOffsetZ) drawMat.uniforms.uRingOffsetZ.value = ringOffsetZ;
  if (streakMat.uniforms.uRingOffsetZ) streakMat.uniforms.uRingOffsetZ.value = ringOffsetZ;
  if (geomMat.uniforms.uRingOffsetZ) geomMat.uniforms.uRingOffsetZ.value = ringOffsetZ;
  if (volumetricMat.uniforms.uRingOffsetZ) volumetricMat.uniforms.uRingOffsetZ.value = ringOffsetZ;
  for (const m of trailMats) if (m.uniforms.uRingOffsetZ) m.uniforms.uRingOffsetZ.value = ringOffsetZ;
  for (const m of ribbonMats) if (m.uniforms.uRingOffsetZ) m.uniforms.uRingOffsetZ.value = ringOffsetZ;
  for (const m of tubeMats) if (m.uniforms.uRingOffsetZ) m.uniforms.uRingOffsetZ.value = ringOffsetZ;

  drawMat.uniforms.uPosTex.value = posTexture;
  drawMat.uniforms.uVelTex.value = velTexture;
  // Named attributes (Phase AK): the draw drives engage only
  // when the attribute texture exists (the runtime builds it
  // only while a consumer is active).
  {
    const attrConsumers = resolveAttrConsumers(config);
    const attrTexture = args.attrTexture ?? null;
    if (drawMat.uniforms.uAttrTex) drawMat.uniforms.uAttrTex.value = attrTexture;
    if (drawMat.uniforms.uAttrEnabled) drawMat.uniforms.uAttrEnabled.value = !!attrTexture && (attrConsumers.sizeActive || attrConsumers.brightActive || attrConsumers.colorActive);
    if (drawMat.uniforms.uAttrSizeSlot) drawMat.uniforms.uAttrSizeSlot.value = normalizeAttrSlot(config.gpgpuAttrSizeSlot);
    if (drawMat.uniforms.uAttrSizeAmount) drawMat.uniforms.uAttrSizeAmount.value = Math.max(0, Math.min(1, config.gpgpuAttrSizeAmount ?? 1));
    if (drawMat.uniforms.uAttrBrightSlot) drawMat.uniforms.uAttrBrightSlot.value = normalizeAttrSlot(config.gpgpuAttrBrightSlot);
    if (drawMat.uniforms.uAttrBrightAmount) drawMat.uniforms.uAttrBrightAmount.value = Math.max(0, Math.min(1, config.gpgpuAttrBrightAmount ?? 1));
    // Colour drive (Phase CL): slots resolved from the names —
    // the single source of truth — and only while the drive
    // resolved active; otherwise the uniforms stay off / -1 and
    // vAttrColor remains exactly vec3(1.0).
    const colorSlots = attrConsumers.colorActive
      ? resolveAttrColorSlots(normalizeAttrNames(config.gpgpuAttrNames))
      : null;
    if (drawMat.uniforms.uAttrColorEnabled) drawMat.uniforms.uAttrColorEnabled.value = !!attrTexture && !!colorSlots;
    if (drawMat.uniforms.uAttrColorSlotR) drawMat.uniforms.uAttrColorSlotR.value = colorSlots ? colorSlots[0] : -1;
    if (drawMat.uniforms.uAttrColorSlotG) drawMat.uniforms.uAttrColorSlotG.value = colorSlots ? colorSlots[1] : -1;
    if (drawMat.uniforms.uAttrColorSlotB) drawMat.uniforms.uAttrColorSlotB.value = colorSlots ? colorSlots[2] : -1;
    // Group colour gating (Phase DG): the gate predicate is
    // derived exactly as for the velocity force gate (predicate
    // group supplies its predicate, baked group reads slot 3
    // above 0.5); a dangling reference resolves to no predicate
    // and the gating stays off.
    const groupGate = resolveGroupGate(parseGpgpuGroups(config.gpgpuGroupsData ?? ''), config.gpgpuGroupRef ?? '');
    const gatePredicate = groupGate.kind === 'predicate'
      ? groupGate.predicate
      : groupGate.kind === 'baked'
        ? { slot: groupGate.slot, mode: 'above' as const, low: 0.5, high: 1, invert: false }
        : null;
    if (drawMat.uniforms.uGroupColorEnabled) drawMat.uniforms.uGroupColorEnabled.value = !!attrTexture && attrConsumers.groupColorActive && gatePredicate !== null;
    if (gatePredicate) {
      if (drawMat.uniforms.uGroupSlot) drawMat.uniforms.uGroupSlot.value = gatePredicate.slot;
      if (drawMat.uniforms.uGroupMode) drawMat.uniforms.uGroupMode.value = { below: 0, above: 1, band: 2 }[gatePredicate.mode] ?? 1;
      if (drawMat.uniforms.uGroupLow) drawMat.uniforms.uGroupLow.value = gatePredicate.low;
      if (drawMat.uniforms.uGroupHigh) drawMat.uniforms.uGroupHigh.value = gatePredicate.high;
      if (drawMat.uniforms.uGroupInvert) drawMat.uniforms.uGroupInvert.value = gatePredicate.invert;
    }
  }
  drawMat.uniforms.uColor.value.setStyle(config.gpgpuColor);
  drawMat.uniforms.uSize.value = config.gpgpuSize;
  if (drawMat.uniforms.uKuramotoEnabled) drawMat.uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
  if (drawMat.uniforms.uKuramotoInfluence) drawMat.uniforms.uKuramotoInfluence.value = config.gpgpuKuramotoInfluence;
  if (drawMat.uniforms.uParticleLifeEnabled) drawMat.uniforms.uParticleLifeEnabled.value = config.gpgpuParticleLifeEnabled;
  if (drawMat.uniforms.uParticleLifeSpecies) drawMat.uniforms.uParticleLifeSpecies.value = Math.max(2, Math.min(6, Math.round(config.gpgpuParticleLifeSpecies)));
  if (texSize !== undefined && drawMat.uniforms.uTexSizeF) drawMat.uniforms.uTexSizeF.value = texSize;
  drawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
  // Density compensation (Phase DN): points draw. Count is the
  // LOD-applied activeCount; viewport falls back to (1,1) only
  // while no call site supplied it (compensation stays off in
  // practice because the config toggle is what enables it and
  // the live call site always supplies the real size).
  if (drawMat.uniforms.uDensityCompEnabled) drawMat.uniforms.uDensityCompEnabled.value = config.gpgpuDensityCompEnabled;
  if (drawMat.uniforms.uDensityTarget) drawMat.uniforms.uDensityTarget.value = config.gpgpuDensityCompTarget;
  if (drawMat.uniforms.uDensityCount) drawMat.uniforms.uDensityCount.value = activeCount;
  if (drawMat.uniforms.uViewportSizePx && args.viewportSizePx) {
    (drawMat.uniforms.uViewportSizePx.value as THREE.Vector2).set(args.viewportSizePx.x, args.viewportSizePx.y);
  }
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
  // Kinetix Color gradient (B2): sync the driver uniforms and rebake
  // the 256px LUT only when the three stops actually change (the key
  // is cached on the material so per-frame sync stays allocation-free).
  if (drawMat.uniforms.uGradEnabled) {
    drawMat.uniforms.uGradEnabled.value = config.gpgpuGradEnabled;
    drawMat.uniforms.uGradDriver.value = GRAD_DRIVER_IDS[config.gpgpuGradDriver] ?? 0;
    drawMat.uniforms.uGradSpatialScale.value = config.gpgpuGradSpatialScale;
    drawMat.uniforms.uGradTime.value = time ?? 0;
    const lut = drawMat.uniforms.uGradLut.value as THREE.DataTexture | null;
    if (lut) {
      const lutKey = `${config.gpgpuGradStart}|${config.gpgpuGradQuarter}|${config.gpgpuGradMid}|${config.gpgpuGradThreeQuarter}|${config.gpgpuGradEnd}|${config.gpgpuGradQuarterPos}|${config.gpgpuGradThreeQuarterPos}|${gradientStopsLutKey(config.gpgpuGradStopPositions, config.gpgpuGradStopColors)}`;
      if (drawMat.userData.gradLutKey !== lutKey) {
        drawMat.userData.gradLutKey = lutKey;
        fillGradientLutDataResolved(lut.image.data as Uint8Array, config.gpgpuGradStart, config.gpgpuGradMid, config.gpgpuGradEnd, config.gpgpuGradQuarter, config.gpgpuGradThreeQuarter, config.gpgpuGradQuarterPos, config.gpgpuGradThreeQuarterPos, config.gpgpuGradStopPositions, config.gpgpuGradStopColors);
        lut.needsUpdate = true;
      }
    }
    // Image driver (Phase A): hand the decoded user image to the
    // shader. The lookup is cached by source string, so per-frame
    // sync stays cheap; while the texture is not ready the shader
    // keeps the life LUT (the UI states this fallback explicitly).
    if (drawMat.uniforms.uGradImageTex) {
      // Phase X: a dedicated colour map, when set, replaces the
      // common image as the image driver's input (and as the map
      // texture the Phase U size/opacity paths fall back to is
      // unaffected — those resolve their own sources below, and
      // their dedicated textures take priority in the shader).
      // With no colour source set this is the exact legacy lookup.
      const imageState = config.gpgpuMapColorSource
        ? resolveMapSourceTexture(resolveMapSource(config.gpgpuMapColorSource, config.gpgpuGradImageSource), config)
        : getGradImageTexture(config.gpgpuGradImageSource);
      drawMat.uniforms.uGradImageTex.value = imageState.texture;
      if (drawMat.uniforms.uGradImageReady) drawMat.uniforms.uGradImageReady.value = imageState.ready;
      if (drawMat.uniforms.uGradImageScale) {
        drawMat.uniforms.uGradImageScale.value = 1 / (2 * Math.max(config.gpgpuBounceRadius, 1));
      }
    }
  }
  drawMat.uniforms.uAgeSizeEnabled.value = config.gpgpuAgeSizeEnabled;
  drawMat.uniforms.uAgeSizeStart.value = config.gpgpuAgeSizeStart;
  drawMat.uniforms.uAgeSizeEnd.value = config.gpgpuAgeSizeEnd;
  if (drawMat.uniforms.uAgeSizeCurve) drawMat.uniforms.uAgeSizeCurve.value = config.gpgpuAgeSizeCurve === 'bell' ? 1 : 0;
  // Age curves + Layer Maps + sprite image (Phase U). The point
  // lists are sanitised on the way in (exactly five finite, clamped
  // values) so a malformed preset can never push NaN into the
  // shader; the sprite lookup is cached by source string, like the
  // gradient image above. The map amounts reuse the gradient image
  // uniforms synced in the gradient block (texture / ready / scale
  // are refreshed every frame regardless of the colour driver).
  if (drawMat.uniforms.uAgeCurveSizeEnabled) {
    drawMat.uniforms.uAgeCurveSizeEnabled.value = config.gpgpuAgeCurveSizeEnabled;
    drawMat.uniforms.uAgeCurveSize.value = normalizeAgeCurvePoints(config.gpgpuAgeCurveSizePoints);
  }
  if (drawMat.uniforms.uAgeCurveOpacityEnabled) {
    drawMat.uniforms.uAgeCurveOpacityEnabled.value = config.gpgpuAgeCurveOpacityEnabled;
    drawMat.uniforms.uAgeCurveOpacity.value = normalizeAgeCurvePoints(config.gpgpuAgeCurveOpacityPoints);
  }
  if (drawMat.uniforms.uMapSizeAmount) drawMat.uniforms.uMapSizeAmount.value = config.gpgpuMapSizeAmount;
  if (drawMat.uniforms.uMapOpacityAmount) drawMat.uniforms.uMapOpacityAmount.value = config.gpgpuMapOpacityAmount;
  // Per-property maps / displacement / raster mask (Phase X): a
  // dedicated source, when set, is handed to the shader as that
  // property's own texture (the shader gives it priority over the
  // common image); displacement resolves dedicated-then-common;
  // the mask texture feeds the fragment clip. Unset sources leave
  // ready = false, which is exactly the Phase U fallback path.
  if (drawMat.uniforms.uMapSizeTex) {
    const state = config.gpgpuMapSizeSource ? resolveMapSourceTexture(config.gpgpuMapSizeSource, config) : null;
    drawMat.uniforms.uMapSizeTex.value = state ? state.texture : null;
    if (drawMat.uniforms.uMapSizeReady) drawMat.uniforms.uMapSizeReady.value = state ? state.ready : false;
  }
  if (drawMat.uniforms.uMapOpacityTex) {
    const state = config.gpgpuMapOpacitySource ? resolveMapSourceTexture(config.gpgpuMapOpacitySource, config) : null;
    drawMat.uniforms.uMapOpacityTex.value = state ? state.texture : null;
    if (drawMat.uniforms.uMapOpacityReady) drawMat.uniforms.uMapOpacityReady.value = state ? state.ready : false;
  }
  if (drawMat.uniforms.uMapDisplaceTex) {
    const displaceSource = resolveMapSource(config.gpgpuMapDisplaceSource, config.gpgpuGradImageSource);
    const state = !displaceSource
      ? null
      : config.gpgpuMapDisplaceSource
        ? resolveMapSourceTexture(displaceSource, config)
        : getGradImageTexture(displaceSource);
    drawMat.uniforms.uMapDisplaceTex.value = state ? state.texture : null;
    if (drawMat.uniforms.uMapDisplaceReady) drawMat.uniforms.uMapDisplaceReady.value = state ? state.ready : false;
    if (drawMat.uniforms.uMapDisplaceAmount) drawMat.uniforms.uMapDisplaceAmount.value = config.gpgpuMapDisplaceAmount;
    if (drawMat.uniforms.uMapDisplaceRadius) drawMat.uniforms.uMapDisplaceRadius.value = Math.max(config.gpgpuBounceRadius, 1);
  }
  // Noise field map (Phase AY): the field parameters are shared
  // by the vertex (size / displacement) and the fragment (the
  // 'noise' gradient driver); the field clock is the same time
  // as uGradTime, so evolution follows the deterministic render
  // clock. Values resolve through the lib/noiseFieldMap.ts
  // clamps the unit tests pin.
  if (drawMat.uniforms.uNoiseMapScale) drawMat.uniforms.uNoiseMapScale.value = clampNoiseMapScale(config.gpgpuNoiseMapScale);
  if (drawMat.uniforms.uNoiseMapEvolve) drawMat.uniforms.uNoiseMapEvolve.value = clampNoiseMapEvolve(config.gpgpuNoiseMapEvolve);
  if (drawMat.uniforms.uNoiseMapTime) drawMat.uniforms.uNoiseMapTime.value = time ?? 0;
  if (drawMat.uniforms.uNoiseMapSizeAmount) drawMat.uniforms.uNoiseMapSizeAmount.value = clampNoiseMapAmount(config.gpgpuNoiseMapSizeAmount);
  if (drawMat.uniforms.uNoiseMapDisplaceAmount) drawMat.uniforms.uNoiseMapDisplaceAmount.value = clampNoiseMapAmount(config.gpgpuNoiseMapDisplaceAmount);
  if (drawMat.uniforms.uNoiseMapKind) drawMat.uniforms.uNoiseMapKind.value = noiseMapKindIndex(normalizeNoiseMapKind(config.gpgpuNoiseMapKind));
  if (drawMat.uniforms.uNoiseMapOctaves) drawMat.uniforms.uNoiseMapOctaves.value = clampNoiseMapOctaves(config.gpgpuNoiseMapOctaves);
  if (drawMat.uniforms.uMaskTex) {
    const state = config.gpgpuMaskSource ? resolveMapSourceTexture(config.gpgpuMaskSource, config) : null;
    drawMat.uniforms.uMaskTex.value = state ? state.texture : null;
    if (drawMat.uniforms.uMaskReady) drawMat.uniforms.uMaskReady.value = state ? state.ready : false;
    if (drawMat.uniforms.uMaskMode) drawMat.uniforms.uMaskMode.value = config.gpgpuMaskMode === 'clip' ? 1 : config.gpgpuMaskMode === 'shape' ? 2 : 0;
    if (drawMat.uniforms.uMaskThreshold) drawMat.uniforms.uMaskThreshold.value = config.gpgpuMaskThreshold;
    if (drawMat.uniforms.uMaskInvert) drawMat.uniforms.uMaskInvert.value = config.gpgpuMaskInvert;
  }
  if (drawMat.uniforms.uSpriteImageTex) {
    const spriteState = getSpriteImageTexture(config.gpgpuSpriteImage);
    drawMat.uniforms.uSpriteImageTex.value = spriteState.texture;
    if (drawMat.uniforms.uSpriteImageReady) drawMat.uniforms.uSpriteImageReady.value = spriteState.ready;
    // Sprite sheet (Phase AD): sanitized through the same pure
    // normalizers the unit tests pin (lib/spriteSheet.ts).
    if (drawMat.uniforms.uSpriteSheetCols) drawMat.uniforms.uSpriteSheetCols.value = normalizeSpriteSheetDimension(config.gpgpuSpriteSheetCols);
    if (drawMat.uniforms.uSpriteSheetRows) drawMat.uniforms.uSpriteSheetRows.value = normalizeSpriteSheetDimension(config.gpgpuSpriteSheetRows);
    if (drawMat.uniforms.uSpriteSheetMode) drawMat.uniforms.uSpriteSheetMode.value = spriteFrameModeIndex(config.gpgpuSpriteFrameMode);
    if (drawMat.uniforms.uSpriteSheetFps) drawMat.uniforms.uSpriteSheetFps.value = normalizeSpriteFrameFps(config.gpgpuSpriteFrameFps);
    if (drawMat.uniforms.uSpriteSheetLoop) drawMat.uniforms.uSpriteSheetLoop.value = config.gpgpuSpriteLoop;
    // Sprite rotation (Phase AX): degrees → radians at this site;
    // the angle law itself is lib/spriteRotation.ts.
    if (drawMat.uniforms.uSpriteRotInitial) drawMat.uniforms.uSpriteRotInitial.value = (config.gpgpuSpriteRotInitial ?? 0) * Math.PI / 180;
    if (drawMat.uniforms.uSpriteRotSpeed) drawMat.uniforms.uSpriteRotSpeed.value = (config.gpgpuSpriteRotSpeed ?? 0) * Math.PI / 180;
    if (drawMat.uniforms.uSpriteRotDamping) drawMat.uniforms.uSpriteRotDamping.value = Math.max(0, Math.min(10, config.gpgpuSpriteRotDamping ?? 0));
    if (drawMat.uniforms.uSpriteRotRandom) drawMat.uniforms.uSpriteRotRandom.value = Math.max(0, Math.min(1, config.gpgpuSpriteRotRandom ?? 0));
  }
  // 3D light (Phase T): position / intensity / radius are plain
  // values; the cone direction is normalised on the way in (a zero
  // vector falls back to straight down, matching lib/gpgpuLight.ts).
  if (drawMat.uniforms.uLightEnabled) {
    drawMat.uniforms.uLightEnabled.value = config.gpgpuLightEnabled;
    (drawMat.uniforms.uLightPos.value as THREE.Vector3).set(config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ);
    drawMat.uniforms.uLightIntensity.value = config.gpgpuLightIntensity;
    drawMat.uniforms.uLightRadius.value = config.gpgpuLightRadius;
    drawMat.uniforms.uLightConeEnabled.value = config.gpgpuLightConeEnabled;
    drawMat.uniforms.uLightConeAngleDeg.value = config.gpgpuLightConeAngleDeg;
    const dir = normalizeLightDir(config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ);
    (drawMat.uniforms.uLightConeDir.value as THREE.Vector3).set(dir[0], dir[1], dir[2]);
  }
  // Occlusion-map shadow (Phase Z): the baked grid for the point
  // receiver. Inactive (no texture) yields exactly 1.0 in the
  // vertex shader, so the legacy draw stays bit-identical.
  if (drawMat.uniforms.uShadowEnabled) {
    const shadowTex = getShadowOcclusionTexture(config);
    drawMat.uniforms.uShadowEnabled.value = shadowTex !== null;
    drawMat.uniforms.uShadowStrength.value = config.gpgpuShadowStrength;
    drawMat.uniforms.uShadowMap.value = shadowTex;
    if (drawMat.uniforms.uShadowReady) drawMat.uniforms.uShadowReady.value = shadowTex !== null;
    if (drawMat.uniforms.uShadowExtent) drawMat.uniforms.uShadowExtent.value = shadowCacheExtent;
    if (drawMat.uniforms.uShadowHeightScale) drawMat.uniforms.uShadowHeightScale.value = shadowCacheHeightScale;
  }
  if (drawMat.uniforms.uPointShape) drawMat.uniforms.uPointShape.value = { soft: 0, sphere: 1, ring: 2, star: 3, hexagon: 4, diamond: 5, flare: 6, cloud: 7, bokeh: 8, crosshair: 9, iris: 10, lightning: 11 }[config.gpgpuPointShape] ?? 0;
  drawMat.uniforms.uSortEnabled.value = config.gpgpuSortEnabled && finalSortTex !== null;
  drawMat.uniforms.uSortTex.value = finalSortTex;
  // Sort-based transparency needs Normal blending; otherwise the
  // Kinetix Color blend key rules ('additive' = legacy default).
  drawMat.blending = config.gpgpuSortEnabled || config.gpgpuBlendMode === 'normal'
    ? THREE.NormalBlending
    : THREE.AdditiveBlending;

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
    // Phase DP: cap the ribbon index range at the thinned active
    // prefix (6 indices per particle, laid out sequentially). The
    // geometry is built for texSize^2 particles and was drawn in
    // full; the draw fraction thins the additive overlap further.
    if (ribbonGeo) ribbonGeo.setDrawRange(0, trailDrawCount(activeCount, config.gpgpuTubeDrawFraction) * 6);
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
    // Phase DP: cap the tube index range at the thinned active
    // prefix (TUBE_SIDES * 6 = 48 indices per particle, laid out
    // sequentially in useGpgpuTrailAssets). At texSize 256 the
    // uncapped geometry drew 65,536 tubes for 20,000 active
    // particles (3.28x the intended density), a direct contributor
    // to the additive white-out alongside the unnormalised alphas.
    if (tubeGeo) tubeGeo.setDrawRange(0, trailDrawCount(activeCount, config.gpgpuTubeDrawFraction) * TUBE_SIDES * 6);
    const trailLength = Math.min(MAX_TRAIL - 1, Math.max(2, config.gpgpuTrailLength));
    for (let i = 0; i < MAX_TRAIL - 1; i++) {
      const rtIdxB = ((trailHead.current - 1 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      const rtIdxA = ((trailHead.current - 2 - i) + MAX_TRAIL * 2) % MAX_TRAIL;
      // Phase DP: layer alphas follow rule b1 (lib/trailAlpha) —
      // the legacy fade profile divided by the visible layer
      // count, so the additive stack sums to ≈0.214 for
      // coverage-050 (legacy ≈1.28; rule b2's exact-normalised
      // 0.6 still saturated at the real-GPU gate, b1 + draw
      // thinning is the shipped combination).
      const alpha = tubeLayerAlpha(config.gpgpuTrailFade, i, trailLength - 1, config.gpgpuTubeOpacity);
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
    // Phase DH: cap the instanced solids at the active particle
    // count, like the points drawRange and the volumetric path
    // already do. Without this, texSize rounding (37,781 →
    // 256² = 65,536) silently renders more additive instances
    // than gpgpuCount asks for — the coverage-050 white-out's
    // mechanism-side cause. The simulation still runs on all
    // texels; only the draw is capped.
    if (instGeo) instGeo.instanceCount = activeCount;
    geomMat.uniforms.uPosTex.value = posTexture;
    geomMat.uniforms.uVelTex.value = velTexture;
    geomMat.uniforms.uColor.value.setStyle(config.gpgpuColor);
    geomMat.uniforms.uOpacity.value = config.gpgpuOpacity;
    // Density compensation (Phase DN): solids draw, same
    // uniforms and formula as the points draw.
    if (geomMat.uniforms.uDensityCompEnabled) geomMat.uniforms.uDensityCompEnabled.value = config.gpgpuDensityCompEnabled;
    if (geomMat.uniforms.uDensityTarget) geomMat.uniforms.uDensityTarget.value = config.gpgpuDensityCompTarget;
    if (geomMat.uniforms.uDensityCount) geomMat.uniforms.uDensityCount.value = activeCount;
    if (geomMat.uniforms.uViewportSizePx && args.viewportSizePx) {
      (geomMat.uniforms.uViewportSizePx.value as THREE.Vector2).set(args.viewportSizePx.x, args.viewportSizePx.y);
    }
    geomMat.uniforms.uGeomScale.value = config.gpgpuBounceRadius * 0.02 * config.gpgpuGeomScale;
    geomMat.uniforms.uVelocityAlign.value = config.gpgpuGeomVelocityAlign ? 1 : 0;
    if (geomMat.uniforms.uTime) geomMat.uniforms.uTime.value = time ?? 0;
    if (geomMat.uniforms.uSpinSpeed) geomMat.uniforms.uSpinSpeed.value = config.gpgpuGeomSpinSpeed;
    if (geomMat.uniforms.uSpinRandom) geomMat.uniforms.uSpinRandom.value = Math.max(0, Math.min(1, config.gpgpuGeomSpinRandom ?? 0));
    // Rotation over Lifetime (Phase AC): an all-ones curve is
    // suppressed here too, so a flat curve keeps the legacy spin.
    if (geomMat.uniforms.uAgeEnabled) geomMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
    if (geomMat.uniforms.uAgeMax) geomMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
    if (geomMat.uniforms.uAgeCurveRotationEnabled) {
      geomMat.uniforms.uAgeCurveRotationEnabled.value =
        config.gpgpuAgeCurveRotationEnabled && !isAgeCurveIdentity(normalizeAgeCurvePoints(config.gpgpuAgeCurveRotationPoints));
    }
    if (geomMat.uniforms.uAgeCurveRotation) {
      geomMat.uniforms.uAgeCurveRotation.value = [...normalizeAgeCurvePoints(config.gpgpuAgeCurveRotationPoints)];
    }
    if (geomMat.uniforms.uMeshStretch) geomMat.uniforms.uMeshStretch.value = config.gpgpuGeomStretch;
    if (geomMat.uniforms.uEnvReflect) geomMat.uniforms.uEnvReflect.value = config.gpgpuGeomEnvReflect;
    // Image-based lighting (Phase AL): intensity 0 keeps the map
    // unbound and the fragment branch closed (legacy verbatim).
    if (geomMat.uniforms.uIblIntensity) {
      const iblIntensity = Math.max(0, Math.min(2, config.gpgpuGeomIblIntensity ?? 0));
      geomMat.uniforms.uIblIntensity.value = iblIntensity;
      if (geomMat.uniforms.uIblMap) {
        geomMat.uniforms.uIblMap.value = iblIntensity > 0.001
          ? resolveIblEnvironment(config).texture
          : null;
      }
      if (geomMat.uniforms.uIblYaw) {
        geomMat.uniforms.uIblYaw.value = horizonEquirectYawRadians(config.backgroundEquirectYaw);
      }
    }
  }

  if (config.gpgpuVolumetricEnabled) {
    volumetricGeo.instanceCount = activeCount;
    volumetricMat.uniforms.uPosTex.value = posTexture;
    volumetricMat.uniforms.uColor.value.setStyle(config.gpgpuVolumetricColor);
    volumetricMat.uniforms.uRadius.value = config.gpgpuVolumetricRadius;
    volumetricMat.uniforms.uDensity.value = config.gpgpuVolumetricDensity;
    volumetricMat.uniforms.uOpacity.value = config.gpgpuVolumetricOpacity;
    volumetricMat.uniforms.uSteps.value = config.gpgpuVolumetricSteps;
    // Fog self-shadow (Phase Z): strength 0 skips the secondary
    // march in the shader (legacy bit-identical).
    if (volumetricMat.uniforms.uFogSelfShadow) volumetricMat.uniforms.uFogSelfShadow.value = config.gpgpuFogSelfShadow;
    if (volumetricMat.uniforms.uFogShadowSteps) volumetricMat.uniforms.uFogShadowSteps.value = config.gpgpuFogShadowSteps;
    if (volumetricMat.uniforms.uLightPos) {
      (volumetricMat.uniforms.uLightPos.value as THREE.Vector3).set(config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ);
    }
  }
}
