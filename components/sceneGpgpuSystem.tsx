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
  readbackParticleVelocities,
  type GpgpuFrameDiagnosticSnapshot,
} from './gpgpuDiagnostics';
import {
  DiagnosticAovRenderer,
  captureDiagnosticState,
  type DiagnosticFrameContext,
} from './gpgpuDiagnosticAov';
import { HashGridSampler } from './gpgpuHashGridDiagnostic';
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
  applyPyroGridCoupleUniforms,
  blitPreviousPositionPass,
  runAuxChainSimulationPasses,
  runAuxSimulationPasses,
  runFluidAdvectionPass,
  runReplicaStackPasses,
  runWhitewaterSimulationPasses,
  runSimulationPasses,
  updateMouseWorldPosition,
} from './gpgpuSimulationPasses';
import { REPLICA_MERGE_FRAG } from './gpgpuShaderReplica';
import { pyroGridCurrentScalarTexture, runPyroGridPasses } from './gpgpuPyroGridPasses';
import { EMPTY_PYRO_GRID_FOG_FEED, type PyroGridFogFeed } from '../lib/pyroGrid';
import { GpgpuAttrDynPass } from './gpgpuAttrDynPass';
import { buildAttrDynFragment } from '../lib/expressionGlsl';
import { GpgpuAttrFeedbackPass } from './gpgpuAttrFeedbackPass';
import { buildAttrFeedbackFragment } from '../lib/expressionGlslFeedback';
import {
  normalizeAttrExprs,
  normalizeAttrNames,
  resolveAttrDynInterval,
} from '../lib/gpgpuAttributes';
import { parseGpgpuGroups, resolveGroupGate } from '../lib/gpgpuGroups';
import { SIM_VERT } from './gpgpuShaders';
import { resolveAuxChainLevels, resolveAuxLevelColor } from '../lib/auxChain';
import { resolveRigid, stepRigidBodies, writeRigidBodyTexture } from '../lib/rigidBodies';
import { getTerrainHeightfield } from '../lib/terrainHeightfield';
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
  // Phase CB: the Pyro grid fog feed this system publishes to
  // (read by the volume-fog layers).
  pyroFeedRef?: MutableRefObject<PyroGridFogFeed>;
};

