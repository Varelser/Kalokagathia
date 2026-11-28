import { EMIT_SHAPE_GLSL } from '../lib/gpgpuEmitShapes';
import { NEIGHBOR_SELF_SKIP_GLSL, NEIGHBOR_SUV_GLSL } from '../lib/gpgpuNeighborLoop';
import { DM_HASH11_GLSL_INDENTED } from '../lib/gpgpuRandom';
import { DIST_GLSL, DIST_MAX_OPS } from '../lib/gpgpuDistribution';
import { EMIT_PATH_GLSL } from '../lib/gpgpuEmissionSource';
import { EMIT_PATH_ASSET_GLSL } from '../lib/gpgpuPathAssets';

// ── Position sim fragment (+ Life/Age in .w) ──
const POS_FRAG_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uBounceRadius;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform float uAgeReplicaStep;
  uniform float uAgeReplicaCount;
  // Replica independent simulation (Phase W2): inside a replica
  // stack every texel belongs to the same copy, so the copy's
  // Phase M restart age arrives as this constant base (the pass
  // runner zeroes uAgeReplicaStep for stacks and supplies
  // index * step * ageMax here). 0 in the shared path.
  uniform float uReplicaAgeBase;
  uniform float uTexSizeF;
  // Vellum (Phase AR): while the constraint solver is active the
  // pointer-paint teleport below is suppressed (it would tear
  // the constraint grid). The projection itself lives in a
  // dedicated pass (gpgpuShaderSimulationVellum.ts); this flag
  // is the position pass's only Vellum surface. False (default)
  // keeps every statement below verbatim.
  uniform bool  uVellumEnabled;
`;
const POS_FRAG_PROJECTION_UNIFORMS = /* glsl */ `  // Grains projection (Phase 19): a Jacobi position-projection
  // segment for the Grains solver — overlapping grain pairs are
  // pushed apart in position, half the overlap per member,
  // scaled by uGrainsProjection. uGrainsProjEnabled is resolved
  // CPU-side (Grains on AND projection strength > 0); false
  // (default for every legacy configuration) skips the segment
  // whole and the pass is verbatim legacy. The neighbourhood
  // scan plan matches the velocity pass (0 = AQ subsample,
  // 1 = complete scan). TS twin: grainsProjectionCorrection in
  // lib/gpgpuGrains.ts.
  uniform bool  uGrainsProjEnabled;
  uniform float uGrainsSize;
  uniform float uGrainsProjection;
  uniform int   uGrainsNeighborhood;
  uniform int   uGrainsSamples;
`;
const POS_FRAG_MID = /* glsl */ `  // Rigid bodies (Phase AU): while the CPU rigid body solver is
  // bound, this pass composes every particle's world position
  // from its body's transform (body texture: row 0 = position +
  // bounding radius, row 1 = quaternion) applied to the
  // particle's local offset in its fracture cell (cell texture:
  // xyz = offset, w = body index). The lifecycle / respawn
  // machinery below never runs — the passes resolve it off
  // CPU-side, and this early return is the hard guarantee.
  // False (default) keeps every statement below verbatim.
  uniform bool  uRigidEnabled;
  uniform sampler2D uRigidCellTex;
  uniform sampler2D uRigidBodyTex;
  uniform bool  uVerletEnabled;
  uniform sampler2D uPrevPosTex;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  uniform float uSdfBounce;
  // Mesh SDF collider (Phase BY): the baked signed-distance grid
  // of the imported OBJ mesh (lib/meshSdfCollider.ts), R16F 3D
  // texture holding NORMALISED distances. Resolved CPU-side
  // (enabled key AND bake complete), so a false uniform is the
  // exact legacy path.
  uniform bool  uMeshSdfEnabled;
  uniform sampler3D uMeshSdfTex;
  uniform vec3  uMeshSdfOrigin;
  uniform float uMeshSdfDomainWorld;
  uniform float uMeshSdfScale;
  uniform float uMeshSdfVoxelWorld;
  // Multi-body mesh SDF: same atlas contract as the velocity
  // pass (no extra sampler; guarded by uMeshSdfMultiEnabled).
  uniform bool  uMeshSdfMultiEnabled;
  uniform int   uMeshSdfBodyCount;
  uniform vec3  uMeshSdfBodyOrigin[4];
  uniform float uMeshSdfBodyDomain[4];
  uniform float uMeshSdfBodyScale[4];
  uniform float uMeshSdfBodyVoxel[4];
  uniform vec2  uMeshSdfBodyCell[4];
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  // Terrain collider (Phase AI): the derived collider bake
  // (RG = 16-bit packed height). Resolved CPU-side like the
  // slope force (enabled key AND terrain mesh on AND plane
  // mode), so a false uniform is the exact legacy path.
  uniform bool  uTerrainColliderEnabled;
  uniform sampler2D uTerrainColliderTex;
  uniform float uTerrainExtent;
  uniform float uTerrainHeightWorld;
  uniform float uTerrainGradScale;
  uniform float uTerrainTexSize;
  uniform bool  uMouseEnabled;
  uniform vec3  uMousePos;
  uniform float uMouseRadius;
  uniform int   uMouseMode;
  uniform float uMousePaintRate;
  // Multi-touch interference (Phase AO): all tracked pointers'
  // world positions (index 0 = primary, same as uMousePos);
  // uMouseCount is 0 unless multi-touch resolved on CPU-side.
  uniform vec3  uMousePosMulti[4];
  uniform int   uMouseCount;
  // Light emitter (Phase T): while the emit shape is 'light', the
  // age respawn re-emits around the light position instead of the
  // origin sphere. False (default) keeps the legacy statement.
  uniform bool  uEmitLight;
  uniform vec3  uEmitLightPos;
  // Lifecycle grammar (Phase AB): spawn gate + kill conditions.
  // uKillMask is resolved CPU-side (key on AND mask texture
  // ready); the mask is the Phase X raster mask image, sampled
  // with the draw clip's own UV rule and threshold / invert keys.
  uniform float uSpawnRate;
  uniform float uSpawnBurst;
  uniform float uSpawnTime;
  // Spawn pulse (Phase AH): interval 0 = off — spawnPulseTime then
  // returns max(t, 0) and the threshold expressions below are the
  // legacy ones verbatim. TS twin: spawnPulseTime in
  // lib/gpgpuLifecycle.ts.
  uniform float uSpawnPulseInterval;
  uniform float uSpawnPulseDuty;
  // Pulse cycles + probability, spawn order and the spawn burst
  // event (Phase AX): identical semantics to the velocity pass —
  // cycles 0 with probability 1 delegates to the legacy pulse
  // time, order mode 0 is the legacy hash, the event is disabled
  // by default. TS twins: lib/gpgpuLifecycle.ts.
  uniform float uSpawnPulseCycles;
  uniform float uSpawnPulseProbability;
  uniform sampler2D uSpawnOrderTex;
  uniform int uSpawnOrderMode;
  uniform bool uSpawnEventEnabled;
  uniform float uSpawnEventTime;
  uniform float uSpawnEventCount;
  // Emission curve (Phase AJ): the free control-point curve asset
  // (lib/freeCurve.ts) as two padded float arrays — unused slots
  // repeat the last point, so the loop below needs no count. The
  // passes resolve the uniform OFF when the key is disabled or the
  // curve is the identity, which keeps the legacy respawn path
  // verbatim. GLSL twin of evaluateFreeCurve.
  uniform bool  uEmissionCurveEnabled;
  uniform float uEmissionCurvePeriod;
  uniform float uEmissionCurveT[8];
  uniform float uEmissionCurveV[8];
  uniform bool  uKillBoundary;
  uniform bool  uKillMask;
  // Collision life (Phase 15, Unity §1): contact with a collider
  // this step (sphere shell clamp / SDF push-out / mesh SDF
  // push-out / floor clamp / terrain clamp) consumes life at
  // uCollisionLifeLoss extra age-seconds per second of contact,
  // or respawns the particle at once when uCollisionKill is on.
  // Both inert by default — no contact is recorded and the pass
  // is bit-identical.
  uniform float uCollisionLifeLoss;
  uniform bool  uCollisionKill;
  uniform sampler2D uKillMaskTex;
  uniform float uKillMaskThreshold;
  uniform bool  uKillMaskInvert;
  // Group kill (Phase DG): the named group referenced by the
  // Gate Group also drives a kill — a particle outside the group
  // respawns now. Membership is read from the attribute bake
  // with the same uniforms the velocity force gate uses (a
  // predicate group supplies its predicate, a baked group reads
  // its membership channel as "above 0.5").
  uniform bool  uGroupKillEnabled;
  uniform sampler2D uAttrTex;
  uniform int   uGroupSlot;
  uniform int   uGroupMode;
  uniform float uGroupLow;
  uniform float uGroupHigh;
  uniform bool  uGroupInvert;
  varying vec2 vUv;

