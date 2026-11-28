// Layer 1 WP6 phase B2 — Pyro grammar extensions (lib/pyroGrid.ts).
// Pins the V4 buoyancy twins, the V5 cooling twins + radiative
// cooling, and the V3 species combustion model. The shipped GLSL
// arithmetic is the reference: every twin must reproduce its form
// at the shipped parameter values, and the species model must
// reduce to the shipped fuel-only reaction when the oxidizer is
// abundant.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp6-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export {
        PYRO_GRID_BUOY_ACCEL, PYRO_GRID_TEMP_COOL_RATE, PYRO_GRID_DENSITY_DECAY_RATE,
        PYRO_GRID_FUEL_REACTION_K, PYRO_GRID_FUEL_HEAT, PYRO_GRID_TEMP_MAX,
        PYRO_GRID_FUEL_IGNITE_LO, PYRO_GRID_FUEL_IGNITE_HI,
        PYRO_GRID_TEMP_AMBIENT, PYRO_GRID_RADIATIVE_COOL_RATE,
        PYRO_GRID_OXIDIZER_AMBIENT, PYRO_GRID_COMBUSTION_STOICH,
        PYRO_GRID_COMBUSTION_PRODUCT_YIELD, PYRO_GRID_COMBUSTION_DEFAULTS,
        pyroGridSmoothstep, pyroGridBuoyancyAccel, pyroGridBuoyancyAccelRelative,
        pyroGridThermalExcess, pyroGridCoolTemperature, pyroGridDecayDensity,
        pyroGridRadiativeCoolTemperature, pyroGridCoolTemperatureCombined,
        pyroGridIgnitionFactor, pyroGridFuelBurn,
        pyroCombustionInitialSpecies, pyroCombustionSpeciesMass, pyroCombustionStep,
      } from './lib/pyroGrid.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  PYRO_GRID_BUOY_ACCEL, PYRO_GRID_TEMP_COOL_RATE, PYRO_GRID_DENSITY_DECAY_RATE,
  PYRO_GRID_FUEL_REACTION_K, PYRO_GRID_FUEL_HEAT, PYRO_GRID_TEMP_MAX,
  PYRO_GRID_FUEL_IGNITE_LO, PYRO_GRID_FUEL_IGNITE_HI,
  PYRO_GRID_TEMP_AMBIENT, PYRO_GRID_RADIATIVE_COOL_RATE,
  PYRO_GRID_OXIDIZER_AMBIENT, PYRO_GRID_COMBUSTION_STOICH,
  PYRO_GRID_COMBUSTION_PRODUCT_YIELD, PYRO_GRID_COMBUSTION_DEFAULTS,
  pyroGridSmoothstep, pyroGridBuoyancyAccel, pyroGridBuoyancyAccelRelative,
  pyroGridThermalExcess, pyroGridCoolTemperature, pyroGridDecayDensity,
  pyroGridRadiativeCoolTemperature, pyroGridCoolTemperatureCombined,
  pyroGridIgnitionFactor, pyroGridFuelBurn,
  pyroCombustionInitialSpecies, pyroCombustionSpeciesMass, pyroCombustionStep,
} = lib;

// --- smoothstep twin -------------------------------------------------------
check('smoothstep: plateaus and midpoint',
  pyroGridSmoothstep(0.15, 0.35, 0.1) === 0
  && pyroGridSmoothstep(0.15, 0.35, 0.4) === 1
  && near(pyroGridSmoothstep(0.15, 0.35, 0.25), 0.5, 1e-12));

// --- V4: buoyancy ------------------------------------------------------------
check('buoyancy: zero at zero temperature and density',
  pyroGridBuoyancyAccel(0, 0, 1) === 0);
