// Shared point-sprite shape masks (Kinetix integration B1b).
//
// One shape set, two hosts: the layer point fragment shader
// (sceneShaderParticlePointFragment.ts, via its sdfShape framework) and
// the GPGPU points draw fragment (gpgpuShaderPoints.ts, via
// gpgpuPointShape). The masks are reimplementations of the Kinetix
// Particle Studio sprite formulas (same constructions and constants,
// re-derived in this codebase's conventions) — Kinetix's CPU engine
// code itself is not copied.
//
// Shape kind ids (the `kind` argument):
//   0 soft glow disc   1 sphere (filled disc)   2 ring    3 star
//   4 hexagon          5 diamond                6 flare   7 cloud
//   8 bokeh            9 crosshair             10 iris   11 lightning
//
// `q` is the point-local coordinate in [-1, 1] x [-1, 1] (y up),
// `seed` is a per-particle value in [0, 1) used for the slow rotation
// and the cloud / lightning variation Kinetix drives from its
// per-particle angle / seed attributes. Returns an alpha multiplier
// (values may exceed 1 slightly where Kinetix adds a hot core; hosts
// clamp when compositing).
export const PARTICLE_SHAPE_GLSL = /* glsl */ `
  vec2 pshapeRotate(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  float pshapeSdHexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float pshapeSdDiamond(vec2 p, float r) {
    p = abs(p);
    return (p.x * 1.35 + p.y * 0.85) - r;
  }
  float pshapeSdStar(vec2 p, float r) {
    float angle = atan(p.y, p.x) - 1.5707963;
    float slice = 6.28318530718 / 5.0;
    float a = mod(angle, slice) - slice * 0.5;
    float d = length(p);
    float x = cos(a) * d - r;
    float y = abs(sin(a) * d) - r * 0.4;
    return max(x, y) * 0.85;
  }
  float particleShapeMask(int kind, vec2 q, float seed) {
    float r = length(q);
    float ang = seed * 6.28318530718;
    if (kind == 1) {
      // sphere: filled disc with a soft rim (the layer host keeps its
      // own pseudo-3D lit sphere for sdfShape 'sphere'; this mask is
      // the flat GPGPU-host variant)
      if (r > 1.0) return 0.0;
      return (1.0 - smoothstep(0.82, 0.99, r)) + exp(-r * r * 10.0) * 0.25;
    }
    if (kind == 2) {
      // ring
      if (r > 1.0) return 0.0;
      float ringD = abs(r - 0.66);
      return exp(-ringD * ringD * 65.0) * (1.0 - smoothstep(0.85, 1.0, r))
           + exp(-ringD * ringD * 140.0) * 0.55;
    }
    if (kind == 3) {
      // star (5-pointed, slowly rotated per particle)
      vec2 rp = pshapeRotate(q, ang);
      float d = pshapeSdStar(rp, 0.76);
      if (d > 0.14) return 0.0;
      float fill = 1.0 - smoothstep(-0.04, 0.10, d);
      float edge = smoothstep(-0.18, -0.02, d) * (1.0 - smoothstep(-0.02, 0.08, d));
      return fill * 0.6 + edge * 0.85;
    }
    if (kind == 4) {
      // hexagon
      vec2 rp = pshapeRotate(q, ang);
      float d = pshapeSdHexagon(rp, 0.66);
      if (d > 0.14) return 0.0;
      float fill = 1.0 - smoothstep(-0.04, 0.10, d);
      float edge = smoothstep(-0.18, -0.02, d) * (1.0 - smoothstep(-0.02, 0.08, d));
      return fill * 0.55 + edge * 0.85 + edge * 0.3;
    }
    if (kind == 5) {
      // diamond (tall L1-metric gem with a bright facet band)
      vec2 rp = pshapeRotate(q, ang);
      float d = pshapeSdDiamond(rp, 0.72);
      if (d > 0.14) return 0.0;
      float fill = 1.0 - smoothstep(-0.04, 0.10, d);
      float facet = smoothstep(-0.22, -0.02, d) * (1.0 - smoothstep(-0.02, 0.08, d));
      return fill * 0.5 + facet * 0.9 + facet * 0.45;
    }
    if (kind == 6) {
      // flare: anamorphic horizontal streak + hot core
      if (r > 1.0) return 0.0;
      float streakH = exp(-abs(q.y) * 15.0) * exp(-abs(q.x) * 1.9);
      float coreOrb = exp(-r * r * 11.0);
      return clamp(coreOrb * 0.8 + streakH * 0.95, 0.0, 1.3) * (1.0 - smoothstep(0.82, 1.0, r))
           + exp(-r * r * 26.0) * 0.85;
    }
    if (kind == 7) {
      // cloud: noise-modulated soft puff (no hot core)
      if (r > 1.0) return 0.0;
      vec2 rp = pshapeRotate(q, ang * 0.4);
      float n = sin(rp.x * 4.3 + seed * 12.0) * cos(rp.y * 4.7 - seed * 7.0) * 0.25 + 0.75;
      float puff = exp(-r * r * 2.6) * (1.0 - smoothstep(0.55, 1.0, r));
      return puff * n;
    }
    if (kind == 8) {
      // bokeh: translucent filled disc with a brighter rim
      if (r > 1.0) return 0.0;
      float disk = 1.0 - smoothstep(0.78, 0.96, r);
      float rim = smoothstep(0.45, 0.84, r) * (1.0 - smoothstep(0.84, 0.98, r));
      return disk * 0.35 + rim * 0.95 + rim * 0.25;
    }
    if (kind == 9) {
      // crosshair: reticle ring + ticks + centre dot
      if (r > 1.0) return 0.0;
      vec2 rp = pshapeRotate(q, ang * 0.25);
      float ring = exp(-pow((r - 0.68) * 14.0, 2.0));
      float tickH = exp(-abs(rp.y) * 28.0) * smoothstep(0.32, 0.42, abs(rp.x)) * (1.0 - smoothstep(0.84, 0.96, abs(rp.x)));
      float tickV = exp(-abs(rp.x) * 28.0) * smoothstep(0.32, 0.42, abs(rp.y)) * (1.0 - smoothstep(0.84, 0.96, abs(rp.y)));
      float dotC = exp(-r * r * 48.0);
      return clamp(ring * 0.85 + tickH + tickV + dotC * 0.9, 0.0, 1.2) * (1.0 - smoothstep(0.9, 1.0, r))
           + dotC * 0.7;
    }
    if (kind == 10) {
      // iris: 7-blade aperture
      if (r > 1.0) return 0.0;
      vec2 rp = pshapeRotate(q, ang * 0.6);
      float a = atan(rp.y, rp.x);
      float sector = 6.28318530718 / 7.0;
      float dPoly = cos(floor(0.5 + a / sector) * sector - a) * r;
      float outer = 1.0 - smoothstep(0.68, 0.78, dPoly);
      float inner = smoothstep(0.28, 0.36, dPoly);
      float blades = sin(a * 7.0 + r * 4.5) * 0.14 + 0.86;
      return outer * inner * blades + (1.0 - smoothstep(0.34, 0.48, dPoly)) * inner * 0.55;
    }
    if (kind == 11) {
      // lightning: two sinusoidal plasma filaments + core
      if (r > 1.0) return 0.0;
      vec2 rp = pshapeRotate(q, ang);
      float bolt1 = abs(rp.y - sin(rp.x * 11.0 + seed * 25.0) * 0.18 - sin(rp.x * 23.0) * 0.06);
      float bolt2 = abs(rp.x - sin(rp.y * 13.0 + seed * 19.0) * 0.16);
      float arc = exp(-min(bolt1, bolt2) * 18.0) * (1.0 - smoothstep(0.55, 1.0, r));
      float core = exp(-r * r * 12.0) * 0.65;
      return clamp(arc + core, 0.0, 1.3) + exp(-min(bolt1, bolt2) * 32.0) * 0.9;
    }
    // kind == 0: soft glow disc
    if (r > 1.0) return 0.0;
    return exp(-r * r * 3.8) * (1.0 - smoothstep(0.7, 1.0, r)) + exp(-r * r * 14.0) * 0.65;
  }
`;
