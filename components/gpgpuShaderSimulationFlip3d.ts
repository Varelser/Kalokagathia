// FLIP 3D completion (Phase 19 stage 2): the atlas-packed 3D
// FLIP solver. The grid is the Pyro grid's atlas (shared
// PYRO_GRID_* chunks — layouts, sampling, cell conventions are
// NOT re-implemented here), and the pipeline mirrors the 2D
// FLIP layer's shape (P2G splat -> composite -> pressure
// projection -> G2P in the velocity tail), extended with the
// pieces the 2D layer documents as missing: a third dimension
// with y-pressure, a particle-derived free surface (pseudo
// level set phi + occupancy chi), an implicit grid viscosity
// solve and a CSF surface-tension force. The CPU mirror of the
// numerics lives in lib/flip3d.ts; the pass orchestration in
// components/gpgpuFlip3dPasses.ts.
//
// This file is only ever compiled while gpgpuFlipMode is '3d'.
// The 2D shaders (gpgpuShaderSimulationFluid.ts) are untouched.

import { PYRO_GRID_COMMON, PYRO_GRID_SAMPLING, PYRO_GRID_UNIFORMS } from './gpgpuShaderPyroGrid';

// P2G splat (3D): one point per particle texel; the vertex
// shader fetches position / velocity, maps the world position
// into grid cells (domain = cube of half extent
// uBounceRadius * uFluidScale around the origin, the 2D
// field's planar extent extended to y), and deposits this
// pass's trilinear share (uCellOffset selects one of the 8
// kernel cells) into the transfer target with additive
// blending: xyz = momentum share, w = weight share. Eight
// draws cover the kernel.
export const FLIP3D_SPLAT_VERT = /* glsl */ `
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uBounceRadius;
  uniform float uFluidScale;
  uniform vec3  uCellOffset;
  ${PYRO_GRID_UNIFORMS}
  ${PYRO_GRID_SAMPLING}
  varying vec4 vData;
  void main() {
    vec3 pos = texture2D(uPosTex, position.xy).xyz;
    vec3 vel = texture2D(uVelTex, position.xy).xyz;
    float extent = uBounceRadius * uFluidScale;
    vec3 g = (pos / (2.0 * extent) + 0.5) * uGridN - 0.5;
    vec3 base = floor(g);
    vec3 frac = g - base;
    vec3 cell = base + uCellOffset;
    vec3 axisW = mix(1.0 - frac, frac, uCellOffset);
    float w = axisW.x * axisW.y * axisW.z;
    if (w <= 0.0 || cell.x < 0.0 || cell.y < 0.0 || cell.z < 0.0
        || cell.x > uGridN - 1.0 || cell.y > uGridN - 1.0 || cell.z > uGridN - 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 1.0;
      vData = vec4(0.0);
      return;
    }
    vec2 uv = pyroUvOfCell(cell);
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    vData = vec4(vel * w, w);
  }
`;

export const FLIP3D_SPLAT_FRAG = /* glsl */ `
  precision highp float;
  varying vec4 vData;
  void main() {
    gl_FragColor = vData;
  }
`;

