// Grains DEM engine (solver research stage 2-1, foundation) —
// plan resolution, capability routing, grid resolution, the
// fixed-dt accumulator and the auto-quality ladder.
// Identity: with the DEM switch off (the default) the plan is
// inactive and the capability registry requests the legacy
// 'grains' feature exactly as before, so every existing
// configuration routes and behaves unchanged.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20dem-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { resolveGrainsDemPlan, resolveGrainsDemGrid, grainsDemAccumulate, grainsDemQualityStep, grainsDemReposeLookup, GRAINS_DEM_REPOSE_TABLE, bumpGrainsDemConfigEpoch, grainsDemConfigEpochValue, effectiveGrainsFriction, GRAINS_DEM_DT, GRAINS_DEM_GRID_MAX_CELLS, GRAINS_DEM_QUALITY_LADDER } from './lib/gpgpuGrains.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { normalizeConfig } from './lib/appStateConfigNormalization.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveGrainsDemPlan, resolveGrainsDemGrid, grainsDemAccumulate,
  grainsDemQualityStep, grainsDemReposeLookup, GRAINS_DEM_REPOSE_TABLE,
  bumpGrainsDemConfigEpoch, grainsDemConfigEpochValue, effectiveGrainsFriction,
  GRAINS_DEM_DT, GRAINS_DEM_GRID_MAX_CELLS,
  GRAINS_DEM_QUALITY_LADDER, getWebgpuComputeCapabilityReport, normalizeConfig,
} = lib;

const cfg = (over = {}) => ({
  gpgpuGrainsEnabled: false, gpgpuGrainsFriction: 0.6, gpgpuGrainsReposeAngle: 0,
  gpgpuGrainsSize: 8, gpgpuGrainsRestitution: 0,
  gpgpuGrainsDemEnabled: false, gpgpuGrainsDemSubsteps: 64,
  gpgpuGrainsDemStiffness: 1, gpgpuGrainsDemTangentialRatio: 0.5,
  gpgpuGrainsDemRollingFriction: 0.46, gpgpuGrainsDemLocalDamping: 0,
  gpgpuGrainsDemHistorySlots: 12, gpgpuGrainsDemAutoQuality: true,
  gpgpuRigidEnabled: false, gpgpuVerletEnabled: false,
  ...over,
});
const demOn = (over = {}) => cfg({ gpgpuGrainsEnabled: true, gpgpuGrainsDemEnabled: true, ...over });

// --- plan resolution / identity ------------------------------------
{
  check('DEM plan inactive by default (dem-off)', resolveGrainsDemPlan(cfg({ gpgpuGrainsEnabled: true })).active === false
    && resolveGrainsDemPlan(cfg({ gpgpuGrainsEnabled: true })).inactiveReason === 'dem-off');
  check('DEM plan inactive while Grains off', resolveGrainsDemPlan(cfg({ gpgpuGrainsDemEnabled: true })).inactiveReason === 'grains-off');
  check('DEM plan active when Grains + DEM on', demOn() && resolveGrainsDemPlan(demOn()).active === true);
  check('rigid bodies exclude DEM', resolveGrainsDemPlan(demOn({ gpgpuRigidEnabled: true })).inactiveReason === 'rigid-exclusive');
  check('Verlet excludes DEM', resolveGrainsDemPlan(demOn({ gpgpuVerletEnabled: true })).inactiveReason === 'verlet-exclusive');
}

