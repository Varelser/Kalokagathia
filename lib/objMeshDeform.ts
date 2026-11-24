// OBJ mesh vertex deformation (Phase 30, §11-3 T4): analytic
// deformation of the imported OBJ mesh, injected into the mesh
// materials via onBeforeCompile. The geometry is normalised to
// a bounding-sphere radius of 1 (lib/objMesh.ts), so all math
// runs in that local space, before the per-copy transforms —
// every copy deforms identically.
//
// Modes (amount / frequency / speed are the shared 0..1-style
// panel parameters; the mapping lives here):
// - wave: displacement along the vertex normal by a travelling
//   sine over (x + z). Normals are left unchanged (the lighting
//   error is second-order at the mapped amplitude).
// - twist: rotation around the Y axis proportional to height;
//   the vertex normal rotates by the same angle (exact).
// - bend: a parabolic bend (y += k * x^2) with the matching
//   first-order normal tilt around Z.
// The phase advances with uObjDeformTime * speed; speed 0 is a
// static shape (the tunnel-scroll convention). Mode 'off'
// produces NO injection at all — the material stays the stock
// three.js program and the render is identical to before.

export type ObjMeshDeformMode = 'off' | 'wave' | 'twist' | 'bend';

export interface ObjDeformUniforms {
  uObjDeformTime: { value: number };
  uObjDeformAmount: { value: number };
  uObjDeformFreq: { value: number };
  uObjDeformSpeed: { value: number };
}

export function createObjDeformUniforms(): ObjDeformUniforms {
  return {
    uObjDeformTime: { value: 0 },
    uObjDeformAmount: { value: 0.4 },
    uObjDeformFreq: { value: 1 },
    uObjDeformSpeed: { value: 0.5 },
  };
}

const HEAD = /* glsl */ `
uniform float uObjDeformTime;
uniform float uObjDeformAmount;
uniform float uObjDeformFreq;
uniform float uObjDeformSpeed;
`;

/** Chunk inserted at `#include <beginnormal_vertex>` (after the
 *  include, so objectNormal exists). '' for off / wave. */
export function objDeformBeginNormal(mode: ObjMeshDeformMode): string {
  if (mode === 'twist') {
    return /* glsl */ `
      {
        float kaloTwistA = uObjDeformAmount * 3.14159265 * (position.y * uObjDeformFreq + uObjDeformTime * uObjDeformSpeed);
        float kaloTwistC = cos(kaloTwistA);
        float kaloTwistS = sin(kaloTwistA);
        objectNormal.xz = mat2(kaloTwistC, -kaloTwistS, kaloTwistS, kaloTwistC) * objectNormal.xz;
      }
`;
  }
  if (mode === 'bend') {
    return /* glsl */ `
      {
        float kaloBendTilt = 2.0 * 0.3 * uObjDeformAmount * uObjDeformFreq * position.x;
        float kaloBendC = cos(kaloBendTilt);
        float kaloBendS = sin(kaloBendTilt);
        objectNormal.xy = mat2(kaloBendC, -kaloBendS, kaloBendS, kaloBendC) * objectNormal.xy;
      }
`;
  }
  return '';
}

/** Chunk inserted at `#include <begin_vertex>` (after the
 *  include, so `transformed` starts as the raw position). */
export function objDeformBeginVertex(mode: ObjMeshDeformMode): string {
  if (mode === 'wave') {
    return /* glsl */ `
      {
        float kaloWave = sin((position.x + position.z) * uObjDeformFreq * 6.2831853 + uObjDeformTime * uObjDeformSpeed * 6.2831853);
        transformed += normal * (kaloWave * uObjDeformAmount * 0.35);
      }
`;
  }
  if (mode === 'twist') {
    return /* glsl */ `
      {
        float kaloTwistA = uObjDeformAmount * 3.14159265 * (position.y * uObjDeformFreq + uObjDeformTime * uObjDeformSpeed);
        float kaloTwistC = cos(kaloTwistA);
        float kaloTwistS = sin(kaloTwistA);
        transformed.xz = mat2(kaloTwistC, -kaloTwistS, kaloTwistS, kaloTwistC) * transformed.xz;
      }
`;
  }
  if (mode === 'bend') {
    return /* glsl */ `
      transformed.y += 0.3 * uObjDeformAmount * uObjDeformFreq * transformed.x * transformed.x;
`;
  }
  return '';
}

/**
 * Build the onBeforeCompile hook for a deform mode. For 'off'
 * returns null — the caller must then not touch the material
 * at all (byte-identical stock program).
 */
export function buildObjDeformOnBeforeCompile(
  mode: ObjMeshDeformMode,
  uniforms: ObjDeformUniforms,
): ((shader: {
  uniforms: Record<string, { value: number }>;
  vertexShader: string;
}) => void) | null {
  if (mode === 'off') return null;
  const beginNormal = objDeformBeginNormal(mode);
  const beginVertex = objDeformBeginVertex(mode);
  return (shader) => {
    shader.uniforms.uObjDeformTime = uniforms.uObjDeformTime;
    shader.uniforms.uObjDeformAmount = uniforms.uObjDeformAmount;
    shader.uniforms.uObjDeformFreq = uniforms.uObjDeformFreq;
    shader.uniforms.uObjDeformSpeed = uniforms.uObjDeformSpeed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + beginNormal)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + beginVertex);
  };
}
