// ── Fluid advection (Semi-Lagrangian Navier-Stokes simplified) ──
export const FLUID_ADVECT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uFluidIn;
  uniform float uDelta;
  uniform float uFluidDiffuse;
  uniform float uFluidDecay;
  uniform float uFluidStrength;
  uniform float uTime;
  uniform bool  uFluidExtForce;
  varying vec2 vUv;
  void main() {
    vec2 uv  = vUv;
    vec2 vel = texture2D(uFluidIn, uv).xy;
    float ts = 1.0 / 64.0;
    // Semi-Lagrangian backward trace
    vec2 backPos = uv - vel * uDelta * ts * 80.0;
    vec2 advVel  = texture2D(uFluidIn, backPos).xy;
    // 5-point Laplacian diffusion
    vec2 vL = texture2D(uFluidIn, uv + vec2(-ts, 0.0)).xy;
    vec2 vR = texture2D(uFluidIn, uv + vec2( ts, 0.0)).xy;
    vec2 vB = texture2D(uFluidIn, uv + vec2(0.0,-ts)).xy;
    vec2 vT = texture2D(uFluidIn, uv + vec2(0.0, ts)).xy;
    vec2 lap    = vL + vR + vB + vT - 4.0 * advVel;
    vec2 newVel = advVel + uFluidDiffuse * lap;
    // Exponential decay
    newVel *= 1.0 - uFluidDecay * uDelta * 60.0;
    // External forcing: rotating vortex + periodic perturbation
    if (uFluidExtForce) {
      vec2 c = uv - 0.5;
      float r = length(c) + 0.001;
      vec2 rot = vec2(-c.y, c.x) / (r * r + 0.1);
      newVel += rot * uFluidStrength * uDelta * 2.0;
      float t = uTime * 0.3;
      vec2 perturb = vec2(sin(uv.y * 6.2832 + t), cos(uv.x * 6.2832 - t)) * uFluidStrength * 0.3 * uDelta;
      newVel += perturb;
    }
    gl_FragColor = vec4(newVel, 0.0, 1.0);
  }
`;