// --- plan numbers (gate scene: Size 8, friction 0.6, restitution 0) -
{
  const p = resolveGrainsDemPlan(demOn());
  check('radius is Size / 2', near(p.radius, 4));
  check('mass is volume-scaled from the spike unit mass', near(p.mass, 512), `mass=${p.mass}`);
  check('inertia is (2/5) m R^2', near(p.inertia, 0.4 * 512 * 16));
  check('kn = 20000 * mass * stiffness multiplier', near(p.kn, 20000 * 512), `kn=${p.kn}`);
  check('kt = kn * tangential ratio', near(p.kt, p.kn * 0.5));
  check('restitution 0 clamps damping to critical', near(p.cn, 2 * Math.sqrt(p.kn * 512 * 0.5)), `cn=${p.cn}`);
  check('muS follows the friction key', near(p.muS, 0.6));
  check('floor mu is the spike ratio 1.25x', near(p.muFloor, 0.75));
  check('rolling default is the rescaled spike point 0.46', near(p.rollingFriction, 0.46));
  check('history slots / substeps resolve from keys', p.historySlots === 12 && p.maxSubsteps === 64);
  const repose = resolveGrainsDemPlan(demOn({ gpgpuGrainsReposeAngle: 35 }));
  const look35 = grainsDemReposeLookup(35);
  check('ReposeAngle under DEM resolves through the shim table (not tan)',
    near(repose.muS, look35.muS) && near(repose.rollingFriction, look35.rollingFriction)
    && !near(repose.muS, Math.tan(35 * Math.PI / 180), 1e-3), `muS=${repose.muS} roll=${repose.rollingFriction}`);
  const clamped = resolveGrainsDemPlan(demOn({ gpgpuGrainsDemSubsteps: 999, gpgpuGrainsDemHistorySlots: 99 }));
  check('substeps / slots clamp to their ranges', clamped.maxSubsteps === 128 && clamped.historySlots === 16);
  const stiff = resolveGrainsDemPlan(demOn({ gpgpuGrainsDemStiffness: 2 }));
  check('stiffness key scales kn', near(stiff.kn, 20000 * 512 * 2));
}

// --- capability routing ---------------------------------------------
{
  const legacy = getWebgpuComputeCapabilityReport(cfg({ gpgpuGrainsEnabled: true }));
  check('DEM off: registry requests legacy grains (routes to WebGL)',
    legacy.requestedFeatures.includes('grains') && !legacy.requestedFeatures.includes('grains-dem')
    && legacy.unsupportedFeatures.includes('grains'));
  const dem = getWebgpuComputeCapabilityReport(demOn());
  check('DEM on: registry requests grains-dem instead of grains',
    dem.requestedFeatures.includes('grains-dem') && !dem.requestedFeatures.includes('grains'));
  check('DEM on: grains-dem is supported (config can run on WebGPU)',
    !dem.unsupportedFeatures.includes('grains-dem') && !dem.unsupportedFeatures.includes('grains'));
  const excluded = getWebgpuComputeCapabilityReport(demOn({ gpgpuRigidEnabled: true }));
  check('DEM + rigid: plan inactive, legacy grains request stands',
    excluded.requestedFeatures.includes('grains') && !excluded.requestedFeatures.includes('grains-dem'));
}

// --- grid resolution --------------------------------------------------
{
  const g = resolveGrainsDemGrid(8, 300);
  check('gate grid: cell at least one diameter', g.cellSize >= 8, `cell=${g.cellSize}`);
  check('gate grid: total cells within the cap', g.cellCount <= GRAINS_DEM_GRID_MAX_CELLS, `cells=${g.cellCount}`);
  check('gate grid: coverage spans the domain', g.dimX * g.cellSize >= 300 * 2 * 1.05 + 16 - 1e-6);
  const small = resolveGrainsDemGrid(2, 50);
  check('small scene: cell equals the diameter', near(small.cellSize, 2) && small.dimX === Math.ceil((50 * 2 * 1.05 + 4) / 2));
  const huge = resolveGrainsDemGrid(1, 5000);
  check('huge scene: cells still capped, cell grew past the diameter',
    huge.cellCount <= GRAINS_DEM_GRID_MAX_CELLS && huge.cellSize > 1);
}

