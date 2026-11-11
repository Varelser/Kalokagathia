// L-system (Lindenmayer system) recursive generation for layers 2/3.
//
// Pure TypeScript string rewriting + turtle interpretation on the CPU.
// Deterministic: every stochastic choice (the 'lightning' ruleset's
// stochastic productions and its turtle angle jitter) draws from a seeded
// mulberry32 PRNG, so the same seed + params always produce byte-identical
// geometry. The deterministic rulesets (plant / fern / tree / coral) never
// consume the PRNG and are seed-independent.
//
// Hard cap: MAX_SEGMENTS total drawn segments. Rewriting stops growing the
// string past MAX_STRING_LENGTH characters and the turtle stops emitting
// segments at the cap (graceful truncation, `truncated` reports it).
//
// Output space is the layer sheet's unit space: x centred on 0, the base
// anchored at y = 0, extending +y for bottom-anchored rulesets (height
// <= 0.92) or -y for the top-anchored 'lightning'. The renderer scales by
// the sheet's planeSize. Vertex colours are monochrome grayscale with a
// gradient along bracket (branch) depth; the renderer tints by layer colour.

export type LSystemPresetId = 'plant' | 'fern' | 'tree' | 'coral' | 'lightning';

export interface LSystemParams {
  preset: LSystemPresetId;
  /** Rewriting iterations, 1..8. */
  depth: number;
  /** Turn angle for '+' / '-', degrees. */
  angleDeg: number;
  /** Step length multiplier per bracket depth level, 0.5..0.95. */
  lengthDecay: number;
  /** PRNG seed (only the stochastic ruleset consumes it). */
  seed: number;
  /** Constant turn bias added per drawn step, degrees. */
  curvatureDeg: number;
  /** Step length at bracket depth 0, in unit space before normalisation. */
  baseLength?: number;
}

export interface LSystemResult {
  /** LineSegments vertex positions, 2 vertices (6 floats) per segment. */
  positions: Float32Array;
  /** LineSegments vertex colours (grayscale rgb), 6 floats per segment. */
  colors: Float32Array;
  segmentCount: number;
  anchor: 'bottom' | 'top';
  truncated: boolean;
}

export const L_SYSTEM_MAX_SEGMENTS = 60000;
const MAX_STRING_LENGTH = 2_000_000;
const FIT = 0.92; // normalised extent inside the unit sheet

/** mulberry32: small fast seeded PRNG, identical across runs/platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Production = string | readonly string[];

interface RuleSet {
  axiom: string;
  productions: Readonly<Record<string, Production>>;
  anchor: 'bottom' | 'top';
  /** 'tips': base dim -> tips bright. 'trunk': trunk bright -> tips dim. */
  brightness: 'tips' | 'trunk';
  baseLength: number;
}

export const L_SYSTEM_RULE_SETS: Record<LSystemPresetId, RuleSet> = {
  // Classic fractal plant (Prusinkiewicz & Lindenmayer).
  plant: {
    axiom: 'X',
    productions: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' },
    anchor: 'bottom',
    brightness: 'tips',
    baseLength: 0.16,
  },
  // Feathery fern frond: same family as plant, mirrored bias so fronds
  // sweep to one side with finer side leaflets.
  fern: {
    axiom: 'X',
    productions: { X: 'F-[[X]+X]+F[+FX]-X', F: 'FF' },
    anchor: 'bottom',
    brightness: 'tips',
    baseLength: 0.16,
  },
  // Binary tree: each apex emits two trunk segments then forks into two
  // apices. F has NO production (identity): an F-rewriting variant
  // (F -> FF / FFF) was auditioned and rejected — it multiplies the
  // trunk run exponentially, collapsing the canopy into a lollipop on a
  // long stalk (ASCII-auditioned 2026-11-11). With F fixed, every level
  // contributes equal relative length and the canopy fills the frame.
  tree: {
    axiom: 'X',
    productions: { X: 'FF[-X][+X]' },
    anchor: 'bottom',
    brightness: 'tips',
    baseLength: 0.13,
  },
  // Sea-fan coral: ternary fan from every apex. F identity for the same
  // reason as tree — the fan must dominate the stalk; pair with a gentle
  // length decay (~0.85) so outer branches stay long and the fan spreads.
  coral: {
    axiom: 'X',
    productions: { X: 'FF[-X][X][+X]' },
    anchor: 'bottom',
    brightness: 'tips',
    baseLength: 0.11,
  },
  // Lightning: stochastic productions (seeded choice per F during
  // rewriting). The turtle adds seeded angle jitter, a downward heading
  // bias (each step lerps the heading back toward straight down) and a
  // per-branch energy budget: entering '[' scales energy by 0.6 and
  // segments stop drawing once energy falls below the threshold, so
  // forks die quickly while the main stem (energy 1) runs full length.
  lightning: {
    axiom: 'F',
    productions: {
      F: ['F[+F]F', 'F[-F]F', 'FF', 'F[+FF][-F]F', 'F[+F][-F]F', 'FFF'],
    },
    anchor: 'top',
    brightness: 'trunk',
    baseLength: 0.085,
  },
};

const DEG = Math.PI / 180;

