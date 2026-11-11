// ── Shared sim quad vertex ──
export const SIM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

// ── Blit fragment (texture copy) ──
export const BLIT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(uTex, vUv); }
`;
