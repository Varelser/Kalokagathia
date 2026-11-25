// FLIP 3D WebGL freeze fix — S1 structural tests (design
// draft FLIP_WEBGL_ATLAS_DESIGN_DRAFT §5 S1, §3.1, §3.2).
//
// S1 adds the publishing side only: the merged-atlas layout
// helper, the atlasVelBase target (create / zero-init /
// dispose), the flip3dAtlasCopyMat material, and the two merge
// draws at the end of runFlip3dPasses. At S1 time nothing read
// the merged atlas yet; since S3 its one reader is the couple
// binding in applyFlip3dCoupleUniforms, and the reference
// check below allows exactly that line alongside the merge
// draws. These tests pin:
//   - the merged layout arithmetic for all 4 resolutions
//     (design §3.1 table, incl. the 96 case where the base
//     offset is the 100-tile capacity, not 96),
//   - the merge draws exist ONLY after the subtract draw,
//   - target creation and disposal are paired.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.flip-s1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `export { pyroGridMergedLayout, PYRO_GRID_LAYOUTS } from './lib/pyroGrid.ts';`,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const { pyroGridMergedLayout } = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// --- merged layout arithmetic (design §3.1) ----------------------------
const TABLE = {
  32: { cols: 8, rows: 4, mergedRows: 8, baseOffset: 32, mergedWidth: 256, mergedHeight: 256 },
  48: { cols: 8, rows: 6, mergedRows: 12, baseOffset: 48, mergedWidth: 384, mergedHeight: 576 },
  64: { cols: 8, rows: 8, mergedRows: 16, baseOffset: 64, mergedWidth: 512, mergedHeight: 1024 },
  96: { cols: 10, rows: 10, mergedRows: 20, baseOffset: 100, mergedWidth: 960, mergedHeight: 1920 },
};
for (const [nStr, exp] of Object.entries(TABLE)) {
  const n = Number(nStr);
  const m = pyroGridMergedLayout(n);
  check(`merged layout ${n}: exists`, m !== null);
  if (!m) continue;
  check(`merged layout ${n}: cols/rows x2/baseOffset/dims`,
    m.cols === exp.cols && m.rows === exp.rows && m.mergedRows === exp.mergedRows
    && m.baseOffset === exp.baseOffset && m.mergedWidth === exp.mergedWidth && m.mergedHeight === exp.mergedHeight,
    JSON.stringify(m));
  check(`merged layout ${n}: baseOffset is cols*rows capacity (not N)`, m.baseOffset === m.cols * m.rows);
  check(`merged layout ${n}: merged height is exactly 2x single`, m.mergedHeight === m.height * 2 && m.mergedWidth === m.width);
}
check('merged layout: unknown resolution resolves to null', pyroGridMergedLayout(50) === null);

// --- merge draws: only after subtract ----------------------------------
{
  const src = readFileSync(join(ROOT, 'components/gpgpuFlip3dPasses.ts'), 'utf8');
  const idxSubtract = src.indexOf('materials.flip3dSubtractMat');
  const idxMerge = src.indexOf('materials.flip3dAtlasCopyMat');
  check('merge block exists and sits after the subtract material is used',
    idxSubtract >= 0 && idxMerge > idxSubtract, `subtract=${idxSubtract} merge=${idxMerge}`);
  check('atlasVelBase is drawn into exactly twice (Vel half + Base half)',
    src.split('drawInto(mat, targets.atlasVelBase)').length - 1 === 2,
    `count=${src.split('drawInto(mat, targets.atlasVelBase)').length - 1}`);
  check('merge sets uHalf 0 (Vel) and uHalf 1 (Base)',
    src.includes('mat.uniforms.uHalf.value = 0') && src.includes('mat.uniforms.uHalf.value = 1'));
  check('merge sources are the projected texture and baseVelTexture',
    src.includes('mat.uniforms.uSrcTex.value = projected.texture')
    && src.includes('mat.uniforms.uSrcTex.value = targets.baseVelTexture'));
  // atlasVelBase may be referenced only by: the type, the
  // merge draws, disposeFlip3dTargets, and — since S3 — the
  // couple binding in applyFlip3dCoupleUniforms, which binds
  // the merged atlas into the velocity material's
  // uFlipBaseTex slot. That binding is the atlas's only
  // reader; any further reference means a second reader (or
  // writer) appeared and this pin must be revisited.
  const refs = src.split('\n').filter((l) => l.includes('atlasVelBase'));
  const allowed = refs.every((l) =>
    l.includes('atlasVelBase: THREE.WebGLRenderTarget')
    || l.includes('drawInto(mat, targets.atlasVelBase)')
    || l.includes('targets.atlasVelBase.dispose()')
    || l.includes('u.uFlipBaseTex.value = t.atlasVelBase.texture')
    || l.trim().startsWith('//'));
  check('atlasVelBase references are limited to the type, merge draws, dispose, and the couple binding', allowed, refs.join(' | '));
  check('Flip3dMaterials declares flip3dAtlasCopyMat',
    src.includes('flip3dAtlasCopyMat: THREE.ShaderMaterial'));
  check('disposeFlip3dTargets disposes atlasVelBase',
    src.includes('targets.atlasVelBase.dispose();'));
}

// --- create / zero-init pairing ----------------------------------------
{
  const src = readFileSync(join(ROOT, 'components/useGpgpuRuntime.ts'), 'utf8');
  const start = src.indexOf('function createFlip3dTargets');
  const end = src.indexOf('export type AuxPoolTargets');
  const fn = src.slice(start, end);
  check('createFlip3dTargets located', start >= 0 && end > start);
  check('createFlip3dTargets allocates atlasVelBase at merged dims via makePyroFieldRT',
    fn.includes('atlasVelBase: makePyroFieldRT(merged.mergedWidth, merged.mergedHeight, floatLinear)'));
  check('createFlip3dTargets records the merged layout values',
    fn.includes('mergedTilesX: merged.cols') && fn.includes('mergedTilesY: merged.mergedRows')
    && fn.includes('baseTileOffset: merged.baseOffset'));
  check('zero-init loop includes targets.atlasVelBase',
    fn.includes('targets.scratch, targets.curv, targets.atlasVelBase]'));
}

// --- copy material wiring ----------------------------------------------
{
  const assets = readFileSync(join(ROOT, 'components/useGpgpuSimulationAssets.ts'), 'utf8');
  check('assets create flip3dAtlasCopyMat from FLIP3D_ATLAS_COPY_FRAG',
    assets.includes('flip3dAtlasCopyMat = useMemo(') && assets.includes('fragmentShader: FLIP3D_ATLAS_COPY_FRAG'));
  check('assets expose flip3dAtlasCopyMat in the returned materials',
    assets.includes('flip3dAtlasCopyMat,'));
  const fragSrc = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationFlip3d.ts'), 'utf8');
  const fragStart = fragSrc.indexOf('FLIP3D_ATLAS_COPY_FRAG');
  const frag = fragSrc.slice(fragStart, fragStart + 700);
  check('copy frag declares uSrcTex / uHalf and the half-write discard',
    frag.includes('uniform sampler2D uSrcTex;') && frag.includes('uniform float uHalf;')
    && frag.includes('float y = vUv.y * 2.0 - uHalf;') && frag.includes('discard'));
  const scene = readFileSync(join(ROOT, 'components/sceneGpgpuSystem.tsx'), 'utf8');
  check('scene passes flip3dAtlasCopyMat into runFlip3dPasses materials',
    scene.split('flip3dAtlasCopyMat').length - 1 >= 2);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
