// Chroma key math (Phase 15 follow-up; Layer 1 confirmation
// gate item 12): the Core / Edge matte separation behind
// components/chromaKeyPass.ts.
//
// The shipped Phase 15 keyer computed the matte and the spill
// suppression in a single stage: one smoothstep on the colour
// distance to the key colour. On the gate flight that keyed
// the particles' fringe (the ring where the sprite colour is
// mixed with the key background) away with the background —
// the particle region's alpha >= 247 share stalled at 0.8407
// against the >= 0.95 line. The standard practice (see the
// Layer 1 material, gemini-nonscience-batch1 question 4) is
// to separate the systems:
//
//   - Edge matte: the legacy loose clip, kept verbatim
//     (smoothstep over similarity .. similarity + smoothness).
//     It preserves the fringe gradation of genuinely
//     translucent pixels and is the floor of the final matte:
//     the new alpha never drops below the legacy alpha.
//   - Core matte: a strong clip whose thresholds are derived
//     from the same authored parameters — it starts at half
//     the edge threshold (similarity * 0.5) and is fully solid
//     after half the edge transition width (smoothness * 0.5),
//     so any colour distinguishable from the key colour at
//     half the authored distance is already solid foreground.
//     The keyed-out region is then eroded by one texel — the
//     max over the 3x3 neighbourhood, i.e. the core dilated
//     by one texel — which seals the fringe ring that touches
//     solid foreground (the gate record found every fully
//     keyed-out particle pixel adjacent to an opaque one).
//     The erosion is gated on the pixel's own matte, though:
//     it applies only where the pixel's own core clip or edge
//     matte is nonzero. The first re-measure (gate record
//     §6.2) recovered the particle side to 1.0000 but dropped
//     the background side to 0.9343, because the unconditional
//     dilation wrote neighbour core values into background
//     pixels no sprite had touched — arithmetically, 97.2%
//     of the alpha >= 247 background failures could only have
//     arrived through the neighbourhood max (a background
//     pixel's own distance caps its own core at ~0.81). A
//     pixel whose own matte is zero now keeps alpha = edge
//     = 0; the seal still covers every fringe pixel, since a
//     fringe pixel by construction has a nonzero own matte.
//     (Layer 1 follow-up investigation, LAYER1_ITEM12_
//     FOLLOWUP_INVESTIGATION.md, candidate V3.)
//   - Final alpha = max(core, edge).
//   - Despill is a separate stage after the matte, driven by
//     key-likeness (1 - edge) exactly as the legacy stage was
//     driven by (1 - alpha), and it now carries the luminance
//     compensation the material calls mandatory: the luminance
//     removed with the key-direction excess is returned to the
//     channels orthogonal to the key direction, so a despilled
//     fringe pixel keeps its luminance instead of going black.
//
// This module holds the fragment shader source and its CPU
// twin side by side; the twin (applyChromaKeyImage and the
// per-pixel helpers) reproduces the shader's arithmetic
// operation for operation so the gate criteria can be pinned
// on synthetic scenes without a GPU. The real-GPU re-measure
// is the gate side's separated follow-up.

export interface ChromaKeyParams {
  /** Key colour as linear-ish RGB triple in [0, 1] (the pass
   *  reads the finished frame, same space as the legacy keyer). */
  keyColor: readonly [number, number, number];
  similarity: number;
  smoothness: number;
  spill: number;
}

export const CHROMA_KEY_DEFAULTS: ChromaKeyParams = {
  keyColor: [0, 1, 0],
  similarity: 0.08,
  smoothness: 0.04,
  spill: 0.5,
};

/** Core clip derivation: the core starts at this fraction of
 *  the authored similarity and completes over this fraction
 *  of the authored smoothness. */
export const CHROMA_KEY_CORE_LO_FRACTION = 0.5;
export const CHROMA_KEY_CORE_HI_FRACTION = 0.5;

/** Rec.709 luma weights, used only for the despill luminance
 *  compensation accounting (the excess itself is measured
 *  against the pixel's own mean grey, as the legacy stage did). */
export const CHROMA_KEY_LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

