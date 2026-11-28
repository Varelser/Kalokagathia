import React, { useEffect, useMemo, useRef } from 'react';
import type { FC, MutableRefObject, RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import { registerStateCacheFrameProvider } from '../lib/gpgpuStateCacheCapture';
import { trailAuxActive } from '../lib/trailAux';
import { LodSystem } from '../lib/lodSystem';
import { ATTRACTOR_RING_Z_SHIFT } from '../lib/attractorSpace';
import { scaleFrameDelta } from '../lib/playbackTime';
import { useGpgpuAssets } from './useGpgpuAssets';
import { getTexSize, useGpgpuRuntime } from './useGpgpuRuntime';
import { emissionMaskVariantActive } from '../lib/gpgpuEmissionSource';
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
import { refreshWebGPUDiagSnapshot } from '../lib/webgpuCompute';
import { describeWebGPUDiagSnapshot } from '../lib/webgpuDiagSnapshot';
import { HashGridSampler } from './gpgpuHashGridDiagnostic';
import {
  getMotionBlurPassDiagState,
  getMotionCaptureDiagState,
  getMotionVelocitySource,
  motionVelocityStatsFromReadback,
  setMotionSimFrameSource,
} from '../lib/motionBlur';
import { readbackWebGPUPositions } from '../lib/webgpuCompute';
import { armAuxPassLandingProbe, getAuxPassDiagState } from '../lib/auxPassDiag';
import { getAuxTrailAbDiagState, requestAuxTrailAbStage } from '../lib/auxTrailAbDiag';
import {
  armAuxTickProbe,
  getAuxTickProbeState,
  type AuxTickProbeSide,
} from '../lib/auxTickProbeDiag';
import { AUX_TRAIL_AB_STAGES } from './gpgpuShaderAux';
import type { AuxTrailAbStage } from './gpgpuShaderAux';
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
  SDF_SHAPE_IDS,
} from './gpgpuSimulationPasses';
import { REPLICA_MERGE_FRAG } from './gpgpuShaderReplica';
import { pyroGridCurrentScalarTexture, runPyroGridPasses } from './gpgpuPyroGridPasses';
import { applyFlip3dCoupleUniforms, runFlip3dPasses } from './gpgpuFlip3dPasses';
import { EMPTY_PYRO_GRID_FOG_FEED, type PyroGridFogFeed } from '../lib/pyroGrid';
import { labelVellumComponents } from '../lib/gpgpuVellum';
import { GpgpuAttrDynPass } from './gpgpuAttrDynPass';
import { GpgpuAttrDensityPass } from './gpgpuAttrDensityPass';
import { GpgpuRuleEvalPass } from './gpgpuRuleEvalPass';
import { GpgpuContactPass } from './gpgpuContactPass';
import { GpgpuPredationHoldPass } from './gpgpuPredationHoldPass';
import {
  buildRuleAttrWriteFragment,
  buildRuleEvalFragment,
  classifyLiveRules,
  resolveLiveParticleRules,
} from '../lib/gpgpuParticleRulesLive';
import { buildAttrMappingFragment, parseAttrMappings } from '../lib/gpgpuAttrMappings';
import {
  resolveLiveRulesWithPredation,
  resolvePredation,
} from '../lib/gpgpuPredation';
import { resolveMergedSupplyPlan } from '../lib/gpgpuMergedSupply';
import { resolveRepTwoPhase } from '../lib/pipelineCross';
import { getColumnSupply } from '../lib/gpgpuPathAssets';
import {
  PARTICLE_DENSITY_SCALE,
  PARTICLE_DENSITY_SPLAT_GAIN,
  resolveParticleDensityLayers,
  setParticleDensitySource,
} from '../lib/particleDensity';
import { volumeDensityOn } from '../lib/lightVolume';
import { buildAttrDynFragment } from '../lib/expressionGlsl';
import { GpgpuAttrFeedbackPass } from './gpgpuAttrFeedbackPass';
import { GpgpuSpinPass } from './gpgpuSpinPass';
import { resolveSpin, spinChannelActive } from '../lib/gpgpuSpeedDragSpin';
import { GpgpuOrientPass, computeVelocityAlignStats, getActiveOrientPass } from './gpgpuOrientPass';
import { getActiveAuxMaterials } from './useGpgpuSimulationAssets';
import { orientChannelActive, resolveOrient } from '../lib/gpgpuOrient';
import {
  resolveActiveStateCachePlaybackFrame,
  type StateCachePlaybackFrameData,
} from '../lib/gpgpuStateCachePlayback';
import { buildAttrFeedbackFragment } from '../lib/expressionGlslFeedback';
import { buildAttrChainFragment } from '../lib/expressionGlslChain';
import {
  normalizeAttrExprs,
  normalizeAttrNames,
  normalizeAttrNames2,
  resolveAttrDynInterval,
} from '../lib/gpgpuAttributes';
import { parseGpgpuGroups, resolveGroupGate } from '../lib/gpgpuGroups';
import { SIM_VERT } from './gpgpuShaders';
import { resolveAuxChainLevels, resolveAuxLevelColor } from '../lib/auxChain';
import { advanceSpawnEnvelopeClock, resolveSpawnEnvelope } from '../lib/gpgpuSpawnAllocator';
import { drainRigidContactEvents, fillRigidCurlAccel, fillRigidCurlAngAccel, resolveRigid, rigidCurlParamsFromConfig, stepRigidBodies, writeRigidBodyTexture, RIGID_BODY_MAX } from '../lib/rigidBodies';
import { fireEventRulesLive, getEventRuleActionPerformer } from '../lib/eventRules';
import { getTerrainHeightfield } from '../lib/terrainHeightfield';
import { resolveMapSourceTexture } from '../lib/terrainDerivedMaps';
import { getLightShadowSource } from '../lib/lightShadowMap';
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

// Shine density splat (Phase 22 stage 2): the main layer's
// points drawn additively into the quarter-resolution density
// target. The vertex mirrors the draw pass's BASE point-size
// formula (uSize with the same distance attenuation; per-point
// size multipliers — species / age curves / maps — are not
// replicated: the field is an attenuation approximation, and
// the additive splat is order-independent, so the draw's sort
// texture is irrelevant here). Raw sim positions are used (a
// ring-offset scene reads the un-offset cloud — recorded
// approximation of this stage).

// True shadow map (Phase 30 stage 3): sync one aux draw
// material from the shared light-shadow store — the same
// guarded writes and not-ready contract as the points / geom
// blocks in gpgpuVisualUpdates (no source -> ready 0 ->
// kaloShadowFactor returns exactly 1.0).
function syncAuxShadowMapUniforms(mat: THREE.ShaderMaterial, config: ParticleConfig): void {
  if (!mat.uniforms.uShadowMapTex) return;
  const smapSource = getLightShadowSource();
  if (smapSource) {
    mat.uniforms.uShadowMapTex.value = smapSource.texture;
    if (mat.uniforms.uLightViewProj) {
      (mat.uniforms.uLightViewProj.value as THREE.Matrix4).copy(smapSource.viewProj);
    }
    if (mat.uniforms.uShadowMapReady) mat.uniforms.uShadowMapReady.value = 1;
  } else {
    if (mat.uniforms.uShadowMapReady) mat.uniforms.uShadowMapReady.value = 0;
  }
  if (mat.uniforms.uShadowMapBias) mat.uniforms.uShadowMapBias.value = config.gpgpuShadowMapBias;
  if (mat.uniforms.uShadowMapSoftness) mat.uniforms.uShadowMapSoftness.value = config.gpgpuShadowMapSoftness;
  if (mat.uniforms.uShadowMapStrength) mat.uniforms.uShadowMapStrength.value = Math.min(1, Math.max(0, config.gpgpuShadowMapStrength));
}

