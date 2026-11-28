// ── Velocity sim fragment, part 2 of 5: helper functions: noise / curl, SDF, hashes, terrain collider, attributes, curves ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
import { DM_HASH11_GLSL_INDENTED } from '../lib/gpgpuRandom';
import { localTimeFactorGlsl } from '../lib/gpgpuLocalTime';
export const VEL_FRAG_HELPERS = /* glsl */ `${DM_HASH11_GLSL_INDENTED}  vec3 hash3(vec3 p) {
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
  // normalised distances. An identical copy lives in the
  // position pass.
  // Domain extension (Gate 58h fix, 2026-11-27): outside the
  // domain cube the query returns the boundary sample plus the
  // Euclidean distance to the cube, instead of the +1e6 it
  // returned before. The bake domain is sized for the
  // collision contract (the mesh sits inside the cube with a
  // margin band), but steering reads the same field out to
  // its avoid range (Rout), where +1e6 made the body vanish
  // from the min(sd) synthesis (diagnosis:
  // GATE58H_BAKE_SDF_DIAGNOSIS — the switch point against the
  // analytic primitive sat on the cube face, not at the
  // midpoint). The extension keeps the field in the same
  // units and continuous across the face, and it is always
  // positive outside (the boundary sample of a mesh baked
  // strictly inside the cube is positive), so the position
  // push-out (sd < 0) can never fire on an extended value and
  // every in-domain value is bit-identical to before.
  float meshSdfDistance(vec3 p) {
    vec3 q = (p - uMeshSdfOrigin) / uMeshSdfDomainWorld;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z < 0.0 || q.z > 1.0) {
      vec3 qc = clamp(q, vec3(0.0), vec3(1.0));
      return texture2D(uMeshSdfTex, qc).r * uMeshSdfScale
        + length((q - qc) * uMeshSdfDomainWorld);
    }
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
  // cell. Outside the body's domain the query applies the
  // domain extension documented on meshSdfDistance above (the
  // boundary sample of the body's own cell, plus the distance
  // to the domain cube); an absent body (domain <= 0) stays
  // +1e6.
  float meshSdfBodyDistance(int i, vec3 p) {
    float domain = uMeshSdfBodyDomain[i];
    if (domain <= 0.0) return 1.0e6;
    vec3 q = (p - uMeshSdfBodyOrigin[i]) / domain;
    float eps = 0.5 * uMeshSdfBodyVoxel[i] / domain;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z < 0.0 || q.z > 1.0) {
      vec3 qo = clamp(q, vec3(0.0), vec3(1.0));
      vec3 qc = clamp(qo, vec3(eps), vec3(1.0 - eps));
      vec3 aq = vec3(uMeshSdfBodyCell[i] + qc.xy * 0.5, qc.z);
      return texture2D(uMeshSdfTex, aq).r * uMeshSdfBodyScale[i]
        + length((q - qo) * domain);
    }
    vec3 qc = clamp(q, vec3(eps), vec3(1.0 - eps));
    vec3 aq = vec3(uMeshSdfBodyCell[i] + qc.xy * 0.5, qc.z);
    return texture2D(uMeshSdfTex, aq).r * uMeshSdfBodyScale[i];
  }
  vec3 meshSdfBodyNormal(int i, vec3 p) {
    float e = uMeshSdfBodyVoxel[i] * 0.5;
    // Domain extension (Gate 58h fix): for a point outside the
    // domain, the clamped taps below would all land on the same
    // face point and collapse the gradient, so take unclamped
    // taps on the extended distance instead — the extension
    // made the field continuous across the face, so the
    // differences are well defined there. In-domain points
    // keep the clamped-tap path below, bit-identical.
    if (uMeshSdfBodyDomain[i] > 0.0) {
      vec3 domLo = uMeshSdfBodyOrigin[i];
      vec3 domHi = domLo + vec3(uMeshSdfBodyDomain[i]);
      if (any(lessThan(p, domLo)) || any(greaterThan(p, domHi))) {
        vec3 g = vec3(
          meshSdfBodyDistance(i, p + vec3(e, 0.0, 0.0)) - meshSdfBodyDistance(i, p - vec3(e, 0.0, 0.0)),
          meshSdfBodyDistance(i, p + vec3(0.0, e, 0.0)) - meshSdfBodyDistance(i, p - vec3(0.0, e, 0.0)),
          meshSdfBodyDistance(i, p + vec3(0.0, 0.0, e)) - meshSdfBodyDistance(i, p - vec3(0.0, 0.0, e)));
        float gl = length(g);
        return gl > 0.0001 ? g / gl : vec3(0.0, 1.0, 0.0);
      }
    }
    // Defect fix 2026-11-27: clamp the taps into the domain box
    // (shrunk by e) before sampling. When the distance function
    // returned 1e6 outside the domain, an unclamped tap within
    // e of a face collapsed the gradient onto the face axis —
    // reachable at small scales, where the velocity pass already
    // engages at sd < 2 near the boundary. The clamp is kept for
    // in-domain points so their gradients stay bit-identical;
    // outside points take the unclamped branch above.
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

// Emitter initial velocity (Grammar 2.0 stage 2, slice E2):
// the GLSL twin of directedInitialVelocity in
// lib/gpgpuLifecycle.ts — the spawn event's velocity law
// with the base direction authored (uEmitterVelDir, the
// CPU-normalised axis) instead of radial. The hash draws
// and the blend law are the event's own, term for term, so
// with the axis equal to the radial direction this returns
// exactly what spawnEventVelocity returns. Spliced in only
// behind the emitterVelocity option (see buildVelocityHelpers
// and buildVelocityFragment) — the stock helpers string
// above is untouched.
export const VEL_FRAG_EMITTER_VELOCITY_FN = /* glsl */ `
  // Emitter directed initial velocity (stage 2, E2): TS
  // twin directedInitialVelocity in lib/gpgpuLifecycle.ts.
  vec3 kaloEmitterVelocity(vec2 uv) {
    float th = dmHash11(dot(uv + vec2(2.71, 6.13), vec2(127.1, 311.7))) * 6.28318530718;
    float phi = acos(2.0 * dmHash11(dot(uv + vec2(9.43, 4.29), vec2(127.1, 311.7))) - 1.0);
    float magHash = dmHash11(dot(uv + vec2(7.77, 1.93), vec2(127.1, 311.7)));
    vec3 randDir = vec3(sin(phi) * cos(th), sin(phi) * sin(th), cos(phi));
    vec3 dir = normalize(mix(uEmitterVelDir, randDir, uEmitterVelSpread));
    float mag = uEmitterVelSpeed * mix(1.0, 0.25 + 0.75 * magHash, uEmitterVelSpread);
    return dir * mag;
  }
