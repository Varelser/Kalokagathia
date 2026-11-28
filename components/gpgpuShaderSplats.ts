import { SPLAT_CUTOFF_SIGMA } from "../lib/gpgpuSplat";

// ── Gaussian splat draw (Layer 1 WP7 Phase C1) ─────────────
// An independent instanced-quad primitive alongside the
// points draw (NOT a variant of it: GL_POINTS cannot draw
// anisotropic ellipses). The CPU twins live in
// lib/gpgpuSplat.ts; the terms below are kept term for term
// with them.
//
// Per instance, the vertex resolves the particle uv through
// the shared depth-sort texture when one is bound (the
// points draw's consumption form verbatim; with no sort
// bound, uSortEnabled is false and aTexCoord is used as-is),
// reads the centre from the pool position texture and the
// scale / opacity / rotation from the two dedicated
// parameter textures, composes Σ = R · diag(s²) · Rᵀ,
// projects it through the EWA Jacobian of the perspective
// divide at the centre, and expands the quad corner along
// the projected ellipse's principal axes (radius =
// SPLAT_CUTOFF_SIGMA · √λ). The fragment receives the corner
// in sigma units (vEllip = position.xy · cutoff), so the
// Gaussian weight is exp(−½·|vEllip|²) and the cutoff
// discard is |vEllip|² > cutoff².
//
// The colour starts from the single tint uColor (the
// gpgpuSplatColor key — a tint, not a colour feature, so the
// colour master does not gate it, exactly like gpgpuColor on
// the points draw). Phase C2 adds the per-splat colour
// source: the Phase CL attribute colour drive, shared with
// the points draw — the three colour slots' RAW values
// multiply the tint while uAttrColorEnabled is on. The
// supply (gpgpuVisualUpdates) resolves the drive from the
// colour-master-resolved config, so with the master off the
// drive is off and the splat keeps its single tint. Phase C3
// adds the columns form's DC colour (uSplatColorTex): the
// column set's RAW colorR/G/B values multiply the tint while
// uSplatColorEnabled is on — a colour feature, so the supply
// enables it only while the colour master is on
// (splatColumnsColorActive in lib/gpgpuSplatColumns.ts);
// with the master off the columns splat also keeps its tint.

const CUTOFF = SPLAT_CUTOFF_SIGMA.toFixed(1);
const CUTOFF_SQ = (SPLAT_CUTOFF_SIGMA * SPLAT_CUTOFF_SIGMA).toFixed(1);

const SPLAT_VERT_HEAD = /* glsl */ `
  precision highp float;
  attribute vec2 aTexCoord;
  uniform sampler2D uCenterTex;
  uniform sampler2D uSplatParamTex;
  uniform sampler2D uSplatRotTex;
  uniform sampler2D uSortTex;
  uniform bool uSortEnabled;
  uniform vec3 uColor;
  uniform float uScaleMul;
  uniform float uOpacityMul;
  // Attribute colour drive (Phase CL, shared with the points
  // draw): the colour slots hold the RAW colorR / colorG /
  // colorB values, resolved CPU-side from the slot names;
  // disabled leaves the colour at exactly the tint.
  uniform sampler2D uAttrTex;
  uniform bool      uAttrColorEnabled;
  // Columns DC colour (Phase C3): the column set's RAW
  // colorR / colorG / colorB payload; disabled (the pool
  // form, or the colour master off) leaves the colour at
  // exactly the tint path above.
  uniform sampler2D uSplatColorTex;
  uniform bool      uSplatColorEnabled;
  uniform int       uAttrColorSlotR;
  uniform int       uAttrColorSlotG;
  uniform int       uAttrColorSlotB;
  varying vec2 vEllip;
  varying vec4 vColor;
  // Attribute channel picker: identical to the points draw's
  // copy — R/G/B/A are attribute slots 0/1/2/3
  // (buildAttributeData in lib/gpgpuAttributes.ts).
  float kaloAttrChannel(vec4 a, int slot) {
    if (slot == 0) return a.r;
    if (slot == 1) return a.g;
    if (slot == 2) return a.b;
    return a.a;
  }
  // Term for term with quatToMat3Columns in lib/gpgpuOrient.ts
  // (GLSL mat3 constructor order = column-major: the three
  // columns of the rotation matrix) — the same helper text
  // the geometry vertex uses for uOrientTex.
  mat3 kaloQuatMat3(vec4 q) {
    float x = q.x;
    float y = q.y;
    float z = q.z;
    float w = q.w;
    return mat3(
      1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w),
      2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w),
      2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y));
  }
`;