const SHINE_DENSITY_SPLAT_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform float uSize;
uniform float uScale;
void main() {
  vec4 posData = texture2D(uPosTex, aTexCoord);
  vec4 mvPos = modelViewMatrix * vec4(posData.xyz, 1.0);
  float dist = -mvPos.z;
  float ps = max(0.5, uSize * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
  gl_PointSize = max(1.0, ps * uScale);
  gl_Position = projectionMatrix * mvPos;
}
`;
const SHINE_DENSITY_SPLAT_FRAG = /* glsl */ `
precision highp float;
uniform float uGain;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float d2 = dot(pc, pc);
  if (d2 > 0.25) discard;
  float w = smoothstep(0.25, 0.0, d2);
  gl_FragColor = vec4(vec3(uGain * w), 1.0);
}
`;

export const GpgpuSystem: FC<GpgpuSystemProps> = React.memo(({ audioRef, config, isPlaying, posReadbackRef, pointCloudCaptureRef, pyroFeedRef }) => {
  const { gl, camera } = useThree();
  // Phase DH (DA3 path B): the latest frame's simulation targets,
  // published for the ?diag=1 diagnostic hook below. Inert unless
  // the hook is registered (URL parameter), and the ref itself is
  // three assignments per frame.
  const diagFrameRef = useRef<DiagnosticFrameContext | null>(null);
  const diagPosBufRef = useRef<Float32Array | null>(null);
  const diagVelBufRef = useRef<Float32Array | null>(null);
  const diagOrientBufRef = useRef<Float32Array | null>(null);
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
    // Gate measurement support (2026-11-27 re-gate): last fresh
    // WebGPU position readback, kept so the readback helper's
    // fallback (which returns the passed-in buffer) can be told
    // apart from a fresh result by reference.
    let webgpuLast: Float32Array | null = null;
    let hashGrid: HashGridSampler | null = null;
    // Grains spike (Phase 31 prep): previous captureGrainsMetrics
    // snapshot, kept inside the hook closure so a second call can
    // report the neighbour-set delta (metric A6) without shipping
    // raw pair lists to the caller. Null until the first call.
    let grainsPrev: {
      count: number;
      pairCount: number;
      pairKeys: Set<number>;
      pairKeysTruncated: boolean;
      ages: Float32Array;
    } | null = null;
    const hook = {
      captureState: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        // Stage 0 S7 (plan A1): on the WebGPU route the WebGL
        // targets below are never advanced by the simulation,
        // so reading them returns frozen pre-route snapshots
        // (alternating A/B). Serve the latest completed WebGPU
        // diagnostic snapshot instead, with freshness metadata;
        // while none exists, report not-ready rather than
        // returning the frozen targets. The call also kicks the
        // next snapshot refresh, so repeated calls converge to
        // fresh data. The WebGL path below is unchanged.
        if (ctx.route === 'webgpu') {
          const wg = ctx.webgpuState;
          if (!wg) return { error: 'diag-snapshot-not-ready', route: 'webgpu' as const, available: false, stale: true, frame: null, capturedAtMs: null, latestFrame: 0 };
          refreshWebGPUDiagSnapshot(wg);
          const meta = describeWebGPUDiagSnapshot(wg.diagSnapshot, wg.diagFrameCounter, performance.now());
          const snap = wg.diagSnapshot;
          if (!snap) return { error: 'diag-snapshot-not-ready', ...meta };
          const state = captureDiagnosticState(snap.positions, snap.velocities, ctx.texSize, ctx.ageMax);
          const stats: Record<string, unknown> = {};
          for (const [id, r] of Object.entries(state.passes)) stats[id] = r.stats;
          return { texSize: state.texSize, stateHash: state.stateHash, stats, ...meta };
        }
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
      // Gate measurement support (2026-11-27): per-particle aggregates
      // that captureState's pass stats cannot express — tangentiality
      // and angular momentum about a caller-supplied axis (A4 re-gate),
      // and the parked-particle fraction counted directly from the
      // position buffer (D2 re-gate). Diag-only: registered solely
      // under ?diag=1 like the rest of this hook, never called by the
      // app itself, and read-only over the same readback buffers.
      captureParticleAggregates: (axis?: [number, number, number]) => {
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
        const radii = new Float32Array(count);
        let sumR = 0;
        let sumV = 0;
        let maxR = 0;
        let parked = 0;
        for (let i = 0; i < count; i++) {
          const px = pos[i * 4]; const py = pos[i * 4 + 1]; const pz = pos[i * 4 + 2];
          const r = Math.hypot(px, py, pz);
          radii[i] = r;
          sumR += r;
          if (r > maxR) maxR = r;
          if (r > 1000) parked++;
          sumV += Math.hypot(vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2]);
        }
        const sorted = Float32Array.from(radii).sort();
        const pick = (q: number) => sorted[Math.min(count - 1, Math.floor(q * count))];
        const out: Record<string, unknown> = {
          count,
          meanAbsPos: sumR / count,
          posP50: pick(0.5),
          posP99: pick(0.99),
          posMax: maxR,
          meanAbsVel: sumV / count,
          parkedFraction: parked / count,
        };
        if (axis) {
          let ax = axis[0]; let ay = axis[1]; let az = axis[2];
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al;
          let tanSum = 0;
          let tanN = 0;
          let angSum = 0;
          let angPos = 0;
          let angN = 0;
          for (let i = 0; i < count; i++) {
            const px = pos[i * 4]; const py = pos[i * 4 + 1]; const pz = pos[i * 4 + 2];
            const vx = vel[i * 4]; const vy = vel[i * 4 + 1]; const vz = vel[i * 4 + 2];
            const r = radii[i];
            const v = Math.hypot(vx, vy, vz);
            if (r > 1e-6 && v > 1e-6) {
              tanSum += Math.abs((vx * px + vy * py + vz * pz) / (v * r));
              tanN++;
              const lx = py * vz - pz * vy;
              const ly = pz * vx - px * vz;
              const lz = px * vy - py * vx;
              const la = lx * ax + ly * ay + lz * az;
              angSum += la;
              if (la > 0) angPos++;
              angN++;
            }
          }
          out.axis = [ax, ay, az];
          out.tangentiality = tanN ? tanSum / tanN : null;
          out.angMomMean = angN ? angSum / angN : null;
          out.angMomSignRate = angN ? angPos / angN : null;
          out.angMomCount = angN;
        }
        return out;
      },
      // Gate measurement support (2026-11-27 re-gate): raw
      // per-particle position/velocity readback over the same
      // buffers captureState uses. For measurements the pass
      // stats cannot express (1-frame Δv, exact park fraction).
      // Read-only, diag-only like the rest of this hook.
      captureParticlesRaw: () => {
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
        return { texSize: ctx.texSize, pos: Array.from(pos), vel: Array.from(vel) };
      },
      // Gate measurement support (stage-4 gate fix round 2):
      // the motion-blur velocity field, read back from the
      // target the capture published through the shared store,
      // plus the capture's own diag counters — together they
      // separate "capture never published" (published=false /
      // skip reasons) from "published but empty" (coverage 0)
      // from "field present" (the stage's binding is then the
      // only remaining suspect). Read-only, diag-only.
      captureMotionVelocityStats: () => {
        const capture = getMotionCaptureDiagState();
        const src = getMotionVelocitySource();
        if (!src) return { published: false, capture };
        if (!src.target) return { published: true, capture, error: 'no-target-published' };
        const width = src.target.width;
        const height = src.target.height;
        // The velocity target is HalfFloatType; three returns
        // the half bits verbatim, decoded by the stats helper.
        const buf = new Uint16Array(width * height * 4);
        gl.readRenderTargetPixels(src.target, 0, 0, width, height, buf);
        const stats = motionVelocityStatsFromReadback(buf);
        return { published: true, capture, width, height, ...stats };
      },
      // Gate measurement support (stage-4 gate fix round 3):
      // the motion-blur PASS side of the same separation —
      // what the most recent render actually bound (the ready
      // flag it set and the bound texture's dimensions),
      // recorded by the pass itself as it reads the shared
      // store in render(). With captureMotionVelocityStats
      // this closes the loop without pixel inference:
      // published + pass renders with lastVelocityReady true
      // means the stage really gathers. Read-only, diag-only.
      captureMotionBlurPassStats: () => getMotionBlurPassDiagState(),
      // Gate measurement support: the contact pass's latest
      // record, aggregated (.r = hits accumulated, .g = hit of
      // the latest step). For the hit lighting rate and the
      // hits distribution, which REP condBits only expose
      // per-rule.
      captureContactStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.contactTarget) return { error: 'no-contact-pass', suppressed: ctx.contactSuppressed };
        const size = ctx.contactTarget.width;
        const count = size * size;
        const buf = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.contactTarget, 0, 0, size, size, buf);
        let hit = 0;
        let ge1 = 0;
        let ge3 = 0;
        let sum = 0;
        for (let i = 0; i < count; i++) {
          const hits = buf[i * 4];
          if (buf[i * 4 + 1] > 0.5) hit++;
          if (hits >= 0.5) ge1++;
          if (hits >= 2.5) ge3++;
          sum += hits;
        }
        return {
          texSize: size,
          count,
          hitRate: hit / count,
          hitsGe1Rate: ge1 / count,
          hitsGe3Rate: ge3 / count,
          hitsMean: sum / count,
          suppressed: ctx.contactSuppressed,
        };
      },
      // Gate measurement support (2026-11-27 re-gate 2): the
      // Aux level-1 inheritance texture read back directly —
      // the same RT the Aux draw material samples — aggregated
      // over the active child texels (Aux position not in the
      // park form (0, -9999, 0)). For the C4-1 reach premise:
      // whether the inherited colour values actually arrive in
      // the texture the draw consumes, separated from what the
      // screenshot ratios can show. Read-only, diag-only.
      captureInheritStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.auxInheritTarget) return { error: 'no-inherit-target' };
        if (!ctx.auxPosLatest) return { error: 'no-aux' };
        const size = ctx.auxInheritTarget.width;
        if (ctx.auxPosLatest.width !== size) return { error: 'size-mismatch' };
        const count = size * size;
        const rgb = new Float32Array(count * 4);
        const pos = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.auxInheritTarget, 0, 0, size, size, rgb);
        gl.readRenderTargetPixels(ctx.auxPosLatest, 0, 0, size, size, pos);
        let active = 0;
        let nzActive = 0;
        let nearActive = 0;
        let nzAll = 0;
        let nearAll = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let i = 0; i < count; i++) {
          const r = rgb[i * 4];
          const g = rgb[i * 4 + 1];
          const b = rgb[i * 4 + 2];
          const nz = r !== 0 || g !== 0 || b !== 0;
          const near = r >= 0.8 && g <= 0.2 && b <= 0.2;
          if (nz) nzAll++;
          if (near) nearAll++;
          if (pos[i * 4 + 1] > -9000) {
            active++;
            sr += r;
            sg += g;
            sb += b;
            if (nz) nzActive++;
            if (near) nearActive++;
          }
        }
        return {
          texSize: size,
          count,
          activeCount: active,
          nonzeroActiveRate: active ? nzActive / active : 0,
          nearParentActiveRate: active ? nearActive / active : 0,
          nonzeroAllRate: nzAll / count,
          nearParentAllRate: nearAll / count,
          meanRgbActive: active ? [sr / active, sg / active, sb / active] : [0, 0, 0],
        };
      },
      // Gate measurement support (2026-11-27 stage-2 confirm):
      // the level-2 (chain) counterpart of captureInheritStats —
      // the Aux2 inheritance texture read back directly (the
      // same RT the Aux2 draw material samples), aggregated over
      // the active grandchild texels (Aux2 position not in the
      // park form). Same yardstick as level 1: nonzero rate and
      // near-parent-slot rate over active texels. Read-only,
      // diag-only.
      captureInherit2Stats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.aux2InheritTarget) return { error: 'no-inherit2-target' };
        if (!ctx.aux2PosLatest) return { error: 'no-aux2' };
        const size = ctx.aux2InheritTarget.width;
        if (ctx.aux2PosLatest.width !== size) return { error: 'size-mismatch' };
        const count = size * size;
        const rgb = new Float32Array(count * 4);
        const pos = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.aux2InheritTarget, 0, 0, size, size, rgb);
        gl.readRenderTargetPixels(ctx.aux2PosLatest, 0, 0, size, size, pos);
        let active = 0;
        let nzActive = 0;
        let nearActive = 0;
        let nzAll = 0;
        let nearAll = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let i = 0; i < count; i++) {
          const r = rgb[i * 4];
          const g = rgb[i * 4 + 1];
          const b = rgb[i * 4 + 2];
          const nz = r !== 0 || g !== 0 || b !== 0;
          const near = r >= 0.8 && g <= 0.2 && b <= 0.2;
          if (nz) nzAll++;
          if (near) nearAll++;
          if (pos[i * 4 + 1] > -9000) {
            active++;
            sr += r;
            sg += g;
            sb += b;
            if (nz) nzActive++;
            if (near) nearActive++;
          }
        }
        return {
          texSize: size,
          count,
          activeCount: active,
          nonzeroActiveRate: active ? nzActive / active : 0,
          nearParentActiveRate: active ? nearActive / active : 0,
          nonzeroAllRate: nzAll / count,
          nearParentAllRate: nearAll / count,
          meanRgbActive: active ? [sr / active, sg / active, sb / active] : [0, 0, 0],
        };
      },
      // Gate measurement support (2026-11-27 stage-2 B-group):
      // the spin channel's state texture read back directly —
      // circular mean angle and circular variance of .x over
      // all texels, plus the mean angular velocity (.y). The
      // B3 gate compares two captures to measure the mean
      // angle advance. Read-only, diag-only.
      captureSpinStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.spinTarget) return { error: 'no-spin-target' };
        const size = ctx.spinTarget.width;
        const count = size * size;
        const buf = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.spinTarget, 0, 0, size, size, buf);
        let sc = 0;
        let ss = 0;
        let sumOmega = 0;
        let sumAngleRaw = 0;
        for (let i = 0; i < count; i++) {
          const a = buf[i * 4];
          sc += Math.cos(a);
          ss += Math.sin(a);
          sumOmega += buf[i * 4 + 1];
          sumAngleRaw += a;
        }
        const meanCos = count ? sc / count : 0;
        const meanSin = count ? ss / count : 0;
        const resultant = Math.sqrt(meanCos * meanCos + meanSin * meanSin);
        return {
          texSize: size,
          count,
          meanAngle: Math.atan2(meanSin, meanCos),
          // Stage-4 gate fix round 2: the arithmetic mean of
          // the accumulated angle (.x) itself, alongside the
          // circular mean above — differencing two captures of
          // this field measures the mean angle advance without
          // wrap ambiguity while the accumulation is coherent.
          meanAngleRaw: count ? sumAngleRaw / count : 0,
          circularVariance: 1 - resultant,
          meanOmega: count ? sumOmega / count : 0,
        };
      },
      // Gate measurement support (stage 4, G4-1 (a)): the
      // orient channel's posture texture read back directly —
      // the mean per-texel rotation angle (2·acos(|w|)) and
      // the mean quaternion over all texels. The G4-1 gate
      // compares the mean angle against the analytic value
      // (angular velocity × elapsed time). Read-only,
      // diag-only.
      captureOrientStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.orientTarget) return { error: 'no-orient-target' };
        const size = ctx.orientTarget.width;
        const count = size * size;
        const buf = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.orientTarget, 0, 0, size, size, buf);
        const summarize = (b: Float32Array) => {
          let sumAngle = 0;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let sw = 0;
          for (let i = 0; i < count; i++) {
            const w = b[i * 4 + 3];
            sumAngle += 2 * Math.acos(Math.min(1, Math.abs(w)));
            sx += b[i * 4];
            sy += b[i * 4 + 1];
            sz += b[i * 4 + 2];
            sw += w;
          }
          return {
            meanAngle: count ? sumAngle / count : 0,
            meanQuat: count ? [sx / count, sy / count, sz / count, sw / count] : [0, 0, 0, 0],
          };
        };
        const cur = summarize(buf);
        // Stage-4 gate fix round 2 (G4-1 (a) triage): the
        // same summary for BOTH ping-pong sides plus the
        // pass's hasState / elapsed echo, via the pass's
        // diag-only introspection. One side at identity
        // points at the feedback path; both sides at identity
        // at reset / increment. sides is null when the frame's
        // orient target does not belong to the active pass.
        let sides: { readIndex: number; perSide: { meanAngle: number; meanQuat: number[] }[] } | null = null;
        let hasState: boolean | null = null;
        let elapsed: number | null = null;
        const pass = getActiveOrientPass();
        if (pass && pass.currentTarget === ctx.orientTarget) {
          const perSide = pass.targets.map((rt) => {
            if (rt === ctx.orientTarget) return cur;
            const b = new Float32Array(count * 4);
            gl.readRenderTargetPixels(rt, 0, 0, size, size, b);
            return summarize(b);
          });
          sides = { readIndex: pass.readIndex, perSide };
          hasState = pass.stateStarted;
          elapsed = pass.elapsedSeconds;
        }
        return {
          texSize: size,
          count,
          meanAngle: cur.meanAngle,
          meanQuat: cur.meanQuat,
          sides,
          hasState,
          elapsed,
        };
      },
      // Gate measurement support (stage-4 gate fix round 2,
      // G4-1 (b)): the drawn long axis rebuilt per texel from
      // the velocity / spin / orient readbacks, composed
      // exactly as the geometry vertex composes it
      // (lookRot(vel̂) · rotY(spin) · quatMat(quat) · ẑ), and
      // its angle against the velocity direction. Readbacks
      // reuse the same gl.readRenderTargetPixels route as
      // captureSpinStats / captureOrientStats; the pure
      // per-texel math lives in computeVelocityAlignStats
      // (components/gpgpuOrientPass.ts). Read-only, diag-only.
      captureVelocityAlignStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        const size = ctx.texSize;
        const count = size * size;
        const vel = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.velOut, 0, 0, size, size, vel);
        let spin: Float32Array | null = null;
        if (ctx.spinTarget && ctx.spinTarget.width === size) {
          spin = new Float32Array(count * 4);
          gl.readRenderTargetPixels(ctx.spinTarget, 0, 0, size, size, spin);
        }
        let orient: Float32Array | null = null;
        if (ctx.orientTarget && ctx.orientTarget.width === size) {
          orient = new Float32Array(count * 4);
          gl.readRenderTargetPixels(ctx.orientTarget, 0, 0, size, size, orient);
        }
        return computeVelocityAlignStats(vel, spin, orient, size);
      },
      // Gate measurement support (2026-11-27 re-gate 2): stats
      // over the WebGPU mirror position DataTexture — the
      // texture the draw samples on the WebGPU route, fed by
      // the app's own per-frame readback mirror (an independent
      // call chain from this hook's readback). Used as the
      // same-page live-distribution reference for the C5
      // readback validity conditions. Read-only, diag-only.
      captureWebGPUMirrorStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        const tex = ctx.webgpuPosTexture as unknown as { image?: { data?: ArrayLike<number> } } | null;
        const data = tex && tex.image ? tex.image.data : null;
        if (!data || !data.length) return { error: 'no-mirror-data' };
        const count = Math.floor(data.length / 4);
        let sumY = 0;
        let sumR = 0;
        let zeros = 0;
        for (let i = 0; i < count; i++) {
          const x = data[i * 4];
          const y = data[i * 4 + 1];
          const z = data[i * 4 + 2];
          sumY += y;
          sumR += Math.hypot(x, y, z);
          if (x === 0 && y === 0 && z === 0) zeros++;
        }
        return {
          count,
          meanY: sumY / count,
          meanAbsPos: sumR / count,
          zeroFraction: zeros / count,
        };
      },
      // Gate measurement support: Aux level-1 velocity readback
      // over the active slots. A slot is active under the Aux
      // draw vertex's own definition (gpgpuShaderAux.ts:
      // life > 0.001 && age < life, with life = vel.w and
      // age = pos.w) — the earlier park-form test
      // (pos.y > -9000) counted the never-written initial
      // texels (0,0,0, age 0 / life 0) as active, so a pool
      // that had emitted nothing reported activeCount = count
      // (stage-4 gate fix round 2). The mean velocity is over
      // active texels only, and activeRate (active / count)
      // is reported for the depletion judgement.
      captureAuxStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.auxPosLatest || !ctx.auxVelLatest) return { error: 'no-aux' };
        const size = ctx.auxPosLatest.width;
        const count = size * size;
        const pos = new Float32Array(count * 4);
        const vel = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.auxPosLatest, 0, 0, size, size, pos);
        gl.readRenderTargetPixels(ctx.auxVelLatest, 0, 0, size, size, vel);
        let active = 0;
        let sumV = 0;
        for (let i = 0; i < count; i++) {
          const life = vel[i * 4 + 3];
          const age = pos[i * 4 + 3];
          if (life > 0.001 && age < life) {
            active++;
            sumV += Math.hypot(vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2]);
          }
        }
        return {
          texSize: size,
          count,
          activeCount: active,
          activeRate: count ? active / count : 0,
          meanAbsVelActive: active ? sumV / active : 0,
        };
      },
      // Gate measurement support (stage-4 gate fix round 2,
      // B2): which fragment strings the LIVE Aux materials
      // actually carry — in particular whether the trail
      // variant's mode-6 branch reached the materials the
      // passes run. The G4-5 failure mode (zero spawns with
      // correct strings, wiring and gate config) localised to
      // the variant delivery, so this reads the delivery
      // result directly. Read-only, diag-only; the materials
      // are published by useGpgpuSimulationAssets and replaced
      // on a variant flip, so this reads the current
      // instances, never a first-render snapshot. The chain
      // materials never carry the trail branch by design.
      captureAuxVariantInfo: () => {
        const mats = getActiveAuxMaterials();
        if (!mats) return { error: 'no-aux-materials' };
        // Stage-4 gate fix round 3: the LIVE uniform values on
        // each material, on top of the fragment-string probe.
        // Phase 2 of the fix round proved the trail branch
        // reaches all three level-1 materials yet zero spawns
        // occur, so the remaining fault sits past delivery —
        // in the runtime inputs the branch actually reads, or
        // in whether the passes run at all. The pass runners
        // rewrite these uniforms on the shared uniforms object
        // every frame they execute, so the values read here
        // are the ones the last executed frame consumed (uTime
        // in particular stays at its initial 0 on any material
        // whose fill never ran — the inherit fill runs only
        // while inheritance is supplied, the chain fills only
        // while a chain level is active). Only uniforms the
        // material actually carries are reported.
        const readUniforms = (m: THREE.ShaderMaterial) => {
          const names = [
            'uAuxMode',
            'uTrailEmitRate',
            'uTrailEmitInterval',
            'uAgeEnabled',
            'uAgeMax',
            'uAuxLife',
            'uAuxCount',
            'uTime',
            'uDelta',
          ];
          const out: Record<string, number | boolean | null> = {};
          for (const n of names) {
            const u = m.uniforms[n];
            if (!u) continue;
            const v = u.value;
            out[n] = typeof v === 'number' || typeof v === 'boolean' ? v : null;
          }
          return out;
        };
        const probe = (m: THREE.ShaderMaterial) => ({
          trailBranch: m.fragmentShader.includes('uAuxMode == 6'),
          trailUniformText: m.fragmentShader.includes('uTrailEmitInterval'),
          fragmentLength: m.fragmentShader.length,
          uniforms: readUniforms(m),
        });
        // Pool-side execution evidence, complementary to
        // captureAuxStats (which reports the active window
        // only): the velocity pass writes a slot's life
        // (vel.w) at spawn and the value persists after the
        // slot dies (the inactive branch rewrites vel.w with
        // the same life), so lifeAssignedCount > 0 proves the
        // spawn branch fired at least once even when every
        // spawned slot has already aged out. freshSpawnCount
        // counts slots the position pass placed on the latest
        // frame (age written as exactly 0 with a life
        // assigned); maxAgeWithLife is the largest age among
        // life-assigned slots (0 when none), showing whether
        // aging progressed after a spawn.
        let pool: {
          texSize: number;
          count: number;
          lifeAssignedCount: number;
          freshSpawnCount: number;
          maxAgeWithLife: number;
        } | { error: string } = { error: 'no-frame-yet' };
        const fctx = diagFrameRef.current;
        if (fctx && fctx.auxPosLatest && fctx.auxVelLatest) {
          const size = fctx.auxPosLatest.width;
          const count = size * size;
          const pos = new Float32Array(count * 4);
          const vel = new Float32Array(count * 4);
          gl.readRenderTargetPixels(fctx.auxPosLatest, 0, 0, size, size, pos);
          gl.readRenderTargetPixels(fctx.auxVelLatest, 0, 0, size, size, vel);
          let lifeAssigned = 0;
          let freshSpawn = 0;
          let maxAge = 0;
          for (let i = 0; i < count; i++) {
            const life = vel[i * 4 + 3];
            if (life > 0.001) {
              lifeAssigned++;
              const age = pos[i * 4 + 3];
              if (age === 0) freshSpawn++;
              if (age > maxAge) maxAge = age;
            }
          }
          pool = {
            texSize: size,
            count,
            lifeAssignedCount: lifeAssigned,
            freshSpawnCount: freshSpawn,
            maxAgeWithLife: maxAge,
          };
        } else if (fctx) {
          pool = { error: 'no-aux' };
        }
        return {
          vel: probe(mats.vel),
          pos: probe(mats.pos),
          inherit: probe(mats.inherit),
          chainVel: probe(mats.chainVel),
          chainPos: probe(mats.chainPos),
          chainInherit: probe(mats.chainInherit),
          pool,
        };
      },
      // Gate measurement support (stage-4 gate fix round 4,
      // G4-5 triage): the raw Aux pool distribution, BOTH
      // ping-pong sides, and the draw binding's texture
      // identity, in one read. The fix-round probes showed a
      // pool state (every slot life-assigned, no slot active,
      // maxAge bit-frozen while uTime advances, and an age
      // larger than the elapsed sim time at precheck) that the
      // shader logic — verified line by line and by a verbatim
      // CPU simulation — cannot produce whether it runs or
      // stalls, so the fault sits below the source layer: in
      // the compiled program's behaviour, or in the identity
      // between the physical textures the passes write, the
      // draw samples, and this hook reads back. This probe
      // separates the two:
      // - latest.pairs / latest.histograms: the pool's initial
      //   fill is the sentinel age = 10 / life = 0 on every
      //   texel, so an untouched pool reads as one spike;
      //   written-once-then-frozen shows life assigned with
      //   ages clustered at / above their life; a live pool
      //   shows a spread with age < life present.
      // - latest vs other stats: the two sides of a running
      //   ping-pong differ by one frame of aging. Identical
      //   stats on both sides, or one side still at the
      //   sentinel, points at the pair resolution / readback
      //   identity rather than at the passes.
      // - identity: drawMatchesLatest* false means the draw
      //   samples a different texture object than the one
      //   published (and read back here) as latest; the uuids
      //   let the harness compare the binding across calls.
      // Read-only, diag-only; the stats reuse the same
      // definitions as captureAuxStats / captureAuxVariantInfo
      // (active = life > 0.001 && age < life, age = pos.w,
      // life = vel.w). pairs entries are [age, life] for the
      // first 256 texels of the latest side; histogram bins
      // are [edges[i], edges[i+1]) with the last bin catching
      // everything >= the last edge (the age sentinel 10
      // included).
      captureAuxPoolProbe: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.auxPosLatest || !ctx.auxVelLatest) return { error: 'no-aux' };
        const PAIR_SAMPLES = 256;
        const HIST_EDGES = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10];
        const summarize = (
          posRt: THREE.WebGLRenderTarget,
          velRt: THREE.WebGLRenderTarget,
          withPairs: boolean,
        ) => {
          const size = posRt.width;
          const count = size * size;
          const pos = new Float32Array(count * 4);
          const vel = new Float32Array(count * 4);
          gl.readRenderTargetPixels(posRt, 0, 0, size, size, pos);
          gl.readRenderTargetPixels(velRt, 0, 0, size, size, vel);
          let active = 0;
          let lifeAssigned = 0;
          let freshSpawn = 0;
          let maxAge = 0;
          let sumV = 0;
          const ageHist = new Array<number>(HIST_EDGES.length).fill(0);
          const lifeHist = new Array<number>(HIST_EDGES.length).fill(0);
          const binOf = (v: number) => {
            let b = 0;
            while (b < HIST_EDGES.length - 1 && v >= HIST_EDGES[b + 1]) b++;
            return b;
          };
          const pairs: [number, number][] = [];
          for (let i = 0; i < count; i++) {
            const age = pos[i * 4 + 3];
            const life = vel[i * 4 + 3];
            ageHist[binOf(age)]++;
            lifeHist[binOf(life)]++;
            if (life > 0.001) {
              lifeAssigned++;
              if (age === 0) freshSpawn++;
              if (age > maxAge) maxAge = age;
              if (age < life) {
                active++;
                sumV += Math.hypot(vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2]);
              }
            }
            if (withPairs && i < PAIR_SAMPLES) pairs.push([age, life]);
          }
          return {
            texSize: size,
            count,
            activeCount: active,
            activeRate: count ? active / count : 0,
            lifeAssignedCount: lifeAssigned,
            freshSpawnCount: freshSpawn,
            maxAgeWithLife: maxAge,
            meanAbsVelActive: active ? sumV / active : 0,
            histograms: { edges: HIST_EDGES, ageCounts: ageHist, lifeCounts: lifeHist },
            ...(withPairs ? { pairs } : {}),
          };
        };
        const latest = summarize(ctx.auxPosLatest, ctx.auxVelLatest, true);
        const other =
          ctx.auxPosOther && ctx.auxVelOther ? summarize(ctx.auxPosOther, ctx.auxVelOther, false) : null;
        return {
          texSize: latest.texSize,
          count: latest.count,
          latest,
          other,
          identity: {
            latestPosTextureUuid: ctx.auxPosLatest.texture.uuid,
            latestVelTextureUuid: ctx.auxVelLatest.texture.uuid,
            otherPosTextureUuid: ctx.auxPosOther ? ctx.auxPosOther.texture.uuid : null,
            otherVelTextureUuid: ctx.auxVelOther ? ctx.auxVelOther.texture.uuid : null,
            drawPosTextureUuid: ctx.auxDrawPosTextureUuid,
            drawVelTextureUuid: ctx.auxDrawVelTextureUuid,
            drawMatchesLatestPos: ctx.auxDrawPosMatchesLatest,
            drawMatchesLatestVel: ctx.auxDrawVelMatchesLatest,
            latestAndOtherAreSameTarget: ctx.auxPosOther ? ctx.auxPosLatest === ctx.auxPosOther : null,
          },
        };
      },
      // Gate measurement support (stage-4 gate fix round 5,
      // G4-5 triage): the fresh-spawn evidence of the latest
      // Aux side, split by the slot's emit phase. The trail
      // event test fires a slot only when
      // mod(tick - mod(auxIdx, interval), interval) ~ 0, so
      // a pool whose spawns cluster in a few phases — or one
      // with no fresh spawn in ANY phase while the tick
      // walks every residue — separates "the tick source
      // starves the phases" from "the compiled program does
      // not run the event test as written". auxIdx is the
      // readback buffer index (the shaders compute it as
      // floor(vUv.y * size) * size + floor(vUv.x * size),
      // the same order readRenderTargetPixels returns).
      // A fresh spawn is a texel the position pass placed
      // this frame: age == 0 with a life assigned — the same
      // definition as the pool aggregates in
      // captureAuxStats / captureAuxPoolProbe. simTime /
      // simTick ride along (the published clock) so one call
      // pins the phase evidence to the tick that produced
      // it. Read-only, diag-only.
      captureAuxSpawnPhaseStats: () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.auxPosLatest || !ctx.auxVelLatest) return { error: 'no-aux' };
        const size = ctx.auxPosLatest.width;
        const count = size * size;
        const pos = new Float32Array(count * 4);
        const vel = new Float32Array(count * 4);
        gl.readRenderTargetPixels(ctx.auxPosLatest, 0, 0, size, size, pos);
        gl.readRenderTargetPixels(ctx.auxVelLatest, 0, 0, size, size, vel);
        const PHASES = 6;
        const freshSpawnByPhase = new Array<number>(PHASES).fill(0);
        const lifeAssignedByPhase = new Array<number>(PHASES).fill(0);
        let freshSpawn = 0;
        let lifeAssigned = 0;
        for (let i = 0; i < count; i++) {
          const life = vel[i * 4 + 3];
          if (life > 0.001) {
            lifeAssigned++;
            const phase = i % PHASES;
            lifeAssignedByPhase[phase]++;
            if (pos[i * 4 + 3] === 0) {
              freshSpawn++;
              freshSpawnByPhase[phase]++;
            }
          }
        }
        return {
          texSize: size,
          count,
          simTime: ctx.simTime,
          simTick: ctx.simTick,
          freshSpawnCount: freshSpawn,
          lifeAssignedCount: lifeAssigned,
          freshSpawnByPhase,
          lifeAssignedByPhase,
        };
      },
      // Gate measurement support (stage-4 gate fix round 5,
      // G4-5 triage): the Aux PASS side of the separation —
      // the level-1 passes' render counters, the output
      // targets they most recently rendered into, and a
      // landing sample: the first texels of both output
      // targets, read back by the runner IMMEDIATELY after
      // a frame's renders when the one-shot probe is armed
      // (lib/auxPassDiag.ts). Calling this arms the probe
      // whenever none is in flight; the returned
      // landingSample is the most recent landed one (kept
      // until a newer lands), and its velRenders /
      // posRenders say which frame's renders it followed.
      // Read-only, diag-only.
      captureAuxPassLandingStats: () => {
        const before = getAuxPassDiagState();
        if (!before.landingArmed) armAuxPassLandingProbe();
        const state = getAuxPassDiagState();
        const ctx = diagFrameRef.current;
        return {
          ...state,
          simTime: ctx ? ctx.simTime : null,
          simTick: ctx ? ctx.simTick : null,
        };
      },
      // Gate measurement support (stage-4 gate fix round 7,
      // G4-5 triage, diagnosis M stage 1): the GPU-side
      // uniform values of the LIVE level-1 Aux materials,
      // read from the compiled programs themselves
      // (gl.getUniform on the native program the renderer
      // last bound for each material), paired with the JS
      // map values captureAuxVariantInfo reports. The phase
      // probes proved the JS side of the supply (the map
      // values advance with simTime), but a JS map value is
      // not evidence of what reached the program: three.js
      // uploads uniforms per render from the map, and a
      // stale / re-pointed uniforms object would leave the
      // map reading correctly while the program runs on
      // other values. `differs` names the uniforms whose GPU
      // value is not exactly Math.fround(js) — the GPU
      // stores float32, so a faithful upload reads back
      // exactly the float32 rounding of the map value, and
      // anything else is a real divergence, not rounding
      // noise. A material whose program the renderer has not
      // bound yet reports gpu: null with gpuNote
      // 'no-program-yet'; a uniform the compiler optimised
      // out of that variant reads null on the GPU side.
      // Caveat: materials whose program cache keys coincide
      // share one native program, whose uniforms hold the
      // LAST upload among them — the level-1 vel/pos
      // fragments differ, so their programs are distinct.
      // Read-only, diag-only.
      captureAuxProgramUniforms: () => {
        const mats = getActiveAuxMaterials();
        if (!mats) return { error: 'no-aux-materials' };
        const NAMES = ['uTime', 'uDelta', 'uTrailEmitInterval', 'uTrailEmitRate', 'uAuxMode'] as const;
        const glCtx = gl.getContext() as WebGLRenderingContext;
        const readSide = (m: THREE.ShaderMaterial) => {
          const js: Record<string, number | null> = {};
          for (const n of NAMES) {
            const u = m.uniforms[n];
            const v = u ? u.value : null;
            js[n] = typeof v === 'number' ? v : null;
          }
          let gpu: Record<string, number | null> | null = null;
          let gpuNote: string | null = null;
          const props = (
            gl as unknown as {
              properties?: {
                get: (mm: unknown) => { currentProgram?: { program?: WebGLProgram } } | undefined;
              };
            }
          ).properties;
          const mp = props ? props.get(m) : undefined;
          const native = mp && mp.currentProgram ? mp.currentProgram.program : undefined;
          if (!native) {
            gpuNote = 'no-program-yet';
          } else {
            gpu = {};
            for (const n of NAMES) {
              const loc = glCtx.getUniformLocation(native, n);
              if (!loc) {
                gpu[n] = null;
                continue;
              }
              const v: unknown = glCtx.getUniform(native, loc);
              gpu[n] = typeof v === 'number' ? v : null;
            }
          }
          const differs: string[] = [];
          if (gpu) {
            for (const n of NAMES) {
              const j = js[n];
              const g = gpu[n];
              if (j === null || g === null) continue;
              if (g !== Math.fround(j)) differs.push(n);
            }
          }
          return { js, gpu, gpuNote, differs };
        };
        const ctx = diagFrameRef.current;
        return {
          vel: readSide(mats.vel),
          pos: readSide(mats.pos),
          simTime: ctx ? ctx.simTime : null,
          simTick: ctx ? ctx.simTick : null,
        };
      },
      // Gate measurement support (stage-4 gate fix round 7,
      // G4-5 triage, diagnosis M stage 2): the tick
      // declaration probe (lib/auxTickProbeDiag.ts). Calling
      // with a side ('vel' | 'pos') arms the one-shot probe
      // for THAT side only — the phase-7 A/B replaced both
      // materials at once, so a one-sided tick failure is
      // still unseparated from a both-sides one; this probe
      // separates them. On the next frame the Aux runner
      // renders a material built from that side's own
      // fragment string (only the main() output replaced by
      // the declaration [tick, trailPhase, trailTick,
      // uTrailEmitInterval]) sharing the side's uniforms
      // OBJECT, into a dedicated target, and stores the
      // first texels here. Calling without a side just reads
      // the state. Arming is refused (armError) while
      // another probe is in flight, when the side's material
      // is absent, or when its fragment carries no trail
      // interval uniform (the tick expressions are not
      // declared in that variant, so the probe program could
      // not compile). Read-only, diag-only; the probe never
      // writes into the pool.
      captureAuxTickProbeStats: (side?: string) => {
        if (side !== undefined && side !== 'vel' && side !== 'pos') {
          return { error: 'unknown-side', side, sides: ['vel', 'pos'] };
        }
        const before = getAuxTickProbeState();
        let armError: string | null = null;
        if ((side === 'vel' || side === 'pos') && !before.armedSide) {
          const mats = getActiveAuxMaterials();
          const m = side === 'vel' ? mats?.vel : mats?.pos;
          if (!m) armError = 'no-aux-materials';
          else if (!m.fragmentShader.includes('uTrailEmitInterval')) armError = 'no-trail-variant';
          else armAuxTickProbe(side as AuxTickProbeSide);
        }
        const state = getAuxTickProbeState();
        const ctx = diagFrameRef.current;
        return {
          ...state,
          armError,
          simTime: ctx ? ctx.simTime : null,
          simTick: ctx ? ctx.simTick : null,
        };
      },
      // Gate measurement support (stage-4 gate fix round 6,
      // G4-5 triage): the trail A/B switch. setAuxTrailAbStage
      // requests one of AUX_TRAIL_AB_STAGES ('A' = the stock
      // trail branch; B1..B6 = hypothesis-isolating
      // minimisations, see components/gpgpuShaderAux.ts);
      // the request travels through lib/auxTrailAbDiag to
      // useGpgpuSimulationAssets, which rebuilds the level-1
      // Aux materials (vel / pos / inherit) around the same
      // shared uniforms. The rebuild is a React state update,
      // so it lands on a following render — poll
      // captureAuxTrailAbInfo until its per-material applied
      // stage matches the request before measuring.
      // captureAuxTrailAbInfo reports the requested/applied
      // bookkeeping AND the stage read back independently
      // from each live material's fragment string (a B branch
      // carries an `aux-trail-ab-stage: Bx` marker; a
      // trail-carrying string without a marker is 'A'; a
      // string without the trail branch is null). Diag-only:
      // nothing outside this hook ever requests a stage.
      setAuxTrailAbStage: (stage: string) => {
        if (!(AUX_TRAIL_AB_STAGES as readonly string[]).includes(stage)) {
          return { ok: false, error: 'unknown-stage', stage, stages: [...AUX_TRAIL_AB_STAGES] };
        }
        const registered = requestAuxTrailAbStage(stage as AuxTrailAbStage);
        return { ok: registered, stage, applierRegistered: registered };
      },
      captureAuxTrailAbInfo: () => {
        const state = getAuxTrailAbDiagState();
        const mats = getActiveAuxMaterials();
        const detect = (m: THREE.ShaderMaterial | undefined) => {
          if (!m) return null;
          const frag = m.fragmentShader;
          if (!frag.includes('uAuxMode == 6')) return null;
          const hit = /aux-trail-ab-stage: (B[1-6])/.exec(frag);
          return hit ? hit[1] : 'A';
        };
        const ctx = diagFrameRef.current;
        return {
          ...state,
          materials: mats
            ? {
                vel: detect(mats.vel),
                pos: detect(mats.pos),
                inherit: detect(mats.inherit),
                chainVel: detect(mats.chainVel),
                chainPos: detect(mats.chainPos),
              }
            : null,
          simTime: ctx ? ctx.simTime : null,
          simTick: ctx ? ctx.simTick : null,
        };
      },
      // Gate measurement support: WebGPU-route position
      // statistics from the compute readback (captureState is
      // WebGL-side and only a reference value on this route).
      // Retries until a fresh (non-fallback) buffer arrives.
      captureWebGPUPositionStats: async () => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        if (!ctx.webgpuState) return { error: 'no-webgpu-state' };
        const st = ctx.webgpuState;
        let fresh: Float32Array | null = null;
        for (let attempt = 0; attempt < 10 && !fresh; attempt++) {
          const before = webgpuLast;
          const data = await readbackWebGPUPositions(st, before ?? undefined);
          if (data !== before && data.length) {
            webgpuLast = data;
            fresh = data;
          } else {
            await new Promise((r) => setTimeout(r, 60));
          }
        }
        if (!fresh) return { error: 'readback-timeout' };
        const count = st.texSize * st.texSize;
        let sumY = 0;
        let sumR = 0;
        let zeros = 0;
        for (let i = 0; i < count; i++) {
          const x = fresh[i * 4];
          const y = fresh[i * 4 + 1];
          const z = fresh[i * 4 + 2];
          sumY += y;
          sumR += Math.hypot(x, y, z);
          if (x === 0 && y === 0 && z === 0) zeros++;
        }
        return {
          texSize: st.texSize,
          count,
          meanY: sumY / count,
          meanAbsPos: sumR / count,
          zeroFraction: zeros / count,
        };
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
      // Phase 15 (Houdini §7): SPH droplet probe for the surface
      // tension measurements. Aggregates over one synchronous
      // position/velocity readback: centroid, covariance aspect
      // ratio (sqrt of the eigenvalue ratio), mean speed squared,
      // and mean speeds split by kernel-density neighbourhood —
      // surface = density below 0.6 x the median, interior =
      // above 0.95 x the median — with the shader's own kernel
      // weight (max(0, 1 - q^2)) accumulated over a uniform grid.
      // Callers pass the config's SPH radius. Used after a
      // deterministic export, the targets hold a step-exact state.
      captureSphProbe: (radius: number) => {
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
        const h = Math.max(0.001, radius);
        const h2 = h * h;
        let cx = 0; let cy = 0; let cz = 0;
        for (let i = 0; i < count; i++) {
          cx += pos[i * 4]; cy += pos[i * 4 + 1]; cz += pos[i * 4 + 2];
        }
        cx /= count; cy /= count; cz /= count;
        let cxx = 0; let cyy = 0; let czz = 0; let cxy = 0; let cxz = 0; let cyz = 0;
        let speed2Sum = 0;
        const speeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const dx = pos[i * 4] - cx; const dy = pos[i * 4 + 1] - cy; const dz = pos[i * 4 + 2] - cz;
          cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
          cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
          const s2 = vel[i * 4] * vel[i * 4] + vel[i * 4 + 1] * vel[i * 4 + 1] + vel[i * 4 + 2] * vel[i * 4 + 2];
          speeds[i] = Math.sqrt(s2);
          speed2Sum += s2;
        }
        cxx /= count; cyy /= count; czz /= count; cxy /= count; cxz /= count; cyz /= count;
        // Eigenvalues of the symmetric covariance via cyclic
        // Jacobi rotations (fixed 12 sweeps — a diagnostic, not
        // a solver).
        const m = [[cxx, cxy, cxz], [cxy, cyy, cyz], [cxz, cyz, czz]];
        for (let sweep = 0; sweep < 12; sweep++) {
          const off = Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]);
          if (off < 1e-12) break;
          for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
            const apq = m[p][q];
            if (Math.abs(apq) < 1e-15) continue;
            const theta = 0.5 * Math.atan2(2 * apq, m[p][p] - m[q][q]);
            const c = Math.cos(theta); const s = Math.sin(theta);
            for (let k = 0; k < 3; k++) {
              const mkp = m[k][p]; const mkq = m[k][q];
              m[k][p] = c * mkp - s * mkq;
              m[k][q] = s * mkp + c * mkq;
            }
            for (let k = 0; k < 3; k++) {
              const mpk = m[p][k]; const mqk = m[q][k];
              m[p][k] = c * mpk - s * mqk;
              m[q][k] = s * mpk + c * mqk;
            }
          }
        }
        const eig = [m[0][0], m[1][1], m[2][2]].sort((a, b) => a - b);
        const aspect = eig[2] > 0 && eig[0] > 0 ? Math.sqrt(eig[2] / eig[0]) : 1;
        // Kernel densities over a uniform grid (cell = radius).
        const grid = new Map<string, number[]>();
        const cellOf = (v: number) => Math.floor(v / h);
        for (let i = 0; i < count; i++) {
          const key = `${cellOf(pos[i * 4])},${cellOf(pos[i * 4 + 1])},${cellOf(pos[i * 4 + 2])}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(i);
          else grid.set(key, [i]);
        }
        const densities = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const px = pos[i * 4]; const py = pos[i * 4 + 1]; const pz = pos[i * 4 + 2];
          const gx = cellOf(px); const gy = cellOf(py); const gz = cellOf(pz);
          let d = 0;
          for (let ax = gx - 1; ax <= gx + 1; ax++) {
            for (let ay = gy - 1; ay <= gy + 1; ay++) {
              for (let az = gz - 1; az <= gz + 1; az++) {
                const bucket = grid.get(`${ax},${ay},${az}`);
                if (!bucket) continue;
                for (const j of bucket) {
                  if (j === i) continue;
                  const dx = px - pos[j * 4]; const dy = py - pos[j * 4 + 1]; const dz = pz - pos[j * 4 + 2];
                  const r2 = dx * dx + dy * dy + dz * dz;
                  if (r2 < h2 && r2 > 0.001) {
                    const q = Math.sqrt(r2) / h;
                    d += Math.max(0, 1 - q * q);
                  }
                }
              }
            }
          }
          densities[i] = d;
        }
        const sorted = Array.from(densities).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        let sCount = 0; let sSpeed = 0; let iCount = 0; let iSpeed = 0;
        for (let i = 0; i < count; i++) {
          if (densities[i] < median * 0.6) { sCount++; sSpeed += speeds[i]; }
          else if (densities[i] > median * 0.95) { iCount++; iSpeed += speeds[i]; }
        }
        const round = (v: number) => Math.round(v * 10000) / 10000;
        return {
          texSize: ctx.texSize,
          count,
          centroid: [round(cx), round(cy), round(cz)],
          aspect: round(aspect),
          meanSpeed2: round(speed2Sum / count),
          medianDensity: round(median),
          surface: { count: sCount, meanSpeed: round(sCount > 0 ? sSpeed / sCount : 0) },
          interior: { count: iCount, meanSpeed: round(iCount > 0 ? iSpeed / iCount : 0) },
        };
      },
      // Grains spike (Phase 31 prep): aggregate metrics for the
      // angle-of-repose investigation (GRAINS_SPIKE_PREP §2).
      // One synchronous position readback; the neighbour set is
      // the TS twin's ground truth (grainsNeighborsBruteForceUv):
      // contact window dist^2 < gd^2 and dist^2 > 0.0001, minus
      // the shader's own self-exclusion (candidates inside the
      // 3x3 texel block around the seeker are skipped). This is
      // the ACTUAL overlap field, not the solver's mode-0
      // subsample perception — record it as such. Neighbours are
      // found with ONE bulk pass over a uniform cell grid (cell =
      // gd, 27-cell search), never by calling the twin per
      // particle. Returns aggregates only: A7 overlap mean/max,
      // a y-distribution summary for floor-reach judgement, an
      // age summary, and a hashed neighbour-set summary. A second
      // call also returns deltaSincePrev — the A6 change count
      // against the previous call, with pairs touching a
      // respawned texel (age went backwards) excluded from both
      // sides, per the prep record. Stored pair keys are capped
      // (PAIR_KEY_LIMIT below) so an ultra-dense pile cannot
      // overflow the JS Set limit; when the cap is hit the
      // aggregates are still exact but deltaSincePrev is null
      // and the result carries pairKeysTruncated: true. Callers pass the config's
      // gpgpuGrainsSize as gd and, when known, gpgpuFloorY.
      captureGrainsMetrics: (gd: number, floorY?: number) => {
        const ctx = diagFrameRef.current;
        if (!ctx) return { error: 'no-frame-yet' };
        const t = ctx.texSize;
        const count = t * t;
        if (!diagPosBufRef.current || diagPosBufRef.current.length !== count * 4) {
          diagPosBufRef.current = new Float32Array(count * 4);
        }
        gl.readRenderTargetPixels(ctx.posOut, 0, 0, t, t, diagPosBufRef.current);
        const pos = diagPosBufRef.current;
        const d = Math.max(0.001, Number.isFinite(gd) ? gd : 0);
        const gd2 = d * d;
        const round = (v: number) => Math.round(v * 10000) / 10000;
        // y and age summaries (position texture RGBA = xyz, age).
        let yMin = Infinity; let yMax = -Infinity; let ySum = 0;
        let ageMin = Infinity; let ageMax = -Infinity; let ageSum = 0;
        const ys = new Float32Array(count);
        const ages = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const y = pos[i * 4 + 1];
          const a = pos[i * 4 + 3];
          ys[i] = y; ages[i] = a;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
          ySum += y;
          if (a < ageMin) ageMin = a;
          if (a > ageMax) ageMax = a;
          ageSum += a;
        }
        const sortedY = Array.from(ys).sort((a, b) => a - b);
        const pct = (p: number) => sortedY[Math.min(count - 1, Math.floor(p * count))] ?? 0;
        let bottomLayer = 0;
        let floorHalf = 0;
        let floorOne = 0;
        const hasFloor = typeof floorY === 'number' && Number.isFinite(floorY);
        for (let i = 0; i < count; i++) {
          if (ys[i] <= yMin + d) bottomLayer++;
          if (hasFloor) {
            if (ys[i] <= (floorY as number) + d * 0.5) floorHalf++;
            if (ys[i] <= (floorY as number) + d) floorOne++;
          }
        }
        // Uniform cell grid, cell size = gd (so any contact lies
        // in the seeker's cell or one of the 26 adjacent cells).
        const cellOf = (v: number) => Math.floor(v / d);
        const grid = new Map<string, number[]>();
        for (let i = 0; i < count; i++) {
          const key = `${cellOf(pos[i * 4])},${cellOf(pos[i * 4 + 1])},${cellOf(pos[i * 4 + 2])}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(i);
          else grid.set(key, [i]);
        }
        // Pair scan: each unordered pair once (j > i), folded in
        // canonical (i, then j ascending) order into two 32-bit
        // hashes so callers can compare neighbour sets across
        // calls without receiving the raw pair list.
        let pairCount = 0;
        let overlapSum = 0;
        let overlapMax = 0;
        const inContact = new Uint8Array(count);
        // Pair keys are kept only so the NEXT call can compute
        // the A6 delta. JS Sets hard-fail past ~16.7M entries
        // (RangeError: Set maximum size exceeded), which an
        // ultra-dense pile (projection 0 + full-scan neighbours)
        // can exceed. Cap the stored keys well below that: once
        // the cap is hit, later keys are simply not stored and
        // the delta is reported as not computable. The pair
        // aggregates above/below never touch this Set and are
        // computed in full regardless of the cap.
        const PAIR_KEY_LIMIT = 2000000;
        const pairKeys = new Set<number>();
        let pairKeysTruncated = false;
        let h1 = 0x811c9dc5;
        let h2 = 0x9e3779b9;
        const mix1 = (h: number, v: number) => {
          h ^= v & 0xff; h = Math.imul(h, 0x01000193);
          h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
          h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
          h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
          return h >>> 0;
        };
        const candidates: number[] = [];
        for (let i = 0; i < count; i++) {
          const px = pos[i * 4]; const py = pos[i * 4 + 1]; const pz = pos[i * 4 + 2];
          const ix = i % t; const iy = Math.floor(i / t);
          const gx = cellOf(px); const gy = cellOf(py); const gz = cellOf(pz);
          candidates.length = 0;
          for (let ax = gx - 1; ax <= gx + 1; ax++) {
            for (let ay = gy - 1; ay <= gy + 1; ay++) {
              for (let az = gz - 1; az <= gz + 1; az++) {
                const bucket = grid.get(`${ax},${ay},${az}`);
                if (!bucket) continue;
                for (const j of bucket) {
                  if (j <= i) continue;
                  const jx = j % t; const jy = Math.floor(j / t);
                  const du = jx - ix; const dv = jy - iy;
                  if (du * du + dv * dv < 2.25) continue;
                  const dx = px - pos[j * 4]; const dy = py - pos[j * 4 + 1]; const dz = pz - pos[j * 4 + 2];
                  const d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 < gd2 && d2 > 0.0001) candidates.push(j);
                }
              }
            }
          }
          if (candidates.length === 0) continue;
          candidates.sort((a, b) => a - b);
          inContact[i] = 1;
          for (const j of candidates) {
            const dx = px - pos[j * 4]; const dy = py - pos[j * 4 + 1]; const dz = pz - pos[j * 4 + 2];
            const overlap = d - Math.sqrt(dx * dx + dy * dy + dz * dz);
            pairCount++;
            overlapSum += overlap;
            if (overlap > overlapMax) overlapMax = overlap;
            inContact[j] = 1;
            if (pairKeys.size < PAIR_KEY_LIMIT) pairKeys.add(i * count + j);
            else pairKeysTruncated = true;
            h1 = mix1(h1, i); h1 = mix1(h1, j);
            h2 = (Math.imul(h2 ^ i, 33) ^ j) >>> 0;
          }
        }
        let contactParticles = 0;
        for (let i = 0; i < count; i++) if (inContact[i]) contactParticles++;
        // A6 delta against the previous call (see header comment).
        // Not computable when either side's key set was truncated
        // by the cap above: deltaSincePrev then stays null and the
        // result carries pairKeysTruncated: true instead.
        let deltaSincePrev: Record<string, unknown> | null = null;
        if (grainsPrev && grainsPrev.count === count && !grainsPrev.pairKeysTruncated && !pairKeysTruncated) {
          const respawned = new Uint8Array(count);
          let respawnedCount = 0;
          for (let i = 0; i < count; i++) {
            if (ages[i] < grainsPrev.ages[i] - 0.0001) { respawned[i] = 1; respawnedCount++; }
          }
          const touchesRespawned = (k: number) => {
            const i = Math.floor(k / count);
            return respawned[i] === 1 || respawned[k - i * count] === 1;
          };
          let prevKept = 0; let common = 0;
          for (const k of grainsPrev.pairKeys) {
            if (touchesRespawned(k)) continue;
            prevKept++;
            if (pairKeys.has(k)) common++;
          }
          let curKept = 0;
          for (const k of pairKeys) {
            if (touchesRespawned(k)) continue;
            curKept++;
          }
          const changed = (prevKept - common) + (curKept - common);
          deltaSincePrev = {
            prevPairCount: grainsPrev.pairCount,
            prevKeptPairCount: prevKept,
            curKeptPairCount: curKept,
            commonPairCount: common,
            changedPairCount: changed,
            a6: prevKept > 0 ? round(changed / prevKept) : 0,
            respawnedCount,
          };
        }
        grainsPrev = { count, pairCount, pairKeys, pairKeysTruncated, ages };
        return {
          texSize: t,
          count,
          gd: d,
          pairCount,
          meanOverlap: round(pairCount > 0 ? overlapSum / pairCount : 0),
          maxOverlap: round(overlapMax),
          contactParticleCount: contactParticles,
          isolatedParticleCount: count - contactParticles,
          pairHash: [(h1 >>> 0).toString(16).padStart(8, '0'), (h2 >>> 0).toString(16).padStart(8, '0')],
          y: {
            min: round(yMin), max: round(yMax), mean: round(ySum / count),
            p10: round(pct(0.1)), p25: round(pct(0.25)), p50: round(pct(0.5)),
            p75: round(pct(0.75)), p90: round(pct(0.9)),
            bottomLayerCount: bottomLayer,
          },
          floor: hasFloor
            ? { floorY, withinHalfDiameter: floorHalf, withinOneDiameter: floorOne }
            : null,
          age: { min: round(ageMin), max: round(ageMax), mean: round(ageSum / count) },
          pairKeysTruncated,
          deltaSincePrev,
        };
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
  // Stage 3 S0 wiring: the state-cache capture's frame provider.
  // Read-only and read-on-demand — it snapshots the CURRENT
  // frame through the exact readback pair the ?diag=1 hook's
  // captureParticlesRaw uses (positions via
  // readRenderTargetPixels on the published frame context,
  // velocities via readbackParticleVelocities), copying both
  // buffers because the diag buffers are reused by the next
  // call. Registered unconditionally (unlike the diag hook):
  // the only caller is the deterministic capture job, which
  // is itself an explicit user action. Under the WebGPU
  // backend this reads the WebGL-shaped targets, the same
  // unconfirmed-equivalence caveat as the diag readback.
  // Bake v2 wiring: while the Orient channel stands, the
  // snapshot also carries the posture — read from the frame
  // context's published orient target (the pass's current
  // read side, the same target captureOrientStats reads),
  // copied the same way. No new accumulation is created:
  // the pass's own ping-pong state is the source, read
  // verbatim. While the channel is off the target is null
  // and the snapshot keeps its exact legacy shape.
  useEffect(
    () =>
      registerStateCacheFrameProvider(() => {
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
        const orientTarget = ctx.orientTarget;
        if (orientTarget && orientTarget.width === ctx.texSize) {
          if (!diagOrientBufRef.current || diagOrientBufRef.current.length !== count * 4) {
            diagOrientBufRef.current = new Float32Array(count * 4);
          }
          gl.readRenderTargetPixels(orientTarget, 0, 0, ctx.texSize, ctx.texSize, diagOrientBufRef.current);
          const orient = diagOrientBufRef.current;
          if (orient) {
            return {
              texSize: ctx.texSize,
              positions: pos.slice(),
              velocities: vel.slice(),
              orientations: orient.slice(),
            };
          }
        }
        return { texSize: ctx.texSize, positions: pos.slice(), velocities: vel.slice() };
      }),
    [gl],
  );
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
  // Spawn envelope clock (stage 2, E2): the accumulated
  // envelope-weighted release clock (lib/gpgpuSpawnAllocator.ts);
  // reset on the same key change that restarts the epoch.
  const spawnEnvClockRef = useRef(0);
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
    vellumXpbdClearMat,
    vellumXpbdLambdaMat,
    vellumXpbdProjMat,
    vellumVolumeReduceMat,
    vellumVolumeProjMat,
    vellumVolumeApplyMat,
    vellumXpbdVelMat,
    auxVelMat,
    auxPosMat,
    auxChainVelMat,
    auxChainPosMat,
    auxInheritMat,
    auxChainInheritMat,
    wwVelMat,
    wwPosMat,
    wwDrawMat,
    aux2DrawMat,
    aux3DrawMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    grainsCellKeyMat,
    grainsPileLambdaMat,
    grainsPileDeltaMat,
    grainsVelocityUpdateMat,
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
    flip3dSplatMat,
    flip3dCompositeMat,
    flip3dPhiMat,
    flip3dPhiAdvectMat,
    flip3dViscosityMat,
    flip3dCurvatureMat,
    flip3dTensionMat,
    flip3dJacobiMat,
    flip3dSubtractMat,
    flip3dCurlMat,
    flip3dVorticityForceMat,
    flip3dClearMat,
    flip3dAtlasCopyMat,
    ww3VelMat,
    ww3PosMat,
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
    ? buildAttrFeedbackFragment(config.gpgpuAttrExprs, config.gpgpuAttrNames, config.gpgpuAttrNames2)
    : null;
  const attrFeedbackSignature = attrFeedbackFragment
    ? `fb|${JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs))}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${resolveAttrDynInterval(config.gpgpuAttrDynInterval)}|${texSize}`
    : '';
  const attrFeedbackPassRef = useRef<GpgpuAttrFeedbackPass | null>(null);
  const attrFeedbackSignatureRef = useRef('');
  const attrFeedbackTextureRef = useRef<THREE.Texture | null>(null);
  const attrFeedbackFrameRef = useRef(0);
  // Spin channel (Grammar 2.0 stage 2, B3): the dedicated
  // ping-pong state pass and its published texture.
  const spinPassRef = useRef<GpgpuSpinPass | null>(null);
  const spinSignatureRef = useRef('');
  const spinTextureRef = useRef<THREE.Texture | null>(null);
  // Orientation channel (Limit plan stage 4, S2): the
  // dedicated quaternion ping-pong state pass and its
  // published texture.
  const orientPassRef = useRef<GpgpuOrientPass | null>(null);
  const orientSignatureRef = useRef('');
  const orientTextureRef = useRef<THREE.Texture | null>(null);
  // State-cache dedicated playback path (bake gate A-4
  // premise fix): while the playback store
  // (lib/gpgpuStateCachePlayback.ts) presents a held v2
  // cache frame, the draw is fed these two DataTextures —
  // built from the cache frame's positions + posture —
  // instead of the live sim's outputs. The frame data
  // object the textures were built from is kept alongside
  // so uploads happen only when the presented frame
  // actually changes.
  const cachePlaybackPosTexRef = useRef<THREE.DataTexture | null>(null);
  const cachePlaybackOrientTexRef = useRef<THREE.DataTexture | null>(null);
  const cachePlaybackFrameRef = useRef<StateCachePlaybackFrameData | null>(null);
  // Vellum XPBD components (Phase 19 stage 3): throttled
  // readback bookkeeping for labelVellumComponents.
  const vellumComponentFrameRef = useRef(0);
  const vellumComponentStateBufRef = useRef<Float32Array | null>(null);
  const vellumComponentPosBufRef = useRef<Float32Array | null>(null);

  // Phase BO: dynamic attribute re-evaluation (stage 2). The
  // generated fragment is null unless the key is on AND at least
  // one slot expression compiles to GLSL — with a null fragment
  // the pass is never built and every consumer keeps the bake
  // texture verbatim (the structural identity guarantee). The
  // signature covers everything the pass depends on, so the
  // useFrame below rebuilds it only when one of them changes.
  const attrDynFragment = !groupGateBaked && !attrFeedbackFragment && config.gpgpuAttrDynEnabled
    ? buildAttrDynFragment(config.gpgpuAttrExprs, config.gpgpuAttrNames, config.gpgpuAttrNames2)
    : null;
  const attrDynInterval = resolveAttrDynInterval(config.gpgpuAttrDynInterval);
  const attrDynSignature = attrDynFragment
    ? `${JSON.stringify(normalizeAttrExprs(config.gpgpuAttrExprs))}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${attrDynInterval}|${texSize}`
    : '';
  const attrDynPassRef = useRef<GpgpuAttrDynPass | null>(null);
  const attrDynSignatureRef = useRef('');
  const attrDynTextureRef = useRef<THREE.Texture | null>(null);
  const attrDynFrameRef = useRef(0);

  // Phase 18 stage 1: the attribute chain stage. A second
  // expression stage whose input is the stage-1 output (the
  // feedback / dyn texture when present, else the bake) — see
  // lib/expressionGlslChain.ts. Null fragment (disabled, all
  // expressions empty, or a baked group gate standing the
  // re-evaluation passes down) means the pass is never built
  // and consumers read the stage-1 texture verbatim. It shares
  // the dyn interval cadence and reuses the dyn pass class
  // (stateless single-target, like BO).
  const attrChainFragment = !groupGateBaked && config.gpgpuAttrChainEnabled
    ? buildAttrChainFragment(config.gpgpuAttrChainExprs, config.gpgpuAttrNames, config.gpgpuAttrNames2)
    : null;
  const attrChainSignature = attrChainFragment
    ? `chain|${JSON.stringify(normalizeAttrExprs(config.gpgpuAttrChainExprs))}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${attrDynInterval}|${texSize}`
    : '';
  const attrChainPassRef = useRef<GpgpuAttrDynPass | null>(null);
  const attrChainSignatureRef = useRef('');
  const attrChainTextureRef = useRef<THREE.Texture | null>(null);
  const attrChainFrameRef = useRef(0);

  // Layer 1 WP2 phase B3: the attribute mapping stage. A
  // third expression stage whose input is the chain output —
  // it applies the channel-to-channel mapping table
  // (gpgpuAttrMappings, lib/gpgpuAttrMappings.ts) as data,
  // instead of burying the relationships inside per-slot
  // expressions. Null fragment (empty table, every entry
  // rejected or unrepresentable, or a baked group gate
  // standing the re-evaluation passes down) means the pass
  // is never built and consumers read the chain texture
  // verbatim. It shares the dyn interval cadence and reuses
  // the dyn pass class, like the chain stage.
  const attrMappingFragment = !groupGateBaked
    ? buildAttrMappingFragment(
      parseAttrMappings(config.gpgpuAttrMappings ?? ''),
      config.gpgpuAttrNames,
      config.gpgpuAttrNames2,
    )
    : null;
  const attrMappingSignature = attrMappingFragment
    ? `map|${config.gpgpuAttrMappings ?? ''}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${attrDynInterval}|${texSize}`
    : '';
  const attrMappingPassRef = useRef<GpgpuAttrDynPass | null>(null);
  const attrMappingSignatureRef = useRef('');
  const attrMappingTextureRef = useRef<THREE.Texture | null>(null);
  const attrMappingFrameRef = useRef(0);

  // Phase 22 stage 1: the density supply. A generated fragment
  // contains the sampling local `simDen` exactly when one of
  // its expressions reads the reserved name `den` — that string
  // is the detection (the builders emit it under conditional
  // emission only). While no fragment reads den, the supply
  // pass never exists.
  // Grammar 2.0 stage 1 (slice 1A): the live rule evaluation
  // pass (REP). The generated fragment is null unless at least
  // one live rule classifies live with a consumed action —
  // with a null fragment the pass never exists, no consumer
  // shader gains the live segment's effect, and behaviour is
  // bit-identical to v2.22.0. A live condition reading `den`
  // classifies live only while the density supply runs, which
  // the REP itself can demand (it joins attrUsesDen below).
  const ruleLiveGroupDefs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
  // Stage 2 slice B6: while predation stands, the generated
  // predation rules ride after the user's own live rules
  // (lib/gpgpuPredation.ts mergePredationRules) — the REP
  // fragment, and only it, is built from the merged list;
  // with predation off the merged list is the user's list
  // itself and the fragment is byte-identical to pre-B6.
  const ruleLiveRules = resolveLiveRulesWithPredation(config);
  const ruleLiveFragment = buildRuleEvalFragment(
    ruleLiveRules,
    {
      names: config.gpgpuAttrNames,
      names2: config.gpgpuAttrNames2,
      groupDefs: ruleLiveGroupDefs,
      densityAvailable: true,
    },
  );
  const ruleLiveInterval = resolveAttrDynInterval(config.gpgpuRuleEvalInterval);
  // Same-evaluation designation (stage 5 slice S5 follow-up,
  // 分岐E): while a designated rule is live in the effective
  // list, the WebGL REP runs TWICE per evaluation — the
  // second run reads the first run's output through the
  // ping-pong, so a set-group / set-state transition is
  // visible to the other rules within the same evaluation,
  // exactly the CPU twin's evaluatePipelineCrossStep. The
  // designation lives in the stored graph's node params and
  // surfaces through the compiler; the row-list form cannot
  // carry it, so without a graph this is always false and
  // the evaluation below is the single run it always was.
  // The resolution is the pure lib/pipelineCross.ts
  // resolveRepTwoPhase over the same classification the
  // twin uses. The WebGPU route is not wired here (the REP
  // block below is WebGL-only already); on that route the
  // designation stays a note, never a disable.
  const ruleLiveTwoPhase = ruleLiveFragment
    ? resolveRepTwoPhase(config.gpgpuPipelineGraph, ruleLiveRules, {
      names: config.gpgpuAttrNames,
      names2: config.gpgpuAttrNames2,
      groupDefs: ruleLiveGroupDefs,
      densityAvailable: true,
    }).twoPhase
    : false;
  // Merged supply (stage 2 texture-unit follow-up): while
  // the plan stands, the REP's targets grow the column strip
  // and every live consumer reads through the one merged
  // texture (lib/gpgpuMergedSupply.ts). The strip height
  // rides the REP signature so a plan change rebuilds the
  // pass; the blit below re-runs whenever the pass or the
  // column supply object changes.
  const mergedPlan = ruleLiveFragment
    ? resolveMergedSupplyPlan(config, texSize)
    : null;
  const ruleLiveSignature = ruleLiveFragment
    ? `rep|${config.gpgpuParticleRulesLive ?? ''}|${config.gpgpuPredationEnabled ? 1 : 0}|${config.gpgpuPredationOutcome}|${config.gpgpuPredationBirth ? 1 : 0}|${config.gpgpuPredationStrike}|${config.gpgpuPredationStrikeFrames}|${config.gpgpuPredationGraceSeconds}|${config.gpgpuGroupsData ?? ''}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${ruleLiveInterval}|${texSize}|merged${mergedPlan?.stripRows ?? 0}${ruleLiveTwoPhase ? '|x2' : ''}`
    : '';
  const ruleEvalPassRef = useRef<GpgpuRuleEvalPass | null>(null);
  const ruleEvalSignatureRef = useRef('');
  const ruleEvalTextureRef = useRef<THREE.Texture | null>(null);
  const ruleEvalFrameRef = useRef(0);
  const mergedBlitRef = useRef<{ pass: GpgpuRuleEvalPass; supply: object } | null>(null);

  // Layer 1 WP2 phase B3: the rule attribute-write stage.
  // While at least one live rule carries a set-attr action,
  // a dedicated pass re-evaluates those rules' targets and
  // conditions against the final attribute texture right
  // after the REP and writes the attribute values they
  // dictate (buildRuleAttrWriteFragment — built from the
  // same merged rule list as the REP fragment). Null
  // fragment (no live set-attr rule) means the pass never
  // exists and the consumers keep the stage-chain texture
  // verbatim. The signature is INDEPENDENT of
  // ruleLiveSignature and covers only what the write
  // fragment depends on — the effective rule list's inputs
  // (rule text, predation parameters, groups data), the
  // attribute names and texSize — so a REP-only change
  // (the eval interval, the merged plan) never rebuilds it.
  const ruleAttrWriteFragment = buildRuleAttrWriteFragment(
    ruleLiveRules,
    {
      names: config.gpgpuAttrNames,
      names2: config.gpgpuAttrNames2,
      groupDefs: ruleLiveGroupDefs,
      densityAvailable: true,
    },
  );
  const ruleAttrWriteSignature = ruleAttrWriteFragment
    ? `raw|${config.gpgpuParticleRulesLive ?? ''}|${config.gpgpuPredationEnabled ? 1 : 0}|${config.gpgpuPredationOutcome}|${config.gpgpuPredationBirth ? 1 : 0}|${config.gpgpuPredationStrike}|${config.gpgpuPredationStrikeFrames}|${config.gpgpuPredationGraceSeconds}|${config.gpgpuGroupsData ?? ''}|${normalizeAttrNames(config.gpgpuAttrNames).join(',')}|${normalizeAttrNames2(config.gpgpuAttrNames2).join(',')}|${texSize}`
    : '';
  const ruleAttrWritePassRef = useRef<GpgpuAttrDynPass | null>(null);
  const ruleAttrWriteSignatureRef = useRef('');
  const ruleAttrWriteTextureRef = useRef<THREE.Texture | null>(null);

  // Contact supply (Grammar 2.0 stage 1, the slice-1B
  // follow-up): the contact pass stands only while the REP
  // fragment actually samples the contact record — the
  // fragment contains the `simHit` local exactly when a live
  // condition reads hit / hits (the same string detection
  // the density supply uses for `simDen`). Its lifecycle is
  // tied to the REP's below; runSimulationPasses drives it
  // (run / suppress) between the velocity and position
  // renders, and the REP binds its latest texture.
  const ruleLiveUsesContact = !!ruleLiveFragment && ruleLiveFragment.includes('simHit');
  // Live fracture consumption (Grammar 2.0 stage 1, fracture
  // follow-up): while a live-classified fracture rule exists,
  // each REP evaluation's aggregate mask is read back and fed
  // to the runtime's fracture gate (lib/gpgpuLiveFracture.ts);
  // an activation re-bakes the morph target with the
  // triggered particles fractured. Without a fracture rule
  // there is no readback and no cost.
  const ruleLiveHasFracture = !!ruleLiveFragment && classifyLiveRules(
    resolveLiveParticleRules(config.gpgpuParticleRulesLive ?? ''),
    {
      names: config.gpgpuAttrNames,
      names2: config.gpgpuAttrNames2,
      groupDefs: ruleLiveGroupDefs,
      densityAvailable: true,
    },
  ).some((c) => c.route === 'live' && c.rule.action.type === 'fracture');
  const ruleFractureReadbackRef = useRef<Float32Array | null>(null);
  const contactSignature = ruleLiveUsesContact ? `contact|${texSize}` : '';
  const contactPassRef = useRef<GpgpuContactPass | null>(null);
  const contactSignatureRef = useRef('');
  // Predation hold supply (stage 2 B6 follow-up): the
  // fragment contains the `simPredHold` local exactly when a
  // live condition reads predhold. The hold pass's lifecycle
  // is tied to the REP's like the contact pass's, but the
  // wiring drives it itself, on evaluation frames immediately
  // before the REP, so the REP binds the record of the very
  // step it evaluates (no frame of lag).
  const ruleLiveUsesPredHold = !!ruleLiveFragment && ruleLiveFragment.includes('simPredHold');
  const predHoldSignature = ruleLiveUsesPredHold ? `predhold|${texSize}` : '';
  const predHoldPassRef = useRef<GpgpuPredationHoldPass | null>(null);
  const predHoldSignatureRef = useRef('');
  // Activation timestamp for the `predage` supply: the sim
  // time at which the resolved predation rule set last
  // changed (activation, or a predation parameter change —
  // a change re-arms the grace window).
  const predationResolved = resolvePredation(config);
  const predationSignature = predationResolved.enabled
    ? `pred|${predationResolved.outcome}|${predationResolved.birth ? 1 : 0}|${predationResolved.strike}|${predationResolved.strikeFrames}|${predationResolved.graceSeconds}|${predationResolved.speciesCount}|${predationResolved.range}`
    : '';
  const predationSignatureRef = useRef('');
  const predationActivationRef = useRef(0);

  // The mapping fragment is absent here on purpose: its
  // expressions resolve only `x` / `t`, so it can never emit
  // the simDen local. The rule-write fragment can (a set-attr
  // condition or value reading `den`), so it joins the list.
  const attrUsesDen = [attrDynFragment, attrChainFragment, attrFeedbackFragment, ruleLiveFragment, ruleAttrWriteFragment]
    .some((f) => typeof f === 'string' && f.includes('simDen'));
  const attrDensityPassRef = useRef<GpgpuAttrDensityPass | null>(null);
  const attrDensityTextureRef = useRef<THREE.Texture | null>(null);
  const attrDensityFrameRef = useRef(0);

  // Phase 22 stage 2: Shine density splat state (RT + material
  // + a private scene holding one Points over the shared draw
  // geometry). Allocated lazily, only while a density consumer
  // is active (postShineDensity positive, or the LightVolume
  // density strength — Layer 1 WP7 Phase D); the store is
  // nulled when it turns off.
  const shineDensityRtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const shineDensityMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const shineDensitySceneRef = useRef<THREE.Scene | null>(null);
  const shineDensityPointsRef = useRef<THREE.Points | null>(null);

  useEffect(() => () => {
    attrDynPassRef.current?.dispose();
    attrDynPassRef.current = null;
    attrFeedbackPassRef.current?.dispose();
    attrFeedbackPassRef.current = null;
    spinPassRef.current?.dispose();
    spinPassRef.current = null;
    spinTextureRef.current = null;
    orientPassRef.current?.dispose();
    orientPassRef.current = null;
    orientTextureRef.current = null;
    cachePlaybackPosTexRef.current?.dispose();
    cachePlaybackPosTexRef.current = null;
    cachePlaybackOrientTexRef.current?.dispose();
    cachePlaybackOrientTexRef.current = null;
    cachePlaybackFrameRef.current = null;
    attrChainPassRef.current?.dispose();
    attrChainPassRef.current = null;
    attrMappingPassRef.current?.dispose();
    attrMappingPassRef.current = null;
    ruleAttrWritePassRef.current?.dispose();
    ruleAttrWritePassRef.current = null;
    attrDensityPassRef.current?.dispose();
    attrDensityPassRef.current = null;
    ruleEvalPassRef.current?.dispose();
    ruleEvalPassRef.current = null;
    contactPassRef.current?.dispose();
    contactPassRef.current = null;
    predHoldPassRef.current?.dispose();
    predHoldPassRef.current = null;
    setParticleDensitySource(null);
    shineDensityRtRef.current?.dispose();
    shineDensityRtRef.current = null;
    shineDensityMatRef.current?.dispose();
    shineDensityMatRef.current = null;
  }, []);

  const runtime = useGpgpuRuntime({
    gl,
    texSize,
    config,
    // Initial-state posture seeding (bake A-2 premise fix):
    // the runtime's applier reaches the Orient pass through
    // this getter (the ref itself is declared above).
    getOrientPass: () => orientPassRef.current,
  });
  const {
    rtRef,
    pingIsA,
    prevPosRTRef,
    initPosTexRef,
    spawnOrderTexRef,
    spawnOrderMaxRef,
    morphTexRef,
    morphNormalTexRef,
    emitCloudTexRef,
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
    grainsLambdaRTRef,
    grainsPileBaseRTRef,
    auxRtRef,
    auxPingIsA,
    wwRtRef,
    wwPingIsA,
    aux2RtRef,
    aux2PingIsA,
    aux3RtRef,
    aux3PingIsA,
    auxInheritRtRef,
    aux2InheritRtRef,
    aux3InheritRtRef,
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
    rigidForceAccelRef,
    rigidForceAngAccelRef,
    pyroGridRef,
    flip3dRef,
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

  // FLIP 3D (Phase 19 stage 2): the same texel-vertex points
  // carrying the 3D splat material (the runner adds them to the
  // sim scene for the 8 trilinear deposit draws).
  const flip3dPoints = useMemo(() => {
    const count = texSize * texSize;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ((i % texSize) + 0.5) / texSize;
      positions[i * 3 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, flip3dSplatMat);
    points.frustumCulled = false;
    return points;
  }, [texSize, flip3dSplatMat]);

  useFrame(({ gl: glCtx, camera }, delta) => {
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

    // Fluid field (Phase 25): on the WebGPU route the field is
    // advected by FLUID_WGSL inside stepWebGPUCompute instead, so
    // the WebGL FBO pass must not also run. Routing is formally
    // resolved later in this frame; this provisional resolution
    // uses the same inputs (replica stacks mask WebGPU out) and
    // therefore agrees with it.
    const replicaStacksEarly = replicaStacksRef.current;
    const stacksActiveEarly = !!replicaStacksEarly && replicaStacksEarly.length > 0;
    const fluidFrameUseWebGPU = resolveGpgpuFrameRouting({
      config,
      webgpuState: stacksActiveEarly ? null : webgpuStateRef.current,
      webgpuPosTexture: stacksActiveEarly ? null : webgpuPosTexRef.current,
      fallbackPosTexture: posOut.texture,
      posReadbackRef,
    }).useWebGPU;
    if (!fluidFrameUseWebGPU) runFluidAdvectionPass({
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
    const spawnEpochKey = `${config.gpgpuSpawnBurst}|${config.gpgpuSpawnRate}|${config.gpgpuSpawnPulseInterval}|${config.gpgpuSpawnPulseDuty}|${config.gpgpuSpawnPulseCycles}|${config.gpgpuSpawnPulseProbability}|${config.gpgpuSpawnOrderMode}|${config.gpgpuSpawnEventEnabled}|${config.gpgpuSpawnEventTime}|${config.gpgpuCount}|${config.gpgpuSeed}|${config.gpgpuSpawnRateAbsolute}|${config.gpgpuSpawnEnvelopeEnabled}|${config.gpgpuSpawnEnvelopeStart}|${config.gpgpuSpawnEnvelopeStop}|${(config.gpgpuSpawnEnvelopeCurve ?? []).join(',')}`;
    if (spawnEpochKey !== spawnEpochKeyRef.current) {
      spawnEpochKeyRef.current = spawnEpochKey;
      if (spawnEpochInitRef.current) spawnEpochStartRef.current = timeRef.current;
      spawnEpochInitRef.current = true;
      spawnEnvClockRef.current = 0;
    }
    const spawnTime = timeRef.current - spawnEpochStartRef.current;
    // Spawn envelope clock (stage 2, E2): while the envelope
    // is enabled, the release clock the allocator variant's
    // thresholds run on advances at the envelope's value
    // (advanceSpawnEnvelopeClock — the accumulated integral,
    // like the pulse grammar's live time). Disabled, the
    // clock values passed to the passes are the plain spawn
    // time and its previous frame, exactly as before.
    const spawnEnvelope = resolveSpawnEnvelope(config);
    let spawnClockTime = spawnTime;
    let spawnClockPrev = spawnTime - rawDt;
    if (spawnEnvelope.enabled) {
      const before = spawnEnvClockRef.current;
      spawnEnvClockRef.current = advanceSpawnEnvelopeClock(before, spawnTime, rawDt, spawnEnvelope);
      spawnClockTime = spawnEnvClockRef.current;
      spawnClockPrev = before;
    }
    // Mask kill (Phase AB): the Phase X mask image texture, the
    // same one the draw clip samples; null unless ready. Phase AE:
    // a terrain-derived sentinel source resolves to the live
    // derived bake through the same single resolution point.
    // Emission mask (stage 2, E3): the same texture also feeds
    // the emission gate, so it resolves while either consumer
    // is on (the passes gate each consumer on its own key).
    const killMaskState = (config.gpgpuKillMask || emissionMaskVariantActive(config)) && config.gpgpuMaskSource
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
    // Phase 18 stage 1: the extra bindings every attribute
    // pass may sample — the ext bake texture and the sim state
    // for the vel / age / rad variables. The sim textures are
    // the ping-pong READ side, i.e. the state as of the end of
    // the previous frame (the passes run before this frame's
    // sim passes); on the first frame they hold the seeded
    // initial data, which is exactly the bake-time fallback.
    // On the WebGPU route these WebGL targets are not advanced
    // by the sim, so the variables keep reading the initial
    // state there — the capability registry declares the
    // sim-side gap (attr-sim-vars) instead of hiding it.
    // Phase 22 stage 1: render the density supply on the
    // shared interval cadence, from the same position snapshot
    // the sim variables read, BEFORE the attribute passes run.
    if (attrUsesDen) {
      if (!attrDensityPassRef.current) {
        attrDensityPassRef.current = new GpgpuAttrDensityPass(texSize);
        attrDensityTextureRef.current = null;
        attrDensityFrameRef.current = 0;
      }
      if (attrDensityFrameRef.current % attrDynInterval === 0) {
        attrDensityTextureRef.current = attrDensityPassRef.current.run(
          glCtx, posIn.texture, config.gpgpuSphRadius, config.gpgpuSphRestDensity,
        );
      }
      attrDensityFrameRef.current += 1;
    } else if (attrDensityPassRef.current) {
      attrDensityPassRef.current.dispose();
      attrDensityPassRef.current = null;
      attrDensityTextureRef.current = null;
      attrDensityFrameRef.current = 0;
    }
    const attrPassExtra = {
      src2Tex: attrTex2Ref.current,
      posTex: posIn.texture,
      velTex: velIn.texture,
      ageDenom: Math.max(config.gpgpuAgeMax, 0.001),
      radiusDenom: Math.max(config.gpgpuBounceRadius, 0.001),
      denTex: attrDensityTextureRef.current,
    };
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
          attrFeedbackTextureRef.current = attrFeedbackPass.run(glCtx, bakeAttrTex, timeRef.current, attrPassExtra);
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
          attrDynTextureRef.current = attrDynPass.run(glCtx, bakeAttrTex, timeRef.current, attrPassExtra);
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
    // Phase 18 stage 1: the chain stage runs after the stage-1
    // passes, on the same interval cadence, with the stage-1
    // output (feedback / dyn texture when present, else the
    // bake) as its input. Its output is the texture every
    // consumer below reads. With no chain fragment the pass is
    // disposed and the stage-1 texture flows verbatim.
    let attrChainTexture: THREE.Texture | null = null;
    if (attrChainFragment) {
      if (attrChainSignatureRef.current !== attrChainSignature || !attrChainPassRef.current) {
        attrChainSignatureRef.current = attrChainSignature;
        attrChainPassRef.current?.dispose();
        attrChainPassRef.current = new GpgpuAttrDynPass(texSize, attrChainFragment);
        attrChainTextureRef.current = null;
        attrChainFrameRef.current = 0;
      }
      const attrChainPass = attrChainPassRef.current;
      const stage1AttrTex = attrDynTexture ?? attrTexRef.current;
      if (attrChainPass && stage1AttrTex) {
        if (attrChainFrameRef.current % attrDynInterval === 0) {
          attrChainTextureRef.current = attrChainPass.run(glCtx, stage1AttrTex, timeRef.current, attrPassExtra);
        }
        attrChainTexture = attrChainTextureRef.current;
      }
      attrChainFrameRef.current += 1;
    } else if (attrChainPassRef.current) {
      attrChainPassRef.current.dispose();
      attrChainPassRef.current = null;
      attrChainTextureRef.current = null;
      attrChainSignatureRef.current = '';
      attrChainFrameRef.current = 0;
    }
    // Layer 1 WP2 phase B3: the mapping stage runs after the
    // chain stage, on the same interval cadence, with the
    // chain output (else the stage-1 texture, else the bake)
    // as its input. Its output completes the attribute stage
    // chain every consumer below reads. With no mapping
    // fragment the pass is disposed and the chain texture
    // flows verbatim.
    let attrMappingTexture: THREE.Texture | null = null;
    if (attrMappingFragment) {
      if (attrMappingSignatureRef.current !== attrMappingSignature || !attrMappingPassRef.current) {
        attrMappingSignatureRef.current = attrMappingSignature;
        attrMappingPassRef.current?.dispose();
        attrMappingPassRef.current = new GpgpuAttrDynPass(texSize, attrMappingFragment);
        attrMappingTextureRef.current = null;
        attrMappingFrameRef.current = 0;
      }
      const attrMappingPass = attrMappingPassRef.current;
      const chainAttrTex = attrChainTexture ?? attrDynTexture ?? attrTexRef.current;
      if (attrMappingPass && chainAttrTex) {
        if (attrMappingFrameRef.current % attrDynInterval === 0) {
          attrMappingTextureRef.current = attrMappingPass.run(glCtx, chainAttrTex, timeRef.current, attrPassExtra);
        }
        attrMappingTexture = attrMappingTextureRef.current;
      }
      attrMappingFrameRef.current += 1;
    } else if (attrMappingPassRef.current) {
      attrMappingPassRef.current.dispose();
      attrMappingPassRef.current = null;
      attrMappingTextureRef.current = null;
      attrMappingSignatureRef.current = '';
      attrMappingFrameRef.current = 0;
    }
    const attrFinalTexture = attrMappingTexture ?? attrChainTexture ?? attrDynTexture;
    // Sim-side consumers (the force drive / the group gate) read
    // the re-evaluated texture on the WebGL route only; on the
    // WebGPU route they keep the bake (declared gap, Phase BO
    // brief; Phase BV inherits it for the feedback texture and
    // declares it in the capability registry). The draw readout
    // (syncVisualUniforms below) always reads the re-evaluated
    // texture.
    const simAttrTex = !routing.useWebGPU && attrFinalTexture ? attrFinalTexture : attrTexRef.current;

    // Spin channel (Grammar 2.0 stage 2, B3): the accumulated
    // angle / angular-velocity state advances once per frame
    // while the channel is enabled, on the WebGL route only
    // (the capability registry routes spin configs there).
    // It reads the position texture's age (the respawn reset)
    // and the final attribute texture (the slot modulation),
    // and publishes its state texture for the draw consumers
    // in syncVisualUniforms below. The lifecycle mirrors the
    // attribute feedback pass above: built only while the
    // channel stands, rebuilt on a signature change, disposed
    // otherwise.
    if (spinChannelActive(config) && !routing.useWebGPU) {
      if (spinSignatureRef.current !== `${texSize}` || !spinPassRef.current) {
        spinSignatureRef.current = `${texSize}`;
        spinPassRef.current?.dispose();
        spinPassRef.current = new GpgpuSpinPass(texSize);
        spinTextureRef.current = null;
      }
      spinTextureRef.current = spinPassRef.current.run(glCtx, {
        posTex: posIn.texture,
        attrTex: simAttrTex,
        ageEnabled: !!config.gpgpuAgeEnabled,
        dt,
        spin: resolveSpin(config),
      });
    } else if (spinPassRef.current) {
      spinPassRef.current.dispose();
      spinPassRef.current = null;
      spinTextureRef.current = null;
      spinSignatureRef.current = '';
    }

    // Orientation channel (Limit plan stage 4, S2): the
    // accumulated quaternion posture advances once per frame
    // while the channel is enabled, on the WebGL route only
    // (the capability registry routes orient configs there).
    // It reads the position texture's age (the respawn reset
    // and the damping clock), the velocity texture (velocity
    // mode's axis) and the final attribute texture (the slot
    // modulation), and publishes its state texture for the
    // geometry draw in syncVisualUniforms below. Lifecycle
    // mirrors the spin pass above.
    if (orientChannelActive(config) && !routing.useWebGPU) {
      if (orientSignatureRef.current !== `${texSize}` || !orientPassRef.current) {
        orientSignatureRef.current = `${texSize}`;
        orientPassRef.current?.dispose();
        orientPassRef.current = new GpgpuOrientPass(texSize);
        orientTextureRef.current = null;
      }
      orientTextureRef.current = orientPassRef.current.run(glCtx, {
        posTex: posIn.texture,
        velTex: velOut.texture,
        attrTex: simAttrTex,
        ageEnabled: !!config.gpgpuAgeEnabled,
        dt,
        orient: resolveOrient(config),
      });
    } else if (orientPassRef.current) {
      orientPassRef.current.dispose();
      orientPassRef.current = null;
      orientTextureRef.current = null;
      orientSignatureRef.current = '';
    }

    // Grammar 2.0 stage 1 (slice 1A): the REP runs after the
    // attribute stages (its slot variables read the final
    // attribute texture) and before the sim passes (its output
    // is what the velocity / position consumers read), on the
    // gpgpuRuleEvalInterval cadence, WebGL route only (the
    // capability registry routes live-rule configs there).
    // Between evaluations the last output texture is held.
    let ruleLiveTexture: THREE.Texture | null = null;
    if (ruleLiveFragment && !routing.useWebGPU) {
      // Rule attribute-write stage lifecycle, tied to the
      // REP's (Layer 1 WP2 phase B3): built only while a live
      // set-attr rule stands, rebuilt on its own signature,
      // disposed otherwise. Its held texture resets with a
      // rebuild, exactly like the REP's.
      if (ruleAttrWriteFragment) {
        if (ruleAttrWriteSignatureRef.current !== ruleAttrWriteSignature || !ruleAttrWritePassRef.current) {
          ruleAttrWriteSignatureRef.current = ruleAttrWriteSignature;
          ruleAttrWritePassRef.current?.dispose();
          ruleAttrWritePassRef.current = new GpgpuAttrDynPass(texSize, ruleAttrWriteFragment);
          ruleAttrWriteTextureRef.current = null;
        }
      } else if (ruleAttrWritePassRef.current) {
        ruleAttrWritePassRef.current.dispose();
        ruleAttrWritePassRef.current = null;
        ruleAttrWriteTextureRef.current = null;
        ruleAttrWriteSignatureRef.current = '';
      }
      // Contact supply lifecycle, tied to the REP's: the
      // pass is built only while the fragment reads hit /
      // hits, and reset whenever the REP itself is rebuilt
      // (a fresh REP state pairs with a fresh contact
      // record). The runner drives it later in this frame;
      // the REP below binds its latest texture.
      if (ruleLiveUsesContact) {
        if (contactSignatureRef.current !== contactSignature || !contactPassRef.current) {
          contactSignatureRef.current = contactSignature;
          contactPassRef.current?.dispose();
          contactPassRef.current = new GpgpuContactPass(texSize);
          contactPassRef.current.reset(glCtx);
        }
      } else if (contactPassRef.current) {
        contactPassRef.current.dispose();
        contactPassRef.current = null;
        contactSignatureRef.current = '';
      }
      // Hold supply lifecycle, tied to the REP's like the
      // contact pass's: built only while the fragment reads
      // predhold, reset whenever the REP itself is rebuilt.
      if (ruleLiveUsesPredHold) {
        if (predHoldSignatureRef.current !== predHoldSignature || !predHoldPassRef.current) {
          predHoldSignatureRef.current = predHoldSignature;
          predHoldPassRef.current?.dispose();
          predHoldPassRef.current = new GpgpuPredationHoldPass(texSize);
          predHoldPassRef.current.reset(glCtx);
        }
      } else if (predHoldPassRef.current) {
        predHoldPassRef.current.dispose();
        predHoldPassRef.current = null;
        predHoldSignatureRef.current = '';
      }
      // Predation activation tracking for the `predage`
      // supply: a changed resolved predation set (activation
      // or a parameter change) re-arms the grace window at
      // the current sim time.
      if (predationSignatureRef.current !== predationSignature) {
        predationSignatureRef.current = predationSignature;
        if (predationSignature !== '') {
          predationActivationRef.current = timeRef.current;
        }
      }
      if (ruleEvalSignatureRef.current !== ruleLiveSignature || !ruleEvalPassRef.current) {
        ruleEvalSignatureRef.current = ruleLiveSignature;
        ruleEvalPassRef.current?.dispose();
        ruleEvalPassRef.current = new GpgpuRuleEvalPass(texSize, ruleLiveFragment, mergedPlan?.stripRows ?? 0);
        ruleEvalTextureRef.current = null;
        ruleEvalFrameRef.current = 0;
        mergedBlitRef.current = null;
        contactPassRef.current?.reset(glCtx);
        predHoldPassRef.current?.reset(glCtx);
        // A rebuilt REP means a new live rule list: the
        // fracture gate starts a new history with it.
        runtime.resetLiveFracture();
      }
      // Merged supply: keep the column strip of both REP
      // targets current — blit on pass rebuild and whenever
      // the column supply object changes (its cache keys on
      // the column config strings).
      if (mergedPlan && ruleEvalPassRef.current) {
        const supply = getColumnSupply(config);
        if (supply && (mergedBlitRef.current?.pass !== ruleEvalPassRef.current || mergedBlitRef.current?.supply !== supply)) {
          ruleEvalPassRef.current.blitColumn(glCtx, supply.texture, supply.width, supply.height);
          mergedBlitRef.current = { pass: ruleEvalPassRef.current, supply };
        }
      }
      const ruleEvalPass = ruleEvalPassRef.current;
      if (ruleEvalPass && simAttrTex) {
        if (ruleEvalFrameRef.current % ruleLiveInterval === 0) {
          // Hold supply: accumulate this evaluation's step
          // first, so the REP reads the hold count including
          // the current evaluation's strike test. The supply
          // follows the resolved predation parameters (their
          // defaults while predation itself is off — a user
          // rule may still read predhold).
          if (predHoldPassRef.current) {
            predHoldPassRef.current.run(glCtx, {
              posTex: posIn.texture,
              species: predationResolved.speciesCount,
              range: predationResolved.range,
              strike: predationResolved.strike,
              graceUntil: predationActivationRef.current + predationResolved.graceSeconds,
              time: timeRef.current,
            });
          }
          const ruleEvalBindings = {
            attrTex: simAttrTex,
            extTex: attrTex2Ref.current,
            posTex: posIn.texture,
            velTex: velIn.texture,
            ageDenom: Math.max(config.gpgpuAgeMax, 0.001),
            radiusDenom: Math.max(config.gpgpuBounceRadius, 0.001),
            denTex: attrDensityTextureRef.current,
            // Contact supply: the contact pass's latest
            // record (or its zero texture while suppressed),
            // read only when a live condition uses hit/hits.
            hitTex: contactPassRef.current?.texture ?? null,
            // Hold supply: the hold pass's latest record
            // (read only when a live condition uses predhold).
            holdTex: predHoldPassRef.current?.texture ?? null,
            // Slice 1B: the analytic SDF bundle the velocity
            // pass owns, supplied to the REP as well (read
            // only when a live condition uses `sdf`).
            sdf: {
              enabled: config.gpgpuSdfEnabled,
              shape: SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0,
              x: config.gpgpuSdfX,
              y: config.gpgpuSdfY,
              z: config.gpgpuSdfZ,
              size: config.gpgpuSdfSize,
            },
            // Slice B6: the neighbourhood supply's species
            // count + encounter range (read only when the
            // fragment declares them).
            predation: {
              species: resolvePredation(config).speciesCount,
              range: resolvePredation(config).range,
              activationTime: predationActivationRef.current,
            },
            time: timeRef.current,
          };
          ruleEvalTextureRef.current = ruleEvalPass.run(glCtx, ruleEvalBindings);
          if (ruleLiveTwoPhase) {
            // Phase 2 of the same evaluation (same-evaluation
            // designation, 分岐E): the ping-pong has swapped,
            // so this run reads phase 1's output as its
            // previous state and writes the other target. Two
            // runs return the ping-pong parity to where it
            // stood before the evaluation, the held texture
            // and currentTarget are phase 2's, and the
            // fracture readback below therefore reads the
            // final target. The bindings are the step's own,
            // unchanged: only the carried state differs,
            // exactly as in the CPU twin. The hold pass above
            // is NOT run again — it accumulates once per
            // evaluation regardless of phases.
            ruleEvalTextureRef.current = ruleEvalPass.run(glCtx, ruleEvalBindings);
          }
          // Live fracture consumption: read the aggregate
          // mask back from the target the REP just wrote and
          // present it to the runtime's fracture gate. Runs
          // only on evaluation frames and only while a live
          // fracture rule exists; the gate enforces the
          // cooldown / same-set limits, and an activation
          // re-bakes the morph target (useGpgpuRuntime).
          if (ruleLiveHasFracture) {
            const repTarget = ruleEvalPass.currentTarget;
            if (repTarget) {
              if (!ruleFractureReadbackRef.current
                || ruleFractureReadbackRef.current.length !== texSize * texSize * 4) {
                ruleFractureReadbackRef.current = new Float32Array(texSize * texSize * 4);
              }
              glCtx.readRenderTargetPixels(
                repTarget, 0, 0, texSize, texSize, ruleFractureReadbackRef.current,
              );
              runtime.noteLiveFractureMask(
                ruleFractureReadbackRef.current, ruleEvalFrameRef.current,
              );
            }
          }
          // Rule attribute-write stage (Layer 1 WP2 phase
          // B3): on the REP's own evaluation frames,
          // immediately after the REP (and its second phase),
          // re-evaluate the set-attr rules against the final
          // attribute texture — simAttrTex, the REP's own
          // input — and hold the written texture for the
          // consumers below. Between evaluations the held
          // texture stands, exactly like ruleEvalTextureRef.
          if (ruleAttrWritePassRef.current) {
            ruleAttrWriteTextureRef.current = ruleAttrWritePassRef.current.run(
              glCtx, simAttrTex, timeRef.current, attrPassExtra,
            );
          }
        }
        ruleLiveTexture = ruleEvalTextureRef.current;
      }
      ruleEvalFrameRef.current += 1;
    } else if (ruleEvalPassRef.current) {
      ruleEvalPassRef.current.dispose();
      ruleEvalPassRef.current = null;
      ruleEvalTextureRef.current = null;
      ruleEvalSignatureRef.current = '';
      ruleEvalFrameRef.current = 0;
      contactPassRef.current?.dispose();
      contactPassRef.current = null;
      contactSignatureRef.current = '';
      predHoldPassRef.current?.dispose();
      predHoldPassRef.current = null;
      predHoldSignatureRef.current = '';
      predationSignatureRef.current = '';
      // The write stage's lifecycle is tied to the REP's:
      // it ends with the live rules too.
      ruleAttrWritePassRef.current?.dispose();
      ruleAttrWritePassRef.current = null;
      ruleAttrWriteTextureRef.current = null;
      ruleAttrWriteSignatureRef.current = '';
      // The live rules are gone: the fracture history ends
      // with them (re-bakes the morph target unfractured if
      // an activation had fractured part of it).
      runtime.resetLiveFracture();
    }

    // Layer 1 WP2 phase B3: the consumer attribute
    // textures. simAttrTex above stays the REP's own input
    // (the final pre-write attribute texture, which the
    // spin / orient channels and the replica stacks also
    // keep reading); the sim passes and the draw readout
    // below read through these instead — the rule-write
    // stage's held output while it stands, else exactly
    // what they read before this stage existed (the draw
    // readout's pre-B3 value is attrFinalTexture ?? bake,
    // which consumerAttrTex's simAttrTex base only equals
    // on the WebGL route, so the two are kept distinct).
    const consumerAttrTex = ruleAttrWriteTextureRef.current ?? simAttrTex;
    const drawAttrTex = ruleAttrWriteTextureRef.current ?? attrFinalTexture ?? attrTexRef.current;

    if (stacksActive) {
      // Replica stacks never drive the contact pass (their
      // runner passes none): suppress it so hit / hits read
      // 0 while stacks own the pool, like the live kill's
      // stack suppression.
      contactPassRef.current?.suppress();
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
        // Field force coupling (Round 84 gap 3, stage 1): while
        // the Force key is on and the source is 'curl', sample
        // the curl twin at each body's centre ONCE for this
        // frame (solver clock — a pure function of position and
        // stepped time) and hand the accelerations to the step.
        // Off / other sources pass null and the solver runs the
        // legacy path verbatim.
        let externalAccel: Float32Array | null = null;
        let externalAngAccel: Float32Array | null = null;
        if (rigid.forceEnabled && rigid.forceSource === 'curl') {
          if (!rigidForceAccelRef.current) rigidForceAccelRef.current = new Float32Array(RIGID_BODY_MAX * 3);
          externalAccel = fillRigidCurlAccel(
            rigidSolver,
            rigidCurlParamsFromConfig(config, rigidSolver.time),
            config.gpgpuCurlStrength,
            rigid.forceScale,
            rigidForceAccelRef.current,
          );
          // Stage 1b torque: the same field sampled at each
          // body's surface pole, as angular acceleration. Only
          // filled while the Torque key is on; null otherwise
          // (stage 1 verbatim).
          if (rigid.forceTorque) {
            if (!rigidForceAngAccelRef.current) rigidForceAngAccelRef.current = new Float32Array(RIGID_BODY_MAX * 3);
            externalAngAccel = fillRigidCurlAngAccel(
              rigidSolver,
              rigidCurlParamsFromConfig(config, rigidSolver.time),
              config.gpgpuCurlStrength,
              rigid.forceScale,
              rigidForceAngAccelRef.current,
            );
          }
        }
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
          floorMultiSample: rigid.floorMultiSample,
          // Static boxes (UE5 #35 G-D stage D2): supplied only
          // while the parsed list is non-empty, so an empty key
          // keeps the step options (and the trajectories)
          // verbatim.
          staticBoxes: rigid.staticBoxes.length > 0 ? rigid.staticBoxes : undefined,
          bounceRadius: config.gpgpuBounceRadius,
          restitution: rigid.restitution,
          friction: rigid.friction,
          glueEnabled: rigid.glueEnabled,
          glueStrength: rigid.glueStrength,
          // Stress breaking + OBB shapes (Phase 20 stage 1):
          // step-time switches, resolved through the same
          // resolveRigid call. Off/absent keeps the legacy
          // break conditions and sphere paths verbatim; the
          // joints themselves are build-time state (built in
          // useGpgpuRuntime from the same resolution).
          stressBreakEnabled: rigid.stressBreakEnabled,
          stressPropagation: rigid.stressPropagation,
          convexEnabled: rigid.convexEnabled,
          convexInertiaEnabled: rigid.convexInertia,
          externalAccel,
          externalAngAccel,
          // Stage 1b wake-by-force: inert at the default 0.
          externalWakeThreshold: rigid.forceWakeThreshold,
        });
        writeRigidBodyTexture(rigidSolver, rigidBodyDataRef.current);
        rigidBodyTexRef.current.needsUpdate = true;
        // Phase 21 stage 3: new rigid contacts fire rigid-contact
        // event rules through the live performer. Draining always
        // happens (the pending list is capped regardless); firing
        // is capped per frame and skipped entirely with no
        // performer registered, so rule-free scenes pay only the
        // drain. vel carries the impact Δv for conditions.
        const contactEvents = drainRigidContactEvents(rigidSolver);
        if (contactEvents.length > 0 && getEventRuleActionPerformer()) {
          const fireCap = Math.min(contactEvents.length, 4);
          for (let e = 0; e < fireCap; e++) {
            const ev = contactEvents[e];
            fireEventRulesLive({ type: 'rigid-contact' }, { vel: ev.impact, x: ev.impact });
          }
        }
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
      // FLIP 3D coupling (Phase 19 stage 2): same staggered
      // discipline — fill the velocity material's FLIP3D
      // uniforms from the 3D solver's latest completed step,
      // right after the Pyro fill (the design's ordering:
      // field -> pyro -> flip3d).
      applyFlip3dCoupleUniforms({
        config,
        velSimMat,
        targets: flip3dRef.current,
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
        attrTex: consumerAttrTex,
        ruleLiveTex: ruleLiveTexture,
        contactPass: contactPassRef.current,
        morphTex: morphTexRef.current,
        emitCloudTex: emitCloudTexRef.current,
        morphNormalTex: morphNormalTexRef.current,
        morphKickStart: morphKickStartRef.current,
        prevPosTex: prevPosRTRef.current?.texture ?? null,
        spawnTime,
        spawnClockTime,
        spawnClockPrev,
        killMaskTex,
        spawnOrderTex: spawnOrderTexRef.current,
        spawnOrderMaxDist: spawnOrderMaxRef.current,
        mouseWorldMulti,
        mouseMultiCount,
        vellumRestTex: vellumRestTexRef.current,
        vellumProjMat,
        vellumStateMat,
        vellumVelMat,
        vellumXpbdClearMat,
        vellumXpbdLambdaMat,
        vellumXpbdProjMat,
        vellumVolumeReduceMat,
        vellumVolumeProjMat,
        vellumVolumeApplyMat,
        vellumXpbdVelMat,
        vellumLambda0RT: vellumXpbdRtRef.current?.lambda0 ?? null,
        vellumLambda1RT: vellumXpbdRtRef.current?.lambda1 ?? null,
        vellumVolumeChain: vellumXpbdRtRef.current?.volumeChain ?? null,
        vellumLambdaVolRT: vellumXpbdRtRef.current?.lambdaVol ?? null,
        vellumGradTex: vellumGradTexRef.current,
        vellumVolumeInfo: vellumVolumeInfoRef.current,
        vellumStateIn,
        vellumStateOut,
        vellumSpareRT: prevPosRTRef.current,
        blitMat,
        grainsCellKeyMat,
        grainsBitonicMat: bitonicMat,
        grainsSortRTA: grainsSortRTARef.current,
        grainsSortRTB: grainsSortRTBRef.current,
        grainsPileLambdaMat,
        grainsPileDeltaMat,
        grainsVelocityUpdateMat,
        grainsLambdaRT: grainsLambdaRTRef.current,
        grainsPileBaseRT: grainsPileBaseRTRef.current,
        grainsPileSpareRT: prevPosRTRef.current,
        rigidCellTex: rigidCellTexRef.current,
        rigidBodyTex: rigidBodyTexRef.current,
        rigidBodyCount: rigidSolverRef.current ? rigidSolverRef.current.bodies.length : 0,
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
      // Component labelling (Phase 19 stage 3, design 3-4-3):
      // in xpbd mode with a live tear rule, read the state +
      // position targets back at most once per 30 frames, BFS
      // the live links on the CPU (labelVellumComponents) and
      // publish the labels into the component texture + the
      // components ref ({id, texelCount, centroid, mass} —
      // Phase 20's rigid-candidate shape). The readback cost
      // is real and is a gate measurement item; the throttle
      // drops first if it proves heavy.
      if (vellumStateOut && vellumComponentTexRef.current
        && config.gpgpuVellumEnabled && config.gpgpuVellumSolverMode === 'xpbd'
        && (config.gpgpuVellumTear || 0) > 0) {
        vellumComponentFrameRef.current += 1;
        if (vellumComponentFrameRef.current % 30 === 1) {
          const count = texSize * texSize;
          if (!vellumComponentStateBufRef.current || vellumComponentStateBufRef.current.length !== count * 4) {
            vellumComponentStateBufRef.current = new Float32Array(count * 4);
          }
          if (!vellumComponentPosBufRef.current || vellumComponentPosBufRef.current.length !== count * 4) {
            vellumComponentPosBufRef.current = new Float32Array(count * 4);
          }
          glCtx.readRenderTargetPixels(vellumStateOut, 0, 0, texSize, texSize, vellumComponentStateBufRef.current);
          glCtx.readRenderTargetPixels(posOut, 0, 0, texSize, texSize, vellumComponentPosBufRef.current);
          const labelled = labelVellumComponents(
            vellumComponentStateBufRef.current,
            texSize,
            config.gpgpuVellumMode === 'shell' ? 1 : 0,
            vellumComponentPosBufRef.current,
            4,
          );
          vellumComponentsRef.current = labelled.components;
          const compTex = vellumComponentTexRef.current;
          const data = compTex.image.data as Float32Array;
          const norm = Math.max(1, labelled.count);
          for (let i = 0; i < count; i++) {
            data[i * 4] = labelled.labels[i] / norm;
            data[i * 4 + 1] = labelled.count;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 1;
          }
          compTex.needsUpdate = true;
        }
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

    // FLIP 3D (Phase 19 stage 2, WebGL path; Phase 26 gave the
    // WebGPU backend its own WGSL solver, stepped inside
    // stepWebGPUCompute — each route steps only its own): steps
    // here, after the Pyro grid, reading the frame-start
    // particle textures (the same state the 2D FLIP layer's
    // P2G reads). The runner no-ops unless the mode is '3d'
    // and targets exist.
    if (!routing.useWebGPU && flip3dRef.current && simMeshRef.current) {
      runFlip3dPasses({
        config,
        targets: flip3dRef.current,
        materials: {
          flip3dSplatMat,
          flip3dCompositeMat,
          flip3dPhiMat,
          flip3dPhiAdvectMat,
          flip3dViscosityMat,
          flip3dCurvatureMat,
          flip3dTensionMat,
          flip3dJacobiMat,
          flip3dSubtractMat,
          flip3dCurlMat,
          flip3dVorticityForceMat,
          flip3dClearMat,
          flip3dAtlasCopyMat,
        },
        simMesh: simMeshRef.current,
        gl: glCtx,
        simScene,
        simCamera,
        dt,
        splatPoints: flip3dPoints,
        posTex: posIn.texture,
        velTex: velIn.texture,
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
          ww3VelMat,
          ww3PosMat,
          flip3dTargets: flip3dRef.current,
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
    // Trail mechanism (stage 4, S6): the block also runs
    // while the Aux-type trail drives the pool at
    // gpgpuAuxMode 'none' (trailAuxActive), and the draw
    // material sync below follows the same condition.
    if (!routing.useWebGPU && (config.gpgpuAuxMode !== 'none' || trailAuxActive(config)) && auxRtRef.current && simMeshRef.current) {
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
        // Grammar connection (1D-3): the REP's latest output
        // of this frame (held between interval evaluations),
        // sampled by the ruleSpawn variant's event test. Null
        // while no live rule has run — no pulse, no spawns.
        mainRuleTex: ruleLiveTexture,
        // Spawn inheritance (1D-1): the target exists only
        // while the slots key is on; the attribute texture is
        // the same current one the sim itself consumes.
        inherit: auxInheritRtRef.current
          ? { target: auxInheritRtRef.current, mat: auxInheritMat, mainAttrTex: simAttrTex }
          : null,
      });
      auxPingIsA.current = !auxPingIsA.current;
      auxDrawMat.uniforms.uAuxPosTex.value = auxTargets.posOut.texture;
      auxDrawMat.uniforms.uAuxVelTex.value = auxTargets.velOut.texture;
      if (auxDrawMat.uniforms.uAuxInheritTex && auxInheritRtRef.current) {
        auxDrawMat.uniforms.uAuxInheritTex.value = auxInheritRtRef.current.texture;
      }
      if (auxDrawMat.uniforms.uAuxInheritColor) {
        auxDrawMat.uniforms.uAuxInheritColor.value = config.gpgpuAuxInheritColor;
      }
      // Child colour (Phase Q): an explicit child colour wins; the
      // empty default inherits the parent (main pool) colour exactly
      // as before.
      auxDrawMat.uniforms.uColor.value.setStyle(config.gpgpuAuxColor ? config.gpgpuAuxColor : config.gpgpuColor);
      auxDrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
      auxDrawMat.uniforms.uAuxSize.value = config.gpgpuAuxSize;
      auxDrawMat.blending = config.gpgpuBlendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
      syncAuxShadowMapUniforms(auxDrawMat, config);
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
          // Spawn inheritance (1D-1): copies level 1's
          // inheritance texels into this level's target.
          inherit: aux2InheritRtRef.current && auxInheritRtRef.current
            ? { target: aux2InheritRtRef.current, mat: auxChainInheritMat, srcInheritTex: auxInheritRtRef.current.texture }
            : null,
        });
        aux2PingIsA.current = !aux2PingIsA.current;
        aux2DrawMat.uniforms.uAuxPosTex.value = aux2Targets.posOut.texture;
        aux2DrawMat.uniforms.uAuxVelTex.value = aux2Targets.velOut.texture;
        if (aux2DrawMat.uniforms.uAuxInheritTex && aux2InheritRtRef.current) {
          aux2DrawMat.uniforms.uAuxInheritTex.value = aux2InheritRtRef.current.texture;
        }
        if (aux2DrawMat.uniforms.uAuxInheritColor) {
          aux2DrawMat.uniforms.uAuxInheritColor.value = config.gpgpuAuxInheritColor;
        }
        aux2DrawMat.uniforms.uColor.value.setStyle(resolveAuxLevelColor(config, 2));
        aux2DrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
        aux2DrawMat.uniforms.uAuxSize.value = level2.size;
        syncAuxShadowMapUniforms(aux2DrawMat, config);
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
            // Spawn inheritance (1D-1): copies level 2's
            // inheritance texels into this level's target.
            inherit: aux3InheritRtRef.current && aux2InheritRtRef.current
              ? { target: aux3InheritRtRef.current, mat: auxChainInheritMat, srcInheritTex: aux2InheritRtRef.current.texture }
              : null,
          });
          aux3PingIsA.current = !aux3PingIsA.current;
          aux3DrawMat.uniforms.uAuxPosTex.value = aux3Targets.posOut.texture;
          aux3DrawMat.uniforms.uAuxVelTex.value = aux3Targets.velOut.texture;
          if (aux3DrawMat.uniforms.uAuxInheritTex && aux3InheritRtRef.current) {
            aux3DrawMat.uniforms.uAuxInheritTex.value = aux3InheritRtRef.current.texture;
          }
          if (aux3DrawMat.uniforms.uAuxInheritColor) {
            aux3DrawMat.uniforms.uAuxInheritColor.value = config.gpgpuAuxInheritColor;
          }
          aux3DrawMat.uniforms.uColor.value.setStyle(resolveAuxLevelColor(config, 3));
          aux3DrawMat.uniforms.uOpacity.value = config.gpgpuOpacity;
          aux3DrawMat.uniforms.uAuxSize.value = level3.size;
          syncAuxShadowMapUniforms(aux3DrawMat, config);
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
      // Splat draw (Layer 1 WP7 Phase C2): splats consume the
      // sort texture unconditionally, so the pass is forced
      // while the splat key is on (the key defaults off, so
      // the legacy condition's value is unchanged otherwise).
      forceSort: config.gpgpuSplatEnabled,
    });

    // Splat columns sort (Layer 1 WP7 Phase C3): while the
    // splat input form is the independent column data, the
    // depth sort runs once more over the columns centre
    // texture — the same pass, with the columns sort grid /
    // targets / depth material from the draw assets (see
    // lib/gpgpuSplatColumns.ts for why the grid is its own).
    // Null in every other configuration, and the supply then
    // keeps the pool bindings exactly.
    const splatColumnsSortTex = assets.splatColumnsForm === 'columns'
      && assets.splatColumnsTextures && assets.splatColumnsSortRTs && assets.splatColumnsSortDepthMat
      ? runDepthSortPass({
        config,
        gl: glCtx,
        camera,
        simScene,
        simCamera,
        simMesh: simMeshRef.current,
        posTexture: assets.splatColumnsTextures.centerTex,
        texSize: assets.splatColumnsSortTexSize,
        sortRTA: assets.splatColumnsSortRTs.a,
        sortRTB: assets.splatColumnsSortRTs.b,
        sortDepthMat: assets.splatColumnsSortDepthMat,
        bitonicMat,
        forceSort: true,
      })
      : null;

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

    // Ring (attractor space mode): the readback feeds only the
    // CPU draw paths (SmoothTube, metaballs), so it gets the
    // same draw-side -z offset as the shader paths. The readback
    // above fully rewrites the buffer from the GPU whenever it
    // runs, so this never accumulates; the PLY capture below
    // uses its own buffer and keeps the true positions.
    if (
      config.gpgpuAttractorEnabled &&
      config.gpgpuAttractorSpaceMode === 'ring' &&
      routing.readbackMode === 'webgl-readback' &&
      posReadbackRef?.current
    ) {
      const buf = posReadbackRef.current;
      for (let i = 2; i < buf.length; i += 4) buf[i] -= ATTRACTOR_RING_Z_SHIFT;
    }

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

    // Stage-4 gate fix round 2: publish the same output targets
    // for the motion-blur velocity capture (lib/motionBlur.ts's
    // sim frame store). The capture reads the sim's own targets
    // — the diagnostic AOV's proven route — instead of the draw
    // material's uniforms. Plain assignments; inert while the
    // capture is unmounted (MB off).
    setMotionSimFrameSource({ posTexture: posOut.texture, velTexture: velOut.texture });

    // Phase DH (DA3 path B): publish this frame's targets for the
    // ?diag=1 diagnostic hook. Plain assignments; the hook reads
    // them only when explicitly invoked.
    // Stage-4 gate fix round 4 (G4-5 triage): resolve the Aux
    // ping-pong pair once for the fields below, and read the Aux
    // draw material's currently bound textures, so the published
    // frame also carries both pool sides plus the draw binding's
    // identity against the latest targets (captureAuxPoolProbe).
    // The draw binding is rewritten inside the Aux block above
    // on every frame the pool runs; while the block does not
    // run, this reads whatever was bound last — exactly what
    // the draw would sample.
    const auxDiagTargets = auxRtRef.current
      ? resolvePingPongTargets(auxRtRef.current, auxPingIsA.current)
      : null;
    const auxDrawPosTex = (auxDrawMat.uniforms.uAuxPosTex.value ?? null) as THREE.Texture | null;
    const auxDrawVelTex = (auxDrawMat.uniforms.uAuxVelTex.value ?? null) as THREE.Texture | null;
    diagFrameRef.current = {
      posOut,
      velOut,
      texSize,
      ageMax: config.gpgpuAgeMax,
      extent: config.gpgpuBounceRadius,
      // Stage 0 S7 (plan A1): publish the route so the ?diag=1
      // hook's captureState can avoid the frozen WebGL targets
      // on the WebGPU route.
      route: routing.useWebGPU ? 'webgpu' : 'webgl',
      webgpuState: routing.useWebGPU ? webgpuStateRef.current : null,
      ruleLiveTarget: ruleEvalPassRef.current?.currentTarget ?? null,
      contactTarget: contactPassRef.current?.currentTarget ?? null,
      contactSuppressed: contactPassRef.current?.isSuppressed ?? false,
      auxPosLatest: auxDiagTargets ? auxDiagTargets.posIn : null,
      auxVelLatest: auxDiagTargets ? auxDiagTargets.velIn : null,
      auxPosOther: auxDiagTargets ? auxDiagTargets.posOut : null,
      auxVelOther: auxDiagTargets ? auxDiagTargets.velOut : null,
      auxDrawPosTextureUuid: auxDrawPosTex ? auxDrawPosTex.uuid : null,
      auxDrawVelTextureUuid: auxDrawVelTex ? auxDrawVelTex.uuid : null,
      auxDrawPosMatchesLatest:
        auxDrawPosTex && auxDiagTargets ? auxDrawPosTex === auxDiagTargets.posIn.texture : null,
      auxDrawVelMatchesLatest:
        auxDrawVelTex && auxDiagTargets ? auxDrawVelTex === auxDiagTargets.velIn.texture : null,
      // Stage-4 gate fix round 5 (G4-5 triage): the sim
      // clock and the Aux shaders' tick derived from it
      // (floor(time * 60) — the passes filled uTime from
      // this same timeRef value earlier in this frame).
      simTime: timeRef.current,
      simTick: Math.floor(timeRef.current * 60),
      auxInheritTarget: auxInheritRtRef.current ?? null,
      aux2PosLatest: aux2RtRef.current
        ? resolvePingPongTargets(aux2RtRef.current, aux2PingIsA.current).posIn
        : null,
      aux2InheritTarget: aux2InheritRtRef.current ?? null,
      spinTarget: spinPassRef.current?.currentTarget ?? null,
      orientTarget: orientPassRef.current?.currentTarget ?? null,
      webgpuPosTexture: webgpuPosTexRef.current ?? null,
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

    // State-cache dedicated playback path (bake gate A-4
    // premise fix): while the playback store presents a
    // held v2 cache frame whose texSize matches this pool,
    // the draw presents THAT frame — positions and posture
    // from DataTextures built out of the cache frame —
    // instead of the live sim's outputs. The live passes
    // above (including the Orient pass) keep running
    // untouched underneath; only the two textures handed
    // to syncVisualUniforms are swapped, so stopping the
    // presentation returns the draw to the live state
    // exactly as it evolved. A texSize mismatch never
    // engages (the panel's start refuses it too; this is
    // the draw-side half of the same discipline).
    const playbackFrame = resolveActiveStateCachePlaybackFrame();
    let drawPosTexture: THREE.Texture = routing.outputPosTexture;
    let drawOrientTexture: THREE.Texture | null = orientTextureRef.current;
    if (playbackFrame && playbackFrame.texSize === texSize) {
      if (cachePlaybackFrameRef.current !== playbackFrame) {
        cachePlaybackFrameRef.current = playbackFrame;
        cachePlaybackPosTexRef.current?.dispose();
        cachePlaybackOrientTexRef.current?.dispose();
        const posTex = new THREE.DataTexture(
          playbackFrame.positionData, playbackFrame.texSize, playbackFrame.texSize,
          THREE.RGBAFormat, THREE.FloatType,
        );
        posTex.minFilter = THREE.NearestFilter;
        posTex.magFilter = THREE.NearestFilter;
        posTex.needsUpdate = true;
        const orientTex = new THREE.DataTexture(
          playbackFrame.orientationData, playbackFrame.texSize, playbackFrame.texSize,
          THREE.RGBAFormat, THREE.FloatType,
        );
        orientTex.minFilter = THREE.NearestFilter;
        orientTex.magFilter = THREE.NearestFilter;
        orientTex.needsUpdate = true;
        cachePlaybackPosTexRef.current = posTex;
        cachePlaybackOrientTexRef.current = orientTex;
      }
      if (cachePlaybackPosTexRef.current && cachePlaybackOrientTexRef.current) {
        drawPosTexture = cachePlaybackPosTexRef.current;
        drawOrientTexture = cachePlaybackOrientTexRef.current;
      }
    }

    syncVisualUniforms({
      config,
      activeCount,
      assets,
      posTexture: drawPosTexture,
      velTexture: velOut.texture,
      finalSortTex,
      // Splat columns (Phase C3): this frame's sort over the
      // column data's centres, or null on the pool form.
      splatColumnsSortTex,
      attrTexture: drawAttrTex,
      vellumStateTexture: vellumStateRtRef.current
        ? (vellumStatePingIsA.current ? vellumStateRtRef.current.a.texture : vellumStateRtRef.current.b.texture)
        : null,
      rigidCellTexture: rigidCellTexRef.current,
      rigidClusterLutTexture: rigidClusterLutTexRef.current,
      // Grammar 2.0 1C: the REP output feeds the points
      // draw's live display override (null while no REP ran).
      ruleLiveTexture: ruleLiveTexture,
      // Spin channel (B3): the spin pass's latest state
      // texture (null while the channel is off).
      spinTexture: spinTextureRef.current,
      // Orientation channel (S2): the orient pass's latest
      // posture texture (null while the channel is off) —
      // or, while the state-cache playback path above
      // presents a cache frame, that frame's posture
      // texture instead.
      orientTexture: drawOrientTexture,
      texSize,
      time: timeRef.current,
      viewportSizePx: { x: gl.domElement.width, y: gl.domElement.height },
    });

    // Shine density splat (Phase 22 stage 2): while a density
    // consumer is active (postShineDensity positive, or the
    // LightVolume's density strength — Layer 1 WP7 Phase D),
    // splat the authored source layers into the
    // quarter-resolution density target and publish it for the
    // consumers. Runs after syncVisualUniforms so the position
    // textures and sizes it reads are this frame's. When no
    // consumer is active the splat never runs and the store is
    // null — every consumer's fragment is its legacy string
    // then.
    if (config.postShineDensity > 0 || volumeDensityOn(config)) {
      const drawSize = glCtx.getDrawingBufferSize(new THREE.Vector2());
      const dw = Math.max(1, Math.floor(drawSize.x * PARTICLE_DENSITY_SCALE));
      const dh = Math.max(1, Math.floor(drawSize.y * PARTICLE_DENSITY_SCALE));
      let rt = shineDensityRtRef.current;
      if (!rt) {
        rt = new THREE.WebGLRenderTarget(dw, dh, {
          type: THREE.FloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        });
        shineDensityRtRef.current = rt;
      } else if (rt.width !== dw || rt.height !== dh) {
        rt.setSize(dw, dh);
      }
      let mat = shineDensityMatRef.current;
      if (!mat) {
        mat = new THREE.ShaderMaterial({
          uniforms: {
            uPosTex: { value: null as THREE.Texture | null },
            uSize: { value: 2 },
            uScale: { value: PARTICLE_DENSITY_SCALE },
            uGain: { value: PARTICLE_DENSITY_SPLAT_GAIN },
          },
          vertexShader: SHINE_DENSITY_SPLAT_VERT,
          fragmentShader: SHINE_DENSITY_SPLAT_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        });
        shineDensityMatRef.current = mat;
      }
      if (!shineDensitySceneRef.current) {
        shineDensitySceneRef.current = new THREE.Scene();
        const points = new THREE.Points(drawGeo, mat);
        points.frustumCulled = false;
        shineDensityPointsRef.current = points;
        shineDensitySceneRef.current.add(points);
      }
      // Source layers (Layer 1 WP7 Phase D): the authored
      // selection (postShineDensityLayers) resolved to
      // canonical order; each layer contributes its own draw
      // geometry plus the position texture its draw material
      // is bound to this frame — the very texture the layer's
      // own draw samples. A layer whose pool is not running
      // (no texture bound) contributes nothing and is skipped.
      // The default 'main' selection yields exactly the
      // Phase 22 single-layer splat.
      const layers = resolveParticleDensityLayers(config);
      const drawMatAny = assets.drawMat as unknown as { uniforms?: Record<string, { value: unknown }> } | null;
      const liveSize = drawMatAny?.uniforms?.uSize?.value;
      const auxUniformsOf = (m: THREE.ShaderMaterial) =>
        (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      const sources: { geometry: THREE.BufferGeometry; texture: THREE.Texture; size: number }[] = [];
      for (const layer of layers) {
        if (layer === 'main') {
          sources.push({
            geometry: drawGeo,
            texture: routing.outputPosTexture,
            size: typeof liveSize === 'number' ? liveSize : 2,
          });
        } else {
          const auxMat = layer === 'aux' ? auxDrawMat : layer === 'aux2' ? aux2DrawMat : aux3DrawMat;
          const auxUniforms = auxUniformsOf(auxMat);
          const auxTex = (auxUniforms?.uAuxPosTex?.value ?? null) as THREE.Texture | null;
          if (!auxTex) continue;
          const auxSize = auxUniforms?.uAuxSize?.value;
          sources.push({
            geometry: auxDrawGeo,
            texture: auxTex,
            size: typeof auxSize === 'number' ? auxSize : 2,
          });
        }
      }
      const points = shineDensityPointsRef.current;
      if (points && sources.length > 0) {
        points.material = mat;
        const prevTarget = glCtx.getRenderTarget();
        const prevClearColor = new THREE.Color();
        glCtx.getClearColor(prevClearColor);
        const prevClearAlpha = glCtx.getClearAlpha();
        const prevAutoClear = glCtx.autoClear;
        glCtx.setClearColor(0x000000, 0);
        glCtx.setRenderTarget(rt);
        // One explicit clear for the whole accumulation: the
        // per-layer renders must not clear again (autoClear
        // off), or only the last layer would survive in the
        // field. Restored before returning the renderer.
        glCtx.autoClear = false;
        glCtx.clear(true, true, true);
        for (const source of sources) {
          points.geometry = source.geometry;
          mat.uniforms.uPosTex.value = source.texture;
          mat.uniforms.uSize.value = source.size;
          glCtx.render(shineDensitySceneRef.current, camera);
        }
        glCtx.autoClear = prevAutoClear;
        glCtx.setRenderTarget(prevTarget);
        glCtx.setClearColor(prevClearColor, prevClearAlpha);
        setParticleDensitySource({ texture: rt.texture });
      } else {
        setParticleDensitySource(null);
      }
    } else {
      setParticleDensitySource(null);
    }

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
