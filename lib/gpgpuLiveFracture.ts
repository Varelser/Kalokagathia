// ── Live fracture trigger consumption (Grammar 2.0 stage 1,
// fracture follow-up to slice 1C) ─────────────────────────────
// Slice 1C aggregated the fracture signal (REP mask bit 7, a
// pulse that never latches) but left it unconsumed: the
// existing Voronoi fracture (lib/voronoiFracture.ts, Phase AG)
// is a bake-time post-pass over the morph target cloud with no
// runtime entry point. This module is the consumption layer:
//
//   REP readback (.r channel, RGBA-packed)
//     → extractLiveFractureTriggerSet (bit 7 → particle set)
//     → LiveFractureTriggerGate (frequency limits, below)
//     → resolveLiveFractureBake (OR composition, below)
//     → applyLiveFractureComposite (the bake's own transform,
//        restricted to the triggered particles)
//
// Why readback-driven (and not CPU-twin-driven): a fracture
// condition reads LIVE sim state (vel / age / den / sdf / hit /
// hits) that exists only on the GPU. The CPU twin evaluates
// frame-0 bake values, so a twin-driven trigger would fire (or
// not) independently of what the live particles actually did.
// The readback route consumes the very mask the REP produced,
// so the trigger set is by construction the set the live
// evaluation matched. The twin-driven route stays what it
// already is — the bake-time approximation behind the
// baked-fallback classification — and is not used here.
//
// Frequency limits (fixed here, pinned by the fracture test):
//  - the readback itself runs at most once per REP evaluation
//    (the scene wiring hooks it to the evaluation frames only,
//    and only while a live fracture rule exists);
//  - the gate enforces a cooldown of
//    LIVE_FRACTURE_MIN_INTERVAL_FRAMES frames between
//    activations, so a sustained condition cannot re-bake the
//    morph target every evaluation;
//  - an activation only ever ADDS particles: a trigger set
//    with no particle beyond the already-fractured union is
//    suppressed (same-set suppression), and a set presented
//    during the cooldown is not consumed — it is re-presented
//    by the next readback while the condition holds (bit 7 is
//    re-aggregated every evaluation), so nothing is lost.
// An activation latches into the fractured union: the re-baked
// morph target stays fractured for those particles until the
// gate resets (the wiring resets it when the REP is rebuilt —
// a new live rule list starts a new fracture history). This
// mirrors the true-kill latch: a pulse with a permanent,
// well-defined effect, never an oscillating re-bake.
//
// OR composition (fixed in slice 1C): the static fracture keys
// keep their exact legacy meaning; a live activation can only
// ADD fracture, never remove or weaken the static one. While
// the static fracture is enabled the bake already fractures
// the whole cloud, so the live path contributes nothing there.
//
// Determinism: everything in this module is a pure function of
// its inputs (the bake transform itself is the seeded Phase AG
// arithmetic). The gate's state advances only on the frame
// numbers the caller presents, so a fixed sequence of
// (mask, frame) inputs reproduces exactly.

import {
  applyVoronoiFracture,
  clampFractureCells,
  clampFractureGap,
  fractureOptionFromConfig,
  type VoronoiFractureOptions,
} from './voronoiFracture';
import { LIVE_RULE_FRACTURE_BIT } from './gpgpuParticleRulesLive';

/** Minimum frames between two live fracture activations. */
export const LIVE_FRACTURE_MIN_INTERVAL_FRAMES = 30;

/**
 * Extract the triggered particle set from a mask channel: the
 * indices whose mask value carries LIVE_RULE_FRACTURE_BIT.
 * `values` is read with the given stride / offset, so the
 * scene can pass the REP readback buffer directly (RGBA-packed,
 * mask in .r: stride 4, offset 0) and tests can pass a plain
 * mask array (stride 1). Non-finite entries never trigger.
 */
export function extractLiveFractureTriggerSet(
  values: ArrayLike<number>,
  count: number,
  stride = 4,
  offset = 0,
): number[] {
  const out: number[] = [];
  const n = Math.max(0, Math.floor(count));
  const step = Math.max(1, Math.floor(stride));
  for (let i = 0; i < n; i++) {
    const v = values[offset + i * step];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if ((Math.round(v) & LIVE_RULE_FRACTURE_BIT) !== 0) out.push(i);
  }
  return out;
}

/**
 * Order-independent signature of a particle set (FNV-1a over
 * the sorted indices). Two presentations of the same set —
 * in any order, with duplicates — share a signature.
 */