${DM_HASH11_GLSL_INDENTED}  float hash1(vec2 p) {
    return dmHash11(p.x * 127.1 + p.y * 311.7);
  }

  // Spawn gate hash (Phase AB): identical to the velocity pass and
  // to spawnHashForUv in lib/gpgpuLifecycle.ts.
  float spawnHash(vec2 uv) {
    return hash1(uv + vec2(7.77, 3.13));
  }

  // Pulse time (Phase AH): identical to the velocity pass and to
  // spawnPulseTime in lib/gpgpuLifecycle.ts.
  float spawnPulseTime(float t) {
    float tt = max(t, 0.0);
    if (uSpawnPulseInterval <= 0.0) return tt;
    float cyc = tt / uSpawnPulseInterval;
    float whole = floor(cyc);
    float fracPart = cyc - whole;
    return (whole * uSpawnPulseDuty + min(fracPart, uSpawnPulseDuty)) * uSpawnPulseInterval;
  }

  // Pulse cycles + probability (Phase AX): identical to the
  // velocity pass and to spawnPulseTimeExtended in
  // lib/gpgpuLifecycle.ts (same 64-cycle exactness bound, same
  // delegation at cycles 0 / probability 1).
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

  // Spawn gate value (Phase AX): identical to the velocity pass —
  // mode 0 is the legacy spawnHash, mode 1 the baked distance.
  float spawnGateValue(vec2 uv) {
    if (uSpawnOrderMode == 0) return spawnHash(uv);
    float v = texture2D(uSpawnOrderTex, uv).r;
    return uSpawnOrderMode == 2 ? 1.0 - v : v;
  }

  // Spawn burst event cohort hash (Phase AX): identical to the
  // velocity pass and to spawnEventHashForUv in
  // lib/gpgpuLifecycle.ts.
  float spawnEventHash(vec2 uv) {
    return hash1(uv + vec2(5.39, 8.17));
  }

  // Free curve evaluation (Phase AJ): piecewise-linear over the
  // padded knot arrays — the GLSL twin of evaluateFreeCurve in
  // lib/freeCurve.ts (same clamping, same endpoint hold).
  float kaloEvalFreeCurve(float x) {
    float xx = clamp(x, 0.0, 1.0);
    if (xx <= uEmissionCurveT[0]) return uEmissionCurveV[0];
    for (int i = 1; i < 8; i++) {
      if (xx <= uEmissionCurveT[i]) {
        float span = uEmissionCurveT[i] - uEmissionCurveT[i - 1];
        float f = span > 0.0 ? (xx - uEmissionCurveT[i - 1]) / span : 0.0;
        return mix(uEmissionCurveV[i - 1], uEmissionCurveV[i], f);
      }
    }
    return uEmissionCurveV[7];
  }

  // Emission gate hash (Phase AJ): the pointer-paint gate's form —
  // a per-tick (30 Hz) deterministic hash, so a deterministic
  // render reproduces the gate bit-for-bit.
  float emissionHash(vec2 uv, float tick) {
    return hash1(uv * 913.7 + vec2(tick * 17.31, tick * 7.77));
  }

  // Gyroid SDF (B3) — identical formulation to the velocity shader.
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

  // Mesh SDF (Phase BY): identical copy of the velocity pass's
  // baked-grid query (same contract: negative = inside, world
  // units, degenerate normal = +Y; outside the domain cube the
  // query applies the domain extension documented on the
  // velocity copy — always positive there, so the push-out
  // below stays a no-op outside, exactly as with the old +1e6).
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

  // Multi-body mesh SDF: identical copy of the velocity pass's
  // per-body atlas query (cell-clamped; outside the body domain
  // the query applies the domain extension documented on the
  // velocity copy; an absent body stays +1e6).
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

  // Terrain collider sampling (Phase AI): identical copy of the
  // velocity pass's decoder (manual bilinear over the packed
  // 16-bit height; see that copy for the rationale). This pass
  // uses .x (the world height) only.
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

  // Pointer paint gate (B3): bit-identical with the velocity shader's
  // copy, so both passes agree on which particles are painted.
  float paintHash(vec2 uv, float tick) {
    return hash1(uv * 913.7 + vec2(tick * 17.31, tick * 7.77));
  }

  // Quaternion rotation (Phase AU): GLSL twin of quatRotate in
  // lib/rigidBodies.ts.
  vec3 kaloQuatRotate(vec4 q, vec3 v) {
    vec3 u = q.xyz;
    return v + 2.0 * cross(u, cross(u, v) + q.w * v);
  }

  // Attribute channel picker (Phase AK): identical copy of the
  // velocity pass helper (the slot layout of buildAttributeData
  // in lib/gpgpuAttributes.ts, R/G/B/A = slots 0/1/2/3).
  float kaloAttrChannel(vec4 a, int slot) {
    if (slot == 0) return a.r;
    if (slot == 1) return a.g;
    if (slot == 2) return a.b;
    return a.a;
  }

  // Group membership (Phase AK): identical copy of the velocity
  // pass helper — inclusive boundaries composed from step(), so
  // it matches groupMembership in lib/gpgpuAttributes.ts exactly.
  // Modes: 0 below (av <= high), 1 above (av >= low), 2 band.
  float kaloGroupMembership(float av, int mode, float low, float high, bool invert) {
    float m;
    if (mode == 0) m = step(av, high);
    else if (mode == 1) m = step(low, av);
    else m = step(low, av) * step(av, high);
    return invert ? 1.0 - m : m;
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec3 pos = posData.xyz;
    float age = posData.w;
    vec3 vel = texture2D(uVelTex, vUv).xyz;

    // Rigid bodies (Phase AU): the particle IS a point of its
    // body — world position = body position + rotated local
    // offset. Age is carried verbatim (frozen: the lifecycle is
    // resolved off while the solver is bound).
    if (uRigidEnabled) {
      vec4 cell = texture2D(uRigidCellTex, vUv);
      vec2 bodyUv = vec2((cell.w + 0.5) / 256.0, 0.0); // divisor = RIGID_BODY_MAX (body texture width)
      vec4 bodyPos = texture2D(uRigidBodyTex, vec2(bodyUv.x, 0.125));
      vec4 bodyQuat = texture2D(uRigidBodyTex, vec2(bodyUv.x, 0.375));
      gl_FragColor = vec4(bodyPos.xyz + kaloQuatRotate(bodyQuat, cell.xyz), age);
      return;
    }

    // Spawn gate (Phase AB): an unreleased particle is parked
    // off-screen with its age frozen (the velocity pass zeroes its
    // velocity under the same test). On the single frame the
    // release threshold crosses its hash it activates through the
    // shared respawn block below. Burst 1 (default) skips this.
    bool spawnActivating = false;
    if (uSpawnBurst < 1.0) {
      float sHash = spawnGateValue(vUv);
      float thrNow = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime));
      if (sHash >= thrNow) {
        gl_FragColor = vec4(0.0, -99999.0, 0.0, age);
        return;
      }
      float thrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta));
      spawnActivating = sHash >= thrPrev;
    }

    if (uVerletEnabled) {
      vec3 prevPos = texture2D(uPrevPosTex, vUv).xyz;
      pos = pos + (pos - prevPos) * 0.98 + vel * uDelta * uSpeed * 30.0;
    } else {
      pos += vel * uDelta * uSpeed * 60.0;
    }

`;
const POS_FRAG_PROJECTION_CELL = /* glsl */ `  // Cell sort (Phase 19 fix2): the sorted cell index the
  // projection segment searches while uGrainsCellSort — the
  // same uniforms, helpers and descending order as the
  // velocity pass's copy (identical formulation; TS twin:
  // grainsNeighborsViaCellSearch in lib/gpgpuGrains.ts).
  uniform sampler2D uGrainsSortTex;
  uniform bool  uGrainsCellSort;
  uniform float uGrainsCellOrigin;
  uniform float uGrainsCellSize;
  uniform vec3  uGrainsCellDims;
  float grainsCellKeyAt(float idx) {
    vec2 uv = (vec2(mod(idx, uTexSizeF), floor(idx / uTexSizeF)) + 0.5) / uTexSizeF;
    return texture2D(uGrainsSortTex, uv).z;
  }
  // First index whose key is <= K in the descending order, or
  // the pool size when every key is greater.
  float grainsCellLowerBound(float K) {
    float total = uTexSizeF * uTexSizeF;
    float lo = 0.0;
    float hi = total;
    for (int s = 0; s < 24; s++) {
      if (lo >= hi) break;
      float mid = floor((lo + hi) * 0.5);
      if (grainsCellKeyAt(mid) > K) lo = mid + 1.0;
      else hi = mid;
    }
    return lo;
  }
  vec3 grainsCellOf(vec3 p) {
    return clamp(floor((p - uGrainsCellOrigin) / uGrainsCellSize), vec3(0.0), uGrainsCellDims - vec3(1.0));
  }
  float grainsCellKeyOf(vec3 cell) {
    return (cell.x * uGrainsCellDims.y + cell.y) * uGrainsCellDims.z + cell.z;
  }
