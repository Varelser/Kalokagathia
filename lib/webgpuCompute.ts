// lib/webgpuCompute.ts
// WebGPU Compute Pipeline for GPGPU particle simulation.
// Replaces the fragment-shader ping-pong FBO with native GPU compute shaders (WGSL).
// Results are read back to CPU and uploaded to THREE.DataTexture each frame.
//
// Phase X3: the WGSL passes now carry the full WebGL force set —
// the OBJ normal kick (Phase O, inside the morph block), audio
// blast, N-body, curl (symmetry / octaves / modes), boids,
// Kuramoto, Particle Life, attractors, Lévy flight, vortex, wind,
// gravity wells, elastic, magnetic, SPH, vector fields, spring
// (initial-position buffer), SDF collider (velocity reflection +
// position push-out), floor bounce, mouse force (incl. paint),
// and the Verlet integrator (previous-position buffer). Every
// block is a verbatim port of the WebGL fragment force law and is
// skipped entirely while its feature is disabled, so the legacy
// step (gravity / turbulence / morph / bounce) is untouched for
// configs that use none of them. Phase 15 added the age
// lifecycle (advance + wrap respawn in the position pass, the
// kick's respawn-frame trigger in the velocity pass). Phase 25
// added the fluid field (FLUID_WGSL + the legacy coupling) and
// Phase 26 the FLIP 3D solver (FLIP3D_*_WGSL + the FLIP3D
// coupling block). Still WebGL-only (declared unsupported by
// the capability registry, which routes those configs to
// WebGL): the 2D FLIP layer, the Aux event pools (WebGL FBO
// passes), and user GLSL custom forces (WGSL cannot compile
// GLSL).

import { PYRO_GRID_LAYOUTS, pyroGridAtlasSize } from './pyroGrid';
import {
  FLIP3D_VISCOSITY_ITERATIONS,
  flip3dPassCount,
  setFlip3dRuntimeStatus,
} from './flip3d';

