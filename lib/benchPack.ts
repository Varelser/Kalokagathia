/**
 * Bench evidence + visual critic pack (Phase 15, Abyssal C),
 * adapted from the Abyssal Garden transfer lab prototype
 * (~/workspace/abyssal-transfer-lab/src/bench.mjs).
 *
 * Bench collects frame times (avg / p99 / max) while a scripted
 * tour runs; the critic pack is the manifest that goes with the
 * tour's renders to a visual critic who sees ONLY the renders —
 * never code, never this manifest's reasoning — and grades them
 * against the fixed check list. Together they are the evidence
 * half of a gate: numbers from the bench, eyes from the critic.
 *
 * The collector is a dev/diagnostic surface: it installs as
 * window.__kaloBench only under ?diag=1 (the same gate as the
 * __kaloDiag hook), fed by a probe component inside the Canvas.
 */

export interface BenchStats {
  n: number;
  avg: number;
  p99: number;
  max: number;
}

export class Bench {
  private frame: Float64Array;

  private nf = 0;

  private cap: number;

  constructor(capacity = 1 << 16) {
    this.cap = capacity;
    this.frame = new Float64Array(capacity);
  }

  push(frameMs: number): void {
    if (this.nf < this.cap) this.frame[this.nf++] = frameMs;
  }

  reset(): void {
    this.nf = 0;
  }

  static stats(arr: Float64Array, n: number): BenchStats | null {
    if (!n) return null;
    const s = Array.from(arr.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    for (const v of s) sum += v;
    return {
      n,
      avg: +(sum / n).toFixed(3),
      p99: +s[Math.min(n - 1, Math.floor(n * 0.99))].toFixed(3),
      max: +s[n - 1].toFixed(3),
    };
  }

  report(label = ''): { label: string; frame: BenchStats | null } {
    return { label, frame: Bench.stats(this.frame, this.nf) };
  }
}

export interface CriticPose {
  id: string;
  preset?: string | null;
  camera?: unknown;
  holdFrames?: number;
}

export interface CriticPack {
  pack: string;
  rule: string;
  poses: Array<{
    index: number;
    id: string;
    camera: unknown;
    preset: string | null;
    holdFrames: number;
  }>;
  checks: string[];
  verdictScale: string[];
  passWhen: string;
  benchReportAttached: boolean;
}

export const CRITIC_DEFAULT_CHECKS = [
  'shimmer / flicker',
  'popping on transitions',
  'banding',
  'subject not visible (blown out or crushed to black)',
  'aliasing',
] as const;

export function buildCriticPack(
  tourName: string,
  poses: CriticPose[],
  opts: { checks?: string[] } = {},
): CriticPack {
  return {
    pack: tourName,
    rule: "The critic receives ONLY the renders (one still per pose + the tour recording). Never code, never this manifest's reasoning.",
    poses: poses.map((p, i) => ({
      index: i + 1,
      id: p.id,
      camera: p.camera ?? null,
      preset: p.preset ?? null,
      holdFrames: p.holdFrames ?? 30,
    })),
    checks: opts.checks ?? [...CRITIC_DEFAULT_CHECKS],
    verdictScale: ['blocker', 'major', 'minor', 'none'],
    passWhen: 'nothing above minor',
    benchReportAttached: true,
  };
}

// --- Diag surface ---------------------------------------------------

export interface KaloBenchSurface {
  report: (label?: string) => { label: string; frame: BenchStats | null };
  criticPack: (tourName: string, poses: CriticPose[]) => CriticPack;
  reset: () => void;
  samples: () => number;
}

const sharedBench = new Bench();

export function getSharedBench(): Bench {
  return sharedBench;
}

export function pushBenchFrame(frameMs: number): void {
  sharedBench.push(frameMs);
}

/** Install window.__kaloBench (idempotent). Diag-gated by callers. */
export function installBenchSurface(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __kaloBench?: KaloBenchSurface };
  if (w.__kaloBench) return;
  w.__kaloBench = {
    report: (label = '') => sharedBench.report(label),
    criticPack: (tourName, poses) => buildCriticPack(tourName, poses),
    reset: () => sharedBench.reset(),
    samples: () => sharedBench.report().frame?.n ?? 0,
  };
}
