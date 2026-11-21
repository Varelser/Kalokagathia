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

// ── FLIP layer (Phase AT) ──
// The existing 64x64 advection field becomes a FLIP grid:
// particles splat momentum onto the grid (P2G), the composite
// grid velocity is made divergence-free by a Jacobi pressure
// projection, and the velocity pass reads the result back (G2P)
// as a PIC/FLIP blend. The grid is the horizontal (xz) plane
// only — this is a 2D planar FLIP layer, not a 3D solver: no
// free surface, no y-pressure, no grid viscosity, no whitewater.

// P2G splat: one point per particle texel (the geometry's
// position attribute carries the texel uv). The vertex shader
// fetches position / velocity, projects onto the field plane
// with the same mapping the velocity pass samples with, and
// deposits this pass's bilinear share (uCellOffset selects one
// of the 4 kernel cells) into the transfer target with additive
// blending (ONE, ONE): xy = momentum share, z = weight share,
// w = 1 per contributing particle. Four draws cover the kernel.
export const FLIP_SPLAT_VERT = /* glsl */ `
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uBounceRadius;
  uniform float uFluidScale;
  uniform vec2  uCellOffset;
  varying vec4 vData;
  void main() {
    vec3 pos = texture2D(uPosTex, position.xy).xyz;
    vec3 vel = texture2D(uVelTex, position.xy).xyz;
    vec2 fuv = pos.xz / (uBounceRadius * uFluidScale) * 0.5 + 0.5;
    // Continuous grid coordinates: cell centres sit on integers.
    vec2 g = fuv * 64.0 - 0.5;
    vec2 base = floor(g);
    vec2 frac = g - base;
    vec2 cell = base + uCellOffset;
    vec2 axisW = mix(1.0 - frac, frac, uCellOffset);
    float w = axisW.x * axisW.y;
    if (w <= 0.0 || cell.x < 0.0 || cell.y < 0.0 || cell.x > 63.0 || cell.y > 63.0) {
      // Park the point outside the clip volume: no deposit.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 1.0;
      vData = vec4(0.0);
      return;
    }
    vec2 ndc = ((cell + 0.5) / 64.0) * 2.0 - 1.0;
    gl_Position = vec4(ndc, 0.0, 1.0);
    gl_PointSize = 1.0;
    vData = vec4(vel.x * w, vel.z * w, w, 1.0);
  }
`;

export const FLIP_SPLAT_FRAG = /* glsl */ `
  precision highp float;
  varying vec4 vData;
  void main() {
    gl_FragColor = vData;
  }
`;