const VEL_WGSL = /* wgsl */ `
struct Uniforms {
  texSize : u32,
  delta   : f32,
  time    : f32,
  gravity : f32,
  turbulence : f32,
  bounceRadius : f32,
  bounce : f32,
  speed  : f32,
  morphEnabled : f32,
  morphStrength : f32,
  morphOrbitSpeed : f32,
  morphReplicaPhaseGain : f32,
  morphObjNormalSpeed : f32,
  morphKickStart : f32,
  audioBlast : f32,
  nBodyEnabled : f32,
  nBodyStrength : f32,
  nBodySoftening : f32,
  nBodyRepulsion : f32,
  nBodySamples : i32,
  curlEnabled : f32,
  curlStrength : f32,
  curlScale : f32,
  curlSymmetry : i32,
  curlMode : i32,
  curlOctaves : i32,
  boidsEnabled : f32,
  boidsSeparation : f32,
  boidsAlignment : f32,
  boidsCohesion : f32,
  boidsRadius : f32,
  attractorEnabled : f32,
  attractorType : i32,
  attractorStrength : f32,
  attractorScale : f32,
  levyEnabled : f32,
  levyStrength : f32,
  levyRate : f32,
  kuramotoEnabled : f32,
  kuramotoCoupling : f32,
  kuramotoSpread : f32,
  kuramotoRadius : f32,
  particleLifeEnabled : f32,
  particleLifeStrength : f32,
  particleLifeRadius : f32,
  particleLifeFriction : f32,
  particleLifeSpecies : i32,
  vortexEnabled : f32,
  vortexStrength : f32,
  vortexTilt : f32,
  windEnabled : f32,
  windStrength : f32,
  windX : f32,
  windY : f32,
  windZ : f32,
  windGust : f32,
  wellEnabled : f32,
  wellStrength : f32,
  wellSoftening : f32,
  wellOrbit : f32,
  wellCount : i32,
  wellSpread : f32,
  elasticEnabled : f32,
  elasticStrength : f32,
  magneticEnabled : f32,
  magneticStrength : f32,
  magneticBX : f32,
  magneticBY : f32,
  magneticBZ : f32,
  sphEnabled : f32,
  sphPressure : f32,
  sphViscosity : f32,
  sphRadius : f32,
  sphRestDensity : f32,
  vFieldEnabled : f32,
  vFieldType : i32,
  vFieldStrength : f32,
  vFieldScale : f32,
  springEnabled : f32,
  springStrength : f32,
  sdfEnabled : f32,
  sdfShape : i32,
  sdfX : f32,
  sdfY : f32,
  sdfZ : f32,
  sdfSize : f32,
  sdfBounce : f32,
  floorEnabled : f32,
  floorY : f32,
  floorBounce : f32,
  mouseEnabled : f32,
  mousePosX : f32,
  mousePosY : f32,
  mousePosZ : f32,
  mouseStrength : f32,
  mouseRadius : f32,
  mouseMode : i32,
  mousePaintRate : f32,
  // Age lifecycle flag (Phase 15, UE5 #18): buffer index 98 —
  // only the morph kick's respawn-frame trigger reads it here;
  // the lifecycle itself runs in the position pass.
  ageEnabled : f32,
  // Crowd steering (Phase 20 stage 2): buffer indices 99-113,
  // the path array at 116 (vec3f arrays are 16-byte aligned).
  // The WGSL twin of lib/steering.ts — seek / arrive / path.
  // Mode 3 (state) joined in Phase 28 (9-5): the slot value is
  // read from the attribute texture at binding 13, and the
  // slot / threshold ride at indices 152-153 (struct tail).
  steerEnabled : f32,
  steerMode : i32,
  steerStrength : f32,
  steerMaxSpeed : f32,
  steerMaxForce : f32,
  steerTargetX : f32,
  steerTargetY : f32,
  steerTargetZ : f32,
  steerTarget1X : f32,
  steerTarget1Y : f32,
  steerTarget1Z : f32,
  steerSlowingRadius : f32,
  steerPathCount : i32,
  steerPathLookAhead : f32,
  steerPathRadius : f32,
  steerPad0 : f32,
  steerPad1 : f32,
  steerPath : array<vec3f, 8>,
  // Strange attractor unit 2 (Phase 27, 9-6 stage 1): buffer
  // indices 148-151, appended after the steering path array
  // so every earlier field offset is unchanged. The WGSL
  // twin carries no space mode (unit 1 has none here either;
  // space modes are WebGL-side depiction).
  attractor2Enabled : f32,
  attractor2Type : i32,
  attractor2Strength : f32,
  attractor2Scale : f32,
  // Steering state mode (Phase 28, 9-5): buffer indices
  // 152-153, appended at the very end so every earlier field
  // offset is unchanged.
  steerStateSlot : i32,
  steerStateThreshold : f32,
  // Two pads close the struct at 624 bytes: WGSL rounds a
  // uniform struct's size up to its largest member alignment
  // (16, from the vec3f path array), so 616 would under-size
  // the bound buffer and invalidate the pipeline — the
  // Phase 28 gate's first round proved exactly that.
  steerStatePad0 : f32,
  steerStatePad1 : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velOut : array<vec4f>;
@group(0) @binding(4) var<storage, read>       morphIn : array<vec4f>;
@group(0) @binding(5) var<storage, read>       morphNormalIn : array<vec4f>;
@group(0) @binding(6) var<storage, read>       initPosIn : array<vec4f>;
@group(0) @binding(7) var<storage, read>       particleLifeIn : array<f32, 36>;
// Fluid field (Phase 25): the resident 64x64 grid (ping-pong
// storage buffers written by FLUID_WGSL) sampled by the coupling
// block in main. The grid lives in buffers, not GPU textures, so
// the WebGL field's LinearFilter + RepeatWrapping sampling is
// reproduced by hand (fluidSample below) on every device —
// float textures are neither filterable nor writable everywhere.
// fu mirrors the FLUID_WGSL uniform block layout.
struct FluidUniforms {
  delta        : f32,
  diffuse      : f32,
  decay        : f32,
  strength     : f32,
  time         : f32,
  extForce     : f32,
  influence    : f32,
  scale        : f32,
  enabled      : f32,
};
@group(0) @binding(8) var<storage, read>       fluidIn : array<vec4f>;
@group(0) @binding(9) var<uniform>             fu : FluidUniforms;

// FLIP 3D coupling (Phase 26): the previous solver step's
// projected grid velocity and pre-projection base, published
// into dedicated textures at the end of each stepped frame
// (the WebGL coupling reads the same pair one step behind).
// The WebGL pass's flip3dSample is reproduced as a manual
// trilinear over the atlas texel coordinates (tile = z slice,
// ClampToEdge per cell) with textureLoad fetches.
struct Flip3dUniforms {
  couple     : f32,
  blend      : f32,
  transfer   : f32,
  velScale   : f32,
  halfExtent : f32,
  gridN      : f32,
  atlasW     : f32,
  tilesX     : f32,
};
// The couple pair rides in sampled textures, NOT storage
// buffers: the velocity stage already binds 8 storage buffers
// (the default maxStorageBuffersPerShaderStage) and two more
// would invalidate the pipeline on spec-limit devices — the
// Phase 26 gate's first round proved exactly that. textureLoad
// needs no sampler and no filtering, so the manual trilinear
// below is unchanged; the step publishes the pair with
// copyBufferToTexture after the velocity pass.
@group(0) @binding(10) var flipVelTex : texture_2d<f32>;
@group(0) @binding(11) var flipBaseTex : texture_2d<f32>;
@group(0) @binding(12) var<uniform>            f3u : Flip3dUniforms;

// Named-attribute bake (Phase 28, 9-5): the same RGBA float
// data the WebGL passes read as uAttrTex, mirrored into a
// WebGPU texture by updateWebGPUAttrData. A texture, not a
// storage buffer, for the same reason as the FLIP couple
// above: the velocity stage's 8 storage buffers are all bound.
// Only the steering state mode loads it in this pass (the
// force-drive / group consumers still route to WebGL under
// their own capability declarations).
@group(0) @binding(13) var attrTex : texture_2d<f32>;

fn flipTexelXY(cellRaw: vec3f, gridN: f32, tilesX: f32) -> vec2i {
  let c = clamp(cellRaw, vec3f(0.0), vec3f(gridN - 1.0));
  let z = u32(c.z);
  let tileX = z % u32(tilesX);
  let tileY = z / u32(tilesX);
  let tx = tileX * u32(gridN) + u32(c.x);
  let ty = tileY * u32(gridN) + u32(c.y);
  return vec2i(i32(tx), i32(ty));
}
fn flipFetchVel(cell: vec3f) -> vec4f {
  return textureLoad(flipVelTex, flipTexelXY(cell, f3u.gridN, f3u.tilesX), 0);
}
fn flipFetchBase(cell: vec3f) -> vec4f {
  return textureLoad(flipBaseTex, flipTexelXY(cell, f3u.gridN, f3u.tilesX), 0);
}
fn flipTri(c000: vec4f, c100: vec4f, c010: vec4f, c110: vec4f,
           c001: vec4f, c101: vec4f, c011: vec4f, c111: vec4f, f: vec3f) -> vec4f {
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
fn flipSampleVel(p: vec3f) -> vec4f {
  let pc = clamp(p, vec3f(0.0), vec3f(f3u.gridN - 1.0));
  let b = floor(pc);
  let f = pc - b;
  return flipTri(
    flipFetchVel(b), flipFetchVel(b + vec3f(1.0, 0.0, 0.0)),
    flipFetchVel(b + vec3f(0.0, 1.0, 0.0)), flipFetchVel(b + vec3f(1.0, 1.0, 0.0)),
    flipFetchVel(b + vec3f(0.0, 0.0, 1.0)), flipFetchVel(b + vec3f(1.0, 0.0, 1.0)),
    flipFetchVel(b + vec3f(0.0, 1.0, 1.0)), flipFetchVel(b + vec3f(1.0, 1.0, 1.0)), f);
}
fn flipSampleBase(p: vec3f) -> vec4f {
  let pc = clamp(p, vec3f(0.0), vec3f(f3u.gridN - 1.0));
  let b = floor(pc);
  let f = pc - b;
  return flipTri(
    flipFetchBase(b), flipFetchBase(b + vec3f(1.0, 0.0, 0.0)),
    flipFetchBase(b + vec3f(0.0, 1.0, 0.0)), flipFetchBase(b + vec3f(1.0, 1.0, 0.0)),
    flipFetchBase(b + vec3f(0.0, 0.0, 1.0)), flipFetchBase(b + vec3f(1.0, 0.0, 1.0)),
    flipFetchBase(b + vec3f(0.0, 1.0, 1.0)), flipFetchBase(b + vec3f(1.0, 1.0, 1.0)), f);
}

fn fluidWrap64(i: i32) -> i32 { return ((i % 64) + 64) % 64; }
fn fluidTexel(x: i32, y: i32) -> vec2f {
  return fluidIn[u32(fluidWrap64(y) * 64 + fluidWrap64(x))].xy;
}
// Bilinear sample with RepeatWrapping — the twin of the WebGL
// velocity pass's texture2D(uFluidTex, uv) on a LinearFilter RT.
fn fluidSample(uv: vec2f) -> vec2f {
  let p = uv * 64.0 - 0.5;
  let base = floor(p);
  let fr = p - base;
  let x0 = i32(base.x);
  let y0 = i32(base.y);
  let c00 = fluidTexel(x0, y0);
  let c10 = fluidTexel(x0 + 1, y0);
  let c01 = fluidTexel(x0, y0 + 1);
  let c11 = fluidTexel(x0 + 1, y0 + 1);
  return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

fn dmHash11(n: f32) -> f32 {
  var p3 = fract(vec3f(n) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + vec3f(33.33));
  return fract((p3.x + p3.y) * p3.z);
}

fn hash3(p: vec3f) -> vec3f {
  var q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return vec3f(dmHash11(q.x), dmHash11(q.y), dmHash11(q.z)) * 2.0 - 1.0;
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash3(i),f),
                     dot(hash3(i+vec3f(1,0,0)),f-vec3f(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3f(0,1,0)),f-vec3f(0,1,0)),
                     dot(hash3(i+vec3f(1,1,0)),f-vec3f(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3f(0,0,1)),f-vec3f(0,0,1)),
                     dot(hash3(i+vec3f(1,0,1)),f-vec3f(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3f(0,1,1)),f-vec3f(0,1,1)),
                     dot(hash3(i+vec3f(1,1,1)),f-vec3f(1,1,1)),u.x),u.y),u.z);
}

// GLSL mod() is floor-based; WGSL % is trunc-based. Ported code
// that can see negative inputs goes through gmod.
fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

// Divergence-free curl noise (12 noise evals) — verbatim port of
// the WebGL velocity shader's curlNoise.
fn curlNoise(p: vec3f) -> vec3f {
  let e = 0.1;
  let p1 = p + vec3f(31.416, 0.0, 0.0);
  let p2 = p + vec3f(0.0, 43.982, 0.0);
  let dFz_dy = vnoise(p2 + vec3f(0,e,0)) - vnoise(p2 - vec3f(0,e,0));
  let dFy_dz = vnoise(p1 + vec3f(0,0,e)) - vnoise(p1 - vec3f(0,0,e));
  let dFx_dz = vnoise(p  + vec3f(0,0,e)) - vnoise(p  - vec3f(0,0,e));
  let dFz_dx = vnoise(p2 + vec3f(e,0,0)) - vnoise(p2 - vec3f(e,0,0));
  let dFy_dx = vnoise(p1 + vec3f(e,0,0)) - vnoise(p1 - vec3f(e,0,0));
  let dFx_dy = vnoise(p  + vec3f(0,e,0)) - vnoise(p  - vec3f(0,e,0));
  return vec3f(dFz_dy - dFy_dz, dFx_dz - dFz_dx, dFy_dx - dFx_dy) / (2.0 * e);
}

fn symmetricCurl(p: vec3f, tOff: vec3f, symmetry: i32) -> vec3f {
  if (symmetry == 1) { // mirrorX
    let sx = select(1.0, -1.0, p.x < 0.0);
    let c = curlNoise(vec3f(abs(p.x), p.y, p.z) + tOff);
    return vec3f(c.x * sx, c.y, c.z);
  }
  if (symmetry == 4) { // octahedral
    let s = vec3f(select(1.0, -1.0, p.x < 0.0), select(1.0, -1.0, p.y < 0.0), select(1.0, -1.0, p.z < 0.0));
    let c = curlNoise(abs(p) + tOff);
    return c * s;
  }
  // radial4 / radial6
  let k = select(6.0, 4.0, symmetry == 2);
  let sector = 6.28318530718 / k;
  let r = length(p.xz);
  let theta = atan2(p.z, p.x);
  let normTheta = gmod(theta, sector);
  let folded = select(normTheta, sector - normTheta, normTheta > sector * 0.5);
  let fp = vec3f(r * cos(folded), p.y, r * sin(folded));
  let c = curlNoise(fp + tOff);
  let rot = theta - folded;
  let rc = cos(rot);
  let rs = sin(rot);
  return vec3f(c.x * rc - c.z * rs, c.y, c.x * rs + c.z * rc);
}

fn curlSampleAt(p: vec3f, tOff: vec3f, symmetry: i32) -> vec3f {
  return select(curlNoise(p + tOff), symmetricCurl(p, tOff, symmetry), symmetry != 0);
}

fn curlField(p: vec3f, tOff: vec3f) -> vec3f {
  var c = curlSampleAt(p, tOff, u.curlSymmetry);
  if (u.curlOctaves >= 2) { c += 0.45 * curlSampleAt(p * 2.13, tOff + vec3f(17.1, -9.4, 5.7), u.curlSymmetry); }
  if (u.curlOctaves >= 3) { c += 0.22 * curlSampleAt(p * 4.27, tOff + vec3f(-11.3, 21.8, -14.2), u.curlSymmetry); }
  if (u.curlMode == 1) { // ridged
    c = sign(c) * (vec3f(1.25) - exp(-abs(c) * 0.9)) * 2.1;
  } else if (u.curlMode == 2) { // vortex
    c += vec3f(-p.z, 0.0, p.x) * 0.49;
  }
  return c;
}

// Gyroid SDF (B3) — identical formulation to the WebGL shaders.
fn gyroidField(p: vec3f, sc: vec3f, size: f32) -> f32 {
  let q = (p - sc) * (3.14159265 / max(size, 1.0));
  return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
}
fn gyroidNormal(p: vec3f, sc: vec3f, size: f32) -> vec3f {
  let q = (p - sc) * (3.14159265 / max(size, 1.0));
  let g = vec3f(
    cos(q.x) * cos(q.y) - sin(q.z) * sin(q.x),
    cos(q.y) * cos(q.z) - sin(q.x) * sin(q.y),
    cos(q.z) * sin(q.x) - sin(q.y) * sin(q.z)
  );
  return normalize(g + vec3f(0.0001));
}

// Pointer paint gate (B3): identical hash to the position pass
// copy below and to the WebGL shaders, so both passes agree on
// which particles are painted in a frame.
fn paintHash(uv: vec2f, tick: f32) -> f32 {
  return dmHash11(dot(uv * 913.7 + vec2f(tick * 17.31, tick * 7.77), vec2f(127.1, 311.7)));
}

// Particle Life species: fixed per particle from the texel index.
fn plHash(n: f32) -> f32 {
  return dmHash11(n * 3.71 + 17.17);
}
fn plSpecies(idx: u32, speciesCount: i32) -> i32 {
  let h = plHash(f32(idx) + 17.17);
  return i32(min(floor(h * f32(speciesCount)), f32(speciesCount - 1)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let texSizeU = u.texSize;
  if (idx >= texSizeU * texSizeU) { return; }
  let texSizeF = f32(texSizeU);
  let vUv = (vec2f(f32(idx % texSizeU), f32(idx / texSizeU)) + 0.5) / texSizeF;
  var pos = posIn[idx].xyz;
  var vel = velIn[idx].xyz;
  var phaseState = velIn[idx].w;

  vel.y -= u.gravity * u.delta * 9.8;

  if (u.turbulence > 0.001) {
    let t = u.time * 0.25;
    let np = pos * 0.007;
    vel += vec3f(vnoise(np+vec3f(t,0,0)),
                 vnoise(np+vec3f(0,t+13.7,0)),
                 vnoise(np+vec3f(0,0,t+27.4))) * u.turbulence * 18.0 * u.delta;
  }

  // Audio blast (radial impulse from the audio analysis value).
  if (u.audioBlast > 0.001) {
    let dir = select(vec3f(0,1,0), normalize(pos), length(pos) > 0.001);
    vel += dir * u.audioBlast * 14.0 * u.delta;
  }

  // N-Body gravity/repulsion over the same strided sample set as
  // the WebGL pass (u32(si) truncation == the texel the GLSL
  // texture fetch lands on).
  if (u.nBodyEnabled > 0.5) {
    var acc = vec3f(0.0);
    let stride = texSizeF / f32(u.nBodySamples);
    for (var i = 0; i < 64; i++) {
      if (i >= u.nBodySamples) { break; }
      let si = f32(i) * stride;
      let oPos = posIn[u32(si)].xyz;
      let diff = oPos - pos;
      let r2 = dot(diff, diff) + u.nBodySoftening * u.nBodySoftening;
      let r  = sqrt(r2);
      if (r > 0.001) {
        let dir2 = diff / r;
        if (r > u.nBodyRepulsion) {
          acc += dir2 / r2;
        } else {
          acc -= dir2 / r2 * 0.5;
        }
      }
    }
    vel += acc * u.nBodyStrength * u.delta * 500.0;
  }

  // Curl noise: mode 'curl' with 1 octave keeps the exact legacy
  // sampling expression; symmetry / octave / flavour variants
  // route through curlField, exactly as in the WebGL shader.
  if (u.curlEnabled > 0.5) {
    var curl: vec3f;
    if (u.curlMode == 0 && u.curlOctaves <= 1) {
      if (u.curlSymmetry == 0) {
        curl = curlNoise(pos * u.curlScale + vec3f(u.time * 0.15));
      } else {
        curl = symmetricCurl(pos * u.curlScale, vec3f(u.time * 0.15), u.curlSymmetry);
      }
    } else {
      curl = curlField(pos * u.curlScale, vec3f(u.time * 0.15));
    }
    vel += curl * u.curlStrength * 20.0 * u.delta;
  }

  // Boids over the strided sample set.
  if (u.boidsEnabled > 0.5) {
    var sepForce = vec3f(0.0);
    var aliForce = vec3f(0.0);
    var cohPos   = vec3f(0.0);
    var cohCount = 0;
    let stride = texSizeF / f32(u.nBodySamples);
    for (var i = 0; i < 64; i++) {
      if (i >= u.nBodySamples) { break; }
      let si = f32(i) * stride;
      let sIdx = u32(si);
      let sUv = (vec2f(f32(sIdx % texSizeU), f32(sIdx / texSizeU)) + 0.5) / texSizeF;
      if (length(sUv - vUv) < 1.5 / texSizeF) { continue; }
      let oPos = posIn[sIdx].xyz;
      let oVel = velIn[sIdx].xyz;
      let d = distance(pos, oPos);
      if (d < u.boidsRadius * 0.3 && d > 0.001) { sepForce -= normalize(oPos - pos) / max(d, 0.5); }
      if (d < u.boidsRadius) { aliForce += oVel; cohPos += oPos; cohCount++; }
    }
    if (cohCount > 0) {
      let inv = 1.0 / f32(cohCount);
      vel += normalize(sepForce + vec3f(0.0001)) * u.boidsSeparation * u.delta * 150.0;
      vel += normalize(aliForce * inv - vel + vec3f(0.0001)) * u.boidsAlignment * u.delta * 60.0;
      vel += normalize(cohPos * inv - pos + vec3f(0.0001)) * u.boidsCohesion * u.delta * 60.0;
    }
  }

  // Crowd steering (Phase 20 stage 2): the WGSL twin of
  // lib/steering.ts, formula for formula with the GLSL chunk
  // (desired = normalize(target - pos) * maxSpeed, arrive ramps
  // inside the slowing radius, steer = desired - vel clamped
  // to maxForce when > 0; application * strength * delta * 60).
  // Mode 3 (state) reads the attribute slot from the mirrored
  // bake at binding 13 (Phase 28, 9-5), exactly as the GLSL
  // chunk reads the head's attrData fetch: state 0 seeks the
  // target, state 1 arrives at the second target. With no
  // bake the texture is all zeros, which reads as state 0 —
  // the same result the WebGL pass gets from attrData = 0
  // while uAttrEnabled is off (a threshold of 0 flips both
  // routes to state 1 identically).
  if (u.steerEnabled > 0.5) {
    var sTarget = vec3f(u.steerTargetX, u.steerTargetY, u.steerTargetZ);
    var sMode = u.steerMode;
    if (sMode == 3) {
      let attrData = textureLoad(attrTex, vec2i(i32(idx % texSizeU), i32(idx / texSizeU)), 0);
      var slotValue = attrData.r;
      if (u.steerStateSlot == 1) { slotValue = attrData.g; }
      else if (u.steerStateSlot == 2) { slotValue = attrData.b; }
      else if (u.steerStateSlot >= 3) { slotValue = attrData.a; }
      let isState1 = slotValue >= u.steerStateThreshold;
      sTarget = select(vec3f(u.steerTargetX, u.steerTargetY, u.steerTargetZ), vec3f(u.steerTarget1X, u.steerTarget1Y, u.steerTarget1Z), isState1);
      sMode = select(0, 1, isState1);
    }
    var sApply = true;
    if (sMode == 2) {
      if (u.steerPathCount <= 0) {
        sApply = false;
      } else if (u.steerPathCount == 1) {
        sTarget = u.steerPath[0];
      } else {
        var bestDistSq = 1e30;
        var bestArc = 0.0;
        var arcBefore = 0.0;
        for (var i = 0; i < 7; i++) {
          if (i >= u.steerPathCount - 1) { break; }
          let pa = u.steerPath[i];
          let pb = u.steerPath[i + 1];
          let ab = pb - pa;
          let segLen = length(ab);
          let lenSq = dot(ab, ab);
          var pt = 0.0;
          if (lenSq > 0.0) { pt = clamp(dot(pos - pa, ab) / lenSq, 0.0, 1.0); }
          let pq = pa + ab * pt;
          let pdq = pos - pq;
          let distSq = dot(pdq, pdq);
          if (distSq < bestDistSq) { bestDistSq = distSq; bestArc = arcBefore + segLen * pt; }
          arcBefore += segLen;
        }
        let targetArc = clamp(bestArc + max(u.steerPathLookAhead, 0.0), 0.0, arcBefore);
        var walkArc = 0.0;
        for (var j = 0; j < 7; j++) {
          if (j >= u.steerPathCount - 1) { break; }
          let pa = u.steerPath[j];
          let pb = u.steerPath[j + 1];
          let segLen = length(pb - pa);
          if (targetArc <= walkArc + segLen || j == u.steerPathCount - 2) {
            var wt = 0.0;
            if (segLen > 0.0) { wt = clamp((targetArc - walkArc) / segLen, 0.0, 1.0); }
            sTarget = pa + (pb - pa) * wt;
            break;
          }
          walkArc += segLen;
        }
        if (u.steerPathRadius > 0.0 && sqrt(bestDistSq) <= u.steerPathRadius) { sApply = false; }
      }
    }
    if (sApply) {
      let toTarget = sTarget - pos;
      let sDist = length(toTarget);
      var effSpeed = u.steerMaxSpeed;
      if (sMode == 1 && u.steerSlowingRadius > 0.0 && sDist < u.steerSlowingRadius) {
        effSpeed = u.steerMaxSpeed * sDist / u.steerSlowingRadius;
      }
      var desired = vec3f(0.0);
      if (sDist > 0.0) { desired = (toTarget / sDist) * effSpeed; }
      var steerForce = desired - vel;
      if (u.steerMaxForce > 0.0) {
        let fLen = length(steerForce);
        if (fLen > u.steerMaxForce) { steerForce *= u.steerMaxForce / fLen; }
      }
      vel += steerForce * u.steerStrength * u.delta * 60.0;
    }
  }

  // Kuramoto phase synchronization: the phase lives in vel.w.
  if (u.kuramotoEnabled > 0.5) {
    let omega = (hash3(vec3f(vUv * 271.0, 3.7)).x - 0.5) * u.kuramotoSpread * 2.0;
    var sumSin = 0.0;
    let kStride = texSizeF / 64.0;
    for (var i = 0; i < 64; i++) {
      let si = f32(i) * kStride;
      let sIdx = u32(si);
      let sUv = (vec2f(f32(sIdx % texSizeU), f32(sIdx / texSizeU)) + 0.5) / texSizeF;
      if (length(sUv - vUv) < 1.5 / texSizeF) { continue; }
      let oPos = posIn[sIdx].xyz;
      let wgt = clamp(1.5 - distance(pos, oPos) / max(u.kuramotoRadius, 1.0), 0.0, 1.0);
      sumSin += wgt * sin(velIn[sIdx].w - phaseState);
    }
    let dPhase = omega + u.kuramotoCoupling * (sumSin / 64.0) * 3.0;
    phaseState = gmod(phaseState + dPhase * u.delta, 6.2831853);
  }

  // Particle Life: species-matrix forces over 64 stochastic
  // neighbours; friction is applied inside this block, exactly as
  // in the WebGL shader.
  if (u.particleLifeEnabled > 0.5) {
    let selfSpecies = plSpecies(idx, u.particleLifeSpecies);
    var plForce = vec3f(0.0);
    let plStride = texSizeF / 64.0;
    let plRadius = max(u.particleLifeRadius, 1.0);
    let plBeta = 0.3;
    for (var i = 0; i < 64; i++) {
      let si = f32(i) * plStride;
      let sIdx = u32(si);
      let sUv = (vec2f(f32(sIdx % texSizeU), f32(sIdx / texSizeU)) + 0.5) / texSizeF;
      if (length(sUv - vUv) < 1.5 / texSizeF) { continue; }
      let oPos = posIn[sIdx].xyz;
      let diff = oPos - pos;
      let d = length(diff);
      if (d < plRadius && d > 0.001) {
        let dir = diff / d;
        let r = d / plRadius;
        if (r < plBeta) {
          plForce += dir * (r / plBeta - 1.0);
        } else {
          let otherSpecies = plSpecies(sIdx, u.particleLifeSpecies);
          let a = particleLifeIn[selfSpecies * 6 + otherSpecies];
          plForce += dir * a * (1.0 - abs(2.0 * r - 1.0 - plBeta) / (1.0 - plBeta));
        }
      }
    }
    vel += plForce * u.particleLifeStrength * u.delta * 45.0;
    vel *= pow(clamp(u.particleLifeFriction, 0.0, 1.0), u.delta * 60.0);
  }

  // Strange attractors (all 12 WebGL types, verbatim force laws).
  if (u.attractorEnabled > 0.5) {
    let ap = pos / max(0.1, u.attractorScale);
    var dv = vec3f(0.0);
    if (u.attractorType == 0) { // Lorenz
      dv = vec3f(10.0*(ap.y-ap.x), ap.x*(28.0-ap.z)-ap.y, ap.x*ap.y-2.667*ap.z);
    } else if (u.attractorType == 1) { // Rossler
      dv = vec3f(-(ap.y+ap.z), ap.x+0.2*ap.y, 0.2+ap.z*(ap.x-5.7));
    } else if (u.attractorType == 3) { // Halvorsen
      dv = vec3f(-1.4*ap.x - 4.0*ap.y - 4.0*ap.z - ap.y*ap.y,
                 -1.4*ap.y - 4.0*ap.z - 4.0*ap.x - ap.z*ap.z,
                 -1.4*ap.z - 4.0*ap.x - 4.0*ap.y - ap.x*ap.x);
    } else if (u.attractorType == 4) { // Chen
      dv = vec3f(35.0*(ap.y-ap.x), -7.0*ap.x - ap.x*ap.z + 28.0*ap.y, ap.x*ap.y - 3.0*ap.z);
    } else if (u.attractorType == 5) { // Lu
      dv = vec3f(36.0*(ap.y-ap.x), -ap.x*ap.z + 20.0*ap.y, ap.x*ap.y - 3.0*ap.z);
    } else if (u.attractorType == 6) { // Aizawa
      let zb = ap.z - 0.7;
      dv = vec3f(zb*ap.x - 3.5*ap.y,
                 3.5*ap.x + zb*ap.y,
                 0.6 + 0.95*ap.z - (ap.z*ap.z*ap.z)/3.0 - (ap.x*ap.x + ap.y*ap.y)*(1.0 + 0.25*ap.z) + 0.1*ap.z*ap.x*ap.x*ap.x);
    } else if (u.attractorType == 7) { // Sprott F
      dv = vec3f(ap.y + ap.z, -ap.x + 0.5*ap.y, ap.x*ap.x - ap.z);
    } else if (u.attractorType == 8) { // Rabinovich-Fabrikant
      dv = vec3f(ap.y*(ap.z - 1.0 + ap.x*ap.x) + 0.1*ap.x,
                 ap.x*(3.0*ap.z + 1.0 - ap.x*ap.x) + 0.1*ap.y,
                 -2.0*ap.z*(0.14 + ap.x*ap.y));
    } else if (u.attractorType == 9) { // De Jong map
      let mp = vec2f(sin(1.4*ap.y) - cos(-2.3*ap.x), sin(2.4*ap.x) - cos(-2.1*ap.y));
      dv = vec3f(mp - ap.xy, -0.5*ap.z);
    } else if (u.attractorType == 10) { // Ikeda map
      let r2 = dot(ap.xy, ap.xy);
      let tt = 0.4 - 6.0/(1.0 + r2);
      let ct = cos(tt); let st = sin(tt);
      let mp = vec2f(1.0, 0.0) + 0.918 * vec2f(ap.x*ct - ap.y*st, ap.x*st + ap.y*ct);
      dv = vec3f(mp - ap.xy, -0.5*ap.z);
    } else if (u.attractorType == 11) { // Chua
      let fx = -0.714*ap.x - 0.2145*(abs(ap.x + 1.0) - abs(ap.x - 1.0));
      dv = vec3f(15.6*(ap.y - ap.x - fx), ap.x - ap.y + ap.z, -28.0*ap.y);
    } else { // Thomas (2)
      dv = vec3f(sin(ap.y)-0.208*ap.x, sin(ap.z)-0.208*ap.y, sin(ap.x)-0.208*ap.z);
    }
    vel += normalize(dv + vec3f(0.0001)) * u.attractorStrength * u.delta * 40.0;
  }

  // Strange attractor unit 2 (Phase 27, 9-6 stage 1):
  // the same 12 laws, driven by the attractor2* fields.
  if (u.attractor2Enabled > 0.5) {
    let ap = pos / max(0.1, u.attractor2Scale);
    var dv = vec3f(0.0);
    if (u.attractor2Type == 0) { // Lorenz
      dv = vec3f(10.0*(ap.y-ap.x), ap.x*(28.0-ap.z)-ap.y, ap.x*ap.y-2.667*ap.z);
    } else if (u.attractor2Type == 1) { // Rossler
      dv = vec3f(-(ap.y+ap.z), ap.x+0.2*ap.y, 0.2+ap.z*(ap.x-5.7));
    } else if (u.attractor2Type == 3) { // Halvorsen
      dv = vec3f(-1.4*ap.x - 4.0*ap.y - 4.0*ap.z - ap.y*ap.y,
                 -1.4*ap.y - 4.0*ap.z - 4.0*ap.x - ap.z*ap.z,
                 -1.4*ap.z - 4.0*ap.x - 4.0*ap.y - ap.x*ap.x);
    } else if (u.attractor2Type == 4) { // Chen
      dv = vec3f(35.0*(ap.y-ap.x), -7.0*ap.x - ap.x*ap.z + 28.0*ap.y, ap.x*ap.y - 3.0*ap.z);
    } else if (u.attractor2Type == 5) { // Lu
      dv = vec3f(36.0*(ap.y-ap.x), -ap.x*ap.z + 20.0*ap.y, ap.x*ap.y - 3.0*ap.z);
    } else if (u.attractor2Type == 6) { // Aizawa
      let zb = ap.z - 0.7;
      dv = vec3f(zb*ap.x - 3.5*ap.y,
                 3.5*ap.x + zb*ap.y,
                 0.6 + 0.95*ap.z - (ap.z*ap.z*ap.z)/3.0 - (ap.x*ap.x + ap.y*ap.y)*(1.0 + 0.25*ap.z) + 0.1*ap.z*ap.x*ap.x*ap.x);
    } else if (u.attractor2Type == 7) { // Sprott F
      dv = vec3f(ap.y + ap.z, -ap.x + 0.5*ap.y, ap.x*ap.x - ap.z);
    } else if (u.attractor2Type == 8) { // Rabinovich-Fabrikant
      dv = vec3f(ap.y*(ap.z - 1.0 + ap.x*ap.x) + 0.1*ap.x,
                 ap.x*(3.0*ap.z + 1.0 - ap.x*ap.x) + 0.1*ap.y,
                 -2.0*ap.z*(0.14 + ap.x*ap.y));
    } else if (u.attractor2Type == 9) { // De Jong map
      let mp = vec2f(sin(1.4*ap.y) - cos(-2.3*ap.x), sin(2.4*ap.x) - cos(-2.1*ap.y));
      dv = vec3f(mp - ap.xy, -0.5*ap.z);
    } else if (u.attractor2Type == 10) { // Ikeda map
      let r2 = dot(ap.xy, ap.xy);
      let tt = 0.4 - 6.0/(1.0 + r2);
      let ct = cos(tt); let st = sin(tt);
      let mp = vec2f(1.0, 0.0) + 0.918 * vec2f(ap.x*ct - ap.y*st, ap.x*st + ap.y*ct);
      dv = vec3f(mp - ap.xy, -0.5*ap.z);
    } else if (u.attractor2Type == 11) { // Chua
      let fx = -0.714*ap.x - 0.2145*(abs(ap.x + 1.0) - abs(ap.x - 1.0));
      dv = vec3f(15.6*(ap.y - ap.x - fx), ap.x - ap.y + ap.z, -28.0*ap.y);
    } else { // Thomas (2)
      dv = vec3f(sin(ap.y)-0.208*ap.x, sin(ap.z)-0.208*ap.y, sin(ap.x)-0.208*ap.z);
    }
    vel += normalize(dv + vec3f(0.0001)) * u.attractor2Strength * u.delta * 40.0;
  }

  // Lévy flight: rare heavy-tailed impulses, tick-quantised gate.
  if (u.levyEnabled > 0.5) {
    let tick = floor(u.time * u.levyRate);
    let h = hash3(vec3f(vUv * 913.7, tick * 17.31 + 4.7));
    if (h.x > 0.96) {
      let dir = h - 0.5;
      let dl = length(dir);
      if (dl > 0.01) {
        let mag = min(pow(max(h.y, 0.002), -1.2), 60.0) * u.levyStrength * 1.5;
        vel += (dir / dl) * mag;
      }
    }
  }

  // Vortex
  if (u.vortexEnabled > 0.5) {
    let axis = normalize(vec3f(sin(u.vortexTilt), cos(u.vortexTilt), 0.0));
    let tangent = cross(axis, pos);
    let tLen = length(tangent);
    if (tLen > 0.001) { vel += (tangent / tLen) * u.vortexStrength * u.delta * 80.0; }
  }

  // Wind (directional + vnoise gust)
  if (u.windEnabled > 0.5) {
    let gust = vec3f(
      vnoise(pos * 0.01 + vec3f(u.time * 0.3, 0.0, 0.0)),
      vnoise(pos * 0.01 + vec3f(1.7, u.time * 0.25, 0.0)),
      vnoise(pos * 0.01 + vec3f(0.0, 3.1, u.time * 0.2))
    ) * u.windGust;
    vel += (normalize(vec3f(u.windX, u.windY, u.windZ) + vec3f(0.0001)) * u.windStrength + gust) * u.delta * 30.0;
  }

  // Gravity well(s): count 1 is the legacy single well at the
  // origin; counts 2-4 ride a slowly rotating ring.
  if (u.wellEnabled > 0.5) {
    if (u.wellCount <= 1) {
      let toCenter = -pos;
      let d = length(toCenter) + u.wellSoftening;
      vel += (toCenter / (d * d)) * u.wellStrength * u.delta * 2000.0;
      let tangent2 = cross(normalize(toCenter + vec3f(0.001, 0.0, 0.0)), vec3f(0.0, 1.0, 0.0));
      vel += tangent2 * u.wellOrbit * u.delta * 50.0;
    } else {
      for (var wi = 0; wi < 4; wi++) {
        if (wi >= u.wellCount) { break; }
        let wa = u.time * 0.35 + f32(wi) * 6.2831853 / f32(u.wellCount);
        let wellPos = vec3f(cos(wa), 0.35 * sin(wa * 1.3), sin(wa)) * u.wellSpread;
        let toWell = wellPos - pos;
        let wd = length(toWell) + u.wellSoftening;
        vel += (toWell / (wd * wd)) * u.wellStrength * u.delta * 2000.0;
        let wellTangent = cross(normalize(toWell + vec3f(0.001, 0.0, 0.0)), vec3f(0.0, 1.0, 0.0));
        vel += wellTangent * u.wellOrbit * u.delta * 50.0;
      }
    }
  }

  // Elastic spring toward the origin
  if (u.elasticEnabled > 0.5) {
    vel -= pos * u.elasticStrength * u.delta * 2.0;
  }

  // Magnetic / Lorentz
  if (u.magneticEnabled > 0.5) {
    let B = normalize(vec3f(u.magneticBX, u.magneticBY, u.magneticBZ) + vec3f(0.0001));
    vel += cross(vel, B) * u.magneticStrength * u.delta * 0.8;
  }

  // SPH over the strided sample set.
  if (u.sphEnabled > 0.5) {
    var density = 0.0;
    var pressureForce = vec3f(0.0);
    var viscForce = vec3f(0.0);
    let h2 = u.sphRadius * u.sphRadius;
    let stride = texSizeF / f32(u.nBodySamples);
    for (var i = 0; i < 64; i++) {
      if (i >= u.nBodySamples) { break; }
      let si = f32(i) * stride;
      let sIdx = u32(si);
      let sUv = (vec2f(f32(sIdx % texSizeU), f32(sIdx / texSizeU)) + 0.5) / texSizeF;
      if (length(sUv - vUv) < 1.5 / texSizeF) { continue; }
      let oPos = posIn[sIdx].xyz;
      let oVel = velIn[sIdx].xyz;
      let r = pos - oPos;
      let r2 = dot(r, r);
      if (r2 < h2 && r2 > 0.001) {
        let q = sqrt(r2) / u.sphRadius;
        let w = max(0.0, 1.0 - q * q);
        density += w;
        let pressure = u.sphPressure * max(0.0, density - u.sphRestDensity);
        pressureForce += normalize(r + vec3f(0.0001)) * pressure * w;
        viscForce += (oVel - vel) * w * u.sphViscosity;
      }
    }
    vel += (pressureForce + viscForce) * u.delta * 15.0;
  }

  // Vector fields (all 7 WebGL types, verbatim).
  if (u.vFieldEnabled > 0.5) {
    let p = pos * u.vFieldScale;
    let pr = length(p) + 0.001;
    var f = vec3f(0.0);
    if (u.vFieldType == 0) { // dipole
      let r3 = pow(pr, 3.0);
      f = vec3f(3.0*p.x*p.y, 3.0*p.y*p.y - dot(p,p), 3.0*p.y*p.z) / r3;
    } else if (u.vFieldType == 1) { // saddle
      f = vec3f(p.x, -p.y, sin(p.z * 3.14159));
    } else if (u.vFieldType == 2) { // spiral sink
      f = vec3f(-p.x - p.z, p.x - p.y, -p.z * 0.5);
    } else if (u.vFieldType == 4) { // ABC flow
      f = vec3f(1.732*sin(p.z) + cos(p.y),
                1.414*sin(p.x) + 1.732*cos(p.z),
                sin(p.y) + 1.414*cos(p.x));
    } else if (u.vFieldType == 5) { // double gyre
      let q = p.xy * 0.5 + vec2f(1.0, 0.5);
      let at = 0.1 * sin(u.time * 0.4);
      let fx = at * q.x * q.x + (1.0 - 2.0 * at) * q.x;
      let dfx = 2.0 * at * q.x + (1.0 - 2.0 * at);
      let piA = 3.14159 * 0.35;
      f = vec3f(-piA * sin(3.14159 * fx) * cos(3.14159 * q.y),
                 piA * cos(3.14159 * fx) * sin(3.14159 * q.y) * dfx,
                 0.3 * sin(p.x * 0.8 + u.time * 0.3));
    } else if (u.vFieldType == 6) { // Worley (cellular)
      let cell = floor(p);
      var f1 = 8.0; var f2 = 8.0; var nearDir = vec3f(0.0);
      // (WGSL requires a braced body for every for loop, so the
      // GLSL braceless triple nest is spelled out with braces.)
      for (var i = -1; i <= 1; i++) {
      for (var j = -1; j <= 1; j++) {
      for (var k = -1; k <= 1; k++) {
        let g = cell + vec3f(f32(i), f32(j), f32(k));
        let fp = g + hash3(g * 1.37);
        let d = fp - p;
        let dist = dot(d, d);
        if (dist < f1) { f2 = f1; f1 = dist; nearDir = d; }
        else if (dist < f2) { f2 = dist; }
      }
      }
      }
      f = nearDir * (sqrt(f2) - sqrt(f1) + 0.05);
    } else { // source-sink (3)
      f = p / (pr * pr * pr);
    }
    vel += normalize(f + vec3f(0.0001)) * u.vFieldStrength * u.delta * 30.0;
  }

  // Spring to spawn position (initial-position buffer).
  if (u.springEnabled > 0.5) {
    let spawnPos = initPosIn[idx].xyz;
    vel += (spawnPos - pos) * u.springStrength * u.delta * 3.0;
  }

  // Morph target attraction (Phase R): the same force law as the
  // WebGL velocity shader — each particle owns one baked target
  // point (morphIn, same index layout as posIn; xyz in world units,
  // w = baked replica orbit phase in radians). The cloud orbits
  // around Y by time * orbitSpeed (+ phase * gain), and the velocity
  // is relaxed toward the velocity covering the fraction mf of the
  // remaining distance this step. morphEnabled = 0 skips the block
  // entirely, leaving the legacy step untouched.
  if (u.morphEnabled > 0.5) {
    let mTexel = morphIn[idx];
    var mTarget = mTexel.xyz;
    let mAng = u.time * u.morphOrbitSpeed + mTexel.w * u.morphReplicaPhaseGain;
    let mCos = cos(mAng);
    let mSin = sin(mAng);
    mTarget = vec3f(mTarget.x * mCos - mTarget.z * mSin,
                    mTarget.y,
                    mTarget.x * mSin + mTarget.z * mCos);
    let mf = 1.0 - exp(-u.morphStrength * u.delta * 3.0);
    let vWant = (mTarget - pos) * (mf / max(u.delta * u.speed * 60.0, 0.001));
    vel += (vWant - vel) * clamp(mf + u.delta * 6.0, 0.0, 1.0);

    // OBJ normal initial velocity (Phase O, ported in Phase X3):
    // an emission-style kick along the particle's baked sample
    // normal (companion buffer, rotated by the same orbit angle
    // as the target). The envelope runs from the last (re)bake /
    // speed-key change (morphKickStart). The WebGL shader's second
    // trigger — full strength on the age-respawn frame — fires
    // here too since Phase 15 ported the age lifecycle to the
    // position pass: a just-wrapped age (posIn.w near the restart
    // value, tested exactly as WebGL tests it) is the signal.
    // Speed 0 skips the block.
    if (u.morphObjNormalSpeed > 0.0) {
      var mNormal = morphNormalIn[idx].xyz;
      mNormal = vec3f(mNormal.x * mCos - mNormal.z * mSin,
                      mNormal.y,
                      mNormal.x * mSin + mNormal.z * mCos);
      var kickEnv = exp(-max(u.time - u.morphKickStart, 0.0) * 4.5);
      if (u.ageEnabled > 0.5 && posIn[idx].w < u.delta * 1.5) { kickEnv = 1.0; }
      if (kickEnv > 0.003) {
        vel = mix(vel, mNormal * u.morphObjNormalSpeed, clamp(kickEnv * 0.45, 0.0, 0.45));
      }
    }
  }

  // SDF collider — velocity reflection (same shapes as WebGL).
  if (u.sdfEnabled > 0.5) {
    let sc = vec3f(u.sdfX, u.sdfY, u.sdfZ);
    var sd = 0.0; var sn = vec3f(0.0);
    if (u.sdfShape == 0) {
      sd = length(pos - sc) - u.sdfSize;
      sn = normalize(pos - sc + vec3f(0.0001));
    } else if (u.sdfShape == 1) {
      let q = abs(pos - sc) - vec3f(u.sdfSize);
      sd = length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
      let dq = pos - sc; let aq = abs(dq); let dd = aq - vec3f(u.sdfSize);
      if (max(dd.x, max(dd.y, dd.z)) > 0.0) { sn = normalize(max(dd, vec3f(0.0)) * sign(dq)); }
      else if (dd.x > dd.y && dd.x > dd.z) { sn = vec3f(sign(dq.x), 0.0, 0.0); }
      else if (dd.y > dd.z) { sn = vec3f(0.0, sign(dq.y), 0.0); }
      else { sn = vec3f(0.0, 0.0, sign(dq.z)); }
    } else if (u.sdfShape == 2) {
      let lp = pos - sc; let r2 = u.sdfSize * 0.35;
      let ringD = length(lp.xz) - u.sdfSize;
      sd = length(vec2f(ringD, lp.y)) - r2;
      let lxz = length(lp.xz) + 0.001;
      sn = normalize(vec3f(lp.x / lxz * ringD, lp.y, lp.z / lxz * ringD));
    } else if (u.sdfShape == 4) {
      sd = gyroidField(pos, sc, u.sdfSize) * u.sdfSize * 0.227;
      sn = gyroidNormal(pos, sc, u.sdfSize);
    } else {
      let yc = clamp(pos.y - sc.y, -u.sdfSize, u.sdfSize);
      let dp = vec3f(pos.x - sc.x, pos.y - sc.y - yc, pos.z - sc.z);
      sd = length(dp) - u.sdfSize * 0.4;
      sn = normalize(dp + vec3f(0.0001));
    }
    if (sd < 2.0) {
      let vn = dot(vel, sn);
      if (vn < 0.0) { vel -= sn * vn * (1.0 + u.sdfBounce); }
    }
  }

  // Mouse force (modes 0-2; mode 3 = paint, handled below).
  if (u.mouseEnabled > 0.5) {
    let mousePos = vec3f(u.mousePosX, u.mousePosY, u.mousePosZ);
    let toMouse = mousePos - pos;
    let md = length(toMouse);
    if (md < u.mouseRadius && md > 0.001) {
      var falloff = (1.0 - md / u.mouseRadius);
      falloff *= falloff;
      let dir = normalize(toMouse);
      if (u.mouseMode == 0) { // attract
        vel += dir * falloff * u.mouseStrength * u.delta * 200.0;
      } else if (u.mouseMode == 1) { // repel
        vel -= dir * falloff * u.mouseStrength * u.delta * 200.0;
      } else if (u.mouseMode == 2) { // swirl
        let swirl = cross(dir, vec3f(0.0, 1.0, 0.001));
        vel += normalize(swirl) * falloff * u.mouseStrength * u.delta * 150.0;
      }
    }
  }

  // Pointer paint (B3): gated particles receive a fresh random
  // velocity; the position pass teleports them to the brush under
  // the same gate.
  if (u.mouseEnabled > 0.5 && u.mouseMode == 3) {
    let paintTick = floor(u.time * 30.0);
    let paintGate = paintHash(vUv, paintTick);
    if (paintGate < u.mousePaintRate * 0.008) {
      let paintHashDir = hash3(vec3f(vUv * 517.3, paintTick * 3.71));
      let paintSpeedMix = fract(paintGate * 91.7 + paintTick * 0.013);
      vel = normalize(paintHashDir + vec3f(0.0001)) * (6.0 + 26.0 * paintSpeedMix) * max(u.mouseStrength, 0.05);
    }
  }

  // Floor bounce (B3): the position pass clamps penetration.
  if (u.floorEnabled > 0.5 && pos.y < u.floorY + 0.5 && vel.y < 0.0) {
    vel.y = -vel.y * u.floorBounce;
    vel.x *= 0.92;
    vel.z *= 0.92;
  }

  // Fluid field coupling (Phase 25): the legacy (non-FLIP) branch
  // of the WebGL velocity pass, verbatim — the field's y component
  // drives the particle's z. The 2D FLIP branch never reaches
  // this path ('flip' still routes to WebGL in the registry);
  // in 3D mode the WebGL pass applies this same legacy coupling
  // alongside its FLIP3D block below.
  if (fu.enabled > 0.5) {
    var fieldUv = pos.xz / (u.bounceRadius * fu.scale) * 0.5 + 0.5;
    fieldUv = clamp(fieldUv, vec2f(0.001), vec2f(0.999));
    let fieldVel = fluidSample(fieldUv);
    vel.x += fieldVel.x * fu.influence * u.delta * 300.0;
    vel.z += fieldVel.y * fu.influence * u.delta * 300.0;
  }

  // FLIP 3D coupling (Phase 26): G2P transfer from the atlas
  // solver's previous step, placed where the WebGL tail puts
  // its FLIP3D block (after the legacy field and the Pyro
  // coupling — Pyro has no WGSL path, so the field block is the
  // immediate predecessor here). PIC takes the grid velocity
  // itself; FLIP takes the particle velocity plus the grid's
  // change this step (projected minus the pre-projection
  // base). The domain fade drops the transfer at the cube
  // faces, where the grid holds no liquid.
  if (f3u.couple > 0.5) {
    let cellPos = ((pos / (2.0 * f3u.halfExtent)) + 0.5) * f3u.gridN - 0.5;
    let dFade = min(cellPos, vec3f(f3u.gridN - 1.0) - cellPos);
    let fade = clamp(min(dFade.x, min(dFade.y, dFade.z)) + 0.5, 0.0, 1.0);
    if (fade > 0.0) {
      let gridVel = flipSampleVel(cellPos).xyz;
      let baseVel = flipSampleBase(cellPos).xyz;
      let picVel = gridVel * f3u.velScale;
      let flipVel = vel + (gridVel - baseVel) * f3u.velScale;
      let targetVel = mix(picVel, flipVel, f3u.blend);
      vel = mix(vel, targetVel, f3u.transfer * fade);
    }
  }

  let spd = length(vel);
  if (spd > 350.0) { vel *= 350.0 / spd; }
  vel *= (1.0 - 1.1 * u.delta);

  let dist = length(pos);
  if (dist > u.bounceRadius) {
    let n = pos / dist;
    let vn = dot(vel, n);
    if (vn > 0.0) { vel -= n * vn * (1.0 + u.bounce); }
  }
  velOut[idx] = vec4f(vel, phaseState);
}
`;

