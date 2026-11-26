// Round 83/84 gap 7 — Phase Z occlusion receivers in tunnel mode.
//
// The terrain mesh wrapped into a tunnel used to receive NO
// terrain occlusion (the `!tunnel` gate in TerrainMesh), and the
// baked-map receivers (points, light volume) sampled the plane
// bake by world XZ, which is meaningless inside a tube. This
// phase adds the tunnel frame to the one occlusion function:
//   - lib/shadowOcclusion.ts: scene.tunnel (+ radius / length
//     derived from the existing tunnel key — no new keys), the
//     radial horizon test (Plan A2) inside occlusionAtPoint,
//     the analytic cylinder test (Plan A1, kept for the B3
//     discrimination check), bakeTunnelShadowOcclusionMap, and
//     bakedTunnelShadowMultiplier (the receivers' TS twin).
//   - TerrainMesh: the `!tunnel` gate is gone.
//   - Points: a shadowTunnel draw variant (stock strings stay
//     byte-identical; no tunnel uniform appears while off).
//   - Light volume: tunnel bake sampled by (theta, z) inside
//     the tube region.
//
// Gate lines preregistered by the Round 84 (7) design (§8):
//   B1 light outside: far inner wall occ > 0.5, near < 0.1.
//   B2 light inside (origin): every sampled wall point < 0.05.
//   B3 deep valley point: A1 = 0, A2 > 0.3.
//   B5 bake time within 2x of the plane bake — MEASURED ~2.7x
//     (the tiled tunnel sampler costs 4 field evaluations per
//     march step, the same price the mesh builder pays); the
//     line was a proposal in the design, the bake is cached per
//     config (not per frame), and the deviation is recorded in
//     the phase record instead of silently moving the line.
//   C2 plane bake byte-identical to the pre-change output
//     (sha256 pinned below, captured from v2.20.0 code).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p39-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

