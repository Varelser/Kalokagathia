import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildGpgpuInitialData } from '../lib/gpgpuInitialData';
import { buildGpgpuMorphTargetDataWithNormals } from '../lib/gpgpuMorphTargets';
import type { MorphMediaMap } from '../lib/gpgpuMorphTargets';
import { extractTextLumaMap } from './controlPanelPartsSourceMediaUtils';
import { sampleSvgPointCloud } from '../lib/svgMorph';
import { parseSvgPathGeometry } from '../lib/pathGeometry';
import { sampleObjPointCloudWithNormals } from '../lib/objMorph';
import { getSceneGeneration, noteGpgpuBackendSettled } from '../lib/sceneGeneration';
import {
  initWebGPUCompute,
  destroyWebGPUCompute,
  updateWebGPUMorphData,
} from '../lib/webgpuCompute';
import type { WebGPUComputeState } from '../lib/webgpuCompute';
import { FLUID_SIZE } from './gpgpuShaders';
import { AUX_TEX_SIZE } from './gpgpuShaderAux';
import { clampAuxDepth } from '../lib/auxChain';
import { getMaxGpgpuTexSize } from '../lib/gpuTier';
import {
  replicaBlockRange,
  replicaStackSide,
  resolveReplicaIndependentActive,
} from '../lib/replicaIndependent';
import { createPosSimMaterial, createVelSimMaterial } from './useGpgpuSimulationAssets';

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
  morphTexRef: MutableRefObject<THREE.DataTexture | null>;
  morphNormalTexRef: MutableRefObject<THREE.DataTexture | null>;
  fluidRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidPingIsA: MutableRefObject<boolean>;
  sortRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  sortRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  auxRtRef: MutableRefObject<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>;
  auxPingIsA: MutableRefObject<boolean>;
  aux2RtRef: MutableRefObject<AuxPoolTargets | null>;
  aux2PingIsA: MutableRefObject<boolean>;
  aux3RtRef: MutableRefObject<AuxPoolTargets | null>;
  aux3PingIsA: MutableRefObject<boolean>;
  replicaStacksRef: MutableRefObject<ReplicaStack[] | null>;
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
    );
    mediaMap = { map, width: 128, height: 128 };
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
  const objSample = config.gpgpuMorphTarget === 'obj'
    ? sampleObjPointCloudWithNormals(config.gpgpuMorphObjSource, config.gpgpuMorphObjSampleMode)
    : null;
  return buildGpgpuMorphTargetDataWithNormals({
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
    },
  });
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
  const morphTexRef = useRef<THREE.DataTexture | null>(null);
  const morphNormalTexRef = useRef<THREE.DataTexture | null>(null);
  const fluidRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidPingIsA = useRef(true);
  const sortRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const sortRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const auxRtRef = useRef<{
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  } | null>(null);
  const auxPingIsA = useRef(true);
  const aux2RtRef = useRef<AuxPoolTargets | null>(null);
  const aux2PingIsA = useRef(true);
  const aux3RtRef = useRef<AuxPoolTargets | null>(null);
  const aux3PingIsA = useRef(true);
  const replicaStacksRef = useRef<ReplicaStack[] | null>(null);
  // Latest shared initial arrays (Phase W2): the main effect
  // rebuilds them on every reseed; the replica-stack effect seeds
  // the stacks from them, including when only the independent
  // toggle changed and the main effect did not rerun.
  const initDataRef = useRef<{ posData: Float32Array; velData: Float32Array } | null>(null);
  const webgpuStateRef = useRef<WebGPUComputeState | null>(null);
  const webgpuPosTexRef = useRef<THREE.DataTexture | null>(null);
  const webgpuPingIsARef = useRef(true);

  useEffect(() => {
    if (rtRef.current) {
      rtRef.current.posA.dispose();
      rtRef.current.posB.dispose();
      rtRef.current.velA.dispose();
      rtRef.current.velB.dispose();
    }
    prevPosRTRef.current?.dispose();
    initPosTexRef.current?.dispose();

    const posA = makeRT(texSize);
    const posB = makeRT(texSize);
    const velA = makeRT(texSize);
    const velB = makeRT(texSize);
    const prevPos = makeRT(texSize);
    rtRef.current = { posA, posB, velA, velB };
    prevPosRTRef.current = prevPos;
    pingIsA.current = true;

    const { posData, velData } = buildGpgpuInitialData(
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
    initDataRef.current = { posData, velData };
    const initTex = new THREE.DataTexture(posData.slice(), texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    initTex.needsUpdate = true;
    initPosTexRef.current = initTex;

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

    fluidRTARef.current?.dispose();
    fluidRTBRef.current?.dispose();
    fluidRTARef.current = makeFluidRT(FLUID_SIZE);
    fluidRTBRef.current = makeFluidRT(FLUID_SIZE);
    fluidPingIsA.current = true;

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
    initWebGPUCompute(texSize, wgPos, wgVel, wgMorph ? wgMorph.data : null).then((state) => {
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
      sortRTARef.current?.dispose();
      sortRTARef.current = null;
      sortRTBRef.current?.dispose();
      sortRTBRef.current = null;
      auxRtRef.current?.posA.dispose();
      auxRtRef.current?.posB.dispose();
      auxRtRef.current?.velA.dispose();
      auxRtRef.current?.velB.dispose();
      auxRtRef.current = null;
      fluidRTARef.current?.dispose();
      fluidRTARef.current = null;
      fluidRTBRef.current?.dispose();
      fluidRTBRef.current = null;
      if (webgpuStateRef.current) {
        destroyWebGPUCompute(webgpuStateRef.current);
        webgpuStateRef.current = null;
      }
      webgpuPosTexRef.current?.dispose();
      webgpuPosTexRef.current = null;
    };
  }, [texSize, gl, config.gpgpuEmitShape, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax, config.gpgpuMorphEnabled, config.gpgpuMorphReplicaCount, config.gpgpuMorphReplicaAgeStep,
    // Light position only re-seeds while the 'light' emitter is in
    // use (Phase T); for other shapes it is masked to 0 so dragging
    // the light never resets their cloud.
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosX : 0,
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosY : 0,
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosZ : 0]);

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
  const replicaStacksActive = resolveReplicaIndependentActive(config);
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
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosX : 0,
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosY : 0,
    config.gpgpuEmitShape === 'light' ? config.gpgpuLightPosZ : 0,
  ]);

  // Morph target texture (Kinetix integration B1a): the per-particle
  // target cloud is baked on the CPU (deterministic, seeded) and rebuilt
  // only when its inputs change. text reuses the layer TextMap renderer
  // (extractTextLumaMap with layer 2's text settings); image reuses the
  // media luma map the user loaded for layer 2. When morph is disabled
  // no texture exists and the velocity shader skips the force entirely,
  // leaving the stock behaviour bit-identical.
  const morphEnabled = config.gpgpuMorphEnabled;
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
  const morphPathMode = config.gpgpuMorphPathMode;
  const morphPathWriteOnStart = config.gpgpuMorphPathWriteOnStart;
  const morphPathWriteOnEnd = config.gpgpuMorphPathWriteOnEnd;
  const morphPathTaper = config.gpgpuMorphPathTaper;
  const morphPathTaperShape = config.gpgpuMorphPathTaperShape;
  const morphPathSubpathMode = config.gpgpuMorphPathSubpathMode;
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
      );
      mediaMap = { map, width: 128, height: 128 };
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
    // obj (Phase J, modes + normals in Phase O): re-sample the
    // imported OBJ source text in the selected mode; null (no usable
    // geometry) falls back to the shell inside the bake, exactly like
    // a missing media map. The 'surface' mode's points are
    // bit-identical to the Phase J sampler; the parallel normal cloud
    // feeds the companion normal texture below.
    const objSample = morphTarget === 'obj' ? sampleObjPointCloudWithNormals(morphObjSource, morphObjSampleMode) : null;
    const objPoints = objSample ? objSample.points : null;
    const objNormals = objSample ? objSample.normals : null;
    const { data, normalData } = buildGpgpuMorphTargetDataWithNormals({
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
      },
    });
    const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    morphTexRef.current = tex;
    // Phase R: keep the WebGPU morph buffer in sync with the bake.
    // (If the WebGPU state does not exist yet, its init path bakes
    // the same data itself via buildMorphBakeData.)
    if (webgpuStateRef.current) {
      updateWebGPUMorphData(webgpuStateRef.current, data);
    }
    // Companion normal texture (Phase O): same texel layout as the
    // morph target texture; xyz is a unit direction (not scaled).
    const normalTex = new THREE.DataTexture(normalData, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    normalTex.needsUpdate = true;
    morphNormalTexRef.current = normalTex;
    return () => {
      tex.dispose();
      if (morphTexRef.current === tex) morphTexRef.current = null;
      normalTex.dispose();
      if (morphNormalTexRef.current === normalTex) morphNormalTexRef.current = null;
    };
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
    morphMediaMap,
    morphMediaWidth,
    morphMediaHeight,
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
    morphPathMode,
    morphPathWriteOnStart,
    morphPathWriteOnEnd,
    morphPathTaper,
    morphPathTaperShape,
    morphPathSubpathMode,
  ]);

  return {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    morphTexRef,
    morphNormalTexRef,
    fluidRTARef,
    fluidRTBRef,
    fluidPingIsA,
    sortRTARef,
    sortRTBRef,
    auxRtRef,
    auxPingIsA,
    aux2RtRef,
    aux2PingIsA,
    aux3RtRef,
    aux3PingIsA,
    replicaStacksRef,
    webgpuStateRef,
    webgpuPosTexRef,
    webgpuPingIsARef,
  };
}