const POS_WGSL = /* wgsl */ `
struct Uniforms {
  texSize : u32,
  delta   : f32,
  speed   : f32,
  bounceRadius : f32,
  time    : f32,
  verletEnabled : f32,
  sdfEnabled : f32,
  sdfShape : i32,
  sdfX : f32,
  sdfY : f32,
  sdfZ : f32,
  sdfSize : f32,
  floorEnabled : f32,
  floorY : f32,
  mouseEnabled : f32,
  mousePosX : f32,
  mousePosY : f32,
  mousePosZ : f32,
  mouseRadius : f32,
  mouseMode : i32,
  mousePaintRate : f32,
  // Age lifecycle (Phase 15, UE5 #18): appended at the buffer's
  // tail (indices 21-29) — see stepWebGPUCompute.
  ageEnabled : f32,
  ageMax : f32,
  ageReplicaCount : f32,
  ageReplicaStep : f32,
  replicaAgeBase : f32,
  emitLightEnabled : f32,
  emitLightPosX : f32,
  emitLightPosY : f32,
  emitLightPosZ : f32,
};
@group(0) @binding(0) var<uniform>             u      : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> posOut : array<vec4f>;
@group(0) @binding(4) var<storage, read>       prevPosIn : array<vec4f>;


fn hash1(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + vec3f(33.33));
  return fract((p3.x + p3.y) * p3.z);
}

// dmHash11: the same hash the velocity shader defines and the
// WebGL passes share. paintHash below already called it, but the
// definition was missing from this module (the position pipeline
// could not compile) — restored in Phase 15.
fn dmHash11(n: f32) -> f32 {
  var p3 = fract(vec3f(n) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + vec3f(33.33));
  return fract((p3.x + p3.y) * p3.z);
}

// The WebGL position pass's hash1 (dmHash11 over the 127.1 /
// 311.7 dot) — the age respawn placement draws use it verbatim.
fn hash1Age(p: vec2f) -> f32 {
  return dmHash11(p.x * 127.1 + p.y * 311.7);
}

fn gyroidField(p: vec3f, sc: vec3f, size: f32) -> f32 {
  let q = (p - sc) * (3.14159265 / max(size, 1.0));
  return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
}
fn gyroidNormal(p: vec3f, sc: vec3f, size: f32) -> vec3f {
  let q = (p - sc) * (3.14159265 / max(size, 1.0));
  let g = vec3f(
    cos(q.x) * cos(q.y) - sin(q.z) * sin(q.x),
    cos(q.y) * cos(q.z) - sin(q.x) * sin(q.y),
    cos(q.z) * sin(q.x) - sin(q.y) * sin(q.z)
  );
  return normalize(g + vec3f(0.0001));
}

fn paintHash(uv: vec2f, tick: f32) -> f32 {
  return dmHash11(dot(uv * 913.7 + vec2f(tick * 17.31, tick * 7.77), vec2f(127.1, 311.7)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let texSizeU = u.texSize;
  if (idx >= texSizeU * texSizeU) { return; }
  let texSizeF = f32(texSizeU);
  let vUv = (vec2f(f32(idx % texSizeU), f32(idx / texSizeU)) + 0.5) / texSizeF;
  var pos = posIn[idx].xyz;
  var age = posIn[idx].w;
  let vel = velIn[idx].xyz;

  // Verlet integration (Phase X3): prevPosIn holds the frame-start
  // positions, copied in the step encoder before this pass —
  // the same state the WebGL blit pass prepares.
  if (u.verletEnabled > 0.5) {
    let prevPos = prevPosIn[idx].xyz;
    pos = pos + (pos - prevPos) * 0.98 + vel * u.delta * u.speed * 30.0;
  } else {
    pos += vel * u.delta * u.speed * 60.0;
  }

  let dist = length(pos);
  if (dist > u.bounceRadius * 1.05) { pos = normalize(pos) * u.bounceRadius * 1.05; }

  // SDF collider — position push-out (same shapes as WebGL).
  if (u.sdfEnabled > 0.5) {
    let sc = vec3f(u.sdfX, u.sdfY, u.sdfZ);
    var sd = 0.0; var sn = vec3f(0.0);
    if (u.sdfShape == 0) {
      sd = length(pos - sc) - u.sdfSize;
      sn = normalize(pos - sc + vec3f(0.0001));
    } else if (u.sdfShape == 1) {
      let q = abs(pos - sc) - vec3f(u.sdfSize);
      sd = length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
      let dq = pos - sc; let aq = abs(dq); let dd = aq - vec3f(u.sdfSize);
      if (max(dd.x, max(dd.y, dd.z)) > 0.0) { sn = normalize(max(dd, vec3f(0.0)) * sign(dq)); }
      else if (dd.x > dd.y && dd.x > dd.z) { sn = vec3f(sign(dq.x), 0.0, 0.0); }
      else if (dd.y > dd.z) { sn = vec3f(0.0, sign(dq.y), 0.0); }
      else { sn = vec3f(0.0, 0.0, sign(dq.z)); }
    } else if (u.sdfShape == 2) {
      let lp = pos - sc; let r2 = u.sdfSize * 0.35;
      let ringD = length(lp.xz) - u.sdfSize;
      sd = length(vec2f(ringD, lp.y)) - r2;
      let lxz = length(lp.xz) + 0.001;
      sn = normalize(vec3f(lp.x / lxz * ringD, lp.y, lp.z / lxz * ringD));
    } else if (u.sdfShape == 4) {
      sd = gyroidField(pos, sc, u.sdfSize) * u.sdfSize * 0.227;
      sn = gyroidNormal(pos, sc, u.sdfSize);
    } else {
      let yc = clamp(pos.y - sc.y, -u.sdfSize, u.sdfSize);
      let dp = vec3f(pos.x - sc.x, pos.y - sc.y - yc, pos.z - sc.z);
      sd = length(dp) - u.sdfSize * 0.4;
      sn = normalize(dp + vec3f(0.0001));
    }
    if (sd < 0.0) { pos -= sn * sd; }
  }

  // Floor clamp (B3): penetration resolved as
  // floorY + (floorY - y) * 0.1; the velocity pass owns the bounce.
  if (u.floorEnabled > 0.5 && pos.y < u.floorY) {
    pos.y = u.floorY + (u.floorY - pos.y) * 0.1;
  }

  // Pointer paint (B3): gated particles are re-emitted at the
  // brush position with a hash offset inside the brush disc.
  if (u.mouseEnabled > 0.5 && u.mouseMode == 3) {
    let paintTick = floor(u.time * 30.0);
    let paintGate = paintHash(vUv, paintTick);
    if (paintGate < u.mousePaintRate * 0.008) {
      let paintOffset = vec3f(
        hash1(vUv + paintTick * 0.731),
        hash1(vUv + paintTick * 1.317 + 4.7),
        hash1(vUv + paintTick * 2.113 + 9.1)
      ) - 0.5;
      pos = vec3f(u.mousePosX, u.mousePosY, u.mousePosZ) + paintOffset * u.mouseRadius * 0.7;
    }
  }

  // Age lifecycle (Phase 15, UE5 #18): advance + wrap respawn,
  // ported from the WebGL position pass — the same placement law
  // (hash ball, emit-light variant at 5% radius) and the same
  // replica restart age. The lifecycle's other entries (spawn
  // gate, kill conditions, emission curve, group kill) stay
  // WebGL-only and are declared in the capability registry, so a
  // config combining them with age still routes to WebGL.
  if (u.ageEnabled > 0.5) {
    age += u.delta;
    if (age > u.ageMax) {
      let r = u.bounceRadius * (0.05 + hash1Age(vUv + vec2f(age)) * 0.9);
      let th = hash1Age(vUv + vec2f(1.3)) * 6.2832;
      let phi = acos(2.0 * hash1Age(vUv + vec2f(2.7)) - 1.0);
      if (u.emitLightEnabled > 0.5) {
        let jr = r * 0.05;
        pos = vec3f(u.emitLightPosX, u.emitLightPosY, u.emitLightPosZ)
          + vec3f(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));
      } else {
        pos = vec3f(r * sin(phi) * cos(th), r * sin(phi) * sin(th), r * cos(phi));
      }
      // Replica restart age: idx is the texel index, the same
      // contiguous mapping the WebGL pass derives from vUv.
      var replicaIdx = 0.0;
      if (u.ageReplicaCount > 1.5) {
        replicaIdx = floor(f32(idx) * u.ageReplicaCount / max(texSizeF * texSizeF, 1.0));
      }
      age = replicaIdx * u.ageReplicaStep * u.ageMax + u.replicaAgeBase;
    }
  }
  posOut[idx] = vec4f(pos, age);
}
`;

