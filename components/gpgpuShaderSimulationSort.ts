// ── Sort: depth computation (stores uvX, uvY, viewZ per particle) ──
export const SORT_DEPTH_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform mat4 uViewMatrix;
  varying vec2 vUv;
  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    float viewZ = -(uViewMatrix * vec4(pos, 1.0)).z;
    gl_FragColor = vec4(vUv.x, vUv.y, viewZ, 1.0);
  }
`;

// ── Splat columns depth (Layer 1 WP7 Phase C3): the depth
// stage of the depth sort for the independent splat column
// data (lib/gpgpuSplatColumns.ts). The payload grid side
// (ceil(√N)) is a power of two only by luck, and the bitonic
// network below totally orders pow2 grids only, so the
// columns sort runs on its own grid of side uSortTexSizeF
// (the smallest pow2 ≥ the payload side). Slot k of the sort
// grid maps to payload texel k: the entry samples the centre
// texture at the PAYLOAD uv and writes that uv (not the sort
// grid's), so the splat vertex consumes the sort texture in
// exactly the pool form. Slots at or past uSplatCountF write
// the pad depth (SPLAT_COLUMNS_PAD_VIEW_Z in the lib twin),
// sorting to the tail of the far-to-near order — the first
// `count` slots are precisely the real splats. Driven by
// runDepthSortPass like the stock depth material (it writes
// uPosTex / uViewMatrix); the three grid uniforms are baked
// at material creation.
export const SPLAT_COLUMNS_SORT_DEPTH_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform mat4 uViewMatrix;
  uniform float uSortTexSizeF;
  uniform float uPayloadTexSizeF;
  uniform float uSplatCountF;
  varying vec2 vUv;
  void main() {
    float k = floor(vUv.y * uSortTexSizeF) * uSortTexSizeF + floor(vUv.x * uSortTexSizeF);
    if (k >= uSplatCountF) {
      gl_FragColor = vec4(0.0, 0.0, -1.0e18, 1.0);
      return;
    }
    vec2 payloadUv = (vec2(mod(k, uPayloadTexSizeF), floor(k / uPayloadTexSizeF)) + 0.5) / uPayloadTexSizeF;
    vec3 pos = texture2D(uPosTex, payloadUv).xyz;
    float viewZ = -(uViewMatrix * vec4(pos, 1.0)).z;
    gl_FragColor = vec4(payloadUv.x, payloadUv.y, viewZ, 1.0);
  }
`;

// ── Grains cell key (Phase 19 fix2): per-texel spatial cell key ──
// Writes the SORT_DEPTH payload layout (uv.x, uv.y, key, 1) so
// the bitonic pass above sorts the pool by cell key unchanged.
// The grid is resolved CPU-side (lib/gpgpuGrains.ts
// grainsCellGrid): origin = -(bounceRadius x 1.05 + gd), cell
// size >= gd, every dim <= 256 so the key stays below 2^24 and
// is exact in float32. Cell coords clamp into the grid — a
// monotone contraction, so clamping can only add candidates,
// never lose a true neighbour (the consumers' distance test is
// the exact brute-force one).
export const GRAINS_CELL_KEY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform float uGrainsCellOrigin;
  uniform float uGrainsCellSize;
  uniform vec3  uGrainsCellDims;
  varying vec2 vUv;
  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    vec3 cell = clamp(floor((pos - uGrainsCellOrigin) / uGrainsCellSize), vec3(0.0), uGrainsCellDims - vec3(1.0));
    float key = (cell.x * uGrainsCellDims.y + cell.y) * uGrainsCellDims.z + cell.z;
    gl_FragColor = vec4(vUv.x, vUv.y, key, 1.0);
  }
`;

// ── Sort: bitonic sort pass (one compare-swap step) ──
export const SORT_BITONIC_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSortIn;
  uniform float uTexSizeF;
  uniform float uStep;
  uniform float uStage;
  varying vec2 vUv;
  void main() {
    float fw   = uTexSizeF;
    float ix   = floor(vUv.x * fw);
    float iy   = floor(vUv.y * fw);
    float i    = iy * fw + ix;
    float stepSize   = pow(2.0, uStep);
    float blockSzDir = pow(2.0, uStage + 1.0);
    // Arithmetic XOR: partner index = i XOR stepSize
    float bitInStep = mod(floor(i / stepSize), 2.0);
    float l = i + (bitInStep < 0.5 ? stepSize : -stepSize);
    if (l < 0.0 || l >= fw * fw) { gl_FragColor = texture2D(uSortIn, vUv); return; }
    float lx = mod(l, fw);
    float ly = floor(l / fw);
    vec2 partnerUv = (vec2(lx, ly) + 0.5) / fw;
    vec4 myData      = texture2D(uSortIn, vUv);
    vec4 partnerData = texture2D(uSortIn, partnerUv);
    float myDepth      = myData.z;
    float partnerDepth = partnerData.z;
    // origAsc=true for even blocks. Invert comparison for descending final order (far=0).
    bool origAsc = mod(floor(i / blockSzDir), 2.0) < 0.5;
    bool shouldSwap;
    if (i < l) {
      shouldSwap = origAsc ? (myDepth < partnerDepth) : (myDepth > partnerDepth);
    } else {
      shouldSwap = origAsc ? (myDepth > partnerDepth) : (myDepth < partnerDepth);
    }
    gl_FragColor = shouldSwap ? partnerData : myData;
  }
`;
