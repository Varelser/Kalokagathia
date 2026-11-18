// ── Vellum constraint solver passes (Phase AR; BB adds 3) ──
//
// Dedicated passes, all absent (never run) while their feature
// is off, so the legacy frame is untouched:
//
// 1. SIM_VELLUM_PROJ_FRAG — one Jacobi iteration of the distance-
//    constraint projection over the texel grid. Reads the current
//    position texture plus the static rest bake (the same arrays
//    the pool was seeded with), accumulates each texel's own half
//    of every link correction (structural / shear / bend),
//    AVERAGED over the number of live links, then applies pinning
//    as a position fix. The average is load-bearing: a plain sum
//    of per-link half-corrections amplifies the checkerboard mode
//    by (1 − 4·stiffness) per iteration and diverges outright at
//    stiffness 1 (Phase AR unit probe, measured: total link
//    strain 12 → 4,923 in 8 iterations). Dividing by the live-
//    link count is the standard Jacobi averaging — every mode
//    stays contractive for stiffness ≤ 1, at the known cost of
//    slower convergence per iteration (residual stretch under
//    strong pulls, documented in lib/gpgpuVellum.ts). The pass
//    runner repeats it `substeps` times per frame; neighbours
//    always come from the iteration's input texture.
//
// 2. SIM_VELLUM_STATE_FRAG — the tear state update, run once per
//    frame before the projections and only while a severing
//    rule is live (tear, or glue with a break threshold —
//    Phase BB). State .r / .g hold the survival of the texel's
//    right / up structural links; .b holds the survival of the
//    texel's glue bond. Severing is monotonic: a dead link
//    never revives (the pool re-bake is the only reset). Shear
//    and bend links derive their survival from the structural
//    links of their quad corner / path (see the projection
//    shader), so a tear visibly opens instead of leaving the
//    diagonal web intact.
//
// 3. SIM_VELLUM_VEL_FRAG (Phase BB) — the stitch pass: one
//    velocity-coupling sweep over the structural links, run
//    once per frame after the projections and only while the
//    stitch key is > 0. See its own header below.

// Texel helpers shared by the passes. tc is a texel coordinate
// in [0, uTexSizeF); in shell mode x wraps (longitude), y never
// wraps (the poles are rings, not a torus). vellumIsPinned is
// the single pin rule (Phase BB factored it out of the
// projection main so the velocity-coupling pass anchors exactly
// the same texels); every including shader declares uVellumPin.
const VELLUM_TEXEL_GLSL = /* glsl */ `
  vec2 vellumWrapTexel(vec2 t) {
    if (uVellumMode == 1) t.x = mod(t.x, uTexSizeF);
    return clamp(t, vec2(0.0), vec2(uTexSizeF - 1.0));
  }
  vec2 vellumUvOf(vec2 t) { return (t + 0.5) / uTexSizeF; }
  bool vellumHasNeighbor(vec2 base, vec2 d) {
    vec2 t = base + d;
    if (uVellumMode != 1 && (t.x < 0.0 || t.x > uTexSizeF - 1.0)) return false;
    if (t.y < 0.0 || t.y > uTexSizeF - 1.0) return false;
    return true;
  }
  // Pinning: a position fix to the rest pose, not a force.
  // Row 0 is the sheet's top edge (the bake lays iy -> -y);
  // on the shell the same rows are the pole rings.
  bool vellumIsPinned(vec2 tc) {
    if (uVellumPin == 1) {
      return tc.y < 0.5;
    } else if (uVellumPin == 2) {
      return (tc.x < 0.5 || tc.x > uTexSizeF - 1.5) && (tc.y < 0.5 || tc.y > uTexSizeF - 1.5);
    } else if (uVellumPin == 3) {
      return tc.y < 0.5 || ((tc.x < 0.5 || tc.x > uTexSizeF - 1.5) && tc.y > uTexSizeF - 1.5);
    }
    return false;
  }
`;