// Composite: grid velocity = momentum / weight where particles
// deposited; empty cells are air (velocity 0). w carries the
// coverage (weight relative to the uniform-pool average) the
// phi build normalises against.
export const FLIP3D_COMPOSITE_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uTransferTex;
uniform float uAvgWeight;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec4 tr = pyroFetch(uTransferTex, cell);
  float w = tr.w;
  vec3 vel = w > 1e-6 ? tr.xyz / w : vec3(0.0);
  float cov = clamp(w / max(uAvgWeight, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(vel, cov);
}
`;

// Phi build: occupancy chi = the P2G coverage box-blurred over
// 3x3x3 (the blur is load-bearing — curvature on the raw
// occupancy is noise), phi = (0.5 - chi) * 2h, h = 1 cell.
// Output r = phi, g = chi.
export const FLIP3D_PHI_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uTransferTex;
uniform float uAvgWeight;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  float sum = 0.0;
  for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        float w = pyroFetch(uTransferTex, cell + vec3(float(dx), float(dy), float(dz))).w;
        sum += clamp(w / max(uAvgWeight, 1e-4), 0.0, 1.0);
      }
    }
  }
  float chi = sum / 27.0;
  float phi = (0.5 - chi) * 2.0;
  gl_FragColor = vec4(phi, chi, 0.0, 1.0);
}
`;

// Phi advection: semi-Lagrangian through the grid velocity,
// then the occupancy correction — chi is raised to at least
// this step's P2G coverage so advection alone cannot diffuse
// the surface away; phi is rebuilt from the corrected chi.
export const FLIP3D_PHI_ADVECT_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uPhiIn;
uniform sampler2D uVelTex;
uniform sampler2D uTransferTex;
uniform float uAvgWeight;
uniform float uDelta;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 vel = pyroFetch(uVelTex, cell).xyz;
  vec3 back = cell - vel * uDelta;
  vec2 adv = pyroSample(uPhiIn, back).rg;
  float occ = clamp(pyroFetch(uTransferTex, cell).w / max(uAvgWeight, 1e-4), 0.0, 1.0);
  float chi = max(adv.y, occ);
  float phi = (0.5 - chi) * 2.0;
  gl_FragColor = vec4(phi, chi, 0.0, 1.0);
}
`;

// Viscosity Jacobi: one iteration of the implicit Helmholtz
// solve (I - alpha * lap) u = u*, alpha = nu * dt / h^2,
// h = 1 cell. Non-liquid neighbours (chi < 0.5) and the domain
// exterior are replaced by the centre value (zero gradient at
// the free surface), which keeps the solve momentum-conserving
// (see the CPU mirror). Air cells pass their iterate through.
export const FLIP3D_VISCOSITY_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelStar;
uniform sampler2D uVelIter;
uniform sampler2D uPhiTex;
uniform float uAlpha;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 iter = pyroFetch(uVelIter, cell).xyz;
  if (pyroFetch(uPhiTex, cell).g < 0.5) { gl_FragColor = vec4(iter, 1.0); return; }
  vec3 sum = vec3(0.0);
  sum += pyroFetch(uPhiTex, cell + vec3(1.0, 0.0, 0.0)).g >= 0.5 ? pyroFetch(uVelIter, cell + vec3(1.0, 0.0, 0.0)).xyz : iter;
  sum += pyroFetch(uPhiTex, cell - vec3(1.0, 0.0, 0.0)).g >= 0.5 ? pyroFetch(uVelIter, cell - vec3(1.0, 0.0, 0.0)).xyz : iter;
  sum += pyroFetch(uPhiTex, cell + vec3(0.0, 1.0, 0.0)).g >= 0.5 ? pyroFetch(uVelIter, cell + vec3(0.0, 1.0, 0.0)).xyz : iter;
  sum += pyroFetch(uPhiTex, cell - vec3(0.0, 1.0, 0.0)).g >= 0.5 ? pyroFetch(uVelIter, cell - vec3(0.0, 1.0, 0.0)).xyz : iter;
  sum += pyroFetch(uPhiTex, cell + vec3(0.0, 0.0, 1.0)).g >= 0.5 ? pyroFetch(uVelIter, cell + vec3(0.0, 0.0, 1.0)).xyz : iter;
  sum += pyroFetch(uPhiTex, cell - vec3(0.0, 0.0, 1.0)).g >= 0.5 ? pyroFetch(uVelIter, cell - vec3(0.0, 0.0, 1.0)).xyz : iter;
  vec3 star = pyroFetch(uVelStar, cell).xyz;
  vec3 outVel = (star + uAlpha * sum) / (1.0 + 6.0 * uAlpha);
  gl_FragColor = vec4(outVel, 1.0);
}
`;