`;
const POS_FRAG_PROJECTION_SEGMENT_A = /* glsl */ `    // Grains projection (Phase 19): Jacobi-style — every
    // correction is computed from the frame-start positions
    // (uPosTex, the same snapshot the velocity pass read), so
    // both members of a pair derive mirrored corrections and
    // the step stays deterministic. Half the overlap per member
    // x strength, summed over the scan, the total clamped to
    // one grain diameter so a dense pile cannot overshoot in a
    // single pass. Skipped whole while resolved off.
    if (uGrainsProjEnabled) {
      float gd = max(uGrainsSize, 0.001);
      float gd2 = gd * gd;
      float gCount = float(uGrainsSamples);
      float gStride = uTexSizeF / float(uGrainsSamples);
      if (uGrainsNeighborhood == 1) {
        float gSpan = uTexSizeF * uTexSizeF;
        gStride = gSpan > 65536.0 ? ceil(gSpan / 65536.0) : 1.0;
        gCount = ceil(gSpan / gStride);
      }
      vec3 corr = vec3(0.0);
`;
const POS_FRAG_PROJECTION_SEGMENT_LOOP = /* glsl */ `      for (int i = 0; i < 65536; i++) {
        if (float(i) >= gCount) break;
        float si = float(i) * gStride;
${NEIGHBOR_SUV_GLSL}${NEIGHBOR_SELF_SKIP_GLSL}        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 r = posData.xyz - oPos;
        float r2 = dot(r, r);
        if (r2 < gd2 && r2 > 0.0001) {
          float dist = sqrt(r2);
          corr += (r / dist) * ((gd - dist) * 0.5);
        }
      }
`;
const POS_FRAG_PROJECTION_SEGMENT_B = /* glsl */ `      corr *= uGrainsProjection;
      float corrLen = length(corr);
      if (corrLen > gd) corr *= gd / corrLen;
      pos += corr;
    }

`;
const POS_FRAG_TAIL = /* glsl */ `    // Collision life (Phase 15): contact bookkeeping for the
    // push-outs and clamps below. Recorded only while a life
    // option is live, so the default path is untouched.
    bool collisionContact = false;
    bool collisionTrack = uCollisionKill || uCollisionLifeLoss > 0.0;

    float dist = length(pos);
    if (dist > uBounceRadius * 1.05) {
      pos = normalize(pos) * uBounceRadius * 1.05;
      if (collisionTrack) collisionContact = true;
    }

    // SDF Collider — position push-out
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
        sd = gyroidField(pos, sc, uSdfSize) * uSdfSize * 0.227;
        sn = gyroidNormal(pos, sc, uSdfSize);
      } else {
        float yc = clamp(pos.y - sc.y, -uSdfSize, uSdfSize);
        vec3 dp = vec3(pos.x - sc.x, pos.y - sc.y - yc, pos.z - sc.z);
        sd = length(dp) - uSdfSize * 0.4;
        sn = normalize(dp + vec3(0.0001));
      }
      if (sd < 0.0) {
        pos -= sn * sd;
        if (collisionTrack) collisionContact = true;
      }
    }

    // Mesh SDF Collider (Phase BY) — position push-out on the
    // baked mesh grid, after the analytic SDF push-out (both may
    // be live). Outside the domain the query's extended value is
    // always positive, so the sd < 0 push-out is a no-op there.
    // Multi-body mesh SDF — min synthesis: evaluate every body,
    // push out once along the deepest body's normal. While multi
    // is live the passes leave uMeshSdfEnabled false.
    if (uMeshSdfMultiEnabled) {
      float bestSd = 1.0e6;
      int bestBody = -1;
      for (int bi = 0; bi < 4; bi++) {
        if (bi >= uMeshSdfBodyCount) break;
        float bsd = meshSdfBodyDistance(bi, pos);
        if (bsd < bestSd) { bestSd = bsd; bestBody = bi; }
      }
      if (bestBody >= 0 && bestSd < 0.0) {
        pos -= meshSdfBodyNormal(bestBody, pos) * bestSd;
        if (collisionTrack) collisionContact = true;
      }
    }

    if (uMeshSdfEnabled) {
      float msd = meshSdfDistance(pos);
      if (msd < 0.0) {
        pos -= meshSdfNormal(pos) * msd;
        if (collisionTrack) collisionContact = true;
      }
    }

    // Floor clamp (B3): Kinetix resolves penetration as
    // floorY + (floorY - y) * 0.1; the velocity pass owns the bounce.
    if (uFloorEnabled && pos.y < uFloorY) {
      pos.y = uFloorY + (uFloorY - pos.y) * 0.1;
      if (collisionTrack) collisionContact = true;
    }

    // Terrain clamp (Phase AI): push a particle that ended the
    // step below the height field back onto the surface (exact
    // contact — the velocity pass owns the bounce / rest
    // response). Only inside the field domain, like the
    // velocity response.
    if (uTerrainColliderEnabled) {
      vec2 tcUv = pos.xz / (2.0 * max(uTerrainExtent, 0.001)) + 0.5;
      if (tcUv.x >= 0.0 && tcUv.x <= 1.0 && tcUv.y >= 0.0 && tcUv.y <= 1.0) {
        float tcH = terrainColliderSample(tcUv).x;
        if (pos.y < tcH) {
          pos.y = tcH;
          if (collisionTrack) collisionContact = true;
        }
      }
    }

    // Pointer paint (B3): gated particles are re-emitted at the brush
    // position with a hash offset inside the brush disc. The velocity
    // pass re-seeds their velocity under the same gate. Vellum
    // (Phase AR) suppresses the teleport while the solver is on.
    if (uMouseEnabled && uMouseMode == 3 && !uVellumEnabled) {
      float paintTick = floor(uTime * 30.0);
      float paintGate = paintHash(vUv, paintTick);
      if (paintGate < uMousePaintRate * 0.008) {
        vec3 paintOffset = vec3(
          hash1(vUv + paintTick * 0.731),
          hash1(vUv + paintTick * 1.317 + 4.7),
          hash1(vUv + paintTick * 2.113 + 9.1)
        ) - 0.5;
        // Multi-touch (Phase AO): with several brushes the gated
        // particle is emitted from one of them, chosen by the
        // same gate hash the velocity pass uses for its speed
        // mix, so the choice is deterministic. Count 0/1 (and
        // index 0) reproduce the legacy single-brush statement.
        vec3 brushPos = uMousePos;
        if (uMouseCount >= 2) {
          int brushIdx = int(fract(paintGate * 91.7) * float(uMouseCount));
          if (brushIdx > uMouseCount - 1) brushIdx = uMouseCount - 1;
          brushPos = uMousePosMulti[brushIdx];
        }
        pos = brushPos + paintOffset * uMouseRadius * 0.7;
      }
    }

    // Respawn decision: the legacy age wrap, the Phase AB spawn
    // activation, and the Phase AB kill conditions all enter the
    // same respawn block below, so every (re)birth in the pool
    // shares one placement law (and one Aux birth signal).
    // Collision life cost (Phase 15): contact this step ages the
    // particle faster (the loss is a rate — extra age seconds per
    // second of contact). Applied before the age advance so a
    // contact can end the life on this very step.
    if (collisionContact && uCollisionLifeLoss > 0.0) {
      age += uCollisionLifeLoss * uDelta;
    }
    bool doRespawn = spawnActivating;
    bool ageRespawn = false;
    if (uAgeEnabled) {
      age += uDelta;
      if (age > uAgeMax) ageRespawn = true;
    }
    // Emission curve gate (Phase AJ): only the age respawn is
    // gated — spawn activation and the kill conditions below are
    // lifecycle events, not emission. When the curve value at the
    // current cycle phase is c < 1, a deterministic per-tick hash
    // below c lets the respawn through and the rest are postponed
    // (age keeps advancing; the age curves clamp at t = 1, so the
    // particle waits at its end-of-life appearance). c = 1 always
    // passes, so an identity curve is the legacy behaviour.
    if (ageRespawn && uEmissionCurveEnabled) {
      float phase = fract(uTime / max(uEmissionCurvePeriod, 0.001));
      float c = kaloEvalFreeCurve(phase);
      if (c < 1.0) {
        float tick = floor(uTime * 30.0);
        if (emissionHash(vUv, tick) >= c) ageRespawn = false;
      }
    }
    if (ageRespawn) doRespawn = true;
    // Kill conditions (Phase AB): leave the bounce sphere, or sit
    // in a rejected raster-mask region, and the particle respawns
    // now instead of bouncing / living on. Both default off. The
    // mask test mirrors the draw clip (Phase X): same UV rule,
    // same threshold / invert keys.
    // Spawn burst event (Phase AX): on the single frame the
    // spawn clock crosses the authored event time, the event's
    // cohort respawns through the shared block below (the
    // velocity pass hands it the authored initial velocity on
    // the same frame test). Parked particles never reach here —
    // the gate above returned them off-screen — so the event
    // re-births only the live pool.
    if (uSpawnEventEnabled) {
      if (uSpawnTime - uDelta < uSpawnEventTime && uSpawnTime >= uSpawnEventTime) {
        if (spawnEventHash(vUv) < uSpawnEventCount) doRespawn = true;
      }
    }
    if (uKillBoundary && length(pos) > uBounceRadius + 0.001) doRespawn = true;
    // Collision kill (Phase 15): any collider contact this step
    // respawns the particle through the shared block.
    if (collisionContact && uCollisionKill) doRespawn = true;
    if (uKillMask) {
      vec2 maskUv = clamp(pos.xy * (1.0 / (2.0 * max(uBounceRadius, 1.0))) + 0.5, 0.0, 1.0);
      float mLuma = dot(texture2D(uKillMaskTex, maskUv).rgb, vec3(0.2126, 0.7152, 0.0722));
      if (uKillMaskInvert) mLuma = 1.0 - mLuma;
      if (mLuma < uKillMaskThreshold) doRespawn = true;
    }
    // Group kill (Phase DG): outside the named group, respawn
    // now. The bake shares the position pass's texel layout, so
    // vUv reads this particle's own membership.
    if (uGroupKillEnabled) {
      vec4 attrData = texture2D(uAttrTex, vUv);
      float grp = kaloGroupMembership(kaloAttrChannel(attrData, uGroupSlot), uGroupMode, uGroupLow, uGroupHigh, uGroupInvert);
      if (grp < 0.5) doRespawn = true;
    }
    if (doRespawn) {
        float r   = uBounceRadius * (0.05 + hash1(vUv + vec2(age)) * 0.9);
        float th  = hash1(vUv + vec2(1.3)) * 6.2832;
        float phi = acos(2.0 * hash1(vUv + vec2(2.7)) - 1.0);
        if (uEmitLight) {
          // Light emitter (Phase T): respawn as a small ball around
          // the light position — the same hash draws, the radius
          // scaled to 5% — so the emitter keeps feeding particles
          // from the light. Every other shape takes the legacy
          // statement below, verbatim.
          float jr = r * 0.05;
          pos = uEmitLightPos + vec3(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));
        } else {
          pos = vec3(r * sin(phi) * cos(th), r * sin(phi) * sin(th), r * cos(phi));
        }
        // Replica age phase (Phase M): the respawn restarts the
        // lifecycle at this particle's replica-block offset instead
        // of 0, so the copies keep their phase separation forever
        // (not just in the initial scatter). The block index uses
        // the same contiguous mapping as the bake / initial data:
        // index = texel index, r = floor(index * count / total).
        // With step 0 (or count <= 1) the offset term is exactly
        // 0.0 and age restarts at 0.0 as before.
        float texIdx = floor(vUv.y * uTexSizeF) * uTexSizeF + floor(vUv.x * uTexSizeF);
        float replicaIdx = uAgeReplicaCount > 1.5
          ? floor(texIdx * uAgeReplicaCount / max(uTexSizeF * uTexSizeF, 1.0))
          : 0.0;
        age = replicaIdx * uAgeReplicaStep * uAgeMax;
        // Phase W2 stack mode: the copy's constant restart age
        // (exactly 0.0 in the shared path, so this is a no-op
        // there beyond the per-texel term above).
        age += uReplicaAgeBase;
    }

    gl_FragColor = vec4(pos, age);
  }
