// ── Velocity sim fragment, part 2 of 5: helper functions: noise / curl, SDF, hashes, terrain collider, attributes, curves ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
export const VEL_FRAG_HELPERS = /* glsl */ `  float dmHash11(float n) {
    vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 hash3(vec3 p) {
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0 * vec3(dmHash11(p.x), dmHash11(p.y), dmHash11(p.z));
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
    return dmHash11(dot(uv * 913.7 + vec2(tick * 17.31, tick * 7.77), vec2(127.1, 311.7)));
  }

  // Spawn gate hash (Phase AB): the position shader's hash1 family
  // at a fixed offset — the identical expression lives in the
  // position pass and in lib/gpgpuLifecycle.ts (spawnHashForUv), so
  // all three agree on which particles are released.
  float spawnHash(vec2 uv) {
    return dmHash11(dot(uv + vec2(7.77, 3.13), vec2(127.1, 311.7)));
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

  // Pulse cycles + probability (Phase AX): cycle k fires when
  // the cycle hash (Phase DM: dmHash11 of (k + 1) * 127.1 +
  // 3.13 * 311.7) falls below uSpawnPulseProbability. The
  // extended pulse time sums live time over fired cycles only —
  // the first 64 cycles exactly, the expectation beyond (the TS
  // twin spawnPulseTimeExtended in lib/gpgpuLifecycle.ts uses the
  // identical bound). Cycles 0 + probability 1 delegates to the
  // legacy spawnPulseTime above, verbatim.
  float spawnPulseCycleFires(float k) {
    return dmHash11((k + 1.0) * 127.1 + 3.13 * 311.7) < uSpawnPulseProbability ? 1.0 : 0.0;
  }
  float spawnPulseTimeEx(float t) {
    float tt = max(t, 0.0);
    if (uSpawnPulseInterval <= 0.0) return tt;
    if (uSpawnPulseCycles <= 0.0 && uSpawnPulseProbability >= 1.0) return spawnPulseTime(tt);
    float iv = uSpawnPulseInterval;
    float d = uSpawnPulseDuty;
    float cyc = tt / iv;
    float whole = floor(cyc);
    float fracPart = cyc - whole;
    bool capped = uSpawnPulseCycles > 0.0;
    if (capped && whole > uSpawnPulseCycles) whole = uSpawnPulseCycles;
    float live = 0.0;
    float exact = min(whole, 64.0);
    for (int k = 0; k < 64; k++) {
      if (float(k) >= exact) break;
      live += spawnPulseCycleFires(float(k)) * d * iv;
    }
    if (whole > 64.0) live += uSpawnPulseProbability * (whole - 64.0) * d * iv;
    if (!capped || cyc < uSpawnPulseCycles) {
      float cur = whole < 64.0 ? spawnPulseCycleFires(whole) : uSpawnPulseProbability;
      live += cur * min(fracPart, d) * iv;
    }
    return live;
  }

  // Spawn gate value (Phase AX): mode 0 is the legacy spawnHash;
  // mode 1 reads the baked max-normalised initial distance from
  // the order texture (buildSpawnDistanceValues in
  // lib/gpgpuLifecycle.ts). The passes resolve mode 0 whenever
  // the texture is not ready, so the fallback is the legacy order.
  float spawnGateValue(vec2 uv) {
    if (uSpawnOrderMode == 0) return spawnHash(uv);
    float v = texture2D(uSpawnOrderTex, uv).r;
    return uSpawnOrderMode == 2 ? 1.0 - v : v;
  }

  // Spawn burst event (Phase AX): the cohort hash and the
  // directly specified initial velocity. TS twins:
  // spawnEventHashForUv / spawnEventVelocity in
  // lib/gpgpuLifecycle.ts — the hash draws and the blend law are
  // identical, so the position pass (cohort → respawn) and this
  // pass (cohort → velocity) always pick the same particles.
  float spawnEventHash(vec2 uv) {
    return dmHash11(dot(uv + vec2(5.39, 8.17), vec2(127.1, 311.7)));
  }
  vec3 spawnEventVelocity(vec3 pos, vec2 uv) {
    float th = dmHash11(dot(uv + vec2(2.71, 6.13), vec2(127.1, 311.7))) * 6.28318530718;
    float phi = acos(2.0 * dmHash11(dot(uv + vec2(9.43, 4.29), vec2(127.1, 311.7))) - 1.0);
    float magHash = dmHash11(dot(uv + vec2(7.77, 1.93), vec2(127.1, 311.7)));
    vec3 randDir = vec3(sin(phi) * cos(th), sin(phi) * sin(th), cos(phi));
    vec3 radial = length(pos) > 0.0001 ? normalize(pos) : vec3(0.0, 1.0, 0.0);
    vec3 dir = normalize(mix(radial, randDir, uSpawnEventSpread));
    float mag = uSpawnEventSpeed * mix(1.0, 0.25 + 0.75 * magHash, uSpawnEventSpread);
    return dir * mag;
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

  // Mesh SDF (Phase BY): the baked grid's query, under the same
  // contract as abSdfDistance / abSdfNormal (negative = inside,
  // world units, degenerate normal = +Y). The texture holds
  // normalised distances; outside the domain cube the query is
  // +1e6 (no collision), never a clamped underestimate. An
  // identical copy lives in the position pass.
  float meshSdfDistance(vec3 p) {
    vec3 q = (p - uMeshSdfOrigin) / uMeshSdfDomainWorld;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z < 0.0 || q.z > 1.0) return 1.0e6;
    return texture2D(uMeshSdfTex, q).r * uMeshSdfScale;
  }
  vec3 meshSdfNormal(vec3 p) {
    float e = uMeshSdfVoxelWorld * 0.5;
    vec3 g = vec3(
      meshSdfDistance(p + vec3(e, 0.0, 0.0)) - meshSdfDistance(p - vec3(e, 0.0, 0.0)),
      meshSdfDistance(p + vec3(0.0, e, 0.0)) - meshSdfDistance(p - vec3(0.0, e, 0.0)),
      meshSdfDistance(p + vec3(0.0, 0.0, e)) - meshSdfDistance(p - vec3(0.0, 0.0, e)));
    float gl = length(g);
    return gl > 0.0001 ? g / gl : vec3(0.0, 1.0, 0.0);
  }

  // Multi-body mesh SDF: per-body query into the 2x2 atlas held
  // in uMeshSdfTex. q is clamped to the body's own texel centres
  // (half a voxel in UV) before the cell offset is applied, so
  // trilinear filtering can never bleed into a neighbouring
  // cell. Outside the body's domain the query is +1e6.
  float meshSdfBodyDistance(int i, vec3 p) {
    float domain = uMeshSdfBodyDomain[i];
    if (domain <= 0.0) return 1.0e6;
    vec3 q = (p - uMeshSdfBodyOrigin[i]) / domain;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z < 0.0 || q.z > 1.0) return 1.0e6;
    float eps = 0.5 * uMeshSdfBodyVoxel[i] / domain;
    vec3 qc = clamp(q, vec3(eps), vec3(1.0 - eps));
    vec3 aq = vec3(uMeshSdfBodyCell[i] + qc.xy * 0.5, qc.z);
    return texture2D(uMeshSdfTex, aq).r * uMeshSdfBodyScale[i];
  }
  vec3 meshSdfBodyNormal(int i, vec3 p) {
    float e = uMeshSdfBodyVoxel[i] * 0.5;
    // Defect fix 2026-11-27: clamp the taps into the domain box
    // (shrunk by e) before sampling. Outside the domain the
    // distance function returns 1e6, so an unclamped tap within
    // e of a face collapsed the gradient onto the face axis —
    // reachable at small scales, where the velocity pass already
    // engages at sd < 2 near the boundary.
    vec3 nLo = uMeshSdfBodyOrigin[i] + vec3(e);
    vec3 nHi = max(nLo, uMeshSdfBodyOrigin[i] + vec3(uMeshSdfBodyDomain[i] - e));
    vec3 g = vec3(
      meshSdfBodyDistance(i, clamp(p + vec3(e, 0.0, 0.0), nLo, nHi)) - meshSdfBodyDistance(i, clamp(p - vec3(e, 0.0, 0.0), nLo, nHi)),
      meshSdfBodyDistance(i, clamp(p + vec3(0.0, e, 0.0), nLo, nHi)) - meshSdfBodyDistance(i, clamp(p - vec3(0.0, e, 0.0), nLo, nHi)),
      meshSdfBodyDistance(i, clamp(p + vec3(0.0, 0.0, e), nLo, nHi)) - meshSdfBodyDistance(i, clamp(p - vec3(0.0, 0.0, e), nLo, nHi)));
    float gl = length(g);
    return gl > 0.0001 ? g / gl : vec3(0.0, 1.0, 0.0);
  }

  // Particle Life species: fixed per particle, derived from the texel
  // index with the same hash the points readout uses, so sim and draw
  // always agree on which species a particle belongs to.
  float plHash(float n) {
    return dmHash11(n * 3.71 + 17.17);
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

  // Attribute channel picker (Phase AK): the slot layout of
  // buildAttributeData in lib/gpgpuAttributes.ts (R/G/B/A = slots
  // 0/1/2/3). An identical copy lives in the points shader.
  float kaloAttrChannel(vec4 a, int slot) {
    if (slot == 0) return a.r;
    if (slot == 1) return a.g;
    if (slot == 2) return a.b;
    return a.a;
  }

  // Group membership (Phase AK): inclusive boundaries, composed
  // from step() so it matches groupMembership in
  // lib/gpgpuAttributes.ts exactly — step(av, high) is 1 exactly
  // when av <= high, step(low, av) is 1 exactly when av >= low.
  // Modes: 0 below (av <= high), 1 above (av >= low), 2 band.
  float kaloGroupMembership(float av, int mode, float low, float high, bool invert) {
    float m;
    if (mode == 0) m = step(av, high);
    else if (mode == 1) m = step(low, av);
    else m = step(low, av) * step(av, high);
    return invert ? 1.0 - m : m;
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

  // Quaternion rotation (Phase AU): GLSL twin of quatRotate in
  // lib/rigidBodies.ts.
  vec3 kaloQuatRotate(vec4 q, vec3 v) {
    vec3 u = q.xyz;
    return v + 2.0 * cross(u, cross(u, v) + q.w * v);
  }

`;