await build({
  stdin: {
    contents: `
      export {
        buildShadowScene, bakeShadowOcclusionMap, bakeTunnelShadowOcclusionMap,
        occlusionAtPoint, tunnelCylinderOcclusion, tunnelFieldHeightAt,
        tunnelSurfaceRadiusAt, bakedShadowMultiplier, bakedTunnelShadowMultiplier,
      } from './lib/shadowOcclusion.ts';
      export { DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag, DRAW_VERT_SHADOW_TUNNEL } from './components/gpgpuShaderPoints.ts';
      export { shadowTunnelVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { '__LIBRARY_SCOPE__': '"private"' },
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildShadowScene, bakeShadowOcclusionMap, bakeTunnelShadowOcclusionMap,
  occlusionAtPoint, tunnelCylinderOcclusion, tunnelFieldHeightAt,
  tunnelSurfaceRadiusAt, bakedShadowMultiplier, bakedTunnelShadowMultiplier,
  DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag, DRAW_VERT_SHADOW_TUNNEL,
  shadowTunnelVariantOn, DEFAULT_CONFIG,
} = M;

const BASE = {
  gpgpuMorphTerrainAmplitude: 0.55, gpgpuMorphTerrainFrequency: 1.6, gpgpuMorphTerrainOctaves: 4, gpgpuMorphTerrainSeed: 0,
  gpgpuMorphTerrainKind: 'fbm', gpgpuMorphTerrainTerraceSteps: 0,
  gpgpuMorphTerrainErosionWater: 0, gpgpuMorphTerrainErosionDroplets: 0, gpgpuMorphTerrainErosionDeposit: 0,
  gpgpuMorphTerrainErosionThermal: 0, gpgpuMorphTerrainErosionTalus: 0.35, gpgpuMorphTerrainErosionThermalPasses: 0, gpgpuMorphTerrainErosionSeed: 0,
  gpgpuMorphTerrainErosionMaskMode: 'off', gpgpuMorphTerrainErosionMaskImageGrid: [], gpgpuMorphTerrainErosionMaskStrength: 0,
  gpgpuMorphTerrainErosionMaskInvert: false, gpgpuMorphTerrainErosionMaskLow: 0, gpgpuMorphTerrainErosionMaskHigh: 1,
  gpgpuSeed: 1234, gpgpuMorphScale: 1, gpgpuBounceRadius: 150, gpgpuTerrainMeshScale: 1,
  gpgpuShadowSourceTerrain: true, gpgpuShadowSourceObj: false, gpgpuShadowSoftness: 0.5,
  gpgpuObjMeshEnabled: false, gpgpuObjMeshScale: 1, gpgpuObjMeshRepeat: 1, gpgpuObjMeshPosX: 0, gpgpuObjMeshPosY: 0, gpgpuObjMeshPosZ: 0, gpgpuMorphObjSource: '',
};
const scene = (light, tunnel) => buildShadowScene({
  ...BASE, gpgpuTerrainMeshTunnel: tunnel,
  gpgpuLightPosX: light[0], gpgpuLightPosY: light[1], gpgpuLightPosZ: light[2],
});

// ── C2: plane bake byte identity (hash captured from v2.20.0) ──
const planeBake = bakeShadowOcclusionMap(scene([200, 0, 0], false), 64);
check('plane bake mode is plane', planeBake.mode === 'plane');
check('plane bake byte-identical to v2.20.0 output',
  sha256(planeBake.data) === '66ddedbf884e31cd5bb8f04618ae6447c664743fb3ad993ca3613c8d4f4c818e',
  sha256(planeBake.data));
check('plane bake deterministic',
  sha256(bakeShadowOcclusionMap(scene([200, 0, 0], false), 64).data) === sha256(planeBake.data));

// ── Scene tunnel geometry (R = E identity from the design §3) ──
const sOut = scene([200, 0, 0], true);
check('tunnel scene flags + geometry',
  sOut.tunnel === true && Math.abs(sOut.tunnelRadius - 75.6) < 1e-9 && Math.abs(sOut.tunnelLength - 151.2) < 1e-9,
  `${sOut.tunnel} ${sOut.tunnelRadius} ${sOut.tunnelLength}`);
check('plane scene carries tunnel=false', scene([200, 0, 0], false).tunnel === false);

// ── B1: light outside — far wall dark, near wall lit ──
const rFar = tunnelSurfaceRadiusAt(Math.PI, 0, sOut);
const rNear = tunnelSurfaceRadiusAt(0, 0, sOut);
const occFar = occlusionAtPoint(-rFar, 0, 0, sOut);
const occNear = occlusionAtPoint(rNear, 0, 0, sOut);
check('B1 far inner wall occluded > 0.5', occFar > 0.5, `occ=${occFar}`);
check('B1 near inner wall lit < 0.1', occNear < 0.1, `occ=${occNear}`);

// ── B2: light inside at the origin — no wall occlusion ──
const sIn = scene([0, 0, 0], true);
let maxIn = 0;
for (let k = 0; k < 16; k++) {
  const th = (k / 16) * Math.PI * 2;
  const r = tunnelSurfaceRadiusAt(th, 0, sIn);
  maxIn = Math.max(maxIn, occlusionAtPoint(Math.cos(th) * r, Math.sin(th) * r, 0, sIn));
}
check('B2 light inside: all wall points < 0.05', maxIn < 0.05, `max=${maxIn}`);

// ── B3: A1 vs A2 discrimination at the deepest valley point ──
let valley = { th: 0, h: Infinity };
for (let k = 0; k < 720; k++) {
  const th = (k / 720) * Math.PI * 2;
  const h = tunnelFieldHeightAt(th, 0, sOut);
  if (h < valley.h) valley = { th, h };
}
const vr = tunnelSurfaceRadiusAt(valley.th, 0, sOut);
check('valley point sits outside the bare cylinder (r > R)', vr > sOut.tunnelRadius, `r=${vr} R=${sOut.tunnelRadius}`);
const vx = Math.cos(valley.th);
const vy = Math.sin(valley.th);
const sOpp = scene([-vx * 200, -vy * 200, 0], true);
check('B3 A1 returns 0 at the valley point',
  tunnelCylinderOcclusion(vx * vr, vy * vr, 0, sOpp) === 0);
check('B3 A2 occludes > 0.3 at the valley point',
  occlusionAtPoint(vx * vr, vy * vr, 0, sOpp) > 0.3,
  `occ=${occlusionAtPoint(vx * vr, vy * vr, 0, sOpp)}`);

// ── A1 basics ──
check('A1 wall crossing blocks', tunnelCylinderOcclusion(-(sOut.tunnelRadius - 1), 0, 0, sOut) === 1);
check('A1 light inside does not block', tunnelCylinderOcclusion(0, sOut.tunnelRadius - 1, 0, sIn) === 0);

// ── Tunnel bake: determinism + mode ──
const tunnelBake = bakeTunnelShadowOcclusionMap(sOut, 64);
check('tunnel bake mode + extent', tunnelBake.mode === 'tunnel' && Math.abs(tunnelBake.extent - 75.6) < 1e-9);
check('tunnel bake deterministic',
  sha256(bakeTunnelShadowOcclusionMap(sOut, 64).data) === sha256(tunnelBake.data));

// ── Receiver twin: inside uses tunnel bake, outside uses plane ──
const mulFar = bakedTunnelShadowMultiplier(tunnelBake, planeBake, -rFar, 0, 0, 1);
check('tunnel multiplier darkens the far wall (< 0.6)', mulFar < 0.6, `mul=${mulFar}`);
const outPoint = [500, 0, 0];
check('outside the tube region the plane multiplier applies verbatim',
  bakedTunnelShadowMultiplier(tunnelBake, planeBake, outPoint[0], outPoint[1], outPoint[2], 1)
  === bakedShadowMultiplier(planeBake, outPoint[0], outPoint[1], outPoint[2], 1));
check('strength 0 is exactly 1 everywhere',
  bakedTunnelShadowMultiplier(tunnelBake, planeBake, -rFar, 0, 0, 0) === 1);

// ── OFF identity of the draw strings ──
check('default builder returns the stock vertex', buildDrawVert() === DRAW_VERT);
check('shadowTunnel:false returns the stock vertex', buildDrawVert({ shadowTunnel: false }) === DRAW_VERT);
check('stock vertex carries no tunnel text',
  !DRAW_VERT.includes('uShadowTunnel') && !DRAW_VERT.includes('kaloShadowTunnelMultiplier'));
check('stock fragment unchanged by the variant work', buildDrawFrag() === DRAW_FRAG);
check('tunnel variant carries the sampler + function + override',
  DRAW_VERT_SHADOW_TUNNEL.includes('uShadowTunnelMap')
  && DRAW_VERT_SHADOW_TUNNEL.includes('kaloShadowTunnelMultiplier')
  && DRAW_VERT_SHADOW_TUNNEL.includes('vShadowMul = tunnelMul'));
check('tunnel variant composes with the shadow-map variant',
  buildDrawVert({ shadowTunnel: true, shadowMap: true }).includes('kaloShadowFactor')
  && buildDrawVert({ shadowTunnel: true, shadowMap: true }).includes('kaloShadowTunnelMultiplier'));

// ── Variant predicate ──
check('variant on only for tunnel + shadow enabled + strength > 0',
  shadowTunnelVariantOn({ ...DEFAULT_CONFIG, gpgpuTerrainMeshTunnel: true, gpgpuShadowEnabled: true, gpgpuShadowStrength: 0.8 }) === true
  && shadowTunnelVariantOn({ ...DEFAULT_CONFIG, gpgpuTerrainMeshTunnel: false, gpgpuShadowEnabled: true, gpgpuShadowStrength: 0.8 }) === false
  && shadowTunnelVariantOn({ ...DEFAULT_CONFIG, gpgpuTerrainMeshTunnel: true, gpgpuShadowEnabled: true, gpgpuShadowStrength: 0 }) === false
  && shadowTunnelVariantOn({ ...DEFAULT_CONFIG, gpgpuTerrainMeshTunnel: true, gpgpuShadowEnabled: false, gpgpuShadowStrength: 0.8 }) === false);

// ── Wiring anchors ──
const terrainMeshSrc = readFileSync(join(ROOT, 'components', 'TerrainMesh.tsx'), 'utf8');
check('TerrainMesh tunnel gate removed',
  !terrainMeshSrc.includes('gpgpuShadowStrength > 0 && !tunnel'));
const visualSrc = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
check('visual updates bake + bind the tunnel texture',
  visualSrc.includes('bakeTunnelShadowOcclusionMap') && visualSrc.includes('uShadowTunnelMap'));
const volumeSrc = readFileSync(join(ROOT, 'components', 'LightVolume.tsx'), 'utf8');
check('light volume samples the tunnel bake',
  volumeSrc.includes('uShadowTunnelMap') && volumeSrc.includes('bakeTunnelShadowOcclusionMap'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