check('buoyancy: linear in temperature (cells/s^2)',
  near(pyroGridBuoyancyAccel(1, 0, 1), PYRO_GRID_BUOY_ACCEL, 1e-12)
  && near(pyroGridBuoyancyAccel(0.5, 0, 1), 0.5 * PYRO_GRID_BUOY_ACCEL, 1e-12)
  && near(pyroGridBuoyancyAccel(2, 0, 1), 2 * PYRO_GRID_BUOY_ACCEL, 1e-12));
check('buoyancy: key scales the thermal term',
  near(pyroGridBuoyancyAccel(1, 0, 0.5), 0.5 * PYRO_GRID_BUOY_ACCEL, 1e-12));
check('buoyancy: density weight sinks dense scalar, cancels at parity',
  near(pyroGridBuoyancyAccel(0, 1, 1, 1), -PYRO_GRID_BUOY_ACCEL, 1e-12)
  && near(pyroGridBuoyancyAccel(1, 1, 1, 1), 0, 1e-12)
  && near(pyroGridBuoyancyAccel(1, 0.5, 1, 1), 0.5 * PYRO_GRID_BUOY_ACCEL, 1e-12));
check('buoyancy: shipped density weight 0 ignores density',
  near(pyroGridBuoyancyAccel(1, 5, 1), pyroGridBuoyancyAccel(1, 0, 1), 0));
check('buoyancy: relative form is identical at the shipped ambient 0',
  near(pyroGridBuoyancyAccelRelative(0.7, 0.3, 1.2, PYRO_GRID_TEMP_AMBIENT, 0.4),
    pyroGridBuoyancyAccel(0.7, 0.3, 1.2, 0.4), 0));
check('buoyancy: relative form vanishes at the ambient temperature',
  pyroGridBuoyancyAccelRelative(0.2, 0, 1, 0.2) === 0
  && near(pyroGridThermalExcess(0.9, 0.2), 0.7, 1e-12)
  && pyroGridBuoyancyAccelRelative(0.1, 0, 1, 0.2) < 0);

// --- V5: exponential cooling / decay twins ----------------------------------
check('cooling twin: matches exp(-key * rate * dt)',
  near(pyroGridCoolTemperature(1, 1, 1), Math.exp(-PYRO_GRID_TEMP_COOL_RATE), 1e-12)
  && near(pyroGridCoolTemperature(2, 0.5, 1), 2 * Math.exp(-0.5 * PYRO_GRID_TEMP_COOL_RATE), 1e-12)
  && near(pyroGridCoolTemperature(1, 1, 2), Math.exp(-2 * PYRO_GRID_TEMP_COOL_RATE), 1e-12));
check('cooling twin: key 0 is the identity, curve decays monotonically to 0',
  pyroGridCoolTemperature(1.5, 1, 0) === 1.5
  && (() => {
    let t = 1; let prev = Infinity;
    for (let i = 0; i < 200; i += 1) { t = pyroGridCoolTemperature(t, 0.1, 1); if (!(t < prev && t > 0)) return false; prev = t; }
    return t < 0.02;
  })());
check('density decay twin: matches exp(-rate * dt)',
  near(pyroGridDecayDensity(3, 2), 3 * Math.exp(-2 * PYRO_GRID_DENSITY_DECAY_RATE), 1e-12)
  && pyroGridDecayDensity(0, 5) === 0);

// --- V5: radiative cooling ----------------------------------------------------
check('radiative: closed form at ambient 0',
  near(pyroGridRadiativeCoolTemperature(2, 1, 0.22, 0),
    2 / Math.cbrt(1 + 3 * 0.22 * 8 * 1), 1e-12)
  && near(pyroGridRadiativeCoolTemperature(1, 0.5), 1 / Math.cbrt(1 + 3 * PYRO_GRID_RADIATIVE_COOL_RATE * 0.5), 1e-12));
check('radiative: fractional loss grows with temperature (T^4 shape)',
  (() => {
    const frac = (t) => 1 - pyroGridRadiativeCoolTemperature(t, 0.1, 0.22, 0) / t;
    return frac(2) > frac(1) && frac(1) > frac(0.5) && frac(0.5) > 0;
  })());