`;

// ── Phase 19 gate fix: string-level shader variants ──
// On the target GPU, ANY code-text change in these shaders
// breaks bit-identity with v2.00 — even code gated off by a
// false uniform (measured, see PHASE19_GATE_DIAGNOSIS). The
// Phase 19 additions therefore sit behind builder options:
// the default exports below are byte-identical to v2.00 and
// the *_PHASE19 exports are byte-identical to the Phase 19
// strings (both pinned by scripts/phase18-shader-hash.mjs).
const POS_FRAG_PROJECTION_SEGMENT = POS_FRAG_PROJECTION_SEGMENT_A
  + POS_FRAG_PROJECTION_SEGMENT_LOOP
  + POS_FRAG_PROJECTION_SEGMENT_B;
const POS_FRAG_PROJECTION_SEGMENT_CELL_OPEN = /* glsl */ `      // Cell sort (Phase 19 fix2): while the passes resolved
      // uGrainsCellSort, the candidates come from the sorted
      // cell index instead of the complete walk in the else
      // branch — the 27 cells around this particle, each
      // located by binary search and walked with the
      // per-candidate test verbatim, so the neighbour set is
      // the brute-force set; only the accumulation order
      // changes (cell order instead of texel order). Without
      // the sort (replica stacks receive no sort pool) the
      // else branch keeps the stage-1 complete scan.
      if (uGrainsCellSort) {
        vec3 myCell = grainsCellOf(posData.xyz);
        for (int gz = -1; gz <= 1; gz++)
        for (int gy = -1; gy <= 1; gy++)
        for (int gx = -1; gx <= 1; gx++) {
          vec3 cell = myCell + vec3(float(gx), float(gy), float(gz));
          if (cell.x < 0.0 || cell.y < 0.0 || cell.z < 0.0
            || cell.x >= uGrainsCellDims.x || cell.y >= uGrainsCellDims.y || cell.z >= uGrainsCellDims.z) continue;
          float cellKey = grainsCellKeyOf(cell);
          float start = grainsCellLowerBound(cellKey);
          float total = uTexSizeF * uTexSizeF;
          for (float k = start; k < total; k += 1.0) {
            vec4 entry = texture2D(uGrainsSortTex, (vec2(mod(k, uTexSizeF), floor(k / uTexSizeF)) + 0.5) / uTexSizeF);
            if (entry.z < cellKey) break;
            vec2 sUv = entry.xy;
            if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
            vec3 oPos = texture2D(uPosTex, sUv).xyz;
            vec3 r = posData.xyz - oPos;
            float r2 = dot(r, r);
            if (r2 < gd2 && r2 > 0.0001) {
              float dist = sqrt(r2);
              corr += (r / dist) * ((gd - dist) * 0.5);
            }
          }
        }
      } else {
`;
const POS_FRAG_PROJECTION_SEGMENT_CELL_CLOSE = /* glsl */ `      }
`;
const POS_FRAG_PROJECTION_SEGMENT_CELL = POS_FRAG_PROJECTION_SEGMENT_A
  + POS_FRAG_PROJECTION_SEGMENT_CELL_OPEN
  + POS_FRAG_PROJECTION_SEGMENT_LOOP
  + POS_FRAG_PROJECTION_SEGMENT_CELL_CLOSE
  + POS_FRAG_PROJECTION_SEGMENT_B;

// Particle rules (G10 stage 1): the kill bit of the baked
// mask. The uniform is declared only in this variant (the
// uAttrTex sampler itself is already declared with the Phase
// DG uniforms in POS_FRAG_MID). The tail segment is spliced
// in right after the Phase DG group-kill block: polarity was
// unified at bake time ("kill = bit set"), so the rule kill
// is a plain OR into the shared respawn block. Bit extraction
// is the arithmetic mod/floor form (GLSL ES 1.00, U1).
const POS_FRAG_PARTICLE_RULES_UNIFORMS = /* glsl */ `
uniform bool uParticleRuleKillEnabled;
`;
const POS_FRAG_GROUP_KILL_BLOCK = /* glsl */ `    if (uGroupKillEnabled) {
      vec4 attrData = texture2D(uAttrTex, vUv);
      float grp = kaloGroupMembership(kaloAttrChannel(attrData, uGroupSlot), uGroupMode, uGroupLow, uGroupHigh, uGroupInvert);
      if (grp < 0.5) doRespawn = true;
    }
`;
const POS_FRAG_PARTICLE_RULES_SEGMENT = /* glsl */ `    // Particle rule kill (G10 stage 1): bit 5 of the baked
    // mask in slot 3 respawns matched particles.
    if (uParticleRuleKillEnabled) {
      vec4 ruleAttrData = texture2D(uAttrTex, vUv);
      if (mod(floor(ruleAttrData.a / 32.0), 2.0) > 0.5) doRespawn = true;
    }
`;
// Live particle rules (Grammar 2.0 stage 1, slice 1A): the
// kill bit of the REP output's .r channel, composed with the
// baked kill by OR (design section 7 — both use the unified
// "kill = bit set" polarity). The uniforms are declared only
// in this variant; the segment is spliced in right after the
// baked rule-kill segment (or after the group-kill block when
// no baked segment exists). The enabled flag is resolved
// CPU-side (REP texture exists AND a live kill rule exists),
// so a false uniform keeps the exact legacy path inside this
// variant string.
const POS_FRAG_PARTICLE_RULES_LIVE_UNIFORMS = /* glsl */ `
uniform sampler2D uRuleLiveTex;
uniform bool uParticleRuleLiveKillEnabled;
uniform bool uParticleRuleLiveTrueKillEnabled;
`;
// Texture-unit fix (Grammar 2.0 stage 1): the velocity
// pass's live variant must drop the spawn-order sampler to
// stay inside the 16-unit floor (see
// gpgpuShaderSimulationVelocityPreamble.ts at
// VEL_FRAG_SPAWN_ORDER_DECL_STOCK and
// kalokagathia-pro/STAGE1_TEXUNIT_FIX_RECORD.md). The gate
// value both passes compute must stay identical — the
// position pass (cohort → respawn) and the velocity pass
// (cohort → velocity) have to pick the same particles — so
// the position live variant derives it the same way: from
// the initial-position texture (declared here in place of
// the order sampler; the position budget has room, so the
// swap is unit-neutral) divided by the bake's normaliser,
// uSpawnOrderMaxDist (CPU twin spawnGateDistanceValue in
// lib/gpgpuLifecycle.ts). Both stock lines occur exactly
// once in POS_FRAG_MID.
export const POS_FRAG_SPAWN_ORDER_DECL_STOCK = '  uniform sampler2D uSpawnOrderTex;';
export const POS_FRAG_SPAWN_ORDER_DECL_LIVE = '  uniform sampler2D uInitPosTex;\n  uniform float uSpawnOrderMaxDist;';
export const POS_FRAG_SPAWN_GATE_READ_STOCK = '    float v = texture2D(uSpawnOrderTex, uv).r;';
export const POS_FRAG_SPAWN_GATE_READ_LIVE = '    float v = clamp(length(texture2D(uInitPosTex, uv).xyz) / max(uSpawnOrderMaxDist, 1.0e-6), 0.0, 1.0);';
const POS_FRAG_PARTICLE_RULES_LIVE_SEGMENT = /* glsl */ `    // Live particle rule kill (Grammar 2.0 1A): bit 5 of the
    // REP mask respawns matched particles (OR with baked).
    if (uParticleRuleLiveKillEnabled) {
      float liveMask = texture2D(uRuleLiveTex, vUv).r;
      if (mod(floor(liveMask / 32.0), 2.0) > 0.5) doRespawn = true;
    }
