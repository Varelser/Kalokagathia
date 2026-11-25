// ── Grains pile solver (Stage C): lambda + delta passes ──
// The density-constraint recipe ported from the H8 prototype
// (grains-h8/h8_cpu_h16_iterfric.py, the run-9/10 solver whose
// shape the 16,384-particle Colab production run confirmed):
// per iteration, a lambda pass prices every particle's density
// constraint from the CURRENT iteration positions, then a delta
// pass applies the Jacobi density correction plus the
// tangential friction correction INSIDE the same iteration (the
// prototype's main finding: friction outside the iterations
// left the pile with no holding mechanism).
//
// The passes run only while the pile plan is active (Grains on
// AND gpgpuGrainsPileEnabled on); while off, no material is
// built from these strings and no pass runs — the legacy frame
// is verbatim. TS twins: grainsComputeDensityLambdas /
// grainsDensityCorrection in lib/gpgpuGrains.ts.
//
// Candidate source: the frame's cell sort when the passes
// resolved it (the grid is built with cell size = support
// radius h while the pile plan is active, so the 27-cell search
// is complete for the h window), otherwise the complete scan
// over the whole position texture (the stage-1 fallback).
// The sort is built from frame-start positions while the
// iterations move particles by at most half a diameter per
// iteration, so a neighbour can only be missed if it crossed a
// full cell within one frame's iterations — the exact distance
// test still rejects every false candidate the clamped / stale
// cells add.
//
// Adaptations from the prototype (documented in the design):
//   - vel_now of a pair is priced from the velocity texture
//     plus each member's displacement since the pile stage
//     began (the snapshot in uBasePosTex), because the product
//     velocity is an independent texture, not a position
//     difference; the neighbour member uses its iteration-start
//     position (Jacobi), the prototype rebuilds pairs after
//     the density delta — the difference is inside one
//     iteration's correction, bounded by the aggregate clamp.
//   - the density and friction deltas are summed, then the sum
//     is clamped to half a diameter (the prototype clamps each
//     to half a diameter separately; the summed clamp is the
//     stricter, safer bound).

const PILE_PREAMBLE = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform float uTexSizeF;
  uniform float uGrainsSize;
  uniform float uGrainsSupport;
  uniform sampler2D uGrainsSortTex;
  uniform bool  uGrainsCellSort;
  uniform float uGrainsCellOrigin;
  uniform float uGrainsCellSize;
  uniform vec3  uGrainsCellDims;
  varying vec2 vUv;
  float grainsCellKeyAt(float idx) {
    vec2 uv = (vec2(mod(idx, uTexSizeF), floor(idx / uTexSizeF)) + 0.5) / uTexSizeF;
    return texture2D(uGrainsSortTex, uv).z;
  }
  float grainsCellLowerBound(float K) {
    float total = uTexSizeF * uTexSizeF;
    float lo = 0.0;
    float hi = total;
    for (int s = 0; s < 24; s++) {
      if (lo >= hi) break;
      float mid = floor((lo + hi) * 0.5);
      if (grainsCellKeyAt(mid) > K) lo = mid + 1.0;
      else hi = mid;
    }
    return lo;
  }
  vec3 grainsCellOf(vec3 p) {
    return clamp(floor((p - uGrainsCellOrigin) / uGrainsCellSize), vec3(0.0), uGrainsCellDims - vec3(1.0));
  }
  float grainsCellKeyOf(vec3 cell) {
    return (cell.x * uGrainsCellDims.y + cell.y) * uGrainsCellDims.z + cell.z;
  }
  float grainsPoly6(float d, float h) {
    if (d >= h) return 0.0;
    float coef = 315.0 / (64.0 * 3.14159265 * pow(h, 9.0));
    float t = h * h - d * d;
    return coef * t * t * t;
  }
  // Spiky gradient factor: grad W_ij = spikyGradFactor * r_ij.
  float grainsSpikyFactor(float d, float h) {
    float coef = -45.0 / (3.14159265 * pow(h, 6.0));
    float t = h - d;
    return coef * t * t / max(d, 0.0001);
  }
`;

const PILE_CELL_OPEN = /* glsl */ `
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
            if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
`;

const PILE_SCAN_OPEN = /* glsl */ `
      } else {
        float total = uTexSizeF * uTexSizeF;
        float strideP = total > 65536.0 ? ceil(total / 65536.0) : 1.0;
        for (float fi = 0.0; fi < 65536.0; fi += 1.0) {
          float si = fi * strideP;
          if (si >= total) break;
          vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
          if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
`;

// Closes the candidate loop and the cell loop (the scan branch
// then closes the if with its `} else {`, and the final close
// shuts the scan loop and the else block) — the same brace
// accounting as the velocity shader's CELL_OPEN / ELSE / CLOSE.
const PILE_LOOP_CLOSE = /* glsl */ `
          }
        }
