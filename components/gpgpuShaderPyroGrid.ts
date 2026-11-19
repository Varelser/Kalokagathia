// Phase CA: Pyro grid solver shaders. The 3D grid is packed into a
// 2D atlas (one z slice per tile — layouts in lib/pyroGrid.ts) and
// stepped with the stable-fluids pipeline:
//
//   advect velocity -> advect scalar -> buoyancy + walls ->
//   scalar update (diffuse / cool / emit) -> divergence ->
//   Jacobi x N -> gradient subtraction
//
// Discretisation is the FLIP precedent's MAC-consistent pair
// (backward-difference divergence, forward-difference gradient),
// so div(grad p) is the compact 7-point Laplacian and no
// checkerboard mode appears. Sampling: cell-centre convention —
// cell i's centre is at grid position i, the valid range is
// [0, N-1] per axis, reads clamp to the edge cell. Trilinear
// interpolation uses hardware bilinear in x/y within a slice plus
// a manual mix across the two neighbouring slices; when float
// linear filtering is unavailable the shaders switch (uniform) to
// a manual 8-tap trilinear over exact texel fetches.
//
// All shaders early-out on the unused atlas tiles (96^3 packs 96
// slices into 100 tiles) so garbage can never accumulate there.

// The common block is composed from named pieces (Phase CB)
// so the fog fragment shader and the particle velocity shader
// can embed the sampling half — and only that half — under
// the same uniform names. PYRO_GRID_COMMON itself stays
// byte-identical to the Phase CA original; the test suite
// pins the composition.
export const PYRO_GRID_UNIFORMS = /* glsl */ `uniform float uGridN;
uniform vec2 uAtlasSize;
uniform vec2 uAtlasTiles;
uniform bool uManualTrilinear;
`;

export const PYRO_GRID_SAMPLING = /* glsl */ `vec2 pyroUvOfCell(vec3 cell) {
  vec2 tile = vec2(mod(cell.z, uAtlasTiles.x), floor(cell.z / uAtlasTiles.x));
  return (tile * uGridN + cell.xy + 0.5) / uAtlasSize;
}

vec3 pyroClampCell(vec3 c) {
  return clamp(c, vec3(0.0), vec3(uGridN - 1.0));
}

vec4 pyroFetch(sampler2D tex, vec3 cell) {
  return texture2D(tex, pyroUvOfCell(pyroClampCell(cell)));
}

vec4 pyroSample(sampler2D tex, vec3 p) {
  vec3 pc = clamp(p, vec3(0.0), vec3(uGridN - 1.0));
  vec3 b = floor(pc);
  vec3 f = pc - b;
  if (uManualTrilinear) {
    vec4 c000 = pyroFetch(tex, b);
    vec4 c100 = pyroFetch(tex, b + vec3(1.0, 0.0, 0.0));
    vec4 c010 = pyroFetch(tex, b + vec3(0.0, 1.0, 0.0));
    vec4 c110 = pyroFetch(tex, b + vec3(1.0, 1.0, 0.0));
    vec4 c001 = pyroFetch(tex, b + vec3(0.0, 0.0, 1.0));
    vec4 c101 = pyroFetch(tex, b + vec3(1.0, 0.0, 1.0));
    vec4 c011 = pyroFetch(tex, b + vec3(0.0, 1.0, 1.0));
    vec4 c111 = pyroFetch(tex, b + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
               mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
  }
  float z1 = min(b.z + 1.0, uGridN - 1.0);
  vec2 tile0 = vec2(mod(b.z, uAtlasTiles.x), floor(b.z / uAtlasTiles.x));
  vec2 tile1 = vec2(mod(z1, uAtlasTiles.x), floor(z1 / uAtlasTiles.x));
  vec2 xy = pc.xy + 0.5;
  vec4 s0 = texture2D(tex, (tile0 * uGridN + xy) / uAtlasSize);
  vec4 s1 = texture2D(tex, (tile1 * uGridN + xy) / uAtlasSize);
  return mix(s0, s1, f.z);
}
`;