function rewrite(rules: RuleSet, iterations: number, rng: () => number): { text: string; truncated: boolean } {
  let current = rules.axiom;
  let truncated = false;
  for (let i = 0; i < iterations; i += 1) {
    let next = '';
    for (const ch of current) {
      const prod = rules.productions[ch];
      if (prod === undefined) {
        next += ch;
      } else if (typeof prod === 'string') {
        next += prod;
      } else {
        next += prod[Math.floor(rng() * prod.length) % prod.length];
      }
      if (next.length > MAX_STRING_LENGTH) { truncated = true; break; }
    }
    current = next;
    if (truncated) break;
  }
  return { text: current, truncated };
}

interface RawSegment { x1: number; y1: number; x2: number; y2: number; depth: number; energy: number }

export function generateLSystem(params: LSystemParams): LSystemResult {
  const rules = L_SYSTEM_RULE_SETS[params.preset] ?? L_SYSTEM_RULE_SETS.plant;
  const iterations = Math.min(8, Math.max(1, Math.round(params.depth)));
  const angle = params.angleDeg * DEG;
  const curvature = params.curvatureDeg * DEG;
  const decay = Math.min(0.95, Math.max(0.5, params.lengthDecay));
  const baseLength = params.baseLength ?? rules.baseLength;
  const stochastic = params.preset === 'lightning';
  // Mix the user seed so seed 0/1 do not sit on the PRNG's weak low bits.
  const rng = mulberry32((Math.round(params.seed) * 2654435761) ^ 0x9e3779b9);

  const { text, truncated: rewriteTruncated } = rewrite(rules, iterations, rng);

  // Turtle interpretation. Heading 0 = +Y (up); positive turns rotate
  // counter-clockwise. Lightning starts pointing down (-Y).
  const down = rules.anchor === 'top';
  let x = 0;
  let y = 0;
  let heading = down ? -Math.PI : 0; // direction vector (sin h, cos h): h=0 -> +Y, h=-PI -> -Y
  let bracketDepth = 0;
  let energy = 1;
  const stack: { x: number; y: number; heading: number; depth: number; energy: number }[] = [];
  const raw: RawSegment[] = [];
  let maxDepth = 0;
  let truncated = rewriteTruncated;

  for (const ch of text) {
    if (raw.length >= L_SYSTEM_MAX_SEGMENTS) { truncated = true; break; }
    if (ch === 'F') {
      if (stochastic) {
        // Seeded jitter + downward bias: the heading is pulled 10% back
        // toward straight down every step, so forks converge downward.
        heading += (rng() - 0.5) * 0.3;
        heading += (-Math.PI - heading) * 0.1;
      }
      heading += curvature;
      const len = baseLength * Math.pow(decay, bracketDepth) * (stochastic ? 0.35 + 0.65 * energy : 1);
      const nx = x + Math.sin(heading) * len;
      const ny = y + Math.cos(heading) * len;
      if (!stochastic || energy >= 0.16) {
        raw.push({ x1: x, y1: y, x2: nx, y2: ny, depth: bracketDepth, energy });
        if (bracketDepth > maxDepth) maxDepth = bracketDepth;
      }
      x = nx;
      y = ny;
    } else if (ch === '+') {
      heading += angle;
    } else if (ch === '-') {
      heading -= angle;
    } else if (ch === '[') {
      stack.push({ x, y, heading, depth: bracketDepth, energy });
      bracketDepth += 1;
      if (stochastic) energy *= 0.6;
    } else if (ch === ']') {
      const s = stack.pop();
      if (s) { x = s.x; y = s.y; heading = s.heading; bracketDepth = s.depth; energy = s.energy; }
    }
  }

  // Normalise: centre x on the bounding box, anchor the base at y = 0,
  // scale so the larger extent fits FIT (never shrink below readability
  // is unnecessary — always fit exactly, structures read at sheet size).
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const s of raw) {
    minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2);
  }
  const count = raw.length;
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  if (count > 0) {
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    const scale = Math.min(FIT / w, FIT / h);
    const cx = (minX + maxX) / 2;
    // Bottom anchor: base = minY, structure extends +y. Top anchor
    // (lightning): base = maxY (the turtle start), structure extends -y.
    // One formula serves both because the turtle's y already runs the
    // right way from the base in each case.
    const baseY = down ? maxY : minY;
    for (let i = 0; i < count; i += 1) {
      const s = raw[i];
      const t = maxDepth > 0 ? s.depth / maxDepth : 0;
      let b = rules.brightness === 'tips' ? 0.22 + 0.78 * t : 1 - 0.72 * t;
      if (stochastic) b *= 0.3 + 0.7 * s.energy;
      const b0 = b * 0.82;
      positions[i * 6 + 0] = (s.x1 - cx) * scale;
      positions[i * 6 + 1] = (s.y1 - baseY) * scale;
      positions[i * 6 + 2] = 0;
      positions[i * 6 + 3] = (s.x2 - cx) * scale;
      positions[i * 6 + 4] = (s.y2 - baseY) * scale;
      positions[i * 6 + 5] = 0;
      colors[i * 6 + 0] = b0; colors[i * 6 + 1] = b0; colors[i * 6 + 2] = b0;
      colors[i * 6 + 3] = b; colors[i * 6 + 4] = b; colors[i * 6 + 5] = b;
    }
  }
  return { positions, colors, segmentCount: count, anchor: rules.anchor, truncated };
}
