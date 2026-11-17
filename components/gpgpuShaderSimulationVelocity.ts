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
  uniform int   uCurlSymmetry;
  uniform int   uCurlMode;
  uniform int   uCurlOctaves;
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
  uniform float uParticleLifePursue;
  uniform float uParticleLifeEvade;
  uniform float uParticleLifeVisionRange;
  uniform float uParticleLifeVisionAngle;
  uniform float uParticleLifeMaxSpeed;
  uniform float uParticleLifeMeanderAmount;
  uniform float uParticleLifeMeanderScale;
  uniform float uParticleLifeAvoid;
  // Lifecycle grammar (Phase AB): spawn gate (burst < 1 holds part
  // of the pool parked until the release threshold crosses its
  // hash) and the pool-wide drag rate / max speed. uDragRate's
  // default 1.1 is the legacy fixed damping; uMaxSpeed 0 = off.
  uniform float uSpawnRate;
  uniform float uSpawnBurst;
  uniform float uSpawnTime;
  // Spawn pulse (Phase AH): interval 0 = off — spawnPulseTime then
  // returns max(t, 0) and the threshold expression below is the
  // legacy one verbatim. TS twin: spawnPulseTime in
  // lib/gpgpuLifecycle.ts.
  uniform float uSpawnPulseInterval;
  uniform float uSpawnPulseDuty;
  uniform float uDragRate;
  uniform float uMaxSpeed;
  // Signal & time grammar (Phase AC): the curl field's evolution
  // speed (1 = legacy rate, an exact IEEE identity) and the age
  // curves aimed at the simulation itself. The passes suppress a
  // curve whose points are all 1 (identity) by clearing its
  // Enabled uniform, so a flat curve takes the legacy path.
  uniform float uCurlSpeed;
  uniform bool  uAgeCurveVelocityEnabled;
  uniform float uAgeCurveVelocity[5];
  uniform bool  uAgeCurveForceEnabled;
  uniform float uAgeCurveForce[5];
  uniform bool  uVortexEnabled;
  uniform float uVortexStrength;
  uniform float uVortexTilt;
  uniform bool  uWindEnabled;
  uniform float uWindStrength;
  uniform float uWindX;
  uniform float uWindY;
  uniform float uWindZ;
  uniform float uWindGust;
  // Terrain slope flow (Phase AE): the derived gradient bake of
  // the live terrain (RG = unit downhill direction, B = slope
  // magnitude normalised by the field's own maximum). Resolved
  // CPU-side (enabled key AND terrain mesh on AND plane mode AND
  // texture ready), so a false uniform is the exact legacy path.
  uniform bool  uSlopeForceEnabled;
  uniform float uSlopeForceStrength;
  uniform sampler2D uSlopeTex;
  uniform float uSlopeExtent;
  // Terrain collider (Phase AI): the derived collider bake
  // (RG = 16-bit packed height, B/A = gradient components).
  // Resolved CPU-side like the slope force (enabled key AND
  // terrain mesh on AND plane mode AND texture ready), so a
  // false uniform is the exact legacy path.
  uniform bool  uTerrainColliderEnabled;
  uniform sampler2D uTerrainColliderTex;
  uniform float uTerrainExtent;
  uniform float uTerrainHeightWorld;
  uniform float uTerrainGradScale;
  uniform float uTerrainTexSize;
  uniform float uTerrainBounce;
  uniform float uTerrainFriction;
  uniform bool  uWellEnabled;
  uniform float uWellStrength;
  uniform float uWellSoftening;
  uniform float uWellOrbit;
  uniform int   uWellCount;
  uniform float uWellSpread;
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
  uniform float uSphSurfaceTension;
  uniform bool  uVFieldEnabled;
  uniform int   uVFieldType;
  uniform float uVFieldStrength;
  uniform float uVFieldScale;
  uniform bool  uSpringEnabled;
  uniform float uSpringStrength;
  uniform sampler2D uInitPosTex;
  uniform bool  uMorphEnabled;
  uniform sampler2D uMorphTex;
  uniform sampler2D uMorphNormalTex;
  uniform float uMorphObjNormalSpeed;
  uniform float uMorphKickStart;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform float uMorphStrength;
  uniform float uMorphOrbitSpeed;
  uniform float uMorphReplicaPhaseGain;
  // Replica independent simulation (Phase W2): per-stack field
  // seed / clock offsets (zero in the shared path, where they are
  // exact neutrals) and the stack-mode remap of this stack's
  // texels onto the global layout for the textures that live
  // there (morph targets / normals / initial positions).
  uniform vec3  uReplicaSeedOffset;
  uniform float uReplicaTimeOffset;
  uniform float uStackMode;
  uniform float uStackGlobalStart;
  uniform float uStackGlobalTexSizeF;
  uniform float uSpeed;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  uniform float uSdfBounce;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  uniform float uFloorBounce;
  uniform bool  uMouseEnabled;
  uniform vec3  uMousePos;
  uniform float uMouseStrength;
  uniform float uMouseRadius;
  uniform int   uMouseMode;
  uniform float uMousePaintRate;
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

  // Curl field symmetry (Kinetix integration B1b): the sampling
  // coordinates are folded into a symmetric fundamental domain before
  // the curl is evaluated, and the sampled vector is unfolded back —
  // the same construction as Kinetix's sampleSymmetricCurl. This is a
  // symmetry of the FIELD, not of particle positions or the screen.
  // uCurlSymmetry: 0 none (never routed here), 1 mirrorX, 2 radial4,
  // 3 radial6, 4 octahedral. tOff is the usual time offset vector added
  // to the (folded) sample position, matching the unsymmetric path.
  vec3 symmetricCurl(vec3 p, vec3 tOff) {
    if (uCurlSymmetry == 1) { // mirrorX
      float sx = p.x < 0.0 ? -1.0 : 1.0;
      vec3 c = curlNoise(vec3(abs(p.x), p.y, p.z) + tOff);
      return vec3(c.x * sx, c.y, c.z);
    }
    if (uCurlSymmetry == 4) { // octahedral
      vec3 s = vec3(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0, p.z < 0.0 ? -1.0 : 1.0);
      vec3 c = curlNoise(abs(p) + tOff);
      return c * s;
    }
    // radial4 / radial6: fold the XZ polar angle into one sector
    // (mirrored at the sector half), sample, rotate the vector back.
    float k = uCurlSymmetry == 2 ? 4.0 : 6.0;
    float sector = 6.28318530718 / k;
    float r = length(p.xz);
    float theta = atan(p.z, p.x);
    float normTheta = mod(theta, sector);
    float folded = normTheta > sector * 0.5 ? sector - normTheta : normTheta;
    vec3 fp = vec3(r * cos(folded), p.y, r * sin(folded));
    vec3 c = curlNoise(fp + tOff);
    float rot = theta - folded;
    float rc = cos(rot);
    float rs = sin(rot);
    return vec3(c.x * rc - c.z * rs, c.y, c.x * rs + c.z * rc);
  }

  // One curl sample with the field symmetry applied (or not). The
  // legacy call sites below keep their exact original expressions;
  // this helper serves only the generalised B3 field path.
  vec3 curlSampleAt(vec3 p, vec3 tOff) {
    return uCurlSymmetry == 0 ? curlNoise(p + tOff) : symmetricCurl(p, tOff);
  }

  // Kinetix field flavours (B3, re-implemented from computeCurlNoise):
  // octave composition adds the 2.13x octave at 0.45 and the 4.27x
  // octave at 0.22. 'ridged' shapes each component through
  // sign(c) * (1.25 - exp(-|c| * 0.9)) * 2.1 (Kinetix's ridge shaping);
  // 'vortex' adds a tangential swirl around Y proportional to the
  // sampling coordinate (Kinetix: cross with radial * 1.4 at 0.35
  // scale, folded here into the 0.49 factor on the scaled position).
  vec3 curlField(vec3 p, vec3 tOff) {
    vec3 c = curlSampleAt(p, tOff);
    if (uCurlOctaves >= 2) c += 0.45 * curlSampleAt(p * 2.13, tOff + vec3(17.1, -9.4, 5.7));
    if (uCurlOctaves >= 3) c += 0.22 * curlSampleAt(p * 4.27, tOff + vec3(-11.3, 21.8, -14.2));
    if (uCurlMode == 1) { // ridged
      c = sign(c) * (vec3(1.25) - exp(-abs(c) * 0.9)) * 2.1;
    } else if (uCurlMode == 2) { // vortex
      c += vec3(-p.z, 0.0, p.x) * 0.49;
    }
    return c;
  }

  // Gyroid SDF (B3): TPMS gyroid implicit surface. The distance is the
  // standard gradient-normalised approximation; the normal is the
  // analytic gradient in the scaled coordinate frame.
  float gyroidField(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
  }
  vec3 gyroidNormal(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    vec3 g = vec3(
      cos(q.x) * cos(q.y) - sin(q.z) * sin(q.x),
      cos(q.y) * cos(q.z) - sin(q.x) * sin(q.y),
      cos(q.z) * sin(q.x) - sin(q.y) * sin(q.z)
    );
    return normalize(g + vec3(0.0001));
  }

  // Pointer paint gate (B3): must stay bit-identical with the copy in
  // the position shader — both passes evaluate the same hash of
  // (texel, 30Hz tick) so a gated particle is teleported by the
  // position pass in the same frame the velocity pass re-seeds it.
  float paintHash(vec2 uv, float tick) {
    return fract(sin(dot(uv * 913.7 + vec2(tick * 17.31, tick * 7.77), vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Spawn gate hash (Phase AB): the position shader's hash1 family
  // at a fixed offset — the identical expression lives in the
  // position pass and in lib/gpgpuLifecycle.ts (spawnHashForUv), so
  // all three agree on which particles are released.
  float spawnHash(vec2 uv) {
    return fract(sin(dot(uv + vec2(7.77, 3.13), vec2(127.1, 311.7))) * 43758.5453);
  }

  // Pulse time (Phase AH): live seconds inside t wall seconds —
  // the clock advances only during the first uSpawnPulseDuty
  // fraction of each uSpawnPulseInterval cycle. Interval 0 returns
  // max(t, 0) unchanged (the legacy clock).
  float spawnPulseTime(float t) {
    float tt = max(t, 0.0);
    if (uSpawnPulseInterval <= 0.0) return tt;
    float cyc = tt / uSpawnPulseInterval;
    float whole = floor(cyc);
    float fracPart = cyc - whole;
    return (whole * uSpawnPulseDuty + min(fracPart, uSpawnPulseDuty)) * uSpawnPulseInterval;
  }

  // SDF distance for obstacle avoidance (Phase AB): the same field
  // formulas the collider block at the bottom of main() evaluates
  // (gyroid uses the gradient-normalised approximation above).
  // TS twin: sdfDistance in lib/particleLifeBehavior.ts.
  float abSdfDistance(vec3 p) {
    vec3 sc = vec3(uSdfX, uSdfY, uSdfZ);
    vec3 d = p - sc;
    if (uSdfShape == 0) {
      return length(d) - uSdfSize;
    } else if (uSdfShape == 1) {
      vec3 q = abs(d) - vec3(uSdfSize);
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    } else if (uSdfShape == 2) {
      float ringD = length(d.xz) - uSdfSize;
      return length(vec2(ringD, d.y)) - uSdfSize * 0.35;
    } else if (uSdfShape == 4) {
      return gyroidField(p, sc, uSdfSize) * uSdfSize * 0.227;
    }
    float yc = clamp(d.y, -uSdfSize, uSdfSize);
    return length(vec3(d.x, d.y - yc, d.z)) - uSdfSize * 0.4;
  }
  vec3 abSdfNormal(vec3 p) {
    float e = 0.5;
    vec3 g = vec3(
      abSdfDistance(p + vec3(e, 0.0, 0.0)) - abSdfDistance(p - vec3(e, 0.0, 0.0)),
      abSdfDistance(p + vec3(0.0, e, 0.0)) - abSdfDistance(p - vec3(0.0, e, 0.0)),
      abSdfDistance(p + vec3(0.0, 0.0, e)) - abSdfDistance(p - vec3(0.0, 0.0, e)));
    float gl = length(g);
    return gl > 0.0001 ? g / gl : vec3(0.0, 1.0, 0.0);
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

  // Terrain collider sampling (Phase AI): the collider bake packs
  // the height as a 16-bit value in RG and the gradient components
  // in B/A (lib/terrainDerivedMaps.ts). The texture is
  // NearestFilter, so this manual bilinear decodes each corner
  // texel BEFORE interpolating — hardware filtering would
  // interpolate the packed bytes independently and corrupt the
  // height at low-byte wraps. Returns (worldHeight, gradX, gradZ)
  // with the gradient in field units (world-scale invariant: the
  // height and the XZ plane share the world scale). An identical
  // copy lives in the position pass (which uses .x only).
  vec3 terrainColliderSample(vec2 uv) {
    vec2 gridPos = uv * uTerrainTexSize - 0.5;
    vec2 base = floor(gridPos);
    vec2 f = clamp(gridPos - base, 0.0, 1.0);
    vec2 i00 = clamp(base, vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i10 = clamp(base + vec2(1.0, 0.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i01 = clamp(base + vec2(0.0, 1.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i11 = clamp(base + vec2(1.0, 1.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec4 t00 = texture2D(uTerrainColliderTex, (i00 + 0.5) / uTerrainTexSize);
    vec4 t10 = texture2D(uTerrainColliderTex, (i10 + 0.5) / uTerrainTexSize);
    vec4 t01 = texture2D(uTerrainColliderTex, (i01 + 0.5) / uTerrainTexSize);
    vec4 t11 = texture2D(uTerrainColliderTex, (i11 + 0.5) / uTerrainTexSize);
    float h00 = (t00.r * 255.0 * 256.0 + t00.g * 255.0) / 65535.0;
    float h10 = (t10.r * 255.0 * 256.0 + t10.g * 255.0) / 65535.0;
    float h01 = (t01.r * 255.0 * 256.0 + t01.g * 255.0) / 65535.0;
    float h11 = (t11.r * 255.0 * 256.0 + t11.g * 255.0) / 65535.0;
    float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    vec2 g = mix(mix(t00.ba, t10.ba, f.x), mix(t01.ba, t11.ba, f.x), f.y) * 2.0 - 1.0;
    return vec3((h * 2.0 - 1.0) * uTerrainHeightWorld, g * uTerrainGradScale);
  }

  // Age curve evaluation (Phase AC): the same 5-point piecewise-
  // linear blend as the points shader's kaloEvalCurve5 (and the TS
  // twin, lib/ageCurve.ts evaluateAgeCurve) — an all-ones curve is
  // exactly 1.0 at every t.
  float kaloEvalCurve5(float t, float p0, float p1, float p2, float p3, float p4) {
    float x = clamp(t, 0.0, 1.0) * 4.0;
    float v = p0;
    v = mix(v, p1, clamp(x, 0.0, 1.0));
    v = mix(v, p2, clamp(x - 1.0, 0.0, 1.0));
    v = mix(v, p3, clamp(x - 2.0, 0.0, 1.0));
    v = mix(v, p4, clamp(x - 3.0, 0.0, 1.0));
    return v;
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec4 velData = texture2D(uVelTex, vUv);
    vec3 pos = posData.xyz;
    vec3 vel = velData.xyz;
    float phaseState = velData.w;

    // Spawn gate (Phase AB): an unreleased particle carries zero
    // velocity (its phase state is preserved verbatim) so it sits
    // parked — the position pass holds it off-screen — until the
    // release threshold crosses its hash. Burst 1 (default) skips
    // this entirely. TS twin: spawnStateForIndex in
    // lib/gpgpuLifecycle.ts.
    if (uSpawnBurst < 1.0) {
      float sThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTime(uSpawnTime));
      if (spawnHash(vUv) >= sThr) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, phaseState);
        return;
      }
    }

    // Replica independent simulation (Phase W2): in stack mode
    // this pass simulates ONE replica block inside its own
    // textures. replicaSeed / replicaTime shift the stochastic
    // field sampling (turbulence / curl / wind gust / Levy gate)
    // so the copy evolves on its own field realization and clock
    // phase; in the shared path both are exact zeros and every
    // expression below reduces to its legacy form. globalUv
    // remaps this stack's texels onto the global layout for the
    // textures that live there (morph / normals / initial data);
    // in the shared path it is vUv itself.
    vec3 replicaSeed = uReplicaSeedOffset;
    float replicaTime = uTime + uReplicaTimeOffset;
    vec2 globalUv = vUv;
    if (uStackMode > 0.5) {
      float localIdx = floor(vUv.y * uTexSizeF) * uTexSizeF + floor(vUv.x * uTexSizeF);
      float globalIdx = uStackGlobalStart + localIdx;
      globalUv = (vec2(mod(globalIdx, uStackGlobalTexSizeF), floor(globalIdx / uStackGlobalTexSizeF)) + 0.5) / uStackGlobalTexSizeF;
    }

    // Age ratio for the Phase AC sim curves — the points shader's
    // convention (0.5 while age tracking is off).
    float ageNorm = uAgeEnabled ? clamp(posData.w / max(uAgeMax, 0.001), 0.0, 1.0) : 0.5;
    // Force over Lifetime baseline (Phase AC): the velocity before
    // the built-in force accumulation below.
    vec3 velForceBase = vel;
    // Curl field clock (Phase AC): the legacy rate is 0.15/s;
    // uCurlSpeed 1 multiplies it by exactly 1.0.
    float curlTime = replicaTime * 0.15 * uCurlSpeed;

    vel.y -= uGravity * uDelta * 9.8;

    if (uTurbulence > 0.001) {
      float t = replicaTime * 0.25;
      vec3 np = pos * 0.007 + replicaSeed;
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

    // Curl Noise (with optional field symmetry, B1b; symmetry 0 keeps
    // the exact legacy sampling expression). The B3 flavours/octaves
    // route through curlField; mode 'curl' with 1 octave keeps the
    // exact legacy expression below, untouched.
    if (uCurlEnabled) {
      vec3 curl = (uCurlMode == 0 && uCurlOctaves <= 1)
        ? (uCurlSymmetry == 0
          ? curlNoise(pos * uCurlScale + vec3(curlTime) + replicaSeed)
          : symmetricCurl(pos * uCurlScale + replicaSeed, vec3(curlTime)))
        : curlField(pos * uCurlScale + replicaSeed, vec3(curlTime));
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
      // Behaviour force (Phase AA1): pursue / evade over the cyclic
      // predator chain, vision-gated. Zero when both coefficients
      // are 0, which keeps the legacy block bit-identical.
      vec3 behForce = vec3(0.0);
      bool behActive = uParticleLifePursue > 0.0 || uParticleLifeEvade > 0.0;
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
            float band = 1.0 - abs(2.0 * r - 1.0 - plBeta) / (1.0 - plBeta);
            plForce += dir * a * band;
            if (behActive) {
              int prey = int(mod(float(selfSpecies + 1), float(uParticleLifeSpecies)));
              int predator = int(mod(float(selfSpecies - 1 + uParticleLifeSpecies), float(uParticleLifeSpecies)));
              float pc = otherSpecies == prey ? 1.0 : 0.0;
              float ec = otherSpecies == predator ? 1.0 : 0.0;
              if (pc > 0.0 || ec > 0.0) {
                // Vision gate (TS twin: visionSees in
                // lib/particleLifeBehavior.ts): range, then the
                // cone around the velocity direction.
                float vRange = uParticleLifeVisionRange > 0.0 ? uParticleLifeVisionRange : plRadius;
                bool sees = d <= vRange;
                if (sees && uParticleLifeVisionAngle < 360.0) {
                  float spd = length(vel);
                  if (spd >= 0.01) {
                    float cosA = dot(dir, vel / spd);
                    sees = cosA >= cos(radians(uParticleLifeVisionAngle) * 0.5);
                  }
                }
                if (sees) behForce += dir * (uParticleLifePursue * pc - uParticleLifeEvade * ec) * band;
              }
            }
          }
        }
      }
      vel += plForce * uParticleLifeStrength * uDelta * 45.0;
      vel += behForce * uDelta * 45.0;
      // Meander (Phase AA1): per-particle wander — the phase is the
      // particle's own (plHash family), the sines sample its own
      // position, so neighbours wander differently. Amount 0 skips
      // the term entirely. TS twin: meanderVector.
      if (uParticleLifeMeanderAmount > 0.0) {
        float selfIdx = floor(vUv.y * uTexSizeF) * uTexSizeF + floor(vUv.x * uTexSizeF);
        float mPhase = plHash(selfIdx + 17.17) * 6.2831853;
        float mScale = 0.02 * max(uParticleLifeMeanderScale, 0.001);
        float mTime = uTime * 0.7;
        vec3 mVec = vec3(
          sin(pos.y * mScale + mPhase + mTime),
          sin(pos.z * mScale + mPhase * 1.7 + mTime),
          sin(pos.x * mScale + mPhase * 2.3 + mTime));
        vel += mVec * uParticleLifeMeanderAmount * uDelta * 30.0;
      }
      // Obstacle avoidance (Phase AB): the third Steering term —
      // a push along the SDF collider's normal, quadratic in the
      // proximity inside the vision range (same range fallback as
      // the vision gate: 0 = interaction radius). Only acts while
      // the collider is enabled. TS twin: obstacleAvoidForce in
      // lib/particleLifeBehavior.ts.
      if (uParticleLifeAvoid > 0.0 && uSdfEnabled) {
        float aRange = uParticleLifeVisionRange > 0.0 ? uParticleLifeVisionRange : plRadius;
        float aSd = abSdfDistance(pos);
        if (aSd < aRange) {
          float aw = clamp(1.0 - aSd / aRange, 0.0, 1.0);
          vel += abSdfNormal(pos) * (uParticleLifeAvoid * aw * aw) * uDelta * 45.0;
        }
      }
      vel *= pow(clamp(uParticleLifeFriction, 0.0, 1.0), uDelta * 60.0);
      // Max speed (Phase AA1): 0 = uncapped (legacy).
      if (uParticleLifeMaxSpeed > 0.0) {
        float spd2 = length(vel);
        if (spd2 > uParticleLifeMaxSpeed) vel *= uParticleLifeMaxSpeed / spd2;
      }
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
      float tick = floor(replicaTime * uLevyRate);
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
        vnoise(pos * 0.01 + replicaSeed + vec3(replicaTime * 0.3, 0.0, 0.0)),
        vnoise(pos * 0.01 + replicaSeed + vec3(1.7, replicaTime * 0.25, 0.0)),
        vnoise(pos * 0.01 + replicaSeed + vec3(0.0, 3.1, replicaTime * 0.2))
      ) * uWindGust;
      vel += (normalize(vec3(uWindX, uWindY, uWindZ) + vec3(0.0001)) * uWindStrength + gust) * uDelta * 30.0;
    }

    // Terrain slope flow (Phase AE): run downhill along the
    // terrain gradient, proportional to the local slope. The
    // field is the XZ plane over [-uSlopeExtent, +uSlopeExtent];
    // outside it the edge texels clamp, so the flow follows the
    // border slope instead of vanishing.
    if (uSlopeForceEnabled) {
      vec2 slopeUv = clamp(pos.xz / (2.0 * max(uSlopeExtent, 0.001)) + 0.5, 0.0, 1.0);
      vec3 slopeSample = texture2D(uSlopeTex, slopeUv).rgb;
      vec2 downhill = slopeSample.rg * 2.0 - 1.0;
      vel += vec3(downhill.x, 0.0, downhill.y) * (slopeSample.b * uSlopeForceStrength) * uDelta * 30.0;
    }

    // Gravity Well(s). Count 1 keeps the exact legacy single well at
    // the origin; counts 2-4 (B3) place the wells on a slowly rotating
    // ring of radius uWellSpread, each with the same force law.
    if (uWellEnabled) {
      if (uWellCount <= 1) {
        vec3 toCenter = -pos;
        float d = length(toCenter) + uWellSoftening;
        vel += (toCenter / (d * d)) * uWellStrength * uDelta * 2000.0;
        vec3 tangent2 = cross(normalize(toCenter + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
        vel += tangent2 * uWellOrbit * uDelta * 50.0;
      } else {
        for (int wi = 0; wi < 4; wi++) {
          if (wi >= uWellCount) break;
          float wa = uTime * 0.35 + float(wi) * 6.2831853 / float(uWellCount);
          vec3 wellPos = vec3(cos(wa), 0.35 * sin(wa * 1.3), sin(wa)) * uWellSpread;
          vec3 toWell = wellPos - pos;
          float wd = length(toWell) + uWellSoftening;
          vel += (toWell / (wd * wd)) * uWellStrength * uDelta * 2000.0;
          vec3 wellTangent = cross(normalize(toWell + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
          vel += wellTangent * uWellOrbit * uDelta * 50.0;
        }
      }
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
      // Surface tension (Phase AB, cohesion approximation): the
      // accumulated pull toward neighbours, kernel-weighted.
      vec3 cohesionForce = vec3(0.0);
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
          if (uSphSurfaceTension > 0.0) {
            // Offset-weighted (spring form): the pull grows with
            // the offset and vanishes at zero distance. A
            // constant-magnitude (normalised) pull injected energy
            // under discrete integration and measurably heated /
            // expanded the cloud on the Phase AB real-GPU gate.
            cohesionForce += (oPos - pos) * (w / uSphRadius);
          }
        }
      }
      vel += (pressureForce + viscForce) * uDelta * 15.0;
      if (uSphSurfaceTension > 0.0) {
        // Much gentler gain than pressure / viscosity: at the
        // shared x15 the spring was stiff enough that explicit
        // integration heated the cloud and blew it apart on the
        // Phase AB real-GPU gate (spread grew ~12% instead of
        // shrinking). Cohesion here is a slow bias, not a stiff
        // spring.
        vel += cohesionForce * uSphSurfaceTension * uDelta * 1.0;
      }
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
      vec3 spawnPos = texture2D(uInitPosTex, globalUv).xyz;
      vel += (spawnPos - pos) * uSpringStrength * uDelta * 3.0;
    }

    // Morph Target Attraction (Kinetix integration B1a): each particle
    // owns one target point baked into uMorphTex (same texel layout as
    // the position texture; scale and jitter are baked in). The target
    // cloud orbits around Y by uTime * uMorphOrbitSpeed, matching
    // Kinetix's morphPhase rotation of its sampled clouds.
    //
    // Force law: Kinetix accumulates vel += (target - pos) * strength
    // * dt on the CPU, where its position step is pos += vel * dt.
    // Here the position pass integrates pos += vel * dt * uSpeed * 60,
    // so the same accumulation overshoots into a limit cycle whenever
    // dt grows (measured headless: a diffuse cloud instead of the
    // knot). The adaptation below keeps Kinetix's own stability-guard
    // form — the exponential snap factor 1 - exp(-k * c) it uses past
    // k = 0.85 — and applies it at every strength: the particle's
    // velocity is relaxed toward the velocity that would cover the
    // fraction mf of the remaining distance this step. The approach is
    // frame-rate independent and stable for any dt, and mf reduces to
    // ~strength * dt * 3 for small steps, i.e. Kinetix's spring rate.
    if (uMorphEnabled) {
      vec4 mTexel = texture2D(uMorphTex, globalUv);
      vec3 mTarget = mTexel.xyz;
      // Replica grammar (Phase K): the texel alpha carries the
      // per-copy orbit phase offset in radians (baked); the gain is
      // 1 only when replicas are active and 0 otherwise, so the
      // legacy alpha (= 1) leaves the angle untouched and existing
      // configs render bit-identically.
      float mAng = uTime * uMorphOrbitSpeed + mTexel.w * uMorphReplicaPhaseGain;
      float mCos = cos(mAng);
      float mSin = sin(mAng);
      mTarget = vec3(
        mTarget.x * mCos - mTarget.z * mSin,
        mTarget.y,
        mTarget.x * mSin + mTarget.z * mCos
      );
      float mf = 1.0 - exp(-uMorphStrength * uDelta * 3.0);
      vec3 vWant = (mTarget - pos) * (mf / max(uDelta * uSpeed * 60.0, 0.001));
      vel += (vWant - vel) * clamp(mf + uDelta * 6.0, 0.0, 1.0);

      // OBJ normal initial velocity (Phase O): an emission-style
      // kick along the particle's baked sample normal (companion
      // texture, rotated by the same orbit angle as the target).
      // It fires ONLY at (re)placement — the envelope after the
      // morph bake was (re)built or the speed key changed
      // (uMorphKickStart, set by the scene when either happens;
      // preset applies and OBJ edits re-bake, so they re-emit) and
      // the age-respawn frame (posData.w, the age, has just wrapped
      // to ~0 while the Life system is on) — never as a continuous
      // force, so the morph spring above re-forms the shape once
      // the envelope decays. Speed 0 (the default) skips the whole
      // block: the legacy path stays bit-identical.
      if (uMorphObjNormalSpeed > 0.0) {
        vec3 mNormal = texture2D(uMorphNormalTex, globalUv).xyz;
        mNormal = vec3(
          mNormal.x * mCos - mNormal.z * mSin,
          mNormal.y,
          mNormal.x * mSin + mNormal.z * mCos
        );
        float kickEnv = exp(-max(uTime - uMorphKickStart, 0.0) * 4.5);
        if (uAgeEnabled && posData.w < uDelta * 1.5) kickEnv = 1.0;
        if (kickEnv > 0.003) {
          vel = mix(vel, mNormal * uMorphObjNormalSpeed, clamp(kickEnv * 0.45, 0.0, 0.45));
        }
      }
    }

    // Force over Lifetime capture (Phase AC): the velocity after
    // the built-in force accumulation (gravity … morph). The
    // collider / mouse / paint / floor / fluid / custom blocks
    // below are NOT part of the scaled delta.
    vec3 velAfterForces = vel;

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
      } else if (uSdfShape == 4) {
        // Gyroid (B3): sd is the gradient-normalised field value; the
        // g < 0 labyrinth is the solid side.
        sd = gyroidField(pos, sc, uSdfSize) * uSdfSize * 0.227;
        sn = gyroidNormal(pos, sc, uSdfSize);
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

    // Terrain Collider (Phase AI) — velocity response on the
    // height field: the floor bounce's response generalised to
    // the terrain normal (reflect the normal component with
    // restitution, damp the tangential component with friction,
    // which is what lets particles come to rest on a slope
    // instead of sliding forever). Only inside the field domain
    // — outside it there is no terrain and particles fall
    // through — and only near the surface; the position pass
    // owns the exact push-out.
    if (uTerrainColliderEnabled) {
      vec2 tcUv = pos.xz / (2.0 * max(uTerrainExtent, 0.001)) + 0.5;
      if (tcUv.x >= 0.0 && tcUv.x <= 1.0 && tcUv.y >= 0.0 && tcUv.y <= 1.0) {
        vec3 tc = terrainColliderSample(tcUv);
        if (pos.y < tc.x + 1.0) {
          vec3 tn = normalize(vec3(-tc.y, 1.0, -tc.z));
          float vn = dot(vel, tn);
          if (vn < 0.0) {
            vec3 vN = tn * vn;
            vec3 vT = vel - vN;
            vel = vT * (1.0 - uTerrainFriction) - vN * uTerrainBounce;
          }
        }
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
        } else if (uMouseMode == 2) { // swirl (mode 3 = paint, handled separately below)
          vec3 swirl = cross(dir, vec3(0.0, 1.0, 0.001));
          vel += normalize(swirl) * falloff * uMouseStrength * uDelta * 150.0;
        }
      }
    }

    // Pointer paint (B3): the gate hash is shared with the position
    // pass, which teleports gated particles to the brush this same
    // frame; here they receive a fresh random velocity so the painted
    // particles stream away from the pointer instead of freezing.
    if (uMouseEnabled && uMouseMode == 3) {
      float paintTick = floor(uTime * 30.0);
      float paintGate = paintHash(vUv, paintTick);
      if (paintGate < uMousePaintRate * 0.008) {
        vec3 paintHashDir = hash3(vec3(vUv * 517.3, paintTick * 3.71));
        float paintSpeedMix = fract(paintGate * 91.7 + paintTick * 0.013);
        vel = normalize(paintHashDir + vec3(0.0001)) * (6.0 + 26.0 * paintSpeedMix) * max(uMouseStrength, 0.05);
      }
    }

    // Floor bounce (B3): reflect the downward velocity at the floor
    // plane with restitution and Kinetix's 0.92 tangential friction.
    // The position pass clamps penetration, so this only ever fires
    // for particles at (or just below) the plane.
    if (uFloorEnabled && pos.y < uFloorY + 0.5 && vel.y < 0.0) {
      vel.y = -vel.y * uFloorBounce;
      vel.x *= 0.92;
      vel.z *= 0.92;
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

    // Force over Lifetime (Phase AC): scale only the built-in
    // force delta captured above; everything after it (collisions,
    // mouse, paint, floor, fluid, custom force) is added back
    // unscaled. A factor of exactly 1 reconstructs vel bit-for-bit,
    // and the passes suppress an all-ones curve outright.
    if (uAgeCurveForceEnabled) {
      float fmul = kaloEvalCurve5(ageNorm, uAgeCurveForce[0], uAgeCurveForce[1], uAgeCurveForce[2], uAgeCurveForce[3], uAgeCurveForce[4]);
      vel = velForceBase + (velAfterForces - velForceBase) * fmul + (vel - velAfterForces);
    }

    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    // Global max speed (Phase AB): the Particle Life cap semantics
    // promoted to the whole pool, applied after the legacy hard
    // clamp and before damping — the same order as inside the
    // Particle Life block. 0 (default) skips it.
    if (uMaxSpeed > 0.0) {
      float spd2 = length(vel);
      if (spd2 > uMaxSpeed) vel *= uMaxSpeed / spd2;
    }
    // Global drag (Phase AB): at the default rate the legacy
    // literal expression runs verbatim — reading the rate from a
    // uniform made the Metal compiler reassociate the product
    // and drift the result by ~1 ulp (measured on the Phase AB
    // gate: a GPGPU subject differed from prod by 2e-8), the
    // Phase Q lesson. Non-default rates take the uniform form.
    if (uDragRate == 1.1) {
      vel *= (1.0 - 1.1 * uDelta);
    } else {
      vel *= (1.0 - uDragRate * uDelta);
    }

    float dist = length(pos);
    if (dist > uBounceRadius) {
      vec3 n = pos / dist;
      float vn = dot(vel, n);
      if (vn > 0.0) vel -= n * vn * (1.0 + uBounce);
    }

    // Velocity over Lifetime (Phase AC): the curve multiplies the
    // final velocity. ×1.0 is exact in IEEE arithmetic, and the
    // passes additionally suppress an all-ones curve outright.
    if (uAgeCurveVelocityEnabled) {
      vel *= kaloEvalCurve5(ageNorm, uAgeCurveVelocity[0], uAgeCurveVelocity[1], uAgeCurveVelocity[2], uAgeCurveVelocity[3], uAgeCurveVelocity[4]);
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
