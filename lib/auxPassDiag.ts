// Aux pass diagnostic state (the ?diag=1 hook's
// captureAuxPassLandingStats reads these)
//
// Stage-4 gate fix round 5 (STAGE4_FIX10_AUX_TICK_RECORD):
// the level-1 Aux passes (components/gpgpuSimulationPasses'
// runAuxSimulationPasses) record every render here — a plain
// counter increment and the output target's texture uuid,
// the same discipline as the motion-blur pass state in
// lib/motionBlur.ts — so a gate can confirm the passes are
// actually rendering, and into which targets, without pixel
// inference. On top of that, a one-shot landing probe can be
// armed (only the ?diag=1 hook arms it): the next time the
// passes finish a frame, the runner reads back the first
// texels of both output targets IMMEDIATELY after the
// renders and stores them here. The readback therefore
// costs nothing while unarmed; while armed it costs one
// tiny readback on one frame.
//
// Why this exists: the G4-5 triage (rounds 3–4) separated
// the fault down to "in steady state the Aux pool never
// respawns, although aging advances and the source-level
// event test should keep firing". The remaining candidates
// are below the source layer (the compiled program's
// behaviour vs the passes' renders not landing where the
// readback looks). This state separates the second: if the
// render counters advance and a landing sample taken right
// after a render shows the just-written texels, the renders
// DO land in the targets the diag hook reads back.

/** Texels read back per target by the landing probe. */
export const AUX_PASS_LANDING_TEXELS = 4;

export interface AuxPassLandingSample {
  /**
   * First texels of the velocity output target, read back
   * immediately after the frame's Aux renders completed
   * (one [x, y, z, w] entry per texel; w = life).
   */
  velTexels: number[][];
  /** Same for the position output target (w = age). */
  posTexels: number[][];
  /** Render counters at the moment the sample was taken —
   *  a sample whose counters exceed the previously returned
   *  sample's was taken after a later frame's renders. */
  velRenders: number;
  posRenders: number;
}

export interface AuxPassDiagState {
  /** runAuxSimulationPasses velocity-pass renders seen. */
  velRenders: number;
  /** runAuxSimulationPasses position-pass renders seen. */
  posRenders: number;
  /** Texture uuid of the velocity output target of the
   *  most recent render (null before the first render). */
  lastVelTargetUuid: string | null;
  /** Same for the position output target. */
  lastPosTargetUuid: string | null;
  /** A landing probe is armed and waiting for the next
   *  frame's renders. */
  landingArmed: boolean;
  /** The most recent landing sample (null until the first
   *  armed probe lands). Kept until a newer sample lands;
   *  arming does not clear it. */
  landingSample: AuxPassLandingSample | null;
}

const auxPassDiag: AuxPassDiagState = {
  velRenders: 0,
  posRenders: 0,
  lastVelTargetUuid: null,
  lastPosTargetUuid: null,
  landingArmed: false,
  landingSample: null,
};

export function noteAuxPassRender(pass: 'vel' | 'pos', targetTextureUuid: string): void {
  if (pass === 'vel') {
    auxPassDiag.velRenders += 1;
    auxPassDiag.lastVelTargetUuid = targetTextureUuid;
  } else {
    auxPassDiag.posRenders += 1;
    auxPassDiag.lastPosTargetUuid = targetTextureUuid;
  }
}

/** Arm the one-shot landing probe (diag hook only). The
 *  previous sample is kept until the new one lands. */
export function armAuxPassLandingProbe(): void {
  auxPassDiag.landingArmed = true;
}

export function auxPassLandingArmed(): boolean {
  return auxPassDiag.landingArmed;
}

export function noteAuxPassLandingSample(velTexels: number[][], posTexels: number[][]): void {
  auxPassDiag.landingSample = {
    velTexels,
    posTexels,
    velRenders: auxPassDiag.velRenders,
    posRenders: auxPassDiag.posRenders,
  };
  auxPassDiag.landingArmed = false;
}

export function getAuxPassDiagState(): AuxPassDiagState {
  const s = auxPassDiag.landingSample;
  return {
    ...auxPassDiag,
    landingSample: s
      ? {
          velTexels: s.velTexels.map((t) => [...t]),
          posTexels: s.posTexels.map((t) => [...t]),
          velRenders: s.velRenders,
          posRenders: s.posRenders,
        }
      : null,
  };
}
