// ── Velocity sim fragment, part 4 of 5: main(): SPH fluid + Grains contact ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
// Slice B8: the stride-loop shape (open / sample UV / self
// skip) is interpolated from lib/gpgpuNeighborLoop.ts; the
// assembled strings are unchanged byte-for-byte.
import { NEIGHBOR_SELF_SKIP_GLSL, NEIGHBOR_STRIDE_OPEN_GLSL, NEIGHBOR_SUV_GLSL } from '../lib/gpgpuNeighborLoop';
const VEL_FRAG_SPH_GRAINS_HEAD_A = /* glsl */ `    // SPH Fluid Simulation
    if (uSphEnabled) {
      float density = 0.0;
      vec3 pressureForce = vec3(0.0);
      vec3 viscForce = vec3(0.0);
      // Surface tension (Phase AB, cohesion approximation): the
      // accumulated pull toward neighbours, kernel-weighted.
      vec3 cohesionForce = vec3(0.0);
`;
// Surface tension, Akinci form (Phase 24): the extra
// accumulators of the two-term model. Spliced in only behind
// the sphAkinci builder option, in the Phase 19 manner — the
// stock HEAD (A + B + C + D below) is byte-identical to v2.05.
const VEL_FRAG_SPH_AKINCI_DECL = /* glsl */ `      // Surface tension, Akinci form (Phase 24): the cohesion
      // sum with the Akinci spline kernel, and the colour-field
      // gradient / Laplacian pair the curvature term is built
      // from (TS twin: sphSurfaceTensionAkinciForce in
      // lib/gpgpuLifecycle.ts).
      vec3 akinciCohesionForce = vec3(0.0);
      vec3 akinciColorGrad = vec3(0.0);
      float akinciColorLap = 0.0;
`;
const VEL_FRAG_SPH_GRAINS_HEAD_B = /* glsl */ `      float h2 = uSphRadius * uSphRadius;
${NEIGHBOR_STRIDE_OPEN_GLSL}${NEIGHBOR_SELF_SKIP_GLSL}        vec3 oPos = texture2D(uPosTex, sUv).xyz;
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
`;
// Akinci per-sample accumulation: still inside the sample's
// range test, directly after the legacy cohesion accumulation.
const VEL_FRAG_SPH_AKINCI_ACCUM = /* glsl */ `          if (uSphSurfaceTensionAkinci > 0.0) {
            // Term 1 — cohesion with the Akinci spline kernel:
            // negative (repulsive, and small) at very short
            // range, positive (attractive) through the mid
            // range, zero at q = 1. Scaled by 32 so the peak
            // (1/64 at q = 0.5) lands at 0.5 per sample — the
            // legacy cohesion sample's order, NOT the x15
            // pressure gain (the Phase AB heating lesson; the
            // constants' rationale lives in the TS twin).
            float rl = sqrt(r2);
            float omq = 1.0 - q;
            float kA = omq * omq * omq * q * q * q;
            if (q <= 0.5) kA = 2.0 * kA - 0.015625;
            akinciCohesionForce += ((oPos - pos) / rl) * (kA * 32.0);
            // Term 2 accumulators — the colour field of the
            // shared kernel w = max(0, 1-q^2): its gradient is
            // the exact per-sample sum of -2r / h^2 (r = pos -
            // oPos); its Laplacian (the constant -6 / h^2 per
            // sample) is accumulated mollified by w itself, so
            // a sample fades at the kernel boundary instead of
            // kicking the sum — the first Phase 24 gate round
            // showed the unweighted form heating the live sim
            // intermittently (rationale in the TS twin).
            akinciColorGrad += (-2.0 * r) / h2;
            akinciColorLap += (-6.0 / h2) * w;
          }
`;
const VEL_FRAG_SPH_GRAINS_HEAD_C = /* glsl */ `        }
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
`;
// Akinci application: additive with the legacy cohesion above
// — the two models are independent and zero independently.
const VEL_FRAG_SPH_AKINCI_APPLY = /* glsl */ `      if (uSphSurfaceTensionAkinci > 0.0) {
        // Curvature term: the colour gradient is the surface
        // normal (toward the bulk; it cancels for an interior
        // particle), kappa = -lap / |grad| is the CSF curvature
        // estimate (divergence of the normalised gradient,
        // Hessian term dropped), and the force is kappa x
        // |grad| x gate along that normal — the |grad| factor
        // is the CSF interface delta, and the gate (in radius
        // units, applied squared so the noisy mid-gate region
        // contributes least) keeps the term off the interior,
        // where |grad| ~ 0. The product is bounded by
        // 6 * samples / h^2 x gain however small |grad| gets.
        // Gain 8 (Phase 24 gate round 2): round 1 ran gain 25
        // with a linear gate and heated intermittently on the
        // real GPU; 8 keeps the term a gentle bias under the
        // cohesion sum, and the finished sum is applied at
        // x1.0 like the AB term.
        float akinciGradLen = length(akinciColorGrad);
        vec3 akinciNormal = akinciGradLen > 0.000001 ? akinciColorGrad / akinciGradLen : vec3(0.0);
        float akinciKappa = akinciGradLen > 0.000001 ? -akinciColorLap / akinciGradLen : 0.0;
        float akinciGate = clamp(akinciGradLen * uSphRadius * 0.25, 0.0, 1.0);
        vec3 akinciCurvatureForce = akinciNormal * (akinciKappa * akinciGradLen * akinciGate * akinciGate * 8.0);
        // Force cap (Phase 24 gate round 3): the finished sum
        // is clamped to length 3.0 before the strength applies
        // — at strength 3.0 the unclamped tail (a dense clump
        // whose samples align) still pumped one run in two
        // past the control in the late window, while 1.5 was
        // stable. The cap sits well above the sum's typical
        // magnitude (~1); rationale in the TS twin.
        vec3 akinciSum = akinciCohesionForce + akinciCurvatureForce;
        float akinciSumLen = length(akinciSum);
        if (akinciSumLen > 3.0) akinciSum *= 3.0 / akinciSumLen;
        vel += akinciSum * uSphSurfaceTensionAkinci * uDelta * 1.0;
      }
`;
const VEL_FRAG_SPH_GRAINS_HEAD_D = /* glsl */ `    }

    // Grains (Phase AQ): DEM-style grain contact. A separate
    // subsample loop from SPH above (the SPH loop accumulates
    // density incrementally and prices pressure from the running
    // total — a different quantity from per-contact overlap and
    // relative velocity, and sharing it would mean editing the
    // SPH-only path). Per sampled neighbour closer than the
    // grain diameter:
    //   normal  — penalty repulsion, overlap x stiffness, at
`;
const VEL_FRAG_SPH_GRAINS_COMMENT_PHASE19 = /* glsl */ `    //             the SPH force gain (x15). Phase 19 adds the
    //             position projection AQ lacked (a Jacobi
    //             segment in the position pass, driven by
    //             uGrainsProjection there), so deep compression
    //             no longer keeps its interpenetration.
`;
const VEL_FRAG_SPH_GRAINS_COMMENT_LEGACY = /* glsl */ `    //             the SPH force gain (x15). No position
    //             projection exists, so deep compression keeps
    //             some interpenetration (documented limit).
`;
const VEL_FRAG_SPH_GRAINS_MID_A = /* glsl */ `    //   friction — Coulomb: cancel the tangential relative
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
`;
const VEL_FRAG_SPH_GRAINS_SCAN_PHASE19 = /* glsl */ `      // Neighbourhood scan plan (Phase 19, TS twin grainsScanPlan
      // in lib/gpgpuGrains.ts): mode 0 reproduces the AQ plan
      // exactly — uNBodySamples candidates at the fractional
      // stride uTexSizeF / uNBodySamples over the first-row span,
      // same order, same arithmetic. Mode 1 walks the whole
      // position texture (span uTexSizeF^2): stride 1 up to the
      // 65536-texel budget (the default pool is exhaustive —
      // no in-range neighbour is skipped), the smallest integer
      // stride that fits the budget beyond it.
      float gCount = float(uNBodySamples);
      float gStride = uTexSizeF / float(uNBodySamples);
      if (uGrainsNeighborhood == 1) {
        float gSpan = uTexSizeF * uTexSizeF;
        gStride = gSpan > 65536.0 ? ceil(gSpan / 65536.0) : 1.0;
        gCount = ceil(gSpan / gStride);
      }
`;
const VEL_FRAG_SPH_GRAINS_SCAN_LEGACY = /* glsl */ `      float strideG = uTexSizeF / float(uNBodySamples);
`;
const VEL_FRAG_SPH_GRAINS_MID_B = /* glsl */ `      float grainsVel0Len = length(vel);
      vec3 pushForce = vec3(0.0);
      vec3 frictionDelta = vec3(0.0);
      vec3 dampDelta = vec3(0.0);
      vec3 bounceDelta = vec3(0.0);
      vec3 cohesionPull = vec3(0.0);
      float contactCount = 0.0;
`;
const VEL_FRAG_SPH_GRAINS_LOOP_PHASE19 = /* glsl */ `      for (int i = 0; i < 65536; i++) {
        if (float(i) >= gCount) break;
        float si = float(i) * gStride;
`;
const VEL_FRAG_SPH_GRAINS_LOOP_LEGACY = /* glsl */ `      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * strideG;
`;
// The Grains scan tail's sample-UV line is the shared
// neighbour-loop shape (slice B8); the name is kept because
// the builder below splices it by name.
const VEL_FRAG_SPH_GRAINS_TAIL_SUV = NEIGHBOR_SUV_GLSL;
const VEL_FRAG_SPH_GRAINS_TAIL_CORE = NEIGHBOR_SELF_SKIP_GLSL + /* glsl */ `        vec3 oPos = texture2D(uPosTex, sUv).xyz;
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
`;
const VEL_FRAG_SPH_GRAINS_TAIL_POST = /* glsl */ `      vel += pushForce * uGrainsStiffness * uDelta * 15.0;
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

// ── Phase 19 gate fix: string-level shader variants ──
// On the target GPU, ANY code-text change in these shaders
// breaks bit-identity with v2.00 — even code gated off by a
// false uniform (measured, see PHASE19_GATE_DIAGNOSIS). The
// Phase 19 additions therefore sit behind builder options:
// the default exports below are byte-identical to v2.00 and
// the *_PHASE19 exports are byte-identical to the Phase 19
// strings (both pinned by scripts/phase18-shader-hash.mjs).
export interface VelocitySphGrainsVariantOptions {
  grainsFullScan?: boolean;
  // Phase 24: the Akinci surface-tension chunks (declaration,
  // per-sample accumulation, application) splice into the SPH
  // head only behind this option — with it off, the composed
  // head is the v2.05 HEAD byte-for-byte.
  sphAkinci?: boolean;
  // Grains Stage C: the XSPH segment (pile solver velocity
  // smoothing with the settle gate) splices in after the
  // Grains block only behind this option — with it off, the
  // composed chunk is byte-identical to the pre-Stage-C build.
  grainsPileXsph?: boolean;
}

function buildVelocitySphGrainsHead(options?: VelocitySphGrainsVariantOptions): string {
  const akinci = !!options?.sphAkinci;
  return VEL_FRAG_SPH_GRAINS_HEAD_A
    + (akinci ? VEL_FRAG_SPH_AKINCI_DECL : '')
    + VEL_FRAG_SPH_GRAINS_HEAD_B
    + (akinci ? VEL_FRAG_SPH_AKINCI_ACCUM : '')
    + VEL_FRAG_SPH_GRAINS_HEAD_C
    + (akinci ? VEL_FRAG_SPH_AKINCI_APPLY : '')
    + VEL_FRAG_SPH_GRAINS_HEAD_D;
}

const VEL_FRAG_SPH_GRAINS_CELL_OPEN = /* glsl */ `      // Cell sort (Phase 19 fix2): while the passes resolved
      // uGrainsCellSort, candidates come from the sorted cell
      // index instead of the complete walk in the else branch —
      // the 27 cells around this particle, each located by
      // binary search and walked with the per-candidate test
      // verbatim (the shared TAIL_CORE below), so the contact
      // SET is the brute-force set; only the accumulation
      // order changes (cell order instead of texel order).
      // Without the sort (replica stacks receive no sort pool)
      // the else branch keeps the stage-1 complete scan.
      if (uGrainsCellSort) {
        vec3 myCell = grainsCellOf(pos);
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
`;
const VEL_FRAG_SPH_GRAINS_CELL_ELSE = /* glsl */ `          }
      } else {
`;
const VEL_FRAG_SPH_GRAINS_CELL_CLOSE = /* glsl */ `      }
`;

// ── XSPH (Grains Stage C): velocity smoothing toward the
// neighbourhood mean, gated per particle on the neighbourhood
// having settled — the user's chosen form of the prototype's
// "after the pile forms" timing (run 7 showed unconditional
// early XSPH flattening the forming pile; run 10's late
// application held the shape and cut the residual motion to
// about a fifth). The gate reads the kernel-weighted mean
// speed of the neighbours (frame-start velocities): fully open
// at or below 2.0, closed at or above 4.5, smoothstep between
// (TS twin: grainsXsphGate). The band was recalibrated at the
// Stage C real-GPU gate (2026-11-26): the prototype band
// (0.75/1.75) never opened in the product, whose settled pile
// sits at a mean speed of ~2.3 while the falling stream runs
// at ~8 and above. The correction
// is the prototype's delta = strength x gate x
// sum_j w_j (v_j - v_i) / (W(0) + sum_j w_j), with v_i the
// velocity accumulated so far this pass and v_j the
// frame-start velocities — the product's velocity is an
// independent texture, so a Jacobi read is the only option
// (documented in the Stage C design).
// Candidate source follows the resolved neighbourhood: with
// the complete scan built, the cell sort / complete walk over
// the h window; otherwise the legacy subsample (the gate and
// the mean are statistical quantities, so a sampled
// neighbourhood prices them the same way the SPH loop does).
const VEL_FRAG_SPH_GRAINS_XSPH_HEAD = /* glsl */ `    // XSPH (Grains Stage C): see the builder note in the
    // source module — settle-gated velocity smoothing.
    if (uGrainsEnabled && uGrainsXsphStrength > 0.0) {
      float hX = max(uGrainsSupport, 0.001);
      float hX2 = hX * hX;
      vec3 xsphWVelSum = vec3(0.0);
      float xsphWSum = 0.0;
      float xsphSpeedWSum = 0.0;
`;
// The body carries its candidate loop's closing brace, like
// the shared TAIL_CORE — the cell / scan / sampled loop opens
// differ, the close is common.
const VEL_FRAG_SPH_GRAINS_XSPH_BODY = NEIGHBOR_SELF_SKIP_GLSL + /* glsl */ `        vec3 oPosX = texture2D(uPosTex, sUv).xyz;
        vec3 rX = pos - oPosX;
        float r2X = dot(rX, rX);
        if (r2X < hX2 && r2X > 0.000000000001) {
          float wX = grainsXsphW(sqrt(r2X), hX);
          vec3 oVelX = texture2D(uVelTex, sUv).xyz;
          xsphWVelSum += oVelX * wX;
          xsphWSum += wX;
          xsphSpeedWSum += length(oVelX) * wX;
        }
      }
