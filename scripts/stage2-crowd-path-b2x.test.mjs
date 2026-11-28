// Grammar 2.0 stage 2, B2 crowd follow-up — the crowd
// variant walks an EXTENDED path asset (the combination B2
// left open: crowd ON kept the legacy uniform supply). The
// crowd-asset chunk is the crowd chunk with ONLY its path
// branch swapped for the asset walk, derived by string
// replacement so the state machine and every other law are
// the crowd chunk's own by construction. Record:
// kalokagathia-pro/STAGE2_B2_CROWD_IMPL_RECORD.md.
//
// Cases:
//  1 predicates: the crowd-asset predicate's matrix, and
//    its disjointness from the non-crowd asset predicate
//  2 derivation identity: swapping the branch back yields
//    the crowd chunk byte-for-byte; the asset branch keeps
//    the lane grammar and drops the uniform path reads
//  3 assembly: crowd + crowdPathAssets splices the new
//    chunk; crowd alone keeps the legacy supply; the
//    standalone steer-avoid chunk stays skipped
//  4 sampler counts: crowd + asset fits 16; with live rules
//    the merged supply closes it at 16 as well
//  5 capability: crowd + extended asset requests
//    'path-assets' (WebGL fallback), crowd + legacy does not
//  6 identity: default velocity string is the stock constant
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2cx-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const occurrences = (s, sub) => s.split(sub).length - 1;

