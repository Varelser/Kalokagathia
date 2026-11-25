// ── Grains velocity update (Stage C follow-up): PBF-style ──
// velocity reconstruction after the pile iterations.
//
// The Stage C gate (GRAINS_STAGEC_GATE_RECORD.md) established
// why the pile would not settle in the product: the velocity
// is an independent texture, so the position-stage constraint
// solve removes overlap but the velocity field keeps its
// energy and the pile circulates at mean speed2 ~6.6. The
// prototype settled because its velocity WAS the position
// change (vel = new_pos - old_pos, x 0.995 damping).
//
// This pass restores that coupling for the pile configuration
// only: it runs once, right after the pile iterations and
// before the Vellum section, and blends velOut toward the
// velocity reconstructed from the frame's displacement
// through the position pass (the pile base snapshot minus
// posIn), inverting the product's non-Verlet integration
// pos += vel x dt x uSpeed x 60. At dt = 1/60 and uSpeed = 1
// the reconstruction is the displacement itself, matching the
// prototype.
//
// The end position is deliberately the PRE-SOLVE position,
// not the solved one. Gate rounds 1 and 3 (2026-11-26) proved
// the pile solve's clamp-saturated push-out, once converted
// into velocity, acts as a perpetual ejection pump at ANY
// displacement cap: uncapped it launched the pile to height
// ~300; capped at one diameter it boiled the pile apart
// slowly (bottom layer 16,384 -> 6,789 particles). The pump
// needs no large velocity — the solve re-creates the push
// from the overlap the velocity itself re-creates.
//
// 案E (gate round 4): on top of the pre-solve source （案A,
// round 2: launch gone, shape held at height p90 ~12, but the
// interior kept a speed2 floor of 2.29 against the 1.32
// minimum line), the reconstructed velocity is scaled by a
// density factor. The pile lambda pass's rho (read from
// uDensityTex .y, relative to uRho0) marks the pile interior;
// there the factor ramps down to uDenseDamp, damping the
// neighbour-coupled jitter every frame, while the surface and
// the falling stream (low rho) keep the plain behaviour. The
// pass renders into the shared spare target and is blitted
// back over velOut, following the Vellum XPBD
// velocity-reconstruction wiring precedent; the velocity
// texture's .w (phaseState) is preserved.
//
// Masks (a texel keeps its velocity untouched when any hits):
//   - parked sentinel (y <= -90000) on either position;
//   - age discontinuity — the position texture's .w is age:
//     a wrap backwards (respawn / reset) or an age advance
//     differing from dt by more than 2dt;
//   - teleport-scale displacement (length > grains size x 8),
//     which covers pointer-paint teleports when age is frozen.
// TS twin: grainsApplyVelocityUpdate in lib/gpgpuGrains.ts.
// Design: GRAINS_VELOCITY_UPDATE_DESIGN.md.

export const GRAINS_VELOCITY_UPDATE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uPosInTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uDensityTex;
  uniform float uDt;
  uniform float uSpeed;
  uniform float uBlend;
  uniform float uGrainsSize;
  uniform float uRho0;
  uniform float uDenseDamp;
  uniform float uDenseLo;
  uniform float uDenseHi;
  varying vec2 vUv;

  void main() {
    vec4 velData = texture2D(uVelTex, vUv);
    vec4 posIn = texture2D(uPosInTex, vUv);
    vec4 posOut = texture2D(uPosTex, vUv);
    vec3 vel = velData.xyz;
    // Mask: parked sentinel on either side.
    if (posIn.y > -90000.0 && posOut.y > -90000.0) {
      float ageIn = posIn.w;
      float ageOut = posOut.w;
      bool ageOk = !(ageOut < ageIn) && abs(ageOut - ageIn - uDt) <= 2.0 * uDt;
      vec3 disp = posOut.xyz - posIn.xyz;
      float teleport = max(uGrainsSize, 0.001) * 8.0;
      if (ageOk && length(disp) <= teleport) {
        vec3 recon = disp / max(uDt * 60.0 * uSpeed, 0.000000001);
        // 案E: extra damping where the lambda pass's density
        // marks the pile interior (rho at/above rest density).
        float rho = texture2D(uDensityTex, vUv).y;
        float ratio = rho / max(uRho0, 0.000000001);
        float dense = smoothstep(uDenseLo, uDenseHi, ratio);
        float factor = mix(1.0, uDenseDamp, dense);
        vel = mix(vel, recon * 0.995 * factor, uBlend);
      }
    }
    gl_FragColor = vec4(vel, velData.w);
  }
`;