`;

// Emitter list (Layer 1 WP4, phase D3): while an authored
// emitter list stands (lib/gpgpuEmitterList.ts:
// emitterListActive), the list REPLACES the single-emitter
// velocity law — each particle is handed ITS OWN emitter's
// directed velocity, read from the emitter's record in the
// shared column texture (7 texels per element from
// uEmittersBase: T2.w velMode / T4 dir + speed / T5.x
// spread). The assignment hash and band walk are the
// position pass's (phase D2), and the directed law is
// directedInitialVelocity with the record's values as
// parameters — term for term the single-emitter function
// above, whose uniforms the CPU fills from the same law.
// Spliced in only behind the emitterList option (see
// buildVelocityHelpers and buildVelocityFragment) — the
// stock helpers string above is untouched.
export const VEL_FRAG_EMITTER_LIST_FN = /* glsl */ `
  // Emitter list (Layer 1 WP4, phase D3): SYNC:
  // emitterAssignHash is the GLSL twin of emitterHashForUv
  // in lib/gpgpuEmitterList.ts — dmHash11 of
  // ((u + 17.17) * 127.1 + (v + 9.43) * 311.7), written here
  // in the dot form the velocity helpers use; keep the
  // offset constants (17.17, 9.43) in sync there.
  float emitterAssignHash(vec2 uv) {
    return dmHash11(dot(uv + vec2(17.17, 9.43), vec2(127.1, 311.7)));
  }

  // Emitter directed velocity, parameterised (Layer 1 WP4,
  // phase D3): TS twin directedInitialVelocity in
  // lib/gpgpuLifecycle.ts with the base direction / speed /
  // spread passed in — the same law kaloEmitterVelocity
  // evaluates over its uniforms.
  vec3 kaloEmitterDirectedVelocity(vec3 baseDir, float speed, float spread, vec2 uv) {
    float th = dmHash11(dot(uv + vec2(2.71, 6.13), vec2(127.1, 311.7))) * 6.28318530718;
    float phi = acos(2.0 * dmHash11(dot(uv + vec2(9.43, 4.29), vec2(127.1, 311.7))) - 1.0);
    float magHash = dmHash11(dot(uv + vec2(7.77, 1.93), vec2(127.1, 311.7)));
    vec3 randDir = vec3(sin(phi) * cos(th), sin(phi) * sin(th), cos(phi));
    vec3 dir = normalize(mix(baseDir, randDir, spread));
    float mag = speed * mix(1.0, 0.25 + 0.75 * magHash, spread);
    return dir * mag;
  }

  // The particle's own emitter's directed velocity (Layer 1
  // WP4, phase D3): the assignment walk over the weight
  // bands (the position pass's walk, phase D2), then the
  // element record. The w component is the directed flag:
  // 0 while the element's velocity mode is 'cube' — a cube
  // element has no directed handover, so the activation
  // segment leaves the velocity untouched (exactly the
  // single-emitter cube behaviour).
  vec4 kaloEmitterVelocityList(vec2 uv) {
    float emHash = emitterAssignHash(uv);
    int emIdx = 0;
    for (int emK = 0; emK < 8; emK++) {
      if (emK >= uEmitterCount) break;
      emIdx = emK;
      if (kaloColFetch(uEmittersBase + float(emK * 7)).w > emHash) break;
    }
    float emRec = uEmittersBase + float(emIdx * 7);
    if (kaloColFetch(emRec + 2.0).w < 0.5) return vec4(0.0);
    vec4 emT4 = kaloColFetch(emRec + 4.0);
    vec4 emT5 = kaloColFetch(emRec + 5.0);
    return vec4(kaloEmitterDirectedVelocity(emT4.xyz, emT4.w, emT5.x, uv), 1.0);
  }