`;
const VEL_FRAG_SPH_GRAINS_XSPH_SCAN_OPEN = /* glsl */ `        float spanX = uTexSizeF * uTexSizeF;
        float strideX2 = spanX > 65536.0 ? ceil(spanX / 65536.0) : 1.0;
        float countX = ceil(spanX / strideX2);
        for (int i = 0; i < 65536; i++) {
          if (float(i) >= countX) break;
          float si = float(i) * strideX2;
          vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
`;
const VEL_FRAG_SPH_GRAINS_XSPH_SAMPLED = /* glsl */ `      float strideX = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * strideX;
${NEIGHBOR_SUV_GLSL}` + VEL_FRAG_SPH_GRAINS_XSPH_BODY;
const VEL_FRAG_SPH_GRAINS_XSPH_APPLY = /* glsl */ `      if (xsphWSum > 0.0) {
        float meanSpeedX = xsphSpeedWSum / xsphWSum;
        float gateX = 1.0 - smoothstep(2.0, 4.5, meanSpeedX);
        if (gateX > 0.0) {
          float wSelfX = grainsXsphW(0.0, hX);
          vel += uGrainsXsphStrength * gateX * (xsphWVelSum - vel * xsphWSum) / (wSelfX + xsphWSum);
        }
      }
    }

