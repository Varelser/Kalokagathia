// ── XPBD common GLSL chunk (Phase 19 stage 3) ───────────────
//
// The GLSL twin of lib/xpbdConstraints.ts: the Δλ update and
// the position-correction form shared by every XPBD consumer.
// Vellum's XPBD passes (gpgpuShaderSimulationVellum.ts) are the
// first consumer; Phase 20's rigid joints are expected to reuse
// the same chunk with body effective masses in place of the
// per-texel inverse masses.
//
//   alphaTilde = alpha / dt_s^2
//   deltaLambda = (-C - alphaTilde * lambda) / (denom + alphaTilde)
//   dx_i = deltaLambda * w_i * gradC_i
//
// λ is reset to zero at the head of every substep (the XPBD
// definition — accumulation is within the substep's solve
// only). The solve is snapshot-Jacobi: every Δλ is computed
// from the substep's input positions, then all corrections are
// applied together, exactly like the CPU mirror
// (stepXpbdClothMirror) the unit tests pin.

export const XPBD_GLSL = /* glsl */ `
  float xpbdAlphaTilde(float alpha, float dtSub) {
    float dt = max(dtSub, 0.000001);
    return max(alpha, 0.0) / (dt * dt);
  }
  float xpbdDeltaLambda(float c, float lambda, float alphaTilde, float denom) {
    return (-c - alphaTilde * lambda) / (denom + alphaTilde);
  }
`;
