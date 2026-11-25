// FLIP 3D WebGL freeze fix — S3 tests (design draft
// FLIP_WEBGL_ATLAS_DESIGN_DRAFT §5 S3, §3.4, §4.3).
//
// Pins:
//   - applyFlip3dCoupleUniforms, when active, binds the merged
//     atlas into uFlipBaseTex and fills the MERGED layout
//     values (atlas size / tiles / base tile offset), and no
//     longer assigns uFlip3dVelTex / uFlip3dBaseTex;
//   - when NOT active it never touches uFlipBaseTex (the 2D
//     pipeline owns that slot);
//   - the 案D downgrade rule (lib/flip3dAtlasDowngrade.ts):
//     fires exactly for flip3d-standing + Grains full scan +
//     a reported unit count <= 16; an unknown count (null)
//     never fires it;
//   - the resolved assembly path (the rule applied the way
//     velocityVariantOptions applies it, then
//     buildVelocityFragment) yields the S0 expectation: 16
//     sampler declarations for flip3d+grains on a <=16-unit
//     GPU, 17 on a >16-unit GPU.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.flip-s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { applyFlip3dCoupleUniforms } from './components/gpgpuFlip3dPasses.ts';
      export { flip3dGrainsDowngradeApplies, TEXTURE_UNIT_FLOOR } from './lib/flip3dAtlasDowngrade.ts';
      export { pyroGridMergedLayout } from './lib/pyroGrid.ts';
      export { grainsNeighborhoodMode } from './lib/gpgpuGrains.ts';
      export { flip3dActive } from './lib/flip3d.ts';
      export { buildVelocityFragment } from './components/gpgpuShaders.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  applyFlip3dCoupleUniforms, flip3dGrainsDowngradeApplies, TEXTURE_UNIT_FLOOR,
  pyroGridMergedLayout, grainsNeighborhoodMode, flip3dActive, buildVelocityFragment,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const CFG_3D = {
  gpgpuFlipMode: '3d', gpgpuFlipEnabled: true, gpgpuFluidEnabled: true,
  gpgpuFlipBlend: 0.95, gpgpuFlipTransfer: 1.0,
  gpgpuBounceRadius: 150, gpgpuFluidScale: 1.5,
  gpgpuGrainsNeighborhood: 1,
};

// --- applyFlip3dCoupleUniforms: active --------------------------------
{
  const merged = pyroGridMergedLayout(48);
  const atlasTexture = { sentinel: 'merged-atlas' };
  const targets = {
    framesStepped: 3,
    baseVelTexture: { sentinel: 'base' },
    atlasVelBase: { texture: atlasTexture },
    mergedAtlasWidth: merged.mergedWidth,
    mergedAtlasHeight: merged.mergedHeight,
    mergedTilesX: merged.cols,
    mergedTilesY: merged.mergedRows,
    baseTileOffset: merged.baseOffset,
    resolution: 48,
    floatLinear: true,
    velPingIsA: true,
    velA: { texture: { sentinel: 'velA' } },
    velB: { texture: { sentinel: 'velB' } },
  };
  const uniforms = {
    uFlip3dCouple: { value: false },
    uFlipBaseTex: { value: null },
    uFlip3dVelTex: { value: 'untouched-vel' },
    uFlip3dBaseTex: { value: 'untouched-base' },
    uFlip3dBlend: { value: 0 },
    uFlip3dTransfer: { value: 0 },
    uFlip3dVelScale: { value: 0 },
    uFlip3dBounds: { value: new THREE.Vector4() },
    uFlip3dGridN: { value: 0 },
    uFlip3dAtlasSize: { value: new THREE.Vector2(1, 1) },
    uFlip3dAtlasTiles: { value: new THREE.Vector2(1, 1) },
    uFlip3dBaseTileOffset: { value: -1 },
    uFlip3dManualTrilinear: { value: true },
  };
  applyFlip3dCoupleUniforms({ config: CFG_3D, velSimMat: { uniforms }, targets, useWebGPU: false });
  check('active: couple flag raised', uniforms.uFlip3dCouple.value === true);
  check('active: uFlipBaseTex binds the merged atlas texture', uniforms.uFlipBaseTex.value === atlasTexture);
  check('active: atlas size is the MERGED size',
    uniforms.uFlip3dAtlasSize.value.x === merged.mergedWidth && uniforms.uFlip3dAtlasSize.value.y === merged.mergedHeight,
    `${uniforms.uFlip3dAtlasSize.value.x}x${uniforms.uFlip3dAtlasSize.value.y} vs ${merged.mergedWidth}x${merged.mergedHeight}`);
  check('active: atlas tiles are the MERGED tiles',
    uniforms.uFlip3dAtlasTiles.value.x === merged.cols && uniforms.uFlip3dAtlasTiles.value.y === merged.mergedRows,
    `${uniforms.uFlip3dAtlasTiles.value.x}x${uniforms.uFlip3dAtlasTiles.value.y} vs ${merged.cols}x${merged.mergedRows}`);
  check('active: base tile offset is the layout capacity offset',
    uniforms.uFlip3dBaseTileOffset.value === merged.baseOffset,
    `${uniforms.uFlip3dBaseTileOffset.value} vs ${merged.baseOffset}`);
  check('active: legacy flip3d texture uniforms are NOT assigned',
    uniforms.uFlip3dVelTex.value === 'untouched-vel' && uniforms.uFlip3dBaseTex.value === 'untouched-base');
  check('active: grid N / manual trilinear follow the targets',
    uniforms.uFlip3dGridN.value === 48 && uniforms.uFlip3dManualTrilinear.value === false);
}