`;

export function buildVelocitySphGrains(options?: VelocitySphGrainsVariantOptions): string {
  const full = !!options?.grainsFullScan;
  const head = buildVelocitySphGrainsHead(options);
  const xsph = !!options?.grainsPileXsph;
  const xsphChunk = !xsph
    ? ''
    : VEL_FRAG_SPH_GRAINS_XSPH_HEAD
      + (full
        ? VEL_FRAG_SPH_GRAINS_CELL_OPEN
          + VEL_FRAG_SPH_GRAINS_XSPH_BODY
          + VEL_FRAG_SPH_GRAINS_CELL_ELSE
          + VEL_FRAG_SPH_GRAINS_XSPH_SCAN_OPEN
          + VEL_FRAG_SPH_GRAINS_XSPH_BODY
          + VEL_FRAG_SPH_GRAINS_CELL_CLOSE
        : VEL_FRAG_SPH_GRAINS_XSPH_SAMPLED)
      + VEL_FRAG_SPH_GRAINS_XSPH_APPLY;
  if (!full) {
    return head
      + VEL_FRAG_SPH_GRAINS_COMMENT_LEGACY
      + VEL_FRAG_SPH_GRAINS_MID_A
      + VEL_FRAG_SPH_GRAINS_SCAN_LEGACY
      + VEL_FRAG_SPH_GRAINS_MID_B
      + VEL_FRAG_SPH_GRAINS_LOOP_LEGACY
      + VEL_FRAG_SPH_GRAINS_TAIL_SUV
      + VEL_FRAG_SPH_GRAINS_TAIL_CORE
      + VEL_FRAG_SPH_GRAINS_TAIL_POST
      + xsphChunk;
  }
  return head
    + VEL_FRAG_SPH_GRAINS_COMMENT_PHASE19
    + VEL_FRAG_SPH_GRAINS_MID_A
    + VEL_FRAG_SPH_GRAINS_SCAN_PHASE19
    + VEL_FRAG_SPH_GRAINS_MID_B
    + VEL_FRAG_SPH_GRAINS_CELL_OPEN
    + VEL_FRAG_SPH_GRAINS_TAIL_CORE
    + VEL_FRAG_SPH_GRAINS_CELL_ELSE
    + VEL_FRAG_SPH_GRAINS_LOOP_PHASE19
    + VEL_FRAG_SPH_GRAINS_TAIL_SUV
    + VEL_FRAG_SPH_GRAINS_TAIL_CORE
    + VEL_FRAG_SPH_GRAINS_CELL_CLOSE
    + VEL_FRAG_SPH_GRAINS_TAIL_POST
    + xsphChunk;
}

export const VEL_FRAG_MAIN_SPH_GRAINS = buildVelocitySphGrains();
export const VEL_FRAG_MAIN_SPH_GRAINS_PHASE19 = buildVelocitySphGrains({ grainsFullScan: true });
export const VEL_FRAG_MAIN_SPH_GRAINS_PHASE24 = buildVelocitySphGrains({ grainsFullScan: true, sphAkinci: true });