export function liveFractureSetSignature(indices: Iterable<number>): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  let h = 0x811c9dc5;
  for (const i of sorted) {
    h ^= (i + 1) & 0xffffffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${sorted.length}:${h.toString(16).padStart(8, '0')}`;
}

export interface LiveFractureActivation {
  /** Particles this activation added (sorted, de-duplicated). */
  added: number[];
  /** The frame the caller presented with the trigger set. */
  frame: number;
  /** Size of the fractured union after this activation. */
  totalFractured: number;
  /** Signature of `added` (see liveFractureSetSignature). */
  signature: string;
}

export interface LiveFractureTriggerGate {
  /** Every particle activated so far (the fractured union). */
  readonly fractured: ReadonlySet<number>;
  readonly activationCount: number;
  readonly lastActivationFrame: number;
  /**
   * Present a trigger set at a frame. Returns the activation
   * when the set adds at least one new particle AND the
   * cooldown since the last activation has elapsed; null
   * otherwise (same-set suppression / cooldown). A suppressed
   * presentation consumes nothing.
   */
  consider(triggerSet: Iterable<number>, frame: number): LiveFractureActivation | null;
  /** Forget every activation (a new fracture history). */
  reset(): void;
}

export function createLiveFractureTriggerGate(options: {
  minIntervalFrames?: number;
} = {}): LiveFractureTriggerGate {
  const minInterval = Math.max(
    0,
    Math.floor(options.minIntervalFrames ?? LIVE_FRACTURE_MIN_INTERVAL_FRAMES),
  );
  const fractured = new Set<number>();
  let activationCount = 0;
  // Seeded one full interval in the past so the first
  // presentation (frame >= 0) is never cooldown-blocked.
  let lastActivationFrame = -minInterval;
  return {
    fractured,
    get activationCount() { return activationCount; },
    get lastActivationFrame() { return lastActivationFrame; },
    consider(triggerSet, frame) {
      const delta = new Set<number>();
      for (const raw of triggerSet) {
        const i = Math.floor(raw);
        if (!Number.isFinite(i) || i < 0) continue;
        if (!fractured.has(i)) delta.add(i);
      }
      if (delta.size === 0) return null;
      if (frame - lastActivationFrame < minInterval) return null;
      const added = [...delta].sort((a, b) => a - b);
      for (const i of added) fractured.add(i);
      activationCount += 1;
      lastActivationFrame = frame;
      return {
        added,
        frame,
        totalFractured: fractured.size,
        signature: liveFractureSetSignature(added),
      };
    },
    reset() {
      fractured.clear();
      activationCount = 0;
      lastActivationFrame = -minInterval;
    },
  };
}

/** The fracture fields of the config, structurally typed. */
export interface LiveFractureConfigShape {
  gpgpuMorphFractureEnabled?: boolean;
  gpgpuMorphFractureCells?: number;
  gpgpuMorphFractureSeed?: number;
  gpgpuMorphFractureGap?: number;
}

/**
 * The fracture options a LIVE activation uses: the fracture
 * keys' cells / seed / gap, ignoring the Enabled key (that key
 * is the static gate — see fractureOptionFromConfig). Same
 * clamps and defaults as the static builder, so a live
 * activation divides the cloud exactly as the static fracture
 * would with the same key values.
 */
export function liveFractureOptionsFromConfig(
  config: LiveFractureConfigShape,
): VoronoiFractureOptions {
  return {
    cells: clampFractureCells(config.gpgpuMorphFractureCells ?? 12),
    seed: Number.isFinite(config.gpgpuMorphFractureSeed)
      ? Math.round(config.gpgpuMorphFractureSeed as number)
      : 1,
    gap: clampFractureGap(config.gpgpuMorphFractureGap ?? 0.25),
  };
}

export type LiveFractureBakeSource = 'static' | 'live' | 'none';

/**
 * The OR composition, resolved for one bake: the static
 * fracture wins wholesale while its Enabled key is on (the
 * bake fractures the whole cloud; live adds nothing); a
 * non-empty fractured union with the static fracture off
 * resolves 'live' with the live options; otherwise 'none'.
 */
export function resolveLiveFractureBake(
  config: LiveFractureConfigShape,
  fractured: ReadonlySet<number>,
): { source: LiveFractureBakeSource; options: VoronoiFractureOptions | null } {
  const staticOptions = fractureOptionFromConfig(config);
  if (staticOptions) return { source: 'static', options: staticOptions };
  if (fractured.size > 0) return { source: 'live', options: liveFractureOptionsFromConfig(config) };
  return { source: 'none', options: null };
}

/**
 * Apply the fracture to exactly the triggered particles of an
 * xyzw-packed bake array: the Phase AG transform is computed
 * over the whole cloud (so the division — sites, assignment,
 * centroids — is the very division the static bake would
 * produce for the same options), then only the triggered
 * particles take their transformed positions. Untriggered
 * particles and every w component stay bit-identical. With
 * the full set triggered the result is byte-identical to
 * applyVoronoiFracture over the same data; with an empty set
 * nothing is touched. Returns how many particles moved to
 * their fractured positions.
 */
export function applyLiveFractureComposite(
  data: Float32Array,
  count: number,
  fractured: ReadonlySet<number>,
  options: VoronoiFractureOptions,
): { moved: number } {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || data.length < n * 4 || fractured.size === 0) return { moved: 0 };
  const fracturedCloud = new Float32Array(data.subarray(0, n * 4));
  applyVoronoiFracture(fracturedCloud, n, options);
  let moved = 0;
  for (const i of fractured) {
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    const o = i * 4;
    data[o] = fracturedCloud[o];
    data[o + 1] = fracturedCloud[o + 1];
    data[o + 2] = fracturedCloud[o + 2];
    moved += 1;
  }
  return { moved };
}
