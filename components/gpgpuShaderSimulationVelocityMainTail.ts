// ── Velocity sim fragment, part 5 of 5: main(): morph attraction, Vellum pressure, paint, fluid advection, clamp / damping / bounce, age curves ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
const VEL_FRAG_TAIL_HEAD = /* glsl */ `    // Morph Target Attraction (Kinetix integration B1a): each particle
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

    // Mesh SDF Collider (Phase BY) — velocity response on the
    // baked mesh grid: the terrain collider's response shape
    // (reflect the normal component with restitution, damp the
    // tangential component with friction, which is what lets
    // particles come to rest on the surface instead of jittering
    // on the trilinear facets). Applied after the analytic SDF
    // block, so both colliders may be live; the position pass
    // owns the exact push-out.
    // Multi-body mesh SDF — min synthesis over all bodies at
    // the same position: only the deepest body responds, once,
    // with its own normal / Bounce / Friction. While multi is
    // live the passes leave uMeshSdfEnabled false, so the
    // single-body block below never double-applies.
    if (uMeshSdfMultiEnabled) {
      float bestSd = 1.0e6;
      int bestBody = -1;
      for (int bi = 0; bi < 4; bi++) {
        if (bi >= uMeshSdfBodyCount) break;
        float bsd = meshSdfBodyDistance(bi, pos);
        if (bsd < bestSd) { bestSd = bsd; bestBody = bi; }
      }
      if (bestBody >= 0 && bestSd < 2.0) {
        vec3 msn = meshSdfBodyNormal(bestBody, pos);
        float vn = dot(vel, msn);
        if (vn < 0.0) {
          vec3 vN = msn * vn;
          vec3 vT = vel - vN;
          vel = vT * (1.0 - uMeshSdfBodyFriction[bestBody]) - vN * uMeshSdfBodyBounce[bestBody];
        }
      }
    }

    if (uMeshSdfEnabled) {
      float msd = meshSdfDistance(pos);
      if (msd < 2.0) {
        vec3 msn = meshSdfNormal(pos);
        float vn = dot(vel, msn);
        if (vn < 0.0) {
          vec3 vN = msn * vn;
          vec3 vT = vel - vN;
          vel = vT * (1.0 - uMeshSdfFriction) - vN * uMeshSdfBounce;
        }
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

    // Pyro grid coupling (Phase CB): G2P transfer from the 3D
    // grid solver, in the FLIP pattern above but on all three
    // components — the grid solves y motion too. PIC takes the
    // grid velocity itself; FLIP takes the particle velocity
    // plus the grid's change this step (projected minus the
    // pre-projection base). The scale converts the grid's
    // cells/second into the particle velocity unit: a cell is
    // 2*bounceRadius/N world units and the position pass
    // integrates vel * dt * 60, so one vel unit is 60 world
    // units/second (uPyroGridVelScale is set CPU-side from
    // lib/pyroGrid.ts pyroGridVelScale). The block is skipped
    // entirely unless the grid is live and its blend key > 0.
    if (uPyroGridCouple) {
      vec3 cellPos = pyroCellOfWorld(pos);
      vec3 gridVel = pyroSample(uPyroGridVelTex, cellPos).xyz;
      vec3 baseVel = pyroSample(uPyroGridBaseTex, cellPos).xyz;
      vec3 picVel = gridVel * uPyroGridVelScale;
      vec3 flipVel = vel + (gridVel - baseVel) * uPyroGridVelScale;
      vec3 target = mix(picVel, flipVel, uPyroGridBlend);
      vel = mix(vel, target, uPyroGridTransfer);
    }

`;
const VEL_FRAG_TAIL_FLIP3D_COUPLE = /* glsl */ `    // FLIP 3D coupling (Phase 19 stage 2): G2P transfer from
    // the 3D FLIP solver, placed after the Pyro coupling (the
    // design's ordering: the legacy field -> pyro -> flip3d
    // sequence is preserved). PIC takes the grid velocity
    // itself; FLIP takes the particle velocity plus the grid's
    // change this step (projected minus the pre-projection
    // base). The scale converts cells/second into the particle
    // velocity unit (uFlip3dVelScale, set CPU-side via
    // pyroGridVelScale). The domain fade drops the transfer at
    // the cube faces, where the grid holds no liquid. The block
    // is skipped entirely unless the 3D solver is live.
    if (uFlip3dCouple) {
      vec3 cellPos = flip3dCellOfWorld(pos);
      float fade = flip3dDomainFade(cellPos);
      if (fade > 0.0) {
        vec3 gridVel = flip3dSample(uFlipBaseTex, cellPos, 0.0).xyz;
        vec3 baseVel = flip3dSample(uFlipBaseTex, cellPos, uFlip3dBaseTileOffset).xyz;
        vec3 picVel = gridVel * uFlip3dVelScale;
        vec3 flipVel = vel + (gridVel - baseVel) * uFlip3dVelScale;
        vec3 target = mix(picVel, flipVel, uFlip3dBlend);
        vel = mix(vel, target, uFlip3dTransfer * fade);
      }
    }

`;
const VEL_FRAG_TAIL_REST = /* glsl */ `    // __CUSTOM_FORCE__

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

// Coupling stage 2 (rigid ⇄ particle): the free-particle
// reflection segment. Spliced in only behind the rigidFree
// option, right before the tail's final write (in the Phase
// 19 manner — the stock tail string stays byte-identical).
// A free particle inside a body sphere and moving toward its
// centre has the normal component of its velocity reflected
// with the rigid restitution — the velocity half of the
// body-sphere collision (the position pass owns the push-out).
// Uses the frame-start position, the same snapshot discipline
// as the grains projection. TS twin:
// collideFreeParticleWithBodies in lib/rigidBodies.ts.
const VEL_FRAG_TAIL_RIGID_FREE = /* glsl */ `    if (rigidFree) {
      for (int b = 0; b < 256; b++) {
        if (float(b) >= uRigidBodyCount) break;
        vec4 bp = texture2D(uRigidBodyTex, vec2((float(b) + 0.5) / 256.0, 0.125));
        vec3 d = pos - bp.xyz;
        float dist = length(d);
        if (dist < bp.w && dist > 0.000001) {
          vec3 n = d / dist;
          float vn = dot(vel, n);
          if (vn < 0.0) vel -= n * vn * (1.0 + uRigidFreeBounce);
        }
      }
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
export interface VelocityTailVariantOptions {
  flip3dCouple?: boolean;
  // Coupling stage 2: the free-particle reflection segment,
  // gated identically (only while the free-particles key is
  // on). Assumes the main-forces rigidFree splice declared
  // the rigidFree flag earlier in main().
  rigidFree?: boolean;
  // Grammar 2.0 stage 1 (slice 1C): the global drag block is
  // spliced in its live-gated form — the rate is multiplied
  // by grpDrag, the gate local the main-forces live segment
  // declares (permit semantics: 1 = drag applies, 0 = the
  // particle keeps its velocity). Only in this variant; the
  // stock tail string is byte-identical.
  particleRulesLive?: boolean;
  // Grammar 2.0 stage 2 (slice B3): the target-speed block
  // is spliced in as the tail's final magnitude operation,
  // right before the output write. Only in this variant;
  // the stock tail string is byte-identical.
  targetSpeed?: boolean;
  // Grammar 2.0 stage 2 (slice B4): the age free curves —
  // the tail's 5-point evaluations for the velocity / force
  // targets are replaced by the free-curve evaluations
  // (the preamble carries the uniform sets + functions).
  // Only in these variants; the stock tail string is
  // byte-identical.
  ageFreeVelocity?: boolean;
  ageFreeForce?: boolean;
  // Layer 1 WP9 (phase D): local time — the built-in force
  // delta captured above (velAfterForces − velForceBase) is
  // scaled by the particle's group time factor, spliced in
  // right before the Phase AC force block. Only in this
  // variant; the stock tail string is byte-identical.
  localTime?: boolean;
}

const VEL_FRAG_TAIL_FINAL_WRITE = '    gl_FragColor = vec4(vel, phaseState);';

const VEL_FRAG_TAIL_AGE_CURVE5_FORCE_CALL = /* glsl */ `kaloEvalCurve5(ageNorm, uAgeCurveForce[0], uAgeCurveForce[1], uAgeCurveForce[2], uAgeCurveForce[3], uAgeCurveForce[4])`;
const VEL_FRAG_TAIL_AGE_FREE_FORCE_CALL = /* glsl */ `kaloEvalAgeFreeForce(ageNorm)`;
const VEL_FRAG_TAIL_AGE_CURVE5_VELOCITY_CALL = /* glsl */ `kaloEvalCurve5(ageNorm, uAgeCurveVelocity[0], uAgeCurveVelocity[1], uAgeCurveVelocity[2], uAgeCurveVelocity[3], uAgeCurveVelocity[4])`;
const VEL_FRAG_TAIL_AGE_FREE_VELOCITY_CALL = /* glsl */ `kaloEvalAgeFreeVelocity(ageNorm)`;

const VEL_FRAG_TAIL_OUTPUT_LINE = /* glsl */ `    gl_FragColor = vec4(vel, phaseState);`;

const VEL_FRAG_TAIL_FORCE_OVER_LIFETIME_ANCHOR = /* glsl */ `    // Force over Lifetime (Phase AC): scale only the built-in
`;
const VEL_FRAG_TAIL_LOCAL_TIME_BLOCK = /* glsl */ `    // Local time (Layer 1 WP9, phase D): the built-in force
    // delta captured above is scaled by this particle's
    // group time factor — the Phase AC capture discipline
    // (a factor of exactly 1 reconstructs vel bit-for-bit),
    // applied BEFORE the force-over-lifetime curve below so
    // the curve scales the local-time delta like every
    // other built-in force. velAfterForces is re-captured
    // so the curve reads the scaled delta. The passes hold
    // uLocalTimeCount at 0 while the attribute texture is
    // missing, which skips the block outright. TS twin:
    // localTimeScaleForceDelta in lib/gpgpuLocalTime.ts.
    if (uLocalTimeCount > 0) {
      float ltFactor = kaloLocalTimeFactor(attrData);
      vec3 ltDelta = velAfterForces - velForceBase;
      vel = velForceBase + ltDelta * ltFactor + (vel - velAfterForces);
      velAfterForces = velForceBase + ltDelta * ltFactor;
    }

`;
const VEL_FRAG_TAIL_TARGET_SPEED_BLOCK = /* glsl */ `    // Target speed (Grammar 2.0 stage 2, B3): the tail's
    // final magnitude setting — the pool previously had only
    // upper clamps (the hard 350 ceiling and gpgpuMaxSpeed).
    // Placed after the clamps, the global drag and the
    // velocity-over-lifetime curve, so the set value is the
    // magnitude the position pass integrates (the boundary
    // reflection above preserves magnitude). Blend 1 (the
    // default) is a hard set; lower blends approach the
    // target geometrically per step. The attribute slot
    // multiplies the target per particle (judgment 1; slot
    // −1 or a missing attribute texture leaves it unscaled).
    // The effective target is capped at the hard ceiling, so
    // the setting can never defeat the safety clamp. A
    // zero-velocity particle has no direction to scale and
    // is left untouched. TS twin: applyTargetSpeed in
    // lib/gpgpuSpeedDragSpin.ts.
    {
      float tsSpd = length(vel);
      if (tsSpd > 0.00001) {
        float tsTarget = uTargetSpeed;
        if (uAttrEnabled && uTargetSpeedSlot >= 0) tsTarget *= max(kaloAttrChannel(attrData, uTargetSpeedSlot), 0.0);
        tsTarget = min(tsTarget, 350.0);
        float tsNext = mix(tsSpd, tsTarget, uTargetSpeedBlend);
        vel *= tsNext / tsSpd;
      }
    }

`;

const VEL_FRAG_TAIL_DRAG_BLOCK = /* glsl */ `    if (uDragRate == 1.1) {
      vel *= (1.0 - 1.1 * uDelta);
    } else {
      vel *= (1.0 - uDragRate * uDelta);
    }`;
const VEL_FRAG_TAIL_DRAG_BLOCK_LIVE = /* glsl */ `    if (uDragRate == 1.1) {
      vel *= (1.0 - 1.1 * grpDrag * uDelta);
    } else {
      vel *= (1.0 - uDragRate * grpDrag * uDelta);
    }`;

export function buildVelocityTail(options?: VelocityTailVariantOptions): string {
  let rest = options?.particleRulesLive
    ? VEL_FRAG_TAIL_REST.replace(VEL_FRAG_TAIL_DRAG_BLOCK, VEL_FRAG_TAIL_DRAG_BLOCK_LIVE)
    : VEL_FRAG_TAIL_REST;
  if (options?.rigidFree) {
    rest = rest.replace(VEL_FRAG_TAIL_FINAL_WRITE, VEL_FRAG_TAIL_RIGID_FREE + VEL_FRAG_TAIL_FINAL_WRITE);
  }
  if (options?.targetSpeed) {
    rest = rest.replace(
      VEL_FRAG_TAIL_OUTPUT_LINE,
      VEL_FRAG_TAIL_TARGET_SPEED_BLOCK + VEL_FRAG_TAIL_OUTPUT_LINE,
    );
  }
  if (options?.ageFreeForce) {
    rest = rest.replace(VEL_FRAG_TAIL_AGE_CURVE5_FORCE_CALL, VEL_FRAG_TAIL_AGE_FREE_FORCE_CALL);
  }
  if (options?.ageFreeVelocity) {
    rest = rest.replace(VEL_FRAG_TAIL_AGE_CURVE5_VELOCITY_CALL, VEL_FRAG_TAIL_AGE_FREE_VELOCITY_CALL);
  }
  if (options?.localTime) {
    rest = rest.replace(
      VEL_FRAG_TAIL_FORCE_OVER_LIFETIME_ANCHOR,
      VEL_FRAG_TAIL_LOCAL_TIME_BLOCK + VEL_FRAG_TAIL_FORCE_OVER_LIFETIME_ANCHOR,
    );
  }
  return VEL_FRAG_TAIL_HEAD
    + (options?.flip3dCouple ? VEL_FRAG_TAIL_FLIP3D_COUPLE : '')
    + rest;
}

export const VEL_FRAG_MAIN_TAIL = buildVelocityTail();
export const VEL_FRAG_MAIN_TAIL_PHASE19 = buildVelocityTail({ flip3dCouple: true });