// --- applyFlip3dCoupleUniforms: NOT active -----------------------------
for (const [name, args] of [
  ['targets null', { config: CFG_3D, targets: null, useWebGPU: false }],
  ['not stepped yet', {
    config: CFG_3D, useWebGPU: false,
    targets: { framesStepped: 0, baseVelTexture: { sentinel: 'base' }, atlasVelBase: { texture: {} } },
  }],
  ['webgpu path', {
    config: CFG_3D, useWebGPU: true,
    targets: { framesStepped: 3, baseVelTexture: { sentinel: 'base' }, atlasVelBase: { texture: {} } },
  }],
  ['2d config', {
    config: { ...CFG_3D, gpgpuFlipMode: '2d' }, useWebGPU: false,
    targets: { framesStepped: 3, baseVelTexture: { sentinel: 'base' }, atlasVelBase: { texture: {} } },
  }],
]) {
  const uniforms = {
    uFlip3dCouple: { value: true },
    uFlipBaseTex: { value: '2d-owned' },
  };
  applyFlip3dCoupleUniforms({ velSimMat: { uniforms }, ...args });
  check(`inactive (${name}): couple flag cleared`, uniforms.uFlip3dCouple.value === false);
  check(`inactive (${name}): uFlipBaseTex is NOT touched`, uniforms.uFlipBaseTex.value === '2d-owned');
}

// --- 案D downgrade rule --------------------------------------------------
check('unit floor constant is 16', TEXTURE_UNIT_FLOOR === 16);
check('downgrade: flip3d + full scan + 16 units fires',
  flip3dGrainsDowngradeApplies(CFG_3D, 16) === true);
check('downgrade: flip3d + full scan + 8 units fires',
  flip3dGrainsDowngradeApplies(CFG_3D, 8) === true);
check('downgrade: flip3d + full scan + 32 units does not fire',
  flip3dGrainsDowngradeApplies(CFG_3D, 32) === false);
check('downgrade: unknown unit count (null) never fires',
  flip3dGrainsDowngradeApplies(CFG_3D, null) === false);
check('downgrade: subsample neighbourhood (mode 0) does not fire',
  flip3dGrainsDowngradeApplies({ ...CFG_3D, gpgpuGrainsNeighborhood: 0 }, 16) === false);
check('downgrade: 2d mode does not fire',
  flip3dGrainsDowngradeApplies({ ...CFG_3D, gpgpuFlipMode: '2d' }, 16) === false);
check('downgrade: flip disabled does not fire',
  flip3dGrainsDowngradeApplies({ ...CFG_3D, gpgpuFlipEnabled: false }, 16) === false);
check('downgrade: fluid disabled does not fire',
  flip3dGrainsDowngradeApplies({ ...CFG_3D, gpgpuFluidEnabled: false }, 16) === false);

// --- resolved assembly path sampler counts ------------------------------
const countSamplers = (frag) => (frag.match(/uniform\s+sampler(?:2D|3D)\s+\w+\s*;/g) || []).length;
const resolvedOpts = (config, units) => ({
  grainsFullScan: grainsNeighborhoodMode(config) === 1 && !flip3dGrainsDowngradeApplies(config, units),
  flip3dCouple: flip3dActive(config),
});
check('resolved path: flip3d+grains on 16 units assembles to 16 samplers',
  countSamplers(buildVelocityFragment('', undefined, resolvedOpts(CFG_3D, 16))) === 16,
  `actual=${countSamplers(buildVelocityFragment('', undefined, resolvedOpts(CFG_3D, 16)))}`);
check('resolved path: flip3d+grains on 32 units keeps the full scan (17 samplers)',
  countSamplers(buildVelocityFragment('', undefined, resolvedOpts(CFG_3D, 32))) === 17,
  `actual=${countSamplers(buildVelocityFragment('', undefined, resolvedOpts(CFG_3D, 32)))}`);
check('resolved path: flip3d alone assembles to 16 samplers',
  countSamplers(buildVelocityFragment('', undefined, resolvedOpts({ ...CFG_3D, gpgpuGrainsNeighborhood: 0 }, 16))) === 16);

// --- wiring (structural, S1 style) ---------------------------------------
{
  const assets = readFileSync(join(ROOT, 'components/useGpgpuSimulationAssets.ts'), 'utf8');
  check('velocityVariantOptions resolves grainsFullScan through the downgrade rule',
    assets.includes('flip3dGrainsDowngradeApplies(config, getMaxTextureImageUnits())'));
  check('assets mirror the downgrade into the notice store',
    assets.includes('setFlip3dGrainsDowngrade(flip3dGrainsDowngradeApplies(config, getMaxTextureImageUnits()))'));
  const layout = readFileSync(join(ROOT, 'components/AppRootLayout.tsx'), 'utf8');
  check('root layout renders the downgrade notice from the store',
    layout.includes('useFlip3dGrainsDowngrade') && layout.includes('FLIP3D_GRAINS_DOWNGRADE_NOTICE'));
  const passes = readFileSync(join(ROOT, 'components/gpgpuFlip3dPasses.ts'), 'utf8');
  check('passes no longer assign uFlip3dVelTex / uFlip3dBaseTex',
    !passes.includes('u.uFlip3dVelTex.value') && !passes.includes('u.uFlip3dBaseTex.value'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