// --- fixed-dt accumulator ---------------------------------------------
{
  const a = grainsDemAccumulate(0, 1 / 60, 64);
  check('one 60fps frame yields exactly 64 substeps', a.substeps === 64 && near(a.accumulator, 0, 1e-9), `sub=${a.substeps} acc=${a.accumulator}`);
  const b = grainsDemAccumulate(0, 1 / 120, 64);
  check('one 120fps frame yields 32 substeps', b.substeps === 32);
  const c = grainsDemAccumulate(0, 0.5, 64);
  check('excess frame time is dropped, never stretched', c.substeps === 64 && c.accumulator === 0);
  const d = grainsDemAccumulate(0, 0, 64);
  check('zero delta yields zero substeps', d.substeps === 0 && d.accumulator === 0);
  const e = grainsDemAccumulate(0, 1 / 60, 32);
  check('a lower key cap binds', e.substeps === 32 && e.accumulator === 0);
  check('DEM dt is the spike rate 1/(60*64)', near(GRAINS_DEM_DT, 1 / 3840, 1e-12));
}

// --- auto-quality ladder ------------------------------------------------
{
  let idx = 0; let past = 0;
  for (let f = 0; f < 44; f++) ({ ladderIndex: idx, framesPast: past } = grainsDemQualityStep(idx, 25, past, 64));
  check('sustained heavy frames hold the level before hysteresis', idx === 0);
  ({ ladderIndex: idx, framesPast: past } = grainsDemQualityStep(idx, 25, past, 64));
  check('the 45th heavy frame downgrades 64 -> 48', idx === 1 && grainsDemQualityStep(idx, 10, 0, 64).maxSubsteps === 48);
  let idx2 = 2; let past2 = 0;
  for (let f = 0; f < 45; f++) ({ ladderIndex: idx2, framesPast: past2 } = grainsDemQualityStep(idx2, 8, past2, 64));
  check('sustained light frames upgrade back 32 -> 48', idx2 === 1);
  check('the ladder never exceeds the key cap', grainsDemQualityStep(0, 10, 0, 32).maxSubsteps === 32);
  check('ladder is 64 / 48 / 32', GRAINS_DEM_QUALITY_LADDER.join(',') === '64,48,32');
}

// --- ReposeAngle shim table (stage 2-2) --------------------------------
{
  const table = GRAINS_DEM_REPOSE_TABLE;
  check('shim table covers 15..40 degrees in 5-degree rows',
    table.length === 6 && table[0].angleDeg === 15 && table[table.length - 1].angleDeg === 40);
  check('shim table is monotone in angle and rolling coefficient',
    table.every((r, i) => i === 0 || (r.angleDeg > table[i - 1].angleDeg && r.rollingFriction >= table[i - 1].rollingFriction)));
  for (const row of table) {
    const look = grainsDemReposeLookup(row.angleDeg);
    check(`lookup hits the ${row.angleDeg}-degree row exactly`,
      near(look.muS, row.muS) && near(look.rollingFriction, row.rollingFriction));
  }
  const mid = grainsDemReposeLookup(32.5);
  const lo = table[3]; const hi = table[4];
  check('lookup interpolates linearly between rows',
    near(mid.muS, (lo.muS + hi.muS) / 2) && near(mid.rollingFriction, (lo.rollingFriction + hi.rollingFriction) / 2));
  check('lookup clamps below and above the table',
    near(grainsDemReposeLookup(5).rollingFriction, table[0].rollingFriction)
    && near(grainsDemReposeLookup(80).rollingFriction, table[table.length - 1].rollingFriction));
  const manual = resolveGrainsDemPlan(demOn({ gpgpuGrainsFriction: 0.9, gpgpuGrainsDemRollingFriction: 3.3 }));
  check('no repose: friction and rolling keys rule verbatim',
    near(manual.muS, 0.9) && near(manual.rollingFriction, 3.3));
  const over = resolveGrainsDemPlan(demOn({
    gpgpuGrainsReposeAngle: 35, gpgpuGrainsFriction: 0.9, gpgpuGrainsDemRollingFriction: 3.3,
  }));
  const look35b = grainsDemReposeLookup(35);
  check('repose overrides BOTH manual keys (legacy priority)',
    near(over.muS, look35b.muS) && near(over.rollingFriction, look35b.rollingFriction));
  check('legacy effectiveGrainsFriction keeps the tan override (DEM shim does not leak)',
    near(effectiveGrainsFriction(demOn({ gpgpuGrainsReposeAngle: 35 })), Math.tan(35 * Math.PI / 180), 1e-9));
}