check('radiative: rate 0 and dt 0 are identities; at/below ambient unchanged',
  pyroGridRadiativeCoolTemperature(2, 1, 0, 0) === 2
  && pyroGridRadiativeCoolTemperature(2, 0, 0.22, 0) === 2
  && pyroGridRadiativeCoolTemperature(0.2, 1, 0.22, 0.3) === 0.2);
check('radiative: never crosses the ambient floor, converges toward it',
  (() => {
    // One long step: cooled, but the T^4 - A^4 drive vanishes near
    // the floor, so the approach is asymptotic — still above it.
    const t = pyroGridRadiativeCoolTemperature(0.5, 40, 0.22, 0.3);
    if (!(t >= 0.3 && t < 0.5)) return false;
    // Repeated steps converge to the floor without crossing it.
    let u = 0.5;
    for (let i = 0; i < 200; i += 1) u = pyroGridRadiativeCoolTemperature(u, 10, 0.22, 0.3);
    return u >= 0.3 && u < 0.31;
  })());
check('combined: radiative off + ambient 0 reduces exactly to the shipped exponential',
  near(pyroGridCoolTemperatureCombined(1.3, 0.7, { radiativeRate: 0, ambient: 0 }),
    pyroGridCoolTemperature(1.3, 0.7, 1), 0));
check('combined: radiation cools a hot cell faster than the exponential alone',
  pyroGridCoolTemperatureCombined(3, 0.5, {}) < pyroGridCoolTemperature(3, 0.5, 1));

// --- V3: ignition + shipped fuel-only burn twin -------------------------------
check('ignition factor: window plateaus and midpoint',
  pyroGridIgnitionFactor(PYRO_GRID_FUEL_IGNITE_LO - 0.05) === 0
  && pyroGridIgnitionFactor(PYRO_GRID_FUEL_IGNITE_HI + 0.05) === 1
  && near(pyroGridIgnitionFactor((PYRO_GRID_FUEL_IGNITE_LO + PYRO_GRID_FUEL_IGNITE_HI) / 2), 0.5, 1e-12));
check('fuel burn twin: shipped form, bounded by the fuel present',
  near(pyroGridFuelBurn(1, 1, 0.1, 1), PYRO_GRID_FUEL_REACTION_K * 0.1, 1e-12)
  && pyroGridFuelBurn(0.01, 1, 10, 1) === 0.01
  && pyroGridFuelBurn(1, 0.05, 0.1, 1) === 0);
check('fuel burn twin: fuel key 0 burns nothing (shipped construction)',
  pyroGridFuelBurn(1, 1, 0.1, 0) === 0);

// --- V3: species combustion ---------------------------------------------------
check('species defaults: mass closure yield = 1 + stoich',
  PYRO_GRID_COMBUSTION_PRODUCT_YIELD === 1 + PYRO_GRID_COMBUSTION_STOICH
  && PYRO_GRID_COMBUSTION_DEFAULTS.reactionK === PYRO_GRID_FUEL_REACTION_K
  && PYRO_GRID_COMBUSTION_DEFAULTS.fuelHeat === PYRO_GRID_FUEL_HEAT
  && PYRO_GRID_COMBUSTION_DEFAULTS.tempMax === PYRO_GRID_TEMP_MAX);
check('species: initial state carries ambient oxidizer',
  (() => { const s = pyroCombustionInitialSpecies(0.5, 0.3); return s.fuel === 0.5 && s.oxidizer === PYRO_GRID_OXIDIZER_AMBIENT && s.product === 0 && s.temperature === 0.3; })());
