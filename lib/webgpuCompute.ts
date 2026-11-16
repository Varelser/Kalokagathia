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
// configs that use none of them. Still WebGL-only (declared
// unsupported by the capability registry, which routes those
// configs to WebGL): the age lifecycle (respawn machinery lives
// in the WebGL position pass), the fluid field (its solver is a
// WebGL FBO pass), and user GLSL custom forces (WGSL cannot
// compile GLSL).

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
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velOut : array<vec4f>;
@group(0) @binding(4) var<storage, read>       morphIn : array<vec4f>;
@group(0) @binding(5) var<storage, read>       morphNormalIn : array<vec4f>;
@group(0) @binding(6) var<storage, read>       initPosIn : array<vec4f>;
@group(0) @binding(7) var<storage, read>       particleLifeIn : array<f32, 36>;

fn hash3(p: vec3f) -> vec3f {
  var q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
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
  return fract(sin(dot(uv * 913.7 + vec2f(tick * 17.31, tick * 7.77), vec2f(12.9898, 78.233))) * 43758.5453);
}

// Particle Life species: fixed per particle from the texel index.
fn plHash(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
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
    // trigger — full strength on the age-respawn frame — cannot
    // fire here because the age lifecycle itself stays WebGL-only
    // (the registry declares 'age' unsupported, so age-enabled
    // configs never reach this path); with age off, the WebGL
    // semantics are exactly this envelope. Speed 0 skips the block.
    if (u.morphObjNormalSpeed > 0.0) {
      var mNormal = morphNormalIn[idx].xyz;
      mNormal = vec3f(mNormal.x * mCos - mNormal.z * mSin,
                      mNormal.y,
                      mNormal.x * mSin + mNormal.z * mCos);
      let kickEnv = exp(-max(u.time - u.morphKickStart, 0.0) * 4.5);
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
};
@group(0) @binding(0) var<uniform>             u      : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> posOut : array<vec4f>;
@group(0) @binding(4) var<storage, read>       prevPosIn : array<vec4f>;

fn hash1(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

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
  return fract(sin(dot(uv * 913.7 + vec2f(tick * 17.31, tick * 7.77), vec2f(12.9898, 78.233))) * 43758.5453);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  let texSizeU = u.texSize;
  if (idx >= texSizeU * texSizeU) { return; }
  let texSizeF = f32(texSizeU);
  let vUv = (vec2f(f32(idx % texSizeU), f32(idx / texSizeU)) + 0.5) / texSizeF;
  var pos = posIn[idx].xyz;
  let age = posIn[idx].w;
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

  // The age in .w is carried through untouched: the age lifecycle
  // (advance + respawn) stays WebGL-only in Phase X3 (the registry
  // declares 'age' unsupported, so age-enabled configs route to
  // WebGL and never reach this pass).
  posOut[idx] = vec4f(pos, age);
}
`;

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
};

// Vel uniform buffer: 98 f32 slots (see the WGSL Uniforms struct
// field order; int fields are written through an Int32Array view).
const VEL_UNIFORM_BYTES = 400;
// Pos uniform buffer: 21 f32 slots.
const POS_UNIFORM_BYTES = 96;

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

  // Uniform buffers (vel 400 bytes incl. the Phase X3 force fields,
  // pos 96 bytes)
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

  const velUData = new Float32Array(new ArrayBuffer(VEL_UNIFORM_BYTES));
  const posUData = new Float32Array(new ArrayBuffer(POS_UNIFORM_BYTES));

  return {
    device, velPipeline, posPipeline, posABuf, posBBuf, velABuf, velBBuf,
    morphBuf, morphNormalBuf, initPosBuf, prevPosBuf, particleLifeBuf,
    velUBuf, posUBuf, stagingBuf, texSize, velUData, posUData,
    lastParticleLifeMatrix: null, readbackPending: false,
  };
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
  new Uint32Array(posU.buffer)[0] = texSize;
  device.queue.writeBuffer(posUBuf, 0, posU);

  const enc = device.createCommandEncoder();

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
}
