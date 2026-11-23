// Phase 16 stage 2+3 — PBR grammar commonisation + IBL step 1.
// (a) shared table values == pre-refactor per-system effective values
// (b) materialStyleToInt == legacy ternary for every value
// (c) GEOM defaults (metalness 0 / roughness 1) == legacy spec pow24*0.35
// (d) IBL intensity 0 => scene.environment is not wired (gate + source)
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p16-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const close = (a, b) => Math.abs(a - b) < 1e-12;

await build({
  stdin: {
    contents: `
      export * from './lib/materialGrammar.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);

  // --- (b) int helper vs legacy ternary ---------------------------
  const legacy = (s) => s === 'glass' ? 1 : s === 'hologram' ? 2 : s === 'chrome' ? 3 : s === 'halftone' ? 4 : 0;
  for (const s of ['classic', 'glass', 'hologram', 'chrome', 'halftone', 'unknown', undefined, null]) {
    check(`(b) int(${String(s)}) == ternary`, m.materialStyleToInt(s) === legacy(s), `${m.materialStyleToInt(s)} vs ${legacy(s)}`);
  }
  check('(b) int mapping is 0/1/2/3/4', ['classic', 'glass', 'hologram', 'chrome', 'halftone'].map((s) => m.materialStyleToInt(s)).join(',') === '0,1,2,3,4');

  // --- (a) absolute style table == CrystalDeposition legacy -------
  const depLegacy = (s) => s === 'chrome' ? { roughness: 0.16, metalness: 0.92 }
    : s === 'glass' ? { roughness: 0.08, metalness: 0.24 }
    : { roughness: 0.46, metalness: 0.12 };
  for (const s of ['classic', 'glass', 'hologram', 'chrome', 'halftone']) {
    const got = m.getMaterialStylePbr(s); const want = depLegacy(s);
    check(`(a) deposition ${s}`, close(got.roughness, want.roughness) && close(got.metalness, want.metalness) && got.envMapIntensity === 1, JSON.stringify(got));
  }

  // --- (a) fixed sets == legacy literals --------------------------
  const fixed = {
    smoothTube: { roughness: 0.4, metalness: 0.2 },
    terrain: { roughness: 0.92, metalness: 0.0 },
    obj: { roughness: 0.92, metalness: 0.0 },
    hybridGranular: { roughness: 0.62, metalness: 0.08 },
    metaballDefault: { roughness: 0.2, metalness: 0.5 },
  };
  for (const [k, want] of Object.entries(fixed)) {
    const got = m.STANDARD_FIXED_PBR[k];
    check(`(a) fixed ${k}`, close(got.roughness, want.roughness) && close(got.metalness, want.metalness), JSON.stringify(got));
  }
  check('(a) metaball config passthrough', (() => { const p = m.resolveMetaballPbr(0.5, 0.2); return p.metalness === 0.5 && p.roughness === 0.2 && p.envMapIntensity === 1; })());

  // --- (a) profile deltas == legacy ternaries, over sample profiles
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const voxelLegacy = (prof, s) => ({
    roughness: clamp(prof.roughness + (s === 'chrome' ? -0.08 : s === 'glass' ? -0.06 : 0), 0.04, 1),
    metalness: clamp(prof.metalness + (s === 'chrome' ? 0.42 : s === 'glass' ? 0.12 : 0), 0, 1),
  });
  const crystalLegacy = (prof, s) => ({
    roughness: prof.roughness + (s === 'chrome' ? -0.12 : s === 'glass' ? -0.08 : 0),
    metalness: clamp(prof.metalness + (s === 'chrome' ? 0.44 : s === 'glass' ? 0.1 : 0), 0, 1),
  });
  // Sample profiles are the actual per-mode defaults from the source
  // files (voxel default + lattice_surge + frost; crystal default +
  // crystal_aggregate + jammed_pack).
  const voxelProfiles = [
    { roughness: 0.55, metalness: 0.08 }, { roughness: 0.28, metalness: 0.34 }, { roughness: 0.24, metalness: 0.18 },
    { roughness: 0.02, metalness: 0.95 }, // clamp edges
  ];
  const crystalProfiles = [
    { roughness: 0.42, metalness: 0.18 }, { roughness: 0.38, metalness: 0.22 }, { roughness: 0.92, metalness: 0.02 },
  ];
  let deltaOk = true;
  for (const prof of voxelProfiles) for (const s of ['classic', 'glass', 'hologram', 'chrome', 'halftone']) {
    const g = m.applyVoxelProfilePbr(prof, s); const w = voxelLegacy(prof, s);
    if (!close(g.roughness, w.roughness) || !close(g.metalness, w.metalness)) deltaOk = false;
  }
  for (const prof of crystalProfiles) for (const s of ['classic', 'glass', 'hologram', 'chrome', 'halftone']) {
    const g = m.applyCrystalProfilePbr(prof, s); const w = crystalLegacy(prof, s);
    if (!close(g.roughness, w.roughness) || !close(g.metalness, w.metalness)) deltaOk = false;
  }
  check('(a) voxel+crystal profile deltas match legacy for all styles/profiles', deltaOk);

  // --- defaults: new keys -----------------------------------------
  const base = m.DEFAULT_CONFIG;
  check('defaults: gpgpuGeomMetalness 0 / Roughness 1 / SceneEnv 0',
    base.gpgpuGeomMetalness === 0 && base.gpgpuGeomRoughness === 1 && base.gpgpuSceneEnvIntensity === 0,
    `${base.gpgpuGeomMetalness}/${base.gpgpuGeomRoughness}/${base.gpgpuSceneEnvIntensity}`);
  check('defaults: GEOM_PBR_DEFAULTS matches config defaults',
    m.GEOM_PBR_DEFAULTS.metalness === base.gpgpuGeomMetalness && m.GEOM_PBR_DEFAULTS.roughness === base.gpgpuGeomRoughness);

  // --- (c) GEOM default specular == legacy ------------------------
  let specOk = true;
  for (const ndh of [0, 0.25, 0.5, 0.7071, 0.9, 1]) {
    const legacySpec = Math.pow(Math.max(ndh, 0), 24) * 0.35;
    for (const col of [[0.53, 0.66, 1], [1, 1, 1], [0, 0, 0]]) {
      const got = m.geomSpecular(ndh, col, 0, 1);
      if (!got.every((v) => close(v, legacySpec))) specOk = false;
    }
  }
  check('(c) geomSpecular(defaults) == pow(ndh,24)*0.35 for samples/colors', specOk);
  check('(c) geomSpecularExponent(1) == 24', m.geomSpecularExponent(1) === 24);
  check('(c) geomF0 metalness 0 == 0.04 grey', m.geomF0([0.2, 0.4, 0.9], 0).every((v) => close(v, 0.04)));
  check('(c) geomF0 metalness 1 == color', m.geomF0([0.2, 0.4, 0.9], 1).every((v, i) => close(v, [0.2, 0.4, 0.9][i])));
  check('(c) non-default roughness sharpens (exp(0.5)==96)', m.geomSpecularExponent(0.5) === 96);

  // --- (d) IBL gate ------------------------------------------------
  check('(d) shouldApplySceneEnvironment(0) === false', m.shouldApplySceneEnvironment(0) === false);
  check('(d) shouldApplySceneEnvironment(negative/NaN) === false', m.shouldApplySceneEnvironment(-1) === false && m.shouldApplySceneEnvironment(NaN) === false);
  check('(d) shouldApplySceneEnvironment(>0) === true', m.shouldApplySceneEnvironment(0.01) === true && m.shouldApplySceneEnvironment(2) === true);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

// --- source-level wiring checks -----------------------------------
const geom = readFileSync(join(ROOT, 'components/gpgpuShaderVolumes.ts'), 'utf8');
check('(c) GEOM_FRAG declares uMetalness/uRoughness', geom.includes('uniform float uMetalness;') && geom.includes('uniform float uRoughness;'));
check('(c) GEOM_FRAG keeps legacy fallback branch', geom.includes('uMetalness <= 0.001 && uRoughness >= 0.999') && geom.includes('pow(ndh, 24.0) * 0.35'));
check('(c) GEOM_FRAG F0 mix present', geom.includes('mix(vec3(0.04), uColor, clamp(uMetalness, 0.0, 1.0))'));
check('GEOM IBL path unchanged (uIblIntensity branch intact)', geom.includes('if (uIblIntensity > 0.001)'));

const ibl = readFileSync(join(ROOT, 'lib/iblEnvironment.ts'), 'utf8');
check('(d) PMREM helper present with dispose', ibl.includes('new THREE.PMREMGenerator') && ibl.includes('fromEquirectangular') && ibl.includes('renderTarget.dispose()'));
check('(d) step-2 deferred note recorded', ibl.includes('第2段は対象を絞って残置'));
check('env intensity material helper present', ibl.includes('applySceneEnvIntensityToMaterials') && ibl.includes('isMeshStandardMaterial'));

const rig = readFileSync(join(ROOT, 'components/AppSceneCameraRig.tsx'), 'utf8');
check('(d) SceneEnvironmentSync gates on shouldApply before wiring', rig.includes('SceneEnvironmentSync') && rig.includes('if (!shouldApplySceneEnvironment(intensity))') && rig.includes('scene.environment = handleRef.current.texture'));
const appScene = readFileSync(join(ROOT, 'components/AppScene.tsx'), 'utf8');
check('(d) AppScene mounts SceneEnvironmentSync', appScene.includes('<SceneEnvironmentSync config={effectiveConfig} />'));

// No leftover copy-pasted style ternaries outside the grammar module.
import { readdirSync, statSync } from 'node:fs';
const stray = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, 'utf8').includes("=== 'glass' ? 1 :")) stray.push(p);
  }
};
walk(join(ROOT, 'components'));
check('(b) no uMaterialStyle ternary copies remain in components/', stray.length === 0, stray.join(', '));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