`;

/**
 * Texture-unit fix (Grammar 2.0 stage 1): in the live-rules
 * variant, spawnGateValue derives the baked distance from
 * the initial-position texture instead of sampling the
 * spawn-order texture, so the live preamble can drop that
 * sampler and stay inside the 16-unit floor (see
 * gpgpuShaderSimulationVelocityPreamble.ts at
 * VEL_FRAG_SPAWN_ORDER_DECL_STOCK and
 * kalokagathia-pro/STAGE1_TEXUNIT_FIX_RECORD.md). The value
 * is the same max-normalised initial distance the bake
 * stores (buildSpawnDistanceValues in lib/gpgpuLifecycle.ts;
 * CPU twin spawnGateDistanceValue there): the order texture
 * is baked from the same initial positions, with the same
 * normaliser, supplied here as uSpawnOrderMaxDist. The
 * position pass's live variant derives identically, so the
 * two passes keep picking the same particles. The stock
 * line occurs exactly once in the helpers.
 */
export const VEL_FRAG_SPAWN_GATE_READ_STOCK = '    float v = texture2D(uSpawnOrderTex, uv).r;';
export const VEL_FRAG_SPAWN_GATE_READ_LIVE = '    float v = clamp(length(texture2D(uInitPosTex, uv).xyz) / max(uSpawnOrderMaxDist, 1.0e-6), 0.0, 1.0);';

// Column-data fetch (Grammar 2.0 stage 2, B1; shared with
// B2 since): texel-unit addressing over the shared column
// texture; the section bases are the CPU allocator's offsets
// (lib/gpgpuFieldInstances.ts / lib/gpgpuPathAssets.ts).
// Spliced in behind either consuming option (fieldInstances
// / pathAssets) — the stock helpers string is untouched.
export const VEL_FRAG_COLUMN_FN = /* glsl */ `
  vec4 kaloColFetch(float idx) {
    float cx = mod(idx, uColWidth);
    float cy = floor(idx / uColWidth);
    return texture2D(uColTex, vec2((cx + 0.5) / uColWidth, (cy + 0.5) / uColHeight));
  }
`;

// Merged-supply form of the column fetch (stage 2
// texture-unit follow-up): the column data rides in the
// strip above the live square of the merged texture, packed
// linearly in the column layout's texel order (the REP
// pass's blitColumn writes it there), so the linear index
// remaps into strip coordinates of the merged width. The
// section bases and every consumer are unchanged — only the
// fetch's address math moves.
export const VEL_FRAG_COLUMN_FN_MERGED = /* glsl */ `
  vec4 kaloColFetch(float idx) {
    float sx = mod(idx, uTexSizeF);
    float sy = floor(idx / uTexSizeF);
    return texture2D(uMergedTex, vec2((sx + 0.5) / uTexSizeF, (uTexSizeF + sy + 0.5) / uMergedTexHeight));
  }