const SPLAT_VERT_BODY = /* glsl */ `
  void main() {
    vec2 particleUv = uSortEnabled ? texture2D(uSortTex, aTexCoord).xy : aTexCoord;
    vec3 center = texture2D(uCenterTex, particleUv).xyz;
    vec4 param = texture2D(uSplatParamTex, particleUv);
    vec4 quat = texture2D(uSplatRotTex, particleUv);
    vec3 splatScale = max(param.xyz, vec3(0.0)) * uScaleMul;
    float opacity = clamp(param.w, 0.0, 1.0) * uOpacityMul;
    // Σ = R · diag(s²) · Rᵀ (splatCovariance in the twin),
    // composed as the sum of the columns' outer products —
    // the tree's shader dialect has no matrix-transpose
    // builtin in use.
    mat3 rot = kaloQuatMat3(quat);
    vec3 rc0 = rot[0] * (splatScale.x * splatScale.x);
    vec3 rc1 = rot[1] * (splatScale.y * splatScale.y);
    vec3 rc2 = rot[2] * (splatScale.z * splatScale.z);
    mat3 cov = mat3(
      rc0 * rot[0][0] + rc1 * rot[1][0] + rc2 * rot[2][0],
      rc0 * rot[0][1] + rc1 * rot[1][1] + rc2 * rot[2][1],
      rc0 * rot[0][2] + rc1 * rot[1][2] + rc2 * rot[2][2]);
    vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
    // Σv = W · Σ · Wᵀ (splatViewCovariance in the twin):
    // column j of the result is W · Σ · (row j of W).
    mat3 viewRot = mat3(modelViewMatrix);
    vec3 wr0 = vec3(viewRot[0][0], viewRot[1][0], viewRot[2][0]);
    vec3 wr1 = vec3(viewRot[0][1], viewRot[1][1], viewRot[2][1]);
    vec3 wr2 = vec3(viewRot[0][2], viewRot[1][2], viewRot[2][2]);
    mat3 covView = mat3(
      viewRot * (cov * wr0),
      viewRot * (cov * wr1),
      viewRot * (cov * wr2));
    // EWA Jacobian of the perspective divide at the centre
    // (splatProjectionJacobian in the twin).
    float tx = mvCenter.x;
    float ty = mvCenter.y;
    float tz = mvCenter.z;
    float tzSafe = tz < -0.0001 ? tz : -0.0001;
    vec3 j0 = vec3(projectionMatrix[0][0] / -tzSafe, 0.0, projectionMatrix[0][0] * tx / (tzSafe * tzSafe));
    vec3 j1 = vec3(0.0, projectionMatrix[1][1] / -tzSafe, projectionMatrix[1][1] * ty / (tzSafe * tzSafe));
    vec3 cj0 = covView * j0;
    vec3 cj1 = covView * j1;
    float pa = dot(j0, cj0);
    float pb = dot(j0, cj1);
    float pc = dot(j1, cj1);
    // Principal axes of the projected covariance
    // (splatEllipseFromCov2 in the twin).
    float mid = 0.5 * (pa + pc);
    float diff = 0.5 * (pa - pc);
    float disc = sqrt(diff * diff + pb * pb);
    float lambda1 = max(mid + disc, 0.0);
    float lambda2 = max(mid - disc, 0.0);
    float theta = 0.5 * atan(2.0 * pb, pa - pc);
    vec2 axis1 = vec2(cos(theta), sin(theta));
    vec2 axis2 = vec2(-sin(theta), cos(theta));
    float radius1 = ${CUTOFF} * sqrt(lambda1);
    float radius2 = ${CUTOFF} * sqrt(lambda2);
    // Centres at or behind the near plane collapse to a
    // degenerate quad (their clip position is clipped
    // regardless; zero radii keep the Jacobian's clamped
    // depth from painting a mirrored ellipse).
    if (tz > -0.01) {
      radius1 = 0.0;
      radius2 = 0.0;
    }
    vec4 clip = projectionMatrix * mvCenter;
    vec2 offset = axis1 * (position.x * radius1) + axis2 * (position.y * radius2);
    gl_Position = clip + vec4(offset * clip.w, 0.0, 0.0);
    vEllip = position.xy * ${CUTOFF};
    vec3 splatColor = uColor;
    if (uSplatColorEnabled) {
      splatColor *= texture2D(uSplatColorTex, particleUv).rgb;
    }
    if (uAttrColorEnabled) {
      vec4 attrData = texture2D(uAttrTex, particleUv);
      splatColor *= vec3(
        kaloAttrChannel(attrData, uAttrColorSlotR),
        kaloAttrChannel(attrData, uAttrColorSlotG),
        kaloAttrChannel(attrData, uAttrColorSlotB));
    }
    vColor = vec4(splatColor, opacity);
  }
`;

