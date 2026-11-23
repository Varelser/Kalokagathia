/**
 * Deposit–bleed reaction model (Phase 19 stage 5, 2D §6 堆積・にじみ).
 *
 * A fourth model for the layer2/layer3 reaction-diffusion ping-pong
 * field, added alongside Gray-Scott / FHN / Lenia. The field texture
 * carries four channels:
 *   .x A — supply (replenished by Feed, as in Gray-Scott)
 *   .y B — wet pigment (diffuses, decays via Kill, is consumed into
 *          the deposit)
 *   .z D — DEPOSIT （堆積）: accumulates from the wet pigment at the
 *          Feed rate and stays in the field. Its only loss term is
 *          the per-step retention multiplier (the layer's
 *          ReactionDepositRetention key, default 1 = no decay at
 *          all), and it saturates through a (1 − D) factor plus a
 *          hard clamp to [0, 1].
 *   .w L — BLEED （にじみ）: a halo channel fed by the wet pigment,
 *          spread by a wide convex blur (radius 1 + radius 2 taps,
 *          weights sum to 1, so the spread step is unconditionally
 *          stable) and decayed by Kill. It reads as the stain that
 *          soaks outward from a deposit.
 *
 * Feed / Kill are the layer's existing reaction keys, reused as the
 * design specifies (Feed = deposition transfer rate, Kill = bleed /
 * wet-pigment decay). The only new key per layer is the retention.
 *
 * The GLSL branch (model 3) in
 * components/sceneReactionDiffusionShaders.ts is a 1:1 mirror of
 * `depositBleedStep` below; the constants live here and are pinned
 * by scripts/phase19-deposit-bleed.test.mjs, which also checks the
 * shader string carries the same constants. Screen persistence was
 * evaluated for this role and rejected in the stage-5 design (the
 * deposit must live in the field itself, not in a display trail).
 *
 * Identity: the model is only selected when the layer's
 * ReactionModel is 'deposit-bleed'. Every other model writes
 * .z = 0 / .w = 1 exactly as before and never reads .z/.w, so
 * existing configurations are bit-identical.
 */

export const DEPOSIT_BLEED_MODEL_ID = 3;

/** Bleed spread: fraction of the (blur − L) gap closed per step. */
export const BLEED_SPREAD = 0.5;
/** Bleed source: wet pigment fed into the bleed channel, × Feed.
 *  Set well above the deposition transfer rate so the halo reads at
 *  the same Feed settings (the spread + decay terms balance it). */
export const BLEED_SOURCE_RATE = 8.0;
/** Bleed decay: fraction of Kill applied to the bleed channel. */
export const BLEED_DECAY_RATE = 0.5;
/** Display weights: pattern = clamp(D × W_D + L × W_L). */
export const DEPOSIT_DISPLAY_WEIGHT = 0.95;
export const BLEED_DISPLAY_WEIGHT = 0.55;

export type DepositBleedParams = {
  /** Existing Feed key: supply replenishment + deposition transfer. */
  feed: number;
  /** Existing Kill key: wet-pigment and bleed decay. */
  kill: number;
  /** Profile diffusion coefficients (same uniforms as Gray-Scott). */
  dA: number;
  dB: number;
  dt: number;
  /** Audio pulse feed bonus (same term as Gray-Scott). */
  pulse: number;
  /** New per-layer key: deposit retention per step, 0..1 (1 = none lost). */
  retention: number;
};

export type DepositBleedCell = { a: number; b: number; d: number; l: number };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Wide convex blur weights for the bleed channel, in tap order:
 * center, radius-1 axial (N/S/E/W), radius-1 diagonal, radius-2
 * axial. Sums to exactly 1, so the blur is a convex average.
 */
export const BLEED_BLUR_WEIGHTS: readonly number[] = [
  0.2,
  0.1, 0.1, 0.1, 0.1,
  0.05, 0.05, 0.05, 0.05,
  0.05, 0.05, 0.05, 0.05,
];

/** Offsets (in texels) matching BLEED_BLUR_WEIGHTS. */
export const BLEED_BLUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [0, 2], [0, -2], [2, 0], [-2, 0],
];

/**
 * One deposit–bleed step for a single texel. `lapA` / `lapB` are the
 * standard 9-tap Laplacians of the A / B channels (0.2 axial +
 * 0.05 diagonal − center, as in the Gray-Scott branch), `blurL` is
 * the convex blur of the bleed channel. Mirrors the GLSL branch.
 */
export function depositBleedStep(
  cell: DepositBleedCell,
  lapA: number,
  lapB: number,
  blurL: number,
  params: DepositBleedParams,
): DepositBleedCell {
  const { feed, kill, dA, dB, dt, pulse, retention } = params;
  const audioFeed = pulse * 0.006;
  const a = clamp01(cell.a + (dA * lapA + (feed + audioFeed) * (1 - cell.a)) * dt);
  // Deposition transfer: wet pigment → deposit at the Feed rate.
  const transfer = cell.b * feed * dt;
  const d = clamp01(cell.d * retention + transfer * (1 - cell.d));
  const b = clamp01(cell.b + (dB * lapB - (kill + feed + audioFeed * 0.35) * cell.b) * dt);
  const l = clamp01(
    cell.l
    + (blurL - cell.l) * BLEED_SPREAD
    + cell.b * feed * BLEED_SOURCE_RATE * dt
    - kill * BLEED_DECAY_RATE * cell.l * dt,
  );
  return { a, b, d, l };
}

/** Display pattern for the deposit–bleed model (mirrors the GLSL). */
export function depositBleedPattern(d: number, l: number): number {
  return clamp01(d * DEPOSIT_DISPLAY_WEIGHT + l * BLEED_DISPLAY_WEIGHT);
}

/** Resolve the per-layer retention key (default 1 = deposit never decays). */
export function resolveDepositRetention(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Field stepper over a flat RGBA field (row-major, wrap-around
 * indexing like the texture's RepeatWrapping). Used by the unit
 * test to verify the model's field-level properties; the GPU path
 * runs the same math per texel in the shader.
 */
export function stepDepositBleedField(
  field: Float32Array,
  size: number,
  params: DepositBleedParams,
): Float32Array {
  const next = new Float32Array(field.length);
  const at = (x: number, y: number, c: number): number =>
    field[(((y + size) % size) * size + ((x + size) % size)) * 4 + c];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const lap = (c: number): number => {
        const center = at(x, y, c);
        return (
          (at(x, y + 1, c) + at(x, y - 1, c) + at(x + 1, y, c) + at(x - 1, y, c)) * 0.2
          + (at(x + 1, y + 1, c) + at(x - 1, y + 1, c) + at(x + 1, y - 1, c) + at(x - 1, y - 1, c)) * 0.05
          - center
        );
      };
      let blurL = 0;
      for (let t = 0; t < BLEED_BLUR_OFFSETS.length; t += 1) {
        const [ox, oy] = BLEED_BLUR_OFFSETS[t];
        blurL += BLEED_BLUR_WEIGHTS[t] * at(x + ox, y + oy, 3);
      }
      const out = depositBleedStep(
        { a: field[i], b: field[i + 1], d: field[i + 2], l: field[i + 3] },
        lap(0),
        lap(1),
        blurL,
        params,
      );
      next[i] = out.a;
      next[i + 1] = out.b;
      next[i + 2] = out.d;
      next[i + 3] = out.l;
    }
  }
  return next;
}