// Fluid field advection (Phase 25): the WGSL twin of
// FLUID_ADVECT_FRAG (components/gpgpuShaderSimulationFluid.ts) —
// Semi-Lagrangian backward trace + 5-point Laplacian diffusion +
// exponential decay + optional vortex/perturbation forcing, one
// dispatch per frame over the resident 64x64 ping-pong grid.
// Sampling is manual bilinear with RepeatWrapping, matching the
// WebGL field render targets (LinearFilter + Repeat).
const FLUID_WGSL = /* wgsl */ `
struct FluidUniforms {
  delta        : f32,
  diffuse      : f32,
  decay        : f32,
  strength     : f32,
  time         : f32,
  extForce     : f32,
  influence    : f32,
  scale        : f32,
  enabled      : f32,
};

@group(0) @binding(0) var<uniform>             fu : FluidUniforms;
@group(0) @binding(1) var<storage, read>       fluidIn : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> fluidOut : array<vec4f>;

fn fluidWrap64(i: i32) -> i32 { return ((i % 64) + 64) % 64; }
fn fluidTexel(x: i32, y: i32) -> vec2f {
  return fluidIn[u32(fluidWrap64(y) * 64 + fluidWrap64(x))].xy;
}
fn fluidSample(uv: vec2f) -> vec2f {
  let p = uv * 64.0 - 0.5;
  let base = floor(p);
  let fr = p - base;
  let x0 = i32(base.x);
  let y0 = i32(base.y);
  let c00 = fluidTexel(x0, y0);
  let c10 = fluidTexel(x0 + 1, y0);
  let c01 = fluidTexel(x0, y0 + 1);
  let c11 = fluidTexel(x0 + 1, y0 + 1);
  return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 64u || gid.y >= 64u) { return; }
  let idx = gid.y * 64u + gid.x;
  let uv = (vec2f(f32(gid.x), f32(gid.y)) + 0.5) / 64.0;
  let vel = fluidIn[idx].xy;
  let ts = 1.0 / 64.0;
  // Semi-Lagrangian backward trace
  let backPos = uv - vel * fu.delta * ts * 80.0;
  let advVel = fluidSample(backPos);
  // 5-point Laplacian diffusion
  let vL = fluidSample(uv + vec2f(-ts, 0.0));
  let vR = fluidSample(uv + vec2f(ts, 0.0));
  let vB = fluidSample(uv + vec2f(0.0, -ts));
  let vT = fluidSample(uv + vec2f(0.0, ts));
  let lap = vL + vR + vB + vT - 4.0 * advVel;
  var newVel = advVel + fu.diffuse * lap;
  // Exponential decay
  newVel *= 1.0 - fu.decay * fu.delta * 60.0;
  // External forcing: rotating vortex + periodic perturbation
  if (fu.extForce > 0.5) {
    let c = uv - 0.5;
    let r = length(c) + 0.001;
    let rot = vec2f(-c.y, c.x) / (r * r + 0.1);
    newVel += rot * fu.strength * fu.delta * 2.0;
    let t = fu.time * 0.3;
    let perturb = vec2f(sin(uv.y * 6.2832 + t), cos(uv.x * 6.2832 - t)) * fu.strength * 0.3 * fu.delta;
    newVel += perturb;
  }
  fluidOut[idx] = vec4f(newVel, 0.0, 1.0);
}
`;

// FLIP 3D solver (Phase 26): the WGSL twin of the atlas-packed
// solver in components/gpgpuShaderSimulationFlip3d.ts, stepped
// by the orchestration twin in stepWebGPUCompute (the buffer
// discipline of components/gpgpuFlip3dPasses.ts, verbatim). The
// grid lives in storage buffers indexed by atlas texel — tile =
// z slice, per-cell ClampToEdge (pyroFetch semantics) — so the
// sampling is manual everywhere, the twin of the WebGL pass's
// uManualTrilinear path (mathematically the same lerps as the
// hardware path). One module, eleven entry points; each pass
// gets its own explicit bind group layout in init.
//
// P2G is the one scatter: WGSL has no float atomics and no
// additive blending, so the transfer buffer is fixed-point
// (array<atomic<i32>>, scale 2^10). Integer addition commutes,
// so the accumulation is order-independent — deterministic,
// where the WebGL blend accumulation is not. Composite / phi
// read the deposits back as value / 2^10.
const FLIP3D_FIXED_SCALE = 1024.0;
const FLIP3D_WGSL_COMMON = /* wgsl */ `
struct FlipU {
  gridN        : f32,
  atlasW       : u32,
  atlasH       : u32,
  tilesX       : u32,
  avgWeight    : f32,
  delta        : f32,
  alpha        : f32,
  sigma        : f32,
  epsilon      : f32,
  maxSpeed     : f32,
  bounceRadius : f32,
  fluidScale   : f32,
  particleCount : u32,
  pad0         : u32,
  pad1         : u32,
  pad2         : u32,
};
fn flipTexelOf(u: FlipU, cellRaw: vec3f) -> u32 {
  let c = clamp(cellRaw, vec3f(0.0), vec3f(u.gridN - 1.0));
  let z = u32(c.z);
  let tileX = z % u.tilesX;
  let tileY = z / u.tilesX;
  let tx = tileX * u32(u.gridN) + u32(c.x);
  let ty = tileY * u32(u.gridN) + u32(c.y);
  return ty * u.atlasW + tx;
}
// Per-texel kernel addressing: returns (cellX, cellY, cellZ,
// outsideFlag) for an atlas texel index. Texels whose slice
// index reaches gridN (the 96^3 layout has spare tiles) are
// outside and take each pass's documented outside value.
fn flipCellOfTexel(u: FlipU, idx: u32) -> vec4f {
  let tx = idx % u.atlasW;
  let ty = idx / u.atlasW;
  let n = u32(u.gridN);
  let tileX = tx / n;
  let cx = tx % n;
  let tileY = ty / n;
  let cy = ty % n;
  let z = tileY * u.tilesX + tileX;
  return vec4f(f32(cx), f32(cy), f32(z), select(0.0, 1.0, z >= n));
}
fn flipAtlasTexels(u: FlipU) -> u32 { return u.atlasW * u.atlasH; }
`;

