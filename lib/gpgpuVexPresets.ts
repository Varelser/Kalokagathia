// VEX deform presets (Kinetix integration B3).
//
// Kinetix's vexDeform applies twist / vortexFold / ripple /
// kaleidoFold as a per-frame position deform in its CPU engine. The
// GPGPU equivalent here is a set of named Custom Force snippets: each
// computes Kinetix's deformed position for the particle's current
// position and steers the velocity toward it, so the cloud visibly
// settles into the deformed shape while every other force keeps
// working. The formulas are re-implemented from Kinetix's
// ParticleEngine VEX block with its world scale (~6 units) converted
// to Kalokagathia's (~150 units, a factor of 15 in lengths and 1/50
// in the per-unit twist rate). Snippets obey the Custom Force
// contract (pos / vel / uTime / uDelta, add to vel) and pass the same
// validation + compile check as hand-written code.

export interface VexPreset {
  id: 'twist' | 'vortexFold' | 'ripple' | 'kaleidoFold';
  label: string;
  description: string;
  code: string;
}

export const VEX_PRESETS: VexPreset[] = [
  {
    id: 'twist',
    label: 'Twist',
    description: '高さに応じて XZ をねじる（Kinetix twist: ang = y * amt * 0.48 を本アプリのスケールに換算）',
    code: `// VEX Twist — rotate XZ by an angle growing with height.
float vexAng = pos.y * 0.0096;
float vexC = cos(vexAng);
float vexS = sin(vexAng);
vec3 vexTarget = vec3(pos.x * vexC - pos.z * vexS, pos.y, pos.x * vexS + pos.z * vexC);
vel += (vexTarget - pos) * (18.0 * uDelta);`,
  },
  {
    id: 'vortexFold',
    label: 'Vortex Fold',
    description: '中心に近いほど強く角度を折る渦巻きフォールド（Kinetix vortexFold）',
    code: `// VEX Vortex Fold — fold the XZ angle, stronger near the axis.
float vexRad = length(pos.xz) + 0.001;
float vexAng = 1.4 / (1.0 + vexRad * 0.009);
float vexBase = atan(pos.z, pos.x) + vexAng;
vec3 vexTarget = vec3(cos(vexBase) * vexRad, pos.y, sin(vexBase) * vexRad);
vel += (vexTarget - pos) * (18.0 * uDelta);`,
  },
  {
    id: 'ripple',
    label: 'Ripple',
    description: '中心からの距離で位相がずれる波紋状の上下変位（Kinetix ripple）',
    code: `// VEX Ripple — radial travelling wave displacing Y.
float vexRad = length(pos.xz);
vec3 vexTarget = pos + vec3(0.0, sin(vexRad * 0.147 - uTime * 4.0) * 8.25, 0.0);
vel += (vexTarget - pos) * (18.0 * uDelta);`,
  },
  {
    id: 'kaleidoFold',
    label: 'Kaleido Fold',
    description: 'X/Z を正側へ折り返す万華鏡フォールド（Kinetix kaleidoFold、blend 0.5）',
    code: `// VEX Kaleido Fold — fold X/Z toward the positive octant (blend 0.5).
vec3 vexTarget = mix(pos, vec3(abs(pos.x), pos.y, abs(pos.z)), 0.5);
vel += (vexTarget - pos) * (18.0 * uDelta);`,
  },
];
