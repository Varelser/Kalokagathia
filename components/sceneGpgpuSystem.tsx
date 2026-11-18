import React, { useEffect, useMemo, useRef } from 'react';
import type { FC, MutableRefObject, RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import { LodSystem } from '../lib/lodSystem';
import { scaleFrameDelta } from '../lib/playbackTime';
import { useGpgpuAssets } from './useGpgpuAssets';
import { getTexSize, useGpgpuRuntime } from './useGpgpuRuntime';
import { GpgpuRenderOutputs } from './gpgpuRenderOutputs';
import { GpgpuFieldGlyphs } from './sceneGpgpuFieldGlyphs';
import { GpgpuMorphFibers } from './sceneGpgpuMorphFibers';
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
  runAuxChainSimulationPasses,
  runAuxSimulationPasses,
  runFluidAdvectionPass,
  runReplicaStackPasses,
  runSimulationPasses,
  updateMouseWorldPosition,
} from './gpgpuSimulationPasses';
import { REPLICA_MERGE_FRAG } from './gpgpuShaderReplica';
import { SIM_VERT } from './gpgpuShaders';
import { resolveAuxChainLevels, resolveAuxLevelColor } from '../lib/auxChain';
import { resolveRigid, stepRigidBodies, writeRigidBodyTexture } from '../lib/rigidBodies';
import { resolveMapSourceTexture } from '../lib/terrainDerivedMaps';
import { getDeterministicRotationFrame, isDeterministicJobActive } from '../lib/sceneRotationDeterminism';
import {
  MAX_MULTI_POINTERS,
  createPointerTrackMap,
  movePointer,
  pointerList,
  primaryPointer,
  releasePointer,
  trackPointer,
  type PointerTrackMap,
} from '../lib/multiPointer';

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
  // Multi-pointer tracking (Phase AO): insertion-ordered set of
  // live pointers. The FIRST entry drives mouseNDC / mouseWorld
  // (the legacy single-pointer path verbatim); the full set only
  // reaches the shaders while gpgpuMouseMultiTouch is on.
  const pointerMapRef = useRef<PointerTrackMap>(createPointerTrackMap());
  const mouseWorldMultiRef = useRef<THREE.Vector3[]>(
    Array.from({ length: MAX_MULTI_POINTERS }, () => new THREE.Vector3()),
  );
  const mouseWorldRef = useRef(new THREE.Vector3(0, 0, 0));
  const tempMouseVec = useRef(new THREE.Vector3());
  const tempMouseDir = useRef(new THREE.Vector3());
  const timeRef = useRef(0);
  // OBJ normal kick (Phase O): the sim time at which the current
  // morph bake / normal-speed value was (re)placed. The velocity
  // shader's kick envelope runs from this instant, so re-baking the
  // morph (preset apply, OBJ edit, mode change) or changing the
  // speed key re-emits the particles along their normals.
  const morphKickStartRef = useRef(0);
  const morphKickTexRef = useRef<THREE.DataTexture | null>(null);
  const morphKickSpeedRef = useRef(0);
  const morphKickInitRef = useRef(false);
  // Spawn epoch (Phase AB): the sim time at which the current
  // spawn-gate settings (burst / rate / pool size / seed) took
  // effect. The gate's clock is time since this instant, so
  // editing the burst or re-seeding the pool restarts the release
  // instead of consulting the app's absolute clock. The FIRST
  // placement after a (re)mount keeps the epoch at 0 — the sim
  // clock restarts at mount too, and deterministic renders
  // remount the scene, so exports stay reproducible.
  const spawnEpochStartRef = useRef(0);
  const spawnEpochKeyRef = useRef('');
  const spawnEpochInitRef = useRef(false);
  const routingSnapshotRef = useRef<GpgpuFrameDiagnosticSnapshot | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const map = pointerMapRef.current;
    const toNdc = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      };
    };
    const syncPrimary = () => {
      const primary = primaryPointer(map);
      if (primary) {
        mouseNDC.current.x = primary.x;
        mouseNDC.current.y = primary.y;
      }
    };
    const onDown = (e: PointerEvent) => {
      const ndc = toNdc(e);
      trackPointer(map, e.pointerId, ndc.x, ndc.y);
      syncPrimary();
    };
    const onMove = (e: PointerEvent) => {
      const ndc = toNdc(e);
      // The mouse is tracked on move alone (hover), exactly like
      // the legacy mousemove listener; touch / pen moves only
      // update pointers that are already down.
      if (e.pointerType === 'mouse') trackPointer(map, e.pointerId, ndc.x, ndc.y);
      else movePointer(map, e.pointerId, ndc.x, ndc.y);
      syncPrimary();
    };
    const onUp = (e: PointerEvent) => {
      // The mouse entry persists after button-up (hover continues
      // to drive it); touch / pen entries end with the contact.
      // OrbitControls keeps its own handling — pointers are only
      // observed here, never captured or prevented, so two-finger
      // camera gestures and multi-touch interference coexist.
      if (e.pointerType !== 'mouse') releasePointer(map, e.pointerId);
      syncPrimary();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
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
  // Replica merge material (Phase W2): relocates each stack's
  // block into the shared layout targets; NoBlending + discard
  // outside the block make it a pure relocation.
  const replicaMergeMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uStackTex: { value: null },
      uGlobalTexSizeF: { value: 0 },
      uStackTexSizeF: { value: 0 },
      uBlockStart: { value: 0 },
      uBlockSize: { value: 0 },
    },
    vertexShader: SIM_VERT,
    fragmentShader: REPLICA_MERGE_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  }), []);
  const texSize = useMemo(() => getTexSize(config.gpgpuCount), [config.gpgpuCount]);
  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const simGeo = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  const assets = useGpgpuAssets({ config, texSize, simScene, simGeo });
  const {
    simMeshRef,
    velSimMat,
    posSimMat,
    vellumProjMat,
    vellumStateMat,
    auxVelMat,
    auxPosMat,
    auxChainVelMat,
    auxChainPosMat,
    aux2DrawMat,
    aux3DrawMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    fluidAdvectMat,
    flipSplatMat,
    flipCompositeMat,
    flipJacobiMat,
    flipSubtractMat,
    flipClearMat,
    drawGeo,
    streakGeo,
    auxDrawGeo,
    auxDrawMat,
    trailRTs,
    trailHead,
  } = assets;

  const runtime = useGpgpuRuntime({ gl, texSize, config });
  const {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    spawnOrderTexRef,
    morphTexRef,
    morphNormalTexRef,
    attrTexRef,
    fluidRTARef,
    fluidRTBRef,
    fluidPingIsA,
    flipTransferRTRef,
    flipPressureRTRef,
    sortRTARef,
    sortRTBRef,
    auxRtRef,
    auxPingIsA,
    aux2RtRef,
    aux2PingIsA,
    aux3RtRef,
    aux3PingIsA,
    replicaStacksRef,
    vellumRestTexRef,
    vellumStateRtRef,
    vellumStatePingIsA,
    rigidCellTexRef,
    rigidBodyTexRef,
    rigidBodyDataRef,
    rigidSolverRef,
    webgpuStateRef,
    webgpuPosTexRef,
    webgpuPingIsARef,
  } = runtime;

  // FLIP (Phase AT): the P2G splat points — one vertex per
  // particle texel; the position attribute carries the texel uv
  // the splat vertex shader fetches position / velocity with.
  const flipPoints = useMemo(() => {
    const count = texSize * texSize;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ((i % texSize) + 0.5) / texSize;
      positions[i * 3 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, flipSplatMat);
    points.frustumCulled = false;
    return points;
  }, [texSize, flipSplatMat]);

  useFrame(({ gl: glCtx }, delta) => {
    if (!isPlaying || !rtRef.current || !simMeshRef.current) return;

    // Phase X1: while a deterministic job is active the manager feeds
    // a step index before every legitimate advance; a null feed means
    // this call is a stray live frame of the freshly remounted system
    // during job setup, whose (clamped) step would shift the whole
    // export by one step. Skip it - the job's own advances follow.
    if (isDeterministicJobActive() && getDeterministicRotationFrame() === null) return;

    // Global time scale (B3): scales the sim step (and the accumulated
    // sim clock) in realtime playback; the deterministic renderer locks
    // the scale to 1, so exports keep their fixed-timestep envelope.
    // The scaled step is clamped to the same ±0.05s the raw step used,
    // so a large positive scale cannot destabilise the integrators.
    const rawDt = Math.min(delta, 0.05);
    const dt = Math.max(-0.05, Math.min(0.05, scaleFrameDelta(rawDt, config)));
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

    // Multi-touch (Phase AO): world positions for every tracked
    // pointer, computed with the same unproject law as the
    // primary. Only resolved while the key is on — off, the
    // passes receive no set and uMouseCount stays 0.
    const trackedPointers = config.gpgpuMouseMultiTouch ? pointerList(pointerMapRef.current) : [];
    if (config.gpgpuMouseMultiTouch) {
      const worlds = mouseWorldMultiRef.current;
      for (let i = 0; i < trackedPointers.length && i < worlds.length; i++) {
        tempMouseVec.current.set(trackedPointers[i].x, trackedPointers[i].y, 0.5).unproject(camera);
        tempMouseDir.current.copy(tempMouseVec.current).sub(camera.position).normalize();
        worlds[i].copy(camera.position).addScaledVector(tempMouseDir.current, camera.position.length());
      }
    }
    const mouseWorldMulti = config.gpgpuMouseMultiTouch ? mouseWorldMultiRef.current : undefined;
    const mouseMultiCount = trackedPointers.length;

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
      flipTransferRT: flipTransferRTRef.current,
      flipPressureRT: flipPressureRTRef.current,
      flipSplatMat,
      flipCompositeMat,
      flipJacobiMat,
      flipSubtractMat,
      flipClearMat,
      flipPoints,
      flipPosTex: posIn.texture,
      flipVelTex: velIn.texture,
    });

    // OBJ normal kick placement detection (Phase O): a new morph
    // normal texture (re-bake) or a changed normal-speed key marks
    // a (re)placement — the kick envelope restarts from this frame.
    // The FIRST placement after a (re)mount keeps kickStart = 0:
    // the sim clock restarts at mount too, and deterministic
    // renders remount the scene, so frame-timing jitter in this
    // detection can never leak into an export.
    if (
      morphNormalTexRef.current !== morphKickTexRef.current ||
      config.gpgpuMorphObjNormalSpeed !== morphKickSpeedRef.current
    ) {
      morphKickTexRef.current = morphNormalTexRef.current;
      morphKickSpeedRef.current = config.gpgpuMorphObjNormalSpeed;
      if (morphKickInitRef.current) morphKickStartRef.current = timeRef.current;
      morphKickInitRef.current = true;
    }

    // Spawn epoch (Phase AB): restart the release clock whenever
    // the gate's inputs change (same placement discipline as the
    // morph kick above).
    const spawnEpochKey = `${config.gpgpuSpawnBurst}|${config.gpgpuSpawnRate}|${config.gpgpuSpawnPulseInterval}|${config.gpgpuSpawnPulseDuty}|${config.gpgpuSpawnPulseCycles}|${config.gpgpuSpawnPulseProbability}|${config.gpgpuSpawnOrderMode}|${config.gpgpuSpawnEventEnabled}|${config.gpgpuSpawnEventTime}|${config.gpgpuCount}|${config.gpgpuSeed}`;
    if (spawnEpochKey !== spawnEpochKeyRef.current) {
      spawnEpochKeyRef.current = spawnEpochKey;
      if (spawnEpochInitRef.current) spawnEpochStartRef.current = timeRef.current;
      spawnEpochInitRef.current = true;
    }
    const spawnTime = timeRef.current - spawnEpochStartRef.current;
    // Mask kill (Phase AB): the Phase X mask image texture, the
    // same one the draw clip samples; null unless ready. Phase AE:
    // a terrain-derived sentinel source resolves to the live
    // derived bake through the same single resolution point.
    const killMaskState = config.gpgpuKillMask && config.gpgpuMaskSource
      ? resolveMapSourceTexture(config.gpgpuMaskSource, config)
      : null;
    const killMaskTex = killMaskState && killMaskState.ready ? killMaskState.texture : null;

    // Replica independent sim (Phase W2): while the stacks are
    // allocated, the simulation runs on the WebGL stack path —
    // the routing is resolved with the WebGPU backend masked out
    // so every downstream consumer (aux, sort, trails, readback,
    // draw) sees the merged WebGL layout exactly as in the
    // shared path.
    const replicaStacks = replicaStacksRef.current;
    const stacksActive = !!replicaStacks && replicaStacks.length > 0;
    const routing = resolveGpgpuFrameRouting({
      config,
      webgpuState: stacksActive ? null : webgpuStateRef.current,
      webgpuPosTexture: stacksActive ? null : webgpuPosTexRef.current,
      fallbackPosTexture: posOut.texture,
      posReadbackRef,
    });
    routingSnapshotRef.current = createGpgpuFrameDiagnosticSnapshot(routing);

    if (stacksActive) {
      runReplicaStackPasses({
        config,
        dt,
        time: timeRef.current,
        blast,
        mouseWorld: mouseWorldRef.current,
        simMesh: simMeshRef.current,
        gl: glCtx,
        simScene,
        simCamera,
        stacks: replicaStacks,
        mergedPosOut: posOut,
        mergedVelOut: velOut,
        mergeMat: replicaMergeMat,
        blitMat,
        initPosTex: initPosTexRef.current,
        attrTex: attrTexRef.current,
        morphTex: morphTexRef.current,
        morphNormalTex: morphNormalTexRef.current,
        morphKickStart: morphKickStartRef.current,
        fluidVelMat: velSimMat,
        globalTexSize: texSize,
        mouseWorldMulti,
        mouseMultiCount,
      });
    } else {
      // Rigid bodies (Phase AU): step the CPU solver HERE,
      // inside this useFrame and before the GPU passes, with the
      // same processed dt they consume (clamped, time-scale
      // locked) — the placement PHASE_AU_DETERMINISM.md proved
      // delivers the deterministic render's fixed dt series to a
      // CPU solver unchanged. The stepped state is packed into
      // the supply texture the position / velocity passes read.
      const rigidSolver = rigidSolverRef.current;
      if (rigidSolver && rigidBodyTexRef.current && rigidBodyDataRef.current) {
        const rigid = resolveRigid(config);
        stepRigidBodies(rigidSolver, dt * Math.max(0, config.gpgpuSpeed), {
          // Particle gravity: vel.y -= gravity · dt · 9.8 in the
          // velocity pass, and positions integrate vel · dt · 60,
          // so the world-space acceleration is gravity · 9.8 · 60.
          gravityY: -config.gpgpuGravity * 9.8 * 60,
          floorEnabled: config.gpgpuFloorEnabled,
          floorY: config.gpgpuFloorY,
          bounceRadius: config.gpgpuBounceRadius,
          restitution: rigid.restitution,
          friction: rigid.friction,
          glueEnabled: rigid.glueEnabled,
          glueStrength: rigid.glueStrength,
        });
        writeRigidBodyTexture(rigidSolver, rigidBodyDataRef.current);
        rigidBodyTexRef.current.needsUpdate = true;
      }
      // Vellum (Phase AR): the tear state's ping-pong for this
      // frame (the pool exists only while the tear key is live).
      const vellumState = vellumStateRtRef.current;
      const vellumStateIn = vellumState ? (vellumStatePingIsA.current ? vellumState.a : vellumState.b) : null;
      const vellumStateOut = vellumState ? (vellumStatePingIsA.current ? vellumState.b : vellumState.a) : null;
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
        attrTex: attrTexRef.current,
        morphTex: morphTexRef.current,
        morphNormalTex: morphNormalTexRef.current,
        morphKickStart: morphKickStartRef.current,
        prevPosTex: prevPosRTRef.current?.texture ?? null,
        spawnTime,
        killMaskTex,
        spawnOrderTex: spawnOrderTexRef.current,
        mouseWorldMulti,
        mouseMultiCount,
        vellumRestTex: vellumRestTexRef.current,
        vellumProjMat,
        vellumStateMat,
        vellumStateIn,
        vellumStateOut,
        vellumSpareRT: prevPosRTRef.current,
        blitMat,
        rigidCellTex: rigidCellTexRef.current,
        rigidBodyTex: rigidBodyTexRef.current,
        webgpuState: webgpuStateRef.current,
        webgpuPosTex: webgpuPosTexRef.current,
        webgpuPingIsARef,
      });
      // The state pass inside wrote stateOut; make it next
      // frame's input (only when it actually ran).
      if (vellumState && config.gpgpuVellumEnabled && (config.gpgpuVellumTear || 0) > 0) {
        vellumStatePingIsA.current = !vellumStatePingIsA.current;
      }
    }

    // Aux event emission (B3, WebGL path only — the WebGPU compute
    // backend has no aux pool, and its draw material simply never
    // activates). Reads the main pool's frame-start textures so death
    // and bounce events are located where they happened this frame.
    if (!routing.useWebGPU && config.gpgpuAuxMode !== 'none' && auxRtRef.current && simMeshRef.current) {
      const auxTargets = resolvePingPongTargets(auxRtRef.current, auxPingIsA.current);
      runAuxSimulationPasses({
        config,
        texSize,
        dt,
        time: timeRef.current,
        simMesh: simMeshRef.current,
        gl: glCtx,
        simScene,
        simCamera,
        mainPosTex: posIn.texture,
        mainVelTex: velIn.texture,
        auxPosIn: auxTargets.posIn,
        auxPosOut: auxTargets.posOut,
        auxVelIn: auxTargets.velIn,
        auxVelOut: auxTargets.velOut,
        auxVelMat,
        auxPosMat,
      });
      auxPingIsA.current = !auxPingIsA.current;
      auxDrawMat.uniforms.uAuxPosTex.value = auxTargets.posOut.texture;
      auxDrawMat.uniforms.uAuxVelTex.value = auxTargets.velOut.texture;
      // Child colour (Phase Q): an explicit child colour wins; the
      // empty default inherits the parent (main pool) colour exactly
      // as before.
      auxDrawMat.uniforms.uColor.value.setStyle(config.gpgpuAuxColor ? config.gpgpuAuxColor : config.gpgpuColor);
      auxDrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
      auxDrawMat.uniforms.uAuxSize.value = config.gpgpuAuxSize;
      auxDrawMat.blending = config.gpgpuBlendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
      auxDrawGeo.setDrawRange(0, Math.max(0, Math.min(16384, Math.round(config.gpgpuAuxCount))));

      // Aux chain (Phase W1): levels 2 and 3 run the same two-pass
      // machinery against the previous level's frame-start textures
      // (auxTargets / aux2Targets inputs), so every level locates
      // its events where they happened this frame. Level params and
      // gating come from lib/auxChain.ts; a level whose pool is not
      // allocated (depth lowered mid-session) is simply skipped.
      const chainLevels = resolveAuxChainLevels(config);
      const chainSrcCount = Math.max(0, Math.min(16384, Math.round(config.gpgpuAuxCount)));
      const level2 = chainLevels.find((l) => l.level === 2);
      if (level2 && aux2RtRef.current && simMeshRef.current) {
        const aux2Targets = resolvePingPongTargets(aux2RtRef.current, aux2PingIsA.current);
        runAuxChainSimulationPasses({
          config,
          dt,
          time: timeRef.current,
          simMesh: simMeshRef.current,
          gl: glCtx,
          simScene,
          simCamera,
          level: level2,
          srcPosTex: auxTargets.posIn.texture,
          srcVelTex: auxTargets.velIn.texture,
          srcCount: chainSrcCount,
          auxPosIn: aux2Targets.posIn,
          auxPosOut: aux2Targets.posOut,
          auxVelIn: aux2Targets.velIn,
          auxVelOut: aux2Targets.velOut,
          auxChainVelMat,
          auxChainPosMat,
        });
        aux2PingIsA.current = !aux2PingIsA.current;
        aux2DrawMat.uniforms.uAuxPosTex.value = aux2Targets.posOut.texture;
        aux2DrawMat.uniforms.uAuxVelTex.value = aux2Targets.velOut.texture;
        aux2DrawMat.uniforms.uColor.value.setStyle(resolveAuxLevelColor(config, 2));
        aux2DrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
        aux2DrawMat.uniforms.uAuxSize.value = level2.size;
        aux2DrawMat.blending = auxDrawMat.blending;

        const level3 = chainLevels.find((l) => l.level === 3);
        if (level3 && aux3RtRef.current && simMeshRef.current) {
          const aux3Targets = resolvePingPongTargets(aux3RtRef.current, aux3PingIsA.current);
          runAuxChainSimulationPasses({
            config,
            dt,
            time: timeRef.current,
            simMesh: simMeshRef.current,
            gl: glCtx,
            simScene,
            simCamera,
            level: level3,
            srcPosTex: aux2Targets.posIn.texture,
            srcVelTex: aux2Targets.velIn.texture,
            srcCount: chainSrcCount,
            auxPosIn: aux3Targets.posIn,
            auxPosOut: aux3Targets.posOut,
            auxVelIn: aux3Targets.velIn,
            auxVelOut: aux3Targets.velOut,
            auxChainVelMat,
            auxChainPosMat,
          });
          aux3PingIsA.current = !aux3PingIsA.current;
          aux3DrawMat.uniforms.uAuxPosTex.value = aux3Targets.posOut.texture;
          aux3DrawMat.uniforms.uAuxVelTex.value = aux3Targets.velOut.texture;
          aux3DrawMat.uniforms.uColor.value.setStyle(resolveAuxLevelColor(config, 3));
          aux3DrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
          aux3DrawMat.uniforms.uAuxSize.value = level3.size;
          aux3DrawMat.blending = auxDrawMat.blending;
        }
      }
    }

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
      attrTexture: attrTexRef.current,
      texSize,
      time: timeRef.current,
    });

  });

  // Flow-field glyph overlay (Phase AF2): mounted inside the
  // system so it shares the simulation clock (timeRef) exactly;
  // display-only, default off.
  return (
    <>
      <GpgpuRenderOutputs config={config} assets={assets} />
      {config.gpgpuFieldGlyphEnabled && (
        <GpgpuFieldGlyphs config={config} timeRef={timeRef} />
      )}
      {config.gpgpuMorphFiberEnabled && (
        <GpgpuMorphFibers config={config} />
      )}
    </>
  );
});

GpgpuSystem.displayName = 'GpgpuSystem';