// Shared normal / curvature helpers for the surface-tension
// passes: normals from phi's gradient, curvature as the
// divergence of the normal field.
export const FLIP3D_SURFACE_GLSL = /* glsl */ `
vec3 flip3dNormalAt(sampler2D phiTex, vec3 cell) {
  vec3 g = vec3(
    pyroFetch(phiTex, cell + vec3(1.0, 0.0, 0.0)).r - pyroFetch(phiTex, cell - vec3(1.0, 0.0, 0.0)).r,
    pyroFetch(phiTex, cell + vec3(0.0, 1.0, 0.0)).r - pyroFetch(phiTex, cell - vec3(0.0, 1.0, 0.0)).r,
    pyroFetch(phiTex, cell + vec3(0.0, 0.0, 1.0)).r - pyroFetch(phiTex, cell - vec3(0.0, 0.0, 1.0)).r
  ) * 0.5;
  float len = length(g);
  return len < 1e-9 ? vec3(0.0) : g / len;
}
float flip3dCurvatureAt(sampler2D phiTex, vec3 cell) {
  float nxp = flip3dNormalAt(phiTex, cell + vec3(1.0, 0.0, 0.0)).x;
  float nxm = flip3dNormalAt(phiTex, cell - vec3(1.0, 0.0, 0.0)).x;
  float nyp = flip3dNormalAt(phiTex, cell + vec3(0.0, 1.0, 0.0)).y;
  float nym = flip3dNormalAt(phiTex, cell - vec3(0.0, 1.0, 0.0)).y;
  float nzp = flip3dNormalAt(phiTex, cell + vec3(0.0, 0.0, 1.0)).z;
  float nzm = flip3dNormalAt(phiTex, cell - vec3(0.0, 0.0, 1.0)).z;
  return (nxp - nxm) * 0.5 + (nyp - nym) * 0.5 + (nzp - nzm) * 0.5;
}
`;

// Curvature pass: kappa baked into its own target so the force
// pass stays light. Outside the surface band (|phi| > 2 cells)
// kappa is exactly 0 — the normals there are meaningless.
export const FLIP3D_CURVATURE_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
${FLIP3D_SURFACE_GLSL}
uniform sampler2D uPhiTex;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  float phi = pyroFetch(uPhiTex, cell).r;
  float kappa = abs(phi) > 2.0 ? 0.0 : flip3dCurvatureAt(uPhiTex, cell);
  gl_FragColor = vec4(kappa, 0.0, 0.0, 1.0);
}
`;

// Surface-tension force (CSF): vel += dt * sigma * kappa *
// grad(chi). grad(chi) is nonzero only in the surface band, so
// no separate delta-function approximation is needed. The
// uniform density is absorbed into sigma (see lib/flip3d.ts).
export const FLIP3D_TENSION_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform sampler2D uPhiTex;
uniform sampler2D uCurvTex;
uniform float uSigma;
uniform float uDelta;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  vec2 phiChi = pyroFetch(uPhiTex, cell).rg;
  if (abs(phiChi.r) <= 2.0 && phiChi.g > 0.001) {
    vec3 gradChi = vec3(
      pyroFetch(uPhiTex, cell + vec3(1.0, 0.0, 0.0)).g - pyroFetch(uPhiTex, cell - vec3(1.0, 0.0, 0.0)).g,
      pyroFetch(uPhiTex, cell + vec3(0.0, 1.0, 0.0)).g - pyroFetch(uPhiTex, cell - vec3(0.0, 1.0, 0.0)).g,
      pyroFetch(uPhiTex, cell + vec3(0.0, 0.0, 1.0)).g - pyroFetch(uPhiTex, cell - vec3(0.0, 0.0, 1.0)).g
    ) * 0.5;
    float kappa = pyroFetch(uCurvTex, cell).r;
    vel += uDelta * uSigma * kappa * gradChi;
  }
  gl_FragColor = vec4(vel, 1.0);
}
`;

