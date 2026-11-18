// ── Velocity sim fragment, part 5 of 5: main(): morph attraction, Vellum pressure, paint, fluid advection, clamp / damping / bounce, age curves ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
export const VEL_FRAG_MAIN_TAIL = /* glsl */ `    // Morph Target Attraction (Kinetix integration B1a): each particle
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
      vel += (vWant - vel) * clamp(mf + uDelta * 6.0, 0.0, 1.0) * grpMorph;

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

    // Vellum pressure (Phase AR): a normal-direction force from
    // the local grid frame — the (unnormalised) cross product of
    // the right / up neighbour offsets, so the force is area-
    // weighted by construction. This is NOT a volume-preserving
    // pressure constraint: no enclosed-volume term exists, the
    // force simply pushes along the local normal (shells inflate
    // outward at positive pressure; the sheet normal is the
    // bake's -z side, so the sign flips the push direction).
    // Border texels of a sheet sample themselves through the
    // clamped UV and contribute no force.
    if (uVellumEnabled && uVellumPressure != 0.0) {
      vec2 vTc = floor(vUv * uTexSizeF);
      vec2 vTcR = vTc + vec2(1.0, 0.0);
      vec2 vTcU = vTc + vec2(0.0, 1.0);
      if (uVellumMode == 1) vTcR.x = mod(vTcR.x, uTexSizeF);
      vTcR = clamp(vTcR, vec2(0.0), vec2(uTexSizeF - 1.0));
      vTcU = clamp(vTcU, vec2(0.0), vec2(uTexSizeF - 1.0));
      vec3 posR = texture2D(uPosTex, (vTcR + 0.5) / uTexSizeF).xyz;
      vec3 posU = texture2D(uPosTex, (vTcU + 0.5) / uTexSizeF).xyz;
      vec3 vNormal = cross(posR - pos, posU - pos);
      vel += vNormal * uVellumPressure * uDelta * 30.0;
    }

    // Force over Lifetime capture (Phase AC): the velocity after
    // the built-in force accumulation (gravity … morph). The
    // collider / mouse / paint / floor / fluid / custom blocks
    // below are NOT part of the scaled delta.
    vec3 velAfterForces = vel;

    // Attribute force drive (Phase AK): scale only the built-in
    // force delta captured above by the particle's own attribute
    // (the Phase AC capture discipline — a factor of exactly 1
    // reconstructs vel bit-for-bit). The passes suppress the
    // block unless a slot is selected with a non-zero amount and
    // the attribute texture exists, so the default path is the
    // legacy capture verbatim. velAfterForces is re-captured so
    // the Phase AC force curve below scales the driven delta.
    if (uAttrForceEnabled) {
      float af = mix(1.0, kaloAttrChannel(attrData, uAttrForceSlot), uAttrForceAmount);
      vel = velForceBase + (vel - velForceBase) * af;
      velAfterForces = vel;
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

    // Multi-touch interference (Phase AO): pointers 2..N apply
    // the same falloff law as the primary pointer above, sharing
    // strength / radius / mode. Paint (mode 3) has no velocity-
    // side position term — the position pass picks the brush.
    if (uMouseEnabled && uMouseCount >= 2 && uMouseMode != 3) {
      for (int mi = 1; mi < 4; mi++) {
        if (mi >= uMouseCount) break;
        vec3 toMouseM = uMousePosMulti[mi] - pos;
        float mdM = length(toMouseM);
        if (mdM < uMouseRadius && mdM > 0.001) {
          float falloffM = (1.0 - mdM / uMouseRadius);
          falloffM *= falloffM;
          vec3 dirM = normalize(toMouseM);
          if (uMouseMode == 0) { // attract
            vel += dirM * falloffM * uMouseStrength * uDelta * 200.0;
          } else if (uMouseMode == 1) { // repel
            vel -= dirM * falloffM * uMouseStrength * uDelta * 200.0;
          } else if (uMouseMode == 2) { // swirl
            vec3 swirlM = cross(dirM, vec3(0.0, 1.0, 0.001));
            vel += normalize(swirlM) * falloffM * uMouseStrength * uDelta * 150.0;
          }
        }
      }
    }

    // Pointer paint (B3): the gate hash is shared with the position
    // pass, which teleports gated particles to the brush this same
    // frame; here they receive a fresh random velocity so the painted
    // particles stream away from the pointer instead of freezing.
    // Vellum (Phase AR) suppresses paint outright: a teleport would
    // tear the constraint grid apart (the position pass gates its
    // half of paint on the same flag).
    if (uMouseEnabled && uMouseMode == 3 && !uVellumEnabled) {
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
      if (uFlipEnabled) {
        // G2P transfer (Phase AT): the projected grid velocity
        // is carried back to the particles as a PIC/FLIP blend.
        // PIC takes the grid velocity itself; FLIP takes the
        // particle's own velocity plus the grid's change this
        // frame (projection increment). The field-to-world scale
        // keeps the legacy sample's uFluidInfluence meaning: a
        // field velocity of 1.0 maps to 60 world units at
        // Influence 1 (the legacy force integrated the same
        // field at x300 per second). Only the horizontal (xz)
        // components transfer — the grid solves no y motion.
        vec2 baseVel = texture2D(uFlipBaseTex, fieldUv).xy;
        float fScale = uFluidInfluence * 60.0;
        vec2 picVel = fieldVel * fScale;
        vec2 flipVel = vel.xz + (fieldVel - baseVel) * fScale;
        vec2 target = mix(picVel, flipVel, uFlipBlend);
        vel.xz = mix(vel.xz, target, uFlipTransfer);
      } else {
        vel.x += fieldVel.x * uFluidInfluence * uDelta * 300.0;
        vel.z += fieldVel.y * uFluidInfluence * uDelta * 300.0;
      }
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

    // Vellum damping (Phase AR): the projection pass moves
    // positions without touching this velocity texture, so a
    // cloth-specific bleed keeps the two from fighting (the
    // projected position says "stay", the stale velocity says
    // "keep falling"). The rate is the fraction removed per
    // 1/60 s frame, exponentiated by the step so the feel is
    // frame-rate independent like the Verlet damping constant.
    if (uVellumEnabled && uVellumDamping > 0.0) {
      vel *= pow(1.0 - clamp(uVellumDamping, 0.0, 0.95), uDelta * 60.0);
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