`;
// Live true-kill (Grammar 2.0 stage 1, slice 1C): bit 6 of
// the REP mask. The REP latches the bit once set, so this
// test is stable: a true-killed particle is parked off-screen
// with its age frozen — the spawn gate's parking form — and
// returns before any integration or the respawn block, so it
// never revives and never re-births (no Aux birth signal).
// The segment is spliced into the MID right after the spawn
// gate (its anchor below), where pos / age are the loaded
// values; the enabled flag is resolved CPU-side with the
// same suppression discipline as the live kill (vellum /
// rigid / replica stacks resolve it off).
const POS_FRAG_SPAWN_GATE_ANCHOR = /* glsl */ `      spawnActivating = sHash >= thrPrev;
    }
`;
const POS_FRAG_PARTICLE_RULES_LIVE_TRUE_KILL_SEGMENT = /* glsl */ `
    // Live particle rule true-kill (Grammar 2.0 1C): bit 6
    // of the REP mask is latched — park the particle
    // off-screen with its age frozen and never respawn it.
    if (uParticleRuleLiveTrueKillEnabled) {
      float liveMaskTk = texture2D(uRuleLiveTex, vUv).r;
      if (mod(floor(liveMaskTk / 64.0), 2.0) > 0.5) {
        gl_FragColor = vec4(0.0, -99999.0, 0.0, age);
        return;
      }
    }
`;

// Emitter respawn shape (Grammar 2.0 stage 2, slice E1):
// while gpgpuRespawnShape names a shape (not 'auto'), the
// shared respawn block places through the SAME sampling law
// the bake uses — the GLSL twin kaloEmitShapePos from
// lib/gpgpuEmitShapes.ts — instead of the legacy origin ball /
// light ball statement. The four hash draws feed the twin in
// its canonical order (theta, then the shape draws). The
// legacy placement block below stays the default string's
// verbatim text; this variant replaces it wholesale.
const POS_FRAG_RESPAWN_PLACEMENT_LEGACY = /* glsl */ `        float r   = uBounceRadius * (0.05 + hash1(vUv + vec2(age)) * 0.9);
        float th  = hash1(vUv + vec2(1.3)) * 6.2832;
        float phi = acos(2.0 * hash1(vUv + vec2(2.7)) - 1.0);
        if (uEmitLight) {
          // Light emitter (Phase T): respawn as a small ball around
          // the light position — the same hash draws, the radius
          // scaled to 5% — so the emitter keeps feeding particles
          // from the light. Every other shape takes the legacy
          // statement below, verbatim.
          float jr = r * 0.05;
          pos = uEmitLightPos + vec3(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));
        } else {
          pos = vec3(r * sin(phi) * cos(th), r * sin(phi) * sin(th), r * cos(phi));
        }
`;
const POS_FRAG_EMITTER_SHAPE_UNIFORMS = /* glsl */ `
uniform int uRespawnShape;
`;
const POS_FRAG_RESPAWN_PLACEMENT_SHAPE = /* glsl */ `        // Emitter shape law (stage 2, E1): the shared bake /
        // respawn sampling law — the same formulas the bake's
        // JS twin evaluates, fed by four hash draws in the
        // twin's canonical order. uRespawnShape is the shape
        // id from lib/gpgpuEmitShapes.ts (EMIT_SHAPE_IDS);
        // the 'light' shape reads the existing uEmitLightPos.
        pos = kaloEmitShapePos(uRespawnShape, vec4(hash1(vUv + vec2(11.1)), hash1(vUv + vec2(23.7)), hash1(vUv + vec2(37.3)), hash1(vUv + vec2(51.9))), uBounceRadius, uEmitLightPos);
`;
// Distribution layer + shader seed (Grammar 2.0 stage 2,
// B5): while the distribution key resolves to effective
// operators, the placed position passes through the layer
// (lib/gpgpuDistribution.ts DIST_GLSL — the GLSL twin of the
// bake's applyDistributionOps) right after the placement,
// before the emitter transform — the same pipeline position
// the bake uses. While the shader-seed opt-in key is set,
// the placement draws carry the seed phase (the ONLY way a
// seed reaches a shader; judgment 3). Both are variants:
// the default string contains neither.
const POS_FRAG_DIST_UNIFORMS = /* glsl */ `
uniform vec4 uDistOps[${DIST_MAX_OPS}];
uniform int uDistOpCount;
` + DIST_GLSL;
const POS_FRAG_SEED_UNIFORMS = /* glsl */ `
uniform float uShaderSeedPhase;
`;
const POS_FRAG_DIST_SEGMENT = /* glsl */ `        // Distribution layer (stage 2, B5): transform the
        // placed point in emitter space — the bake twin is
        // applyDistributionOps in lib/gpgpuDistribution.ts.
        pos = kaloDistApply(pos, uBounceRadius);
`;
const POS_FRAG_RESPAWN_PLACEMENT_SHAPE_SEED = /* glsl */ `        // Emitter shape law (stage 2, E1) with the shader
        // seed phase (stage 2, B5): the four hash draws are
        // shifted by the opt-in seed — the same law, a
        // seed-dependent scatter.
        pos = kaloEmitShapePos(uRespawnShape, vec4(hash1(vUv + vec2(11.1 + uShaderSeedPhase)), hash1(vUv + vec2(23.7 + uShaderSeedPhase)), hash1(vUv + vec2(37.3 + uShaderSeedPhase)), hash1(vUv + vec2(51.9 + uShaderSeedPhase))), uBounceRadius, uEmitLightPos);
`;
const POS_FRAG_RESPAWN_PLACEMENT_LEGACY_SEED = /* glsl */ `        float r   = uBounceRadius * (0.05 + hash1(vUv + vec2(age + uShaderSeedPhase)) * 0.9);
        float th  = hash1(vUv + vec2(1.3 + uShaderSeedPhase)) * 6.2832;
        float phi = acos(2.0 * hash1(vUv + vec2(2.7 + uShaderSeedPhase)) - 1.0);
        if (uEmitLight) {
          float jr = r * 0.05;
          pos = uEmitLightPos + vec3(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));
        } else {
          pos = vec3(r * sin(phi) * cos(th), r * sin(phi) * sin(th), r * cos(phi));
        }
`;
const POS_FRAG_RESPAWN_PLACEMENT_PATH_SEED = /* glsl */ `        // Path emission (stage 2, E3) with the shader seed
        // phase (stage 2, B5): the arc draw is shifted by
        // the opt-in seed.
        pos = kaloEmitPathPos(hash1(vUv + vec2(61.7 + uShaderSeedPhase)));
`;
// Emitter transform (Grammar 2.0 stage 2, slice E0): while
// the emitter transform keys are non-identity, the placed
// position passes through the same scale / rotation /
// translation the bake applies (lib/gpgpuEmitter.ts produces
// the matrix for both routes), so a respawn lands in the
// transformed emitter frame exactly like an initially baked
// particle. Spliced right after the placement (either law),
// before the replica age restart.
const POS_FRAG_EMITTER_TRANSFORM_UNIFORMS = /* glsl */ `
uniform vec3 uEmitterPos;
uniform mat3 uEmitterRotScale;
`;
const POS_FRAG_RESPAWN_AGE_ANCHOR = /* glsl */ `        // Replica age phase (Phase M): the respawn restarts the`;