const FLIP3D_SPLAT_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       posIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> transferI : array<atomic<i32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u.particleCount) { return; }
  let pos = posIn[idx].xyz;
  let vel = velIn[idx].xyz;
  let extent = u.bounceRadius * u.fluidScale;
  let g = (pos / (2.0 * extent) + 0.5) * u.gridN - 0.5;
  let base = floor(g);
  let frac = g - base;
  for (var oz = 0; oz <= 1; oz++) {
    for (var oy = 0; oy <= 1; oy++) {
      for (var ox = 0; ox <= 1; ox++) {
        let off = vec3f(f32(ox), f32(oy), f32(oz));
        let axisW = mix(1.0 - frac, frac, off);
        let w = axisW.x * axisW.y * axisW.z;
        let cell = base + off;
        if (w <= 0.0 || cell.x < 0.0 || cell.y < 0.0 || cell.z < 0.0
            || cell.x > u.gridN - 1.0 || cell.y > u.gridN - 1.0 || cell.z > u.gridN - 1.0) {
          continue;
        }
        let t = flipTexelOf(u, cell) * 4u;
        // Quantise the WEIGHT first and weight the momentum by
        // the quantised weight: the composite's momentum/weight
        // ratio is then a true weighted average of deposited
        // velocities, bounded by the fastest depositor. The
        // naive form (round(vel*w*S) beside round(w*S)) lets a
        // fast particle's momentum survive rounding in a corner
        // whose weight rounds to ~0, and the composite divides
        // it by that near-zero weight — fabricated grid
        // velocities far above any particle's, which the G2P
        // coupling then injects back (the Phase 26 gate's
        // runaway: transfer ratio 187 vs particle max 43).
        let wq = i32(round(w * ${FLIP3D_FIXED_SCALE}));
        if (wq <= 0) { continue; }
        atomicAdd(&transferI[t + 0u], i32(round(vel.x * f32(wq))));
        atomicAdd(&transferI[t + 1u], i32(round(vel.y * f32(wq))));
        atomicAdd(&transferI[t + 2u], i32(round(vel.z * f32(wq))));
        atomicAdd(&transferI[t + 3u], wq);
      }
    }
  }
}
`;

const FLIP3D_TRANSFER_READ = /* wgsl */ `
fn flipTransferAt(cell: vec3f) -> vec4f {
  let t = flipTexelOf(u, cell) * 4u;
  return vec4f(f32(atomicLoad(&transferI[t + 0u])),
               f32(atomicLoad(&transferI[t + 1u])),
               f32(atomicLoad(&transferI[t + 2u])),
               f32(atomicLoad(&transferI[t + 3u]))) / ${FLIP3D_FIXED_SCALE};
}
`;

const FLIP3D_COMPOSITE_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read_write> transferI : array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> dataOut : array<vec4f>;
${FLIP3D_TRANSFER_READ}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let tr = flipTransferAt(co.xyz);
  let w = tr.w;
  let vel = select(vec3f(0.0), tr.xyz / w, w > 1e-6);
  let cov = clamp(w / max(u.avgWeight, 1e-4), 0.0, 1.0);
  dataOut[idx] = vec4f(vel, cov);
}
`;

const FLIP3D_PHI_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read_write> transferI : array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> dataOut : array<vec4f>;
${FLIP3D_TRANSFER_READ}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(1.0, 0.0, 0.0, 1.0); return; }
  let cell = co.xyz;
  var sum = 0.0;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let w = flipTransferAt(cell + vec3f(f32(dx), f32(dy), f32(dz))).w;
        sum += clamp(w / max(u.avgWeight, 1e-4), 0.0, 1.0);
      }
    }
  }
  let chi = sum / 27.0;
  let phi = (0.5 - chi) * 2.0;
  dataOut[idx] = vec4f(phi, chi, 0.0, 1.0);
}
`;

const FLIP3D_PHI_ADVECT_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> transferI : array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> dataOut : array<vec4f>;
${FLIP3D_TRANSFER_READ}
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
fn samplePhi(p: vec3f) -> vec4f {
  let pc = clamp(p, vec3f(0.0), vec3f(u.gridN - 1.0));
  let b = floor(pc);
  let f = pc - b;
  let c000 = fetchPhi(b);
  let c100 = fetchPhi(b + vec3f(1.0, 0.0, 0.0));
  let c010 = fetchPhi(b + vec3f(0.0, 1.0, 0.0));
  let c110 = fetchPhi(b + vec3f(1.0, 1.0, 0.0));
  let c001 = fetchPhi(b + vec3f(0.0, 0.0, 1.0));
  let c101 = fetchPhi(b + vec3f(1.0, 0.0, 1.0));
  let c011 = fetchPhi(b + vec3f(0.0, 1.0, 1.0));
  let c111 = fetchPhi(b + vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(1.0, 0.0, 0.0, 1.0); return; }
  let cell = co.xyz;
  let vel = velIn[flipTexelOf(u, cell)].xyz;
  let back = cell - vel * u.delta;
  let adv = samplePhi(back).rg;
  let occ = clamp(flipTransferAt(cell).w / max(u.avgWeight, 1e-4), 0.0, 1.0);
  let chi = max(adv.y, occ);
  let phi = (0.5 - chi) * 2.0;
  dataOut[idx] = vec4f(phi, chi, 0.0, 1.0);
}
`;

const FLIP3D_VISCOSITY_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velStar : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIter : array<vec4f>;
@group(0) @binding(3) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dataOut : array<vec4f>;
fn fetchIter(cell: vec3f) -> vec4f { return velIter[flipTexelOf(u, cell)]; }
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  let iter = fetchIter(cell).xyz;
  if (fetchPhi(cell).g < 0.5) { dataOut[idx] = vec4f(iter, 1.0); return; }
  var sum = vec3f(0.0);
  sum += select(iter, fetchIter(cell + vec3f(1.0, 0.0, 0.0)).xyz, fetchPhi(cell + vec3f(1.0, 0.0, 0.0)).g >= 0.5);
  sum += select(iter, fetchIter(cell - vec3f(1.0, 0.0, 0.0)).xyz, fetchPhi(cell - vec3f(1.0, 0.0, 0.0)).g >= 0.5);
  sum += select(iter, fetchIter(cell + vec3f(0.0, 1.0, 0.0)).xyz, fetchPhi(cell + vec3f(0.0, 1.0, 0.0)).g >= 0.5);
  sum += select(iter, fetchIter(cell - vec3f(0.0, 1.0, 0.0)).xyz, fetchPhi(cell - vec3f(0.0, 1.0, 0.0)).g >= 0.5);
  sum += select(iter, fetchIter(cell + vec3f(0.0, 0.0, 1.0)).xyz, fetchPhi(cell + vec3f(0.0, 0.0, 1.0)).g >= 0.5);
  sum += select(iter, fetchIter(cell - vec3f(0.0, 0.0, 1.0)).xyz, fetchPhi(cell - vec3f(0.0, 0.0, 1.0)).g >= 0.5);
  let star = velStar[flipTexelOf(u, cell)].xyz;
  let outVel = (star + u.alpha * sum) / (1.0 + 6.0 * u.alpha);
  dataOut[idx] = vec4f(outVel, 1.0);
}
`;

const FLIP3D_SURFACE_FN = /* wgsl */ `
fn flipNormalAt(cell: vec3f) -> vec3f {
  let g = vec3f(
    fetchPhi(cell + vec3f(1.0, 0.0, 0.0)).r - fetchPhi(cell - vec3f(1.0, 0.0, 0.0)).r,
    fetchPhi(cell + vec3f(0.0, 1.0, 0.0)).r - fetchPhi(cell - vec3f(0.0, 1.0, 0.0)).r,
    fetchPhi(cell + vec3f(0.0, 0.0, 1.0)).r - fetchPhi(cell - vec3f(0.0, 0.0, 1.0)).r
  ) * 0.5;
  let len = length(g);
  return select(vec3f(0.0), g / len, len >= 1e-9);
}
fn flipCurvatureAt(cell: vec3f) -> f32 {
  let nxp = flipNormalAt(cell + vec3f(1.0, 0.0, 0.0)).x;
  let nxm = flipNormalAt(cell - vec3f(1.0, 0.0, 0.0)).x;
  let nyp = flipNormalAt(cell + vec3f(0.0, 1.0, 0.0)).y;
  let nym = flipNormalAt(cell - vec3f(0.0, 1.0, 0.0)).y;
  let nzp = flipNormalAt(cell + vec3f(0.0, 0.0, 1.0)).z;
  let nzm = flipNormalAt(cell - vec3f(0.0, 0.0, 1.0)).z;
  return (nxp - nxm) * 0.5 + (nyp - nym) * 0.5 + (nzp - nzm) * 0.5;
}
`;

const FLIP3D_CURVATURE_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dataOut : array<vec4f>;
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
${FLIP3D_SURFACE_FN}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  let phi = fetchPhi(cell).r;
  let kappa = select(flipCurvatureAt(cell), 0.0, abs(phi) > 2.0);
  dataOut[idx] = vec4f(kappa, 0.0, 0.0, 1.0);
}
`;

const FLIP3D_TENSION_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(3) var<storage, read>       curvIn : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dataOut : array<vec4f>;
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  var vel = velIn[flipTexelOf(u, cell)].xyz;
  let phiChi = fetchPhi(cell).rg;
  if (abs(phiChi.r) <= 2.0 && phiChi.g > 0.001) {
    let gradChi = vec3f(
      fetchPhi(cell + vec3f(1.0, 0.0, 0.0)).g - fetchPhi(cell - vec3f(1.0, 0.0, 0.0)).g,
      fetchPhi(cell + vec3f(0.0, 1.0, 0.0)).g - fetchPhi(cell - vec3f(0.0, 1.0, 0.0)).g,
      fetchPhi(cell + vec3f(0.0, 0.0, 1.0)).g - fetchPhi(cell - vec3f(0.0, 0.0, 1.0)).g
    ) * 0.5;
    let kappa = curvIn[flipTexelOf(u, cell)].r;
    vel += u.delta * u.sigma * kappa * gradChi;
  }
  dataOut[idx] = vec4f(vel, 1.0);
}
`;

const FLIP3D_CURL_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dataOut : array<vec4f>;
fn fetchVel(cell: vec3f) -> vec4f { return velIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  let duz_dy = (fetchVel(cell + vec3f(0.0, 1.0, 0.0)).z - fetchVel(cell - vec3f(0.0, 1.0, 0.0)).z) * 0.5;
  let duy_dz = (fetchVel(cell + vec3f(0.0, 0.0, 1.0)).y - fetchVel(cell - vec3f(0.0, 0.0, 1.0)).y) * 0.5;
  let dux_dz = (fetchVel(cell + vec3f(0.0, 0.0, 1.0)).x - fetchVel(cell - vec3f(0.0, 0.0, 1.0)).x) * 0.5;
  let duz_dx = (fetchVel(cell + vec3f(1.0, 0.0, 0.0)).z - fetchVel(cell - vec3f(1.0, 0.0, 0.0)).z) * 0.5;
  let duy_dx = (fetchVel(cell + vec3f(1.0, 0.0, 0.0)).y - fetchVel(cell - vec3f(1.0, 0.0, 0.0)).y) * 0.5;
  let dux_dy = (fetchVel(cell + vec3f(0.0, 1.0, 0.0)).x - fetchVel(cell - vec3f(0.0, 1.0, 0.0)).x) * 0.5;
  let w = vec3f(duz_dy - duy_dz, dux_dz - duz_dx, duy_dx - dux_dy);
  dataOut[idx] = vec4f(w, length(w));
}
`;

const FLIP3D_VORTICITY_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       curlIn : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> dataOut : array<vec4f>;
fn fetchCurl(cell: vec3f) -> vec4f { return curlIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  var vel = velIn[flipTexelOf(u, cell)].xyz;
  let eta = vec3f(
    fetchCurl(cell + vec3f(1.0, 0.0, 0.0)).w - fetchCurl(cell - vec3f(1.0, 0.0, 0.0)).w,
    fetchCurl(cell + vec3f(0.0, 1.0, 0.0)).w - fetchCurl(cell - vec3f(0.0, 1.0, 0.0)).w,
    fetchCurl(cell + vec3f(0.0, 0.0, 1.0)).w - fetchCurl(cell - vec3f(0.0, 0.0, 1.0)).w
  ) * 0.5;
  let etaLen = length(eta);
  if (etaLen > 1e-6) {
    let w = fetchCurl(cell).xyz;
    vel += u.epsilon * cross(eta / etaLen, w) * u.delta;
  }
  if (cell.x <= 0.0 || cell.x >= u.gridN - 1.0) { vel.x = 0.0; }
  if (cell.y <= 0.0 || cell.y >= u.gridN - 1.0) { vel.y = 0.0; }
  if (cell.z <= 0.0 || cell.z >= u.gridN - 1.0) { vel.z = 0.0; }
  dataOut[idx] = vec4f(clamp(vel, vec3f(-u.maxSpeed), vec3f(u.maxSpeed)), 1.0);
}
`;

const FLIP3D_JACOBI_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       presIn : array<vec4f>;
@group(0) @binding(3) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dataOut : array<vec4f>;
fn fetchVel(cell: vec3f) -> vec4f { return velIn[flipTexelOf(u, cell)]; }
fn fetchPres(cell: vec3f) -> vec4f { return presIn[flipTexelOf(u, cell)]; }
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  if (fetchPhi(cell).g < 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let vC = fetchVel(cell).xyz;
  let div = (vC.x - fetchVel(cell - vec3f(1.0, 0.0, 0.0)).x)
          + (vC.y - fetchVel(cell - vec3f(0.0, 1.0, 0.0)).y)
          + (vC.z - fetchVel(cell - vec3f(0.0, 0.0, 1.0)).z);
  var sum = 0.0;
  var count = 0.0;
  var nb = cell + vec3f(1.0, 0.0, 0.0);
  if (nb.x < u.gridN) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  nb = cell - vec3f(1.0, 0.0, 0.0);
  if (nb.x >= 0.0) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  nb = cell + vec3f(0.0, 1.0, 0.0);
  if (nb.y < u.gridN) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  nb = cell - vec3f(0.0, 1.0, 0.0);
  if (nb.y >= 0.0) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  nb = cell + vec3f(0.0, 0.0, 1.0);
  if (nb.z < u.gridN) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  nb = cell - vec3f(0.0, 0.0, 1.0);
  if (nb.z >= 0.0) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }
  let p = select(0.0, (sum - div) / count, count > 0.0);
  dataOut[idx] = vec4f(p, 0.0, 0.0, 1.0);
}
`;

const FLIP3D_SUBTRACT_WGSL = /* wgsl */ `
${FLIP3D_WGSL_COMMON}
@group(0) @binding(0) var<uniform>             u : FlipU;
@group(0) @binding(1) var<storage, read>       velIn : array<vec4f>;
@group(0) @binding(2) var<storage, read>       presIn : array<vec4f>;
@group(0) @binding(3) var<storage, read>       phiIn : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dataOut : array<vec4f>;
fn fetchPres(cell: vec3f) -> vec4f { return presIn[flipTexelOf(u, cell)]; }
fn fetchPhi(cell: vec3f) -> vec4f { return phiIn[flipTexelOf(u, cell)]; }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= flipAtlasTexels(u)) { return; }
  let co = flipCellOfTexel(u, idx);
  if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }
  let cell = co.xyz;
  var vel = velIn[flipTexelOf(u, cell)].xyz;
  if (fetchPhi(cell).g < 0.5) { dataOut[idx] = vec4f(vel, 1.0); return; }
  let pC = fetchPres(cell).r;
  let pX = select(0.0, fetchPres(cell + vec3f(1.0, 0.0, 0.0)).r, fetchPhi(cell + vec3f(1.0, 0.0, 0.0)).g >= 0.5);
  let pY = select(0.0, fetchPres(cell + vec3f(0.0, 1.0, 0.0)).r, fetchPhi(cell + vec3f(0.0, 1.0, 0.0)).g >= 0.5);
  let pZ = select(0.0, fetchPres(cell + vec3f(0.0, 0.0, 1.0)).r, fetchPhi(cell + vec3f(0.0, 0.0, 1.0)).g >= 0.5);
  vel -= vec3f(pX - pC, pY - pC, pZ - pC);
  dataOut[idx] = vec4f(vel, 1.0);
}
`;

export const WEBGPU_FLUID_SIZE = 64;

/** The analytic vortex the WebGL runtime seeds both fluid targets
 * with (useGpgpuRuntime.ts), as a flat RGBA field — the WebGPU
 * grid's initial state, byte-identical in value. */
