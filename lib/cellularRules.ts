// ── Discrete cellular automata (Phase AM) ──────────────────────
// The rule engine of components/cellularPass.ts: B/S (birth /
// survival) rules over a binary grid with wrap-around edges —
// the discrete CA the 2D audit §5 recorded as absent ("離散 CA
// は無い" was a confirmed fact about the pre-AM app; the
// layer-side reaction systems are continuous and stay a
// separate grammar). The CPU twin here pins the rule semantics
// the GLSL step shader implements: a dead cell with a neighbour
// count in B is born, a live cell with a count in S survives,
// everything else dies or stays dead. Neighbourhood is Moore
// (8 neighbours), edges wrap.

export type CellularRuleName =
  | 'life'
  | 'highlife'
  | 'daynight'
  | 'seeds'
  | 'maze'
  | 'coral';

export interface CellularRule {
  birth: readonly number[];
  survive: readonly number[];
}

export const CELLULAR_RULES: Record<CellularRuleName, CellularRule> = {
  life: { birth: [3], survive: [2, 3] },
  highlife: { birth: [3, 6], survive: [2, 3] },
  daynight: { birth: [3, 6, 7, 8], survive: [3, 4, 6, 7, 8] },
  seeds: { birth: [2], survive: [] },
  maze: { birth: [3], survive: [1, 2, 3, 4, 5] },
  coral: { birth: [3], survive: [4, 5, 6, 7, 8] },
};

export const CELLULAR_RULE_NAMES: readonly CellularRuleName[] = [
  'life',
  'highlife',
  'daynight',
  'seeds',
  'maze',
  'coral',
] as const;

export function resolveCellularRule(name: string): CellularRule {
  return (CELLULAR_RULES as Record<string, CellularRule>)[name] ?? CELLULAR_RULES.life;
}

/** Bit mask of a neighbour-count set (bit n = count n). */
export function cellularCountMask(counts: readonly number[]): number {
  let mask = 0;
  for (const n of counts) {
    if (n >= 0 && n <= 8) mask |= 1 << n;
  }
  return mask;
}

export function clampCellularCellSize(v: number): number {
  if (!Number.isFinite(v)) return 4;
  return Math.max(1, Math.min(16, Math.round(v)));
}

export function clampCellularSeedThreshold(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

export function clampCellularMix(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/** Seed a grid from luminance values at a threshold. */
export function seedCellularGrid(
  lumas: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const t = clampCellularSeedThreshold(threshold);
  for (let i = 0; i < width * height; i++) {
    out[i] = (lumas[i] ?? 0) >= t ? 1 : 0;
  }
  return out;
}

/** One CA step (wrap-around Moore neighbourhood). */
export function stepCellularGrid(
  grid: ArrayLike<number>,
  width: number,
  height: number,
  rule: CellularRule,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const birthMask = cellularCountMask(rule.birth);
  const surviveMask = cellularCountMask(rule.survive);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + width) % width;
          const ny = (y + dy + height) % height;
          count += grid[ny * width + nx] ? 1 : 0;
        }
      }
      const alive = grid[y * width + x] ? 1 : 0;
      const mask = alive ? surviveMask : birthMask;
      out[y * width + x] = (mask >> count) & 1;
    }
  }
  return out;
}