// Spawn allocator (Grammar 2.0 stage 2, E2): while the
// absolute rate key is set or the spawn envelope is enabled,
// the gate's threshold reads the allocator's effective rate
// (uSpawnRateEff — the absolute rate's fraction equivalent,
// or the legacy fraction) over the envelope clock
// (uSpawnClockTime / uSpawnClockPrev, accumulated CPU-side
// by advanceSpawnEnvelopeClock in lib/gpgpuSpawnAllocator.ts;
// with the envelope disabled the clock IS the spawn time and
// its previous value). The stock lines below stay the
// default string's verbatim text; this variant replaces the
// two threshold expressions wholesale.
const POS_FRAG_SPAWN_ALLOC_UNIFORMS = /* glsl */ `
uniform float uSpawnRateEff;
uniform float uSpawnClockTime;
uniform float uSpawnClockPrev;
`;
const POS_FRAG_THR_NOW_LEGACY = /* glsl */ `      float thrNow = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime));`;
const POS_FRAG_THR_NOW_ALLOC = /* glsl */ `      float thrNow = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockTime));`;
const POS_FRAG_THR_PREV_LEGACY = /* glsl */ `      float thrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta));`;
const POS_FRAG_THR_PREV_ALLOC = /* glsl */ `      float thrPrev = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockPrev));`;
// Rule spawn gate (Grammar 2.0 stage 2, E2): bit 13 of the
// REP mask is the live rules' spawn pulse (slice 1D-3). While
// the gate key is on, a matched particle re-births through
// the shared respawn block — the main-pool opening of the
// connection the Aux ruleSpawn mode consumes for children.
// The segment is spliced in right after the live rule-kill
// segment (it shares that variant's uRuleLiveTex uniform);
// the enabled flag is resolved CPU-side with the same
// suppression discipline as the live kill (REP texture
// exists AND a live spawn rule exists AND the key is on).
const POS_FRAG_SPAWN_RULE_GATE_UNIFORMS = /* glsl */ `
uniform bool uSpawnRuleGateEnabled;
`;
const POS_FRAG_SPAWN_RULE_GATE_SEGMENT = /* glsl */ `    // Rule spawn gate (Grammar 2.0 stage 2, E2): bit 13 of
    // the REP mask is the spawn pulse — a matched particle
    // re-births through the shared respawn block below.
    if (uSpawnRuleGateEnabled) {
      float spawnGateMask = texture2D(uRuleLiveTex, vUv).r;
      if (mod(floor(spawnGateMask / 8192.0), 2.0) > 0.5) doRespawn = true;
    }
`;
const POS_FRAG_EMITTER_TRANSFORM_SEGMENT = /* glsl */ `        // Emitter transform (stage 2, E0): scale / rotation /
        // translation of the emitter frame — the bake twin is
        // applyEmitterTransform in lib/gpgpuEmitter.ts.
        pos = uEmitterPos + uEmitterRotScale * pos;
`;

// Emission sources (Grammar 2.0 stage 2, slice E3): while the
// emission source is a sample cloud or the steering path, the
// respawn placement reads the source instead of the analytic
// law — the cloud through the particle's own texel (the cloud
// index IS the particle identity, exactly like the morph
// target assignment), the path through one hash draw fed to
// the arc-length twin (EMIT_PATH_GLSL in
// lib/gpgpuEmissionSource.ts). Both replace the legacy
// placement wholesale, like the E1 shape law.
const POS_FRAG_EMITTER_CLOUD_UNIFORMS = /* glsl */ `
uniform sampler2D uEmitCloudTex;
`;
const POS_FRAG_RESPAWN_PLACEMENT_CLOUD = /* glsl */ `        // Emission cloud (stage 2, E3): the placement is the
        // particle's own point of the emission cloud (the
        // morph target's cloud or the bitmap cloud) — the
        // same texture contract the morph force reads.
        pos = texture2D(uEmitCloudTex, vUv).xyz;
`;
const POS_FRAG_EMITTER_PATH_UNIFORMS = /* glsl */ `
uniform vec3 uEmitPath[${8}];
uniform float uEmitPathCum[${8}];
uniform int uEmitPathCount;
` + EMIT_PATH_GLSL;
// Path-asset emission (stage 2, B2): while the path asset is
// extended, the respawn placement walks asset path 0 over the
// shared column-data texture (the same supply the velocity
// pass's Path Follow reads) instead of the uniform arrays —
// the point cap rises from 8 to the asset's 64 with it. The
// walk function keeps the legacy name (kaloEmitPathPos), so
// the placement and mask-candidate segments are shared.
const POS_FRAG_EMITTER_PATH_ASSET_UNIFORMS = /* glsl */ `
uniform sampler2D uEmitColTex;
uniform float uEmitColWidth;
uniform float uEmitColHeight;
uniform float uEmitPathBase;
uniform int uEmitPathTexCount;
` + EMIT_PATH_ASSET_GLSL;
const POS_FRAG_RESPAWN_PLACEMENT_PATH = /* glsl */ `        // Path emission (stage 2, E3): one hash draw is the
        // arc parameter over the steering path polyline.
        pos = kaloEmitPathPos(hash1(vUv + vec2(61.7)));
`;
// Emission mask (stage 2, E3): while the mask gate is live,
// the placement — whichever law produced it — is tested
// against the mask texture with the KILL mask's own UV rule
// (pos.xy / (2 * bounceRadius) + 0.5, the Phase X discipline)
// and its threshold / invert uniforms, and a rejected
// candidate is re-drawn up to 4 attempts (the shader-side
// bound of the bake's 12); the last candidate stands. A
// rejected CLOUD point cannot be re-drawn (its index is the
// particle identity), so it degrades to the active respawn
// law's draws, exactly like the bake degrades to shape
// samples. While uEmitMaskEnabled is false (no mask texture
// resolved this frame) the first candidate stands untouched,
// so the block degenerates to the plain placement. The
// emitter transform, when active, is folded into each
// candidate so the gate tests the WORLD position like the
// bake does; the standalone transform segment is then not
// spliced (see buildPositionFragment).
const POS_FRAG_EMITTER_MASK_UNIFORMS = /* glsl */ `
uniform bool uEmitMaskEnabled;
`;
type EmitMaskLaw = 'legacy' | 'shape' | 'path';
function emitMaskCandidate(law: EmitMaskLaw, seed = false): string {
  // Shader seed (stage 2, B5): while the opt-in stands, every
  // candidate draw also carries the seed phase.
  const ph = seed ? ' + uShaderSeedPhase' : '';
  if (law === 'shape') {
    return /* glsl */ `          emitCand = kaloEmitShapePos(uRespawnShape, vec4(hash1(vUv + vec2(11.1 + eOff${ph})), hash1(vUv + vec2(23.7 + eOff${ph})), hash1(vUv + vec2(37.3 + eOff${ph})), hash1(vUv + vec2(51.9 + eOff${ph}))), uBounceRadius, uEmitLightPos);
`;
  }
  if (law === 'path') {
    return /* glsl */ `          emitCand = kaloEmitPathPos(hash1(vUv + vec2(61.7 + eOff${ph})));
`;
  }
  return /* glsl */ `          float eR = uBounceRadius * (0.05 + hash1(vUv + vec2(age + eOff${ph})) * 0.9);
          float eTh = hash1(vUv + vec2(1.3 + eOff${ph})) * 6.2832;
          float ePhi = acos(2.0 * hash1(vUv + vec2(2.7 + eOff${ph})) - 1.0);
          if (uEmitLight) {
            float eJr = eR * 0.05;
            emitCand = uEmitLightPos + vec3(eJr * sin(ePhi) * cos(eTh), eJr * sin(ePhi) * sin(eTh), eJr * cos(ePhi));
          } else {
            emitCand = vec3(eR * sin(ePhi) * cos(eTh), eR * sin(ePhi) * sin(eTh), eR * cos(ePhi));
          }
`;
}
function emitMaskTest(indent: string): string {
  return /* glsl */ `${indent}vec2 eMuv = emitCand.xy / (2.0 * uBounceRadius) + 0.5;
${indent}float eLuma = texture2D(uKillMaskTex, eMuv).r;
${indent}if (uKillMaskInvert) eLuma = 1.0 - eLuma;
${indent}if (eLuma >= uKillMaskThreshold) break;
`;
}
function emitMaskPlacement(law: 'legacy' | 'shape' | 'cloud' | 'path', fallbackLaw: EmitMaskLaw, withTransform: boolean, dist = false, seed = false): string {
  // Distribution layer (stage 2, B5): each shape-law
  // candidate passes through the layer before the transform
  // fold and the mask test — the bake's per-attempt order.
  // Cloud points and path points are source placements, not
  // shape samples, and are never distributed (the bake's
  // override discipline); the cloud branch's shape-law
  // fallback candidates are.
  const distLine = dist
    ? /* glsl */ `          emitCand = kaloDistApply(emitCand, uBounceRadius);
`
    : '';
  const distLineIn = dist
    ? /* glsl */ `              emitCand = kaloDistApply(emitCand, uBounceRadius);
`
    : '';
  const transformLine = withTransform
    ? /* glsl */ `          emitCand = uEmitterPos + uEmitterRotScale * emitCand;
`
    : '';
  const header = /* glsl */ `        // Emission mask (stage 2, E3): candidates are gated
        // by the raster mask (kill-mask UV rule / threshold /
        // invert); rejected candidates re-draw, last stands.
`;
  if (law === 'cloud') {
    const transformLineIn = withTransform
      ? /* glsl */ `            emitCand = uEmitterPos + uEmitterRotScale * emitCand;
`
      : '';
    return header + /* glsl */ `        vec3 emitCand = texture2D(uEmitCloudTex, vUv).xyz;
` + (withTransform ? /* glsl */ `        emitCand = uEmitterPos + uEmitterRotScale * emitCand;
` : '') + /* glsl */ `        if (uEmitMaskEnabled) {
          vec2 eMuv0 = emitCand.xy / (2.0 * uBounceRadius) + 0.5;
          float eLuma0 = texture2D(uKillMaskTex, eMuv0).r;
          if (uKillMaskInvert) eLuma0 = 1.0 - eLuma0;
          if (eLuma0 < uKillMaskThreshold) {
            for (int eAtt = 0; eAtt < 4; eAtt++) {
              float eOff = float(eAtt) * 13.7 + 7.3;
` + emitMaskCandidate(fallbackLaw, seed).replace(/^          /gm, '              ') + distLineIn + transformLineIn + /* glsl */ `              vec2 eMuv = emitCand.xy / (2.0 * uBounceRadius) + 0.5;
              float eLuma = texture2D(uKillMaskTex, eMuv).r;
              if (uKillMaskInvert) eLuma = 1.0 - eLuma;
              if (eLuma >= uKillMaskThreshold) break;
            }
          }
        }
        pos = emitCand;
`;
  }
  return header + /* glsl */ `        vec3 emitCand = vec3(0.0);
        for (int eAtt = 0; eAtt < 4; eAtt++) {
          float eOff = float(eAtt) * 13.7;
` + emitMaskCandidate(law, seed) + (law === 'path' ? '' : distLine) + transformLine + /* glsl */ `          if (!uEmitMaskEnabled) break;
` + emitMaskTest('          ') + /* glsl */ `        }
        pos = emitCand;
`;
}