export function createFluidInitialFieldData(size: number = WEBGPU_FLUID_SIZE): Float32Array {
  const data = new Float32Array(size * size * 4);
  for (let fi = 0; fi < size * size; fi++) {
    const fu = (fi % size) / size - 0.5;
    const fv = Math.floor(fi / size) / size - 0.5;
    const fr = Math.sqrt(fu * fu + fv * fv) + 0.001;
    data[fi * 4 + 0] = -fv / (fr * fr + 0.1) * 0.08;
    data[fi * 4 + 1] = fu / (fr * fr + 0.1) * 0.08;
    data[fi * 4 + 2] = 0;
    data[fi * 4 + 3] = 1;
  }
  return data;
}

export type WebGPUComputeState = {
  device: GPUDevice;
  velPipeline: GPUComputePipeline;
  posPipeline: GPUComputePipeline;
  posABuf: GPUBuffer;
  posBBuf: GPUBuffer;
  velABuf: GPUBuffer;
  velBBuf: GPUBuffer;
  /** Baked morph target cloud (Phase R), same layout as pos buffers. */
  morphBuf: GPUBuffer;
  /** Baked morph companion normals (Phase O data, bound in Phase X3). */
  morphNormalBuf: GPUBuffer;
  /** Initial (spawn) positions for the spring force (Phase X3). */
  initPosBuf: GPUBuffer;
  /** Frame-start positions for the Verlet integrator (Phase X3). */
  prevPosBuf: GPUBuffer;
  /** Particle Life 6x6 species matrix, flattened (Phase X3). */
  particleLifeBuf: GPUBuffer;
  velUBuf: GPUBuffer;
  posUBuf: GPUBuffer;
  stagingBuf: GPUBuffer;
  texSize: number;
  /** 事前確保済みuniformバッファ（毎フレームの new Float32Array を避ける） */
  velUData: Float32Array<ArrayBuffer>;
  posUData: Float32Array<ArrayBuffer>;
  /** 最後に書き込んだ Particle Life 行列（参照が変わった時だけ再送する） */
  lastParticleLifeMatrix: Float32Array | null;
  /** stagingBuf への readback mapAsync が未解決の間は true */
  readbackPending: boolean;
  /** Fluid field (Phase 25): the advection pipeline (third
   * pipeline), its uniform block, and the resident ping-pong
   * grid. The grid buffers are created lazily on the first
   * fluid-enabled step — a fluid-off state allocates none of
   * them and never dispatches the pass. */
  fluidPipeline: GPUComputePipeline;
  fluidUBuf: GPUBuffer;
  fluidUData: Float32Array<ArrayBuffer>;
  /** Placeholder bound at the velocity pass's fluid binding
   * while no grid exists (never sampled: fu.enabled is 0). */
  fluidDummyBuf: GPUBuffer;
  fluidABuf: GPUBuffer | null;
  fluidBBuf: GPUBuffer | null;
  fluidPingIsA: boolean;
  /** FLIP 3D (Phase 26): the eleven solver pipelines, the
   * shared per-pass uniform slots, the velocity coupling
   * uniform block, and the lazily created atlas grid (created
   * on the first flip3d-active step, recreated when the
   * resolved resolution changes). A flip3d-off state allocates
   * no grid buffers and never dispatches a solver pass. */
  flip3dPipelines: Flip3dPipelines;
  flipUBuf: GPUBuffer;
  flipUData: Float32Array<ArrayBuffer>;
  flipVelUBuf: GPUBuffer;
  flipVelUData: Float32Array<ArrayBuffer>;
  /** 1x1 placeholder bound at the velocity pass's FLIP texture
   * bindings while no grid exists (never loaded: couple is 0). */
  flipDummyTex: GPUTexture;
  flipGrid: Flip3dGridState | null;
  /** Named-attribute bake mirror (Phase 28, 9-5): rgba32float,
   * texSize x texSize; zeros until the first bake upload. */
  attrTexture: GPUTexture;
};

type Flip3dPipelines = {
  splat: GPUComputePipeline;
  composite: GPUComputePipeline;
  phi: GPUComputePipeline;
  phiAdvect: GPUComputePipeline;
  viscosity: GPUComputePipeline;
  curvature: GPUComputePipeline;
  tension: GPUComputePipeline;
  curl: GPUComputePipeline;
  vorticity: GPUComputePipeline;
  jacobi: GPUComputePipeline;
  subtract: GPUComputePipeline;
};

type Flip3dGridState = {
  resolution: number;
  atlasW: number;
  atlasH: number;
  tilesX: number;
  texels: number;
  velA: GPUBuffer;
  velB: GPUBuffer;
  presA: GPUBuffer;
  presB: GPUBuffer;
  transferI: GPUBuffer;
  phiA: GPUBuffer;
  phiB: GPUBuffer;
  scratch: GPUBuffer;
  curv: GPUBuffer;
  /** Viscosity's fixed star copy: the WebGL runner binds the
   * live velocity as uVelStar while alternating writes include
   * that same buffer — legal as a WebGL feedback loop, but a
   * WebGPU validation error (one buffer bound read + read_write
   * in a single dispatch, which invalidates the whole command
   * buffer; the Phase 26 gate's viscosity stage proved it).
   * The WGSL step copies velLive here once per step instead. */
  star: GPUBuffer;
  /** Previous step's projected velocity / pre-projection base
   * (the velocity coupling's sources, published at step end
   * via copyBufferToTexture — textures, not storage buffers,
   * because the velocity stage's storage-buffer budget is
   * already at the default limit of 8). */
  coupleVelTex: GPUTexture;
  coupleBaseTex: GPUTexture;
  velPingIsA: boolean;
  phiPingIsA: boolean;
  framesStepped: number;
};

// Vel uniform buffer: 98 f32 slots (see the WGSL Uniforms struct
// field order; int fields are written through an Int32Array view).
const VEL_UNIFORM_BYTES = 624;
// Pos uniform buffer: 21 f32 slots.
const POS_UNIFORM_BYTES = 128;