// Composite: advected field velocity vs the P2G momentum
// average, mixed by coverage (accumulated weight relative to
// the weight a uniformly dense pool would deposit per cell).
// Empty cells keep the advected field verbatim.
export const FLIP_COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAdvTex;
  uniform sampler2D uTransferTex;
  uniform float uAvgWeight;
  varying vec2 vUv;
  void main() {
    vec4 adv = texture2D(uAdvTex, vUv);
    vec4 tr = texture2D(uTransferTex, vUv);
    float w = tr.z;
    vec2 pvel = w > 1e-6 ? tr.xy / w : vec2(0.0);
    float cov = clamp(w / max(uAvgWeight, 1e-4), 0.0, 1.0);
    vec2 vel = mix(adv.xy, pvel, cov);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

// Pressure Jacobi: one iteration of the Poisson solve
// laplacian(p) = div(u), h = 1 cell. The divergence is
// recomputed from the (fixed) composite velocity every
// iteration, so no divergence target is needed. Taps clamp to
// the edge texel centres: zero pressure gradient across the
// domain edge (Neumann, impermeable walls).
//
// The discretisation is MAC-consistent: the divergence uses
// backward differences and the gradient subtraction below
// uses forward differences, so div(grad p) is exactly the
// compact 5-point Laplacian this Jacobi iteration solves.
// (Pairing central differences for both instead would make
// the composition a wide-stencil Laplacian the compact solve
// cannot cancel — the classic collocated checkerboard trap,
// verified numerically in the Phase AT unit tests. The other
// stages — advection, composite, G2P sampling — still treat
// the stored values as cell-centred; the half-cell offset
// between the two views is part of the approximation.)
export const FLIP_JACOBI_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelTex;
  uniform sampler2D uPresIn;
  varying vec2 vUv;
  vec2 tapC(vec2 uv) {
    float ts = 1.0 / 64.0;
    return clamp(uv, vec2(0.5 * ts), vec2(1.0 - 0.5 * ts));
  }
  void main() {
    float ts = 1.0 / 64.0;
    vec2 vC = texture2D(uVelTex, vUv).xy;
    vec2 vL = texture2D(uVelTex, tapC(vUv + vec2(-ts, 0.0))).xy;
    vec2 vB = texture2D(uVelTex, tapC(vUv + vec2(0.0, -ts))).xy;
    float div = (vC.x - vL.x) + (vC.y - vB.y);
    float pL = texture2D(uPresIn, tapC(vUv + vec2(-ts, 0.0))).r;
    float pR = texture2D(uPresIn, tapC(vUv + vec2( ts, 0.0))).r;
    float pB = texture2D(uPresIn, tapC(vUv + vec2(0.0, -ts))).r;
    float pT = texture2D(uPresIn, tapC(vUv + vec2(0.0,  ts))).r;
    float p = (pL + pR + pB + pT - div) * 0.25;
    gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
  }
`;

// Gradient subtraction: u* = u - grad(p) with forward
// differences (the MAC pair of the backward divergence
// above), same clamped taps.
export const FLIP_SUBTRACT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelTex;
  uniform sampler2D uPresTex;
  varying vec2 vUv;
  vec2 tapC(vec2 uv) {
    float ts = 1.0 / 64.0;
    return clamp(uv, vec2(0.5 * ts), vec2(1.0 - 0.5 * ts));
  }
  void main() {
    float ts = 1.0 / 64.0;
    vec2 vel = texture2D(uVelTex, vUv).xy;
    float pC = texture2D(uPresTex, vUv).r;
    float pR = texture2D(uPresTex, tapC(vUv + vec2( ts, 0.0))).r;
    float pT = texture2D(uPresTex, tapC(vUv + vec2(0.0,  ts))).r;
    vel -= vec2(pR - pC, pT - pC);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

// Vorticity confinement (Phase DL, DD5a): pass 1 of 2 — the
// scalar vorticity ω = dv/dx − du/dy of the composite field,
// central differences in per-cell units (the whitewater
// wwVorticity stencil), stored as r = ω, g = |ω| so the force
// pass reads its gradient source from the same target. Taps
// clamp to the edge texel centres like the Jacobi / subtract
// pair (the field's Neumann convention), not the periodic
// wrap of the CPU spike.
export const FLIP_VORTICITY_CURL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelTex;
  varying vec2 vUv;
  vec2 tapC(vec2 uv) {
    float ts = 1.0 / 64.0;
    return clamp(uv, vec2(0.5 * ts), vec2(1.0 - 0.5 * ts));
  }
  void main() {
    float ts = 1.0 / 64.0;
    float vR = texture2D(uVelTex, tapC(vUv + vec2( ts, 0.0))).y;
    float vL = texture2D(uVelTex, tapC(vUv + vec2(-ts, 0.0))).y;
    float uT = texture2D(uVelTex, tapC(vUv + vec2(0.0,  ts))).x;
    float uB = texture2D(uVelTex, tapC(vUv + vec2(0.0, -ts))).x;
    float w = (vR - vL - (uT - uB)) * 0.5;
    gl_FragColor = vec4(w, abs(w), 0.0, 1.0);
  }
`;

// Vorticity confinement (Phase DL, DD5a): pass 2 of 2 — the
// Fedkiw et al. 2001 confinement force F = ε · (N × ω) with
// N = ∇|ω| / |∇|ω||, integrated as vel += F · dt. In 2D,
// N × (0, 0, ω) = (N.y · ω, −N.x · ω). Where |ω| is flat the
// direction is undefined and the force is exactly zero (the
// Pyro grid force pass's guard). The forced field is then
// pressure-projected by the Jacobi / subtract pair, which
// removes the non-solenoidal part the force mixes in.
export const FLIP_VORTICITY_FORCE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelTex;
  uniform sampler2D uCurlTex;
  uniform float uDelta;
  uniform float uEpsilon;
  varying vec2 vUv;
  vec2 tapC(vec2 uv) {
    float ts = 1.0 / 64.0;
    return clamp(uv, vec2(0.5 * ts), vec2(1.0 - 0.5 * ts));
  }
  void main() {
    float ts = 1.0 / 64.0;
    vec2 vel = texture2D(uVelTex, vUv).xy;
    float aR = texture2D(uCurlTex, tapC(vUv + vec2( ts, 0.0))).g;
    float aL = texture2D(uCurlTex, tapC(vUv + vec2(-ts, 0.0))).g;
    float aT = texture2D(uCurlTex, tapC(vUv + vec2(0.0,  ts))).g;
    float aB = texture2D(uCurlTex, tapC(vUv + vec2(0.0, -ts))).g;
    vec2 eta = vec2(aR - aL, aT - aB) * 0.5;
    float etaLen = length(eta);
    if (etaLen > 1e-6) {
      float w = texture2D(uCurlTex, vUv).r;
      vec2 n = eta / etaLen;
      vel += uEpsilon * vec2(n.y * w, -n.x * w) * uDelta;
    }
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

// Clear pass for the transfer / pressure targets (a drawn
// zero, so no renderer clear-colour state is touched).
export const FLIP_CLEAR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;