// Pressure Jacobi with the free-surface boundary condition:
// only liquid cells (chi >= 0.5) carry pressure; an air
// neighbour contributes pressure 0 (atmospheric) and is
// excluded from the denominator. The divergence is recomputed
// from the fixed source velocity every iteration (the FLIP
// convention — no divergence target), with backward
// differences, the MAC pair of the subtraction below.
export const FLIP3D_JACOBI_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelTex;
uniform sampler2D uPresIn;
uniform sampler2D uPhiTex;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  if (pyroFetch(uPhiTex, cell).g < 0.5) { gl_FragColor = vec4(0.0); return; }
  vec3 vC = pyroFetch(uVelTex, cell).xyz;
  float div = (vC.x - pyroFetch(uVelTex, cell - vec3(1.0, 0.0, 0.0)).x)
            + (vC.y - pyroFetch(uVelTex, cell - vec3(0.0, 1.0, 0.0)).y)
            + (vC.z - pyroFetch(uVelTex, cell - vec3(0.0, 0.0, 1.0)).z);
  // Free-surface BC, solver-consistent form: an in-domain
  // air neighbour contributes pressure 0 to the sum but still
  // counts in the diagonal (denominator) — otherwise the
  // gradient step (which reads air pressure as 0) leaves a
  // residual divergence of airCount * p at surface cells.
  // Domain-exterior neighbours are excluded from both (the
  // gradient there is zero by the clamped fetch).
  float sum = 0.0;
  float count = 0.0;
  vec3 nb;
  nb = cell + vec3(1.0, 0.0, 0.0); if (nb.x < uGridN) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  nb = cell - vec3(1.0, 0.0, 0.0); if (nb.x >= 0.0) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  nb = cell + vec3(0.0, 1.0, 0.0); if (nb.y < uGridN) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  nb = cell - vec3(0.0, 1.0, 0.0); if (nb.y >= 0.0) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  nb = cell + vec3(0.0, 0.0, 1.0); if (nb.z < uGridN) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  nb = cell - vec3(0.0, 0.0, 1.0); if (nb.z >= 0.0) { count += 1.0; if (pyroFetch(uPhiTex, nb).g >= 0.5) sum += pyroFetch(uPresIn, nb).r; }
  float p = count > 0.0 ? (sum - div) / count : 0.0;
  gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

// Gradient subtraction: forward differences (the MAC pair of
// the backward divergence above). Air neighbours read pressure
// 0 (atmospheric); air cells keep their velocity verbatim —
// the grid solves no air motion, particles there keep their
// own velocity through the G2P blend.
export const FLIP3D_SUBTRACT_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform sampler2D uPresTex;
uniform sampler2D uPhiTex;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  if (pyroFetch(uPhiTex, cell).g < 0.5) { gl_FragColor = vec4(vel, 1.0); return; }
  float pC = pyroFetch(uPresTex, cell).r;
  float pX = pyroFetch(uPhiTex, cell + vec3(1.0, 0.0, 0.0)).g >= 0.5 ? pyroFetch(uPresTex, cell + vec3(1.0, 0.0, 0.0)).r : 0.0;
  float pY = pyroFetch(uPhiTex, cell + vec3(0.0, 1.0, 0.0)).g >= 0.5 ? pyroFetch(uPresTex, cell + vec3(0.0, 1.0, 0.0)).r : 0.0;
  float pZ = pyroFetch(uPhiTex, cell + vec3(0.0, 0.0, 1.0)).g >= 0.5 ? pyroFetch(uPresTex, cell + vec3(0.0, 0.0, 1.0)).r : 0.0;
  vel -= vec3(pX - pC, pY - pC, pZ - pC);
  gl_FragColor = vec4(vel, 1.0);
}
`;

// Atlas merge copy (FLIP WebGL 案B, S1): a half-writing
// pass-through copy into the merged Vel+Base atlas. uHalf 0
// writes the source into the first tile half, 1 into the
// second; the other half's fragments discard, so two draws fill
// the whole merged target with no viewport/scissor state. The
// sample is a texel-centre pass-through under NoBlending on a
// FloatType target — no arithmetic, so the copy is bit-exact.
export const FLIP3D_ATLAS_COPY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSrcTex;
  uniform float uHalf;
  varying vec2 vUv;
  void main() {
    float y = vUv.y * 2.0 - uHalf;
    if (y < 0.0 || y >= 1.0) discard;
    gl_FragColor = texture2D(uSrcTex, vec2(vUv.x, y));
  }
`;