check('species: reduces to the shipped fuel-only form when oxidizer is abundant',
  (() => {
    const s0 = { fuel: 1, oxidizer: 100, product: 0, temperature: 1 };
    const s1 = pyroCombustionStep(s0, 0.1);
    const burn = pyroGridFuelBurn(1, 1, 0.1, 1);
    return near(1 - s1.fuel, burn, 1e-12)
      && near(s1.temperature, 1 + burn * PYRO_GRID_FUEL_HEAT, 1e-12)
      && near(s1.product, burn * PYRO_GRID_COMBUSTION_PRODUCT_YIELD, 1e-12)
      && near(s1.oxidizer, 100 - burn * PYRO_GRID_COMBUSTION_STOICH, 1e-12);
  })());
check('species: mass (fuel + oxidizer + product) conserved across a full burn',
  (() => {
    let s = pyroCombustionInitialSpecies(1, 1);
    const m0 = pyroCombustionSpeciesMass(s);
    for (let i = 0; i < 200; i += 1) s = pyroCombustionStep(s, 0.05);
    return near(pyroCombustionSpeciesMass(s), m0, 1e-9) && s.product > 0 && s.fuel < 1;
  })());
check('species: heat released equals burn * fuelHeat below the cap',
  (() => {
    const s0 = { fuel: 0.5, oxidizer: 10, product: 0, temperature: 0.5 };
    const s1 = pyroCombustionStep(s0, 0.05);
    const burn = 0.5 - s1.fuel;
    return burn > 0 && near(s1.temperature - 0.5, burn * PYRO_GRID_FUEL_HEAT, 1e-12);
  })());
check('species: fuel exhaustion stops the reaction',
  (() => {
    const s0 = { fuel: 0, oxidizer: 1, product: 0.2, temperature: 1 };
    const s1 = pyroCombustionStep(s0, 0.1);
    return s1.fuel === 0 && s1.product === 0.2 && s1.temperature === 1 && s1.oxidizer === 1;
  })());
check('species: oxidizer exhaustion caps the burn, then the reaction stops',
  (() => {
    const s0 = { fuel: 1, oxidizer: 0.1, product: 0, temperature: 1 };
    const s1 = pyroCombustionStep(s0, 10);
    const burn1 = 1 - s1.fuel;
    const s2 = pyroCombustionStep(s1, 10);
    return near(burn1, 0.1 / PYRO_GRID_COMBUSTION_STOICH, 1e-12)
      && near(s1.oxidizer, 0, 1e-12)
      && s1.fuel > 0 && s2.fuel === s1.fuel && s2.temperature === s1.temperature;
  })());
check('species: below the ignition window nothing burns',
  (() => {
    const s1 = pyroCombustionStep(pyroCombustionInitialSpecies(1, 0.05), 0.5);
    return s1.fuel === 1 && s1.product === 0 && s1.temperature === 0.05;
  })());
check('species: fuel key 0 burns nothing even with fuel, oxidizer and heat',
  (() => {
    const s1 = pyroCombustionStep(pyroCombustionInitialSpecies(1, 1), 0.5,
      { ...PYRO_GRID_COMBUSTION_DEFAULTS, fuelRate: 0 });
    return s1.fuel === 1 && s1.product === 0;
  })());
check('species: temperature never exceeds the cap',
  (() => {
    let s = { fuel: 50, oxidizer: 50, product: 0, temperature: PYRO_GRID_TEMP_MAX - 0.01 };
    for (let i = 0; i < 50; i += 1) { s = pyroCombustionStep(s, 0.1); if (s.temperature > PYRO_GRID_TEMP_MAX) return false; }
    return s.temperature === PYRO_GRID_TEMP_MAX;
  })());
check('species: oxidizer replenishment relaxes toward ambient, none by default',
  (() => {
    const dry = { fuel: 0, oxidizer: 0, product: 0, temperature: 0 };
    const still = pyroCombustionStep(dry, 1);
    const fed = pyroCombustionStep(dry, 1, { ...PYRO_GRID_COMBUSTION_DEFAULTS, oxidizerReplenish: 0.5 });
    return still.oxidizer === 0 && near(fed.oxidizer, 0.5 * PYRO_GRID_OXIDIZER_AMBIENT, 1e-12);
  })());

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
