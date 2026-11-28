// Grammar 2.0 stage 2, slice E4 — light units: the Phase T
// light becomes a unit list (unit 1 = the legacy keys, units
// 2-4 = new key families), the 'light' emit shape selects its
// unit, and the Phase Z occlusion bake receives the unit
// list's positions.
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E4.
//
// Cases:
//  1 unit resolution: defaults resolve to the single legacy
//    light; units 2-4 mirror unit 1's defaults, disabled;
//    per-unit position / radius / intensity read their own
//    key families; non-finite values fall back
//  2 emit selection: default pos is the legacy position;
//    selecting a unit returns its position regardless of its
//    draw enable (legacy pure-reference rule); clamping
//  3 bake integration: a 'light' bake fed the resolved
//    position of unit 3 equals the manual bake and differs
//    from the unit-1 bake; the default resolution is
//    bit-identical to passing the legacy keys directly
//  4 draw variant: stock DRAW_VERT / DRAW_FRAG and the sim
//    strings pinned to the pre-E4 hashes; the light-units
//    variant carries exactly the units 2-4 segments
//  5 shadow connection: a scene without extras reproduces
//    the single-light occlusion and bake byte for byte; an
//    extra light unions (occlusion never decreases, and a
//    point blocked only from the extra light darkens);
//    buildShadowScene wires enabled units only
//  6 key registration: the 19 new keys sit at their defaults
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2e4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const arraysEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