// World -> grid mapping (Phase CB), the GLSL twin of
// pyroGridCellOfWorld in lib/pyroGrid.ts: the domain is the
// cube centred on uPyroGridBounds.xyz with half-extent
// uPyroGridBounds.w (the particle bounce radius). Requires
// the PYRO_GRID_UNIFORMS names (uGridN) in scope.
export const PYRO_GRID_WORLD = /* glsl */ `uniform vec4 uPyroGridBounds;

vec3 pyroCellOfWorld(vec3 worldPos) {
  return ((worldPos - uPyroGridBounds.xyz) / (2.0 * uPyroGridBounds.w) + 0.5) * uGridN - 0.5;
}

float pyroDomainFade(vec3 cellPos) {
  vec3 d = min(cellPos, vec3(uGridN - 1.0) - cellPos);
  float m = min(d.x, min(d.y, d.z));
  return clamp(m + 0.5, 0.0, 1.0);
}
`;

export const PYRO_GRID_COMMON = /* glsl */ `
precision highp float;
${PYRO_GRID_UNIFORMS}varying vec2 vUv;

vec3 pyroCellOf(vec2 uv) {
  vec2 px = uv * uAtlasSize;
  vec2 tile = floor(px / uGridN);
  vec2 inTile = px - tile * uGridN;
  float z = tile.y * uAtlasTiles.x + tile.x;
  return vec3(floor(inTile), z);
}

${PYRO_GRID_SAMPLING}
// Closed-box walls: the normal velocity component at a domain
// face is zeroed (both signs — no through-flow and no suction).
// Applied after buoyancy and again after the projection, which
// would otherwise reopen the faces.
vec3 pyroApplyWalls(vec3 vel, vec3 cell) {
  if (cell.x <= 0.0 || cell.x >= uGridN - 1.0) vel.x = 0.0;
  if (cell.y <= 0.0 || cell.y >= uGridN - 1.0) vel.y = 0.0;
  if (cell.z <= 0.0 || cell.z >= uGridN - 1.0) vel.z = 0.0;
  return vel;
}
`;

export const PYRO_GRID_ADVECT_VEL_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform float uDelta;
uniform float uMaxSpeed;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  vec3 back = cell - vel * uDelta;
  vec3 adv = pyroSample(uVelIn, back).xyz;
  gl_FragColor = vec4(clamp(adv, vec3(-uMaxSpeed), vec3(uMaxSpeed)), 1.0);
}
`;

export const PYRO_GRID_ADVECT_SCALAR_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uScalarIn;
uniform sampler2D uVelIn;
uniform float uDelta;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  // Backtraced with the current (pre-advection) velocity field;
  // the pass runner orders velocity advection after this so both
  // fields advect through the same velocity.
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  vec3 back = cell - vel * uDelta;
  gl_FragColor = pyroSample(uScalarIn, back);
}
`;

