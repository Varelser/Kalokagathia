/**
 * Meander promotion (Grammar 2.0 stage 2, slice B7): the
 * per-particle wander term, lifted out of the Particle Life
 * block into an independent force.
 *
 * The term itself is Phase AA1's (lib/particleLifeBehavior.ts:
 * meanderVector / meanderPhaseForIndex — three phase-shifted
 * sines of the particle's own position, phase from the plHash
 * family). Until this slice it existed ONLY as the tail term
 * of the Particle Life velocity block: no independent enable
 * (Particle Life off meant the Amount key did nothing), no
 * chunk of its own in the force order, and no force-gate
 * coverage — the inventory (STAGE2_CHEAPB_INVENTORY.md §10)
 * called it a real feature buried inside another one.
 *
 * This slice gives it the three things the other promoted
 * forces have, without touching the legacy path:
 *
 *   1. A standalone enable (gpgpuMeanderEnabled). While it
 *      stands (and the Amount is above zero), the velocity
 *      builder splices a dedicated 'meander' force chunk
 *      (VEL_FRAG_FORCE_MEANDER) that applies the SAME law
 *      outside the Particle Life block, so the wander runs
 *      with Particle Life off. While the standalone stands,
 *      the Particle Life chunk runs in a derived form with
 *      its internal term removed, so a config with both on
 *      still applies the term exactly once (at the chunk's
 *      position in the force order instead of inside the
 *      block — after the block's friction / max-speed, a
 *      placement difference that only exists in configs the
 *      new key created).
 *   2. A name in the force order ('meander', appended last
 *      under the append-only discipline) and in the chunk
 *      metadata, so the order editor can place it.
 *   3. REP force-gate coverage: 'meander' is a live
 *      force-gate target under mask bit 14
 *      (LIVE_RULE_MEANDER_FORCE_BIT in
 *      lib/gpgpuParticleRulesLive.ts), consumed exactly like
 *      the slice-1C extension gates — the live segment ANDs
 *      the permit into grpMeander and the gated chunk variant
 *      multiplies the application by it. The gate covers BOTH
 *      homes of the term: while the standalone chunk is not
 *      built, a gated variant of the Particle Life chunk
 *      (internal term multiplied by grpMeander) carries it.
 *
 * Parameters stay the Phase AA1 pair
 * (gpgpuParticleLifeMeanderAmount / ...Scale): one parameter
 * set, two activation routes — a second Amount key would let
 * the two homes disagree about the same wander.
 *
 * Everything is inert at the defaults: the enable key is off,
 * so no variant stands, the stock shader strings stay
 * byte-identical, and the gate bit is part of the full
 * permit like every other force bit (a config with no
 * meander gate rule permits it for every particle).
 */
import type { ParticleConfig } from '../types';
import { clampMeanderAmount, clampMeanderScale } from './particleLifeBehavior';

export interface ResolvedMeander {
  /** The standalone enable key, verbatim. */
  enabled: boolean;
  /** Wander strength (Phase AA1 clamp: non-finite / negative read 0). */
  amount: number;
  /** Wander spatial scale (Phase AA1 clamp: non-finite / <= 0 reads 1). */
  scale: number;
}

/** Resolve the Meander keys (the enable + the shared AA1 pair). */
export function resolveMeander(config: ParticleConfig): ResolvedMeander {
  return {
    enabled: !!config.gpgpuMeanderEnabled,
    amount: clampMeanderAmount(config.gpgpuParticleLifeMeanderAmount ?? 0),
    scale: clampMeanderScale(config.gpgpuParticleLifeMeanderScale ?? 1),
  };
}

/**
 * Whether the standalone 'meander' chunk variant stands: the
 * enable key is on AND the term can act (amount above zero —
 * at zero the chunk's own guard skips it, so splicing it
 * would only churn the shader string, the rel-drag /
 * target-speed discipline). While this holds, the Particle
 * Life chunk runs without its internal term (single
 * application). The WGSL velocity pass consumes this same
 * predicate (meanderStandaloneEnabled uniform): its in-block
 * term yields to its standalone block, so the term applies
 * exactly once on the WebGPU route too (the B7-era
 * 'meander-standalone' capability gap declaration was
 * retired when the WGSL term landed).
 */
export function meanderStandaloneActive(config: ParticleConfig): boolean {
  const m = resolveMeander(config);
  return m.enabled && m.amount > 0;
}

/**
 * Whether the wander term can act at all under this config:
 * inside the Particle Life block (Life on, amount above zero)
 * or through the standalone chunk. Display / diagnostic
 * readout only — the shader guards remain the source of
 * truth.
 */
export function meanderTermActive(config: ParticleConfig): boolean {
  const m = resolveMeander(config);
  return m.amount > 0 && (!!config.gpgpuParticleLifeEnabled || m.enabled);
}
