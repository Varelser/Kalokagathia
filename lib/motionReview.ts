/**
 * Motion Review findings model (Phase 15, ink — small version:
 * record and present only).
 *
 * The deterministic renderer's loop measurement (drift / jump
 * between frame 0, the last frame, and the one-period probe) is
 * turned into structured findings — a kind, a measured value,
 * the frame range it belongs to, and a severity — accumulated in
 * a session store and presented in the Play tab next to the prose
 * loop report.
 *
 * Non-destructive by construction: findings live in memory only.
 * Nothing here writes config keys, saved settings, or project
 * files; the correction layer the full model envisages (and the
 * 'spacing-spike' / 'arc-kink' kinds, which need per-frame
 * spacing / curvature analysis the loop measurement does not
 * provide) is future work — the kinds are declared so records
 * stay forward-compatible.
 */

import type { DeterministicLoopMeasurement } from './deterministicRender';

export type MotionReviewFindingKind =
  | 'loop-pop'
  | 'loop-drift'
  | 'spacing-spike'
  | 'arc-kink';

export interface MotionReviewFinding {
  id: string;
  kind: MotionReviewFindingKind;
  /** Headline measured value (mean abs diff, 0-255, for loop kinds). */
  value: number;
  /** Mismatch ratio (0..1) where the measurement provides one. */
  ratio: number | null;
  frameStart: number;
  frameEnd: number;
  severity: 'info' | 'warn';
  note: string;
  recordedAt: string;
}

/** A seam counts as visible when more than 2% of pixels move by
 *  more than 8/255 across it — the same mismatch definition the
 *  loop measurement itself uses. */
export const MOTION_REVIEW_VISIBLE_RATIO = 0.02;

let findingCounter = 0;

export function deriveLoopFindings(
  loop: DeterministicLoopMeasurement,
  recordedAt: string,
): MotionReviewFinding[] {
  const findings: MotionReviewFinding[] = [];
  const driftVisible = loop.seamDriftMismatchRatio > MOTION_REVIEW_VISIBLE_RATIO;
  const jumpVisible = loop.seamJumpMismatchRatio > MOTION_REVIEW_VISIBLE_RATIO;
  findingCounter += 1;
  findings.push({
    id: `mr-${recordedAt}-${findingCounter}-drift`,
    kind: 'loop-drift',
    value: loop.seamDriftMeanAbsDiff,
    ratio: loop.seamDriftMismatchRatio,
    frameStart: 0,
    frameEnd: loop.periodFrames,
    severity: driftVisible ? 'warn' : 'info',
    note: driftVisible
      ? `1周期後の画面が先頭とずれています（最大差 ${loop.seamMaxAbsDiff}）。状態を持つシミュレーションの蓄積が主因です。`
      : 'ドリフトは可視しきい値以下で、この長さでは継ぎ目なくループします。',
    recordedAt,
  });
  findingCounter += 1;
  findings.push({
    id: `mr-${recordedAt}-${findingCounter}-pop`,
    kind: 'loop-pop',
    value: loop.seamJumpMeanAbsDiff,
    ratio: loop.seamJumpMismatchRatio,
    frameStart: loop.periodFrames - 1,
    frameEnd: 0,
    severity: jumpVisible ? 'warn' : 'info',
    note: jumpVisible
      ? '末尾から先頭へ巻き戻る瞬間に見える跳びがあります。編集側のクロスフェードが対処になります。'
      : '巻き戻しの跳びは可視しきい値以下です（末尾の動き自体を含む値です）。',
    recordedAt,
  });
  return findings;
}

// --- Session store (in-memory only, newest first) ---------------

const findingsStore: MotionReviewFinding[] = [];
const listeners = new Set<() => void>();

export function recordMotionReviewFindings(findings: MotionReviewFinding[]): void {
  findingsStore.unshift(...findings);
  listeners.forEach((fn) => fn());
}

export function getMotionReviewFindings(): readonly MotionReviewFinding[] {
  return findingsStore;
}

export function clearMotionReviewFindings(): void {
  findingsStore.length = 0;
  listeners.forEach((fn) => fn());
}

export function subscribeMotionReviewFindings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
