// ── Velocity sim fragment, part 4 of 5: main(): SPH fluid + Grains contact ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
export const VEL_FRAG_MAIN_SPH_GRAINS = /* glsl */ `    // SPH Fluid Simulation
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
        // Surface selectivity (Phase 15): scale the pull by the
        // density deficit, so it acts where the neighbourhood is
        // incomplete (the surface) instead of isotropically.
        // Selectivity 0 gives a factor of exactly 1 — the AB
        // behaviour bit-for-bit.
        float deficit = 1.0 - clamp(density / max(uSphRestDensity, 0.0001), 0.0, 1.0);
        float selFactor = mix(1.0, deficit, clamp(uSphSurfaceSelectivity, 0.0, 1.0));
        vel += cohesionForce * selFactor * uSphSurfaceTension * uDelta * 1.0;
      }
    }

    // Grains (Phase AQ): DEM-style grain contact. A separate
    // subsample loop from SPH above (the SPH loop accumulates
    // density incrementally and prices pressure from the running
    // total — a different quantity from per-contact overlap and
    // relative velocity, and sharing it would mean editing the
    // SPH-only path). Per sampled neighbour closer than the
    // grain diameter:
    //   normal  — penalty repulsion, overlap x stiffness, at
    //             the SPH force gain (x15). No position
    //             projection exists, so deep compression keeps
    //             some interpenetration (documented limit).
    //   friction — Coulomb: cancel the tangential relative
    //             velocity, capped at friction x the contact's
    //             normal push; below the cap the contact sticks.
    //             The pile's angle of repose emerges from this
    //             coefficient (plus the floor / terrain surface
    //             friction) — it is measured, not set.
    //   cohesion — the Phase AB offset-proportional pull at the
    //             gentle x1 gain (a stiff shared gain heated the
    //             cloud on the AB gate; gains stay separated).
    //   restitution — a fraction of the approaching normal
    //             velocity returned (0 = fully inelastic).
    //   contact damping — the standard DEM viscous term: a
    //             fixed fraction of the normal relative
    //             velocity is removed per contact. Without it
    //             the penalty kick at contact equilibrium
    //             (~overlap x stiffness x dt x 15 per frame)
    //             keeps grains jittering above the rest
    //             threshold forever (measured on the first AQ
    //             gate: the pile churned as much as the OFF
    //             control). Glancing stream contacts have
    //             small normal velocities, so flow is barely
    //             touched.
    // Rest damping then bleeds velocity from slow grains that
    // are in contact, so a pile settles instead of creeping
    // forever; airborne grains (no contact) are never damped,
    // which is also what keeps age respawns (teleports into
    // free space) out of the rest term's reach.
    if (uGrainsEnabled) {
      float gd = max(uGrainsSize, 0.001);
      float gd2 = gd * gd;
      float strideG = uTexSizeF / float(uNBodySamples);
      float grainsVel0Len = length(vel);
      vec3 pushForce = vec3(0.0);
      vec3 frictionDelta = vec3(0.0);
      vec3 dampDelta = vec3(0.0);
      vec3 bounceDelta = vec3(0.0);
      vec3 cohesionPull = vec3(0.0);
      float contactCount = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * strideG;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 oVel = texture2D(uVelTex, sUv).xyz;
        vec3 r = pos - oPos;
        float r2 = dot(r, r);
        if (r2 < gd2 && r2 > 0.0001) {
          float dist = sqrt(r2);
          vec3 n = r / dist;
          float overlap = gd - dist;
          pushForce += n * overlap;
          contactCount += 1.0;
          // This contact's normal push in velocity units (the
          // same x15 application the accumulated sum gets).
          float pushVel = overlap * uGrainsStiffness * uDelta * 15.0;
          vec3 rv = vel - oVel;
          float vn = dot(rv, n);
          dampDelta -= n * (vn * 0.15);
          vec3 vt = rv - n * vn;
          float vtLen = length(vt);
          if (vtLen > 0.0001) {
            float cap = uGrainsFriction * pushVel;
            float kill = vtLen <= cap ? 1.0 : cap / vtLen;
            frictionDelta -= vt * kill;
          }
          if (uGrainsRestitution > 0.0 && vn < 0.0) {
            bounceDelta += n * (-vn * uGrainsRestitution);
          }
          if (uGrainsCohesion > 0.0) {
            float q = dist / gd;
            float w = max(0.0, 1.0 - q * q);
            cohesionPull += (oPos - pos) * (w / gd);
          }
        }
      }
      vel += pushForce * uGrainsStiffness * uDelta * 15.0;
      vel += bounceDelta;
      // Contact damping is priced on the frame-start velocity
      // (it removes a fraction of the normal relative velocity
      // that existed when the contacts were read), so it clamps
      // against that, not against the post-penalty speed — the
      // penalty can legitimately cancel the whole velocity in
      // one frame, and the damping must still land.
      float ddLen = length(dampDelta);
      if (ddLen > 0.0001 && ddLen > grainsVel0Len) {
        dampDelta *= grainsVel0Len / ddLen;
      }
      vel += dampDelta;
      // Friction applies last, clamped to whatever velocity
      // remains: the two removal terms together can never
      // overshoot it or reverse it.
      float fdLen = length(frictionDelta);
      if (fdLen > 0.0001) {
        float vLen = length(vel);
        if (fdLen > vLen) frictionDelta *= vLen / fdLen;
      }
      vel += frictionDelta;
      if (uGrainsCohesion > 0.0) {
        vel += cohesionPull * uGrainsCohesion * uDelta * 1.0;
      }
      if (contactCount > 0.0 && uGrainsRestDamping > 0.0) {
        if (dot(vel, vel) < 0.25) {
          vel *= max(0.0, 1.0 - uGrainsRestDamping * 0.3);
        }
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

`;
