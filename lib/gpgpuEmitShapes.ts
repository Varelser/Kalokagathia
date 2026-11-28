// Emitter shape law (Grammar 2.0 stage 2, slice E0+E1).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E1 — the shape
// sampling law becomes ONE source shared by the bake and the
// runtime respawn, instead of two implementations that had
// already drifted apart (the bake knew 7 shapes; the respawn
// placed only the origin ball and the light ball).
//
// This module is that single source:
//   - `sampleEmitShape` is the JS twin. It consumes uniform
//     draws from `next` in the bake's legacy order — theta
//     first, then the shape's own draws, exactly the counts
//     the pre-refactor bake consumed per shape — so routing
//     lib/gpgpuInitialData.ts through it leaves the seeded
//     arrays bit-identical.
//   - `EMIT_SHAPE_GLSL` is the GLSL twin, generated here as a
//     constant string: `kaloEmitShapePos(shape, d, radius,
//     lightPos)` mirrors the JS formulas term for term, fed by
//     a vec4 of hash draws in the same canonical order
//     (d.x = theta draw, then the shape draws in d.y/d.z/d.w).
//     The position pass splices it in only for the respawn-
//     shape variant (components/gpgpuShaderSimulationPosition
//     .ts); the default shader string never contains it.
//
// The pair is pinned by scripts/stage2-emitter-e01.test.mjs
// (bake output hashes, per-shape draw counts, geometric
// invariants of the JS twin, and the GLSL string's sha256).

export type GpgpuEmitShape = 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone' | 'light';

/** Shape ids as consumed by the shader's uRespawnShape. */
export const EMIT_SHAPE_IDS: Record<GpgpuEmitShape, number> = {
  sphere: 0,
  disc: 1,
  ring: 2,
  box: 3,
  shell: 4,
  cone: 5,
  light: 6,
};

export interface EmitLightPos {
  x: number;
  y: number;
  z: number;
}

const ORIGIN: EmitLightPos = { x: 0, y: 0, z: 0 };

/**
 * Sample one emitter-local position for `shape`.
 *
 * `next` supplies uniform [0, 1) draws. The draw order and
 * count per shape are the bake's legacy ones (theta first —
 * the box branch draws it and ignores it, exactly as the
 * legacy bake did), and every arithmetic expression mirrors
 * the legacy branch verbatim, so a seeded caller reproduces
 * the legacy point for the same draw sequence.
 *
 * `radius` is the emitter radius (the bake's bounce radius);
 * `lightPos` is read only by the 'light' shape.
 */
export function sampleEmitShape(
  shape: GpgpuEmitShape,
  next: () => number,
  radius: number,
  lightPos?: EmitLightPos | null,
): [number, number, number] {
  const theta = next() * Math.PI * 2;
  if (shape === 'disc') {
    const rad = radius * Math.sqrt(next());
    return [rad * Math.cos(theta), 0, rad * Math.sin(theta)];
  }
  if (shape === 'ring') {
    const rad = radius * (0.85 + next() * 0.15);
    return [rad * Math.cos(theta), (next() - 0.5) * radius * 0.08, rad * Math.sin(theta)];
  }
  if (shape === 'box') {
    return [
      (next() - 0.5) * 2 * radius,
      (next() - 0.5) * 2 * radius,
      (next() - 0.5) * 2 * radius,
    ];
  }
  if (shape === 'shell') {
    const phi = Math.acos(2 * next() - 1);
    return [
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
    ];
  }
  if (shape === 'cone') {
    const h = next() * radius;
    const cr = (h / radius) * radius;
    return [cr * Math.cos(theta), h - radius * 0.5, cr * Math.sin(theta)];
  }
  if (shape === 'light') {
    // Light emitter (Phase T): a small ball around the light
    // position — the same two draws (phi, radius fraction) as
    // the sphere branch, scaled to 5% of the radius.
    const lp = lightPos ?? ORIGIN;
    const phi = Math.acos(2 * next() - 1);
    const jr = radius * 0.05 * (0.1 + next() * 0.9);
    return [
      lp.x + jr * Math.sin(phi) * Math.cos(theta),
      lp.y + jr * Math.sin(phi) * Math.sin(theta),
      lp.z + jr * Math.cos(phi),
    ];
  }
  // sphere
  const phi = Math.acos(2 * next() - 1);
  const rad = radius * (0.1 + next() * 0.9);
  return [
    rad * Math.sin(phi) * Math.cos(theta),
    rad * Math.sin(phi) * Math.sin(theta),
    rad * Math.cos(phi),
  ];
}

/**
 * GLSL twin of sampleEmitShape. `d` carries the draws in the
 * canonical order: d.x = theta draw, then the shape's draws
 * in the same order the JS twin pulls them from `next`
 * (box reads d.y/d.z/d.w for x/y/z; every other shape starts
 * at d.y). The constants and expression shapes mirror the JS
 * term for term.
 */
export const EMIT_SHAPE_GLSL = /* glsl */ `
vec3 kaloEmitShapePos(int shape, vec4 d, float radius, vec3 lightPos) {
  float th = d.x * 6.2831853;
  if (shape == 1) {
    // disc
    float rad = radius * sqrt(d.y);
    return vec3(rad * cos(th), 0.0, rad * sin(th));
  }
  if (shape == 2) {
    // ring
    float rad = radius * (0.85 + d.y * 0.15);
    return vec3(rad * cos(th), (d.z - 0.5) * radius * 0.08, rad * sin(th));
  }
  if (shape == 3) {
    // box (the theta draw d.x is consumed and ignored, as in the bake)
    return vec3((d.y - 0.5) * 2.0 * radius, (d.z - 0.5) * 2.0 * radius, (d.w - 0.5) * 2.0 * radius);
  }
  if (shape == 4) {
    // shell
    float phi = acos(2.0 * d.y - 1.0);
    return vec3(radius * sin(phi) * cos(th), radius * sin(phi) * sin(th), radius * cos(phi));
  }
  if (shape == 5) {
    // cone
    float h = d.y * radius;
    float cr = (h / radius) * radius;
    return vec3(cr * cos(th), h - radius * 0.5, cr * sin(th));
  }
  if (shape == 6) {
    // light: a small ball around the light position (5% radius)
    float phi = acos(2.0 * d.y - 1.0);
    float jr = radius * 0.05 * (0.1 + d.z * 0.9);
    return lightPos + vec3(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));
  }
  // sphere (0)
  float phi = acos(2.0 * d.y - 1.0);
  float rad = radius * (0.1 + d.z * 0.9);
  return vec3(rad * sin(phi) * cos(th), rad * sin(phi) * sin(th), rad * cos(phi));
}
`;
