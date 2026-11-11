import React, { useEffect, useMemo, useRef } from 'react';
import type { FC, MutableRefObject, RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import { LodSystem } from '../lib/lodSystem';
import { useGpgpuAssets } from './useGpgpuAssets';
import { getTexSize, useGpgpuRuntime } from './useGpgpuRuntime';
import { GpgpuRenderOutputs } from './gpgpuRenderOutputs';
import {
  createGpgpuFrameDiagnosticSnapshot,
  readbackParticlePositions,
  type GpgpuFrameDiagnosticSnapshot,
} from './gpgpuDiagnostics';
import {
  resolveGpgpuAudioBlast,
  resolveGpgpuFrameRouting,
  resolvePingPongTargets,
} from './gpgpuExecutionRouting';
import {
  applyLodPolicy,
  pushTrailFrame,
  runDepthSortPass,
  syncVisualUniforms,
} from './gpgpuVisualUpdates';
import {
  blitPreviousPositionPass,
  runFluidAdvectionPass,
  runSimulationPasses,
  updateMouseWorldPosition,
} from './gpgpuSimulationPasses';

type GpgpuSystemProps = {
  audioRef: MutableRefObject<{ bass: number; treble: number; pulse: number }>;
  config: ParticleConfig;
  isPlaying: boolean;
  posReadbackRef?: RefObject<Float32Array | null>;
  pointCloudCaptureRef?: RefObject<PointCloudCaptureState | null>;
};

export const GpgpuSystem: FC<GpgpuSystemProps> = React.memo(({ audioRef, config, isPlaying, posReadbackRef, pointCloudCaptureRef }) => {
  const { gl, camera } = useThree();
  const mouseNDC = useRef(new THREE.Vector2(0, 0));
  const mouseWorldRef = useRef(new THREE.Vector3(0, 0, 0));
  const tempMouseVec = useRef(new THREE.Vector3());
  const tempMouseDir = useRef(new THREE.Vector3());
  const timeRef = useRef(0);
  const routingSnapshotRef = useRef<GpgpuFrameDiagnosticSnapshot | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    canvas.addEventListener('mousemove', onMove);
    return () => canvas.removeEventListener('mousemove', onMove);
  }, [gl.domElement]);

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    const target = window as Window & {
      __KALO_GPGPU_DEBUG__?: {
        getRouting: () => GpgpuFrameDiagnosticSnapshot | null;
      };
    };
    target.__KALO_GPGPU_DEBUG__ = {
      getRouting: () => routingSnapshotRef.current,
    };
    return () => {
      delete target.__KALO_GPGPU_DEBUG__;
    };
  }, []);

  const lodSystem = useMemo(() => new LodSystem(), []);
  const texSize = useMemo(() => getTexSize(config.gpgpuCount), [config.gpgpuCount]);
  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const simGeo = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  const assets = useGpgpuAssets({ config, texSize, simScene, simGeo });
  const {
    simMeshRef,
    velSimMat,
    posSimMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    fluidAdvectMat,
    drawGeo,
    streakGeo,
    trailRTs,
    trailHead,
  } = assets;

  const runtime = useGpgpuRuntime({ gl, texSize, config });
  const {
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
  } = runtime;

  useFrame(({ gl: glCtx }, delta) => {
    if (!isPlaying || !rtRef.current || !simMeshRef.current) return;

    const dt = Math.min(delta, 0.05);
    timeRef.current += dt;
    if (config.autoLod) lodSystem.update(dt);

    const { isA, posIn, posOut, velIn, velOut } = resolvePingPongTargets(rtRef.current, pingIsA.current);
    const blast = resolveGpgpuAudioBlast(config, audioRef.current);

    updateMouseWorldPosition({
      mouseNDC: mouseNDC.current,
      camera,
      mouseWorld: mouseWorldRef.current,
      tempVec: tempMouseVec.current,
      tempDir: tempMouseDir.current,
    });

    blitPreviousPositionPass({
      config,
      prevPosRT: prevPosRTRef.current,
      blitMat,
      simMesh: simMeshRef.current,
      gl: glCtx,
      simScene,
      simCamera,
      posTexture: posIn.texture,
    });

    runFluidAdvectionPass({
      config,
      fluidRTA: fluidRTARef.current,
      fluidRTB: fluidRTBRef.current,
      fluidPingIsA,
      fluidAdvectMat,
      velSimMat,
      simMesh: simMeshRef.current,
      gl: glCtx,
      simScene,
      simCamera,
      dt,
      time: timeRef.current,
    });

    const routing = resolveGpgpuFrameRouting({
      config,
      webgpuState: webgpuStateRef.current,
      webgpuPosTexture: webgpuPosTexRef.current,
      fallbackPosTexture: posOut.texture,
      posReadbackRef,
    });
    routingSnapshotRef.current = createGpgpuFrameDiagnosticSnapshot(routing);

    runSimulationPasses({
      useWebGPU: routing.useWebGPU,
      config,
      texSize,
      dt,
      time: timeRef.current,
      blast,
      mouseWorld: mouseWorldRef.current,
      simMesh: simMeshRef.current,
      gl: glCtx,
      simScene,
      simCamera,
      posIn,
      posOut,
      velIn,
      velOut,
      velSimMat,
      posSimMat,
      initPosTex: initPosTexRef.current,
      prevPosTex: prevPosRTRef.current?.texture ?? null,
      webgpuState: webgpuStateRef.current,
      webgpuPosTex: webgpuPosTexRef.current,
      webgpuPingIsARef,
    });

    const finalSortTex = runDepthSortPass({
      config,
      gl: glCtx,
      camera,
      simScene,
      simCamera,
      simMesh: simMeshRef.current,
      posTexture: posOut.texture,
      texSize,
      sortRTA: sortRTARef.current,
      sortRTB: sortRTBRef.current,
      sortDepthMat,
      bitonicMat,
    });

    pushTrailFrame({
      config,
      gl: glCtx,
      simScene,
      simCamera,
      simMesh: simMeshRef.current,
      blitMat,
      trailRTs,
      trailHead,
      posTexture: posOut.texture,
    });

    glCtx.setRenderTarget(null);

    readbackParticlePositions({
      routing,
      gl: glCtx,
      posOut,
      texSize,
      posReadbackRef,
    });

    // One-shot point-cloud capture for the PLY export (roadmap Phase 9).
    const capture = pointCloudCaptureRef?.current;
    if (capture?.requested) {
      readbackParticlePositions({
        routing,
        gl: glCtx,
        posOut,
        texSize,
        posReadbackRef: capture.buffer,
        force: true,
      });
      if (capture.buffer.current) {
        capture.texSize = texSize;
        capture.capturedAt = performance.now();
      }
      capture.requested = false;
    }

    pingIsA.current = !isA;

    const activeCount = applyLodPolicy({
      config,
      lodSystem,
      texSize,
      velSimMat,
      drawGeo,
      streakGeo,
    });

    syncVisualUniforms({
      config,
      activeCount,
      assets,
      posTexture: routing.outputPosTexture,
      velTexture: velOut.texture,
      finalSortTex,
      texSize,
    });
  });

  return <GpgpuRenderOutputs config={config} assets={assets} />;
});

GpgpuSystem.displayName = 'GpgpuSystem';