export const PYRO_GRID_FORCES_VEL_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform sampler2D uScalarIn;
uniform float uDelta;
uniform float uBuoyancy;
uniform float uBuoyAccel;
uniform float uDensityWeight;
uniform float uMaxSpeed;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  vec4 sc = pyroFetch(uScalarIn, cell);
  // Buoyancy in cell units (see lib/pyroGrid.ts): hot scalar
  // rises, dense scalar sinks (density weight is 0 this round).
  vel.y += uDelta * (uBuoyancy * sc.g - uDensityWeight * sc.r) * uBuoyAccel;
  vel = pyroApplyWalls(vel, cell);
  gl_FragColor = vec4(clamp(vel, vec3(-uMaxSpeed), vec3(uMaxSpeed)), 1.0);
}
`;

export const PYRO_GRID_SCALAR_UPDATE_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uScalarIn;
uniform float uDelta;
uniform float uDiffuse;
uniform float uCooling;
uniform float uTempCoolRate;
uniform float uDensityDecayRate;
uniform float uEmitTemp;
uniform float uEmitDensity;
uniform float uEmitTempRate;
uniform vec3 uSourceCenter;
uniform float uSourceRadius;
uniform float uFuelRate;
uniform float uFuelEmit;
uniform float uFuelReactionK;
uniform float uFuelHeat;
uniform float uIgniteLo;
uniform float uIgniteHi;
uniform float uTempMax;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec4 s = pyroFetch(uScalarIn, cell);
  // Explicit diffusion (coefficient <= 1/6 keeps it stable).
  vec4 lap = pyroFetch(uScalarIn, cell + vec3(1.0, 0.0, 0.0))
           + pyroFetch(uScalarIn, cell - vec3(1.0, 0.0, 0.0))
           + pyroFetch(uScalarIn, cell + vec3(0.0, 1.0, 0.0))
           + pyroFetch(uScalarIn, cell - vec3(0.0, 1.0, 0.0))
           + pyroFetch(uScalarIn, cell + vec3(0.0, 0.0, 1.0))
           + pyroFetch(uScalarIn, cell - vec3(0.0, 0.0, 1.0))
           - 6.0 * s;
  s += uDiffuse * lap;
  // Exponential cooling (temperature) and decay (density).
  s.g *= exp(-uCooling * uTempCoolRate * uDelta);
  s.r *= exp(-uDensityDecayRate * uDelta);
  // Combustion (Phase CB, sub-phase 8): the fuel field rides the
  // spare b channel. Where the cooled temperature crosses the
  // ignition window, fuel burns at a rate proportional to the
  // fuel present — the burn is bounded by the fuel itself — and
  // releases heat, with the temperature capped so the reaction
  // cannot run away. The reaction runs before this step's
  // emission, so fresh fuel starts burning next step. At fuel
  // rate 0 the burn is exactly 0 and no fuel is emitted below:
  // the channel stays zero by construction.
  if (uFuelRate > 0.0 && s.b > 0.0) {
    float ignite = smoothstep(uIgniteLo, uIgniteHi, s.g);
    float burn = min(s.b, uFuelRate * uFuelReactionK * ignite * s.b * uDelta);
    s.b -= burn;
    s.g = min(s.g + burn * uFuelHeat, uTempMax);
  }
  // Source: a smooth sphere at the bottom centre of the domain
  // emitting density and relaxing temperature toward the emit
  // temperature (the particle solver's emitter analogue).
  float w = clamp(1.0 - length(cell - uSourceCenter) / uSourceRadius, 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  if (w > 0.0) {
    s.r += uEmitDensity * w * uDelta;
    s.g += (uEmitTemp - s.g) * min(1.0, w * uDelta * uEmitTempRate);
    s.b += uFuelRate * uFuelEmit * w * uDelta;
  }
  // Density / temperature never go negative; the spare channels
  // stay zero by construction (diffusion of zeros).
  s.r = max(s.r, 0.0);
  s.g = max(s.g, 0.0);
  gl_FragColor = s;
}
`;

export const PYRO_GRID_DIVERGENCE_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  // Backward differences — the MAC-consistent partner of the
  // forward-difference gradient in the subtraction shader.
  vec3 vC = pyroFetch(uVelIn, cell).xyz;
  float div = (vC.x - pyroFetch(uVelIn, cell - vec3(1.0, 0.0, 0.0)).x)
            + (vC.y - pyroFetch(uVelIn, cell - vec3(0.0, 1.0, 0.0)).y)
            + (vC.z - pyroFetch(uVelIn, cell - vec3(0.0, 0.0, 1.0)).z);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const PYRO_GRID_JACOBI_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uPresIn;
uniform sampler2D uDivTex;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  float div = pyroFetch(uDivTex, cell).r;
  float sum = pyroFetch(uPresIn, cell + vec3(1.0, 0.0, 0.0)).r
            + pyroFetch(uPresIn, cell - vec3(1.0, 0.0, 0.0)).r
            + pyroFetch(uPresIn, cell + vec3(0.0, 1.0, 0.0)).r
            + pyroFetch(uPresIn, cell - vec3(0.0, 1.0, 0.0)).r
            + pyroFetch(uPresIn, cell + vec3(0.0, 0.0, 1.0)).r
            + pyroFetch(uPresIn, cell - vec3(0.0, 0.0, 1.0)).r;
  float p = (sum - div) / 6.0;
  gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

