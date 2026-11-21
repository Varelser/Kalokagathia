/**
 * Density compensation (Phase DN, DA6): keep the apparent coverage
 * of the GPGPU draw constant when the particle count, the point
 * size or the viewport changes (Reusser-style compensation).
 *
 *   alpha_comp = clamp(rho * (W * H) / (N * s^2), 0, 1)
 *
 * rho is the target density (fraction of the viewport area the
 * particles should cover in total), W x H the drawing-buffer size
 * in physical pixels, N the effective drawn count (activeCount,
 * after LOD) and s the per-particle pixel diameter. The clamp caps
 * at 1.0: compensation only ever lowers alpha (user decision,
 * 2026-11-22). While disabled the draw uses exactly 1.0, so the
 * legacy rendering is bit-identical.
 *
 * GLSL twins: DRAW_VERT in components/gpgpuShaderPoints.ts (s is
 * the final gl_PointSize) and GEOM_VERT in
 * components/gpgpuShaderVolumes.ts (s from estimateSolidSizePx).
 */
export function densityCompMultiplier(
  target: number,
  viewportW: number,
  viewportH: number,
  count: number,
  sizePx: number,
): number {
  const n = Math.max(count, 1);
  const s = Math.max(sizePx, 0.001);
  const raw = (target * (viewportW * viewportH)) / (n * s * s);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Approximate on-screen diameter (px) of one instanced solid.
 * The base geometries are normalised to roughly unit size, so the
 * characteristic world diameter is uGeomScale itself; the pixel
 * size follows from the perspective projection: pixels per world
 * unit = viewportH * 0.5 * projM11 / dist, where projM11 is
 * projectionMatrix[1][1] = 1 / tan(fov / 2) and dist is the
 * view-space depth of the instance centre.
 */
export function estimateSolidSizePx(
  geomScale: number,
  dist: number,
  viewportH: number,
  projM11: number,
): number {
  const d = Math.max(dist, 0.001);
  return geomScale * ((viewportH * 0.5 * projM11) / d);
}