`;

// Field instances (Grammar 2.0 stage 2, slice B1): the GLSL
// twin of fieldInstanceForce in lib/gpgpuFieldInstances.ts —
// the legacy vortex / well / wind laws localised by the wind
// volume's (1-(d/R)^2)^2 falloff, evaluated per instance over
// the column-data texture and summed (additive composition
// over the legacy singletons, which keep their own chunks).
// The layer weight comes from the instance's layer record;
// while uFieldLayerAttrEnabled holds, a layer naming a slot
// further multiplies it by the particle's attribute channel
// (design decision 1: continuous modulation rides attribute
// slots). The per-kind force gates arrive as parameters —
// the stock chunk passes 1.0 for vortex / well, the live
// chunk variant passes the REP gate locals, exactly like the
// other gated chunks are derived. Spliced in only behind
// the fieldInstances option (see buildVelocityHelpers and
// buildVelocityFragment) — the stock helpers string above
// is untouched.
export const VEL_FRAG_FIELD_FN = /* glsl */ `
  // Field instances (stage 2, B1): TS twin fieldInstanceForce
  // in lib/gpgpuFieldInstances.ts (the gates multiply there
  // at the call site, here per kind inside the sum).
  vec3 kaloFieldForce(vec3 pos, vec4 attrData, vec3 replicaSeed, float replicaTime, float grpWind, float grpVortex, float grpWell) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (i >= uFieldInstanceCount) break;
      float fBase = uColFieldsBase + float(i) * 3.0;
      vec4 fA = kaloColFetch(fBase);
      vec4 fB = kaloColFetch(fBase + 1.0);
      vec4 fC = kaloColFetch(fBase + 2.0);
      vec3 rel = pos - fA.xyz;
      float dist = length(rel);
      if (fA.w <= 0.0 || dist >= fA.w) continue;
      float fq = dist / fA.w;
      float fFall = 1.0 - fq * fq;
      fFall *= fFall;
      float layerW = 1.0;
      if (fC.w > 0.5) {
        vec4 fL = kaloColFetch(uColLayersBase + (fC.w - 1.0));
        layerW = fL.r;
        if (uFieldLayerAttrEnabled && fL.g > 0.5) {
          layerW *= kaloAttrChannel(attrData, int(fL.g + 0.5) - 1);
        }
      }
      float wgt = fFall * layerW;
      int kind = int(fC.x + 0.5);
      if (kind == 0) {
        // Vortex instance: the legacy swirl around the
        // instance's own axis, inside its radius.
        vec3 tangent = cross(fB.xyz, rel);
        float tl = length(tangent);
        if (tl > 0.001) acc += (tangent / tl) * (fB.w * wgt * grpVortex) * uDelta * 80.0;
      } else if (kind == 1) {
        // Well instance: the legacy pull + orbit inside its
        // radius (the denominator is floored — a new law, so
        // the zero-softening / zero-distance corner stays
        // finite instead of inheriting the singleton's NaN).
        vec3 toC = -rel;
        float d = max(dist + fC.y, 0.001);
        acc += (toC / (d * d)) * (fB.w * wgt * grpWell) * uDelta * 2000.0;
        vec3 oTan = cross(normalize(toC + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
        acc += oTan * (fC.z * wgt * grpWell) * uDelta * 50.0;
      } else {
        // Wind instance: the wind law with the instance's own
        // direction (the gust stays the global wind's).
        vec3 gust = vec3(
          vnoise(pos * 0.01 + replicaSeed + vec3(replicaTime * 0.3, 0.0, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(1.7, replicaTime * 0.25, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(0.0, 3.1, replicaTime * 0.2))
        ) * uWindGust;
        acc += (fB.xyz * fB.w + gust) * (wgt * grpWind) * uDelta * 30.0;
      }
    }
    return acc;
  }
`;

// Field instances, extended grammar (Layer 1 WP5 phase D):
// the B1 loop generalised. Per-instance falloff shapes and
// per-instance / per-layer group gates ride the extension
// records (lib/gpgpuFieldInstances.ts packFieldExtColumnData);
// the two daemon kinds — drag (3) and crown (4) — join the
// kind switch, their parameters read from the extension
// record's third texel. The drag law needs the particle's
// current velocity, so this form takes `vel` where the B1
// form does not. Spliced INSTEAD of VEL_FRAG_FIELD_FN while
// the fieldExt option stands (which implies fieldInstances);
// the B1 function above stays byte-identical, and every
// pre-Phase-D config keeps building it.
export const VEL_FRAG_FIELD_FN_EXT = /* glsl */ `
  // Field falloff shapes (WP5 phase D): shape ids from
  // lib/gpgpuFieldInstances.ts FALLOFF_SHAPE_IDS; id 0 is the
  // legacy (1-q^2)^2 curve, verbatim.
  float kaloFieldFalloffShape(float shapeId, float dist, float radius) {
    if (shapeId > 1.5) {
      float q = clamp(dist / max(radius, 0.000001), 0.0, 1.0);
      float t = q * q * (3.0 - 2.0 * q);
      return 1.0 - t;
    }
    if (shapeId > 0.5) {
      return clamp(1.0 - dist / max(radius, 0.000001), 0.0, 1.0);
    }
    float fq = dist / radius;
    float f = 1.0 - fq * fq;
    return f * f;
  }
  // One normalised group gate (packFieldGate's form): kind 0
  // is no gate. While the attribute texture is not bound for
  // the gates (uFieldExtAttrEnabled off) the gate reads as
  // fully open — the global gate's no-attribute discipline.
  float kaloFieldGateMult(float gateKind, float slot, float mode, float low, float high, float invert, vec4 attrData) {
    if (gateKind < 0.5 || !uFieldExtAttrEnabled) return 1.0;
    return kaloGroupMembership(kaloAttrChannel(attrData, int(slot + 0.5)), int(mode + 0.5), low, high, invert > 0.5);
  }
  // Field instances, extended (WP5 phase D): TS twins
  // fieldInstanceForce (the laws) and packFieldExtColumnData
  // (the records) in lib/gpgpuFieldInstances.ts.
  vec3 kaloFieldForceExt(vec3 pos, vec3 vel, vec4 attrData, vec3 replicaSeed, float replicaTime, float grpWind, float grpVortex, float grpWell) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (i >= uFieldInstanceCount) break;
      float fBase = uColFieldsBase + float(i) * 3.0;
      vec4 fA = kaloColFetch(fBase);
      vec4 fB = kaloColFetch(fBase + 1.0);
      vec4 fC = kaloColFetch(fBase + 2.0);
      float eBase = uColFieldExtBase + float(i) * 3.0;
      vec4 fE0 = kaloColFetch(eBase);
      vec4 fE1 = kaloColFetch(eBase + 1.0);
      vec4 fE2 = kaloColFetch(eBase + 2.0);
      int kind = int(fC.x + 0.5);
      float layerW = 1.0;
      float layerGate = 1.0;
      if (fC.w > 0.5) {
        vec4 fL = kaloColFetch(uColLayersBase + (fC.w - 1.0));
        layerW = fL.r;
        if (uFieldLayerAttrEnabled && fL.g > 0.5) {
          layerW *= kaloAttrChannel(attrData, int(fL.g + 0.5) - 1);
        }
        float lBase = uColLayerExtBase + (fC.w - 1.0) * 2.0;
        vec4 fL0 = kaloColFetch(lBase);
        vec4 fL1 = kaloColFetch(lBase + 1.0);
        layerGate = kaloFieldGateMult(fL0.x, fL0.y, fL0.z, fL0.w, fL1.x, fL1.y, attrData);
      }
      float gateMult = layerGate * kaloFieldGateMult(fE0.y, fE0.z, fE0.w, fE1.x, fE1.y, fE1.z, attrData);
      if (kind == 4) {
        // Crown instance: the daemon crown law — a Gaussian
        // ring in the XZ plane peaking at the radius,
        // decaying with height through the instance's falloff
        // shape, direction outward + up. Its envelope is
        // cylindrical, so it runs before (and instead of)
        // the spherical skip below.
        if (fA.w > 0.0 && fE2.x > 0.0) {
          vec3 rel = pos - fA.xyz;
          float cy = rel.y;
          if (cy >= 0.0 && cy < fE2.x) {
            float rho = length(rel.xz);
            float cw = fE2.y > 0.0 ? fE2.y : fA.w * 0.5;
            float rq = (rho - fA.w) / cw;
            float ring = exp(-rq * rq);
            float wgt = ring * kaloFieldFalloffShape(fE0.x, cy, fE2.x) * layerW * gateMult;
            if (wgt > 0.0) {
              vec2 out2 = rho > 0.000000001 ? rel.xz / rho : vec2(0.0);
              vec3 dir = vec3(out2.x, 1.0, out2.y);
              acc += dir * ((fB.w * wgt * uDelta * 30.0) / length(dir));
            }
          }
        }
        continue;
      }
      vec3 rel = pos - fA.xyz;
      float dist = length(rel);
      if (fA.w <= 0.0 || dist >= fA.w) continue;
      float fFall = kaloFieldFalloffShape(fE0.x, dist, fA.w);
      float wgt = fFall * layerW * gateMult;
      if (kind == 0) {
        // Vortex instance: as B1, with the shaped falloff and
        // the generalised gates folded into wgt.
        vec3 tangent = cross(fB.xyz, rel);
        float tl = length(tangent);
        if (tl > 0.001) acc += (tangent / tl) * (fB.w * wgt * grpVortex) * uDelta * 80.0;
      } else if (kind == 1) {
        // Well instance: as B1, same generalisation.
        vec3 toC = -rel;
        float d = max(dist + fC.y, 0.001);
        acc += (toC / (d * d)) * (fB.w * wgt * grpWell) * uDelta * 2000.0;
        vec3 oTan = cross(normalize(toC + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
        acc += oTan * (fC.z * wgt * grpWell) * uDelta * 50.0;
      } else if (kind == 3) {
        // Drag instance: the placed drag daemon — the
        // velocity relaxes toward the instance's target
        // velocity at the clamped rate, localised by the
        // falloff (TS twin: daemonDragDeltaV in
        // lib/gpgpuDaemonFields.ts, via fieldInstanceForce).
        float rate = clamp(fB.w, 0.0, 100.0);
        float k = 1.0 - exp(-rate * fFall * uDelta);
        acc += (fE2.xyz - vel) * (k * layerW * gateMult);
      } else {
        // Wind instance: as B1, same generalisation.
        vec3 gust = vec3(
          vnoise(pos * 0.01 + replicaSeed + vec3(replicaTime * 0.3, 0.0, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(1.7, replicaTime * 0.25, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(0.0, 3.1, replicaTime * 0.2))
        ) * uWindGust;
        acc += (fB.xyz * fB.w + gust) * (wgt * grpWind) * uDelta * 30.0;
      }
    }
    return acc;
  }
`;

/** The helpers chunk for a variant build: the stock string,
 *  plus the emitter-velocity function while directed mode is
 *  on. With no option set this IS VEL_FRAG_HELPERS. */
// Local time (Layer 1 WP9, phase D): the per-group time
// factor function (lib/gpgpuLocalTime.ts) — appended only
// behind the localTime option; the stock helpers carry no
// trace of it. It reads the preamble's entry-table uniforms
// and the membership primitives above (kaloAttrChannel /
// kaloGroupMembership), so it spends no sampler.
const VEL_FRAG_LOCAL_TIME_FN = localTimeFactorGlsl();

export function buildVelocityHelpers(options?: { emitterVelocity?: boolean; emitterList?: boolean; particleRulesLive?: boolean; fieldInstances?: boolean; fieldExt?: boolean; pathAssets?: boolean; crowdPathAssets?: boolean; mergedSupply?: boolean; localTime?: boolean }): string {
  // B1: the field variant derives the gate value exactly
  // like the live variant (its preamble dropped the order
  // sampler for the column texture — see the preamble note).
  // B2: the path-assets variant rides the same column
  // texture and the same give-back, so it derives the same
  // way; the column fetch is shared by both consumers and
  // spliced once.
  // D3: the emitter-list variant rides the same column
  // texture and the same give-back, so it derives the same
  // way; while it stands it replaces the single-emitter
  // function (the list function below carries the law).
  const base = options?.particleRulesLive || options?.fieldInstances || options?.fieldExt || options?.pathAssets || options?.crowdPathAssets || options?.emitterList
    ? VEL_FRAG_HELPERS.replace(VEL_FRAG_SPAWN_GATE_READ_STOCK, VEL_FRAG_SPAWN_GATE_READ_LIVE)
    : VEL_FRAG_HELPERS;
  return base
    + (options?.emitterVelocity && !options?.emitterList ? VEL_FRAG_EMITTER_VELOCITY_FN : '')
    + (options?.fieldInstances || options?.fieldExt || options?.pathAssets || options?.crowdPathAssets || options?.emitterList ? (options?.mergedSupply ? VEL_FRAG_COLUMN_FN_MERGED : VEL_FRAG_COLUMN_FN) : '')
    + (options?.emitterList ? VEL_FRAG_EMITTER_LIST_FN : '')
    + (options?.fieldExt ? VEL_FRAG_FIELD_FN_EXT : options?.fieldInstances ? VEL_FRAG_FIELD_FN : '')
    + (options?.localTime ? VEL_FRAG_LOCAL_TIME_FN : '');
}
