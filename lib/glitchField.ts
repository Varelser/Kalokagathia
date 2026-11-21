// ── Glitch field (Phase AM) ────────────────────────────────────
// The CPU twin of components/glitchPass.ts: horizontal bands
// of the frame displaced sideways by a deterministic hash of
// (band, time quantum) — the block-displacement / scanline
// slice grammar of the 2D audit §3 glitch row (the data-mosh
// part, frame-to-frame motion transfer, is out of scope per
// the plan). The pass quantises its own frame counter, so the
// pattern is reproducible under the deterministic renderer.
// Amount 0 returns every shift as exactly 0 (and the stage is
// absent while disabled), keeping the default render identical.

export function clampGlitchAmount(v: number): number {
  if (!Number.isFinite(v)) return 0.08;
  return Math.max(0, Math.min(0.25, v));
}

export function clampGlitchBands(v: number): number {
  if (!Number.isFinite(v)) return 24;
  return Math.max(2, Math.min(128, Math.round(v)));
}

export function clampGlitchRate(v: number): number {
  if (!Number.isFinite(v)) return 8;
  return Math.max(0.5, Math.min(30, v));
}

function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/** Two stable uniforms for (band, quantum) — the GLSL twin
 *  uses the same constants. */
export function glitchBandHash(band: number, quantum: number): [number, number] {
  const a = dmHash11(band * 12.9898 + quantum * 78.233);
  const b = dmHash11(band * 39.425 + quantum * 11.135 + 7.77);
  return [a, b];
}

/**
 * Horizontal shift (in UV units) of one band at one time
 * quantum. Only bands whose gate hash clears 0.55 shift at
 * all; the rest hold still, which is what makes the effect
 * read as sliced blocks rather than a global wobble.
 */
export function glitchBandShift(band: number, quantum: number, amount: number): number {
  const a = clampGlitchAmount(amount);
  if (a <= 0) return 0;
  const [h, gate] = glitchBandHash(band, quantum);
  if (gate <= 0.55) return 0;
  return (h * 2 - 1) * a;
}

/** Fine scanline jitter: every row shifts a little, always. */
export function glitchRowShift(row: number, quantum: number, amount: number): number {
  const a = clampGlitchAmount(amount);
  if (a <= 0) return 0;
  return (dmHash11(row * 3.717 + quantum * 51.31) * 2 - 1) * a * 0.12;
}