export const GpgpuSystem: FC<GpgpuSystemProps> = React.memo(({ audioRef, config, isPlaying, posReadbackRef, pointCloudCaptureRef, pyroFeedRef }) => {
  const { gl, camera } = useThree();
  // Phase DH (DA3 path B): the latest frame's simulation targets,
  // published for the ?diag=1 diagnostic hook below. Inert unless
  // the hook is registered (URL parameter), and the ref itself is
  // three assignments per frame.
  const diagFrameRef = useRef<DiagnosticFrameContext | null>(null);
  const diagPosBufRef = useRef<Float32Array | null>(null);
  const diagVelBufRef = useRef<Float32Array | null>(null);
  const diagFluidBufRef = useRef<Float32Array | null>(null);
  // Phase DL: the fluid pass's resolved final-field target for
  // this frame (see runFluidAdvectionPass). Whitewater and the
  // diagnostic hook read the field through this ref, never from
  // the ping state.
  const fluidFinalTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('diag') !== '1') return;
    let aov: DiagnosticAovRenderer | null = null;
    let aovTexSize = 0;
    let hashGrid: HashGridSampler | null = null;
    const hook = {
      captureState: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        const count = ctx.texSize * ctx.texSize;
        if (!diagPosBufRef.current || diagPosBufRef.current.length !== count * 4) {
          diagPosBufRef.current = new Float32Array(count * 4);
        }
        if (!diagVelBufRef.current || diagVelBufRef.current.length !== count * 4) {
          diagVelBufRef.current = new Float32Array(count * 4);
        }
        gl.readRenderTargetPixels(ctx.posOut, 0, 0, ctx.texSize, ctx.texSize, diagPosBufRef.current);
        readbackParticleVelocities({
          gl,
          velOut: ctx.velOut,
          texSize: ctx.texSize,
          velReadbackRef: diagVelBufRef,
        });
        const pos = diagPosBufRef.current;
        const vel = diagVelBufRef.current;
        if (!pos || !vel) return { error: 'readback-failed' };
        const state = captureDiagnosticState(pos, vel, ctx.texSize, ctx.ageMax);
        const stats: Record<string, unknown> = {};
        for (const [id, r] of Object.entries(state.passes)) stats[id] = r.stats;
        return { texSize: state.texSize, stateHash: state.stateHash, stats };
      },
      captureAov: (passId: string, width = 480, height = 300, speedMax = 0, pointSize = 2) => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!aov || aovTexSize !== ctx.texSize) {
          aov?.dispose();
          aov = new DiagnosticAovRenderer(ctx.texSize);
          aovTexSize = ctx.texSize;
        }
        let sm = speedMax;
        if (!(sm > 0)) {
          const s = hook.captureState();
          if ('error' in s) return s;
          sm = Math.max(0.0001, (s.stats.speed as { max: number }).max);
        }
        const img = aov.capture(gl, camera, ctx, passId, { width, height, speedMax: sm, pointSize });
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let lit = 0;
        const n = width * height;
        for (let i = 0; i < n; i++) {
          const r = img.pixels[i * 4];
          const g = img.pixels[i * 4 + 1];
          const b = img.pixels[i * 4 + 2];
          sr += r;
          sg += g;
          sb += b;
          if (r + g + b > 0) lit++;
        }
        return {
          passId,
          width,
          height,
          speedMaxUsed: sm,
          meanRgb: [sr / n, sg / n, sb / n].map((v) => Math.round(v * 100) / 100),
          litFraction: Math.round((lit / n) * 10000) / 10000,
        };
      },
      captureHashGrid: (gridSize: number) => {
        if (!hashGrid) hashGrid = new HashGridSampler();
        return hashGrid.sample(gl, gridSize);
      },
      captureHashGridBytes: (gridSize: number) => {
        if (!hashGrid) hashGrid = new HashGridSampler();
        return hashGrid.sampleBytes(gl, gridSize);
      },
      // Phase DL: one synchronous readback of the resolved
      // final fluid field (64×64, RGBA = (vx, vy, 0, 1)). The
      // buffer is reused between calls — callers must copy the
      // field synchronously before doing anything else.
      captureFluidField: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.fluidFinal) return { error: 'no-fluid-field' };
        const size = 64;
        if (!diagFluidBufRef.current || diagFluidBufRef.current.length !== size * size * 4) {
          diagFluidBufRef.current = new Float32Array(size * size * 4);
        }
        gl.readRenderTargetPixels(ctx.fluidFinal, 0, 0, size, size, diagFluidBufRef.current);
        return { size, field: diagFluidBufRef.current, target: ctx.fluidFinalName };
      },
    };
    (window as unknown as { __kaloDiag?: typeof hook }).__kaloDiag = hook;
    return () => {
      delete (window as unknown as { __kaloDiag?: typeof hook }).__kaloDiag;
      aov?.dispose();
      hashGrid?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    vellumVelMat,
    auxVelMat,
    auxPosMat,
    auxChainVelMat,
    auxChainPosMat,
    wwVelMat,
    wwPosMat,
    wwDrawMat,
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
    flipVorticityCurlMat,
    flipVorticityForceMat,
    pyroAdvectVelMat,
    pyroAdvectScalarMat,
    pyroForcesVelMat,
    pyroScalarUpdateMat,
    pyroDivergenceMat,
    pyroJacobiMat,
    pyroSubtractMat,
    pyroCurlMat,
    pyroVorticityForceMat,
    pyroClearMat,
    drawGeo,
    streakGeo,
    auxDrawGeo,
    auxDrawMat,
    trailRTs,
    trailHead,
  } = assets;

  // Phase BV: attribute feedback. The feedback fragment is
  // null unless the key is on AND at least one compilable slot
  // expression references p — with a null fragment the feedback
  // pass is never built (the structural identity guarantee,
  // same discipline as BO below). When the feedback fragment
  // exists it takes over the stage-2 re-evaluation and the BO
  // fragment is suppressed, so the two passes never both run.
  // Phase CV: while a baked group (snapshot/composite) gates the
  // forces, its membership lives in the static bake's spare slot
  // channel — the BO/BV re-evaluation passes would overwrite that
  // channel with expression results, so they stand down and every
  // consumer keeps the bake verbatim (predicate groups are
  // unaffected: the shader evaluates them from the live texture).
  const groupGateBaked = resolveGroupGate(
    parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
    config.gpgpuGroupRef ?? '',
  ).kind === 'baked';
  const attrFeedbackFragment = !groupGateBaked && config.gpgpuAttrFeedbackEnabled
    ? buildAttrFeedbackFragment(config.gpgpuAttrExprs, config.gpgpuAttrNames)
    : null;
  const attrFeedbackSignature = attrFeedbackFragment
    ? `fb|${JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs))}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${resolveAttrDynInterval(config.gpgpuAttrDynInterval)}|${texSize}`
    : '';
  const attrFeedbackPassRef = useRef<GpgpuAttrFeedbackPass | null>(null);
  const attrFeedbackSignatureRef = useRef('');
  const attrFeedbackTextureRef = useRef<THREE.Texture | null>(null);
  const attrFeedbackFrameRef = useRef(0);

  // Phase BO: dynamic attribute re-evaluation (stage 2). The
  // generated fragment is null unless the key is on AND at least
  // one slot expression compiles to GLSL — with a null fragment
  // the pass is never built and every consumer keeps the bake
  // texture verbatim (the structural identity guarantee). The
  // signature covers everything the pass depends on, so the
  // useFrame below rebuilds it only when one of them changes.
  const attrDynFragment = !groupGateBaked && !attrFeedbackFragment && config.gpgpuAttrDynEnabled
    ? buildAttrDynFragment(config.gpgpuAttrExprs, config.gpgpuAttrNames)
    : null;
  const attrDynInterval = resolveAttrDynInterval(config.gpgpuAttrDynInterval);
  const attrDynSignature = attrDynFragment
    ? `${JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs))}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${attrDynInterval}|${texSize}`
    : '';
  const attrDynPassRef = useRef<GpgpuAttrDynPass | null>(null);
  const attrDynSignatureRef = useRef('');
  const attrDynTextureRef = useRef<THREE.Texture | null>(null);
  const attrDynFrameRef = useRef(0);

  useEffect(() => () => {
    attrDynPassRef.current?.dispose();
    attrDynPassRef.current = null;
    attrFeedbackPassRef.current?.dispose();
    attrFeedbackPassRef.current = null;
  }, []);

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
    rigidCellTexRef,
    rigidBodyTexRef,
    rigidBodyDataRef,
    rigidSolverRef,
    pyroGridRef,
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
      flipVorticityCurlMat,
      flipVorticityForceMat,
      fluidFinalTargetRef,
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

    // Phase BO: run the stage-2 attribute pass here — after the
    // deterministic guard, before every consumer. On frame
    // counter multiples of the interval the expressions are
    // re-evaluated against the bake with t = the sim clock;
    // between runs the held output is reused. With no fragment
    // (disabled, or nothing compilable) the pass is disposed
    // and the consumers below receive the bake texture verbatim.
    // Phase BV: while the feedback fragment exists, the
    // feedback pass runs INSTEAD (the BO fragment is suppressed
    // above, so its branch below only disposes the dyn pass).
    // The cadence is shared with BO: on frame counter multiples
    // of the interval the state advances by one evaluation —
    // the state is a function of the evaluation count, not of
    // the frame count (brief J3). A bake texture change resets
    // the state inside the pass (p restarts from the bake).
    let attrDynTexture: THREE.Texture | null = null;
    if (attrFeedbackFragment) {
      if (attrFeedbackSignatureRef.current !== attrFeedbackSignature || !attrFeedbackPassRef.current) {
        attrFeedbackSignatureRef.current = attrFeedbackSignature;
        attrFeedbackPassRef.current?.dispose();
        attrFeedbackPassRef.current = new GpgpuAttrFeedbackPass(texSize, attrFeedbackFragment);
        attrFeedbackTextureRef.current = null;
        attrFeedbackFrameRef.current = 0;
      }
      const attrFeedbackPass = attrFeedbackPassRef.current;
      const bakeAttrTex = attrTexRef.current;
      if (attrFeedbackPass && bakeAttrTex) {
        if (attrFeedbackFrameRef.current % attrDynInterval === 0) {
          attrFeedbackTextureRef.current = attrFeedbackPass.run(glCtx, bakeAttrTex, timeRef.current);
        }
        attrDynTexture = attrFeedbackTextureRef.current;
      }
      attrFeedbackFrameRef.current += 1;
    } else if (attrFeedbackPassRef.current) {
      attrFeedbackPassRef.current.dispose();
      attrFeedbackPassRef.current = null;
      attrFeedbackTextureRef.current = null;
      attrFeedbackSignatureRef.current = '';
      attrFeedbackFrameRef.current = 0;
    }
    if (attrDynFragment) {
      if (attrDynSignatureRef.current !== attrDynSignature || !attrDynPassRef.current) {
        attrDynSignatureRef.current = attrDynSignature;
        attrDynPassRef.current?.dispose();
        attrDynPassRef.current = new GpgpuAttrDynPass(texSize, attrDynFragment);
        attrDynTextureRef.current = null;
        attrDynFrameRef.current = 0;
      }
      const attrDynPass = attrDynPassRef.current;
      const bakeAttrTex = attrTexRef.current;
      if (attrDynPass && bakeAttrTex) {
        if (attrDynFrameRef.current % attrDynInterval === 0) {
          attrDynTextureRef.current = attrDynPass.run(glCtx, bakeAttrTex, timeRef.current);
        }
        attrDynTexture = attrDynTextureRef.current;
      }
      attrDynFrameRef.current += 1;
    } else if (attrDynPassRef.current) {
      attrDynPassRef.current.dispose();
      attrDynPassRef.current = null;
      attrDynTextureRef.current = null;
      attrDynSignatureRef.current = '';
      attrDynFrameRef.current = 0;
    }
    // Sim-side consumers (the force drive / the group gate) read
    // the re-evaluated texture on the WebGL route only; on the
    // WebGPU route they keep the bake (declared gap, Phase BO
    // brief; Phase BV inherits it for the feedback texture and
    // declares it in the capability registry). The draw readout
    // (syncVisualUniforms below) always reads the re-evaluated
    // texture.
    const simAttrTex = !routing.useWebGPU && attrDynTexture ? attrDynTexture : attrTexRef.current;

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
        attrTex: simAttrTex,
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
          // Terrain floor (Phase BA): the published erosion
          // heightfield, resolved only while the Floor Terrain
          // key is on; null (key off, or no baked field) keeps
          // the flat plane at floorY verbatim.
          heightfield: rigid.floorTerrain ? getTerrainHeightfield(config) : null,
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
      // frame (the pool exists only while a severing rule is
      // live — tear, or Phase BB's glue break).
      const vellumState = vellumStateRtRef.current;
      const vellumStateIn = vellumState ? (vellumStatePingIsA.current ? vellumState.a : vellumState.b) : null;
      const vellumStateOut = vellumState ? (vellumStatePingIsA.current ? vellumState.b : vellumState.a) : null;
      // Pyro grid coupling (Phase CB): fill the velocity
      // material's pyro uniforms from the grid's latest
      // completed step, right before the passes consume the
      // material (the grid steps later in this frame, so the
      // coupling reads the previous frame's field — the
      // standard one-frame lag of a staggered coupling).
      applyPyroGridCoupleUniforms({
        config,
        velSimMat,
        targets: pyroGridRef.current,
        useWebGPU: routing.useWebGPU,
      });
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
        attrTex: simAttrTex,
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
        vellumVelMat,
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
      // frame's input (only when it actually ran — the tear
      // rule, or Phase BB's glue-break rule).
      if (vellumState && config.gpgpuVellumEnabled
        && ((config.gpgpuVellumTear || 0) > 0
          || ((config.gpgpuVellumGlue || 0) > 0 && (config.gpgpuVellumGlueBreak || 0) > 0))) {
        vellumStatePingIsA.current = !vellumStatePingIsA.current;
      }
    }

    // Pyro grid (Phase CA, WebGL path only — the WebGPU compute
    // backend has no grid solver; round-2 spec: while WebGPU is
    // active the grid is ineffective). Phase CB couples it both
    // ways out: the particle coupling reads the previous step
    // (filled before runSimulationPasses above), and the fog
    // feed below publishes this step's scalar field. It steps
    // here, after routing is resolved, with the frame's dt.
    if (!routing.useWebGPU && config.gpgpuPyroGridEnabled && pyroGridRef.current && simMeshRef.current) {
      runPyroGridPasses({
        config,
        targets: pyroGridRef.current,
        materials: {
          pyroAdvectVelMat,
          pyroAdvectScalarMat,
          pyroForcesVelMat,
          pyroScalarUpdateMat,
          pyroDivergenceMat,
          pyroJacobiMat,
          pyroSubtractMat,
          pyroCurlMat,
          pyroVorticityForceMat,
          pyroClearMat,
        },
        simMesh: simMeshRef.current,
        gl: glCtx,
        simScene,
        simCamera,
        dt,
      });
    }

    // Fog feed (Phase CB): publish the scalar field the fog
    // layers sample. Cleared whenever the grid did not step
    // this frame (disabled, WebGPU session, or no targets), so
    // a stale field can never linger into a grid-off frame.
    if (pyroFeedRef) {
      const feedTargets = pyroGridRef.current;
      if (!routing.useWebGPU && config.gpgpuPyroGridEnabled && feedTargets && feedTargets.framesStepped > 0) {
        pyroFeedRef.current = {
          texture: pyroGridCurrentScalarTexture(feedTargets),
          resolution: feedTargets.resolution,
          floatLinear: feedTargets.floatLinear,
        };
      } else if (pyroFeedRef.current.texture) {
        pyroFeedRef.current = EMPTY_PYRO_GRID_FOG_FEED;
      }
    }

    // Whitewater (Phase BC, WebGL path only — the WebGPU compute
    // backend has no foam pool, and its draw material simply never
    // activates). Reads the field texture the fluid pass produced
    // this frame (the projected FLIP field) and the foam pool's
    // own ping-pong pair; foam never writes back into the field.
    if (!routing.useWebGPU && config.gpgpuWhitewaterEnabled && config.gpgpuFluidEnabled && config.gpgpuFlipEnabled && wwRtRef.current && simMeshRef.current) {
      // Phase DL: read the field through the fluid pass's
      // resolved final-field target — with vorticity
      // confinement on, the projected field lands outside the
      // ping target the legacy resolution below would pick.
      const fluidTex = fluidFinalTargetRef.current?.texture
        ?? (fluidPingIsA.current ? fluidRTARef.current : fluidRTBRef.current)?.texture ?? null;
      if (fluidTex) {
        const wwTargets = resolvePingPongTargets(wwRtRef.current, wwPingIsA.current);
        runWhitewaterSimulationPasses({
          config,
          dt,
          time: timeRef.current,
          simMesh: simMeshRef.current,
          gl: glCtx,
          simScene,
          simCamera,
          fluidTex,
          wwPosIn: wwTargets.posIn,
          wwPosOut: wwTargets.posOut,
          wwVelIn: wwTargets.velIn,
          wwVelOut: wwTargets.velOut,
          wwVelMat,
          wwPosMat,
        });
        wwPingIsA.current = !wwPingIsA.current;
        wwDrawMat.uniforms.uWwPosTex.value = wwTargets.posOut.texture;
        wwDrawMat.uniforms.uWwVelTex.value = wwTargets.velOut.texture;
        wwDrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
        wwDrawMat.uniforms.uWwSize.value = config.gpgpuWhitewaterSize;
        wwDrawMat.blending = config.gpgpuBlendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
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

    // Phase DH (DA3 path B): publish this frame's targets for the
    // ?diag=1 diagnostic hook. Plain assignments; the hook reads
    // them only when explicitly invoked.
    diagFrameRef.current = {
      posOut,
      velOut,
      texSize,
      ageMax: config.gpgpuAgeMax,
      extent: config.gpgpuBounceRadius,
      fluidFinal: fluidFinalTargetRef.current,
      fluidFinalName:
        fluidFinalTargetRef.current === fluidRTARef.current
          ? 'fluidRTA'
          : fluidFinalTargetRef.current === fluidRTBRef.current
            ? 'fluidRTB'
            : null,
    };

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
      attrTexture: attrDynTexture ?? attrTexRef.current,
      texSize,
      time: timeRef.current,
      viewportSizePx: { x: gl.domElement.width, y: gl.domElement.height },
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