const SMOOTHNESS_FLOOR = 0.0001;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** GLSL smoothstep semantics. */
export function chromaSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Euclidean colour distance to the key colour (GLSL distance). */
export function chromaKeyDistance(
  color: readonly [number, number, number],
  keyColor: readonly [number, number, number],
): number {
  const dr = color[0] - keyColor[0];
  const dg = color[1] - keyColor[1];
  const db = color[2] - keyColor[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** The Edge matte: the legacy loose clip, verbatim. */
export function chromaEdgeMatte(dist: number, similarity: number, smoothness: number): number {
  return chromaSmoothstep(similarity, similarity + Math.max(smoothness, SMOOTHNESS_FLOOR), dist);
}

/** The pre-fix single-stage alpha. Kept as the contrast
 *  reference: it is exactly the edge matte's formula, which is
 *  what the shipped Phase 15 pass used for its only matte. */
export function legacyChromaKeyAlpha(dist: number, similarity: number, smoothness: number): number {
  return chromaEdgeMatte(dist, similarity, smoothness);
}

/** The Core matte's per-pixel strong clip (before the one-texel
 *  erosion of the keyed-out region is applied over the image). */
export function chromaCoreClip(dist: number, similarity: number, smoothness: number): number {
  const lo = similarity * CHROMA_KEY_CORE_LO_FRACTION;
  return chromaSmoothstep(lo, lo + Math.max(smoothness, SMOOTHNESS_FLOOR) * CHROMA_KEY_CORE_HI_FRACTION, dist);
}

type Vec3 = [number, number, number];

function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The despill stage, twin of the shader's second half.
 * `weight` is the key-likeness weight (the caller passes
 * 1 - edge, as the legacy stage used 1 - alpha). Removes the
 * colour's excess along the key direction above its own grey
 * level, scaled by spill * weight, then returns the removed
 * luminance to the plane orthogonal to the key direction so
 * the pixel's Rec.709 luminance is preserved exactly.
 */
export function despillChromaColor(
  color: readonly [number, number, number],
  keyColor: readonly [number, number, number],
  spill: number,
  weight: number,
): Vec3 {
  const kd = normalize3([keyColor[0] + 0.00001, keyColor[1] + 0.00001, keyColor[2] + 0.00001]);
  const grey = (color[0] + color[1] + color[2]) * 0.3333333;
  const excess = Math.max(dot3(color, kd) - grey * (kd[0] + kd[1] + kd[2]), 0);
  const amount = excess * spill * weight;
  const removed: Vec3 = [kd[0] * amount, kd[1] * amount, kd[2] * amount];
  const out: Vec3 = [color[0] - removed[0], color[1] - removed[1], color[2] - removed[2]];
  const removedLum = dot3(removed, CHROMA_KEY_LUMA);
  const kdSum = kd[0] + kd[1] + kd[2];
  const compDir: Vec3 = [1 - kd[0] * kdSum, 1 - kd[1] * kdSum, 1 - kd[2] * kdSum];
  const compNorm = dot3(compDir, CHROMA_KEY_LUMA);
  if (compNorm > 0.0001) {
    const back = removedLum / compNorm;
    out[0] += compDir[0] * back;
    out[1] += compDir[1] * back;
    out[2] += compDir[2] * back;
  }
  return out;
}

/**
 * Full-image CPU twin of the chroma key pass. `rgb` is a
 * width*height*3 array of frame colours; the result is a
 * width*height*4 array (despilled RGB, final alpha). The core
 * matte's one-texel erosion of the keyed-out region reads the
 * 3x3 neighbourhood with clamped indices, matching the
 * shader's clamp-to-edge texture sampling, and is gated on
 * the pixel's own matte (core clip or edge) being nonzero —
 * pixels no sprite touched keep alpha 0.
 */
export function applyChromaKeyImage(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  params: ChromaKeyParams,
): Float32Array {
  const { keyColor, similarity, smoothness, spill } = params;
  const count = width * height;
  const coreClip = new Float32Array(count);
  const edge = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const color: Vec3 = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    const dist = chromaKeyDistance(color, keyColor);
    coreClip[i] = chromaCoreClip(dist, similarity, smoothness);
    edge[i] = chromaEdgeMatte(dist, similarity, smoothness);
  }
  const out = new Float32Array(count * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let core = coreClip[i];
      // Erosion gate (V3): the neighbourhood max seals only
      // pixels whose own matte is nonzero. A pixel no sprite
      // touched (own core clip and edge both zero) must not
      // inherit a neighbour's core value.
      if (core > 0 || edge[i] > 0) {
        for (let dy = -1; dy <= 1; dy++) {
          const cy = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const cx = Math.min(width - 1, Math.max(0, x + dx));
            const n = coreClip[cy * width + cx];
            if (n > core) core = n;
          }
        }
      }
      const alpha = Math.max(core, edge[i]);
      const color: Vec3 = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
      const despilled = despillChromaColor(color, keyColor, spill, 1 - edge[i]);
      out[i * 4] = despilled[0];
      out[i * 4 + 1] = despilled[1];
      out[i * 4 + 2] = despilled[2];
      out[i * 4 + 3] = alpha;
    }
  }
  return out;
}

