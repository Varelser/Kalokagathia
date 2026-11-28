// Aux trail A/B diagnostic switch (the ?diag=1 hook's
// setAuxTrailAbStage / captureAuxTrailAbInfo read and drive
// these)
//
// Stage-4 gate fix round 6 (STAGE4_FIX11_AUX_AB_RECORD):
// the G4-5 triage ended at "candidate (a), concentrated" —
// in steady state the level-1 Aux trail event test never
// fires although the tick walks all residues, the passes
// render, and the landing samples agree with the pool
// readback (GATE_STAGE4_FIXROUND5_RECORD). The registered
// next step is a real-GPU A/B with a minimised trail branch.
// This module is the switchboard for that A/B:
//
// - The stage list lives in components/gpgpuShaderAux.ts
//   (AUX_TRAIL_AB_STAGES): 'A' is the stock trail branch,
//   the B stages are hypothesis-isolating minimisations of
//   it, selected through the builders' `trailAb` option.
//   Without the option (every non-diag build path) the
//   assembled strings are the stock ones byte-for-byte.
// - The diag hook calls requestAuxTrailAbStage(stage); the
//   request is forwarded to the applier registered by
//   useGpgpuSimulationAssets, which holds the Aux materials
//   in React state and rebuilds the level-1 trio (vel / pos
//   / inherit) around the SAME shared uniforms object — the
//   FIX6/FIX10 delivery discipline (material replacement,
//   never a fragmentShader rewrite on a live instance).
// - The applier reports the stage it actually rebuilt with
//   through noteAuxTrailAbApplied, so the hook can separate
//   "requested" from "applied"; the applied stage is also
//   independently readable from the live materials' fragment
//   strings (each B branch carries an
//   `aux-trail-ab-stage: Bx` marker comment; the stock
//   branch carries none).
//
// Nothing here runs outside the ?diag=1 hook: no product
// code path requests a stage, so the requested stage stays
// 'A' and the builders' default output is untouched.

import type { AuxTrailAbStage } from '../components/gpgpuShaderAux';

export type { AuxTrailAbStage };

export interface AuxTrailAbDiagState {
  /** Stage most recently requested through the diag hook
   *  ('A' until the first request). */
  requestedStage: AuxTrailAbStage;
  /** Stage the assets hook most recently rebuilt the
   *  level-1 Aux materials with ('A' initially — the
   *  initial materials are built with the stock branch). */
  appliedStage: AuxTrailAbStage;
  /** How many rebuilds the applier has performed for A/B
   *  requests (the initial build is not counted). */
  rebuildCount: number;
}

const auxTrailAbDiag: AuxTrailAbDiagState = {
  requestedStage: 'A',
  appliedStage: 'A',
  rebuildCount: 0,
};

type AuxTrailAbApplier = (stage: AuxTrailAbStage) => void;
let applier: AuxTrailAbApplier | null = null;

/** Registered by useGpgpuSimulationAssets while mounted.
 *  Returns the unregister function. A later registration
 *  replaces an earlier one (single scene instance). */
export function registerAuxTrailAbApplier(fn: AuxTrailAbApplier): () => void {
  applier = fn;
  return () => {
    if (applier === fn) applier = null;
  };
}

/** Diag hook only: request a trail A/B stage. The applier
 *  (assets hook) rebuilds the level-1 Aux materials with
 *  the stage's branch; until it reports back through
 *  noteAuxTrailAbApplied, `appliedStage` still names the
 *  previously applied stage. Returns false when no applier
 *  is registered (scene not mounted). */
export function requestAuxTrailAbStage(stage: AuxTrailAbStage): boolean {
  auxTrailAbDiag.requestedStage = stage;
  if (!applier) return false;
  applier(stage);
  return true;
}

/** Called by the applier after it rebuilt the materials
 *  with `stage`. */
export function noteAuxTrailAbApplied(stage: AuxTrailAbStage): void {
  auxTrailAbDiag.appliedStage = stage;
  auxTrailAbDiag.rebuildCount += 1;
}

export function getAuxTrailAbDiagState(): AuxTrailAbDiagState {
  return { ...auxTrailAbDiag };
}