const SPLAT_FRAG_BODY = /* glsl */ `
  precision highp float;
  varying vec2 vEllip;
  varying vec4 vColor;
  void main() {
    float d2 = dot(vEllip, vEllip);
    if (d2 > ${CUTOFF_SQ}) discard;
    float alpha = vColor.a * exp(-0.5 * d2);
    gl_FragColor = vec4(vColor.rgb, alpha);
  }
`;

// Spin channel (Layer 1 WP8, phase D): while the Spin
// channel stands (gpgpuSpinEnabled), the accumulated angle
// composes outside the authored / Orient quaternion — the
// geometry draw's align ∘ spin ∘ orient order, with the
// tree's Y-axis spin convention (gpgpuShaderVolumes.ts).
// The splat draw was the one posture consumer the channel
// had not reached: its rotation came from uSplatRotTex
// alone. A variant like every other consumer's — the
// default string contains neither the uniform nor the
// composition.
const SPLAT_VERT_SPIN_UNIFORMS = /* glsl */ `
  uniform sampler2D uSpinTex;
`;

const SPLAT_VERT_SPIN_SEGMENT = /* glsl */ `    // Spin channel (Layer 1 WP8, phase D): compose the
    // accumulated spin outside the base rotation.
    {
      float spinA = texture2D(uSpinTex, particleUv).x;
      float spinC = cos(spinA);
      float spinS = sin(spinA);
      rot = mat3(spinC, 0.0, spinS, 0.0, 1.0, 0.0, -spinS, 0.0, spinC) * rot;
    }
`;

export interface SplatShaderOptions {
  /** Spin channel variant (Layer 1 WP8, phase D). */
  spinChannel?: boolean;
}

export function buildSplatVert(options?: SplatShaderOptions): string {
  if (!options?.spinChannel) return SPLAT_VERT_HEAD + SPLAT_VERT_BODY;
  return SPLAT_VERT_HEAD + SPLAT_VERT_SPIN_UNIFORMS
    + SPLAT_VERT_BODY.replace(
      '    mat3 rot = kaloQuatMat3(quat);\n',
      '    mat3 rot = kaloQuatMat3(quat);\n' + SPLAT_VERT_SPIN_SEGMENT,
    );
}

export function buildSplatFrag(): string {
  return SPLAT_FRAG_BODY;
}

export const SPLAT_VERT = buildSplatVert();
export const SPLAT_FRAG = buildSplatFrag();