// --- DEM config round-trip (stage 2-2, design section 5) ---------------
{
  const demCfg = {
    gpgpuGrainsEnabled: true, gpgpuGrainsDemEnabled: true,
    gpgpuGrainsDemSubsteps: 48, gpgpuGrainsDemStiffness: 1.5,
    gpgpuGrainsDemTangentialRatio: 0.7, gpgpuGrainsDemRollingFriction: 0.9,
    gpgpuGrainsDemLocalDamping: 0.2, gpgpuGrainsDemHistorySlots: 10,
    gpgpuGrainsDemAutoQuality: false, gpgpuGrainsReposeAngle: 35,
  };
  const once = normalizeConfig(JSON.parse(JSON.stringify(demCfg)));
  const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
  const keys = Object.keys(demCfg);
  check('a DEM-on config survives a save/load round-trip verbatim',
    keys.every((k) => twice[k] === demCfg[k]), JSON.stringify(keys.filter((k) => twice[k] !== demCfg[k])));
  const plain = normalizeConfig({});
  check('defaults keep DEM off (no preset can turn it on implicitly)',
    plain.gpgpuGrainsDemEnabled === false && plain.gpgpuGrainsDemRollingFriction === 0.46);
}

// --- config-load epoch (stage 2-2, preset-switch history rule) ---------
{
  const before = grainsDemConfigEpochValue();
  bumpGrainsDemConfigEpoch();
  check('a config load bumps the epoch by one', grainsDemConfigEpochValue() === before + 1);
  bumpGrainsDemConfigEpoch();
  check('a second load bumps it again', grainsDemConfigEpochValue() === before + 2);
}

// --- wiring: epoch producers / consumer (source-level) ------------------
{
  const { readFileSync } = await import('node:fs');
  const transition = readFileSync(join(ROOT, 'lib', 'usePresetTransition.ts'), 'utf8');
  check('both preset apply paths bump the DEM config epoch',
    (transition.match(/bumpGrainsDemConfigEpoch\(\);/g) || []).length === 2);
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('the simulation runner passes the epoch into the DEM params',
    passes.includes('configEpoch: grainsDemConfigEpochValue()'));
  const compute = readFileSync(join(ROOT, 'lib', 'webgpuCompute.ts'), 'utf8');
  check('the compute step re-initialises history on an epoch change',
    compute.includes('dem!.configEpoch !== ds.configEpoch') && compute.includes('ds.needsInit = true'));
}

// --- starter preset compatibility (stage 2-2, design section 5) ---------
{
  const { readFileSync } = await import('node:fs');
  const chunk = readFileSync(join(ROOT, 'lib', 'starterLibraryPresetExtensionChunk05Gpgpu.ts'), 'utf8');
  const blockOf = (id) => {
    const start = chunk.indexOf(`createStarterPreset('${id}'`);
    if (start < 0) return '';
    const next = chunk.indexOf('createStarterPreset(', start + 10);
    return chunk.slice(start, next < 0 ? undefined : next);
  };
  for (const id of ['starter-grains-pile', 'starter-grains-cohesive-clumps', 'starter-grains-repose-pile']) {
    const block = blockOf(id);
    check(`${id}: exists, carries no DEM keys and no Pile key (DEM stays off, legacy behaviour)`,
      block.length > 0 && !block.includes('gpgpuGrainsDem') && !block.includes('gpgpuGrainsPileEnabled'));
  }
  check('starter-grains-repose-pile keeps its ReposeAngle 35 (shim input)',
    blockOf('starter-grains-repose-pile').includes('gpgpuGrainsReposeAngle: 35'));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