export async function initWebGPUCompute(
  texSize: number,
  initialPos: Float32Array,
  initialVel: Float32Array,
  morphData?: Float32Array | null,
  morphNormalData?: Float32Array | null,
): Promise<WebGPUComputeState | null> {
  if (!navigator.gpu) return null;
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
  } catch { return null; }
  const device = await adapter.requestDevice();

  const N = texSize * texSize;
  const byteSize = N * 4 * 4; // N * vec4f * 4 bytes

  const bufOpts: GPUBufferDescriptor = {
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  };
  const posABuf = device.createBuffer(bufOpts);
  const posBBuf = device.createBuffer(bufOpts);
  const velABuf = device.createBuffer(bufOpts);
  const velBBuf = device.createBuffer(bufOpts);

  device.queue.writeBuffer(posABuf, 0, initialPos.buffer as ArrayBuffer, initialPos.byteOffset, initialPos.byteLength);
  device.queue.writeBuffer(velABuf, 0, initialVel.buffer as ArrayBuffer, initialVel.byteOffset, initialVel.byteLength);

  // Morph target buffer (Phase R): always allocated (the velocity
  // bind group references it unconditionally); filled with the baked
  // cloud when one is supplied, zeros otherwise (never read while
  // morphEnabled = 0).
  const morphBuf = device.createBuffer(bufOpts);
  if (morphData && morphData.byteLength === byteSize) {
    device.queue.writeBuffer(morphBuf, 0, morphData.buffer as ArrayBuffer, morphData.byteOffset, morphData.byteLength);
  }

  // Morph companion normals (Phase O data): same allocation rule;
  // read only inside the morph block while the kick speed is > 0.
  const morphNormalBuf = device.createBuffer(bufOpts);
  if (morphNormalData && morphNormalData.byteLength === byteSize) {
    device.queue.writeBuffer(morphNormalBuf, 0, morphNormalData.buffer as ArrayBuffer, morphNormalData.byteOffset, morphNormalData.byteLength);
  }

  // Spring force source: the spawn positions are the initial
  // positions themselves (the WebGL path reads its init-position
  // texture, which holds this same data).
  const initPosBuf = device.createBuffer(bufOpts);
  device.queue.writeBuffer(initPosBuf, 0, initialPos.buffer as ArrayBuffer, initialPos.byteOffset, initialPos.byteLength);

  // Verlet previous positions: seeded with the initial positions;
  // refreshed from the frame-start positions on every step while
  // Verlet is enabled.
  const prevPosBuf = device.createBuffer(bufOpts);
  device.queue.writeBuffer(prevPosBuf, 0, initialPos.buffer as ArrayBuffer, initialPos.byteOffset, initialPos.byteLength);

  // Particle Life species matrix (36 f32): zeros until the first
  // step supplies one; read only while Particle Life is enabled.
  const particleLifeBuf = device.createBuffer({
    size: 36 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const stagingBuf = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Uniform buffers (vel 592 bytes incl. the Phase X3 force
  // fields and the Phase 20 steering set, pos 96 bytes)
  const velUBuf = device.createBuffer({ size: VEL_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const posUBuf = device.createBuffer({ size: POS_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const velModule = device.createShaderModule({ code: VEL_WGSL });
  const posModule = device.createShaderModule({ code: POS_WGSL });

  const velBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 11, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 13, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    ],
  });
  const posBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });

  const velPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [velBGL] }),
    compute: { module: velModule, entryPoint: 'main' },
  });
  const posPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [posBGL] }),
    compute: { module: posModule, entryPoint: 'main' },
  });

  // Fluid field (Phase 25): third pipeline + its uniform block.
  // The grid buffers themselves stay unallocated until the first
  // fluid-enabled step (see ensureFluidGrid).
  const fluidModule = device.createShaderModule({ code: FLUID_WGSL });
  const fluidBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const fluidPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [fluidBGL] }),
    compute: { module: fluidModule, entryPoint: 'main' },
  });
  const fluidUBuf = device.createBuffer({ size: FLUID_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const fluidUData = new Float32Array(new ArrayBuffer(FLUID_UNIFORM_BYTES));
  const fluidDummyBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // FLIP 3D (Phase 26): eleven solver pipelines over one shared
  // uniform-slot buffer. The grid buffers stay unallocated
  // until the first flip3d-active step (see ensureFlip3dGrid).
  const makeFlipPipeline = (
    code: string,
    types: Array<'uniform' | 'read-only-storage' | 'storage'>,
  ): GPUComputePipeline => {
    const layout = device.createBindGroupLayout({
      entries: types.map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    });
    return device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    });
  };
  const RO = 'read-only-storage' as const;
  const RW = 'storage' as const;
  const UN = 'uniform' as const;
  const flip3dPipelines: Flip3dPipelines = {
    splat: makeFlipPipeline(FLIP3D_SPLAT_WGSL, [UN, RO, RO, RW]),
    composite: makeFlipPipeline(FLIP3D_COMPOSITE_WGSL, [UN, RW, RW]),
    phi: makeFlipPipeline(FLIP3D_PHI_WGSL, [UN, RW, RW]),
    phiAdvect: makeFlipPipeline(FLIP3D_PHI_ADVECT_WGSL, [UN, RO, RO, RW, RW]),
    viscosity: makeFlipPipeline(FLIP3D_VISCOSITY_WGSL, [UN, RO, RO, RO, RW]),
    curvature: makeFlipPipeline(FLIP3D_CURVATURE_WGSL, [UN, RO, RW]),
    tension: makeFlipPipeline(FLIP3D_TENSION_WGSL, [UN, RO, RO, RO, RW]),
    curl: makeFlipPipeline(FLIP3D_CURL_WGSL, [UN, RO, RW]),
    vorticity: makeFlipPipeline(FLIP3D_VORTICITY_WGSL, [UN, RO, RO, RW]),
    jacobi: makeFlipPipeline(FLIP3D_JACOBI_WGSL, [UN, RO, RO, RO, RW]),
    subtract: makeFlipPipeline(FLIP3D_SUBTRACT_WGSL, [UN, RO, RO, RO, RW]),
  };
  const flipUBuf = device.createBuffer({
    size: FLIP3D_UNIFORM_STRIDE * FLIP3D_UNIFORM_SLOTS,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const flipUData = new Float32Array(new ArrayBuffer(FLIP3D_UNIFORM_STRIDE * FLIP3D_UNIFORM_SLOTS));
  const flipVelUBuf = device.createBuffer({ size: FLIP3D_VEL_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const flipVelUData = new Float32Array(new ArrayBuffer(FLIP3D_VEL_UNIFORM_BYTES));
  // Named-attribute bake mirror (Phase 28, 9-5): created
  // zero-filled at the full texSize so the velocity bind group
  // is always valid; the runtime uploads the bake through
  // updateWebGPUAttrData whenever it (re)builds.
  const attrTexture = device.createTexture({
    size: { width: texSize, height: texSize },
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: attrTexture },
    new Float32Array(texSize * texSize * 4),
    { bytesPerRow: texSize * 16, rowsPerImage: texSize },
    { width: texSize, height: texSize },
  );

  const flipDummyTex = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const velUData = new Float32Array(new ArrayBuffer(VEL_UNIFORM_BYTES));
  const posUData = new Float32Array(new ArrayBuffer(POS_UNIFORM_BYTES));

  return {
    device, velPipeline, posPipeline, posABuf, posBBuf, velABuf, velBBuf,
    morphBuf, morphNormalBuf, initPosBuf, prevPosBuf, particleLifeBuf,
    velUBuf, posUBuf, stagingBuf, texSize, velUData, posUData,
    lastParticleLifeMatrix: null, readbackPending: false,
    fluidPipeline, fluidUBuf, fluidUData, fluidDummyBuf,
    fluidABuf: null, fluidBBuf: null, fluidPingIsA: true,
    flip3dPipelines, flipUBuf, flipUData, flipVelUBuf, flipVelUData,
    flipDummyTex,
    attrTexture,
    flipGrid: null,
  };
}

// Fluid uniform buffer: 9 f32 fields (see the WGSL FluidUniforms
// struct), padded to 48 bytes.
const FLUID_UNIFORM_BYTES = 48;

// FLIP 3D uniform slot: the FlipU struct (16 slots of 4 bytes).
const FLIP3D_UNIFORM_BYTES = 64;
// Slot stride in the shared buffer: uniform binding offsets
// must satisfy minUniformBufferOffsetAlignment (256 on the
// reference Metal adapter — the Phase 26 gate's second round
// proved 64-byte strides invalid), so slots sit 256 apart.
const FLIP3D_UNIFORM_STRIDE = 256;
// Slots: 0 splat, 1 composite, 2 phi, 3 phiAdvect, 4 viscosity,
// 5 tension, 6 generic (curvature / curl / jacobi / subtract),
// 7 vorticity. Jacobi iterations share one slot (same values).
const FLIP3D_UNIFORM_SLOTS = 8;
// Velocity coupling uniform block (Flip3dUniforms, 8 f32 used).
const FLIP3D_VEL_UNIFORM_BYTES = 48;

/** Create the FLIP 3D atlas grid on first use (Phase 26) and
 * seed it zeroed — WebGPU buffers are zero-initialised, the
 * twin of the WebGL targets' zero-copy init. Recreated when
 * the resolved resolution changes (framesStepped resets, like
 * a fresh WebGL target set). */
function ensureFlip3dGrid(state: WebGPUComputeState, resolution: number): Flip3dGridState | null {
  if (state.flipGrid && state.flipGrid.resolution === resolution) return state.flipGrid;
  const layout = PYRO_GRID_LAYOUTS[resolution];
  const size = pyroGridAtlasSize(resolution);
  if (!layout || !size) return null;
  if (state.flipGrid) destroyFlip3dGrid(state.flipGrid);
  const texels = size.width * size.height;
  const opts: GPUBufferDescriptor = {
    size: texels * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  };
  const mk = () => state.device.createBuffer(opts);
  const mkTex = () => state.device.createTexture({
    size: [size.width, size.height, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  state.flipGrid = {
    resolution,
    atlasW: size.width,
    atlasH: size.height,
    tilesX: layout.cols,
    texels,
    velA: mk(), velB: mk(), presA: mk(), presB: mk(),
    transferI: mk(), phiA: mk(), phiB: mk(), scratch: mk(), curv: mk(), star: mk(),
    coupleVelTex: mkTex(), coupleBaseTex: mkTex(),
    velPingIsA: true,
    phiPingIsA: true,
    framesStepped: 0,
  };
  return state.flipGrid;
}

function destroyFlip3dGrid(grid: Flip3dGridState): void {
  grid.velA.destroy();
  grid.velB.destroy();
  grid.presA.destroy();
  grid.presB.destroy();
  grid.transferI.destroy();
  grid.phiA.destroy();
  grid.phiB.destroy();
  grid.scratch.destroy();
  grid.curv.destroy();
  grid.star.destroy();
  grid.coupleVelTex.destroy();
  grid.coupleBaseTex.destroy();
}

/** Create the resident fluid grid on first use and seed both
 * sides with the analytic vortex (Phase 25). */
function ensureFluidGrid(state: WebGPUComputeState): void {
  if (state.fluidABuf && state.fluidBBuf) return;
  const byteSize = WEBGPU_FLUID_SIZE * WEBGPU_FLUID_SIZE * 16;
  const opts: GPUBufferDescriptor = {
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  };
  state.fluidABuf = state.device.createBuffer(opts);
  state.fluidBBuf = state.device.createBuffer(opts);
  const init = createFluidInitialFieldData();
  state.device.queue.writeBuffer(state.fluidABuf, 0, init.buffer as ArrayBuffer, init.byteOffset, init.byteLength);
  state.device.queue.writeBuffer(state.fluidBBuf, 0, init.buffer as ArrayBuffer, init.byteOffset, init.byteLength);
  state.fluidPingIsA = true;
}

/** Replace the baked morph cloud of a live state (Phase R): called
 * when the morph bake is rebuilt (target / scale / seed / … change)
 * after the state was created. */
export function updateWebGPUMorphData(state: WebGPUComputeState, morphData: Float32Array): void {
  const byteSize = state.texSize * state.texSize * 16;
  if (morphData.byteLength !== byteSize) return;
  state.device.queue.writeBuffer(state.morphBuf, 0, morphData.buffer as ArrayBuffer, morphData.byteOffset, morphData.byteLength);
}

/** Replace the baked morph companion normals of a live state
 * (Phase X3): the normals are rebuilt by the same bake that
 * produces the target cloud, so the two updates travel together. */
export function updateWebGPUMorphNormalData(state: WebGPUComputeState, normalData: Float32Array): void {
  const byteSize = state.texSize * state.texSize * 16;
  if (normalData.byteLength !== byteSize) return;
  state.device.queue.writeBuffer(state.morphNormalBuf, 0, normalData.buffer as ArrayBuffer, normalData.byteOffset, normalData.byteLength);
}

/** Mirror the named-attribute bake into the velocity pass's
 * attribute texture (Phase 28, 9-5): the exact Float32Array the
 * WebGL passes bind as uAttrTex (the group-gate-adjusted copy),
 * uploaded verbatim so the WGSL steering state mode reads the
 * same slot values as the GLSL chunk. A size mismatch (stale
 * bake from a previous texSize) is ignored — the init path
 * re-uploads the current bake when the state lands. */
export function updateWebGPUAttrData(state: WebGPUComputeState, attrData: Float32Array): void {
  const byteSize = state.texSize * state.texSize * 16;
  if (attrData.byteLength !== byteSize) return;
  state.device.queue.writeTexture(
    { texture: state.attrTexture },
    attrData.buffer as ArrayBuffer,
    { bytesPerRow: state.texSize * 16, rowsPerImage: state.texSize },
    { width: state.texSize, height: state.texSize },
  );
}

/** Per-frame morph parameters for stepWebGPUCompute (Phase R;
 * the kick fields joined in Phase X3). */
export interface WebGPUMorphParams {
  enabled: boolean;
  strength: number;
  orbitSpeed: number;
  replicaPhaseGain: number;
  /** OBJ normal kick speed (Phase O); 0 skips the kick block. */
  objNormalSpeed: number;
  /** Sim time of the last morph (re)bake / kick-speed change. */
  kickStart: number;
}

/** Per-frame force parameters for stepWebGPUCompute (Phase X3):
 * a flat mirror of the WebGL velocity/position uniform set. Every
 * group is inert unless its `*Enabled` flag is set, matching the
 * WebGL branch's gating. Enum fields carry the same integer ids
 * the WebGL branch resolves from the config's string unions. */
export interface WebGPUForceParams {
  audioBlast: number;
  nBodyEnabled: boolean; nBodyStrength: number; nBodySoftening: number; nBodyRepulsion: number; nBodySamples: number;
  curlEnabled: boolean; curlStrength: number; curlScale: number; curlSymmetry: number; curlMode: number; curlOctaves: number;
  boidsEnabled: boolean; boidsSeparation: number; boidsAlignment: number; boidsCohesion: number; boidsRadius: number;
  attractorEnabled: boolean; attractorType: number; attractorStrength: number; attractorScale: number;
  attractor2Enabled: boolean; attractor2Type: number; attractor2Strength: number; attractor2Scale: number;
  levyEnabled: boolean; levyStrength: number; levyRate: number;
  kuramotoEnabled: boolean; kuramotoCoupling: number; kuramotoSpread: number; kuramotoRadius: number;
  particleLifeEnabled: boolean; particleLifeStrength: number; particleLifeRadius: number; particleLifeFriction: number; particleLifeSpecies: number;
  particleLifeMatrix: Float32Array | null;
  vortexEnabled: boolean; vortexStrength: number; vortexTilt: number;
  windEnabled: boolean; windStrength: number; windX: number; windY: number; windZ: number; windGust: number;
  wellEnabled: boolean; wellStrength: number; wellSoftening: number; wellOrbit: number; wellCount: number; wellSpread: number;
  elasticEnabled: boolean; elasticStrength: number;
  magneticEnabled: boolean; magneticStrength: number; magneticBX: number; magneticBY: number; magneticBZ: number;
  sphEnabled: boolean; sphPressure: number; sphViscosity: number; sphRadius: number; sphRestDensity: number;
  vFieldEnabled: boolean; vFieldType: number; vFieldStrength: number; vFieldScale: number;
  springEnabled: boolean; springStrength: number;
  sdfEnabled: boolean; sdfShape: number; sdfX: number; sdfY: number; sdfZ: number; sdfSize: number; sdfBounce: number;
  floorEnabled: boolean; floorY: number; floorBounce: number;
  mouseEnabled: boolean; mousePos: { x: number; y: number; z: number }; mouseStrength: number; mouseRadius: number; mouseMode: number; mousePaintRate: number;
  verletEnabled: boolean;
  // Age lifecycle (Phase 15, UE5 #18): the position-pass respawn
  // law's parameters, mirroring the WebGL uniform derivations.
  ageEnabled: boolean; ageMax: number; ageReplicaCount: number; ageReplicaStep: number; replicaAgeBase: number;
  emitLightEnabled: boolean; emitLightPos: { x: number; y: number; z: number };
  // Crowd steering (Phase 20 stage 2): structurally the
  // SteeringSeekResolved of lib/steering.ts. Phase 28 (9-5)
  // put stateSlot / stateThreshold to work: mode 3 reads the
  // mirrored attribute bake at binding 13.
  steeringSeek: WebGPUSteeringParams | null;
}

/** Per-frame fluid field parameters for stepWebGPUCompute
 * (Phase 25): the same config values the WebGL branch assigns to
 * the advection material and the velocity pass's fluid uniforms. */
export interface WebGPUFluidParams {
  enabled: boolean;
  diffuse: number;
  decay: number;
  strength: number;
  influence: number;
  scale: number;
  extForce: boolean;
}

/** Per-frame FLIP 3D parameters for stepWebGPUCompute
 * (Phase 26): the same config values the WebGL branch feeds
 * runFlip3dPasses / applyFlip3dCoupleUniforms, with the same
 * clamps applied by the caller. `active` is flip3dActive
 * (mode '3d' + flip on + fluid on); `resolution` is the shared
 * resolveFlip3dResolution result (0 while inactive). */
export interface WebGPUFlip3dParams {
  active: boolean;
  resolution: number;
  pressureIterations: number;
  viscosity: number;
  surfaceTension: number;
  vorticityEnabled: boolean;
  vorticityEpsilon: number;
  blend: number;
  transfer: number;
  bounceRadius: number;
  fluidScale: number;
  count: number;
}

/** The steering subset stepWebGPUCompute consumes (Phase 20). */
export interface WebGPUSteeringParams {
  active: boolean;
  modeId: number;
  strength: number;
  maxSpeed: number;
  maxForce: number;
  target: { x: number; y: number; z: number };
  target1: { x: number; y: number; z: number };
  slowingRadius: number;
  stateSlot: number;
  stateThreshold: number;
  path: readonly { x: number; y: number; z: number }[];
  pathPacked: Float32Array;
  pathLookAhead: number;
  pathRadius: number;
}

export function stepWebGPUCompute(
  state: WebGPUComputeState,
  pingIsA: boolean,
  delta: number,
  time: number,
  gravity: number,
  turbulence: number,
  bounceRadius: number,
  bounce: number,
  speed: number,
  morph?: WebGPUMorphParams | null,
  forces?: WebGPUForceParams | null,
  fluid?: WebGPUFluidParams | null,
  flip3d?: WebGPUFlip3dParams | null,
): void {
  const { device, velPipeline, posPipeline, posABuf, posBBuf, velABuf, velBBuf, morphBuf, morphNormalBuf, initPosBuf, prevPosBuf, particleLifeBuf, velUBuf, posUBuf, texSize } = state;
  const N = texSize * texSize;

  const posIn  = pingIsA ? posABuf : posBBuf;
  const posOut = pingIsA ? posBBuf : posABuf;
  const velIn  = pingIsA ? velABuf : velBBuf;
  const velOut = pingIsA ? velBBuf : velABuf;

  // Write vel uniforms into pre-allocated buffer (no new Float32Array per frame)
  const velU = state.velUData;
  const velI = new Int32Array(velU.buffer);
  velU[1] = delta; velU[2] = time; velU[3] = gravity;
  velU[4] = turbulence; velU[5] = bounceRadius; velU[6] = bounce; velU[7] = speed;
  velU[8] = morph && morph.enabled ? 1 : 0;
  velU[9] = morph ? morph.strength : 0;
  velU[10] = morph ? morph.orbitSpeed : 0;
  velU[11] = morph ? morph.replicaPhaseGain : 0;
  velU[12] = morph ? morph.objNormalSpeed : 0;
  velU[13] = morph ? morph.kickStart : 0;
  const f = forces;
  velU[14] = f ? f.audioBlast : 0;
  velU[15] = f && f.nBodyEnabled ? 1 : 0;
  velU[16] = f ? f.nBodyStrength : 0;
  velU[17] = f ? f.nBodySoftening : 0;
  velU[18] = f ? f.nBodyRepulsion : 0;
  velI[19] = f ? f.nBodySamples : 2;
  velU[20] = f && f.curlEnabled ? 1 : 0;
  velU[21] = f ? f.curlStrength : 0;
  velU[22] = f ? f.curlScale : 0;
  velI[23] = f ? f.curlSymmetry : 0;
  velI[24] = f ? f.curlMode : 0;
  velI[25] = f ? f.curlOctaves : 1;
  velU[26] = f && f.boidsEnabled ? 1 : 0;
  velU[27] = f ? f.boidsSeparation : 0;
  velU[28] = f ? f.boidsAlignment : 0;
  velU[29] = f ? f.boidsCohesion : 0;
  velU[30] = f ? f.boidsRadius : 0;
  velU[31] = f && f.attractorEnabled ? 1 : 0;
  velI[32] = f ? f.attractorType : 0;
  velU[33] = f ? f.attractorStrength : 0;
  velU[34] = f ? f.attractorScale : 0;
  velU[35] = f && f.levyEnabled ? 1 : 0;
  velU[36] = f ? f.levyStrength : 0;
  velU[37] = f ? f.levyRate : 0;
  velU[38] = f && f.kuramotoEnabled ? 1 : 0;
  velU[39] = f ? f.kuramotoCoupling : 0;
  velU[40] = f ? f.kuramotoSpread : 0;
  velU[41] = f ? f.kuramotoRadius : 0;
  velU[42] = f && f.particleLifeEnabled ? 1 : 0;
  velU[43] = f ? f.particleLifeStrength : 0;
  velU[44] = f ? f.particleLifeRadius : 0;
  velU[45] = f ? f.particleLifeFriction : 0;
  velI[46] = f ? f.particleLifeSpecies : 2;
  velU[47] = f && f.vortexEnabled ? 1 : 0;
  velU[48] = f ? f.vortexStrength : 0;
  velU[49] = f ? f.vortexTilt : 0;
  velU[50] = f && f.windEnabled ? 1 : 0;
  velU[51] = f ? f.windStrength : 0;
  velU[52] = f ? f.windX : 0;
  velU[53] = f ? f.windY : 0;
  velU[54] = f ? f.windZ : 0;
  velU[55] = f ? f.windGust : 0;
  velU[56] = f && f.wellEnabled ? 1 : 0;
  velU[57] = f ? f.wellStrength : 0;
  velU[58] = f ? f.wellSoftening : 0;
  velU[59] = f ? f.wellOrbit : 0;
  velI[60] = f ? f.wellCount : 1;
  velU[61] = f ? f.wellSpread : 0;
  velU[62] = f && f.elasticEnabled ? 1 : 0;
  velU[63] = f ? f.elasticStrength : 0;
  velU[64] = f && f.magneticEnabled ? 1 : 0;
  velU[65] = f ? f.magneticStrength : 0;
  velU[66] = f ? f.magneticBX : 0;
  velU[67] = f ? f.magneticBY : 0;
  velU[68] = f ? f.magneticBZ : 0;
  velU[69] = f && f.sphEnabled ? 1 : 0;
  velU[70] = f ? f.sphPressure : 0;
  velU[71] = f ? f.sphViscosity : 0;
  velU[72] = f ? f.sphRadius : 0;
  velU[73] = f ? f.sphRestDensity : 0;
  velU[74] = f && f.vFieldEnabled ? 1 : 0;
  velI[75] = f ? f.vFieldType : 3;
  velU[76] = f ? f.vFieldStrength : 0;
  velU[77] = f ? f.vFieldScale : 0;
  velU[78] = f && f.springEnabled ? 1 : 0;
  velU[79] = f ? f.springStrength : 0;
  velU[80] = f && f.sdfEnabled ? 1 : 0;
  velI[81] = f ? f.sdfShape : 0;
  velU[82] = f ? f.sdfX : 0;
  velU[83] = f ? f.sdfY : 0;
  velU[84] = f ? f.sdfZ : 0;
  velU[85] = f ? f.sdfSize : 0;
  velU[86] = f ? f.sdfBounce : 0;
  velU[87] = f && f.floorEnabled ? 1 : 0;
  velU[88] = f ? f.floorY : 0;
  velU[89] = f ? f.floorBounce : 0;
  velU[90] = f && f.mouseEnabled ? 1 : 0;
  velU[91] = f ? f.mousePos.x : 0;
  velU[92] = f ? f.mousePos.y : 0;
  velU[93] = f ? f.mousePos.z : 0;
  velU[94] = f ? f.mouseStrength : 0;
  velU[95] = f ? f.mouseRadius : 0;
  velI[96] = f ? f.mouseMode : 0;
  velU[97] = f ? f.mousePaintRate : 0;
  velU[98] = f && f.ageEnabled ? 1 : 0;
  // Crowd steering (Phase 20 stage 2): indices 99-113, path
  // points at 116 + 4 per point (vec3f stride 16 bytes).
  const st = f ? f.steeringSeek : null;
  velU[99] = st && st.active ? 1 : 0;
  velI[100] = st ? st.modeId : 0;
  velU[101] = st ? st.strength : 0;
  velU[102] = st ? st.maxSpeed : 0;
  velU[103] = st ? st.maxForce : 0;
  velU[104] = st ? st.target.x : 0;
  velU[105] = st ? st.target.y : 0;
  velU[106] = st ? st.target.z : 0;
  velU[107] = st ? st.target1.x : 0;
  velU[108] = st ? st.target1.y : 0;
  velU[109] = st ? st.target1.z : 0;
  velU[110] = st ? st.slowingRadius : 0;
  velI[111] = st ? Math.min(st.path.length, 8) : 0;
  velU[112] = st ? st.pathLookAhead : 0;
  velU[113] = st ? st.pathRadius : 0;
  velU[114] = 0; velU[115] = 0;
  for (let pi = 0; pi < 8; pi++) {
    velU[116 + pi * 4] = st ? st.pathPacked[pi * 3] : 0;
    velU[116 + pi * 4 + 1] = st ? st.pathPacked[pi * 3 + 1] : 0;
    velU[116 + pi * 4 + 2] = st ? st.pathPacked[pi * 3 + 2] : 0;
    velU[116 + pi * 4 + 3] = 0;
  }
  // Strange attractor unit 2 (Phase 27): indices 148-151,
  // appended at the end of the uniform block.
  velU[148] = f && f.attractor2Enabled ? 1 : 0;
  velI[149] = f ? f.attractor2Type : 0;
  velU[150] = f ? f.attractor2Strength : 0;
  velU[151] = f ? f.attractor2Scale : 0;
  // Steering state mode (Phase 28, 9-5): indices 152-153.
  velI[152] = st ? st.stateSlot : 0;
  velU[153] = st ? st.stateThreshold : 0.5;
  new Uint32Array(velU.buffer)[0] = texSize; // texSizeはu32なのでUint32Arrayビューで書く
  device.queue.writeBuffer(velUBuf, 0, velU);

  // Particle Life matrix: resent only when the caller hands over a
  // new array (the pass layer caches by preset/species/seed).
  if (f && f.particleLifeMatrix && f.particleLifeMatrix !== state.lastParticleLifeMatrix) {
    if (f.particleLifeMatrix.byteLength === 36 * 4) {
      device.queue.writeBuffer(particleLifeBuf, 0, f.particleLifeMatrix.buffer as ArrayBuffer, f.particleLifeMatrix.byteOffset, f.particleLifeMatrix.byteLength);
      state.lastParticleLifeMatrix = f.particleLifeMatrix;
    }
  }

  // Write pos uniforms into pre-allocated buffer
  const posU = state.posUData;
  const posI = new Int32Array(posU.buffer);
  posU[1] = delta; posU[2] = speed; posU[3] = bounceRadius; posU[4] = time;
  posU[5] = f && f.verletEnabled ? 1 : 0;
  posU[6] = f && f.sdfEnabled ? 1 : 0;
  posI[7] = f ? f.sdfShape : 0;
  posU[8] = f ? f.sdfX : 0;
  posU[9] = f ? f.sdfY : 0;
  posU[10] = f ? f.sdfZ : 0;
  posU[11] = f ? f.sdfSize : 0;
  posU[12] = f && f.floorEnabled ? 1 : 0;
  posU[13] = f ? f.floorY : 0;
  posU[14] = f && f.mouseEnabled ? 1 : 0;
  posU[15] = f ? f.mousePos.x : 0;
  posU[16] = f ? f.mousePos.y : 0;
  posU[17] = f ? f.mousePos.z : 0;
  posU[18] = f ? f.mouseRadius : 0;
  posI[19] = f ? f.mouseMode : 0;
  posU[20] = f ? f.mousePaintRate : 0;
  // Age lifecycle (Phase 15): indices 21-29, matching the fields
  // appended to the position Uniforms struct.
  posU[21] = f && f.ageEnabled ? 1 : 0;
  posU[22] = f ? f.ageMax : 0;
  posU[23] = f ? f.ageReplicaCount : 1;
  posU[24] = f ? f.ageReplicaStep : 0;
  posU[25] = f ? f.replicaAgeBase : 0;
  posU[26] = f && f.emitLightEnabled ? 1 : 0;
  posU[27] = f ? f.emitLightPos.x : 0;
  posU[28] = f ? f.emitLightPos.y : 0;
  posU[29] = f ? f.emitLightPos.z : 0;
  new Uint32Array(posU.buffer)[0] = texSize;
  device.queue.writeBuffer(posUBuf, 0, posU);

  // Fluid field (Phase 25): write the shared fluid uniform block
  // every frame (the velocity pass reads fu.enabled/influence/
  // scale from the same buffer), then — only while the field is
  // enabled — run the advection dispatch BEFORE the velocity
  // pass so the velocity pass samples this frame's field, the
  // WebGL pass order. The grid ping-pong flips here; the velocity
  // pass binds the side just written.
  const fluidU = state.fluidUData;
  const fluidOn = Boolean(fluid && fluid.enabled);
  fluidU[0] = delta;
  fluidU[1] = fluid ? fluid.diffuse : 0;
  fluidU[2] = fluid ? fluid.decay : 0;
  fluidU[3] = fluid ? fluid.strength : 0;
  fluidU[4] = time;
  fluidU[5] = fluid && fluid.extForce ? 1 : 0;
  fluidU[6] = fluid ? fluid.influence : 0;
  fluidU[7] = fluid ? fluid.scale : 0;
  fluidU[8] = fluidOn ? 1 : 0;
  device.queue.writeBuffer(state.fluidUBuf, 0, fluidU);

  const enc = device.createCommandEncoder();

  let fluidReadBuf: GPUBuffer = state.fluidDummyBuf;
  if (fluidOn) {
    ensureFluidGrid(state);
    const fIn = state.fluidPingIsA ? state.fluidABuf! : state.fluidBBuf!;
    const fOut = state.fluidPingIsA ? state.fluidBBuf! : state.fluidABuf!;
    const fluidBG = device.createBindGroup({
      layout: state.fluidPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: state.fluidUBuf } },
        { binding: 1, resource: { buffer: fIn } },
        { binding: 2, resource: { buffer: fOut } },
      ],
    });
    const fluidPass = enc.beginComputePass();
    fluidPass.setPipeline(state.fluidPipeline);
    fluidPass.setBindGroup(0, fluidBG);
    fluidPass.dispatchWorkgroups(WEBGPU_FLUID_SIZE / 8, WEBGPU_FLUID_SIZE / 8);
    fluidPass.end();
    state.fluidPingIsA = !state.fluidPingIsA;
    fluidReadBuf = fOut;
  }

  // FLIP 3D (Phase 26): the solver steps BEFORE the velocity
  // pass, from the frame-start particle buffers (posIn / velIn
  // above — the same state the WebGL runner's P2G reads), and
  // the velocity pass couples from the PREVIOUS step's pair
  // (coupleVelTex / coupleBaseTex, refreshed at the end of
  // this step) — the WebGL frame order, where runFlip3dPasses steps
  // after runSimulationPasses and applyFlip3dCoupleUniforms
  // fills from the last completed step. The step is skipped
  // entirely (no grid, no dispatch) while flip3d is inactive
  // or the clamped dt is 0, mirroring the WebGL runner.
  const f3 = flip3d;
  const f3Active = Boolean(f3 && f3.active && f3.resolution > 0);
  const f3Dt = Math.min(Math.max(delta, 0), 0.05);
  let f3Grid: Flip3dGridState | null = null;
  if (f3Active) {
    f3Grid = ensureFlip3dGrid(state, f3!.resolution);
  }
  const flipVelU = state.flipVelUData;
  {
    const halfExtent = Math.max(1e-3, (f3 ? f3.bounceRadius : 0) * (f3 ? f3.fluidScale : 0));
    const res = f3Grid ? f3Grid.resolution : 32;
    flipVelU[0] = f3Active && f3Grid && f3Grid.framesStepped > 0 ? 1 : 0;
    flipVelU[1] = f3 ? f3.blend : 0;
    flipVelU[2] = f3 ? f3.transfer : 0;
    flipVelU[3] = (2 * halfExtent / res) / 60;
    flipVelU[4] = halfExtent;
    flipVelU[5] = res;
    flipVelU[6] = f3Grid ? f3Grid.atlasW : 256;
    flipVelU[7] = f3Grid ? f3Grid.tilesX : 8;
    device.queue.writeBuffer(state.flipVelUBuf, 0, flipVelU);
  }
  let f3PendingCouple: { projected: GPUBuffer; base: GPUBuffer } | null = null;
  if (f3Active && f3Grid && f3Dt > 0) {
    const grid = f3Grid;
    const P = state.flip3dPipelines;
    const fu2 = state.flipUData;
    const fu2i = new Uint32Array(fu2.buffer);
    const avgWeight = Math.max(1, f3!.count) / (grid.resolution ** 3);
    for (let s = 0; s < FLIP3D_UNIFORM_SLOTS; s++) {
      const o = s * (FLIP3D_UNIFORM_STRIDE / 4);
      fu2[o] = grid.resolution;
      fu2i[o + 1] = grid.atlasW;
      fu2i[o + 2] = grid.atlasH;
      fu2i[o + 3] = grid.tilesX;
      fu2[o + 4] = avgWeight;
      fu2[o + 5] = f3Dt;
      fu2[o + 6] = f3!.viscosity * f3Dt;
      fu2[o + 7] = f3!.surfaceTension;
      fu2[o + 8] = f3!.vorticityEpsilon;
      fu2[o + 9] = 4.0 * grid.resolution;
      fu2[o + 10] = f3!.bounceRadius;
      fu2[o + 11] = f3!.fluidScale;
      fu2i[o + 12] = N;
      fu2i[o + 13] = 0;
      fu2i[o + 14] = 0;
      fu2i[o + 15] = 0;
    }
    device.queue.writeBuffer(state.flipUBuf, 0, fu2);

    const gridPass = (pipeline: GPUComputePipeline, slot: number, bufs: GPUBuffer[], workgroups: number) => {
      const bg = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: state.flipUBuf, offset: slot * FLIP3D_UNIFORM_STRIDE, size: FLIP3D_UNIFORM_BYTES } },
          ...bufs.map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
        ],
      });
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    };
    const texelGroups = Math.ceil(grid.texels / 256);

    // 0. Clears (FLIP rule: transfer and pressure restart at 0).
    enc.clearBuffer(grid.transferI);
    enc.clearBuffer(grid.presA);
    enc.clearBuffer(grid.presB);

    // 1. P2G splat (fixed-point scatter, see FLIP3D_SPLAT_WGSL).
    gridPass(P.splat, 0, [posIn, velIn, grid.transferI], Math.ceil(N / 64));

    // 2. Composite into the free velocity buffer.
    const velCur = grid.velPingIsA ? grid.velA : grid.velB;
    const velFree = grid.velPingIsA ? grid.velB : grid.velA;
    gridPass(P.composite, 1, [grid.transferI, velFree], texelGroups);
    let velLive: GPUBuffer = velFree;
    let velSpare: GPUBuffer = velCur;

    // 3. Phi build into the free phi buffer, advect into the
    // other, which becomes the step's phi.
    const phiFree = grid.phiPingIsA ? grid.phiB : grid.phiA;
    const phiOther = grid.phiPingIsA ? grid.phiA : grid.phiB;
    gridPass(P.phi, 2, [grid.transferI, phiFree], texelGroups);
    gridPass(P.phiAdvect, 3, [phiFree, velLive, grid.transferI, phiOther], texelGroups);
    grid.phiPingIsA = phiOther === grid.phiA;
    const phiBuf = phiOther;

    // 4. Viscosity (fixed 4 Jacobi iterations — an even count,
    // so the result lands back in the live buffer).
    if (f3!.viscosity > 0) {
      // The star term is the fixed pre-viscosity velocity; it
      // rides in its own buffer so no dispatch binds one buffer
      // as both read and read_write (see Flip3dGridState.star).
      enc.copyBufferToBuffer(velLive, 0, grid.star, 0, grid.texels * 16);
      let iter: GPUBuffer = velLive;
      let write: GPUBuffer = grid.scratch;
      for (let i = 0; i < FLIP3D_VISCOSITY_ITERATIONS; i++) {
        gridPass(P.viscosity, 4, [grid.star, iter, phiBuf, write], texelGroups);
        const swap = iter; iter = write; write = swap;
      }
      velLive = iter;
      velSpare = velLive === grid.scratch ? velSpare : grid.scratch;
    }

    // 5. Surface tension (CSF): curvature baked from phi, then
    // the force applied into the scratch, which becomes live.
    if (f3!.surfaceTension > 0) {
      gridPass(P.curvature, 6, [phiBuf, grid.curv], texelGroups);
      gridPass(P.tension, 5, [velLive, phiBuf, grid.curv, grid.scratch], texelGroups);
      velSpare = velLive;
      velLive = grid.scratch;
    }

    // 6. Vorticity confinement (the DL keys, 3D form).
    const vorticityActive = Boolean(f3!.vorticityEnabled && f3!.vorticityEpsilon > 0);
    if (vorticityActive) {
      gridPass(P.curl, 6, [velLive, grid.curv], texelGroups);
      const written = grid.scratch === velLive ? velSpare : grid.scratch;
      gridPass(P.vorticity, 7, [velLive, grid.curv, written], texelGroups);
      velSpare = velLive;
      velLive = written;
    }

    // The pre-projection velocity (the coupling's FLIP base).
    const baseVelBuf = velLive;

    // 7. Pressure projection: Jacobi ping-pong from the cleared
    // pair, divergence recomputed from the fixed live velocity.
    const iterations = Math.max(0, Math.min(32, Math.round(f3!.pressureIterations)));
    let presIn: GPUBuffer = grid.presA;
    let presOut: GPUBuffer = grid.presB;
    for (let i = 0; i < iterations; i++) {
      gridPass(P.jacobi, 6, [velLive, presIn, phiBuf, presOut], texelGroups);
      const swap = presIn; presIn = presOut; presOut = swap;
    }

    // 8. Gradient subtraction into a velocity buffer that is
    // not the live one.
    const projected: GPUBuffer = velLive === grid.velA ? grid.velB : grid.velA;
    gridPass(P.subtract, 6, [velLive, presIn, phiBuf, projected], texelGroups);
    grid.velPingIsA = projected === grid.velA;
    grid.framesStepped += 1;
    setFlip3dRuntimeStatus({
      active: true,
      resolution: grid.resolution,
      passesPerStep: flip3dPassCount({
        pressureIterations: iterations,
        viscosity: f3!.viscosity,
        surfaceTension: f3!.surfaceTension,
        vorticity: vorticityActive,
      }),
      framesStepped: grid.framesStepped,
    });
    f3PendingCouple = { projected, base: baseVelBuf };
  }

  // Velocity pass
  const velBG = device.createBindGroup({
    layout: velPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: velUBuf } },
      { binding: 1, resource: { buffer: posIn } },
      { binding: 2, resource: { buffer: velIn } },
      { binding: 3, resource: { buffer: velOut } },
      { binding: 4, resource: { buffer: morphBuf } },
      { binding: 5, resource: { buffer: morphNormalBuf } },
      { binding: 6, resource: { buffer: initPosBuf } },
      { binding: 7, resource: { buffer: particleLifeBuf } },
      { binding: 8, resource: { buffer: fluidReadBuf } },
      { binding: 9, resource: { buffer: state.fluidUBuf } },
      { binding: 10, resource: (f3Grid ? f3Grid.coupleVelTex : state.flipDummyTex).createView() },
      { binding: 11, resource: (f3Grid ? f3Grid.coupleBaseTex : state.flipDummyTex).createView() },
      { binding: 12, resource: { buffer: state.flipVelUBuf } },
      { binding: 13, resource: state.attrTexture.createView() },
    ],
  });
  const velPass = enc.beginComputePass();
  velPass.setPipeline(velPipeline);
  velPass.setBindGroup(0, velBG);
  velPass.dispatchWorkgroups(Math.ceil(N / 64));
  velPass.end();

  // Verlet: snapshot the frame-start positions (the state the
  // WebGL blit pass prepares from posIn before the step).
  if (f && f.verletEnabled) {
    enc.copyBufferToBuffer(posIn, 0, prevPosBuf, 0, N * 16);
  }

  // Position pass
  const posBG = device.createBindGroup({
    layout: posPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posUBuf } },
      { binding: 1, resource: { buffer: posIn } },
      { binding: 2, resource: { buffer: velOut } },
      { binding: 3, resource: { buffer: posOut } },
      { binding: 4, resource: { buffer: prevPosBuf } },
    ],
  });
  const posPass = enc.beginComputePass();
  posPass.setPipeline(posPipeline);
  posPass.setBindGroup(0, posBG);
  posPass.dispatchWorkgroups(Math.ceil(N / 64));
  posPass.end();

  // FLIP 3D (Phase 26): publish this step's projected / base
  // pair into the coupling textures — after the velocity pass
  // above has consumed the previous step's pair, so the copies
  // land for the NEXT step, the WebGL one-step-behind order.
  // bytesPerRow is atlasW * 16, a multiple of 256 for every
  // layout (atlasW 256 / 384 / 512 / 960).
  if (f3PendingCouple && f3Grid) {
    const srcLayout = { bytesPerRow: f3Grid.atlasW * 16, rowsPerImage: f3Grid.atlasH };
    enc.copyBufferToTexture(
      { buffer: f3PendingCouple.projected, ...srcLayout },
      { texture: f3Grid.coupleVelTex },
      [f3Grid.atlasW, f3Grid.atlasH, 1],
    );
    enc.copyBufferToTexture(
      { buffer: f3PendingCouple.base, ...srcLayout },
      { texture: f3Grid.coupleBaseTex },
      [f3Grid.atlasW, f3Grid.atlasH, 1],
    );
  }

  // Copy posOut to staging for readback
  // mapAsync が未解決 / mapped の間は stagingBuf を触らない
  if (!state.readbackPending && state.stagingBuf.mapState === 'unmapped') {
    enc.copyBufferToBuffer(posOut, 0, state.stagingBuf, 0, N * 16);
  }
  device.queue.submit([enc.finish()]);
}

