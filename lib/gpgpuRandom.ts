// Shared random channel (Grammar 2.0 stage 2, slice B5).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §1 judgment 3 /
// §3 B5 — the random laws that had converged in practice but
// lived as per-file copies become ONE module, WITHOUT changing
// any value:
//
//   - `dmHash11` is the Phase DM hash. Every TS copy in lib/
//     (13 files) was verified byte-identical before this slice
//     (the extraction is pinned by
//     scripts/stage2-distribution-b5.test.mjs, which compares
//     the shared function against the legacy bodies over a
//     grid). The copies now import from here.
//   - `mulberry32` is the seeded stream. Two textual variants
//     circulated (lib/seededRng.ts + lib/gpgpuParticleLife.ts
//     on one side, lib/lSystem.ts + lib/cpuParticleSim.ts +
//     lib/presetBreeding.ts on the other); they differ only in
//     |0 vs >>>0 bookkeeping and operand order of commutative
//     ops, so their output streams are bit-identical — the
//     test pins that against both legacy bodies over 10k
//     draws for several seeds. All of them now delegate here.
//
// The GLSL copies inside component shader strings were
// extracted onto the canonical text below in slice B8,
// under B8's discipline (extract only where the assembled
// string stays identical — every assembled fragment's sha256
// is pinned before/after by the B8 test). The TS copies in
// the components/ scene systems were likewise verified
// token-identical to the body here and now import it.
//
// Seed discipline (judgment 3): the config seed
// (gpgpuSeed) still reaches only the CPU bakes. A seed
// reaches a shader ONLY through the explicit opt-in key
// gpgpuShaderSeed (lib/gpgpuDistribution.ts consumes the
// phase for the respawn draws); at its default 0 nothing in
// any shader changes.

/** Phase DM hash: deterministic [0, 1) from one number.
 * Body verbatim from the pre-B5 copies (lib/gpgpuLifecycle.ts
 * et al.) — do not "improve" it; presets are tuned to its
 * exact output. */
export function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/** mulberry32: small, fast, seedable PRNG with a uniform
 * [0, 1) output. Body verbatim from lib/seededRng.ts's
 * createSeededRng (the pre-B5 canonical copy). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Named-channel hash for NEW code: a channel number salts
 * the input so independent consumers stop negotiating magic
 * offsets ad hoc (the historical `+(19.19, 7.77)` style).
 * Existing call sites keep their historical offsets — this
 * supply is additive only.
 */
export function channelHash(channel: number, n: number): number {
  return dmHash11(n + channel * 1013.77);
}

/** Canonical GLSL twin of dmHash11. For new shader code;
 * the pre-existing shader-string copies were extracted onto
 * this text (and the indented form below) in slice B8, where
 * the assembled strings provably stayed byte-identical. */
export const DM_HASH11_GLSL = /* glsl */ `float dmHash11(float n) {
  vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** The two-space-indented form of the canonical GLSL: the
 * shape the velocity helpers, the position head and the
 * points noise map carried as local copies before B8.
 * Derived from DM_HASH11_GLSL by indenting every non-empty
 * line, so the two forms can never drift apart; the B8 test
 * pins the derivation against the legacy literal text. */
export const DM_HASH11_GLSL_INDENTED = DM_HASH11_GLSL
  .split('\n')
  .map((line) => (line.length > 0 ? `  ${line}` : line))
  .join('\n');

/** Config slice the seed opt-in reads. */
export interface ShaderSeedConfig {
  gpgpuShaderSeed?: number;
}

/** True while the opt-in shader seed key carries a usable
 * non-zero value. At 0 (the default) every shader string and
 * every draw is the legacy one. */
export function shaderSeedActive(config: ShaderSeedConfig): boolean {
  const s = config.gpgpuShaderSeed ?? 0;
  return Number.isFinite(s) && s !== 0;
}

/** The additive hash phase the respawn draws receive while
 * the opt-in is on. A fixed irrational-ish multiplier keeps
 * small integer seeds well spread over the hash's period;
 * the value itself is part of the B5 contract (pinned by
 * the test). */
export function resolveShaderSeedPhase(config: ShaderSeedConfig): number {
  if (!shaderSeedActive(config)) return 0;
  return (config.gpgpuShaderSeed as number) * 17.1717;
}