export const SIM_VELLUM_PROJ_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVellumRestTex;
  uniform sampler2D uVellumStateTex;
  uniform bool  uVellumTearEnabled;
  uniform int   uVellumMode;
  uniform float uVellumStiffness;
  uniform float uVellumBend;
  uniform int   uVellumPin;
  uniform float uVellumGlue;
  uniform bool  uVellumGlueStateEnabled;
  uniform float uTexSizeF;
  varying vec2 vUv;

  ${VELLUM_TEXEL_GLSL}

  float stateR(vec2 t) {
    if (!uVellumTearEnabled) return 1.0;
    return texture2D(uVellumStateTex, vellumUvOf(vellumWrapTexel(t))).r;
  }
  float stateG(vec2 t) {
    if (!uVellumTearEnabled) return 1.0;
    return texture2D(uVellumStateTex, vellumUvOf(vellumWrapTexel(t))).g;
  }
  // Glue survival (.b), read only while the state texture is
  // being maintained for glue (break threshold finite). With
  // unbreakable glue there is no state texture read at all and
  // every bond is alive by construction.
  float stateB(vec2 t) {
    if (!uVellumGlueStateEnabled) return 1.0;
    return texture2D(uVellumStateTex, vellumUvOf(vellumWrapTexel(t))).b;
  }

  // This texel's half of one link's distance correction. The
  // other endpoint computes the mirror half from its own link
  // set, so a live link is fully corrected across the pair.
  vec3 linkCorr(vec3 pos, vec3 restPos, vec2 nTc, float rate, float alive) {
    if (alive <= 0.0 || rate <= 0.0) return vec3(0.0);
    vec2 nUv = vellumUvOf(vellumWrapTexel(nTc));
    vec3 np = texture2D(uPosTex, nUv).xyz;
    vec3 rn = texture2D(uVellumRestTex, nUv).xyz;
    float rest = length(rn - restPos);
    vec3 delta = np - pos;
    float d = length(delta);
    if (d < 0.000001 || rest < 0.000001) return vec3(0.0);
    return delta * ((d - rest) / d) * 0.5 * rate;
  }

  // A link's contribution to the Jacobi average: live links
  // (neighbour exists — checked by the caller — alive, positive
  // rate) count toward the divisor whether or not this link
  // happens to be strained right now.
  vec3 linkSolve(vec3 pos, vec3 restPos, vec2 nTc, float rate, float alive, inout float wsum) {
    if (alive <= 0.0 || rate <= 0.0) return vec3(0.0);
    wsum += 1.0;
    return linkCorr(pos, restPos, nTc, rate, alive);
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec3 pos = posData.xyz;
    vec3 restPos = texture2D(uVellumRestTex, vUv).xyz;
    vec2 tc = floor(vUv * uTexSizeF);
    float stiff = uVellumStiffness;
    float bend = uVellumBend;
    vec3 corr = vec3(0.0);
    float wsum = 0.0;

    // Structural links (right / left / up / down). A link's
    // survival is owned by its left (right-links) or lower
    // (up-links) endpoint's state channel.
    if (vellumHasNeighbor(tc, vec2(1.0, 0.0)))
      corr += linkSolve(pos, restPos, tc + vec2(1.0, 0.0), stiff, stateR(tc), wsum);
    if (vellumHasNeighbor(tc, vec2(-1.0, 0.0)))
      corr += linkSolve(pos, restPos, tc + vec2(-1.0, 0.0), stiff, stateR(tc - vec2(1.0, 0.0)), wsum);
    if (vellumHasNeighbor(tc, vec2(0.0, 1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(0.0, 1.0), stiff, stateG(tc), wsum);
    if (vellumHasNeighbor(tc, vec2(0.0, -1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(0.0, -1.0), stiff, stateG(tc - vec2(0.0, 1.0)), wsum);

    // Shear links (the four diagonals). A diagonal survives
    // while the two structural links of its quad corner do.
    if (vellumHasNeighbor(tc, vec2(1.0, 1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(1.0, 1.0), stiff, min(stateR(tc), stateG(tc + vec2(1.0, 0.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(-1.0, 1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(-1.0, 1.0), stiff, min(stateR(tc - vec2(1.0, 0.0)), stateG(tc - vec2(1.0, 0.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(1.0, -1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(1.0, -1.0), stiff, min(stateR(tc), stateG(tc + vec2(1.0, -1.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(-1.0, -1.0)))
      corr += linkSolve(pos, restPos, tc + vec2(-1.0, -1.0), stiff, min(stateR(tc - vec2(1.0, 0.0)), stateG(tc - vec2(1.0, 1.0))), wsum);

    // Bend links (two texels away, straight). A bend link
    // survives while both structural links along its path do.
    if (vellumHasNeighbor(tc, vec2(2.0, 0.0)))
      corr += linkSolve(pos, restPos, tc + vec2(2.0, 0.0), bend, min(stateR(tc), stateR(tc + vec2(1.0, 0.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(-2.0, 0.0)))
      corr += linkSolve(pos, restPos, tc + vec2(-2.0, 0.0), bend, min(stateR(tc - vec2(1.0, 0.0)), stateR(tc - vec2(2.0, 0.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(0.0, 2.0)))
      corr += linkSolve(pos, restPos, tc + vec2(0.0, 2.0), bend, min(stateG(tc), stateG(tc + vec2(0.0, 1.0))), wsum);
    if (vellumHasNeighbor(tc, vec2(0.0, -2.0)))
      corr += linkSolve(pos, restPos, tc + vec2(0.0, -2.0), bend, min(stateG(tc - vec2(0.0, 1.0)), stateG(tc - vec2(0.0, 2.0))), wsum);

    // Glue (Phase BB): a zero-rest-length distance link from
    // this texel to its own bake point. The anchor never moves,
    // so the correction is the full (restPos - pos) * rate —
    // no mirror half — counted as one link in the Jacobi
    // average like every other constraint. A dead bond (state
    // .b, maintained only while a break threshold is set)
    // contributes nothing and does not count.
    if (uVellumGlue > 0.0 && stateB(tc) > 0.0) {
      wsum += 1.0;
      corr += (restPos - pos) * uVellumGlue;
    }

    // The Jacobi average (see the header: the plain sum
    // diverges at stiffness 1).
    if (wsum > 0.0) pos += corr / wsum;

    // Pinning: a position fix to the rest pose, not a force
    // (the rule itself lives in vellumIsPinned, shared with
    // the velocity-coupling pass).
    bool pinned = vellumIsPinned(tc);
    if (pinned) pos = restPos;

    gl_FragColor = vec4(pos, posData.w);
  }
`;

export const SIM_VELLUM_STATE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVellumRestTex;
  uniform sampler2D uVellumStateTex;
  uniform float uVellumTear;
  uniform int   uVellumMode;
  uniform int   uVellumPin;
  uniform float uVellumGlueBreak;
  uniform float uTexSizeF;
  varying vec2 vUv;

  ${VELLUM_TEXEL_GLSL}

  // Strain of one structural link against the frame-start
  // positions; a link whose strain exceeds the threshold dies.
  // Missing neighbours (sheet borders) keep their state.
  float linkAlive(vec3 pos, vec3 restPos, vec2 tc, vec2 d, float prevAlive) {
    if (prevAlive <= 0.0) return 0.0;
    if (!vellumHasNeighbor(tc, d)) return prevAlive;
    vec2 nUv = vellumUvOf(vellumWrapTexel(tc + d));
    float rest = length(texture2D(uVellumRestTex, nUv).xyz - restPos);
    if (rest < 0.000001) return prevAlive;
    float dist = length(texture2D(uPosTex, nUv).xyz - pos);
    return dist / rest > uVellumTear ? 0.0 : prevAlive;
  }

  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    vec3 restPos = texture2D(uVellumRestTex, vUv).xyz;
    vec3 prev = texture2D(uVellumStateTex, vUv).rgb;
    vec2 tc = floor(vUv * uTexSizeF);
    float aliveR = linkAlive(pos, restPos, tc, vec2(1.0, 0.0), prev.r);
    float aliveU = linkAlive(pos, restPos, tc, vec2(0.0, 1.0), prev.g);
    // Glue survival (.b, Phase BB): the bond dies — monotonic,
    // like a torn link — once the texel's displacement from
    // its bake point exceeds the break threshold. A threshold
    // of 0 leaves the channel untouched (unbreakable glue).
    float glueAlive = prev.b;
    if (uVellumGlueBreak > 0.0 && glueAlive > 0.0) {
      if (length(pos - restPos) > uVellumGlueBreak) glueAlive = 0.0;
    }
    gl_FragColor = vec4(aliveR, aliveU, glueAlive, 1.0);
  }
`;

// ── Stitch: velocity coupling over the structural links ──
//
// The AR solver was position-only: the projection re-posed every
// texel each frame, but velocities never learned about it, so a
// pull applied at one end of the sheet moved the far end only by
// re-projection, with no momentum behind it. This pass closes
// that gap with the simplest stable coupling: a Jacobi sweep
// that blends each texel's velocity toward the average of its
// live structural neighbours' velocities by the stitch rate.
// Momentum diffuses along the seams — a tug at one end
// accelerates the whole sheet over the following frames instead
// of stretching a projection. It is deliberately the same
// averaging discipline as the projection (a plain sum would
// amplify checkerboard modes), restricted to the four
// structural links: shear and bend links shape the pose, the
// structural web carries the pull. Torn links (state .r / .g)
// do not transmit. Pinned texels are anchors: their velocity is
// written as zero and they enter neighbours' averages as zero,
// so a fixed edge genuinely holds the sheet back. The pass runs
// after the projection and rewrites the velocity texture the
// NEXT frame integrates — it is a force applied through the
// links, not a pose fix. Honest scope: this is momentum
// exchange, not XPBD's Δλ velocity update; there is still no
// compliance in physical units.
export const SIM_VELLUM_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelTex;
  uniform sampler2D uVellumStateTex;
  uniform bool  uVellumTearEnabled;
  uniform int   uVellumMode;
  uniform float uVellumStitch;
  uniform int   uVellumPin;
  uniform float uTexSizeF;
  varying vec2 vUv;

  ${VELLUM_TEXEL_GLSL}

  float stateR(vec2 t) {
    if (!uVellumTearEnabled) return 1.0;
    return texture2D(uVellumStateTex, vellumUvOf(vellumWrapTexel(t))).r;
  }
  float stateG(vec2 t) {
    if (!uVellumTearEnabled) return 1.0;
    return texture2D(uVellumStateTex, vellumUvOf(vellumWrapTexel(t))).g;
  }

  // A neighbour's velocity as the coupling sees it: pinned
  // texels are anchors and read as zero, whatever the force
  // accumulation left in their texel this frame.
  vec3 linkVel(vec2 nTc) {
    if (vellumIsPinned(nTc)) return vec3(0.0);
    return texture2D(uVelTex, vellumUvOf(vellumWrapTexel(nTc))).xyz;
  }

  void main() {
    vec4 velData = texture2D(uVelTex, vUv);
    vec3 vel = velData.xyz;
    vec2 tc = floor(vUv * uTexSizeF);
    if (vellumIsPinned(tc)) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, velData.w);
      return;
    }
    vec3 sum = vec3(0.0);
    float cnt = 0.0;
    if (vellumHasNeighbor(tc, vec2(1.0, 0.0)) && stateR(tc) > 0.0) {
      sum += linkVel(tc + vec2(1.0, 0.0)); cnt += 1.0;
    }
    if (vellumHasNeighbor(tc, vec2(-1.0, 0.0)) && stateR(tc - vec2(1.0, 0.0)) > 0.0) {
      sum += linkVel(tc - vec2(1.0, 0.0)); cnt += 1.0;
    }
    if (vellumHasNeighbor(tc, vec2(0.0, 1.0)) && stateG(tc) > 0.0) {
      sum += linkVel(tc + vec2(0.0, 1.0)); cnt += 1.0;
    }
    if (vellumHasNeighbor(tc, vec2(0.0, -1.0)) && stateG(tc - vec2(0.0, 1.0)) > 0.0) {
      sum += linkVel(tc - vec2(0.0, 1.0)); cnt += 1.0;
    }
    vec3 outVel = vel;
    if (cnt > 0.0) outVel = vel + (sum / cnt - vel) * uVellumStitch;
    gl_FragColor = vec4(outVel, velData.w);
  }
`;
