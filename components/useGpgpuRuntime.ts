import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildGpgpuInitialData } from '../lib/gpgpuInitialData';
import { getSceneGeneration, noteGpgpuBackendSettled } from '../lib/sceneGeneration';
import {
  initWebGPUCompute,
  destroyWebGPUCompute,
} from '../lib/webgpuCompute';
import type { WebGPUComputeState } from '../lib/webgpuCompute';
import { FLUID_SIZE } from './gpgpuShaders';
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
  fluidRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  fluidPingIsA: MutableRefObject<boolean>;
  sortRTARef: MutableRefObject<THREE.WebGLRenderTarget | null>;
  sortRTBRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
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
  const fluidRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const fluidPingIsA = useRef(true);
  const sortRTARef = useRef<THREE.WebGLRenderTarget | null>(null);
  const sortRTBRef = useRef<THREE.WebGLRenderTarget | null>(null);
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

    const { posData, velData } = buildGpgpuInitialData(texSize, config.gpgpuBounceRadius, config.gpgpuEmitShape, config.gpgpuSeed);

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
  }, [texSize, gl, config.gpgpuEmitShape, config.gpgpuBounceRadius, config.gpgpuSeed]);

  return {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    fluidRTARef,
    fluidRTBRef,
    fluidPingIsA,
    sortRTARef,
    sortRTBRef,
    webgpuStateRef,
    webgpuPosTexRef,
    webgpuPingIsARef,
  };
}
