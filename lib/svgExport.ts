/**
 * SVG export (roadmap Phase 9, SVG slice).
 *
 * Projects the same captured GPGPU position buffer used by the PLY
 * export onto a 2D plane and emits a monochrome SVG: one white
 * circle per particle on black. Two planes are offered — 'xy'
 * (front view, the way the scene is usually seen) and 'xz' (top
 * view, matching the source editor). Particle age maps to opacity
 * (young = faint, old = solid), staying inside the monochrome
 * identity.
 */

export type SvgPlane = 'xy' | 'xz';

export interface SvgExportOptions {
  plane?: SvgPlane;
  /** Square canvas size in px. */
  size?: number;
  /** Circle radius in px. */
  radius?: number;
  /** Fraction of the canvas kept as margin on each side. */
  paddingRatio?: number;
}

export interface SvgExportResult {
  svg: string;
  count: number;
}

export function buildSvgPointCloud(data: Float32Array, options: SvgExportOptions = {}): SvgExportResult {
  const plane: SvgPlane = options.plane ?? 'xy';
  const size = options.size ?? 1024;
  const radius = options.radius ?? 1.6;
  const padding = size * (options.paddingRatio ?? 0.04);
  const usable = size - padding * 2;

  // Pass 1: bounds + age range over finite points.
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let minAge = Number.POSITIVE_INFINITY;
  let maxAge = Number.NEGATIVE_INFINITY;
  let count = 0;
  const axisU = plane === 'xy' ? 0 : 0; // x in both planes
  const axisV = plane === 'xy' ? 1 : 2; // y (front) or z (top)
  for (let i = 0; i + 3 < data.length; i += 4) {
    const x = data[i];
    const y = data[i + 1];
    const z = data[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const u = data[i + axisU];
    const v = data[i + axisV];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    const age = Number.isFinite(data[i + 3]) ? data[i + 3] : 0;
    if (age < minAge) minAge = age;
    if (age > maxAge) maxAge = age;
    count++;
  }

  const header = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<!-- Monosphere GPGPU particles, ${plane === 'xy' ? 'front (XY)' : 'top (XZ)'} projection, ${count} points -->`,
    `<rect width="${size}" height="${size}" fill="#000"/>`,
  ];
  if (count === 0) {
    return { svg: [...header, '</svg>'].join('\n') + '\n', count: 0 };
  }

  const spanU = Math.max(1e-6, maxU - minU);
  const spanV = Math.max(1e-6, maxV - minV);
  const scale = usable / Math.max(spanU, spanV);
  const offsetU = padding + (usable - spanU * scale) / 2;
  const offsetV = padding + (usable - spanV * scale) / 2;
  const ageSpan = Math.max(1e-6, maxAge - minAge);
  const r = radius.toFixed(2);

  // Pass 2: circles. Front view flips V (world +Y is up); the top
  // view keeps world +Z pointing down, matching the source editor.
  const circles: string[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    const x = data[i];
    const y = data[i + 1];
    const z = data[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const u = data[i + axisU];
    const v = data[i + axisV];
    const cx = offsetU + (u - minU) * scale;
    const cy = plane === 'xy' ? size - (offsetV + (v - minV) * scale) : offsetV + (v - minV) * scale;
    const age = Number.isFinite(data[i + 3]) ? data[i + 3] : 0;
    const opacity = 0.35 + 0.65 * ((age - minAge) / ageSpan);
    circles.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="#fff" fill-opacity="${opacity.toFixed(2)}"/>`,
    );
  }

  return { svg: [...header, ...circles, '</svg>'].join('\n') + '\n', count };
}
