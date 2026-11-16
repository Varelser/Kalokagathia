// Replica independent simulation (Phase W2): merge blit.
//
// After each replica stack steps inside its own textures, its
// block is relocated into the shared layout textures (the main
// pool's ping-pong pair) that every downstream consumer reads.
// The mapping is the exact inverse of the stack's local layout:
// global texel i belongs to block r iff start <= i < start + size,
// and its stack-local index is i - start (row-major in the stack's
// square texture). Fragments outside the block discard, so one
// pass per stack writes exactly its own texels — a pure
// relocation, never a blend (the material is created with
// NoBlending).
export const REPLICA_MERGE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uStackTex;
  uniform float uGlobalTexSizeF;
  uniform float uStackTexSizeF;
  uniform float uBlockStart;
  uniform float uBlockSize;
  varying vec2 vUv;

  void main() {
    float globalIdx = floor(vUv.y * uGlobalTexSizeF) * uGlobalTexSizeF + floor(vUv.x * uGlobalTexSizeF);
    float localIdx = globalIdx - uBlockStart;
    if (localIdx < 0.0 || localIdx >= uBlockSize) discard;
    vec2 stackUv = (vec2(mod(localIdx, uStackTexSizeF), floor(localIdx / uStackTexSizeF)) + 0.5) / uStackTexSizeF;
    gl_FragColor = texture2D(uStackTex, stackUv);
  }
`;
