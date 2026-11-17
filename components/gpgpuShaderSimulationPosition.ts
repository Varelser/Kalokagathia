// ── Position sim fragment (+ Life/Age in .w) ──
export const SIM_POS_FRAG = /* glsl */ `
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
  uniform bool  uVerletEnabled;
  uniform sampler2D uPrevPosTex;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  uniform float uSdfBounce;
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
  uniform sampler2D uKillMaskTex;
  uniform float uKillMaskThreshold;
  uniform bool  uKillMaskInvert;
  varying vec2 vUv;

  float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Spawn gate hash (Phase AB): identical to the velocity pass and
  // to spawnHashForUv in lib/gpgpuLifecycle.ts.
  float spawnHash(vec2 uv) {
    return fract(sin(dot(uv + vec2(7.77, 3.13), vec2(127.1, 311.7))) * 43758.5453);
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
    return fract(sin(dot(uv * 913.7 + vec2(tick * 17.31, tick * 7.77), vec2(12.9898, 78.233))) * 43758.5453);
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
    return fract(sin(dot(uv * 913.7 + vec2(tick * 17.31, tick * 7.77), vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec3 pos = posData.xyz;
    float age = posData.w;
    vec3 vel = texture2D(uVelTex, vUv).xyz;

    // Spawn gate (Phase AB): an unreleased particle is parked
    // off-screen with its age frozen (the velocity pass zeroes its
    // velocity under the same test). On the single frame the
    // release threshold crosses its hash it activates through the
    // shared respawn block below. Burst 1 (default) skips this.
    bool spawnActivating = false;
    if (uSpawnBurst < 1.0) {
      float sHash = spawnHash(vUv);
      float thrNow = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTime(uSpawnTime));
      if (sHash >= thrNow) {
        gl_FragColor = vec4(0.0, -99999.0, 0.0, age);
        return;
      }
      float thrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTime(uSpawnTime - uDelta));
      spawnActivating = sHash >= thrPrev;
    }

    if (uVerletEnabled) {
      vec3 prevPos = texture2D(uPrevPosTex, vUv).xyz;
      pos = pos + (pos - prevPos) * 0.98 + vel * uDelta * uSpeed * 30.0;
    } else {
      pos += vel * uDelta * uSpeed * 60.0;
    }

    float dist = length(pos);
    if (dist > uBounceRadius * 1.05) pos = normalize(pos) * uBounceRadius * 1.05;

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
      if (sd < 0.0) pos -= sn * sd;
    }

    // Floor clamp (B3): Kinetix resolves penetration as
    // floorY + (floorY - y) * 0.1; the velocity pass owns the bounce.
    if (uFloorEnabled && pos.y < uFloorY) {
      pos.y = uFloorY + (uFloorY - pos.y) * 0.1;
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
        if (pos.y < tcH) pos.y = tcH;
      }
    }

    // Pointer paint (B3): gated particles are re-emitted at the brush
    // position with a hash offset inside the brush disc. The velocity
    // pass re-seeds their velocity under the same gate.
    if (uMouseEnabled && uMouseMode == 3) {
      float paintTick = floor(uTime * 30.0);
      float paintGate = paintHash(vUv, paintTick);
      if (paintGate < uMousePaintRate * 0.008) {
        vec3 paintOffset = vec3(
          hash1(vUv + paintTick * 0.731),
          hash1(vUv + paintTick * 1.317 + 4.7),
          hash1(vUv + paintTick * 2.113 + 9.1)
        ) - 0.5;
        pos = uMousePos + paintOffset * uMouseRadius * 0.7;
      }
    }

    // Respawn decision: the legacy age wrap, the Phase AB spawn
    // activation, and the Phase AB kill conditions all enter the
    // same respawn block below, so every (re)birth in the pool
    // shares one placement law (and one Aux birth signal).
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
    if (uKillBoundary && length(pos) > uBounceRadius + 0.001) doRespawn = true;
    if (uKillMask) {
      vec2 maskUv = clamp(pos.xy * (1.0 / (2.0 * max(uBounceRadius, 1.0))) + 0.5, 0.0, 1.0);
      float mLuma = dot(texture2D(uKillMaskTex, maskUv).rgb, vec3(0.2126, 0.7152, 0.0722));
      if (uKillMaskInvert) mLuma = 1.0 - mLuma;
      if (mLuma < uKillMaskThreshold) doRespawn = true;
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