`;

// Lambda pass: writes vec4(lambda, rho, 0, 1) per texel from the
// current iteration positions in uPosTex.
export const GRAINS_PILE_LAMBDA_FRAG = PILE_PREAMBLE + /* glsl */ `
  uniform float uGrainsRho0;
  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    float h = max(uGrainsSupport, 0.001);
    float h2 = h * h;
    float rho0 = max(uGrainsRho0, 0.000000001);
    float rho = grainsPoly6(0.0, h);
    vec3 gradSum = vec3(0.0);
    float gradSq = 0.0;
    float count = 0.0;
    {
` + PILE_CELL_OPEN + /* glsl */ `
            vec3 oPos = texture2D(uPosTex, sUv).xyz;
            vec3 r = pos - oPos;
            float d2 = dot(r, r);
            if (d2 < h2 && d2 > 0.000000000001) {
              float d = sqrt(d2);
              rho += grainsPoly6(d, h);
              vec3 g = grainsSpikyFactor(d, h) * r;
              gradSum += g;
              gradSq += dot(g, g);
              count += 1.0;
            }
` + PILE_LOOP_CLOSE + PILE_SCAN_OPEN + /* glsl */ `
          vec3 oPos = texture2D(uPosTex, sUv).xyz;
          vec3 r = pos - oPos;
          float d2 = dot(r, r);
          if (d2 < h2 && d2 > 0.000000000001) {
            float d = sqrt(d2);
            rho += grainsPoly6(d, h);
            vec3 g = grainsSpikyFactor(d, h) * r;
            gradSum += g;
            gradSq += dot(g, g);
            count += 1.0;
          }
` + PILE_LOOP_CLOSE + /* glsl */ `
    }
    float lambda = 0.0;
    if (count > 0.0) {
      float denom = (gradSq + dot(gradSum, gradSum)) / (rho0 * rho0) + 0.01;
      lambda = -(rho / rho0 - 1.0) / denom;
    }
    gl_FragColor = vec4(lambda, rho, 0.0, 1.0);
  }
`;

// Delta pass: reads the current iteration positions, the lambda
// texture, the pile-start snapshot (uBasePosTex) and the frame
// velocities (uVelTex); writes the corrected positions.
export const GRAINS_PILE_DELTA_FRAG = PILE_PREAMBLE + /* glsl */ `
  uniform sampler2D uLambdaTex;
  uniform sampler2D uBasePosTex;
  uniform sampler2D uVelTex;
  uniform float uGrainsRho0;
  uniform float uGrainsStiffness;
  uniform float uGrainsFriction;
  uniform float uBounceRadius;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    vec3 base = texture2D(uBasePosTex, vUv).xyz;
    vec3 vel = texture2D(uVelTex, vUv).xyz;
    float myLambda = texture2D(uLambdaTex, vUv).x;
    float gd = max(uGrainsSize, 0.001);
    float gd2 = gd * gd;
    float h = max(uGrainsSupport, 0.001);
    float h2 = h * h;
    float rho0 = max(uGrainsRho0, 0.000000001);
    vec3 delta = vec3(0.0);
    {
` + PILE_CELL_OPEN + /* glsl */ `
            vec3 oPos = texture2D(uPosTex, sUv).xyz;
            vec3 r = pos - oPos;
            float d2 = dot(r, r);
            if (d2 < h2 && d2 > 0.000000000001) {
              float d = sqrt(d2);
              float oLambda = texture2D(uLambdaTex, sUv).x;
              delta += ((myLambda + oLambda) / rho0) * grainsSpikyFactor(d, h) * r * uGrainsStiffness;
              if (d2 < gd2) {
                vec3 n = r / d;
                vec3 oBase = texture2D(uBasePosTex, sUv).xyz;
                vec3 oVel = texture2D(uVelTex, sUv).xyz;
                vec3 velNowI = vel + (pos - base);
                vec3 velNowJ = oVel + (oPos - oBase);
                vec3 rv = velNowI - velNowJ;
                vec3 vt = rv - n * dot(rv, n);
                float vtLen = length(vt);
                if (vtLen > 0.000000001) {
                  float step = min(vtLen, uGrainsFriction * (gd - d));
                  delta -= (vt / vtLen) * step * 0.5;
                }
              }
            }
` + PILE_LOOP_CLOSE + PILE_SCAN_OPEN + /* glsl */ `
          vec3 oPos = texture2D(uPosTex, sUv).xyz;
          vec3 r = pos - oPos;
          float d2 = dot(r, r);
          if (d2 < h2 && d2 > 0.000000000001) {
            float d = sqrt(d2);
            float oLambda = texture2D(uLambdaTex, sUv).x;
            delta += ((myLambda + oLambda) / rho0) * grainsSpikyFactor(d, h) * r * uGrainsStiffness;
            if (d2 < gd2) {
              vec3 n = r / d;
              vec3 oBase = texture2D(uBasePosTex, sUv).xyz;
              vec3 oVel = texture2D(uVelTex, sUv).xyz;
              vec3 velNowI = vel + (pos - base);
              vec3 velNowJ = oVel + (oPos - oBase);
              vec3 rv = velNowI - velNowJ;
              vec3 vt = rv - n * dot(rv, n);
              float vtLen = length(vt);
              if (vtLen > 0.000000001) {
                float step = min(vtLen, uGrainsFriction * (gd - d));
                delta -= (vt / vtLen) * step * 0.5;
              }
            }
          }
` + PILE_LOOP_CLOSE + /* glsl */ `
    }
    float dLen = length(delta);
    float cap = gd * 0.5;
    if (dLen > cap) delta *= cap / dLen;
    vec3 newPos = pos + delta;
    if (uFloorEnabled) newPos.y = max(newPos.y, uFloorY + gd * 0.5);
    float pLen = length(newPos);
    float maxR = uBounceRadius * 1.05;
    if (pLen > maxR && pLen > 0.0) newPos *= maxR / pLen;
    gl_FragColor = vec4(newPos, texture2D(uPosTex, vUv).a);
  }
`;