/** Async readback of position data. Returns Float32Array (RGBA per particle).
 *  lastResult: 前フレームのデータ。mapAsyncがタイムアウトした場合に返すフォールバック。
 */
export async function readbackWebGPUPositions(
  state: WebGPUComputeState,
  lastResult?: Float32Array,
): Promise<Float32Array> {
  const N = state.texSize * state.texSize;
  const TIMEOUT_MS = 100;
  const fallback = lastResult ?? new Float32Array(N * 4);

  if (state.readbackPending || state.stagingBuf.mapState !== 'unmapped') {
    return fallback;
  }

  state.readbackPending = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const mapPromise = state.stagingBuf.mapAsync(GPUMapMode.READ, 0, N * 16)
    .then(() => {
      if (timedOut) {
        if (state.stagingBuf.mapState === 'mapped') {
          state.stagingBuf.unmap();
        }
        return fallback;
      }

      const range = state.stagingBuf.getMappedRange(0, N * 16);
      const result = new Float32Array(range.slice(0));
      state.stagingBuf.unmap();
      return result;
    })
    .catch(() => fallback)
    .finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      state.readbackPending = false;
    });

  const timeoutPromise = new Promise<Float32Array>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, TIMEOUT_MS);
  });

  return Promise.race([mapPromise, timeoutPromise]);
}

export function destroyWebGPUCompute(state: WebGPUComputeState): void {
  state.posABuf.destroy();
  state.posBBuf.destroy();
  state.velABuf.destroy();
  state.velBBuf.destroy();
  state.morphBuf.destroy();
  state.morphNormalBuf.destroy();
  state.initPosBuf.destroy();
  state.prevPosBuf.destroy();
  state.particleLifeBuf.destroy();
  state.velUBuf.destroy();
  state.posUBuf.destroy();
  state.stagingBuf.destroy();
  state.fluidUBuf.destroy();
  state.fluidDummyBuf.destroy();
  state.fluidABuf?.destroy();
  state.fluidBBuf?.destroy();
  state.flipUBuf.destroy();
  state.flipVelUBuf.destroy();
  state.flipDummyTex.destroy();
  state.attrTexture.destroy();
  if (state.flipGrid) destroyFlip3dGrid(state.flipGrid);
}
