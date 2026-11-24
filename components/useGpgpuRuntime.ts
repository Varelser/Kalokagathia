import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildGpgpuInitialData } from '../lib/gpgpuInitialData';
import { buildSpawnDistanceValues } from '../lib/gpgpuLifecycle';
import { buildVellumBakeData, buildVellumVolumeGradientData, vellumStatePoolActive, vellumVolumeActive, vellumXpbdPoolActive, type VellumComponent } from '../lib/gpgpuVellum';
import { buildGpgpuMorphTargetDataWithNormals } from '../lib/gpgpuMorphTargets';
import { setBakedSpeciesData } from '../lib/speciesAllocation';
import { planVerticalTextOnPath, splitTextOnPathGlyphs, type TextGlyphRaster } from '../lib/gpgpuTextOnPath';
import type { TextColumnAdjustments } from '../lib/textColumnLayout';
import { traceContourGeometry } from '../lib/contourTrace';
import { fractureOptionFromConfig } from '../lib/voronoiFracture';
import { publishFragmentBake, resolveFragmentRestoreGate, type FragmentRestoreStatus } from '../lib/fragmentCollection';
import { buildBodyClusterColorLut, RIGID_CLUSTER_COLOR_COUNT } from '../lib/rigidClusterColors';
import {
  createRigidSolver,
  resolveRigid,
  rigidFractureOptionFromConfig,
  writeRigidBodyTexture,
  RIGID_BODY_TEX_WIDTH,
  RIGID_BODY_TEX_HEIGHT,
  type RigidSolverState,
} from '../lib/rigidBodies';
import type { MorphMediaMap } from '../lib/gpgpuMorphTargets';
import { extractTextLumaMap } from './controlPanelPartsSourceMediaUtils';
import { getNoiseFieldLuma, noiseFieldCacheKey, noiseFieldSettingsFromConfig } from '../lib/mapSourceSupply';
import { textLayoutOptionsFromTextMap } from '../lib/textColumnLayout';
import { sampleSvgPointCloud } from '../lib/svgMorph';
import { parseSvgPathGeometry, type PathGeometry } from '../lib/pathGeometry';
import { sampleObjPointCloudWithNormals } from '../lib/objMorph';
import { getSceneGeneration, noteGpgpuBackendSettled } from '../lib/sceneGeneration';
import { useDebouncedValue, TERRAIN_EROSION_DEBOUNCE_MS } from '../lib/useDebouncedValue';
import {
  initWebGPUCompute,
  destroyWebGPUCompute,
  updateWebGPUMorphData,
  updateWebGPUMorphNormalData,
} from '../lib/webgpuCompute';
import type { WebGPUComputeState } from '../lib/webgpuCompute';
import { FLUID_SIZE } from './gpgpuShaders';
import { AUX_TEX_SIZE } from './gpgpuShaderAux';
import { WW_TEX_SIZE } from './gpgpuShaderWhitewater';
import { clampAuxDepth } from '../lib/auxChain';
import { getMaxGpgpuTexSize } from '../lib/gpuTier';
import {
  replicaBlockRange,
  replicaStackSide,
  resolveReplicaIndependentActive,
} from '../lib/replicaIndependent';
import { createPosSimMaterial, createVelSimMaterial } from './useGpgpuSimulationAssets';
import { getAttrPointCloud, useAttrPointCloud } from '../lib/attrPointCloud';
import {
  PYRO_GRID_LAYOUTS,
  pyroGridAtlasSize,
  resolvePyroGridResolution,
} from '../lib/pyroGrid';
import {
  ensurePyroGridSupport,
  getPyroGridSupport,
  subscribePyroGridSupport,
  type PyroGridSupport,
} from '../lib/pyroGridSupport';
import { resolveEffectiveTierSync } from '../lib/gpuTier';
import {
  disposePyroGridTargets,
  type PyroGridTargets,
} from './gpgpuPyroGridPasses';
import { flip3dActive, resolveFlip3dResolution } from '../lib/flip3d';
import {
  disposeFlip3dTargets,
  type Flip3dTargets,
} from './gpgpuFlip3dPasses';
import {
  buildAttributeData,
  buildAttributeDataExt,
  normalizeAttrExprs,
  normalizeAttrNames,
  normalizeAttrNames2,
  normalizeAttrSources,
  resolveAttrColorSlots,
  resolveAttrConsumers,
  resolveAttrExtConsumers,
} from '../lib/gpgpuAttributes';
import { evaluateGpgpuGroup, parseGpgpuGroups, resolveGroupGate } from '../lib/gpgpuGroups';
import { grainsCellSortActive } from '../lib/gpgpuGrains';
import { setLastAttrBake } from '../lib/gpgpuGroupBridge';

// The GPGPU tex-size caps (MAX_GPGPU_TEX_SIZE / GPGPU_TEX_SIZE_CAPS /
// getMaxGpgpuTexSize) live in lib/gpuTier.ts since the 2026-11-14 perf
// stage-2 split; re-exported here for existing importers.
export { MAX_GPGPU_TEX_SIZE, GPGPU_TEX_SIZE_CAPS, getMaxGpgpuTexSize } from '../lib/gpuTier';

export function getTexSize(count: number): number {
  const side = Math.ceil(Math.sqrt(count));
  let s = 1;
  while (s < side) s <<= 1;
  return Math.min(Math.max(s, 2), getMaxGpgpuTexSize());
}

function makeRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

// FLIP layer (Phase AT): grid data targets are sampled at texel
// centres only (taps / composite), so nearest filtering keeps
// every read exact.
function makeGridRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function makeFluidRT(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.RepeatWrapping;
  return rt;
}

