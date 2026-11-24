/**
 * Shared IBL GLSL helpers (Phase 22 stage 3).
 *
 * The equirect direction mapping and yaw rotation used by the
 * GEOM IBL triplet (Phase AL, components/gpgpuShaderVolumes.ts)
 * and — from Phase 22 stage 3 — the layer-particle sphere IBL.
 * One shared chunk so the two consumers can never drift apart;
 * the TS twins are equirectUvForDirection / rotateDirectionYaw
 * in lib/iblEnvironment.ts, which remains the source of truth
 * for the formulas.
 *
 * The string is byte-identical to the segment that used to be
 * inlined in GEOM_FRAG_MID (the phase18 shader hash pins the
 * assembled GEOM fragment, so any drift fails the hash check).
 */
export const IBL_GLSL_HELPERS = /* glsl */ `
  vec3 kaloIblRotYaw(vec3 d, float yaw) {
    float c = cos(yaw);
    float s = sin(yaw);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  }
  vec2 kaloEquirectUv(vec3 dir) {
    float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830988618 + 0.5;
    float u = atan(dir.z, dir.x) * 0.15915494309 + 0.5;
    return vec2(u, v);
  }
`;