await build({
  stdin: {
    contents: `
      export { steeringPathAssetActive, steeringCrowdPathAssetActive } from './lib/gpgpuPathAssets.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildMainForcesFragment, VEL_FRAG_FORCE_STEER_SEEK_CROWD, VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET, VEL_FRAG_CROWD_PATH_BRANCH_LEGACY, VEL_FRAG_CROWD_PATH_BRANCH_ASSET } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  steeringPathAssetActive, steeringCrowdPathAssetActive,
  buildVelocityFragment, SIM_VEL_FRAG, buildMainForcesFragment,
  VEL_FRAG_FORCE_STEER_SEEK_CROWD, VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET,
  VEL_FRAG_CROWD_PATH_BRANCH_LEGACY, VEL_FRAG_CROWD_PATH_BRANCH_ASSET,
  getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

const D = APP_STATE_DEFAULT_GPGPU;
const cfg = (patch) => ({ ...D, ...patch });
const JSON_PATH = '[{"name":"long","points":[[0,0,0],[10,0,0],[20,0,0],[30,0,0],[40,0,0],[50,0,0],[60,0,0],[70,0,0],[80,0,0],[90,0,0],[100,0,0],[110,0,0]]}]';
const steerBase = { gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPaths: JSON_PATH };

// ── 1. Predicates ───────────────────────────────────────────
{
  check('1 crowd + extended: crowd-asset predicate stands',
    steeringCrowdPathAssetActive(cfg({ ...steerBase, gpgpuCrowdEnabled: true })));
  check('1 crowd off: crowd-asset predicate falls, asset predicate stands',
    !steeringCrowdPathAssetActive(cfg(steerBase)) && steeringPathAssetActive(cfg(steerBase)));
  check('1 crowd on: asset predicate falls (disjoint)',
    !steeringPathAssetActive(cfg({ ...steerBase, gpgpuCrowdEnabled: true })));
  check('1 seek mode / steer off / legacy-only all fall', (() => {
    const legacy = { gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPath: '0,0,0;10,0,0', gpgpuCrowdEnabled: true };
    return !steeringCrowdPathAssetActive(cfg({ ...steerBase, gpgpuCrowdEnabled: true, gpgpuSteerSeekMode: 'seek' }))
      && !steeringCrowdPathAssetActive(cfg({ ...steerBase, gpgpuCrowdEnabled: true, gpgpuSteerSeekEnabled: false }))
      && !steeringCrowdPathAssetActive(cfg(legacy));
  })());
}

// ── 2. Derivation identity ──────────────────────────────────
{
  check('2 crowd chunk contains the legacy branch exactly once',
    occurrences(VEL_FRAG_FORCE_STEER_SEEK_CROWD, VEL_FRAG_CROWD_PATH_BRANCH_LEGACY) === 1);
  check('2 swapping the asset branch back yields the crowd chunk byte-for-byte',
    VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.replace(VEL_FRAG_CROWD_PATH_BRANCH_ASSET, VEL_FRAG_CROWD_PATH_BRANCH_LEGACY)
    === VEL_FRAG_FORCE_STEER_SEEK_CROWD);
  check('2 the derivation actually replaced (chunks differ)',
    VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET !== VEL_FRAG_FORCE_STEER_SEEK_CROWD);
  check('2 asset branch: column walk + lane grammar, no uniform path reads',
    VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('kaloColFetch(uColPathHeadersBase + float(pIdx))')
    && VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('float cLaneCenter = uCrowdLaneOffset')
    && VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('cLatForce = cLat * (-cLatDev * uCrowdLaneLateralGain);')
    && !VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('uSteerSeekPath[')
    && !VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('uSteerSeekPathCount'));
  check('2 state machine tail is shared (AVOID / IDLE laws present in both)',
    VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('uCrowdAvoidStrength * cSw * cSw')
    && VEL_FRAG_FORCE_STEER_SEEK_CROWD_ASSET.includes('pow(clamp(uCrowdIdleDamping, 0.0, 1.0), uDelta * 60.0)'));
}

// ── 3. Assembly ─────────────────────────────────────────────
{
  const crowdAsset = buildMainForcesFragment(undefined, { steeringSeek: true, crowd: true, crowdPathAssets: true });
  check('3 crowd + crowdPathAssets splices the crowd-asset chunk',
    crowdAsset.includes('kaloColFetch(uColPathHeadersBase + float(pIdx))')
    && !crowdAsset.includes('uSteerSeekPathCount'));
  const crowdLegacy = buildMainForcesFragment(undefined, { steeringSeek: true, crowd: true });
  check('3 crowd alone keeps the legacy uniform supply',
    crowdLegacy.includes('uSteerSeekPathCount') && !crowdLegacy.includes('uColPathHeadersBase'));
  check('3 crowd flag without the asset flag keeps legacy even if pathAssets is set',
    buildMainForcesFragment(undefined, { steeringSeek: true, crowd: true, pathAssets: true }) === crowdLegacy);
}

// ── 4. Sampler counts ───────────────────────────────────────
{
  const crowdAsset = buildVelocityFragment('', undefined, { steeringSeek: true, crowd: true, crowdPathAssets: true });
  check('4 crowd + asset velocity measures 16 units', samplerCount(crowdAsset) === 16, String(samplerCount(crowdAsset)));
  check('4 crowd + asset declares the column sampler once, spawn-order given back',
    occurrences(crowdAsset, 'uniform sampler2D uColTex;') === 1
    && !crowdAsset.includes('uniform sampler2D uSpawnOrderTex;'));
  const crowdAssetLive = buildVelocityFragment('', undefined, { steeringSeek: true, crowd: true, crowdPathAssets: true, particleRulesLive: true });
  check('4 crowd + asset + live unmerged measures 17 (the recorded open combination)',
    samplerCount(crowdAssetLive) === 17, String(samplerCount(crowdAssetLive)));
  const crowdAssetMerged = buildVelocityFragment('', undefined, { steeringSeek: true, crowd: true, crowdPathAssets: true, particleRulesLive: true, mergedSupply: true });
  check('4 crowd + asset + live with the merged supply measures 16',
    samplerCount(crowdAssetMerged) === 16 && crowdAssetMerged.includes('uniform sampler2D uMergedTex;'),
    String(samplerCount(crowdAssetMerged)));
}

// ── 5. Capability ───────────────────────────────────────────
{
  const use = getWebgpuComputeCapabilityReport(cfg({ ...steerBase, gpgpuCrowdEnabled: true }));
  check("5 crowd + extended asset requests 'path-assets' and it is unsupported (WebGL fallback)",
    use.requestedFeatures.includes('path-assets') && use.unsupportedFeatures.includes('path-assets') && use.canRunRequestedConfig === false);
  const legacy = getWebgpuComputeCapabilityReport(cfg({ gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPath: '0,0,0;10,0,0', gpgpuCrowdEnabled: true }));
  check('5 crowd + legacy-only path requests nothing', !legacy.requestedFeatures.includes('path-assets'));
}

// ── 6. Identity ─────────────────────────────────────────────
check('6 default velocity string is the stock constant', buildVelocityFragment('') === SIM_VEL_FRAG);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
