import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildGpgpuInitialData } from '../lib/gpgpuInitialData';
import { buildGpgpuMorphTargetData } from '../lib/gpgpuMorphTargets';
import type { MorphMediaMap } from '../lib/gpgpuMorphTargets';
import { extractTextLumaMap } from './controlPanelPartsSourceMediaUtils';
import { sampleSvgPointCloud } from '../lib/svgMorph';
import { sampleObjPointCloud } from '../lib/objMorph';
import { getSceneGeneration, noteGpgpuBackendSettled } from '../lib/sceneGeneration';
import {
  initWebGPUCompute,
  destroyWebGPUCompute,
} from '../lib/webgpuCompute';
import type { WebGPUComputeState } from '../lib/webgpuCompute';
import { FLUID_SIZE } from './gpgpuShaders';
import { AUX_TEX_SIZE } from './gpgpuShaderAux';
import { getMaxGpgpuTexSize } from '../lib/gpuTier';

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
  webgpuStateRef: MutableRefObject<WebGPUComputeState | null>;
  webgpuPosTexRef: MutableRefObject<THREE.DataTexture | null>;
  webgpuPingIsARef: MutableRefObject<boolean>;
};

type UseGpgpuRuntimeArgs = {
  gl: THREE.WebGLRenderer;
  texSize: number;
  config: ParticleConfig;
};

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

    const { posData, velData } = buildGpgpuInitialData(texSize, config.gpgpuBounceRadius, config.gpgpuEmitShape, config.gpgpuSeed, config.gpgpuAgeMax);

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
    initWebGPUCompute(texSize, wgPos, wgVel).then((state) => {
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
  }, [texSize, gl, config.gpgpuEmitShape, config.gpgpuBounceRadius, config.gpgpuSeed, config.gpgpuAgeMax]);

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
  useEffect(() => {
    morphTexRef.current?.dispose();
    morphTexRef.current = null;
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
    // obj (Phase J): re-sample the imported OBJ source text into its
    // surface point cloud; null (no usable geometry) falls back to
    // the shell inside the bake, exactly like a missing media map.
    const objPoints = morphTarget === 'obj' ? sampleObjPointCloud(morphObjSource) : null;
    const data = buildGpgpuMorphTargetData({
      texSize,
      target: morphTarget,
      worldScale: morphScale * morphBounceRadius * 0.48,
      jitter: morphJitter,
      seed: morphSeed,
      mediaMap,
      svgPoints,
      objPoints,
    });
    const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    morphTexRef.current = tex;
    return () => {
      tex.dispose();
      if (morphTexRef.current === tex) morphTexRef.current = null;
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
  ]);

  return {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    morphTexRef,
    fluidRTARef,
    fluidRTBRef,
    fluidPingIsA,
    sortRTARef,
    sortRTBRef,
    auxRtRef,
    auxPingIsA,
    webgpuStateRef,
    webgpuPosTexRef,
    webgpuPingIsARef,
  };
}