export const PYRO_GRID_SUBTRACT_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform sampler2D uPresTex;
uniform float uMaxSpeed;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  // Forward differences — the MAC-consistent partner of the
  // backward-difference divergence.
  float pC = pyroFetch(uPresTex, cell).r;
  vel.x -= pyroFetch(uPresTex, cell + vec3(1.0, 0.0, 0.0)).r - pC;
  vel.y -= pyroFetch(uPresTex, cell + vec3(0.0, 1.0, 0.0)).r - pC;
  vel.z -= pyroFetch(uPresTex, cell + vec3(0.0, 0.0, 1.0)).r - pC;
  vel = pyroApplyWalls(vel, cell);
  gl_FragColor = vec4(clamp(vel, vec3(-uMaxSpeed), vec3(uMaxSpeed)), 1.0);
}
`;

// Vorticity confinement V1 (Phase CB, sub-phase 7): the curl of
// the velocity field, central differences on the collocated grid
// (cell spacing 1), stored as rgb = curl, a = |curl| so the
// confinement pass and the gate's enstrophy readback share one
// field. Runs only on steps where epsilon > 0.
export const PYRO_GRID_CURL_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  float duz_dy = (pyroFetch(uVelIn, cell + vec3(0.0, 1.0, 0.0)).z - pyroFetch(uVelIn, cell - vec3(0.0, 1.0, 0.0)).z) * 0.5;
  float duy_dz = (pyroFetch(uVelIn, cell + vec3(0.0, 0.0, 1.0)).y - pyroFetch(uVelIn, cell - vec3(0.0, 0.0, 1.0)).y) * 0.5;
  float dux_dz = (pyroFetch(uVelIn, cell + vec3(0.0, 0.0, 1.0)).x - pyroFetch(uVelIn, cell - vec3(0.0, 0.0, 1.0)).x) * 0.5;
  float duz_dx = (pyroFetch(uVelIn, cell + vec3(1.0, 0.0, 0.0)).z - pyroFetch(uVelIn, cell - vec3(1.0, 0.0, 0.0)).z) * 0.5;
  float duy_dx = (pyroFetch(uVelIn, cell + vec3(1.0, 0.0, 0.0)).y - pyroFetch(uVelIn, cell - vec3(1.0, 0.0, 0.0)).y) * 0.5;
  float dux_dy = (pyroFetch(uVelIn, cell + vec3(0.0, 1.0, 0.0)).x - pyroFetch(uVelIn, cell - vec3(0.0, 1.0, 0.0)).x) * 0.5;
  vec3 w = vec3(duz_dy - duy_dz, dux_dz - duz_dx, duy_dx - dux_dy);
  gl_FragColor = vec4(w, length(w));
}
`;

// Vorticity confinement V2 (Phase CB, sub-phase 7): the Fedkiw
// confinement force F = epsilon * h * (N x w), with h = 1 cell,
// N = grad|w| / |grad|w||, integrated as vel += F * dt, then the
// same wall treatment and speed clamp as the other velocity
// writers. Where the curl magnitude is flat (gradient ~ 0) the
// direction is undefined and the force is exactly zero.
export const PYRO_GRID_VORTICITY_FORCE_FRAG = /* glsl */ `
${PYRO_GRID_COMMON}
uniform sampler2D uVelIn;
uniform sampler2D uCurlIn;
uniform float uDelta;
uniform float uEpsilon;
uniform float uMaxSpeed;
void main() {
  vec3 cell = pyroCellOf(vUv);
  if (cell.z >= uGridN) { gl_FragColor = vec4(0.0); return; }
  vec3 vel = pyroFetch(uVelIn, cell).xyz;
  vec3 eta = vec3(
    pyroFetch(uCurlIn, cell + vec3(1.0, 0.0, 0.0)).w - pyroFetch(uCurlIn, cell - vec3(1.0, 0.0, 0.0)).w,
    pyroFetch(uCurlIn, cell + vec3(0.0, 1.0, 0.0)).w - pyroFetch(uCurlIn, cell - vec3(0.0, 1.0, 0.0)).w,
    pyroFetch(uCurlIn, cell + vec3(0.0, 0.0, 1.0)).w - pyroFetch(uCurlIn, cell - vec3(0.0, 0.0, 1.0)).w
  ) * 0.5;
  float etaLen = length(eta);
  if (etaLen > 1e-6) {
    vec3 w = pyroFetch(uCurlIn, cell).xyz;
    vel += uEpsilon * cross(eta / etaLen, w) * uDelta;
  }
  vel = pyroApplyWalls(vel, cell);
  gl_FragColor = vec4(clamp(vel, vec3(-uMaxSpeed), vec3(uMaxSpeed)), 1.0);
}
`;