await build({
  stdin: {
    contents: `
      export { resolveLightUnits, resolveLightUnit, extraLightUnitsActive, resolveEmitLightUnit, emitLightUnitSelectionActive, resolveEmitLightPos, resolveShadowExtraLightPositions, clampLightUnitIndex, lightUnitUniformsGlsl, lightUnitComputeGlsl, LIGHT_UNIT_COUNT, EXTRA_LIGHT_UNITS } from './lib/gpgpuLightUnits.ts';
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { buildShadowScene, occlusionAtPoint, bakeShadowOcclusionMap } from './lib/shadowOcclusion.ts';
      export { buildDrawVert, DRAW_VERT, DRAW_FRAG } from './components/gpgpuShaderPoints.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveLightUnits, resolveLightUnit, extraLightUnitsActive,
  resolveEmitLightUnit, emitLightUnitSelectionActive, resolveEmitLightPos,
  resolveShadowExtraLightPositions, clampLightUnitIndex,
  lightUnitUniformsGlsl, lightUnitComputeGlsl,
  buildGpgpuInitialData,
  buildShadowScene, occlusionAtPoint, bakeShadowOcclusionMap,
  buildDrawVert, DRAW_VERT, DRAW_FRAG,
  SIM_POS_FRAG, SIM_VEL_FRAG,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const D = APP_STATE_DEFAULT_GPGPU;

// ── 1. Unit resolution ─────────────────────────────────────
{
  const units = resolveLightUnits(D);
  check('units: list has 4 entries, unit 1 first', units.length === 4 && units[0].index === 1);
  check('units: defaults resolve unit 1 from the legacy keys',
    units[0].enabled === D.gpgpuLightEnabled
    && units[0].pos.x === D.gpgpuLightPosX && units[0].pos.y === D.gpgpuLightPosY && units[0].pos.z === D.gpgpuLightPosZ
    && units[0].intensity === D.gpgpuLightIntensity && units[0].radius === D.gpgpuLightRadius);
  check('units: 2-4 ship disabled, mirroring intensity / radius defaults',
    [2, 3, 4].every((n) => {
      const u = units[n - 1];
      return u.enabled === false && u.intensity === 1 && u.radius === 3
        && u.pos.x === 0 && u.pos.y === 0 && u.pos.z === 0;
    }));
  const custom = {
    gpgpuLight2Enabled: true, gpgpuLight2PosX: 10, gpgpuLight2PosY: 20, gpgpuLight2PosZ: 30,
    gpgpuLight2Intensity: 2.5, gpgpuLight2Radius: 42,
  };
  const u2 = resolveLightUnit(custom, 2);
  check('units: unit 2 reads its own key family',
    u2.enabled === true && u2.pos.x === 10 && u2.pos.y === 20 && u2.pos.z === 30
    && u2.intensity === 2.5 && u2.radius === 42);
  const junk = resolveLightUnit({ gpgpuLight3PosX: Number.NaN, gpgpuLight3Intensity: Infinity }, 3);
  check('units: non-finite values fall back to the mirror defaults',
    junk.pos.x === 0 && junk.intensity === 1 && junk.enabled === false);
  check('units: clamp keeps indices inside 1..4',
    clampLightUnitIndex(0) === 1 && clampLightUnitIndex(99) === 4
    && clampLightUnitIndex(2.6) === 3 && clampLightUnitIndex(Number.NaN) === 1);
  check('units: extraLightUnitsActive follows units 2-4 only',
    extraLightUnitsActive(D) === false
    && extraLightUnitsActive({ gpgpuLightEnabled: true }) === false
    && extraLightUnitsActive({ gpgpuLight4Enabled: true }) === true);
}

// ── 2. Emit selection ──────────────────────────────────────
{
  check('emit: default selection is unit 1 and its legacy position',
    resolveEmitLightUnit(D) === 1
    && resolveEmitLightPos(D).x === D.gpgpuLightPosX
    && emitLightUnitSelectionActive(D) === false);
  const cfg = {
    gpgpuLightPosX: 1, gpgpuLightPosY: 2, gpgpuLightPosZ: 3,
    gpgpuLight3PosX: -50, gpgpuLight3PosY: 60, gpgpuLight3PosZ: -70,
    gpgpuEmitLightUnit: 3,
  };
  const pos = resolveEmitLightPos(cfg);
  check('emit: selecting unit 3 returns its position even while disabled',
    pos.x === -50 && pos.y === 60 && pos.z === -70
    && emitLightUnitSelectionActive(cfg) === true);
  check('emit: out-of-range selections clamp',
    resolveEmitLightPos({ ...cfg, gpgpuEmitLightUnit: 99 }).x === 0
    && resolveEmitLightUnit({ gpgpuEmitLightUnit: 0 }) === 1);
  check('shadow: extra positions list only enabled extra units',
    resolveShadowExtraLightPositions(D).length === 0
    && resolveShadowExtraLightPositions({ gpgpuLight2Enabled: true, gpgpuLight2PosX: 5 }).length === 1
    && resolveShadowExtraLightPositions({ gpgpuLight2Enabled: true, gpgpuLight2PosX: 5 })[0].x === 5
    && resolveShadowExtraLightPositions({ gpgpuLightEnabled: true }).length === 0);
}

// ── 3. Bake integration ────────────────────────────────────
{
  const TEX = 16;
  const legacyCfg = { gpgpuLightPosX: 4, gpgpuLightPosY: 5, gpgpuLightPosZ: 6, gpgpuEmitLightUnit: 1 };
  const viaResolve = buildGpgpuInitialData(TEX, 10, 'light', 42, 8, null, { lightPos: resolveEmitLightPos(legacyCfg) });
  const manual = buildGpgpuInitialData(TEX, 10, 'light', 42, 8, null, { lightPos: { x: 4, y: 5, z: 6 } });
  check('bake: default resolution is bit-identical to the legacy position',
    arraysEqual([...viaResolve.posData], [...manual.posData])
    && arraysEqual([...viaResolve.velData], [...manual.velData]));
  const unit3Cfg = {
    gpgpuLightPosX: 4, gpgpuLightPosY: 5, gpgpuLightPosZ: 6,
    gpgpuLight3PosX: -40, gpgpuLight3PosY: 0, gpgpuLight3PosZ: 25, gpgpuEmitLightUnit: 3,
  };
  const viaUnit3 = buildGpgpuInitialData(TEX, 10, 'light', 42, 8, null, { lightPos: resolveEmitLightPos(unit3Cfg) });
  const manual3 = buildGpgpuInitialData(TEX, 10, 'light', 42, 8, null, { lightPos: { x: -40, y: 0, z: 25 } });
  check('bake: unit-3 selection bakes around unit 3 and differs from unit 1',
    arraysEqual([...viaUnit3.posData], [...manual3.posData])
    && !arraysEqual([...viaUnit3.posData], [...manual.posData]));
  // The light ball is small (5% of radius): every baked point
  // sits within that ball of the selected unit's position.
  let maxDist = 0;
  for (let i = 0; i < TEX * TEX; i++) {
    const dx = viaUnit3.posData[i * 4] + 40, dy = viaUnit3.posData[i * 4 + 1], dz = viaUnit3.posData[i * 4 + 2] - 25;
    maxDist = Math.max(maxDist, Math.hypot(dx, dy, dz));
  }
  check('bake: unit-3 points stay inside the 5% light ball', maxDist <= 10 * 0.05 + 1e-4, `maxDist=${maxDist}`);
}

// ── 4. Draw variant + string pins ──────────────────────────
{
  check('pin: SIM_POS_FRAG unchanged (pre-E4 hash)',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha256(SIM_POS_FRAG));
  check('pin: SIM_VEL_FRAG unchanged (pre-E4 hash)',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha256(SIM_VEL_FRAG));
  check('pin: stock DRAW_VERT unchanged (pre-E4 hash)',
    sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529', sha256(DRAW_VERT));
  check('pin: stock DRAW_FRAG unchanged (pre-E4 hash)',
    sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c', sha256(DRAW_FRAG));
  check('variant: stock vertex carries no unit 2-4 trace', !DRAW_VERT.includes('uLight2') && !DRAW_VERT.includes('uLight3') && !DRAW_VERT.includes('uLight4'));
  const variant = buildDrawVert({ lightUnits: true });
  check('variant: light-units vertex declares and consumes units 2-4',
    [2, 3, 4].every((n) => variant.includes(`uniform vec3  uLight${n}Pos;`)
      && variant.includes(`if (uLight${n}Enabled)`)
      && variant.includes(`uLight${n}Intensity`)));
  check('variant: units compose after the unit-1 assignment',
    variant.indexOf('vLightMul = uLightEnabled') >= 0
    && variant.indexOf('if (uLight2Enabled)') > variant.indexOf('vLightMul = uLightEnabled'));
  check('glsl: unit segments name only their own unit',
    lightUnitUniformsGlsl(2).includes('uLight2Pos') && !lightUnitUniformsGlsl(2).includes('uLight3')
    && lightUnitComputeGlsl(4).includes('uLight4Radius') && !lightUnitComputeGlsl(4).includes('uLight2'));
}

// ── 5. Shadow connection ───────────────────────────────────
{
  // A minimal shadow config: OBJ sphere occluder only (no
  // terrain), so occlusion is analytic and light-dependent.
  const base = {
    gpgpuMorphTerrainAmplitude: 0, gpgpuMorphTerrainFrequency: 0.05, gpgpuMorphTerrainOctaves: 1,
    gpgpuMorphTerrainSeed: 1, gpgpuMorphTerrainKind: 'perlin', gpgpuMorphTerrainTerraceSteps: 0,
    gpgpuMorphTerrainErosionWater: 0, gpgpuMorphTerrainErosionDroplets: 0, gpgpuMorphTerrainErosionDeposit: 0,
    gpgpuMorphTerrainErosionThermal: 0, gpgpuMorphTerrainErosionTalus: 0, gpgpuMorphTerrainErosionThermalPasses: 0,
    gpgpuMorphTerrainErosionSeed: 1,
    gpgpuMorphTerrainErosionMaskMode: 'off', gpgpuMorphTerrainErosionMaskImageGrid: [],
    gpgpuMorphTerrainErosionMaskDrawnGrid: [], gpgpuMorphTerrainErosionMaskStrength: 0,
    gpgpuMorphTerrainErosionMaskInvert: false, gpgpuMorphTerrainErosionMaskLow: 0, gpgpuMorphTerrainErosionMaskHigh: 1,
    gpgpuTerrainMeshTunnel: false,
    gpgpuSeed: 7, gpgpuMorphScale: 100, gpgpuBounceRadius: 100, gpgpuTerrainMeshScale: 1,
    gpgpuLightPosX: 0, gpgpuLightPosY: 0, gpgpuLightPosZ: 100,
    gpgpuShadowSourceTerrain: false, gpgpuShadowSourceObj: true, gpgpuShadowSoftness: 0,
    gpgpuObjMeshEnabled: true, gpgpuObjMeshScale: 1, gpgpuObjMeshRepeat: 1,
    gpgpuObjMeshPosX: 0, gpgpuObjMeshPosY: 0, gpgpuObjMeshPosZ: 0,
    gpgpuMorphObjSource: '',
  };
  // OBJ source '' never builds a sphere; use a scene built by
  // hand for the analytic part instead.
  const sceneSingle = {
    terrain: { amplitude: 0, frequency: 0.05, octaves: 1, seed: 1, kind: 'perlin', terraceSteps: 0 },
    seed: 7, worldScale: 48,
    lightPos: { x: 0, y: 0, z: 100 },
    sourceTerrain: false, sourceObj: true,
    objSphere: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
    softness: 0, tunnel: false, tunnelRadius: 0, tunnelLength: 0,
  };
  const sceneUndef = { ...sceneSingle };
  const sceneEmpty = { ...sceneSingle, extraLightPosList: [] };
  // Point behind the sphere as seen from light 1 (at +Z): the
  // segment point->light1 passes through the sphere.
  const occSingle = occlusionAtPoint(0, 0, -50, sceneSingle);
  check('shadow: no-extras scene occludes from unit 1', occSingle > 0.5, `occ=${occSingle}`);
  check('shadow: undefined and empty extra lists are identical to single-light',
    occlusionAtPoint(0, 0, -50, sceneUndef) === occSingle
    && occlusionAtPoint(0, 0, -50, sceneEmpty) === occSingle);
  // A point lit from unit 1 (segment misses the sphere) but
  // blocked from an extra light placed on the -Z side.
  const px = 30, py = 0, pz = -50;
  const occLit = occlusionAtPoint(px, py, pz, sceneSingle);
  // The extra light sits beyond the sphere on the ray from
  // the point through the sphere centre, so only its segment
  // is blocked.
  const sceneExtra = { ...sceneSingle, extraLightPosList: [{ x: -30, y: 0, z: 50 }] };
  const occUnion = occlusionAtPoint(px, py, pz, sceneExtra);
  check('shadow: extra light unions — a point blocked only from it darkens',
    occLit === 0 && occUnion > 0.5, `single=${occLit} union=${occUnion}`);
  check('shadow: union never decreases occlusion',
    occlusionAtPoint(0, 0, -50, sceneExtra) >= occSingle);
  // buildShadowScene wiring: enabled units only.
  const wired = buildShadowScene({ ...base, gpgpuLight2Enabled: true, gpgpuLight2PosX: 9, gpgpuLight2PosY: 8, gpgpuLight2PosZ: 7 });
  check('shadow: buildShadowScene passes enabled unit positions',
    Array.isArray(wired.extraLightPosList) && wired.extraLightPosList.length === 1
    && wired.extraLightPosList[0].x === 9 && wired.extraLightPosList[0].y === 8 && wired.extraLightPosList[0].z === 7);
  const unwired = buildShadowScene(base);
  check('shadow: buildShadowScene leaves the field undefined at defaults',
    unwired.extraLightPosList === undefined);
  const bakeA = bakeShadowOcclusionMap(unwired, 16);
  const bakeB = bakeShadowOcclusionMap(buildShadowScene(base), 16);
  check('shadow: default-config bakes are byte-identical',
    arraysEqual([...bakeA.data], [...bakeB.data]));
}

// ── 6. Key registration ────────────────────────────────────
{
  const defaultsSrc = readFileSync(join(ROOT, 'lib/appStateDefaultGpgpu.ts'), 'utf8');
  const typesSrc = readFileSync(join(ROOT, 'types/configGpgpu.ts'), 'utf8');
  let allKeys = true;
  for (const n of [2, 3, 4]) {
    for (const suffix of ['Enabled', 'PosX', 'PosY', 'PosZ', 'Intensity', 'Radius']) {
      const key = `gpgpuLight${n}${suffix}`;
      if (D[key] === undefined || !defaultsSrc.includes(`${key}:`) || !typesSrc.includes(`${key}:`)) allKeys = false;
    }
  }
  check('keys: all 18 unit keys exist in defaults and types at mirror defaults',
    allKeys && D.gpgpuLight2Enabled === false && D.gpgpuLight3Intensity === 1 && D.gpgpuLight4Radius === 3);
  check('keys: gpgpuEmitLightUnit defaults to 1 in defaults and types',
    D.gpgpuEmitLightUnit === 1 && typesSrc.includes('gpgpuEmitLightUnit:'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
