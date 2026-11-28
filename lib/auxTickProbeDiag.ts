// Aux tick-probe diagnostic state (the ?diag=1 hook's
// captureAuxTickProbeStats arms and reads these)
//
// Stage-4 gate fix round 7 (STAGE4_FIX12_AUX_GPU_PROBE_RECORD):
// the second stage of the G4-5 separation proposed by
// diagnosis M. The JS-side time supply is proven sound (the
// runner writes timeRef.current into the Aux materials'
// shared uniforms object every frame, and the JS map values
// read back through captureAuxVariantInfo advance with
// simTime), and the phase-7 A/B separated the fault to the
// tick phase condition — B2 (tick phase only) never fires
// and B6 (double-mod reformulation) does not fire either, so
// the suspect is the tick VALUE the compiled program
// evaluates, not the mod() form. What has never been read
// is that evaluation itself, inside a program compiled from
// the same source and fed the same uniforms object.
//
// This module is the switchboard + sample store, the
// lib/auxPassDiag.ts discipline: the diag hook arms ONE
// side ('vel' or 'pos'); on the next frame the level-1 Aux
// runner (components/gpgpuSimulationPasses'
// runAuxSimulationPasses) renders a probe material — built
// from that side's OWN fragment string with only the main()
// output replaced by the program's declaration of
// [tick, trailPhase, trailTick, uTrailEmitInterval], and
// sharing that side's uniforms OBJECT by reference — into a
// dedicated target, reads back the first texels and stores
// the sample here. Arming vel and pos separately separates
// a one-sided tick failure from a both-sides one (the
// phase-7 A/B replaced both materials at once and could
// not). Unarmed frames pay nothing; the probe never writes
// into the pool targets.

/** Which level-1 Aux pass a probe sample belongs to. */
export type AuxTickProbeSide = 'vel' | 'pos';

/** Texels read back per probe render. The first texels of
 *  the first row carry auxIdx 0..N-1, so with N = 8 every
 *  trail phase of an interval up to 8 is represented,
 *  interval 6 (the gate configuration) included. */
export const AUX_TICK_PROBE_TEXELS = 8;

export interface AuxTickProbeSample {
  /** The side this sample was probed on. */
  side: AuxTickProbeSide;
  /**
   * The program's own declaration, one entry per read-back
   * texel: [tick, trailPhase, trailTick, uTrailEmitInterval]
   * with tick = floor(uTime * 60.0), trailPhase = the
   * slot's phase (auxIdx mod interval, computed
   * boundary-avoiding as mod(auxIdx + 0.5, interval) -
   * 0.5), trailTick = 1.0 when the stock branch's phase
   * test mod(tick - auxIdx + 0.5, interval) < 1.0 holds
   * else 0.0 — the trail branch's expressions verbatim
   * (components/gpgpuShaderAux.ts, buildAuxTickProbeFrag;
   * FIX13 phrasing — the pre-FIX13 probe declared the
   * original two-step form).
   * tick is a per-frame value and must agree across texels;
   * trailPhase steps with auxIdx.
   */
  texels: number[][];
  /** The frame time (the runner's `time` argument, the
   *  same value written into uTime that frame). */
  time: number;
  /** Aux pass render counters at the moment the sample was
   *  taken (lib/auxPassDiag.ts) — a sample whose counters
   *  exceed a previously returned sample's was taken after
   *  a later frame's renders. */
  velRenders: number;
  posRenders: number;
}

export interface AuxTickProbeDiagState {
  /** The side a probe is armed for and waiting on, or null
   *  when no probe is in flight. Only one side is armed at
   *  a time, so a one-sided failure cannot be masked by the
   *  other side's sample landing first. */
  armedSide: AuxTickProbeSide | null;
  /** The most recent vel-side sample (null until the first
   *  armed vel probe lands). Kept until a newer vel sample
   *  lands; arming does not clear it. */
  velSample: AuxTickProbeSample | null;
  /** Same for the position pass. */
  posSample: AuxTickProbeSample | null;
}

const auxTickProbeDiag: AuxTickProbeDiagState = {
  armedSide: null,
  velSample: null,
  posSample: null,
};

/** Arm the one-shot tick probe for one side (diag hook
 *  only). The side's previous sample is kept until the new
 *  one lands. */
export function armAuxTickProbe(side: AuxTickProbeSide): void {
  auxTickProbeDiag.armedSide = side;
}

/** The side a probe is currently armed for, or null. The
 *  Aux runner reads this every frame; null costs a single
 *  comparison. */
export function auxTickProbeArmedSide(): AuxTickProbeSide | null {
  return auxTickProbeDiag.armedSide;
}

export function noteAuxTickProbeSample(
  side: AuxTickProbeSide,
  texels: number[][],
  time: number,
  velRenders: number,
  posRenders: number,
): void {
  const sample: AuxTickProbeSample = {
    side,
    texels: texels.map((t) => [...t]),
    time,
    velRenders,
    posRenders,
  };
  if (side === 'vel') auxTickProbeDiag.velSample = sample;
  else auxTickProbeDiag.posSample = sample;
  if (auxTickProbeDiag.armedSide === side) auxTickProbeDiag.armedSide = null;
}

export function getAuxTickProbeState(): AuxTickProbeDiagState {
  const copy = (s: AuxTickProbeSample | null): AuxTickProbeSample | null =>
    s
      ? {
          side: s.side,
          texels: s.texels.map((t) => [...t]),
          time: s.time,
          velRenders: s.velRenders,
          posRenders: s.posRenders,
        }
      : null;
  return {
    armedSide: auxTickProbeDiag.armedSide,
    velSample: copy(auxTickProbeDiag.velSample),
    posSample: copy(auxTickProbeDiag.posSample),
  };
}