/**
 * The fragment shader run by components/chromaKeyPass.ts.
 * Mirrors the twin above operation for operation: edge matte,
 * core clip + one-texel erosion of the keyed-out region,
 * max(core, edge), then the despill stage with luminance
 * compensation.
 */
export const CHROMA_KEY_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;
uniform vec2 uTexelSize;
varying vec2 vUv;

float chromaEdgeMatte(float dist) {
  return smoothstep(uSimilarity, uSimilarity + max(uSmoothness, 0.0001), dist);
}

float chromaCoreClip(float dist) {
  float lo = uSimilarity * ${CHROMA_KEY_CORE_LO_FRACTION};
  return smoothstep(lo, lo + max(uSmoothness, 0.0001) * ${CHROMA_KEY_CORE_HI_FRACTION}, dist);
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  float dist = distance(color, uKeyColor);
  float edge = chromaEdgeMatte(dist);
  // Core matte: the strong clip, with the keyed-out region
  // eroded by one texel (the max over the 3x3 neighbourhood)
  // so the fringe ring touching solid foreground is sealed.
  // The erosion is gated on this pixel's own matte: a pixel
  // no sprite touched (own core and edge both zero) keeps
  // alpha zero instead of inheriting a neighbour's core
  // value (gate item 12 follow-up — the unconditional form
  // pushed untouched background around point sprites to
  // full opacity).
  float core = chromaCoreClip(dist);
  if (core > 0.0 || edge > 0.0) {
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(float(i), float(j)) * uTexelSize).rgb;
        core = max(core, chromaCoreClip(distance(n, uKeyColor)));
      }
    }
  }
  float alpha = max(core, edge);
  // Despill stage (separate from the matte generation):
  // remove the colour's excess along the key direction above
  // its own grey level, weighted by key-likeness (1 - edge),
  // then return the removed luminance to the channels
  // orthogonal to the key direction so the fringe keeps its
  // luminance instead of going black.
  vec3 kd = normalize(uKeyColor + vec3(0.00001));
  float grey = dot(color, vec3(0.3333333));
  float excess = max(dot(color, kd) - grey * dot(vec3(1.0), kd), 0.0);
  vec3 removed = kd * (excess * uSpill * (1.0 - edge));
  color -= removed;
  float removedLum = dot(removed, vec3(${CHROMA_KEY_LUMA[0]}, ${CHROMA_KEY_LUMA[1]}, ${CHROMA_KEY_LUMA[2]}));
  vec3 compDir = vec3(1.0) - kd * dot(vec3(1.0), kd);
  float compNorm = dot(compDir, vec3(${CHROMA_KEY_LUMA[0]}, ${CHROMA_KEY_LUMA[1]}, ${CHROMA_KEY_LUMA[2]}));
  if (compNorm > 0.0001) {
    color += compDir * (removedLum / compNorm);
  }
  gl_FragColor = vec4(color, alpha);
}
`;