// Pyro grid (Phase CA): atlas targets are rectangular (the 3D
// grid packed into tiles) and clamp to the edge — Repeat would
// bleed neighbouring z slices across tile borders. Field targets
// (velocity / scalar) filter linearly when the device can filter
// float textures; pressure / divergence are single-channel R32F
// and always nearest (exact texel fetches only).
function makePyroFieldRT(width: number, height: number, linear: boolean): THREE.WebGLRenderTarget {
  const filter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: filter,
    magFilter: filter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function makePyroScalarRT(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RedFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

// Allocates and zero-initialises one Pyro grid target set (the
// aux-pool DataTexture copy path). Zero state matters: the first
// Jacobi solve starts from the cleared pressure targets and the
// fields must read as empty, not as uninitialised GPU memory.
function createPyroGridTargets(
  gl: THREE.WebGLRenderer,
  resolution: number,
  floatLinear: boolean,
): PyroGridTargets | null {
  const layout = PYRO_GRID_LAYOUTS[resolution];
  const size = pyroGridAtlasSize(resolution);
  if (!layout || !size) return null;
  const targets: PyroGridTargets = {
    velA: makePyroFieldRT(size.width, size.height, floatLinear),
    velB: makePyroFieldRT(size.width, size.height, floatLinear),
    scalarA: makePyroFieldRT(size.width, size.height, floatLinear),
    scalarB: makePyroFieldRT(size.width, size.height, floatLinear),
    presA: makePyroScalarRT(size.width, size.height),
    presB: makePyroScalarRT(size.width, size.height),
    div: makePyroScalarRT(size.width, size.height),
    curl: makePyroFieldRT(size.width, size.height, floatLinear),
    baseVelTexture: null,
    resolution,
    atlasWidth: size.width,
    atlasHeight: size.height,
    tilesX: layout.cols,
    tilesY: layout.rows,
    floatLinear,
    velPingIsA: true,
    framesStepped: 0,
  };
  const zeroData = new Float32Array(size.width * size.height * 4);
  const zeroTex = new THREE.DataTexture(zeroData, size.width, size.height, THREE.RGBAFormat, THREE.FloatType);
  zeroTex.needsUpdate = true;
  const copyScene = new THREE.Scene();
  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyGeo = new THREE.PlaneGeometry(2, 2);
  const copyMat = new THREE.MeshBasicMaterial({ map: zeroTex });
  copyMat.blending = THREE.NoBlending;
  const copyMesh = new THREE.Mesh(copyGeo, copyMat);
  copyScene.add(copyMesh);
  for (const rt of [targets.velA, targets.velB, targets.scalarA, targets.scalarB, targets.presA, targets.presB, targets.div, targets.curl]) {
    gl.setRenderTarget(rt);
    gl.render(copyScene, copyCam);
  }
  gl.setRenderTarget(null);
  zeroTex.dispose();
  copyMat.dispose();
  copyGeo.dispose();
  return targets;
}

// FLIP 3D (Phase 19 stage 2): allocates and zero-initialises
// one FLIP3D target set (the pyro atlas discipline: velocity /
// phi / scratch fields filter linearly when the device can,
// pressure / transfer are exact-fetch nearest). Zero state
// matters: the first Jacobi solve starts from the cleared
// pressure targets and the fields must read as empty.
function createFlip3dTargets(
  gl: THREE.WebGLRenderer,
  resolution: number,
  floatLinear: boolean,
): Flip3dTargets | null {
  const layout = PYRO_GRID_LAYOUTS[resolution];
  const size = pyroGridAtlasSize(resolution);
  if (!layout || !size) return null;
  const targets: Flip3dTargets = {
    velA: makePyroFieldRT(size.width, size.height, floatLinear),
    velB: makePyroFieldRT(size.width, size.height, floatLinear),
    presA: makePyroFieldRT(size.width, size.height, false),
    presB: makePyroFieldRT(size.width, size.height, false),
    transfer: makePyroFieldRT(size.width, size.height, false),
    phiA: makePyroFieldRT(size.width, size.height, floatLinear),
    phiB: makePyroFieldRT(size.width, size.height, floatLinear),
    scratch: makePyroFieldRT(size.width, size.height, floatLinear),
    curv: makePyroFieldRT(size.width, size.height, false),
    baseVelTexture: null,
    phiTexture: null,
    resolution,
    atlasWidth: size.width,
    atlasHeight: size.height,
    tilesX: layout.cols,
    tilesY: layout.rows,
    floatLinear,
    velPingIsA: true,
    phiPingIsA: true,
    framesStepped: 0,
  };
  const zeroData = new Float32Array(size.width * size.height * 4);
  const zeroTex = new THREE.DataTexture(zeroData, size.width, size.height, THREE.RGBAFormat, THREE.FloatType);
  zeroTex.needsUpdate = true;
  const copyScene = new THREE.Scene();
  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyGeo = new THREE.PlaneGeometry(2, 2);
  const copyMat = new THREE.MeshBasicMaterial({ map: zeroTex });
  copyMat.blending = THREE.NoBlending;
  const copyMesh = new THREE.Mesh(copyGeo, copyMat);
  copyScene.add(copyMesh);
  for (const rt of [targets.velA, targets.velB, targets.presA, targets.presB, targets.transfer, targets.phiA, targets.phiB, targets.scratch, targets.curv]) {
    gl.setRenderTarget(rt);
    gl.render(copyScene, copyCam);
  }
  gl.setRenderTarget(null);
  zeroTex.dispose();
  copyMat.dispose();
  copyGeo.dispose();
  return targets;
}

export type AuxPoolTargets = {
  posA: THREE.WebGLRenderTarget;
  posB: THREE.WebGLRenderTarget;
  velA: THREE.WebGLRenderTarget;
  velB: THREE.WebGLRenderTarget;
};

/**
 * One initialized aux-chain pool (Phase W1): a 128x128 ping-pong
 * pair seeded with the inactive state (age 10 >= life 0), using the
 * same DataTexture copy path as the level-1 pool in the main effect.
 * Chain pools are allocated ONLY while the configured depth reaches
 * them (see the depth effect in useGpgpuRuntime), so depth 1 costs
 * no extra targets at all.
 */
function createInitializedAuxPool(gl: THREE.WebGLRenderer): AuxPoolTargets {
  const posA = makeRT(AUX_TEX_SIZE);
  const posB = makeRT(AUX_TEX_SIZE);
  const velA = makeRT(AUX_TEX_SIZE);
  const velB = makeRT(AUX_TEX_SIZE);
  const count = AUX_TEX_SIZE * AUX_TEX_SIZE;
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    posData[i * 4 + 3] = 10; // age: past any life → inactive
    velData[i * 4 + 3] = 0; // life: 0 → inactive
  }
  const posTex = new THREE.DataTexture(posData, AUX_TEX_SIZE, AUX_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
  const velTex = new THREE.DataTexture(velData, AUX_TEX_SIZE, AUX_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
  posTex.needsUpdate = true;
  velTex.needsUpdate = true;
  const copyScene = new THREE.Scene();
  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyGeo = new THREE.PlaneGeometry(2, 2);
  const copyMat = new THREE.MeshBasicMaterial({ map: posTex });
  copyMat.blending = THREE.NoBlending;
  const copyMesh = new THREE.Mesh(copyGeo, copyMat);
  copyScene.add(copyMesh);
  gl.setRenderTarget(posA);
  gl.render(copyScene, copyCam);
  gl.setRenderTarget(posB);
  gl.render(copyScene, copyCam);
  copyMat.map = velTex;
  copyMat.needsUpdate = true;
  gl.setRenderTarget(velA);
  gl.render(copyScene, copyCam);
  gl.setRenderTarget(velB);
  gl.render(copyScene, copyCam);
  gl.setRenderTarget(null);
  posTex.dispose();
  velTex.dispose();
  copyMat.dispose();
  copyGeo.dispose();
  return { posA, posB, velA, velB };
}

function disposeAuxPool(pool: AuxPoolTargets | null): void {
  if (!pool) return;
  pool.posA.dispose();
  pool.posB.dispose();
  pool.velA.dispose();
  pool.velB.dispose();
}

/**
 * One replica simulation stack (Phase W2, method (a)): the
 * state-separated sim for a single morph-replica block — its own
 * ping-pong targets and Verlet previous-position target, seeded
 * from the shared initial data, plus its own velocity/position
 * materials (factory-built with the shared shaders).
 */
export type ReplicaStack = {
  index: number;
  start: number;
  size: number;
  side: number;
  targets: AuxPoolTargets;
  prevPos: THREE.WebGLRenderTarget;
  pingIsA: boolean;
  velMat: THREE.ShaderMaterial;
  posMat: THREE.ShaderMaterial;
};

function createReplicaStacks(
  gl: THREE.WebGLRenderer,
  texSize: number,
  config: ParticleConfig,
  initPosData: Float32Array,
  initVelData: Float32Array,
): ReplicaStack[] {
  const count = Math.max(1, Math.min(8, Math.round(config.gpgpuMorphReplicaCount)));
  const total = texSize * texSize;
  const copyScene = new THREE.Scene();
  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyGeo = new THREE.PlaneGeometry(2, 2);
  const copyMat = new THREE.MeshBasicMaterial({ map: null });
  copyMat.blending = THREE.NoBlending;
  const copyMesh = new THREE.Mesh(copyGeo, copyMat);
  copyScene.add(copyMesh);
  const stacks: ReplicaStack[] = [];
  for (let r = 0; r < count; r++) {
    const { start, size } = replicaBlockRange(total, count, r);
    const side = replicaStackSide(size);
    const targets: AuxPoolTargets = {
      posA: makeRT(side),
      posB: makeRT(side),
      velA: makeRT(side),
      velB: makeRT(side),
    };
    const prevPos = makeRT(side);
    // Seed from the shared initial arrays: stack-local texel j is
    // global texel start + j. Padding texels (j >= size) stay
    // zeroed — inert, never merged or drawn.
    const texelCount = side * side;
    const stackPos = new Float32Array(texelCount * 4);
    const stackVel = new Float32Array(texelCount * 4);
    for (let j = 0; j < size; j++) {
      const g = (start + j) * 4;
      const l = j * 4;
      stackPos[l] = initPosData[g];
      stackPos[l + 1] = initPosData[g + 1];
      stackPos[l + 2] = initPosData[g + 2];
      stackPos[l + 3] = initPosData[g + 3];
      stackVel[l] = initVelData[g];
      stackVel[l + 1] = initVelData[g + 1];
      stackVel[l + 2] = initVelData[g + 2];
      stackVel[l + 3] = initVelData[g + 3];
    }
    const posTex = new THREE.DataTexture(stackPos, side, side, THREE.RGBAFormat, THREE.FloatType);
    const velTex = new THREE.DataTexture(stackVel, side, side, THREE.RGBAFormat, THREE.FloatType);
    posTex.needsUpdate = true;
    velTex.needsUpdate = true;
    copyMat.map = posTex;
    copyMat.needsUpdate = true;
    gl.setRenderTarget(targets.posA);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(prevPos);
    gl.render(copyScene, copyCam);
    copyMat.map = velTex;
    copyMat.needsUpdate = true;
    gl.setRenderTarget(targets.velA);
    gl.render(copyScene, copyCam);
    posTex.dispose();
    velTex.dispose();
    stacks.push({
      index: r,
      start,
      size,
      side,
      targets,
      prevPos,
      pingIsA: true,
      velMat: createVelSimMaterial(side, config),
      posMat: createPosSimMaterial(side, config),
    });
  }
  gl.setRenderTarget(null);
  copyMat.dispose();
  copyGeo.dispose();
  return stacks;
}

function disposeReplicaStacks(stacks: ReplicaStack[] | null): void {
  if (!stacks) return;
  for (const stack of stacks) {
    disposeAuxPool(stack.targets);
    stack.prevPos.dispose();
    stack.velMat.dispose();
    stack.posMat.dispose();
  }
}

export type GpgpuRuntimeRefs = {
  rtRef: MutableRefObject<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>;
  pingIsA: MutableRefObject<boolean>;
  prevPosRTRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  initPosTexRef: MutableRefObject<THREE.DataTexture | null>;
  // Spawn order (Phase AX): static texture of the pool's
  // max-normalised initial distances (R channel), built with the
  // initial data; the passes only read it in a distance mode.
  spawnOrderTexRef: MutableRefObject<THREE.DataTexture | null>;
  morphTexRef: MutableRefObject<THREE.DataTexture | null>;
  morphNormalTexRef: MutableRefObject<THREE.DataTexture | null>;
  attrTexRef: MutableRefObject<THREE.DataTexture | null>;
  attrTex2Ref: MutableRefObject<THREE.DataTexture | null>;
  fluidRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidPingIsA: MutableRefObject<boolean>;
  flipTransferRTRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  flipPressureRTRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  sortRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  sortRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  grainsSortRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  grainsSortRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  auxRtRef: MutableRefObject<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>;
  auxPingIsA: MutableRefObject<boolean>;
  // Whitewater (Phase BC): the foam pool's ping-pong pair
  // (fixed 64x64), allocated with the other pools and initialised
  // to the same inactive state; the passes only run while the
  // whitewater key (and the fluid field + FLIP layer) is on.
  wwRtRef: MutableRefObject<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>;
  wwPingIsA: MutableRefObject<boolean>;
  aux2RtRef: MutableRefObject<AuxPoolTargets | null>;
  aux2PingIsA: MutableRefObject<boolean>;
  aux3RtRef: MutableRefObject<AuxPoolTargets | null>;
  aux3PingIsA: MutableRefObject<boolean>;
  replicaStacksRef: MutableRefObject<ReplicaStack[] | null>;
  // Vellum (Phase AR): the static rest-pose texture (the grid
  // bake itself) and the tear link-survival ping-pong pair
  // (allocated only while the tear key is on).
  vellumRestTexRef: MutableRefObject<THREE.DataTexture | null>;
  vellumStateRtRef: MutableRefObject<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null>;
  vellumStatePingIsA: MutableRefObject<boolean>;
  // Vellum XPBD (Phase 19 stage 3): λ pair, the volume
  // reduction chain + 1×1 volume-λ target, the baked volume
  // gradient texture (+ its rest volume / denominator), and
  // the component-label texture with its latest CPU labelling.
  // All exist only in xpbd mode; legacy allocates none.
  vellumXpbdRtRef: MutableRefObject<{
    lambda0: THREE.WebGLRenderTarget;
    lambda1: THREE.WebGLRenderTarget;
    volumeChain: THREE.WebGLRenderTarget[];
    lambdaVol: THREE.WebGLRenderTarget;
  } | null>;
  vellumGradTexRef: MutableRefObject<THREE.DataTexture | null>;
  vellumVolumeInfoRef: MutableRefObject<{ restVolume: number; denom: number } | null>;
  vellumComponentTexRef: MutableRefObject<THREE.DataTexture | null>;
  vellumComponentsRef: MutableRefObject<VellumComponent[] | null>;
  // Rigid bodies (Phase AU): the per-particle cell texture
  // (xyz = local offset in the body, w = body index), the
  // solver's body-state supply texture (64×4) with its CPU
  // backing array, and the CPU solver state itself. All three
  // exist only while the solver is enabled AND a morph bake
  // produced a fracture cell table to bind.
  rigidCellTexRef: MutableRefObject<THREE.DataTexture | null>;
  // Cluster colour LUT (Phase 20 stage 1): 64×1 RGBA float,
  // row = body index, colour = the body's static bake-time
  // cluster colour. Exists only while the cluster colour key
  // is on AND a bake produced a cell table to derive it from.
  rigidClusterLutTexRef: MutableRefObject<THREE.DataTexture | null>;
  rigidBodyTexRef: MutableRefObject<THREE.DataTexture | null>;
  rigidBodyDataRef: MutableRefObject<Float32Array | null>;
  rigidSolverRef: MutableRefObject<RigidSolverState | null>;
  // Pyro grid (Phase CA): the atlas target set for the grid
  // solver, allocated only while the grid key is on AND the
  // diagnostics gate confirmed float render targets; null at all
  // other times (the passes no-op on null).
  pyroGridRef: MutableRefObject<PyroGridTargets | null>;
  // FLIP 3D (Phase 19 stage 2): the atlas target set for the 3D
  // FLIP solver, allocated only while the FLIP mode is '3d'
  // (and the FLIP layer + fluid field are on) AND float render
  // targets are confirmed; null at all other times, so the 2D
  // default allocates nothing (the passes no-op on null).
  flip3dRef: MutableRefObject<Flip3dTargets | null>;
  webgpuStateRef: MutableRefObject<WebGPUComputeState | null>;
  webgpuPosTexRef: MutableRefObject<THREE.DataTexture | null>;
  webgpuPingIsARef: MutableRefObject<boolean>;
};

type UseGpgpuRuntimeArgs = {
  gl: THREE.WebGLRenderer;
  texSize: number;
  config: ParticleConfig;
};

/**
 * The morph bake, shared by the WebGL texture effect below and the
 * WebGPU state (Phase R: the WGSL velocity pass reads the same baked
 * cloud from a storage buffer). Pure function of the config's morph
 * fields + texSize; null when morph is disabled. The media-dependent
 * inputs are assembled exactly as the texture effect always has:
 * text reuses the layer TextMap renderer, image reuses the loaded
 * layer-2 media luma map, svg/obj re-sample their source texts.
 */
/**
 * Raster mask option for the morph bake (Phase X): the numeric
 * luma map captured at import time, or null while the mask is off
 * / has no usable map — null keeps the bake bit-identical.
 */
export function morphMaskOption(config: ParticleConfig) {
  if (config.gpgpuMaskMode === 'off') return null;
  if (!config.gpgpuMaskMap || config.gpgpuMaskMap.length === 0) return null;
  if (!(config.gpgpuMaskMapWidth > 0) || !(config.gpgpuMaskMapHeight > 0)) return null;
  return {
    map: {
      map: config.gpgpuMaskMap,
      width: config.gpgpuMaskMapWidth,
      height: config.gpgpuMaskMapHeight,
    },
    mode: config.gpgpuMaskMode,
    threshold: config.gpgpuMaskThreshold,
    invert: config.gpgpuMaskInvert,
  };
}

/**
 * Text on path (Phase AF2): build the bake's textOnPath option
 * from primitive inputs — per-glyph luma rasters of the TextMap
 * string, extracted with the same settings the 'text' target
 * bakes with (each character centred in its own 64×64 cell).
 * Shared by buildMorphBakeData (WebGPU path) and the morph
 * texture effect (WebGL path) so the two routings can never
 * drift apart; returns null unless the feature is on and a path
 * mode can consume it, so the default bake pays nothing for it.
 */
export function buildTextOnPathOption(args: {
  target: string;
  enabled: boolean;
  pathMode: string;
  text: string;
  fontFamily: string;
  weight: number;
  size: number;
  padding: number;
  invert: boolean;
  delay: number;
  glyphSize: number;
  // Per-glyph deformation amounts (Phase AM); all zero resolves
  // to deform: null (the AF2 bake verbatim).
  glyphScale: number;
  glyphRotate: number;
  glyphFade: number;
  // Vertical text on path (Phase 17): while on, the string is
  // planned as vertical columns by the shared TextMap layout
  // (columnLength + adjustments are its settings) and the cells
  // — glyphs and tate-chu-yoko runs — are rasterised in plan
  // order. Omitted / false resolves to the AF2 single-line
  // glyph set verbatim.
  vertical?: boolean;
  columnLength?: number;
  adjustments?: TextColumnAdjustments;
}): { glyphs: TextGlyphRaster[]; delay: number; size: number; deform: { scaleVar: number; rotateDeg: number; fadeVar: number } | null; vertical: boolean } | null {
  if (args.target !== 'svg' || !args.enabled) return null;
  if (args.pathMode !== 'along' && args.pathMode !== 'writeOn') return null;
  const vertical = args.vertical === true;
  const chars = vertical
    ? planVerticalTextOnPath(args.text || 'TEXT', args.columnLength ?? 0, args.adjustments).units.map((unit) => unit.text)
    : splitTextOnPathGlyphs(args.text || 'TEXT');
  if (chars.length === 0) return null;
  const glyphs = chars.map((ch) => ({
    map: extractTextLumaMap(
      ch,
      64,
      64,
      args.fontFamily,
      args.weight,
      args.size,
      args.padding,
      args.invert,
    ),
    size: 64,
  }));
  const deform = args.glyphScale > 0 || args.glyphRotate > 0 || args.glyphFade > 0
    ? { scaleVar: args.glyphScale, rotateDeg: args.glyphRotate, fadeVar: args.glyphFade }
    : null;
  return { glyphs, delay: args.delay, size: args.glyphSize, deform, vertical };
}

/**
 * Contour geometry builder (Phase AM, lib/contourTrace.ts):
 * shared by the WebGPU bake builder and the WebGL morph effect
 * so the two routings can never drift. Traces the selected luma
 * source — the layer-2 TextMap raster ('text') or the layer-2
 * media luma map ('image') — at the configured threshold and
 * returns the outline as a PathGeometry; null when the target
 * is not 'contour' or no outline exists (the bake then falls
 * back to a shell).
 */
export function buildContourGeometryOption(config: ParticleConfig): PathGeometry | null {
  if (config.gpgpuMorphTarget !== 'contour') return null;
  let mediaMap: MorphMediaMap | null = null;
  if (config.gpgpuMorphContourSource === 'image') {
    if (
      config.layer2MediaLumaMap && config.layer2MediaLumaMap.length > 0
      && config.layer2MediaMapWidth > 0 && config.layer2MediaMapHeight > 0
    ) {
      mediaMap = {
        map: config.layer2MediaLumaMap,
        width: config.layer2MediaMapWidth,
        height: config.layer2MediaMapHeight,
      };
    }
  } else {
    const map = extractTextLumaMap(
      config.layer2TextMapText,
      128,
      128,
      config.layer2TextMapFontFamily,
      config.layer2TextMapWeight,
      config.layer2TextMapSize,
      config.layer2TextMapPadding,
      config.layer2TextMapInvert,
      textLayoutOptionsFromTextMap(config),
    );
    mediaMap = { map, width: 128, height: 128 };
  }
  if (!mediaMap) return null;
  return traceContourGeometry(
    mediaMap.map,
    mediaMap.width,
    mediaMap.height,
    config.gpgpuMorphContourThreshold,
  );
}

export function buildMorphBakeData(
  config: ParticleConfig,
  texSize: number,
): { data: Float32Array; normalData: Float32Array } | null {
  if (!config.gpgpuMorphEnabled) return null;
  let mediaMap: MorphMediaMap | null = null;
  if (config.gpgpuMorphTarget === 'text') {
    const map = extractTextLumaMap(
      config.layer2TextMapText,
      128,
      128,
      config.layer2TextMapFontFamily,
      config.layer2TextMapWeight,
      config.layer2TextMapSize,
      config.layer2TextMapPadding,
      config.layer2TextMapInvert,
      textLayoutOptionsFromTextMap(config),
    );
    mediaMap = { map, width: 128, height: 128 };
  } else if (config.gpgpuMorphTarget === 'image' && config.gpgpuMorphNoiseMapEnabled) {
    // Phase 15 (TD §1): the noise field's static slice supplies the
    // bake, rasterised by the same Phase BJ supply path the layer
    // maps use (z = 0, time 0 — the bake is static by nature; the
    // field's evolution stays with the live field on the render
    // side). The field settings come from the gpgpuNoiseMap* keys.
    mediaMap = { map: getNoiseFieldLuma(config, 128), width: 128, height: 128 };
  } else if (
    config.gpgpuMorphTarget === 'image'
    && config.layer2MediaLumaMap && config.layer2MediaLumaMap.length > 0
    && config.layer2MediaMapWidth > 0 && config.layer2MediaMapHeight > 0
  ) {
    mediaMap = {
      map: config.layer2MediaLumaMap,
      width: config.layer2MediaMapWidth,
      height: config.layer2MediaMapHeight,
    };
  }
  const svgPoints = config.gpgpuMorphTarget === 'svg'
    ? sampleSvgPointCloud(config.gpgpuMorphSvgSource)
    : null;
  // Path geometry (Phase S): parsed only when a path mode is on —
  // with mode 'off' the bake never consults it, and skipping the
  // parse keeps the legacy bake path exactly as fast as before.
  const pathGeometry = config.gpgpuMorphTarget === 'svg' && config.gpgpuMorphPathMode !== 'off'
    ? parseSvgPathGeometry(config.gpgpuMorphSvgSource)
    : null;
  // Text on path (Phase AF2): shared builder — see
  // buildTextOnPathOption above.
  const textOnPath = buildTextOnPathOption({
    target: config.gpgpuMorphTarget,
    enabled: config.gpgpuMorphTextOnPathEnabled,
    pathMode: config.gpgpuMorphPathMode,
    text: config.layer2TextMapText,
    fontFamily: config.layer2TextMapFontFamily,
    weight: config.layer2TextMapWeight,
    size: config.layer2TextMapSize,
    padding: config.layer2TextMapPadding,
    invert: config.layer2TextMapInvert,
    delay: config.gpgpuMorphTextOnPathDelay,
    glyphSize: config.gpgpuMorphTextOnPathSize,
    glyphScale: config.gpgpuMorphTextOnPathGlyphScale,
    glyphRotate: config.gpgpuMorphTextOnPathGlyphRotate,
    glyphFade: config.gpgpuMorphTextOnPathGlyphFade,
    // Vertical text on path (Phase 17): the plan reuses the
    // TextMap vertical settings (column length + token grammar).
    vertical: config.gpgpuMorphTextOnPathVertical,
    columnLength: config.layer2TextMapColumnLength,
    adjustments: {
      kinsoku: config.layer2TextMapKinsoku,
      tatechuyoko: config.layer2TextMapTateChuYoko,
      ruby: config.layer2TextMapRuby,
    },
  });
  // Contour target (Phase AM): shared builder — see
  // buildContourGeometryOption above.
  const contourGeometry = buildContourGeometryOption(config);
  // Phase AA3: in 'stamp' path mode with the 'obj' stamp shape, the
  // OBJ cloud is also sampled on the svg target (as a stamp pattern).
  const objSample = config.gpgpuMorphTarget === 'obj'
    || (config.gpgpuMorphTarget === 'svg' && config.gpgpuMorphPathMode === 'stamp' && config.gpgpuMorphStampShape === 'obj')
    ? sampleObjPointCloudWithNormals(config.gpgpuMorphObjSource, config.gpgpuMorphObjSampleMode)
    : null;
  const baked = buildGpgpuMorphTargetDataWithNormals({
    texSize,
    target: config.gpgpuMorphTarget,
    worldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
    jitter: config.gpgpuMorphJitter,
    seed: config.gpgpuSeed,
    mediaMap,
    svgPoints,
    pathGeometry,
    path: {
      mode: config.gpgpuMorphPathMode,
      writeOnStart: config.gpgpuMorphPathWriteOnStart,
      writeOnEnd: config.gpgpuMorphPathWriteOnEnd,
      taper: config.gpgpuMorphPathTaper,
      taperShape: config.gpgpuMorphPathTaperShape,
      subpathMode: config.gpgpuMorphPathSubpathMode,
      stampSpacing: config.gpgpuMorphStampSpacing,
      stampSize: config.gpgpuMorphStampSize,
      stampShape: config.gpgpuMorphStampShape,
      stampAlign: config.gpgpuMorphStampAlign,
      // Path offset (Phase AM): 0 = the authored geometry itself.
      offset: config.gpgpuMorphPathOffset,
    },
    textOnPath,
    contourGeometry,
    // Polygon target + path jitter (Phase AW).
    polygonSides: config.gpgpuMorphPolygonSides,
    pathJitter: config.layer1LineJitterPaths ? config.layer1LineJitter : 0,
    // Voronoi fracture (Phase AG): shared option builder so the
    // WebGPU bake and the WebGL / CPU routings can never drift.
    fracture: fractureOptionFromConfig(config),
    form: {
      disperseAmount: config.gpgpuMorphDisperseAmount,
      disperseDirection: config.gpgpuMorphDisperseDirection,
      twistAmount: config.gpgpuMorphTwistAmount,
      twistAxis: config.gpgpuMorphTwistAxis,
      fractalAmount: config.gpgpuMorphFractalAmount,
      fractalFrequency: config.gpgpuMorphFractalFrequency,
      fractalEvolution: config.gpgpuMorphFractalEvolution,
    },
    objPoints: objSample ? objSample.points : null,
    objNormals: objSample ? objSample.normals : null,
    replica: {
      count: config.gpgpuMorphReplicaCount,
      spacing: config.gpgpuMorphReplicaSpacing,
      axis: config.gpgpuMorphReplicaAxis,
      rotationDeg: config.gpgpuMorphReplicaRotation,
      scaleStep: config.gpgpuMorphReplicaScaleStep,
      phaseStepDeg: config.gpgpuMorphReplicaPhaseStep,
    },
    terrain: {
      amplitude: config.gpgpuMorphTerrainAmplitude,
      frequency: config.gpgpuMorphTerrainFrequency,
      octaves: config.gpgpuMorphTerrainOctaves,
      seed: config.gpgpuMorphTerrainSeed,
      // Terrain recipes (Phase AI): 'fbm' is the legacy field.
      kind: config.gpgpuMorphTerrainKind,
      terraceSteps: config.gpgpuMorphTerrainTerraceSteps,
      // Terrain erosion (Phase AP): plane mode only — stripped
      // in tunnel mode (the collider / slope-force precedent).
      erosion: config.gpgpuTerrainMeshTunnel ? undefined : {
        water: config.gpgpuMorphTerrainErosionWater,
        droplets: config.gpgpuMorphTerrainErosionDroplets,
        deposit: config.gpgpuMorphTerrainErosionDeposit,
        thermal: config.gpgpuMorphTerrainErosionThermal,
        talus: config.gpgpuMorphTerrainErosionTalus,
        thermalPasses: config.gpgpuMorphTerrainErosionThermalPasses,
        seed: config.gpgpuMorphTerrainErosionSeed,
        // Erosion mask (Phase 20 stage 3).
        mask: {
          mode: config.gpgpuMorphTerrainErosionMaskMode,
          strength: config.gpgpuMorphTerrainErosionMaskStrength,
          invert: config.gpgpuMorphTerrainErosionMaskInvert,
          low: config.gpgpuMorphTerrainErosionMaskLow,
          high: config.gpgpuMorphTerrainErosionMaskHigh,
        },
      },
    },
    // Terrain scatter grammar (Phase AI): a top-level bake
    // option (only read by the terrain target), gated by its
    // enabled key exactly like the mask option; all-default
    // values resolve to the identity inside the bake.
    scatter: config.gpgpuMorphScatterEnabled ? {
      density: config.gpgpuMorphScatterDensity,
      heightMin: config.gpgpuMorphScatterHeightMin,
      heightMax: config.gpgpuMorphScatterHeightMax,
      slopeMax: config.gpgpuMorphScatterSlopeMax,
      alignNormal: config.gpgpuMorphScatterAlignNormal,
      species: config.gpgpuMorphScatterSpecies,
      scaleRandom: config.gpgpuMorphScatterScaleRandom,
      rotRandom: config.gpgpuMorphScatterRotRandom,
      bend: config.gpgpuMorphScatterBend,
      pcgGraphEnabled: config.gpgpuPcgGraphEnabled,
      pcgGraphData: config.gpgpuPcgGraphData,
    } : null,
    mask: morphMaskOption(config),
    // Attribute point cloud (Phase AK): the data target's
    // placement cloud, read from the shared store at bake time
    // (null = no cloud registered → shell fallback in the bake).
    dataPoints: config.gpgpuMorphTarget === 'data'
      ? getAttrPointCloud()?.unitPositions ?? null
      : null,
  });
  // Species channel (Phase 16 stage 5): publish the bake's
  // per-texel species zones on the shared slot the mesh assets
  // read for the foliage split (lib/speciesAllocation.ts).
  setBakedSpeciesData(
    baked.speciesData,
    texSize,
    config.gpgpuMorphScatterEnabled
      ? Math.max(1, Math.min(4, Math.floor(config.gpgpuMorphScatterSpecies) || 1))
      : 1,
  );
  return baked;
}

export function useGpgpuRuntime({ gl, texSize, config }: UseGpgpuRuntimeArgs): GpgpuRuntimeRefs {
  const rtRef = useRef<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>(null);
  const pingIsA = useRef(true);
  const prevPosRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const initPosTexRef = useRef<THREE.DataTexture | null>(null);
  const spawnOrderTexRef = useRef<THREE.DataTexture | null>(null);
  const morphTexRef = useRef<THREE.DataTexture | null>(null);
  const morphNormalTexRef = useRef<THREE.DataTexture | null>(null);
  const attrTexRef = useRef<THREE.DataTexture | null>(null);
  // Ext attribute texture (Phase 18 stage 1): slots 4..7, built
  // only while an enabled pass reads an ext slot name.
  const attrTex2Ref = useRef<THREE.DataTexture | null>(null);
  // Attribute point cloud (Phase AK): subscribing here puts the
  // cloud's version into the morph bake's dependency set (the
  // 'data' target) and into the attribute texture's signature.
  const attrCloud = useAttrPointCloud();
  const fluidRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidPingIsA = useRef(true);
  const flipTransferRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const flipPressureRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const sortRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const sortRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const grainsSortRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const grainsSortRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const auxRtRef = useRef<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>(null);
  const auxPingIsA = useRef(true);
  const wwRtRef = useRef<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>(null);
  const wwPingIsA = useRef(true);
  const aux2RtRef = useRef<AuxPoolTargets | null>(null);
  const aux2PingIsA = useRef(true);
  const pyroGridRef = useRef<PyroGridTargets | null>(null);
  const flip3dRef = useRef<Flip3dTargets | null>(null);
  const aux3RtRef = useRef<AuxPoolTargets | null>(null);
  const aux3PingIsA = useRef(true);
  const replicaStacksRef = useRef<ReplicaStack[] | null>(null);
  const vellumRestTexRef = useRef<THREE.DataTexture | null>(null);
  const vellumStateRtRef = useRef<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null>(null);
  const vellumStatePingIsA = useRef(true);
  const vellumXpbdRtRef = useRef<{
    lambda0: THREE.WebGLRenderTarget;
    lambda1: THREE.WebGLRenderTarget;
    volumeChain: THREE.WebGLRenderTarget[];
    lambdaVol: THREE.WebGLRenderTarget;
  } | null>(null);
  const vellumGradTexRef = useRef<THREE.DataTexture | null>(null);
  const vellumVolumeInfoRef = useRef<{ restVolume: number; denom: number } | null>(null);
  const vellumComponentTexRef = useRef<THREE.DataTexture | null>(null);
  const vellumComponentsRef = useRef<VellumComponent[] | null>(null);
  const rigidCellTexRef = useRef<THREE.DataTexture | null>(null);
  const rigidClusterLutTexRef = useRef<THREE.DataTexture | null>(null);
  const rigidBodyTexRef = useRef<THREE.DataTexture | null>(null);
  const rigidBodyDataRef = useRef<Float32Array | null>(null);
  const rigidSolverRef = useRef<RigidSolverState | null>(null);
  // Latest shared initial arrays (Phase W2): the main effect
  // rebuilds them on every reseed; the replica-stack effect seeds
  // the stacks from them, including when only the independent
  // toggle changed and the main effect did not rerun.
  const initDataRef = useRef<{ posData: Float32Array; velData: Float32Array } | null>(null);
  const webgpuStateRef = useRef<WebGPUComputeState | null>(null);
  const webgpuPosTexRef = useRef<THREE.DataTexture | null>(null);
  const webgpuPingIsARef = useRef(true);

  // Light position deps for the reseed effects below (Phase T):
  // masked to 0 unless the 'light' emitter is in use, so dragging
  // the light never reseeds other shapes' clouds. Extracted here
  // so the dependency arrays hold plain values.
  const lightPosDepX = config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosX : 0;
  const lightPosDepY = config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosY : 0;
  const lightPosDepZ = config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosZ : 0;

  useEffect(() => {
    if (rtRef.current) {
      rtRef.current.posA.dispose();
      rtRef.current.posB.dispose();
      rtRef.current.velA.dispose();
      rtRef.current.velB.dispose();
    }
    prevPosRTRef.current?.dispose();
    initPosTexRef.current?.dispose();
    vellumRestTexRef.current?.dispose();
    vellumRestTexRef.current = null;

    const posA = makeRT(texSize);
    const posB = makeRT(texSize);
    const velA = makeRT(texSize);
    const velB = makeRT(texSize);
    const prevPos = makeRT(texSize);
    rtRef.current = { posA, posB, velA, velB };
    prevPosRTRef.current = prevPos;
    pingIsA.current = true;

    // Vellum (Phase AR): while the constraint solver is enabled
    // the pool seeds from the structured grid bake instead of the
    // emit-shape scatter — texel adjacency has to BE the cloth
    // topology from frame 0. The bake doubles as the static rest
    // texture the projection / state passes read. Disabled, the
    // legacy initial data runs verbatim and no rest texture is
    // built (the passes never see one).
    const vellumOn = !!config.gpgpuVellumEnabled;
    const { posData, velData } = vellumOn
      ? buildVellumBakeData(texSize, config.gpgpuVellumMode, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax)
      : buildGpgpuInitialData(
        texSize,
        config.gpgpuBounceRadius,
        config.gpgpuEmitShape,
        config.gpgpuSeed,
        config.gpgpuAgeMax,
        // Replica age phase (Phase M): only while the morph replica
        // grammar is actually in play; otherwise null = legacy data.
        config.gpgpuMorphEnabled && config.gpgpuMorphReplicaCount > 1 && config.gpgpuMorphReplicaAgeStep > 0
          ? { count: config.gpgpuMorphReplicaCount, step: config.gpgpuMorphReplicaAgeStep }
          : null,
        // Light emitter (Phase T): the light position is an emitter
        // input only for the 'light' shape; every other shape ignores
        // it, so their seeded arrays stay byte-identical.
        config.gpgpuEmitShape === 'light'
          ? { lightPos: { x: config.gpgpuLightPosX, y: config.gpgpuLightPosY, z: config.gpgpuLightPosZ } }
          : null,
      );
    if (vellumOn) {
      const restTex = new THREE.DataTexture(posData.slice(), texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
      restTex.needsUpdate = true;
      vellumRestTexRef.current = restTex;
    }
    initDataRef.current = { posData, velData };
    const initTex = new THREE.DataTexture(posData.slice(), texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    initTex.needsUpdate = true;
    initPosTexRef.current = initTex;
    // Spawn order (Phase AX): bake the distance-order texture
    // from the same initial positions (near-first values in R;
    // the far-first mode inverts in the shader). Built always —
    // it is one O(N) pass — but only sampled in a distance mode.
    spawnOrderTexRef.current?.dispose();
    {
      const distValues = buildSpawnDistanceValues(posData, false);
      const orderData = new Float32Array(texSize * texSize * 4);
      for (let i = 0; i < distValues.length; i++) orderData[i * 4] = distValues[i];
      const orderTex = new THREE.DataTexture(orderData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
      orderTex.needsUpdate = true;
      spawnOrderTexRef.current = orderTex;
    }

    const copyScene = new THREE.Scene();
    const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyGeo = new THREE.PlaneGeometry(2, 2);
    const posTex = new THREE.DataTexture(posData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    const velTex = new THREE.DataTexture(velData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    posTex.needsUpdate = true;
    velTex.needsUpdate = true;
    const copyMat = new THREE.MeshBasicMaterial({ map: posTex });
    // Data copy must be an exact passthrough (2026-11-16, age-scatter
    // follow-up): with normal alpha blending the .w channel (particle
    // age, scattered in [0, ageMax)) is used as the blend factor, which
    // clamps/distorts it and re-synchronised the pool's ages. The old
    // constant age of 1 made blending an accidental identity, hiding
    // this. NoBlending copies all four channels verbatim.
    copyMat.blending = THREE.NoBlending;
    const copyMesh = new THREE.Mesh(copyGeo, copyMat);
    copyScene.add(copyMesh);
    gl.setRenderTarget(posA);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(prevPos);
    gl.render(copyScene, copyCam);
    copyMat.map = velTex;
    copyMat.needsUpdate = true;
    gl.setRenderTarget(velA);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(null);
    posTex.dispose();
    velTex.dispose();
    copyMat.dispose();
    copyGeo.dispose();

    sortRTARef.current?.dispose();
    sortRTBRef.current?.dispose();
    sortRTARef.current = makeRT(texSize);
    sortRTBRef.current = makeRT(texSize);

    // Aux event pool (B3): fixed 128x128 ping-pong pair, initialised
    // to the inactive state (age 10 >= life 0) with the same
    // DataTexture copy path as the main pool. The passes only run
    // while gpgpuAuxMode is not 'none', so an unused pool costs just
    // the four small targets.
    if (auxRtRef.current) {
      auxRtRef.current.posA.dispose();
      auxRtRef.current.posB.dispose();
      auxRtRef.current.velA.dispose();
      auxRtRef.current.velB.dispose();
    }
    const auxPosA = makeRT(AUX_TEX_SIZE);
    const auxPosB = makeRT(AUX_TEX_SIZE);
    const auxVelA = makeRT(AUX_TEX_SIZE);
    const auxVelB = makeRT(AUX_TEX_SIZE);
    auxRtRef.current = { posA: auxPosA, posB: auxPosB, velA: auxVelA, velB: auxVelB };
    auxPingIsA.current = true;
    {
      const auxCount = AUX_TEX_SIZE * AUX_TEX_SIZE;
      const auxPosData = new Float32Array(auxCount * 4);
      const auxVelData = new Float32Array(auxCount * 4);
      for (let i = 0; i < auxCount; i++) {
        auxPosData[i * 4 + 3] = 10; // age: starts past any life → inactive
        auxVelData[i * 4 + 3] = 0; // life: 0 → inactive
      }
      const auxPosTex = new THREE.DataTexture(auxPosData, AUX_TEX_SIZE, AUX_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
      const auxVelTex = new THREE.DataTexture(auxVelData, AUX_TEX_SIZE, AUX_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
      auxPosTex.needsUpdate = true;
      auxVelTex.needsUpdate = true;
      const auxCopyMat = new THREE.MeshBasicMaterial({ map: auxPosTex });
      const auxCopyMesh = new THREE.Mesh(copyGeo, auxCopyMat);
      copyScene.add(auxCopyMesh);
      gl.setRenderTarget(auxPosA);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(auxPosB);
      gl.render(copyScene, copyCam);
      auxCopyMat.map = auxVelTex;
      auxCopyMat.needsUpdate = true;
      gl.setRenderTarget(auxVelA);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(auxVelB);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(null);
      copyScene.remove(auxCopyMesh);
      auxCopyMat.dispose();
      auxPosTex.dispose();
      auxVelTex.dispose();
    }

    // Whitewater pool (Phase BC): fixed 64x64 ping-pong pair,
    // initialised to the inactive state (age 10 >= life 0) with
    // the same DataTexture copy path as the aux pool. The passes
    // only run while the whitewater key is on, so an unused pool
    // costs just the four small targets.
    if (wwRtRef.current) {
      wwRtRef.current.posA.dispose();
      wwRtRef.current.posB.dispose();
      wwRtRef.current.velA.dispose();
      wwRtRef.current.velB.dispose();
    }
    const wwPosA = makeRT(WW_TEX_SIZE);
    const wwPosB = makeRT(WW_TEX_SIZE);
    const wwVelA = makeRT(WW_TEX_SIZE);
    const wwVelB = makeRT(WW_TEX_SIZE);
    wwRtRef.current = { posA: wwPosA, posB: wwPosB, velA: wwVelA, velB: wwVelB };
    wwPingIsA.current = true;
    {
      const wwCount = WW_TEX_SIZE * WW_TEX_SIZE;
      const wwPosData = new Float32Array(wwCount * 4);
      const wwVelData = new Float32Array(wwCount * 4);
      for (let i = 0; i < wwCount; i++) {
        wwPosData[i * 4 + 3] = 10; // age: starts past any life → inactive
        wwVelData[i * 4 + 3] = 0; // life: 0 → inactive
      }
      const wwPosTex = new THREE.DataTexture(wwPosData, WW_TEX_SIZE, WW_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
      const wwVelTex = new THREE.DataTexture(wwVelData, WW_TEX_SIZE, WW_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
      wwPosTex.needsUpdate = true;
      wwVelTex.needsUpdate = true;
      const wwCopyMat = new THREE.MeshBasicMaterial({ map: wwPosTex });
      const wwCopyMesh = new THREE.Mesh(copyGeo, wwCopyMat);
      copyScene.add(wwCopyMesh);
      gl.setRenderTarget(wwPosA);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(wwPosB);
      gl.render(copyScene, copyCam);
      wwCopyMat.map = wwVelTex;
      wwCopyMat.needsUpdate = true;
      gl.setRenderTarget(wwVelA);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(wwVelB);
      gl.render(copyScene, copyCam);
      gl.setRenderTarget(null);
      copyScene.remove(wwCopyMesh);
      wwCopyMat.dispose();
      wwPosTex.dispose();
      wwVelTex.dispose();
    }

    fluidRTARef.current?.dispose();
    fluidRTBRef.current?.dispose();
    fluidRTARef.current = makeFluidRT(FLUID_SIZE);
    fluidRTBRef.current = makeFluidRT(FLUID_SIZE);
    fluidPingIsA.current = true;
    flipTransferRTRef.current?.dispose();
    flipPressureRTRef.current?.dispose();
    flipTransferRTRef.current = makeGridRT(FLUID_SIZE);
    flipPressureRTRef.current = makeGridRT(FLUID_SIZE);

    const fluidInitData = new Float32Array(FLUID_SIZE * FLUID_SIZE * 4);
    for (let fi = 0; fi < FLUID_SIZE * FLUID_SIZE; fi++) {
      const fu = (fi % FLUID_SIZE) / FLUID_SIZE - 0.5;
      const fv = Math.floor(fi / FLUID_SIZE) / FLUID_SIZE - 0.5;
      const fr = Math.sqrt(fu * fu + fv * fv) + 0.001;
      fluidInitData[fi * 4 + 0] = -fv / (fr * fr + 0.1) * 0.08;
      fluidInitData[fi * 4 + 1] = fu / (fr * fr + 0.1) * 0.08;
      fluidInitData[fi * 4 + 2] = 0;
      fluidInitData[fi * 4 + 3] = 1;
    }
    const fluidInitTex = new THREE.DataTexture(fluidInitData, FLUID_SIZE, FLUID_SIZE, THREE.RGBAFormat, THREE.FloatType);
    fluidInitTex.needsUpdate = true;
    const fluidCopyMat = new THREE.MeshBasicMaterial({ map: fluidInitTex });
    const fluidCopyMesh = new THREE.Mesh(copyGeo, fluidCopyMat);
    copyScene.add(fluidCopyMesh);
    gl.setRenderTarget(fluidRTARef.current);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(fluidRTBRef.current);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(null);
    copyScene.remove(fluidCopyMesh);
    fluidCopyMat.dispose();
    fluidInitTex.dispose();

    if (webgpuStateRef.current) {
      destroyWebGPUCompute(webgpuStateRef.current);
      webgpuStateRef.current = null;
    }
    webgpuPosTexRef.current?.dispose();
    webgpuPosTexRef.current = null;

    const wgPos = posData.slice() as Float32Array;
    const wgVel = velData.slice() as Float32Array;
    // Phase R: the WebGPU velocity pass gets the same baked morph
    // cloud as the WebGL texture path (null when morph is disabled).
    const wgMorph = buildMorphBakeData(config, texSize);
    // Phase X3: the companion normal cloud travels with the target
    // cloud so the WGSL velocity pass can run the OBJ normal kick.
    initWebGPUCompute(texSize, wgPos, wgVel, wgMorph ? wgMorph.data : null, wgMorph ? wgMorph.normalData : null).then((state) => {
      noteGpgpuBackendSettled(getSceneGeneration());
      webgpuStateRef.current = state;
      webgpuPingIsARef.current = true;
      if (state) {
        const dt = new THREE.DataTexture(
          new Float32Array(texSize * texSize * 4),
          texSize,
          texSize,
          THREE.RGBAFormat,
          THREE.FloatType,
        );
        dt.needsUpdate = true;
        webgpuPosTexRef.current = dt;
      }
    });

    return () => {
      rtRef.current?.posA.dispose();
      rtRef.current?.posB.dispose();
      rtRef.current?.velA.dispose();
      rtRef.current?.velB.dispose();
      rtRef.current = null;
      prevPosRTRef.current?.dispose();
      prevPosRTRef.current = null;
      initPosTexRef.current?.dispose();
      initPosTexRef.current = null;
      spawnOrderTexRef.current?.dispose();
      spawnOrderTexRef.current = null;
      vellumRestTexRef.current?.dispose();
      vellumRestTexRef.current = null;
      sortRTARef.current?.dispose();
      sortRTARef.current = null;
      sortRTBRef.current?.dispose();
      sortRTBRef.current = null;
      auxRtRef.current?.posA.dispose();
      auxRtRef.current?.posB.dispose();
      auxRtRef.current?.velA.dispose();
      auxRtRef.current?.velB.dispose();
      auxRtRef.current = null;
      wwRtRef.current?.posA.dispose();
      wwRtRef.current?.posB.dispose();
      wwRtRef.current?.velA.dispose();
      wwRtRef.current?.velB.dispose();
      wwRtRef.current = null;
      fluidRTARef.current?.dispose();
      fluidRTARef.current = null;
      fluidRTBRef.current?.dispose();
      fluidRTBRef.current = null;
      flipTransferRTRef.current?.dispose();
      flipTransferRTRef.current = null;
      flipPressureRTRef.current?.dispose();
      flipPressureRTRef.current = null;
      if (webgpuStateRef.current) {
        destroyWebGPUCompute(webgpuStateRef.current);
        webgpuStateRef.current = null;
      }
      webgpuPosTexRef.current?.dispose();
      webgpuPosTexRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- フィールド単位の依存が意図的: 本体は config 全体をベイク関数へ渡すが、再シード条件は列挙したベイク入力だけに限る（config 全体を依存に入れると全ての設定変更でプールが再シードされる）
  }, [texSize, gl, config.gpgpuEmitShape, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax, config.gpgpuMorphEnabled, config.gpgpuMorphReplicaCount, config.gpgpuMorphReplicaAgeStep,
    // Vellum (Phase AR): toggling the solver or its shape reseeds
    // the pool from the grid bake (the "reset = re-bake" rule).
    config.gpgpuVellumEnabled, config.gpgpuVellumMode,
    lightPosDepX, lightPosDepY, lightPosDepZ]);

  // Aux chain pools (Phase W1): allocated only while the configured
  // chain depth reaches them — depth 1 (the default) allocates
  // nothing, depth 2 adds one pool, depth 3 two. Kept out of the
  // main runtime effect so raising the depth never reseeds the main
  // pool; a fresh chain pool simply starts fully inactive.
  const auxDepth = clampAuxDepth(config.gpgpuAuxDepth);
  useEffect(() => {
    disposeAuxPool(aux2RtRef.current);
    disposeAuxPool(aux3RtRef.current);
    aux2RtRef.current = auxDepth >= 2 ? createInitializedAuxPool(gl) : null;
    aux3RtRef.current = auxDepth >= 3 ? createInitializedAuxPool(gl) : null;
    aux2PingIsA.current = true;
    aux3PingIsA.current = true;
    return () => {
      disposeAuxPool(aux2RtRef.current);
      aux2RtRef.current = null;
      disposeAuxPool(aux3RtRef.current);
      aux3RtRef.current = null;
    };
  }, [gl, auxDepth]);

  // Pyro grid (Phase CA): the target set exists only while the
  // grid key is on AND the diagnostics gate has confirmed float
  // render targets — a dedicated effect in the aux-pool pattern,
  // so toggling the key never reseeds the main pool, and while
  // diagnostics are still unknown (or float targets unsupported)
  // nothing is allocated and the solver passes no-op. Resolution
  // follows the GPU tier unless the manual override applies.
  const [pyroSupport, setPyroSupport] = useState<PyroGridSupport>(() => getPyroGridSupport());
  useEffect(() => {
    if (!config.gpgpuPyroGridEnabled) return;
    ensurePyroGridSupport();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部診断ストアとの同期: 購読開始前に現在値を取り込む必要がある（初期値も同じストアから読んでいる）
    setPyroSupport(getPyroGridSupport());
    return subscribePyroGridSupport(() => setPyroSupport(getPyroGridSupport()));
  }, [config.gpgpuPyroGridEnabled]);
  const pyroResolution = config.gpgpuPyroGridEnabled
    && pyroSupport.status === 'ready'
    && pyroSupport.colorBufferFloat
    ? resolvePyroGridResolution(resolveEffectiveTierSync(), config.gpgpuPyroGridResolution)
    : 0;
  useEffect(() => {
    disposePyroGridTargets(pyroGridRef.current);
    pyroGridRef.current = null;
    if (!pyroResolution) return;
    pyroGridRef.current = createPyroGridTargets(gl, pyroResolution, pyroSupport.floatLinearFiltering);
    return () => {
      disposePyroGridTargets(pyroGridRef.current);
      pyroGridRef.current = null;
    };
  }, [gl, pyroResolution, pyroSupport.floatLinearFiltering]);

  // FLIP 3D (Phase 19 stage 2): the target set exists only
  // while the FLIP mode is '3d' (with the FLIP layer and the
  // fluid field on) AND float render targets are confirmed —
  // the same support store the Pyro grid uses (it is a generic
  // float-target probe). At the default mode '2d' nothing is
  // allocated and no 3D pass can run: that is the structural
  // half of the bit-identity guarantee.
  const flip3dOn = flip3dActive(config);
  useEffect(() => {
    if (!flip3dOn) return;
    ensurePyroGridSupport();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部診断ストアとの同期: 購読開始前に現在値を取り込む必要がある（初期値も同じストアから読んでいる）
    setPyroSupport(getPyroGridSupport());
    return subscribePyroGridSupport(() => setPyroSupport(getPyroGridSupport()));
  }, [flip3dOn]);
  const flip3dResolution = flip3dOn
    && pyroSupport.status === 'ready'
    && pyroSupport.colorBufferFloat
    ? resolveFlip3dResolution(resolveEffectiveTierSync(), config.gpgpuFlip3dResolution)
    : 0;
  useEffect(() => {
    disposeFlip3dTargets(flip3dRef.current);
    flip3dRef.current = null;
    if (!flip3dResolution) return;
    flip3dRef.current = createFlip3dTargets(gl, flip3dResolution, pyroSupport.floatLinearFiltering);
    return () => {
      disposeFlip3dTargets(flip3dRef.current);
      flip3dRef.current = null;
    };
  }, [gl, flip3dResolution, pyroSupport.floatLinearFiltering]);

  // Grains cell sort (Phase 19 fix2): the ping-pong pair the
  // spatial cell index is built into exists only while the
  // complete neighbourhood runs through the sort (Grains on
  // AND neighbourhood mode 1) — at mode 0 nothing is allocated
  // and no sort pass can run: the structural half of the
  // identity guarantee, the same discipline as the FLIP 3D
  // targets above. The passes rebuild the index from the
  // frame-start positions every frame while the pair exists.
  const grainsCellOn = grainsCellSortActive(config);
  useEffect(() => {
    grainsSortRTARef.current?.dispose();
    grainsSortRTARef.current = null;
    grainsSortRTBRef.current?.dispose();
    grainsSortRTBRef.current = null;
    if (!grainsCellOn) return;
    grainsSortRTARef.current = makeRT(texSize);
    grainsSortRTBRef.current = makeRT(texSize);
    return () => {
      grainsSortRTARef.current?.dispose();
      grainsSortRTARef.current = null;
      grainsSortRTBRef.current?.dispose();
      grainsSortRTBRef.current = null;
    };
  }, [gl, texSize, grainsCellOn]);

  // Vellum tear state pool (Phase AR): a texSize ping-pong pair
  // holding link survival (.r = right link, .g = up link) and,
  // since Phase BB, glue survival (.b) — allocated only while a
  // severing rule is live (tear, or glue with a break
  // threshold) — in a dedicated effect like the aux chain
  // pools, so toggling a rule never reseeds the main pool. Both
  // targets start fully alive (1,1,1,1); the state pass only
  // ever clears bits, and a re-bake (any bake input changing)
  // reallocates and resets.
  const tearOn = vellumStatePoolActive(config);
  useEffect(() => {
    if (vellumStateRtRef.current) {
      vellumStateRtRef.current.a.dispose();
      vellumStateRtRef.current.b.dispose();
      vellumStateRtRef.current = null;
    }
    vellumStatePingIsA.current = true;
    if (!tearOn) return;
    const a = makeRT(texSize);
    const b = makeRT(texSize);
    vellumStateRtRef.current = { a, b };
    const alive = new Float32Array(texSize * texSize * 4).fill(1);
    const aliveTex = new THREE.DataTexture(alive, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    aliveTex.needsUpdate = true;
    const copyScene = new THREE.Scene();
    const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyMat = new THREE.MeshBasicMaterial({ map: aliveTex });
    copyMat.blending = THREE.NoBlending;
    const copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    copyScene.add(copyMesh);
    gl.setRenderTarget(a);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(b);
    gl.render(copyScene, copyCam);
    gl.setRenderTarget(null);
    aliveTex.dispose();
    copyMat.dispose();
    copyMesh.geometry.dispose();
    return () => {
      vellumStateRtRef.current?.a.dispose();
      vellumStateRtRef.current?.b.dispose();
      vellumStateRtRef.current = null;
    };
  }, [gl, texSize, tearOn, config.gpgpuVellumMode, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuCount]);

  // Vellum XPBD pool (Phase 19 stage 3): λ pair + volume
  // reduction chain (texSize/2 … 1) + the 1×1 volume-λ target
  // + the component-label texture, allocated only while the
  // solver runs in xpbd mode — in a dedicated effect like the
  // tear pool, so flipping the mode never reseeds the main
  // pool. The component texture starts at label 0 everywhere;
  // the scene loop refreshes it from throttled state readbacks
  // (labelVellumComponents) while a tear rule is live.
  const xpbdOn = vellumXpbdPoolActive(config);
  useEffect(() => {
    if (vellumXpbdRtRef.current) {
      vellumXpbdRtRef.current.lambda0.dispose();
      vellumXpbdRtRef.current.lambda1.dispose();
      for (const rt of vellumXpbdRtRef.current.volumeChain) rt.dispose();
      vellumXpbdRtRef.current.lambdaVol.dispose();
      vellumXpbdRtRef.current = null;
    }
    vellumComponentTexRef.current?.dispose();
    vellumComponentTexRef.current = null;
    vellumComponentsRef.current = null;
    if (!xpbdOn) return;
    const chain: THREE.WebGLRenderTarget[] = [];
    for (let size = Math.max(1, texSize >> 1); ; size >>= 1) {
      chain.push(makeRT(size));
      if (size <= 1) break;
    }
    vellumXpbdRtRef.current = {
      lambda0: makeRT(texSize),
      lambda1: makeRT(texSize),
      volumeChain: chain,
      lambdaVol: makeRT(1),
    };
    const compData = new Float32Array(texSize * texSize * 4);
    const compTex = new THREE.DataTexture(compData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    compTex.needsUpdate = true;
    vellumComponentTexRef.current = compTex;
    return () => {
      if (vellumXpbdRtRef.current) {
        vellumXpbdRtRef.current.lambda0.dispose();
        vellumXpbdRtRef.current.lambda1.dispose();
        for (const rt of vellumXpbdRtRef.current.volumeChain) rt.dispose();
        vellumXpbdRtRef.current.lambdaVol.dispose();
        vellumXpbdRtRef.current = null;
      }
      vellumComponentTexRef.current?.dispose();
      vellumComponentTexRef.current = null;
      vellumComponentsRef.current = null;
    };
  }, [gl, texSize, xpbdOn]);

  // Vellum volume gradient texture (Phase 19 stage 3): the
  // rest-shape gradient weights ∇C_i and the denominator,
  // baked from the same deterministic bake the rest texture
  // uses (identical inputs → identical positions). Exists only
  // while the volume constraint can engage (xpbd + shell +
  // volume key); solverMode is NOT a bake input anywhere else.
  const volumeOn = vellumVolumeActive(config);
  useEffect(() => {
    vellumGradTexRef.current?.dispose();
    vellumGradTexRef.current = null;
    vellumVolumeInfoRef.current = null;
    if (!volumeOn) return;
    const { posData } = buildVellumBakeData(texSize, config.gpgpuVellumMode, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax);
    const grad = buildVellumVolumeGradientData(posData, texSize);
    const gradTex = new THREE.DataTexture(grad.gradData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    gradTex.needsUpdate = true;
    vellumGradTexRef.current = gradTex;
    vellumVolumeInfoRef.current = { restVolume: grad.restVolume, denom: grad.denom };
    return () => {
      vellumGradTexRef.current?.dispose();
      vellumGradTexRef.current = null;
      vellumVolumeInfoRef.current = null;
    };
  }, [gl, texSize, volumeOn, config.gpgpuVellumMode, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax]);

  // Replica simulation stacks (Phase W2): allocated only while
  // the independent sim is active (key on + morph on + count > 1),
  // in a dedicated effect — exactly like the aux chain pools — so
  // toggling the key never reseeds the main pool. The stacks seed
  // from the latest shared initial arrays; when a main-pool
  // reseed input changes, this effect reruns after the main
  // effect (declaration order) and reseeds the stacks from the
  // fresh arrays. While the stacks run, the main pool's targets
  // hold the merged layout the consumers read, so toggling the
  // key off resumes the shared sim from the merged state.
  // Vellum (Phase AR) suppresses the replica stacks outright,
  // and FLIP (Phase AT) does the same (its P2G splat reads the
  // shared pool's frame-start textures):
  // the stacks are a morph-grammar construct and the constraint
  // grid must own the whole pool layout (the passes additionally
  // resolve morph attraction off while the solver is active).
  const replicaStacksActive = resolveReplicaIndependentActive(config) && !config.gpgpuVellumEnabled && !config.gpgpuFlipEnabled && !config.gpgpuRigidEnabled;
  const replicaStackCount = replicaStacksActive
    ? Math.max(1, Math.min(8, Math.round(config.gpgpuMorphReplicaCount)))
    : 0;
  useEffect(() => {
    disposeReplicaStacks(replicaStacksRef.current);
    replicaStacksRef.current = null;
    if (!replicaStacksActive || !initDataRef.current) return;
    replicaStacksRef.current = createReplicaStacks(
      gl,
      texSize,
      config,
      initDataRef.current.posData,
      initDataRef.current.velData,
    );
    return () => {
      disposeReplicaStacks(replicaStacksRef.current);
      replicaStacksRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gl,
    texSize,
    replicaStacksActive,
    replicaStackCount,
    config.gpgpuEmitShape,
    config.gpgpuBounceRadius,
    config.gpgpuSeed,
    config.gpgpuAgeMax,
    config.gpgpuMorphReplicaAgeStep,
    lightPosDepX,
    lightPosDepY,
    lightPosDepZ,
  ]);

  // Morph target texture (Kinetix integration B1a): the per-particle
  // target cloud is baked on the CPU (deterministic, seeded) and rebuilt
  // only when its inputs change. text reuses the layer TextMap renderer
  // (extractTextLumaMap with layer 2's text settings); image reuses the
  // media luma map the user loaded for layer 2. When morph is disabled
  // no texture exists and the velocity shader skips the force entirely,
  // leaving the stock behaviour bit-identical.
  const morphEnabled = config.gpgpuMorphEnabled;
  // Rigid bodies (Phase AU): the solver's build rides the morph
  // bake, so its switches are bake inputs here.
  const rigidEnabled = config.gpgpuRigidEnabled;
  const rigidGlueEnabled = config.gpgpuRigidGlueEnabled;
  const rigidStartSleeping = config.gpgpuRigidStartSleeping;
  // Phase 20 stage 1: joints and OBB shapes are build-time
  // solver state too, so their keys are bake inputs as well.
  const rigidJointEnabled = config.gpgpuRigidJointEnabled;
  const rigidJointCompliance = config.gpgpuRigidJointCompliance;
  const rigidJointBreakThreshold = config.gpgpuRigidJointBreakThreshold;
  const rigidConvexEnabled = config.gpgpuRigidConvexEnabled;
  // Fragment restore + cluster colouring (Phase 20 stage 1):
  // both ride the bake (the restore assignment drives it; the
  // cluster LUT derives from its cell table), so their keys and
  // the saved collection text are bake inputs too.
  const rigidClusterColorEnabled = config.gpgpuRigidClusterColorEnabled;
  const fragmentRestoreEnabled = config.gpgpuFragmentCollectionRestoreEnabled;
  const fragmentCollectionJson = config.gpgpuFragmentCollectionJson;
  const morphFractureEnabled = config.gpgpuMorphFractureEnabled;
  const morphFractureCells = config.gpgpuMorphFractureCells;
  const morphFractureSeed = config.gpgpuMorphFractureSeed;
  const morphFractureGap = config.gpgpuMorphFractureGap;
  const morphTarget = config.gpgpuMorphTarget;
  const morphScale = config.gpgpuMorphScale;
  const morphJitter = config.gpgpuMorphJitter;
  const morphSeed = config.gpgpuSeed;
  const morphBounceRadius = config.gpgpuBounceRadius;
  const morphText = config.layer2TextMapText;
  const morphTextFont = config.layer2TextMapFontFamily;
  const morphTextWeight = config.layer2TextMapWeight;
  const morphTextSize = config.layer2TextMapSize;
  const morphTextPadding = config.layer2TextMapPadding;
  const morphTextInvert = config.layer2TextMapInvert;
  // Vertical text layout (Phase BG): bake inputs of the 'text'
  // morph target, captured like the other TextMap settings.
  const morphTextVertical = config.layer2TextMapVertical;
  const morphTextColumnLength = config.layer2TextMapColumnLength;
  const morphTextColumnGap = config.layer2TextMapColumnGap;
  const morphTextLetterSpacing = config.layer2TextMapLetterSpacing;
  // Vertical text finishing (Phase BK): bake inputs like the BG
  // fields above — toggling either re-bakes the 'text' target.
  const morphTextKinsoku = config.layer2TextMapKinsoku;
  const morphTextYakumono = config.layer2TextMapYakumono;
  // Vertical text finishing (Phase BP): bake inputs like the BK
  // fields above — toggling either re-bakes the 'text' target.
  const morphTextTateChuYoko = config.layer2TextMapTateChuYoko;
  const morphTextRuby = config.layer2TextMapRuby;
  // Text pages (Phase 17): bake inputs like the BP fields above —
  // changing the page re-bakes the 'text' target.
  const morphTextPageEnabled = config.layer2TextMapPageEnabled;
  const morphTextColumnBalance = config.layer2TextMapColumnBalance;
  const morphTextPageIndex = config.layer2TextMapPageIndex;
  const morphNoiseMapEnabled = config.gpgpuMorphNoiseMapEnabled;
  // The bake reads the noise field's static slice while the
  // supply is on, so the field settings join the rebake deps
  // through their cache key (Phase 15 gate fix: this effect had
  // no noise branch at all — the shared builder had it, this
  // primary WebGL effect did not, and the gate's OFF/ON captures
  // came back pixel-identical).
  const morphNoiseSignature = morphNoiseMapEnabled
    ? noiseFieldCacheKey(noiseFieldSettingsFromConfig(config))
    : '';
  const morphMediaMap = config.layer2MediaLumaMap;
  const morphMediaWidth = config.layer2MediaMapWidth;
  const morphMediaHeight = config.layer2MediaMapHeight;
  const morphSvgSource = config.gpgpuMorphSvgSource;
  const morphObjSource = config.gpgpuMorphObjSource;
  const morphObjSampleMode = config.gpgpuMorphObjSampleMode;
  const morphReplicaCount = config.gpgpuMorphReplicaCount;
  const morphReplicaSpacing = config.gpgpuMorphReplicaSpacing;
  const morphReplicaAxis = config.gpgpuMorphReplicaAxis;
  const morphReplicaRotation = config.gpgpuMorphReplicaRotation;
  const morphReplicaScaleStep = config.gpgpuMorphReplicaScaleStep;
  const morphReplicaPhaseStep = config.gpgpuMorphReplicaPhaseStep;
  const morphTerrainAmplitude = config.gpgpuMorphTerrainAmplitude;
  const morphTerrainFrequency = config.gpgpuMorphTerrainFrequency;
  const morphTerrainOctaves = config.gpgpuMorphTerrainOctaves;
  const morphTerrainSeed = config.gpgpuMorphTerrainSeed;
  // Terrain recipes + scatter grammar (Phase AI).
  const morphTerrainKind = config.gpgpuMorphTerrainKind;
  const morphTerrainTerraceSteps = config.gpgpuMorphTerrainTerraceSteps;
  // Terrain erosion (Phase AP) + its plane-mode gate.
  const morphTerrainErosionWater = config.gpgpuMorphTerrainErosionWater;
  const morphTerrainErosionDroplets = config.gpgpuMorphTerrainErosionDroplets;
  const morphTerrainErosionDeposit = config.gpgpuMorphTerrainErosionDeposit;
  const morphTerrainErosionThermal = config.gpgpuMorphTerrainErosionThermal;
  const morphTerrainErosionTalus = config.gpgpuMorphTerrainErosionTalus;
  const morphTerrainErosionThermalPasses = config.gpgpuMorphTerrainErosionThermalPasses;
  const morphTerrainErosionSeed = config.gpgpuMorphTerrainErosionSeed;
  // Erosion mask (Phase 20 stage 3).
  const morphTerrainErosionMaskMode = config.gpgpuMorphTerrainErosionMaskMode;
  const morphTerrainErosionMaskStrength = config.gpgpuMorphTerrainErosionMaskStrength;
  const morphTerrainErosionMaskInvert = config.gpgpuMorphTerrainErosionMaskInvert;
  const morphTerrainErosionMaskLow = config.gpgpuMorphTerrainErosionMaskLow;
  const morphTerrainErosionMaskHigh = config.gpgpuMorphTerrainErosionMaskHigh;
  // Debounce (Phase 20 stage 3): the morph rebake runs the
  // erosion sim synchronously, so ONLY the erosion parameters
  // (mask included) settle for a quiet period before a slider
  // drag rebakes. Every other bake input stays immediate, and
  // the settled values below are what the bake effect reads
  // and depends on.
  const morphTerrainErosionSettled = useDebouncedValue(
    {
      water: morphTerrainErosionWater,
      droplets: morphTerrainErosionDroplets,
      deposit: morphTerrainErosionDeposit,
      thermal: morphTerrainErosionThermal,
      talus: morphTerrainErosionTalus,
      thermalPasses: morphTerrainErosionThermalPasses,
      seed: morphTerrainErosionSeed,
      mask: {
        mode: morphTerrainErosionMaskMode,
        strength: morphTerrainErosionMaskStrength,
        invert: morphTerrainErosionMaskInvert,
        low: morphTerrainErosionMaskLow,
        high: morphTerrainErosionMaskHigh,
      },
    },
    TERRAIN_EROSION_DEBOUNCE_MS,
    (e) => JSON.stringify(e),
  );
  const morphTerrainTunnel = config.gpgpuTerrainMeshTunnel;
  const morphScatterEnabled = config.gpgpuMorphScatterEnabled;
  const morphScatterDensity = config.gpgpuMorphScatterDensity;
  const morphScatterHeightMin = config.gpgpuMorphScatterHeightMin;
  const morphScatterHeightMax = config.gpgpuMorphScatterHeightMax;
  const morphScatterSlopeMax = config.gpgpuMorphScatterSlopeMax;
  const morphScatterAlignNormal = config.gpgpuMorphScatterAlignNormal;
  const morphScatterSpecies = config.gpgpuMorphScatterSpecies;
  // Scatter finishing (Phase AX).
  const morphScatterScaleRandom = config.gpgpuMorphScatterScaleRandom;
  const morphScatterRotRandom = config.gpgpuMorphScatterRotRandom;
  const morphScatterBend = config.gpgpuMorphScatterBend;
  // PCG rule graph (Phase 18 stage 3): bake inputs like the above.
  const morphPcgGraphEnabled = config.gpgpuPcgGraphEnabled;
  const morphPcgGraphData = config.gpgpuPcgGraphData;
  const morphPathMode = config.gpgpuMorphPathMode;
  const morphTextOnPathEnabled = config.gpgpuMorphTextOnPathEnabled;
  const morphTextOnPathDelay = config.gpgpuMorphTextOnPathDelay;
  const morphTextOnPathSize = config.gpgpuMorphTextOnPathSize;
  // Vertical text on path (Phase 17): a bake input like the
  // switches above — toggling it re-bakes the path text.
  const morphTextOnPathVertical = config.gpgpuMorphTextOnPathVertical;
  const morphPathWriteOnStart = config.gpgpuMorphPathWriteOnStart;
  const morphPathWriteOnEnd = config.gpgpuMorphPathWriteOnEnd;
  const morphPathTaper = config.gpgpuMorphPathTaper;
  const morphPathTaperShape = config.gpgpuMorphPathTaperShape;
  const morphPathSubpathMode = config.gpgpuMorphPathSubpathMode;
  const morphStampSpacing = config.gpgpuMorphStampSpacing;
  const morphStampSize = config.gpgpuMorphStampSize;
  const morphStampShape = config.gpgpuMorphStampShape;
  const morphStampAlign = config.gpgpuMorphStampAlign;
  // Path offset / glyph deform / contour (Phase AM).
  const morphPathOffset = config.gpgpuMorphPathOffset;
  const morphGlyphScale = config.gpgpuMorphTextOnPathGlyphScale;
  const morphGlyphRotate = config.gpgpuMorphTextOnPathGlyphRotate;
  const morphGlyphFade = config.gpgpuMorphTextOnPathGlyphFade;
  const morphContourSource = config.gpgpuMorphContourSource;
  const morphContourThreshold = config.gpgpuMorphContourThreshold;
  // Polygon sides / path jitter (Phase AW).
  const morphPolygonSides = config.gpgpuMorphPolygonSides;
  const morphPathJitter = config.layer1LineJitterPaths ? config.layer1LineJitter : 0;
  const morphDisperseAmount = config.gpgpuMorphDisperseAmount;
  const morphDisperseDirection = config.gpgpuMorphDisperseDirection;
  const morphTwistAmount = config.gpgpuMorphTwistAmount;
  const morphTwistAxis = config.gpgpuMorphTwistAxis;
  const morphFractalAmount = config.gpgpuMorphFractalAmount;
  const morphFractalFrequency = config.gpgpuMorphFractalFrequency;
  const morphFractalEvolution = config.gpgpuMorphFractalEvolution;
  const morphMaskMode = config.gpgpuMaskMode;
  const morphMaskMap = config.gpgpuMaskMap;
  const morphMaskWidth = config.gpgpuMaskMapWidth;
  const morphMaskHeight = config.gpgpuMaskMapHeight;
  const morphMaskThreshold = config.gpgpuMaskThreshold;
  const morphMaskInvert = config.gpgpuMaskInvert;
  const attrCloudVersion = attrCloud?.version ?? 0;
  useEffect(() => {
    morphTexRef.current?.dispose();
    morphTexRef.current = null;
    morphNormalTexRef.current?.dispose();
    morphNormalTexRef.current = null;
    if (!morphEnabled) return;
    let mediaMap: MorphMediaMap | null = null;
    if (morphTarget === 'text') {
      const map = extractTextLumaMap(
        morphText,
        128,
        128,
        morphTextFont,
        morphTextWeight,
        morphTextSize,
        morphTextPadding,
        morphTextInvert,
        {
          vertical: morphTextVertical,
          columnLength: morphTextColumnLength,
          columnGap: morphTextColumnGap,
          letterSpacing: morphTextLetterSpacing,
          kinsoku: morphTextKinsoku,
          yakumono: morphTextYakumono,
          tatechuyoko: morphTextTateChuYoko,
          ruby: morphTextRuby,
          pageEnabled: morphTextPageEnabled,
          columnBalance: morphTextColumnBalance,
          pageIndex: morphTextPageIndex,
        },
      );
      mediaMap = { map, width: 128, height: 128 };
    } else if (morphTarget === 'image' && morphNoiseMapEnabled) {
      // Phase 15 (TD §1): mirror of buildMorphBakeData — the
      // noise field's static slice supplies the bake, taking
      // precedence over a registered media map when enabled.
      mediaMap = { map: getNoiseFieldLuma(config, 128), width: 128, height: 128 };
    } else if (morphTarget === 'image' && morphMediaMap.length > 0 && morphMediaWidth > 0 && morphMediaHeight > 0) {
      mediaMap = { map: morphMediaMap, width: morphMediaWidth, height: morphMediaHeight };
    }
    // svg (Pro-2): re-sample the imported SVG source text into its
    // outline point cloud; null (no usable geometry) falls back to the
    // shell inside the bake, exactly like a missing media map.
    const svgPoints = morphTarget === 'svg' ? sampleSvgPointCloud(morphSvgSource) : null;
    // Path geometry (Phase S): parsed only when a path mode is on;
    // mode 'off' never reaches the path branch inside the bake.
    const pathGeometry = morphTarget === 'svg' && morphPathMode !== 'off'
      ? parseSvgPathGeometry(morphSvgSource)
      : null;
    // Text on path (Phase AF2): same shared builder the WebGPU
    // bake builder uses, from this effect's captured values.
    const textOnPath = buildTextOnPathOption({
      target: morphTarget,
      enabled: morphTextOnPathEnabled,
      pathMode: morphPathMode,
      text: morphText,
      fontFamily: morphTextFont,
      weight: morphTextWeight,
      size: morphTextSize,
      padding: morphTextPadding,
      invert: morphTextInvert,
      delay: morphTextOnPathDelay,
      glyphSize: morphTextOnPathSize,
      glyphScale: morphGlyphScale,
      glyphRotate: morphGlyphRotate,
      glyphFade: morphGlyphFade,
      // Vertical text on path (Phase 17): same shared builder
      // inputs as the WebGPU path above.
      vertical: morphTextOnPathVertical,
      columnLength: morphTextColumnLength,
      adjustments: {
        kinsoku: morphTextKinsoku,
        tatechuyoko: morphTextTateChuYoko,
        ruby: morphTextRuby,
      },
    });
    // Contour target (Phase AM): the shared builder reads the
    // live config; the captured contour source / threshold are
    // in this effect's dependency list, so a change re-runs the
    // bake exactly like the other option builders.
    const contourGeometry = buildContourGeometryOption(config);
    // obj (Phase J, modes + normals in Phase O): re-sample the
    // imported OBJ source text in the selected mode; null (no usable
    // geometry) falls back to the shell inside the bake, exactly like
    // a missing media map. The 'surface' mode's points are
    // bit-identical to the Phase J sampler; the parallel normal cloud
    // feeds the companion normal texture below.
    const objSample = morphTarget === 'obj'
      || (morphTarget === 'svg' && morphPathMode === 'stamp' && morphStampShape === 'obj')
      ? sampleObjPointCloudWithNormals(morphObjSource, morphObjSampleMode) : null;
    const objPoints = objSample ? objSample.points : null;
    const objNormals = objSample ? objSample.normals : null;
    // Fragment restore (Phase 20 stage 1): the triple gate —
    // restore key on (this block), rigid solver on (rigidEnabled
    // gates the resolution), exact signature match (owned by
    // resolveFragmentRestore against the signature THIS bake
    // will publish). A rejection is kept as an explicit status
    // and published with the bake so the panel can show why;
    // the bake itself then runs the legacy sites division.
    const bakeSignature = (() => {
      const rf = rigidFractureOptionFromConfig(config);
      return {
        sourceTarget: morphTarget,
        particleCount: texSize * texSize,
        cells: rf.cells,
        fractureSeed: rf.seed,
        gap: rf.gap,
      };
    })();
    const fragmentRestoreGate = resolveFragmentRestoreGate({
      restoreEnabled: fragmentRestoreEnabled,
      rigidEnabled,
      savedJson: fragmentCollectionJson,
      signature: bakeSignature,
    });
    const fragmentRestoreAssignment = fragmentRestoreGate.assignment;
    const { data, normalData, fractureCells, speciesData, fragmentRestoreApplied } = buildGpgpuMorphTargetDataWithNormals({
      texSize,
      target: morphTarget,
      worldScale: morphScale * morphBounceRadius * 0.48,
      jitter: morphJitter,
      seed: morphSeed,
      mediaMap,
      svgPoints,
      pathGeometry,
      path: {
        mode: morphPathMode,
        writeOnStart: morphPathWriteOnStart,
        writeOnEnd: morphPathWriteOnEnd,
        taper: morphPathTaper,
        taperShape: morphPathTaperShape,
        subpathMode: morphPathSubpathMode,
        stampSpacing: morphStampSpacing,
        stampSize: morphStampSize,
        stampShape: morphStampShape,
        stampAlign: morphStampAlign,
        // Path offset (Phase AM): 0 = the authored geometry.
        offset: morphPathOffset,
      },
      textOnPath,
      contourGeometry,
      // Polygon target + path jitter (Phase AW).
      polygonSides: morphPolygonSides,
      pathJitter: morphPathJitter,
      // Voronoi fracture (Phase AG): same shared option builder
      // as the WebGPU bake (buildMorphBakeData above).
      fracture: fractureOptionFromConfig(config),
      // Rigid bodies (Phase AU): while the solver is enabled the
      // bake also yields the fracture cell table the CPU solver
      // binds to (division from the fracture keys; gap follows
      // the fracture's own enable, so the offsets match the
      // produced cloud). Null while disabled — no cell data is
      // computed and the bake is untouched.
      rigidFracture: rigidEnabled ? rigidFractureOptionFromConfig(config) : null,
      // Fragment restore (Phase 20 stage 1): the resolved saved
      // assignment, or null (legacy sites division, bit-identical).
      fragmentRestore: fragmentRestoreAssignment ? { assignment: fragmentRestoreAssignment } : null,
      form: {
        disperseAmount: morphDisperseAmount,
        disperseDirection: morphDisperseDirection,
        twistAmount: morphTwistAmount,
        twistAxis: morphTwistAxis,
        fractalAmount: morphFractalAmount,
        fractalFrequency: morphFractalFrequency,
        fractalEvolution: morphFractalEvolution,
      },
      objPoints,
      objNormals,
      // Replica grammar (Phase K): count 1 reproduces the legacy
      // bake exactly; higher counts split the same point budget into
      // offset copies (see lib/gpgpuMorphTargets.ts).
      replica: {
        count: morphReplicaCount,
        spacing: morphReplicaSpacing,
        axis: morphReplicaAxis,
        rotationDeg: morphReplicaRotation,
        scaleStep: morphReplicaScaleStep,
        phaseStepDeg: morphReplicaPhaseStep,
      },
      // Terrain (Phase L): only read by the bake when the target is
      // 'terrain'; the field is a pure function of these + the seed.
      terrain: {
        amplitude: morphTerrainAmplitude,
        frequency: morphTerrainFrequency,
        octaves: morphTerrainOctaves,
        seed: morphTerrainSeed,
        // Terrain recipes (Phase AI): 'fbm' is the legacy field.
        kind: morphTerrainKind,
        terraceSteps: morphTerrainTerraceSteps,
        // Terrain erosion (Phase AP): stripped in tunnel mode.
        // Phase 20 stage 3: the debounced (settled) values.
        erosion: morphTerrainTunnel ? undefined : morphTerrainErosionSettled,
      },
      // Terrain scatter grammar (Phase AI): top-level bake
      // option, same assembly as the shared builder above.
      scatter: morphScatterEnabled ? {
        density: morphScatterDensity,
        heightMin: morphScatterHeightMin,
        heightMax: morphScatterHeightMax,
        slopeMax: morphScatterSlopeMax,
        alignNormal: morphScatterAlignNormal,
        species: morphScatterSpecies,
        scaleRandom: morphScatterScaleRandom,
        rotRandom: morphScatterRotRandom,
        bend: morphScatterBend,
        pcgGraphEnabled: morphPcgGraphEnabled,
        pcgGraphData: morphPcgGraphData,
      } : null,
      // Raster mask (Phase X): same option the shared bake builder
      // assembles, from the effect's own captured values.
      mask: morphMaskMode !== 'off' && morphMaskMap.length > 0 && morphMaskWidth > 0 && morphMaskHeight > 0
        ? {
          map: { map: morphMaskMap, width: morphMaskWidth, height: morphMaskHeight },
          mode: morphMaskMode,
          threshold: morphMaskThreshold,
          invert: morphMaskInvert,
        }
        : null,
      // Attribute point cloud (Phase AK): same store read the
      // shared builder performs; the cloud version is in this
      // effect's deps so registering a cloud re-bakes the target.
      dataPoints: morphTarget === 'data'
        ? getAttrPointCloud()?.unitPositions ?? null
        : null,
    });
    // Fragment collection (Phase 17 stage 4): publish this bake's
    // cell table so the panel can save the current division as a
    // named asset. Write-only metadata — nothing in the bake, the
    // solver or the renderer reads it back, so an unsaved /
    // unused collection leaves every routing untouched.
    if (fractureCells) {
      // Fragment restore (Phase 20 stage 1): while the restore
      // key was on for this bake, publish the outcome with the
      // bake — applied only when the builder confirms the
      // assignment actually drove the division; a resolution
      // that passed but could not be applied is reported as a
      // rejection, never silently.
      let restoreStatus: FragmentRestoreStatus | undefined;
      if (fragmentRestoreGate.status) {
        if (fragmentRestoreApplied) {
          restoreStatus = { state: 'applied' };
        } else if (fragmentRestoreGate.status.state === 'rejected') {
          restoreStatus = fragmentRestoreGate.status;
        } else {
          // The gate passed the assignment but the builder
          // could not drive the division with it — reported,
          // never silent.
          restoreStatus = {
            state: 'rejected',
            reason: 'assignment-undecodable',
            detail: 'saved assignment could not be applied to this bake',
          };
        }
      }
      publishFragmentBake({
        cellData: fractureCells,
        signature: bakeSignature,
        restore: restoreStatus,
      });
    }
    // Species channel (Phase 16 stage 5): same publish as the
    // shared builder — the foliage split reads this bake.
    setBakedSpeciesData(
      speciesData,
      texSize,
      morphScatterEnabled
        ? Math.max(1, Math.min(4, Math.floor(morphScatterSpecies) || 1))
        : 1,
    );
    const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    morphTexRef.current = tex;
    // Phase R: keep the WebGPU morph buffer in sync with the bake.
    // (If the WebGPU state does not exist yet, its init path bakes
    // the same data itself via buildMorphBakeData.)
    if (webgpuStateRef.current) {
      updateWebGPUMorphData(webgpuStateRef.current, data);
      // Phase X3: the companion normals are rebuilt by the same
      // bake, so they are pushed to the WGSL pass alongside.
      updateWebGPUMorphNormalData(webgpuStateRef.current, normalData);
    }
    // Companion normal texture (Phase O): same texel layout as the
    // morph target texture; xyz is a unit direction (not scaled).
    const normalTex = new THREE.DataTexture(normalData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    normalTex.needsUpdate = true;
    morphNormalTexRef.current = normalTex;
    // Rigid bodies (Phase AU): build the solver + supply
    // textures from the bake's cell table. Rebuilt with every
    // bake (the "reset = re-bake" rule the Vellum grid follows),
    // so the solver's initial placement is always the current
    // cloud. Absent cell data (solver off) leaves all refs null.
    let rigidCellTex: THREE.DataTexture | null = null;
    let rigidBodyTex: THREE.DataTexture | null = null;
    let rigidClusterLutTex: THREE.DataTexture | null = null;
    if (rigidEnabled && fractureCells) {
      const cellData = new Float32Array(texSize * texSize * 4);
      for (let i = 0; i < texSize * texSize; i++) {
        cellData[i * 4] = fractureCells.localOffsets[i * 3];
        cellData[i * 4 + 1] = fractureCells.localOffsets[i * 3 + 1];
        cellData[i * 4 + 2] = fractureCells.localOffsets[i * 3 + 2];
        cellData[i * 4 + 3] = fractureCells.assignment[i];
      }
      rigidCellTex = new THREE.DataTexture(cellData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
      rigidCellTex.needsUpdate = true;
      rigidCellTexRef.current = rigidCellTex;
      const resolved = resolveRigid(config);
      rigidSolverRef.current = createRigidSolver(fractureCells, {
        glueEnabled: resolved.glueEnabled,
        startSleeping: resolved.startSleeping,
        // XPBD joints + OBB shapes (Phase 20 stage 1): both are
        // build-time state, resolved through the same
        // resolveRigid call as the legacy keys. Off builds
        // neither (legacy state shape).
        jointEnabled: resolved.jointEnabled,
        jointCompliance: resolved.jointCompliance,
        jointBreakThreshold: resolved.jointBreakThreshold,
        convexEnabled: resolved.convexEnabled,
      });
      const bodyData = new Float32Array(RIGID_BODY_TEX_WIDTH * RIGID_BODY_TEX_HEIGHT * 4);
      writeRigidBodyTexture(rigidSolverRef.current, bodyData);
      rigidBodyDataRef.current = bodyData;
      rigidBodyTex = new THREE.DataTexture(bodyData, RIGID_BODY_TEX_WIDTH, RIGID_BODY_TEX_HEIGHT, THREE.RGBAFormat, THREE.FloatType);
      rigidBodyTex.needsUpdate = true;
      rigidBodyTexRef.current = rigidBodyTex;
      // Cluster colour LUT (Phase 20 stage 1): built only while
      // the colour key is on — the per-body cluster colours of
      // THIS bake's cell table (static, bake-time clusters).
      if (rigidClusterColorEnabled) {
        const lutData = buildBodyClusterColorLut(fractureCells);
        rigidClusterLutTex = new THREE.DataTexture(lutData, RIGID_CLUSTER_COLOR_COUNT, 1, THREE.RGBAFormat, THREE.FloatType);
        rigidClusterLutTex.needsUpdate = true;
        rigidClusterLutTexRef.current = rigidClusterLutTex;
      }
    }
    return () => {
      tex.dispose();
      if (morphTexRef.current === tex) morphTexRef.current = null;
      normalTex.dispose();
      if (morphNormalTexRef.current === normalTex) morphNormalTexRef.current = null;
      if (rigidCellTex) {
        rigidCellTex.dispose();
        if (rigidCellTexRef.current === rigidCellTex) rigidCellTexRef.current = null;
      }
      if (rigidBodyTex) {
        rigidBodyTex.dispose();
        if (rigidBodyTexRef.current === rigidBodyTex) rigidBodyTexRef.current = null;
        rigidBodyDataRef.current = null;
        rigidSolverRef.current = null;
      }
      if (rigidClusterLutTex) {
        rigidClusterLutTex.dispose();
        if (rigidClusterLutTexRef.current === rigidClusterLutTex) rigidClusterLutTexRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- フィールド単位の依存が意図的: 本体は config 全体を各ビルダーへ渡すが、再ベイク条件は上方で抽出したフィールドだけに限る（config 全体を依存に入れると全ての設定変更で再ベイクされる）
  }, [
    texSize,
    morphEnabled,
    morphTarget,
    morphScale,
    morphJitter,
    morphSeed,
    morphBounceRadius,
    morphText,
    morphTextFont,
    morphTextWeight,
    morphTextSize,
    morphTextPadding,
    morphTextInvert,
    morphTextVertical,
    morphTextColumnLength,
    morphTextColumnGap,
    morphTextLetterSpacing,
    morphTextKinsoku,
    morphTextYakumono,
    morphTextTateChuYoko,
    morphTextRuby,
    morphTextPageEnabled,
    morphTextColumnBalance,
    morphTextPageIndex,
    morphMediaMap,
    morphMediaWidth,
    morphMediaHeight,
    morphNoiseMapEnabled,
    morphNoiseSignature,
    morphSvgSource,
    morphObjSource,
    morphObjSampleMode,
    morphReplicaCount,
    morphReplicaSpacing,
    morphReplicaAxis,
    morphReplicaRotation,
    morphReplicaScaleStep,
    morphReplicaPhaseStep,
    morphTerrainAmplitude,
    morphTerrainFrequency,
    morphTerrainOctaves,
    morphTerrainSeed,
    morphTerrainKind,
    morphTerrainTerraceSteps,
    morphTerrainErosionSettled,
    morphTerrainTunnel,
    morphScatterEnabled,
    morphScatterDensity,
    morphScatterHeightMin,
    morphScatterHeightMax,
    morphScatterSlopeMax,
    morphScatterAlignNormal,
    morphScatterSpecies,
    morphScatterScaleRandom,
    morphScatterRotRandom,
    morphScatterBend,
    morphPcgGraphEnabled,
    morphPcgGraphData,
    morphPathMode,
    morphTextOnPathEnabled,
    morphTextOnPathDelay,
    morphTextOnPathSize,
    morphTextOnPathVertical,
    morphPathWriteOnStart,
    morphPathWriteOnEnd,
    morphPathTaper,
    morphPathTaperShape,
    morphPathSubpathMode,
    morphStampSpacing,
    morphStampSize,
    morphStampShape,
    morphStampAlign,
    morphPathOffset,
    morphGlyphScale,
    morphGlyphRotate,
    morphGlyphFade,
    morphContourSource,
    morphContourThreshold,
    morphPolygonSides,
    morphPathJitter,
    morphDisperseAmount,
    morphDisperseDirection,
    morphTwistAmount,
    morphTwistAxis,
    morphFractalAmount,
    morphFractalFrequency,
    morphFractalEvolution,
    morphMaskMode,
    morphMaskMap,
    morphMaskWidth,
    morphMaskHeight,
    morphMaskThreshold,
    morphMaskInvert,
    // Rigid bodies (Phase AU): solver switches + the fracture
    // division keys are bake inputs while the solver is enabled.
    rigidEnabled,
    rigidGlueEnabled,
    rigidStartSleeping,
    rigidJointEnabled,
    rigidJointCompliance,
    rigidJointBreakThreshold,
    rigidConvexEnabled,
    rigidClusterColorEnabled,
    fragmentRestoreEnabled,
    fragmentCollectionJson,
    morphFractureEnabled,
    morphFractureCells,
    morphFractureSeed,
    morphFractureGap,
    attrCloudVersion,
  ]);

  // Named point attributes (Phase AK): the attribute texture is
  // baked ONLY while at least one consumer (draw size / brightness,
  // velocity force drive, group gate) is active — otherwise the
  // ref stays null, the passes resolve every attribute uniform
  // off, and the legacy path runs verbatim at zero cost. The bake
  // is a pure function of the seeded initial data, the morph bake
  // (for the 'target' source, rebuilt through the shared builder)
  // and the registered point cloud (for 'data'), keyed by a
  // signature of exactly those inputs. Declared after the main
  // and morph effects so a reseed's fresh initial arrays are in
  // initDataRef before this runs (declaration order).
  const attrConsumers = resolveAttrConsumers(config);
  const attrNamesKey = normalizeAttrNames(config.gpgpuAttrNames).join(',');
  const attrSourcesKey = normalizeAttrSources(config.gpgpuAttrSources).join(',');
  // Bake-time arithmetic (Phase BI): the expressions are bake
  // inputs exactly like the names / sources, so they join the
  // rebake signature (JSON-encoded — expressions may contain
  // any separator character).
  const attrExprsKey = JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs));
  const attrSignature = attrConsumers.anyActive
    ? [
      texSize,
      config.gpgpuSeed,
      config.gpgpuBounceRadius,
      config.gpgpuAgeMax,
      config.gpgpuEmitShape,
      config.gpgpuParticleLifeSpecies,
      attrNamesKey,
      attrSourcesKey,
      attrExprsKey,
      // Colour drive (Phase CL): the bake writes the colour
      // slots RAW while the drive is active, so the drive's
      // resolution is itself a bake input.
      attrConsumers.colorActive ? 'attrColor' : '',
      attrCloud?.version ?? 0,
      // The initial cloud depends on the light position only for
      // the 'light' emit shape (the main effect's masking rule).
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosX : 0,
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosY : 0,
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosZ : 0,
      // 'target' source inputs: the morph bake's own signature
      // (the shared builder is a pure function of the config).
      attrSourcesKey.includes('target') ? JSON.stringify(config) : '',
      // Named groups (Phase CV): a baked group's membership is
      // written into this bake, so the referenced definition is
      // a bake input — but only while a ref is set, so legacy
      // signatures (and bakes) stay untouched otherwise.
      config.gpgpuGroupRef ? JSON.stringify([config.gpgpuGroupRef, config.gpgpuGroupsData]) : '',
    ].join('|')
    : '';
  useEffect(() => {
    attrTexRef.current?.dispose();
    attrTexRef.current = null;
    if (!attrSignature || !initDataRef.current) return;
    const sources = normalizeAttrSources(config.gpgpuAttrSources);
    const needsTarget = sources.includes('target');
    const bake = needsTarget ? buildMorphBakeData(config, texSize) : null;
    const data = buildAttributeData({
      texSize,
      posData: initDataRef.current.posData,
      // Phase 18 stage 1: the seeded velocities feed the
      // bake-time value of the sim variable vel.
      velData: initDataRef.current.velData,
      ageMax: config.gpgpuAgeMax,
      bounceRadius: config.gpgpuBounceRadius,
      speciesCount: config.gpgpuParticleLifeSpecies,
      morphData: bake ? bake.data : null,
      morphWorldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
      cloud: getAttrPointCloud(),
      names: normalizeAttrNames(config.gpgpuAttrNames),
      sources: normalizeAttrSources(config.gpgpuAttrSources),
      exprs: config.gpgpuAttrExprs,
      colorRawSlots: attrConsumers.colorActive
        ? resolveAttrColorSlots(normalizeAttrNames(config.gpgpuAttrNames))
        : null,
    });
    // Phase CV: publish the pristine bake for the panel's freeze
    // action, then — when the gate resolves to a baked group
    // (snapshot/composite) — write its exact 0/1 membership into
    // the baked slot channel of a COPY used for the texture. The
    // velocity shader links every texture unit the platform
    // guarantees, so the membership rides the attribute texture
    // itself; the gate reads it as "above 0.5" (see
    // resolveGroupGate in lib/gpgpuGroups.ts).
    setLastAttrBake(data, texSize);
    let texData = data;
    const groupGate = resolveGroupGate(
      parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
      config.gpgpuGroupRef ?? '',
    );
    if (groupGate.kind === 'baked') {
      const membership = evaluateGpgpuGroup(
        parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
        config.gpgpuGroupRef,
        data,
        texSize * texSize,
      );
      if (membership) {
        texData = new Float32Array(data);
        for (let i = 0; i < membership.length; i += 1) {
          texData[i * 4 + groupGate.slot] = membership[i];
        }
      }
    }
    const tex = new THREE.DataTexture(texData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    attrTexRef.current = tex;
    return () => {
      tex.dispose();
      if (attrTexRef.current === tex) attrTexRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrSignature]);

  // Ext attribute bake (Phase 18 stage 1): slots 4..7 in a
  // second texture, built ONLY while resolveAttrExtConsumers
  // finds a reader (an enabled pass whose expressions name an
  // ext slot). The ext expressions may read slots 0..3 by
  // name, so the pristine stage-1 bake is an input and joins
  // the signature through its own inputs. While no reader
  // exists the ref stays null and the passes bind nothing.
  const attrExtActive = resolveAttrExtConsumers(config);
  const attrNames2Key = normalizeAttrNames2(config.gpgpuAttrNames2).join(',');
  const attrSources2Key = normalizeAttrSources(config.gpgpuAttrSources2).join(',');
  const attrExprs2Key = JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs2));
  const attrExtSignature = attrExtActive
    ? [
      texSize,
      config.gpgpuSeed,
      config.gpgpuBounceRadius,
      config.gpgpuAgeMax,
      config.gpgpuEmitShape,
      config.gpgpuParticleLifeSpecies,
      attrNamesKey,
      attrSourcesKey,
      attrExprsKey,
      attrNames2Key,
      attrSources2Key,
      attrExprs2Key,
      attrConsumers.colorActive ? 'attrColor' : '',
      attrCloud?.version ?? 0,
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosX : 0,
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosY : 0,
      config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosZ : 0,
      (attrSourcesKey.includes('target') || attrSources2Key.includes('target')) ? JSON.stringify(config) : '',
    ].join('|')
    : '';
  useEffect(() => {
    attrTex2Ref.current?.dispose();
    attrTex2Ref.current = null;
    if (!attrExtSignature || !initDataRef.current) return;
    const sources = normalizeAttrSources(config.gpgpuAttrSources);
    const sources2 = normalizeAttrSources(config.gpgpuAttrSources2);
    const needsTarget = sources.includes('target') || sources2.includes('target');
    const bake = needsTarget ? buildMorphBakeData(config, texSize) : null;
    const firstBake = buildAttributeData({
      texSize,
      posData: initDataRef.current.posData,
      velData: initDataRef.current.velData,
      ageMax: config.gpgpuAgeMax,
      bounceRadius: config.gpgpuBounceRadius,
      speciesCount: config.gpgpuParticleLifeSpecies,
      morphData: bake ? bake.data : null,
      morphWorldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
      cloud: getAttrPointCloud(),
      names: normalizeAttrNames(config.gpgpuAttrNames),
      sources,
      exprs: config.gpgpuAttrExprs,
      colorRawSlots: attrConsumers.colorActive
        ? resolveAttrColorSlots(normalizeAttrNames(config.gpgpuAttrNames))
        : null,
    });
    const data = buildAttributeDataExt({
      texSize,
      posData: initDataRef.current.posData,
      velData: initDataRef.current.velData,
      ageMax: config.gpgpuAgeMax,
      bounceRadius: config.gpgpuBounceRadius,
      speciesCount: config.gpgpuParticleLifeSpecies,
      morphData: bake ? bake.data : null,
      morphWorldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
      cloud: getAttrPointCloud(),
      firstBake,
      names: normalizeAttrNames(config.gpgpuAttrNames),
      names2: normalizeAttrNames2(config.gpgpuAttrNames2),
      sources2,
      exprs2: config.gpgpuAttrExprs2,
    });
    const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    attrTex2Ref.current = tex;
    return () => {
      tex.dispose();
      if (attrTex2Ref.current === tex) attrTex2Ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrExtSignature]);

  return {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    spawnOrderTexRef,
    morphTexRef,
    morphNormalTexRef,
    attrTexRef,
    attrTex2Ref,
    fluidRTARef,
    fluidRTBRef,
    fluidPingIsA,
    flipTransferRTRef,
    flipPressureRTRef,
    sortRTARef,
    sortRTBRef,
    grainsSortRTARef,
    grainsSortRTBRef,
    auxRtRef,
    auxPingIsA,
    wwRtRef,
    wwPingIsA,
    aux2RtRef,
    aux2PingIsA,
    aux3RtRef,
    aux3PingIsA,
    replicaStacksRef,
    vellumRestTexRef,
    vellumStateRtRef,
    vellumStatePingIsA,
    vellumXpbdRtRef,
    vellumGradTexRef,
    vellumVolumeInfoRef,
    vellumComponentTexRef,
    vellumComponentsRef,
    rigidCellTexRef,
    rigidClusterLutTexRef,
    rigidBodyTexRef,
    rigidBodyDataRef,
    rigidSolverRef,
    pyroGridRef,
    flip3dRef,
    webgpuStateRef,
    webgpuPosTexRef,
    webgpuPingIsARef,
  };
}