// Coupling stage 2 (rigid ⇄ particle): the free-particle
// pieces of this pass, spliced in only behind the rigidFree
// option (in the Phase 19 manner — the stock strings stay
// byte-identical). The uniform set mirrors the velocity pass's.
const POS_FRAG_RIGID_FREE_UNIFORMS = /* glsl */ `
uniform bool uRigidFreeEnabled;
uniform float uRigidFreeFraction;
uniform float uRigidBodyCount;
`;
const POS_FRAG_RIGID_BRANCH_OPEN = `    // Rigid bodies (Phase AU): the particle IS a point of its
    // body — world position = body position + rotated local
    // offset. Age is carried verbatim (frozen: the lifecycle is
    // resolved off while the solver is bound).
    if (uRigidEnabled) {`;
const POS_FRAG_RIGID_BRANCH_OPEN_FREE = `    // Coupling stage 2: the free subset (same spawn-hash test
    // as the velocity pass) skips the rigid overwrite and
    // integrates normally, colliding with the body spheres in
    // the tail below.
    bool rigidFree = uRigidEnabled && uRigidFreeEnabled && spawnGateValue(vUv) < uRigidFreeFraction;

    // Rigid bodies (Phase AU): the particle IS a point of its
    // body — world position = body position + rotated local
    // offset. Age is carried verbatim (frozen: the lifecycle is
    // resolved off while the solver is bound).
    if (uRigidEnabled && !rigidFree) {`;
// Free particles are pushed out of every body sphere they
// penetrate (position half of the collision; the velocity
// pass owns the reflection). Body order is index order,
// corrections sequential — the TS twin is
// collideFreeParticleWithBodies in lib/rigidBodies.ts.
const POS_FRAG_RIGID_FREE_SEGMENT = /* glsl */ `    if (rigidFree) {
      for (int b = 0; b < 256; b++) {
        if (float(b) >= uRigidBodyCount) break;
        vec4 bp = texture2D(uRigidBodyTex, vec2((float(b) + 0.5) / 256.0, 0.125));
        vec3 d = pos - bp.xyz;
        float dist = length(d);
        if (dist < bp.w) {
          vec3 n = dist > 0.000001 ? d / dist : vec3(0.0, 1.0, 0.0);
          pos = bp.xyz + n * bp.w;
          if (collisionTrack) collisionContact = true;
        }
      }
    }

`;
const POS_FRAG_FLOOR_CLAMP_OPEN = '    // Floor clamp (B3): Kinetix resolves penetration as';

export interface PositionFragmentVariantOptions {
  grainsProjection?: boolean;
  grainsCellSort?: boolean;
  // G10 stage 1: particle-rule kill segment, spliced in only
  // while an effective rule list exists.
  particleRules?: boolean;
  // Coupling stage 2: free particles inside rigid mode,
  // gated identically (only while the free-particles key is
  // on).
  rigidFree?: boolean;
  // Grammar 2.0 stage 1 (slice 1A): live-rule kill segment,
  // spliced in only while an effective LIVE rule list exists.
  particleRulesLive?: boolean;
  // Grammar 2.0 stage 2 (texture-unit follow-up): the merged
  // supply forms of the live segments + uniforms, gated
  // identically (only while the merged supply stands;
  // implies particleRulesLive).
  particleRulesLiveMerged?: boolean;
  // Grammar 2.0 stage 2 (slice E1): respawn placement through
  // the shared emitter shape law, spliced in only while
  // gpgpuRespawnShape names a shape (not 'auto').
  emitterShape?: boolean;
  // Grammar 2.0 stage 2 (slice E0): emitter transform of the
  // placed position, spliced in only while the emitter
  // transform keys are non-identity.
  emitterTransform?: boolean;
  // Grammar 2.0 stage 2 (slice E2): the spawn allocator's
  // threshold (effective rate over the envelope clock),
  // spliced in only while the absolute rate key is set or
  // the spawn envelope is enabled.
  spawnAlloc?: boolean;
  // Grammar 2.0 stage 2 (slice E2): the rule spawn gate
  // segment (REP bit 13 → respawn), spliced in only while
  // the gate key is on and an effective LIVE rule list
  // exists (it shares the live variant's REP texture).
  spawnRuleGate?: boolean;
  // Grammar 2.0 stage 2 (slice E3): respawn placement from
  // the emission cloud texture, spliced in only while the
  // emission source is 'morph' or 'bitmap'.
  emitterCloud?: boolean;
  // Grammar 2.0 stage 2 (slice E3): respawn placement on
  // the steering path polyline, spliced in only while the
  // emission source is 'path' with a usable path.
  emitterPath?: boolean;
  // Grammar 2.0 stage 2 (slice B2): the path-asset form of
  // the path placement — the polyline rides the shared
  // column-data texture, spliced in only while the emission
  // source is 'path' over an extended path asset. Mutually
  // exclusive with emitterPath (the assets pick one).
  emitterPathAsset?: boolean;
  // Grammar 2.0 stage 2 (slice E3): the emission mask gate
  // wraps whichever placement law is active, spliced in
  // only while the mask key is on and a mask source is
  // authored. While it is on, the emitter transform (when
  // also active) is folded into the gated candidates and
  // the standalone transform segment is NOT spliced.
  emitterMask?: boolean;
  // Grammar 2.0 stage 2 (slice B5): the distribution
  // operator layer over the shape law, spliced in only
  // while gpgpuEmitDistribution resolves to effective
  // operators. Applies after the placement (inside the mask
  // variant: to each shape-law candidate), before the
  // emitter transform.
  emitDistribution?: boolean;
  // Grammar 2.0 stage 2 (slice B5): the shader-seed opt-in,
  // spliced in only while gpgpuShaderSeed is non-zero. The
  // placement draws (legacy / shape / path, and the mask
  // candidates) carry the seed phase uniform.
  shaderSeed?: boolean;
  // Grammar 2.0 stage 2 (slice B1): field instances. The
  // position pass reads no field data — the option exists
  // only so this pass derives the spawn gate value from the
  // initial-position texture while the velocity pass runs
  // its field variant (which gave the spawn-order unit to
  // the column texture), keeping the two passes' gate values
  // identical (the texture-unit-fix discipline).
  fieldInstances?: boolean;
}

// Merged-supply forms (stage 2 texture-unit follow-up):
// while the merged supply stands, the texture bound to
// uRuleLiveTex is the REP's taller target and every live
// read scales vUv.y by uLiveTexYScale (texSize / total
// height, supplied per frame; the lib/gpgpuMergedSupply.ts
// plan). Derived from the stock chunks by the one sampling
// change, so the forms can never drift apart; the stock
// chunks — and every non-merged string — are untouched.
const POS_FRAG_PARTICLE_RULES_LIVE_UNIFORMS_MERGED = POS_FRAG_PARTICLE_RULES_LIVE_UNIFORMS + /* glsl */ `
uniform float uLiveTexYScale;
`;
const scaleLiveRead = (segment: string): string =>
  segment.split('texture2D(uRuleLiveTex, vUv)').join('texture2D(uRuleLiveTex, vec2(vUv.x, vUv.y * uLiveTexYScale))');
const POS_FRAG_PARTICLE_RULES_LIVE_SEGMENT_MERGED = scaleLiveRead(POS_FRAG_PARTICLE_RULES_LIVE_SEGMENT);
const POS_FRAG_PARTICLE_RULES_LIVE_TRUE_KILL_SEGMENT_MERGED = scaleLiveRead(POS_FRAG_PARTICLE_RULES_LIVE_TRUE_KILL_SEGMENT);
const POS_FRAG_SPAWN_RULE_GATE_SEGMENT_MERGED = scaleLiveRead(POS_FRAG_SPAWN_RULE_GATE_SEGMENT);

