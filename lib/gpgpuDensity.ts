/**
 * Per-particle density supply for attribute expressions
 * (Phase 22 stage 1 — the "density expression reference" that
 * Phase 18 deliberately left out: "Density is deliberately NOT
 * among them (a second step: its supply texture belongs to
 * another subsystem)").
 *
 * The attribute expression language gains ONE reserved name:
 *
 *   den — local particle density, normalised to [0, 1]:
 *         clamp(sampledDensity / restDensity, 0, 1), where
 *         sampledDensity accumulates the SPH kernel weight
 *         w = max(0, 1 - q^2), q = dist / radius, over a fixed
 *         uniform subsample of the whole position texture.
 *
 * Definition (single source of truth — the CPU function below
 * and the GLSL fragment builder are twins and MUST agree):
 *   - The sample set is DENSITY_SAMPLES points strided evenly
 *     over the whole texture: si = k * (count / DENSITY_SAMPLES)
 *     for k in 0 .. DENSITY_SAMPLES-1, quantised to texel
 *     j = floor(si). (The Phase 19 whole-texture scan plan is
 *     the precedent; the SPH pass's own first-row-span sampling
 *     is a different, older plan and den does NOT claim to be
 *     bit-equal to the SPH pass's transient internal density,
 *     which is never stored anywhere.)
 *   - A sample whose uv is within 1.5 texels of the particle's
 *     own uv is skipped (the SPH self-skip rule).
 *   - A sample contributes only when 0.001 < dist^2 < radius^2.
 *   - radius / restDensity come from the existing config keys
 *     gpgpuSphRadius / gpgpuSphRestDensity (the scale the user
 *     already tunes for SPH); den is defined whether or not SPH
 *     itself is enabled. No new config keys.
 *
 * Supply discipline (the Phase 18 conditional-emission rule):
 *   - At bake time the CPU twin evaluates den from the seeded
 *     initial positions — the frame-0 value of the GPU
 *     definition, exactly like vel / age / rad.
 *   - In the dynamic / chain / feedback passes, den is sampled
 *     from a dedicated supply texture that a small pass
 *     (components/gpgpuAttrDensityPass.ts) renders from the
 *     same position snapshot the sim variables read. The pass
 *     exists only while some compiled expression reads den,
 *     and fragments that never read den are byte-identical to
 *     the pre-Phase-22 output (no uniform, no sampling lines).
 */

export const DENSITY_VAR_NAME = 'den';
export const DENSITY_SAMPLES = 256;

/** clamp01 with the bake's semantics (NaN passes through). */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * The CPU twin: normalised density of particle `index` in a
 * texSize x texSize cloud whose positions live in `posData`
 * (xyz + w per texel, w ignored). Mirrors the GLSL below
 * operation for operation.
 */
export function densityNormalised(
  posData: ArrayLike<number>,
  texSize: number,
  index: number,
  radius: number,
  restDensity: number,
): number {
  const count = texSize * texSize;
  if (count <= 0 || index < 0 || index >= count) return 0;
  const px = posData[index * 4] ?? 0;
  const py = posData[index * 4 + 1] ?? 0;
  const pz = posData[index * 4 + 2] ?? 0;
  const uvx = ((index % texSize) + 0.5) / texSize;
  const uvy = (Math.floor(index / texSize) + 0.5) / texSize;
  const h = Math.max(radius, 0.001);
  const h2 = h * h;
  const stride = count / DENSITY_SAMPLES;
  let density = 0;
  for (let k = 0; k < DENSITY_SAMPLES; k++) {
    const j = Math.floor(k * stride);
    if (j >= count) break;
    const sx = ((j % texSize) + 0.5) / texSize;
    const sy = (Math.floor(j / texSize) + 0.5) / texSize;
    const du = sx - uvx;
    const dv = sy - uvy;
    if (Math.sqrt(du * du + dv * dv) < 1.5 / texSize) continue;
    const ox = posData[j * 4] ?? 0;
    const oy = posData[j * 4 + 1] ?? 0;
    const oz = posData[j * 4 + 2] ?? 0;
    const rx = px - ox;
    const ry = py - oy;
    const rz = pz - oz;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < h2 && r2 > 0.001) {
      const q = Math.sqrt(r2) / h;
      density += Math.max(0, 1 - q * q);
    }
  }
  return clamp01(density / Math.max(restDensity, 0.0001));
}

/**
 * The GLSL twin: a fullscreen fragment that writes den into
 * the R channel of the supply texture, one texel per particle.
 * Uniforms: uPosTex, uTexSizeF, uStride (= count / SAMPLES),
 * uRadius, uRestDensity.
 */
export function buildDensityFragment(): string {
  return [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uPosTex;',
    'uniform float uTexSizeF;',
    'uniform float uStride;',
    'uniform float uRadius;',
    'uniform float uRestDensity;',
    'void main() {',
    '  vec3 pos = texture2D(uPosTex, vUv).xyz;',
    '  float h = max(uRadius, 0.001);',
    '  float h2 = h * h;',
    '  float density = 0.0;',
    `  for (int k = 0; k < ${DENSITY_SAMPLES}; k++) {`,
    '    float sj = floor(float(k) * uStride);',
    '    vec2 sUv = (vec2(mod(sj, uTexSizeF), floor(sj / uTexSizeF)) + 0.5) / uTexSizeF;',
    '    if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;',
    '    vec3 oPos = texture2D(uPosTex, sUv).xyz;',
    '    vec3 r = pos - oPos;',
    '    float r2 = dot(r, r);',
    '    if (r2 < h2 && r2 > 0.001) {',
    '      float q = sqrt(r2) / h;',
    '      density += max(0.0, 1.0 - q * q);',
    '    }',
    '  }',
    '  float den = clamp(density / max(uRestDensity, 0.0001), 0.0, 1.0);',
    '  gl_FragColor = vec4(den, 0.0, 0.0, 1.0);',
    '}',
    '',
  ].join('\n');
}
