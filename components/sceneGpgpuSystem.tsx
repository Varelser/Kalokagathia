import React, { useEffect, useMemo, useRef } from 'react';
import type { FC, MutableRefObject, RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import { LodSystem } from '../lib/lodSystem';
import { ATTRACTOR_RING_Z_SHIFT } from '../lib/attractorSpace';
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
import { refreshWebGPUDiagSnapshot } from '../lib/webgpuCompute';
import { describeWebGPUDiagSnapshot } from '../lib/webgpuDiagSnapshot';
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
import { applyFlip3dCoupleUniforms, runFlip3dPasses } from './gpgpuFlip3dPasses';
import { EMPTY_PYRO_GRID_FOG_FEED, type PyroGridFogFeed } from '../lib/pyroGrid';
import { labelVellumComponents } from '../lib/gpgpuVellum';
import { GpgpuAttrDynPass } from './gpgpuAttrDynPass';
import { GpgpuAttrDensityPass } from './gpgpuAttrDensityPass';
import {
  PARTICLE_DENSITY_SCALE,
  PARTICLE_DENSITY_SPLAT_GAIN,
  setParticleDensitySource,
} from '../lib/particleDensity';
import { buildAttrDynFragment } from '../lib/expressionGlsl';
import { GpgpuAttrFeedbackPass } from './gpgpuAttrFeedbackPass';
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
import { drainRigidContactEvents, fillRigidCurlAccel, resolveRigid, rigidCurlParamsFromConfig, stepRigidBodies, writeRigidBodyTexture, RIGID_BODY_MAX } from '../lib/rigidBodies';
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

  // Phase 22 stage 1: the density supply. A generated fragment
  // contains the sampling local `simDen` exactly when one of
  // its expressions reads the reserved name `den` — that string
  // is the detection (the builders emit it under conditional
  // emission only). While no fragment reads den, the supply
  // pass never exists.
  const attrUsesDen = [attrDynFragment, attrChainFragment, attrFeedbackFragment]
    .some((f) => typeof f === 'string' && f.includes('simDen'));
  const attrDensityPassRef = useRef<GpgpuAttrDensityPass | null>(null);
  const attrDensityTextureRef = useRef<THREE.Texture | null>(null);
  const attrDensityFrameRef = useRef(0);

  // Phase 22 stage 2: Shine density splat state (RT + material
  // + a private scene holding one Points over the shared draw
  // geometry). Allocated lazily, only while postShineDensity
  // is positive; the store is nulled when it turns off.
  const shineDensityRtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const shineDensityMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const shineDensitySceneRef = useRef<THREE.Scene | null>(null);
  const shineDensityPointsRef = useRef<THREE.Points | null>(null);

  useEffect(() => () => {
    attrDynPassRef.current?.dispose();
    attrDynPassRef.current = null;
    attrFeedbackPassRef.current?.dispose();
    attrFeedbackPassRef.current = null;
    attrChainPassRef.current?.dispose();
    attrChainPassRef.current = null;
    attrDensityPassRef.current?.dispose();
    attrDensityPassRef.current = null;
    setParticleDensitySource(null);
    shineDensityRtRef.current?.dispose();
    shineDensityRtRef.current = null;
    shineDensityMatRef.current?.dispose();
    shineDensityMatRef.current = null;
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
    const attrFinalTexture = attrChainTexture ?? attrDynTexture;
    // Sim-side consumers (the force drive / the group gate) read
    // the re-evaluated texture on the WebGL route only; on the
    // WebGPU route they keep the bake (declared gap, Phase BO
    // brief; Phase BV inherits it for the feedback texture and
    // declares it in the capability registry). The draw readout
    // (syncVisualUniforms below) always reads the re-evaluated
    // texture.
    const simAttrTex = !routing.useWebGPU && attrFinalTexture ? attrFinalTexture : attrTexRef.current;

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
        // Field force coupling (Round 84 gap 3, stage 1): while
        // the Force key is on and the source is 'curl', sample
        // the curl twin at each body's centre ONCE for this
        // frame (solver clock — a pure function of position and
        // stepped time) and hand the accelerations to the step.
        // Off / other sources pass null and the solver runs the
        // legacy path verbatim.
        let externalAccel: Float32Array | null = null;
        if (rigid.forceEnabled && rigid.forceSource === 'curl') {
          if (!rigidForceAccelRef.current) rigidForceAccelRef.current = new Float32Array(RIGID_BODY_MAX * 3);
          externalAccel = fillRigidCurlAccel(
            rigidSolver,
            rigidCurlParamsFromConfig(config, rigidSolver.time),
            config.gpgpuCurlStrength,
            rigid.forceScale,
            rigidForceAccelRef.current,
          );
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
        });
        aux2PingIsA.current = !aux2PingIsA.current;
        aux2DrawMat.uniforms.uAuxPosTex.value = aux2Targets.posOut.texture;
        aux2DrawMat.uniforms.uAuxVelTex.value = aux2Targets.velOut.texture;
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
          });
          aux3PingIsA.current = !aux3PingIsA.current;
          aux3DrawMat.uniforms.uAuxPosTex.value = aux3Targets.posOut.texture;
          aux3DrawMat.uniforms.uAuxVelTex.value = aux3Targets.velOut.texture;
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

    // Phase DH (DA3 path B): publish this frame's targets for the
    // ?diag=1 diagnostic hook. Plain assignments; the hook reads
    // them only when explicitly invoked.
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
      attrTexture: attrFinalTexture ?? attrTexRef.current,
      vellumStateTexture: vellumStateRtRef.current
        ? (vellumStatePingIsA.current ? vellumStateRtRef.current.a.texture : vellumStateRtRef.current.b.texture)
        : null,
      rigidCellTexture: rigidCellTexRef.current,
      rigidClusterLutTexture: rigidClusterLutTexRef.current,
      texSize,
      time: timeRef.current,
      viewportSizePx: { x: gl.domElement.width, y: gl.domElement.height },
    });

    // Shine density splat (Phase 22 stage 2): while
    // postShineDensity is positive, splat the main layer into
    // the quarter-resolution density target and publish it for
    // the LightFx pass. Runs after syncVisualUniforms so the
    // position texture and uSize it reads are this frame's.
    // When the key is 0 the splat never runs and the store is
    // null — the LightFx fragment is the legacy string then.
    if (config.postShineDensity > 0) {
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
      } else if (shineDensityPointsRef.current) {
        shineDensityPointsRef.current.geometry = drawGeo;
        shineDensityPointsRef.current.material = mat;
      }
      const drawMatAny = assets.drawMat as unknown as { uniforms?: Record<string, { value: unknown }> } | null;
      const liveSize = drawMatAny?.uniforms?.uSize?.value;
      mat.uniforms.uPosTex.value = routing.outputPosTexture;
      mat.uniforms.uSize.value = typeof liveSize === 'number' ? liveSize : 2;
      const prevTarget = glCtx.getRenderTarget();
      const prevClearColor = new THREE.Color();
      glCtx.getClearColor(prevClearColor);
      const prevClearAlpha = glCtx.getClearAlpha();
      glCtx.setClearColor(0x000000, 0);
      glCtx.setRenderTarget(rt);
      glCtx.render(shineDensitySceneRef.current, camera);
      glCtx.setRenderTarget(prevTarget);
      glCtx.setClearColor(prevClearColor, prevClearAlpha);
      setParticleDensitySource({ texture: rt.texture });
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