export function buildPositionFragment(options?: PositionFragmentVariantOptions): string {
  const projection = !!options?.grainsProjection;
  const cell = projection && !!options?.grainsCellSort;
  let tail = options?.particleRules || options?.particleRulesLive || options?.spawnRuleGate
    ? POS_FRAG_TAIL.replace(
        POS_FRAG_GROUP_KILL_BLOCK,
        POS_FRAG_GROUP_KILL_BLOCK
          + (options?.particleRules ? POS_FRAG_PARTICLE_RULES_SEGMENT : '')
          + (options?.particleRulesLive ? (options?.particleRulesLiveMerged ? POS_FRAG_PARTICLE_RULES_LIVE_SEGMENT_MERGED : POS_FRAG_PARTICLE_RULES_LIVE_SEGMENT) : '')
          + (options?.spawnRuleGate ? (options?.particleRulesLiveMerged ? POS_FRAG_SPAWN_RULE_GATE_SEGMENT_MERGED : POS_FRAG_SPAWN_RULE_GATE_SEGMENT) : ''),
      )
    : POS_FRAG_TAIL;
  if (options?.rigidFree) {
    tail = tail.replace(
      POS_FRAG_FLOOR_CLAMP_OPEN,
      POS_FRAG_RIGID_FREE_SEGMENT + POS_FRAG_FLOOR_CLAMP_OPEN,
    );
  }
  // Emitter variants (stage 2, E0+E1): the shape law replaces
  // the legacy placement wholesale; the transform statement
  // goes right after whichever placement ran. Neither fires
  // in the default build, so the default string is untouched.
  //
  // Emission sources (stage 2, E3): the cloud / path laws
  // replace the placement the same way (cloud > path > shape
  // precedence mirrors the runtime's single-source
  // resolution). The mask gate wraps the active law instead
  // of replacing it, and folds the transform into its
  // candidates — so while the mask is on, the standalone
  // transform segment below is skipped.
  const emitLaw: 'legacy' | 'shape' | 'cloud' | 'path' = options?.emitterCloud
    ? 'cloud'
    : options?.emitterPath || options?.emitterPathAsset
      ? 'path'
      : options?.emitterShape
        ? 'shape'
        : 'legacy';
  if (options?.emitterMask) {
    tail = tail.replace(
      POS_FRAG_RESPAWN_PLACEMENT_LEGACY,
      emitMaskPlacement(emitLaw, options?.emitterShape ? 'shape' : 'legacy', !!options?.emitterTransform, !!options?.emitDistribution, !!options?.shaderSeed),
    );
  } else if (options?.emitterCloud) {
    tail = tail.replace(POS_FRAG_RESPAWN_PLACEMENT_LEGACY, POS_FRAG_RESPAWN_PLACEMENT_CLOUD);
  } else if (options?.emitterPath || options?.emitterPathAsset) {
    tail = tail.replace(POS_FRAG_RESPAWN_PLACEMENT_LEGACY, options?.shaderSeed ? POS_FRAG_RESPAWN_PLACEMENT_PATH_SEED : POS_FRAG_RESPAWN_PLACEMENT_PATH);
  } else if (options?.emitterShape) {
    tail = tail.replace(POS_FRAG_RESPAWN_PLACEMENT_LEGACY, options?.shaderSeed ? POS_FRAG_RESPAWN_PLACEMENT_SHAPE_SEED : POS_FRAG_RESPAWN_PLACEMENT_SHAPE);
  } else if (options?.shaderSeed) {
    // The legacy placement with seed-shifted draws.
    tail = tail.replace(POS_FRAG_RESPAWN_PLACEMENT_LEGACY, POS_FRAG_RESPAWN_PLACEMENT_LEGACY_SEED);
  }
  if (options?.emitterTransform && !options?.emitterMask) {
    tail = tail.replace(
      POS_FRAG_RESPAWN_AGE_ANCHOR,
      POS_FRAG_EMITTER_TRANSFORM_SEGMENT + POS_FRAG_RESPAWN_AGE_ANCHOR,
    );
  }
  if (options?.emitDistribution && !options?.emitterMask && (emitLaw === 'legacy' || emitLaw === 'shape')) {
    // Distribution layer (stage 2, B5): right after the
    // placement, BEFORE the emitter transform segment (the
    // bake's order). Cloud / path placements are source
    // placements, not shape samples — the bake's override
    // discards the distributed sample there too, so the
    // segment stands only over the analytic laws. The mask
    // variant applies it inside its candidates instead
    // (above).
    const anchorCombo = options?.emitterTransform
      ? POS_FRAG_EMITTER_TRANSFORM_SEGMENT + POS_FRAG_RESPAWN_AGE_ANCHOR
      : POS_FRAG_RESPAWN_AGE_ANCHOR;
    tail = tail.replace(anchorCombo, POS_FRAG_DIST_SEGMENT + anchorCombo);
  }
  let mid = POS_FRAG_MID;
  // Coupling stage 2: while rigidFree stands, the MID's
  // rigid branch opens with the free-subset test instead of
  // the stock branch open (applied before the live / field /
  // spawn-alloc MID rewrites below, whose anchors are disjoint).
  if (options?.rigidFree) {
    mid = mid.replace(POS_FRAG_RIGID_BRANCH_OPEN, POS_FRAG_RIGID_BRANCH_OPEN_FREE);
  }
  if (options?.particleRulesLive || options?.fieldInstances) {
    // Texture-unit fix: derive the spawn gate value from
    // the initial-position texture (see the note at
    // POS_FRAG_SPAWN_ORDER_DECL_STOCK). The live variant
    // needs the unit for the REP texture; the field variant
    // (B1) needs the VELOCITY pass's unit for the column
    // texture, and this pass derives identically so the
    // cohort choice stays the same in both passes.
    mid = mid
      .replace(POS_FRAG_SPAWN_ORDER_DECL_STOCK, POS_FRAG_SPAWN_ORDER_DECL_LIVE)
      .replace(POS_FRAG_SPAWN_GATE_READ_STOCK, POS_FRAG_SPAWN_GATE_READ_LIVE);
  }
  if (options?.particleRulesLive) {
    // Splice the true-kill segment as before.
    mid = mid.replace(
      POS_FRAG_SPAWN_GATE_ANCHOR,
      POS_FRAG_SPAWN_GATE_ANCHOR + (options?.particleRulesLiveMerged ? POS_FRAG_PARTICLE_RULES_LIVE_TRUE_KILL_SEGMENT_MERGED : POS_FRAG_PARTICLE_RULES_LIVE_TRUE_KILL_SEGMENT),
    );
  }
  // Spawn allocator (stage 2, E2): the gate's two threshold
  // expressions read the effective rate over the envelope
  // clock. Only in this variant — the default MID is the
  // shipped string.
  if (options?.spawnAlloc) {
    mid = mid
      .replace(POS_FRAG_THR_NOW_LEGACY, POS_FRAG_THR_NOW_ALLOC)
      .replace(POS_FRAG_THR_PREV_LEGACY, POS_FRAG_THR_PREV_ALLOC);
  }
  return POS_FRAG_HEAD
    + (options?.particleRules ? POS_FRAG_PARTICLE_RULES_UNIFORMS : '')
    + (options?.rigidFree ? POS_FRAG_RIGID_FREE_UNIFORMS : '')
    + (options?.particleRulesLive || options?.spawnRuleGate ? (options?.particleRulesLiveMerged ? POS_FRAG_PARTICLE_RULES_LIVE_UNIFORMS_MERGED : POS_FRAG_PARTICLE_RULES_LIVE_UNIFORMS) : '')
    + (options?.spawnAlloc ? POS_FRAG_SPAWN_ALLOC_UNIFORMS : '')
    + (options?.spawnRuleGate ? POS_FRAG_SPAWN_RULE_GATE_UNIFORMS : '')
    + (options?.emitterShape ? POS_FRAG_EMITTER_SHAPE_UNIFORMS + EMIT_SHAPE_GLSL : '')
    + (options?.emitterTransform ? POS_FRAG_EMITTER_TRANSFORM_UNIFORMS : '')
    + (options?.emitterCloud ? POS_FRAG_EMITTER_CLOUD_UNIFORMS : '')
    + (options?.emitterPath ? POS_FRAG_EMITTER_PATH_UNIFORMS : '')
    + (options?.emitterPathAsset ? POS_FRAG_EMITTER_PATH_ASSET_UNIFORMS : '')
    + (options?.emitterMask ? POS_FRAG_EMITTER_MASK_UNIFORMS : '')
    + (options?.emitDistribution ? POS_FRAG_DIST_UNIFORMS : '')
    + (options?.shaderSeed ? POS_FRAG_SEED_UNIFORMS : '')
    + (projection ? POS_FRAG_PROJECTION_UNIFORMS : '')
    + (cell ? POS_FRAG_PROJECTION_CELL : '')
    + mid
    + (projection ? (cell ? POS_FRAG_PROJECTION_SEGMENT_CELL : POS_FRAG_PROJECTION_SEGMENT) : '')
    + tail;
}

export const SIM_POS_FRAG = buildPositionFragment();
export const SIM_POS_FRAG_PHASE19 = buildPositionFragment({ grainsProjection: true });
export const SIM_POS_FRAG_PHASE19_CELL = buildPositionFragment({ grainsProjection: true, grainsCellSort: true });
