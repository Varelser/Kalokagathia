// ── Velocity sim fragment (+ N-body) ──
export const SIM_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uGravity;
  uniform float uTurbulence;
  uniform float uBounceRadius;
  uniform float uBounce;
  uniform float uAudioBlast;
  uniform bool  uNBodyEnabled;
  uniform float uNBodyStrength;
  uniform float uNBodySoftening;
  uniform float uNBodyRepulsion;
  uniform int   uNBodySamples;
  uniform float uTexSizeF;
  uniform bool  uCurlEnabled;
  uniform float uCurlStrength;
  uniform float uCurlScale;
  uniform bool  uBoidsEnabled;
  uniform float uBoidsSeparation;
  uniform float uBoidsAlignment;
  uniform float uBoidsCohesion;
  uniform float uBoidsRadius;
  uniform bool  uAttractorEnabled;
  uniform int   uAttractorType;
  uniform float uAttractorStrength;
  uniform float uAttractorScale;
  uniform bool  uLevyEnabled;
  uniform float uLevyStrength;
  uniform float uLevyRate;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoCoupling;
  uniform float uKuramotoSpread;
  uniform float uKuramotoRadius;
  uniform bool  uParticleLifeEnabled;
  uniform float uParticleLifeStrength;
  uniform float uParticleLifeRadius;
  uniform float uParticleLifeFriction;
  uniform int   uParticleLifeSpecies;
  uniform float uParticleLifeMatrix[36];
  uniform bool  uVortexEnabled;
  uniform float uVortexStrength;
  uniform float uVortexTilt;
  uniform bool  uWindEnabled;
  uniform float uWindStrength;
  uniform float uWindX;
  uniform float uWindY;
  uniform float uWindZ;
  uniform float uWindGust;
  uniform bool  uWellEnabled;
  uniform float uWellStrength;
  uniform float uWellSoftening;
  uniform float uWellOrbit;
  uniform bool  uElasticEnabled;
  uniform float uElasticStrength;
  uniform bool  uMagneticEnabled;
  uniform float uMagneticStrength;
  uniform float uMagneticBX;
  uniform float uMagneticBY;
  uniform float uMagneticBZ;
  uniform bool  uSphEnabled;
  uniform float uSphPressure;
  uniform float uSphViscosity;
  uniform float uSphRadius;
  uniform float uSphRestDensity;
  uniform bool  uVFieldEnabled;
  uniform int   uVFieldType;
  uniform float uVFieldStrength;
  uniform float uVFieldScale;
  uniform bool  uSpringEnabled;
  uniform float uSpringStrength;
  uniform sampler2D uInitPosTex;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  uniform float uSdfBounce;
  uniform bool  uMouseEnabled;
  uniform vec3  uMousePos;
  uniform float uMouseStrength;
  uniform float uMouseRadius;
  uniform int   uMouseMode;
  uniform bool  uFluidEnabled;
  uniform sampler2D uFluidTex;
  uniform float uFluidInfluence;
  uniform float uFluidScale;
  varying vec2 vUv;

  vec3 hash3(vec3 p) {
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
  }

  // Divergence-free curl noise (12 noise evals)
  vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    vec3 p1 = p + vec3(31.416, 0.0, 0.0);
    vec3 p2 = p + vec3(0.0, 43.982, 0.0);
    float dFz_dy = vnoise(p2 + vec3(0,e,0)) - vnoise(p2 - vec3(0,e,0));
    float dFy_dz = vnoise(p1 + vec3(0,0,e)) - vnoise(p1 - vec3(0,0,e));
    float dFx_dz = vnoise(p  + vec3(0,0,e)) - vnoise(p  - vec3(0,0,e));
    float dFz_dx = vnoise(p2 + vec3(e,0,0)) - vnoise(p2 - vec3(e,0,0));
    float dFy_dx = vnoise(p1 + vec3(e,0,0)) - vnoise(p1 - vec3(e,0,0));
    float dFx_dy = vnoise(p  + vec3(0,e,0)) - vnoise(p  - vec3(0,e,0));
    return vec3(dFz_dy - dFy_dz, dFx_dz - dFz_dx, dFy_dx - dFx_dy) / (2.0 * e);
  }

  // Particle Life species: fixed per particle, derived from the texel
  // index with the same hash the points readout uses, so sim and draw
  // always agree on which species a particle belongs to.
  float plHash(float n) {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
  }
  int plSpecies(vec2 uv) {
    float idx = floor(uv.y * uTexSizeF) * uTexSizeF + floor(uv.x * uTexSizeF);
    float h = plHash(idx + 17.17);
    return int(min(floor(h * float(uParticleLifeSpecies)), float(uParticleLifeSpecies - 1)));
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec4 velData = texture2D(uVelTex, vUv);
    vec3 pos = posData.xyz;
    vec3 vel = velData.xyz;
    float phaseState = velData.w;

    vel.y -= uGravity * uDelta * 9.8;

    if (uTurbulence > 0.001) {
      float t = uTime * 0.25;
      vec3 np = pos * 0.007;
      vel += vec3(vnoise(np+vec3(t,0,0)),vnoise(np+vec3(0,t+13.7,0)),vnoise(np+vec3(0,0,t+27.4)))
             * uTurbulence * 18.0 * uDelta;
    }

    if (uAudioBlast > 0.001) {
      vec3 dir = length(pos) > 0.001 ? normalize(pos) : vec3(0,1,0);
      vel += dir * uAudioBlast * 14.0 * uDelta;
    }

    // N-Body gravity/repulsion
    if (uNBodyEnabled) {
      vec3 acc = vec3(0.0);
      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 diff = oPos - pos;
        float r2 = dot(diff, diff) + uNBodySoftening * uNBodySoftening;
        float r  = sqrt(r2);
        if (r > 0.001) {
          vec3 dir2 = diff / r;
          if (r > uNBodyRepulsion) {
            acc += dir2 / r2;
          } else {
            acc -= dir2 / r2 * 0.5;
          }
        }
      }
      vel += acc * uNBodyStrength * uDelta * 500.0;
    }

    // Curl Noise
    if (uCurlEnabled) {
      vec3 curl = curlNoise(pos * uCurlScale + vec3(uTime * 0.15));
      vel += curl * uCurlStrength * 20.0 * uDelta;
    }

    // Boids
    if (uBoidsEnabled) {
      vec3 sepForce = vec3(0.0);
      vec3 aliForce = vec3(0.0);
      vec3 cohPos   = vec3(0.0);
      int  cohCount = 0;
      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 oVel = texture2D(uVelTex, sUv).xyz;
        float d = distance(pos, oPos);
        if (d < uBoidsRadius * 0.3 && d > 0.001) sepForce -= normalize(oPos - pos) / max(d, 0.5);
        if (d < uBoidsRadius) { aliForce += oVel; cohPos += oPos; cohCount++; }
      }
      if (cohCount > 0) {
        float inv = 1.0 / float(cohCount);
        vel += normalize(sepForce + vec3(0.0001)) * uBoidsSeparation * uDelta * 150.0;
        vel += normalize(aliForce * inv - vel + vec3(0.0001)) * uBoidsAlignment * uDelta * 60.0;
        vel += normalize(cohPos * inv - pos + vec3(0.0001)) * uBoidsCohesion * uDelta * 60.0;
      }
    }

    // Kuramoto phase synchronization: the phase lives in vel.w and is
    // coupled to sampled neighbours within a radius (sampled mean-field):
    // dPhase = omega_i + K * mean(sin(phase_j - phase_i)).
    if (uKuramotoEnabled) {
      float omega = (hash3(vec3(vUv * 271.0, 3.7)).x - 0.5) * uKuramotoSpread * 2.0;
      float sumSin = 0.0;
      float kStride = uTexSizeF / 64.0;
      for (int i = 0; i < 64; i++) {
        float si = float(i) * kStride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        float wgt = clamp(1.5 - distance(pos, oPos) / max(uKuramotoRadius, 1.0), 0.0, 1.0);
        sumSin += wgt * sin(texture2D(uVelTex, sUv).w - phaseState);
      }
      float dPhase = omega + uKuramotoCoupling * (sumSin / 64.0) * 3.0;
      phaseState = mod(phaseState + dPhase * uDelta, 6.2831853);
    }

    // Particle Life: species-matrix forces over 64 stochastic neighbours.
    // Classic force law with beta = 0.3: universal short-range repulsion
    // for r < beta, and a triangular matrix-weighted band for beta <= r < 1
    // peaking at r = (1 + beta) / 2. Friction is applied inside this block
    // (frame-rate sane: the per-step retention factor uParticleLifeFriction
    // is defined at 60 fps and exponentiated by elapsed steps) so that
    // structures condense instead of heating forever; it only ever runs
    // while the subsystem is enabled, leaving the OFF path untouched.
    if (uParticleLifeEnabled) {
      int selfSpecies = plSpecies(vUv);
      vec3 plForce = vec3(0.0);
      float plStride = uTexSizeF / 64.0;
      float plRadius = max(uParticleLifeRadius, 1.0);
      const float plBeta = 0.3;
      for (int i = 0; i < 64; i++) {
        float si = float(i) * plStride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 diff = oPos - pos;
        float d = length(diff);
        if (d < plRadius && d > 0.001) {
          vec3 dir = diff / d;
          float r = d / plRadius;
          if (r < plBeta) {
            plForce += dir * (r / plBeta - 1.0);
          } else {
            int otherSpecies = plSpecies(sUv);
            float a = uParticleLifeMatrix[selfSpecies * 6 + otherSpecies];
            plForce += dir * a * (1.0 - abs(2.0 * r - 1.0 - plBeta) / (1.0 - plBeta));
          }
        }
      }
      vel += plForce * uParticleLifeStrength * uDelta * 45.0;
      vel *= pow(clamp(uParticleLifeFriction, 0.0, 1.0), uDelta * 60.0);
    }

    // Strange Attractor
    if (uAttractorEnabled) {
      vec3 ap = pos / max(0.1, uAttractorScale);
      vec3 dv;
      if (uAttractorType == 0) { // Lorenz
        dv = vec3(10.0*(ap.y-ap.x), ap.x*(28.0-ap.z)-ap.y, ap.x*ap.y-2.667*ap.z);
      } else if (uAttractorType == 1) { // Rossler
        dv = vec3(-(ap.y+ap.z), ap.x+0.2*ap.y, 0.2+ap.z*(ap.x-5.7));
      } else if (uAttractorType == 3) { // Halvorsen
        dv = vec3(-1.4*ap.x - 4.0*ap.y - 4.0*ap.z - ap.y*ap.y,
                  -1.4*ap.y - 4.0*ap.z - 4.0*ap.x - ap.z*ap.z,
                  -1.4*ap.z - 4.0*ap.x - 4.0*ap.y - ap.x*ap.x);
      } else if (uAttractorType == 4) { // Chen
        dv = vec3(35.0*(ap.y-ap.x), -7.0*ap.x - ap.x*ap.z + 28.0*ap.y, ap.x*ap.y - 3.0*ap.z);
      } else if (uAttractorType == 5) { // Lu
        dv = vec3(36.0*(ap.y-ap.x), -ap.x*ap.z + 20.0*ap.y, ap.x*ap.y - 3.0*ap.z);
      } else if (uAttractorType == 6) { // Aizawa
        float zb = ap.z - 0.7;
        dv = vec3(zb*ap.x - 3.5*ap.y,
                  3.5*ap.x + zb*ap.y,
                  0.6 + 0.95*ap.z - (ap.z*ap.z*ap.z)/3.0 - (ap.x*ap.x + ap.y*ap.y)*(1.0 + 0.25*ap.z) + 0.1*ap.z*ap.x*ap.x*ap.x);
      } else if (uAttractorType == 7) { // Sprott F
        dv = vec3(ap.y + ap.z, -ap.x + 0.5*ap.y, ap.x*ap.x - ap.z);
      } else if (uAttractorType == 8) { // Rabinovich-Fabrikant
        dv = vec3(ap.y*(ap.z - 1.0 + ap.x*ap.x) + 0.1*ap.x,
                  ap.x*(3.0*ap.z + 1.0 - ap.x*ap.x) + 0.1*ap.y,
                  -2.0*ap.z*(0.14 + ap.x*ap.y));
      } else if (uAttractorType == 9) { // De Jong map (pull toward the mapped point)
        vec2 mp = vec2(sin(1.4*ap.y) - cos(-2.3*ap.x), sin(2.4*ap.x) - cos(-2.1*ap.y));
        dv = vec3(mp - ap.xy, -0.5*ap.z);
      } else if (uAttractorType == 10) { // Ikeda map (same adaptation)
        float r2 = dot(ap.xy, ap.xy);
        float tt = 0.4 - 6.0/(1.0 + r2);
        float ct = cos(tt); float st = sin(tt);
        vec2 mp = vec2(1.0, 0.0) + 0.918 * vec2(ap.x*ct - ap.y*st, ap.x*st + ap.y*ct);
        dv = vec3(mp - ap.xy, -0.5*ap.z);
      } else if (uAttractorType == 11) { // Chua (double scroll)
        float fx = -0.714*ap.x - 0.2145*(abs(ap.x + 1.0) - abs(ap.x - 1.0));
        dv = vec3(15.6*(ap.y - ap.x - fx), ap.x - ap.y + ap.z, -28.0*ap.y);
      } else { // Thomas (2)
        dv = vec3(sin(ap.y)-0.208*ap.x, sin(ap.z)-0.208*ap.y, sin(ap.x)-0.208*ap.z);
      }
      vel += normalize(dv + vec3(0.0001)) * uAttractorStrength * uDelta * 40.0;
    }

    // Lévy flight: rare heavy-tailed impulses. The gate is quantised by tick
    // (floor(uTime * rate)) so jump frequency is frame-rate independent; the
    // magnitude follows a power law in the hash (clamped for stability).
    if (uLevyEnabled) {
      float tick = floor(uTime * uLevyRate);
      vec3 h = hash3(vec3(vUv * 913.7, tick * 17.31 + 4.7));
      if (h.x > 0.96) {
        vec3 dir = h - 0.5;
        float dl = length(dir);
        if (dl > 0.01) {
          float mag = min(pow(max(h.y, 0.002), -1.2), 60.0) * uLevyStrength * 1.5;
          vel += (dir / dl) * mag;
        }
      }
    }

    // Vortex
    if (uVortexEnabled) {
      vec3 axis = normalize(vec3(sin(uVortexTilt), cos(uVortexTilt), 0.0));
      vec3 tangent = cross(axis, pos);
      float tLen = length(tangent);
      if (tLen > 0.001) vel += (tangent / tLen) * uVortexStrength * uDelta * 80.0;
    }

    // Wind
    if (uWindEnabled) {
      vec3 gust = vec3(
        vnoise(pos * 0.01 + vec3(uTime * 0.3, 0.0, 0.0)),
        vnoise(pos * 0.01 + vec3(1.7, uTime * 0.25, 0.0)),
        vnoise(pos * 0.01 + vec3(0.0, 3.1, uTime * 0.2))
      ) * uWindGust;
      vel += (normalize(vec3(uWindX, uWindY, uWindZ) + vec3(0.0001)) * uWindStrength + gust) * uDelta * 30.0;
    }

    // Gravity Well
    if (uWellEnabled) {
      vec3 toCenter = -pos;
      float d = length(toCenter) + uWellSoftening;
      vel += (toCenter / (d * d)) * uWellStrength * uDelta * 2000.0;
      vec3 tangent2 = cross(normalize(toCenter + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
      vel += tangent2 * uWellOrbit * uDelta * 50.0;
    }

    // Elastic Spring
    if (uElasticEnabled) {
      vel -= pos * uElasticStrength * uDelta * 2.0;
    }

    // Magnetic / Lorentz
    if (uMagneticEnabled) {
      vec3 B = normalize(vec3(uMagneticBX, uMagneticBY, uMagneticBZ) + vec3(0.0001));
      vel += cross(vel, B) * uMagneticStrength * uDelta * 0.8;
    }

    // SPH Fluid Simulation
    if (uSphEnabled) {
      float density = 0.0;
      vec3 pressureForce = vec3(0.0);
      vec3 viscForce = vec3(0.0);
      float h2 = uSphRadius * uSphRadius;
      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 oVel = texture2D(uVelTex, sUv).xyz;
        vec3 r = pos - oPos;
        float r2 = dot(r, r);
        if (r2 < h2 && r2 > 0.001) {
          float q = sqrt(r2) / uSphRadius;
          float w = max(0.0, 1.0 - q * q);
          density += w;
          float pressure = uSphPressure * max(0.0, density - uSphRestDensity);
          pressureForce += normalize(r + vec3(0.0001)) * pressure * w;
          viscForce += (oVel - vel) * w * uSphViscosity;
        }
      }
      vel += (pressureForce + viscForce) * uDelta * 15.0;
    }

    // Vector Field
    if (uVFieldEnabled) {
      vec3 p = pos * uVFieldScale;
      float pr = length(p) + 0.001;
      vec3 f;
      if (uVFieldType == 0) { // dipole
        float r3 = pow(pr, 3.0);
        f = vec3(3.0*p.x*p.y, 3.0*p.y*p.y - dot(p,p), 3.0*p.y*p.z) / r3;
      } else if (uVFieldType == 1) { // saddle
        f = vec3(p.x, -p.y, sin(p.z * 3.14159));
      } else if (uVFieldType == 2) { // spiral sink
        f = vec3(-p.x - p.z, p.x - p.y, -p.z * 0.5);
      } else if (uVFieldType == 4) { // ABC flow (Arnold-Beltrami-Childress)
        f = vec3(1.732*sin(p.z) + cos(p.y),
                 1.414*sin(p.x) + 1.732*cos(p.z),
                 sin(p.y) + 1.414*cos(p.x));
      } else if (uVFieldType == 5) { // double gyre (time-dependent)
        vec2 q = p.xy * 0.5 + vec2(1.0, 0.5);
        float at = 0.1 * sin(uTime * 0.4);
        float fx = at * q.x * q.x + (1.0 - 2.0 * at) * q.x;
        float dfx = 2.0 * at * q.x + (1.0 - 2.0 * at);
        float piA = 3.14159 * 0.35;
        f = vec3(-piA * sin(3.14159 * fx) * cos(3.14159 * q.y),
                  piA * cos(3.14159 * fx) * sin(3.14159 * q.y) * dfx,
                  0.3 * sin(p.x * 0.8 + uTime * 0.3));
      } else if (uVFieldType == 6) { // Worley (cellular)
        vec3 cell = floor(p);
        float f1 = 8.0; float f2 = 8.0; vec3 nearDir = vec3(0.0);
        for (int i = -1; i <= 1; i++)
        for (int j = -1; j <= 1; j++)
        for (int k = -1; k <= 1; k++) {
          vec3 g = cell + vec3(float(i), float(j), float(k));
          vec3 fp = g + hash3(g * 1.37);
          vec3 d = fp - p;
          float dist = dot(d, d);
          if (dist < f1) { f2 = f1; f1 = dist; nearDir = d; }
          else if (dist < f2) { f2 = dist; }
        }
        f = nearDir * (sqrt(f2) - sqrt(f1) + 0.05);
      } else { // source-sink (3)
        f = p / (pr * pr * pr);
      }
      vel += normalize(f + vec3(0.0001)) * uVFieldStrength * uDelta * 30.0;
    }

    // Spring to Spawn Position
    if (uSpringEnabled) {
      vec3 spawnPos = texture2D(uInitPosTex, vUv).xyz;
      vel += (spawnPos - pos) * uSpringStrength * uDelta * 3.0;
    }

    // SDF Collider — velocity reflection
    if (uSdfEnabled) {
      vec3 sc = vec3(uSdfX, uSdfY, uSdfZ);
      float sd; vec3 sn;
      if (uSdfShape == 0) {
        sd = length(pos - sc) - uSdfSize;
        sn = normalize(pos - sc + vec3(0.0001));
      } else if (uSdfShape == 1) {
        vec3 q = abs(pos - sc) - vec3(uSdfSize);
        sd = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
        vec3 dq = pos - sc; vec3 aq = abs(dq); vec3 dd = aq - vec3(uSdfSize);
        if (max(dd.x, max(dd.y, dd.z)) > 0.0) sn = normalize(max(dd, 0.0) * sign(dq));
        else if (dd.x > dd.y && dd.x > dd.z) sn = vec3(sign(dq.x), 0.0, 0.0);
        else if (dd.y > dd.z) sn = vec3(0.0, sign(dq.y), 0.0);
        else sn = vec3(0.0, 0.0, sign(dq.z));
      } else if (uSdfShape == 2) {
        vec3 lp = pos - sc; float r2 = uSdfSize * 0.35;
        float ringD = length(lp.xz) - uSdfSize;
        sd = length(vec2(ringD, lp.y)) - r2;
        float lxz = length(lp.xz) + 0.001;
        sn = normalize(vec3(lp.x / lxz * ringD, lp.y, lp.z / lxz * ringD));
      } else {
        float yc = clamp(pos.y - sc.y, -uSdfSize, uSdfSize);
        vec3 dp = vec3(pos.x - sc.x, pos.y - sc.y - yc, pos.z - sc.z);
        sd = length(dp) - uSdfSize * 0.4;
        sn = normalize(dp + vec3(0.0001));
      }
      if (sd < 2.0) {
        float vn = dot(vel, sn);
        if (vn < 0.0) vel -= sn * vn * (1.0 + uSdfBounce);
      }
    }

    // Mouse Force
    if (uMouseEnabled) {
      vec3 toMouse = uMousePos - pos;
      float md = length(toMouse);
      if (md < uMouseRadius && md > 0.001) {
        float falloff = (1.0 - md / uMouseRadius);
        falloff *= falloff;
        vec3 dir = normalize(toMouse);
        if (uMouseMode == 0) { // attract
          vel += dir * falloff * uMouseStrength * uDelta * 200.0;
        } else if (uMouseMode == 1) { // repel
          vel -= dir * falloff * uMouseStrength * uDelta * 200.0;
        } else { // swirl
          vec3 swirl = cross(dir, vec3(0.0, 1.0, 0.001));
          vel += normalize(swirl) * falloff * uMouseStrength * uDelta * 150.0;
        }
      }
    }

    // Fluid Advection
    if (uFluidEnabled) {
      vec2 fieldUv = pos.xz / (uBounceRadius * uFluidScale) * 0.5 + 0.5;
      fieldUv = clamp(fieldUv, 0.001, 0.999);
      vec2 fieldVel = texture2D(uFluidTex, fieldUv).xy;
      vel.x += fieldVel.x * uFluidInfluence * uDelta * 300.0;
      vel.z += fieldVel.y * uFluidInfluence * uDelta * 300.0;
    }

    // __CUSTOM_FORCE__

    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    vel *= (1.0 - 1.1 * uDelta);

    float dist = length(pos);
    if (dist > uBounceRadius) {
      vec3 n = pos / dist;
      float vn = dot(vel, n);
      if (vn > 0.0) vel -= n * vn * (1.0 + uBounce);
    }

    gl_FragColor = vec4(vel, phaseState);
  }
`;

// Builds the effective velocity fragment shader with a user's custom GLSL
// force snippet injected at the placeholder above — after every built-in
// force has been accumulated into `vel`, before the speed clamp, damping
// and boundary bounce. The snippet runs in a block scope and may read
// `pos`, `vel`, `uTime` and `uDelta` (see lib/gpgpuCustomForce.ts for the
// validation and compile-check contract). An empty snippet yields the
// stock shader unchanged.
export function buildVelocityFragment(customCode: string): string {
  const snippet = customCode.trim();
  if (!snippet) return SIM_VEL_FRAG;
  return SIM_VEL_FRAG.replace(
    '    // __CUSTOM_FORCE__',
    `    { // custom force (user GLSL)\n${snippet}\n    }`,
  );
}
