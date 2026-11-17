// ── Smooth Tube cross-section profiles (Phase AF2) ─────────────
// The ring shape swept along the Smooth Tube. The legacy ring was
// a fixed 6-vertex circle computed inline in
// components/sceneGpgpuSmoothTube.tsx (angle = (j / 6) * 2π,
// vertex = centre + (cos·N + sin·B) · radius). This module is the
// pure source of the ring directions so the shape is a config
// choice instead of a constant:
//
//   'circle'  — regular ring with `sides` vertices. With the
//               default sides = 6 the directions are bit-identical
//               to the legacy inline computation (same angle
//               expression, same cos/sin calls, scale 1).
//   'polygon' — same regular ring (the visible difference from
//               'circle' is only the vertex count the user picks;
//               kept as a separate shape name so the UI reads as
//               the Sweep/Loft vocabulary).
//   'star'    — 2 × sides vertices alternating outer (scale 1) and
//               inner (scale = innerRatio) points.
//
// The length profile of the tube stays with the existing taper
// (lib/smoothTubeProfile.ts) — this module owns only the section.

export type TubeSectionShape = 'circle' | 'polygon' | 'star';

export interface TubeSectionVertex {
  /** Unit direction components (cos / sin of the ring angle). */
  nx: number;
  ny: number;
  /** Radial multiplier: 1 everywhere except star inner points. */
  scale: number;
}

export const TUBE_SECTION_MIN_SIDES = 3;
export const TUBE_SECTION_MAX_SIDES = 12;

export function clampTubeSectionSides(sides: number): number {
  if (!Number.isFinite(sides)) return 6;
  return Math.max(
    TUBE_SECTION_MIN_SIDES,
    Math.min(TUBE_SECTION_MAX_SIDES, Math.round(sides)),
  );
}

export function tubeSectionPointCount(
  shape: TubeSectionShape,
  sides: number,
): number {
  const s = clampTubeSectionSides(sides);
  return shape === 'star' ? s * 2 : s;
}

/**
 * The ring's vertex directions in legacy order: vertex j sits at
 * angle (j / count) * 2π, starting at angle 0 (the +N axis of the
 * ring frame). For 'circle' with sides 6 this returns exactly the
 * six (cos, sin, 1) triples the legacy inline loop produced.
 */
export function buildTubeSection(
  shape: TubeSectionShape,
  sides: number,
  innerRatio: number,
): TubeSectionVertex[] {
  const count = tubeSectionPointCount(shape, sides);
  const ratio = Number.isFinite(innerRatio)
    ? Math.max(0.05, Math.min(0.98, innerRatio))
    : 0.6;
  const out: TubeSectionVertex[] = [];
  for (let j = 0; j < count; j++) {
    // The legacy angle expression, kept verbatim: (2π · j) / count.
    const ang = ((Math.PI * 2) * j) / count;
    const scale = shape === 'star' && j % 2 === 1 ? ratio : 1;
    out.push({ nx: Math.cos(ang), ny: Math.sin(ang), scale });
  }
  return out;
}
