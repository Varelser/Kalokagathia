// Layer 1 WP6 phase B1 — FLIP grammar extension: the transfer
// scheme declaration (PIC / FLIP / APIC), the APIC transfer
// twins, the F11 collision-condition grammar and the surface-
// tension authoring surface, all in lib/flip3d.ts.
// Grammar surface only: no key is registered by this phase
// (the config fingerprint is pinned unchanged below) and no
// pass consumes the scheme yet — what is pinned here is the
// declaration resolution, the transfer arithmetic (mirroring
// the velocity tail's shipped PIC/FLIP blend), APIC's exact
// reproduction of affine fields (the property PIC lacks),
// the collision family's semantics, and the twin<->GLSL
// correspondence of the CSF tension force (uSigma is the
// gpgpuFlipSurfaceTension key verbatim).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
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
      export { flip3dIndex, flip3dPhiFromChi, flip3dCurvatureAt,
        FLIP3D_TRANSFER_SCHEMES, resolveFlip3dTransferScheme,
        flip3dP2GTransfer, flip3dGridVelocityFromTransfer, flip3dG2PTransfer,
        FLIP3D_BOUNDARY_CONDITIONS, FLIP3D_DEFAULT_COLLISION_SPEC,
        resolveFlip3dCollisionSpec, flip3dCollideVelocity,
        flip3dSurfaceTensionSigma, flip3dSurfaceTensionDelta } from './lib/flip3d.ts';
      export { FLIP3D_TENSION_FRAG } from './components/gpgpuShaderSimulationFlip3d.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  flip3dIndex, flip3dPhiFromChi, flip3dCurvatureAt,
  FLIP3D_TRANSFER_SCHEMES, resolveFlip3dTransferScheme,
  flip3dP2GTransfer, flip3dGridVelocityFromTransfer, flip3dG2PTransfer,
  FLIP3D_BOUNDARY_CONDITIONS, FLIP3D_DEFAULT_COLLISION_SPEC,
  resolveFlip3dCollisionSpec, flip3dCollideVelocity,
  flip3dSurfaceTensionSigma, flip3dSurfaceTensionDelta,
  FLIP3D_TENSION_FRAG, APP_STATE_DEFAULT_GPGPU,
} = lib;

// Rigid rotation about the z axis through (3.5, 3.5, 3.5):
// v = (-(y - cy), (x - cx), 0), an affine field whose gradient
// is the constant skew matrix AFF — the representative case
// where APIC and PIC part ways.
const C = { x: 3.5, y: 3.5 };
const rotField = (x, y) => ({ x: -(y - C.y), y: x - C.x, z: 0 });
const AFF = [0, -1, 0, 1, 0, 0, 0, 0, 0];
const makeParticles = (list) => {
  const pos = new Float32Array(list.length * 3);
  const vel = new Float32Array(list.length * 3);
  const affine = new Float32Array(list.length * 9);
  list.forEach((p, i) => {
    pos.set(p, i * 3);
    const v = rotField(p[0], p[1]);
    vel.set([v.x, v.y, v.z], i * 3);
    affine.set(AFF, i * 9);
  });
  return { pos, vel, affine };
};

// --- scheme declaration ------------------------------------------------
{
  check('scheme vocabulary is exactly pic / flip / apic',
    JSON.stringify(FLIP3D_TRANSFER_SCHEMES) === '["pic","flip","apic"]');
  check('literal scheme names resolve to themselves',
    resolveFlip3dTransferScheme('pic') === 'pic'
    && resolveFlip3dTransferScheme('flip') === 'flip'
    && resolveFlip3dTransferScheme('apic') === 'apic');
  check("legacy numeric strength / missing / garbage resolve to 'flip' (the shipped family)",
    resolveFlip3dTransferScheme(1.0) === 'flip'
    && resolveFlip3dTransferScheme(0) === 'flip'
    && resolveFlip3dTransferScheme(undefined) === 'flip'
    && resolveFlip3dTransferScheme('bogus') === 'flip');
  check('no new key: the flip defaults are the pre-WP6 set',
    APP_STATE_DEFAULT_GPGPU.gpgpuFlipTransfer === 1.0
    && APP_STATE_DEFAULT_GPGPU.gpgpuFlipBlend === 0.95
    && !('gpgpuFlipTransferScheme' in APP_STATE_DEFAULT_GPGPU)
    && !('gpgpuFlipCollision' in APP_STATE_DEFAULT_GPGPU));
}

// --- P2G: APIC deposits the affine field exactly, PIC cannot -----------
{
  const n = 8;
  const scattered = [[1.3, 2.6, 4.1], [5.8, 1.9, 3.3], [3.9, 5.4, 2.2], [2.4, 4.8, 5.6], [6.1, 6.2, 1.4], [4.4, 0.8, 6.3]];
  const parts = makeParticles(scattered);
  const nodeError = (scheme) => {
    const { momentum, weights } = flip3dP2GTransfer(parts, n, scheme);
    const grid = flip3dGridVelocityFromTransfer(momentum, weights);
    let maxErr = 0;
    let covered = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const idx = flip3dIndex(n, x, y, z);
      if (weights[idx] <= 1e-6) continue;
      covered += 1;
      const fv = rotField(x, y);
      maxErr = Math.max(maxErr,
        Math.abs(grid[idx * 3] - fv.x), Math.abs(grid[idx * 3 + 1] - fv.y), Math.abs(grid[idx * 3 + 2] - fv.z));
    }
    return { maxErr, covered };
  };
  const apic = nodeError('apic');
  const pic = nodeError('pic');
  check('P2G covers the union of the particle stencils', apic.covered === 48 && pic.covered === 48,
    `apic=${apic.covered} pic=${pic.covered}`);
  check('P2G apic: grid velocity equals the affine field at every covered node (float32 eps)',
    apic.maxErr < 1e-5, `maxErr=${apic.maxErr.toExponential(3)}`);
  check('P2G pic: the same deposit loses the sub-cell structure (error orders larger)',
    pic.maxErr > 0.1, `maxErr=${pic.maxErr.toExponential(3)}`);
  // A particle exactly on a node deposits onto that node alone.
  const onNode = makeParticles([[4, 4, 4]]);
  const dep = flip3dP2GTransfer(onNode, n, 'pic');
  const idx = flip3dIndex(n, 4, 4, 4);
  check('node-aligned particle deposits its full weight on the single node',
    dep.weights[idx] === 1 && dep.momentum[idx * 3 + 1] === onNode.vel[1],
    `w=${dep.weights[idx]}`);
  // Composite floor: weight at/below 1e-6 reads as air (0).
  const tiny = flip3dGridVelocityFromTransfer(new Float32Array([3, 0, 0]), new Float32Array([1e-7]));
  check('composite: sub-floor weight is air (velocity 0)', tiny[0] === 0);
}

// --- G2P: affine reproduction and the round trip ------------------------
{
  const n = 8;
  const scattered = [[1.3, 2.6, 4.1], [5.8, 1.9, 3.3], [3.9, 5.4, 2.2], [2.4, 4.8, 5.6], [6.1, 6.2, 1.4], [4.4, 0.8, 6.3]];
  const parts = makeParticles(scattered);
  const grid = new Float32Array(n * n * n * 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const idx = flip3dIndex(n, x, y, z);
    const fv = rotField(x, y);
    grid.set([fv.x, fv.y, fv.z], idx * 3);
  }
  const outApic = flip3dG2PTransfer(grid, grid, parts, n, 'apic', 0.95, 1);
  let mv = 0;
  let ma = 0;
  scattered.forEach((p, i) => {
    const fv = rotField(p[0], p[1]);
    mv = Math.max(mv, Math.abs(outApic.vel[i * 3] - fv.x), Math.abs(outApic.vel[i * 3 + 1] - fv.y), Math.abs(outApic.vel[i * 3 + 2] - fv.z));
    for (let k = 0; k < 9; k++) ma = Math.max(ma, Math.abs(outApic.affine[i * 9 + k] - AFF[k]));
  });
  check('G2P apic reproduces the affine field values at the particles', mv < 1e-5, `maxErr=${mv.toExponential(3)}`);
  check('G2P apic reproduces the velocity gradient as the affine matrix', ma < 1e-9, `maxErr=${ma.toExponential(3)}`);
  const outPic = flip3dG2PTransfer(grid, grid, parts, n, 'pic', 0.95, 1);
  let mp = 0;
  scattered.forEach((p, i) => {
    const fv = rotField(p[0], p[1]);
    mp = Math.max(mp, Math.abs(outPic.vel[i * 3] - fv.x), Math.abs(outPic.vel[i * 3 + 1] - fv.y));
  });
  check('G2P pic reproduces the values too (linear reproduction) but returns zero affine',
    mp < 1e-5 && outPic.affine.every((v) => v === 0), `maxErr=${mp.toExponential(3)}`);

  // Round trip P2G -> (identity grid step) -> G2P on a rotating
  // ring: APIC conserves the total angular momentum, PIC
  // dissipates it — the classic transfer distinction.
  const ring = [];
  for (let k = 0; k < 10; k++) {
    const th = (k / 10) * Math.PI * 2;
    ring.push([C.x + 2.2 * Math.cos(th) + 0.13, C.y + 2.2 * Math.sin(th) - 0.07, 3.5 + 0.11]);
  }
  const rp = makeParticles(ring);
  const angMom = (vel) => {
    let L = 0;
    for (let i = 0; i < ring.length; i++) {
      L += (ring[i][0] - C.x) * vel[i * 3 + 1] - (ring[i][1] - C.y) * vel[i * 3];
    }
    return L;
  };
  const L0 = angMom(rp.vel);
  const roundTrip = (scheme) => {
    const { momentum, weights } = flip3dP2GTransfer(rp, n, scheme);
    const g = flip3dGridVelocityFromTransfer(momentum, weights);
    return flip3dG2PTransfer(g, g, rp, n, scheme, 0.95, 1);
  };
  const rtApic = roundTrip('apic');
  const rtPic = roundTrip('pic');
  check('round trip apic conserves angular momentum (float32 eps)',
    Math.abs(angMom(rtApic.vel) / L0 - 1) < 1e-5, `ratio=${(angMom(rtApic.vel) / L0).toFixed(8)}`);
  check('round trip pic dissipates angular momentum (>1% lost in one transfer pair)',
    angMom(rtPic.vel) / L0 < 0.99, `ratio=${(angMom(rtPic.vel) / L0).toFixed(6)}`);
}

// --- G2P blend semantics: the tail's arithmetic verbatim ----------------
{
  const n = 6;
  const total = n * n * n;
  const one = makeParticles([[2.3, 3.6, 1.45]]);
  one.vel.set([0.4, -0.2, 0.1]);
  const constGrid = (vx, vy, vz) => {
    const g = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) g.set([vx, vy, vz], i * 3);
    return g;
  };
  const zeros = new Float32Array(total * 3);
  const gridNew = constGrid(1, 2, 3);
  // FLIP with blend 1 takes the particle velocity + grid change.
  const f1 = flip3dG2PTransfer(gridNew, zeros, one, n, 'flip', 1, 1);
  check('flip blend 1: vel + gathered grid change',
    near(f1.vel[0], 1.4, 1e-6) && near(f1.vel[1], 1.8, 1e-6) && near(f1.vel[2], 3.1, 1e-6),
    `${f1.vel[0]},${f1.vel[1]},${f1.vel[2]}`);
  // Blend 0 is PIC: the grid velocity itself.
  const f0 = flip3dG2PTransfer(gridNew, zeros, one, n, 'flip', 0, 1);
  check('flip blend 0 = pic: the gathered grid velocity',
    near(f0.vel[0], 1, 1e-6) && near(f0.vel[1], 2, 1e-6) && near(f0.vel[2], 3, 1e-6));
  // The pic scheme ignores the blend entirely.
  const p1 = flip3dG2PTransfer(gridNew, zeros, one, n, 'pic', 1, 1);
  check('pic scheme ignores blend (still the grid velocity)',
    near(p1.vel[0], 1, 1e-6) && near(p1.vel[1], 2, 1e-6) && near(p1.vel[2], 3, 1e-6));
  // Transfer strength mixes toward the target (uFlipTransfer).
  const half = flip3dG2PTransfer(gridNew, zeros, one, n, 'flip', 0, 0.5);
  check('strength 0.5 mixes halfway to the target',
    near(half.vel[0], 0.7, 1e-6) && near(half.vel[1], 0.9, 1e-6) && near(half.vel[2], 1.55, 1e-6),
    `${half.vel[0]},${half.vel[1]},${half.vel[2]}`);
  const none = flip3dG2PTransfer(gridNew, zeros, one, n, 'flip', 1, 0);
  check('strength 0 leaves the particle velocity verbatim',
    none.vel[0] === one.vel[0] && none.vel[1] === one.vel[1] && none.vel[2] === one.vel[2]);
  // APIC on a constant field: PIC-form velocity, zero gradient.
  const a1 = flip3dG2PTransfer(gridNew, zeros, one, n, 'apic', 1, 1);
  check('apic on a constant field: grid velocity and zero affine',
    near(a1.vel[0], 1, 1e-6) && a1.affine.every((v) => Math.abs(v) < 1e-9));
  // A particle outside the domain is left untouched (domain fade).
  const outside = makeParticles([[-3, 20, 0.5]]);
  outside.vel.set([7, 8, 9]);
  const o1 = flip3dG2PTransfer(gridNew, zeros, outside, n, 'flip', 1, 1);
  check('out-of-domain particle is left untouched',
    o1.vel[0] === 7 && o1.vel[1] === 8 && o1.vel[2] === 9);
}

// --- collision grammar (F11) ---------------------------------------------
{
  check('boundary vocabulary is exactly free-slip / no-slip / viscous-slip',
    JSON.stringify(FLIP3D_BOUNDARY_CONDITIONS) === '["free-slip","no-slip","viscous-slip"]');
  check("default spec is free-slip with friction 0 (the solver's implicit condition)",
    FLIP3D_DEFAULT_COLLISION_SPEC.boundary === 'free-slip' && FLIP3D_DEFAULT_COLLISION_SPEC.slipFriction === 0);
  check('resolution: bare name, object form, fallbacks',
    resolveFlip3dCollisionSpec('no-slip').boundary === 'no-slip'
    && resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: 0.3 }).slipFriction === 0.3
    && resolveFlip3dCollisionSpec({ boundary: 'bogus' }).boundary === 'free-slip'
    && resolveFlip3dCollisionSpec('bogus').boundary === 'free-slip'
    && resolveFlip3dCollisionSpec(null).boundary === 'free-slip'
    && resolveFlip3dCollisionSpec(undefined).boundary === 'free-slip');
  check('resolution: friction clamped to [0, 1], non-finite falls to 0',
    resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: 2 }).slipFriction === 1
    && resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: -1 }).slipFriction === 0
    && resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: NaN }).slipFriction === 0);

  const up = { x: 0, y: 1, z: 0 };
  const hit = { x: 1, y: -2, z: 0.5 };
  const free = flip3dCollideVelocity(hit, up, resolveFlip3dCollisionSpec('free-slip'));
  check('free-slip removes the normal component, keeps the tangential whole',
    free.x === 1 && free.y === 0 && free.z === 0.5, JSON.stringify(free));
  const no = flip3dCollideVelocity(hit, up, resolveFlip3dCollisionSpec('no-slip'));
  check('no-slip stops the particle at the surface', no.x === 0 && no.y === 0 && no.z === 0);
  const visc = flip3dCollideVelocity(hit, up, resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: 0.5 }));
  check('viscous-slip scales the tangential remainder by (1 - friction)',
    visc.x === 0.5 && visc.y === 0 && visc.z === 0.25, JSON.stringify(visc));
  const visc0 = flip3dCollideVelocity(hit, up, resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: 0 }));
  const visc1 = flip3dCollideVelocity(hit, up, resolveFlip3dCollisionSpec({ boundary: 'viscous-slip', slipFriction: 1 }));
  check('viscous-slip endpoints coincide with free-slip (0) and no-slip (1)',
    visc0.x === free.x && visc0.z === free.z && visc1.x === 0 && visc1.y === 0 && visc1.z === 0);
  const away = { x: 0.25, y: 1, z: -0.5 };
  check('separating velocity is untouched under every condition',
    ['free-slip', 'no-slip', 'viscous-slip'].every((b) => {
      const r = flip3dCollideVelocity(away, up, resolveFlip3dCollisionSpec(b));
      return r.x === away.x && r.y === away.y && r.z === away.z;
    }));
  const scaled = flip3dCollideVelocity(hit, { x: 0, y: 5, z: 0 }, resolveFlip3dCollisionSpec('free-slip'));
  check('non-unit normal is normalised (same result as the unit normal)',
    scaled.x === free.x && scaled.y === free.y && scaled.z === free.z);
  const noNormal = flip3dCollideVelocity(hit, { x: 0, y: 0, z: 0 }, resolveFlip3dCollisionSpec('no-slip'));
  check('zero normal means no surface: velocity passes verbatim',
    noNormal.x === hit.x && noNormal.y === hit.y && noNormal.z === hit.z);
  // Oblique normal: v = (-3, -1, 0) against n = (1, 1, 0)/sqrt(2)
  // has tangential remainder (-1, 1, 0) under free slip.
  const obl = flip3dCollideVelocity({ x: -3, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, resolveFlip3dCollisionSpec('free-slip'));
  check('oblique free-slip keeps exactly the tangential remainder',
    near(obl.x, -1, 1e-12) && near(obl.y, 1, 1e-12) && obl.z === 0, JSON.stringify(obl));
}

// --- surface tension authoring surface ------------------------------------
{
  check("sigma resolution is the pass runner's rule (key verbatim, floored at 0)",
    flip3dSurfaceTensionSigma({ gpgpuFlipSurfaceTension: 1.5 }) === 1.5
    && flip3dSurfaceTensionSigma({ gpgpuFlipSurfaceTension: -2 }) === 0
    && flip3dSurfaceTensionSigma({}) === 0
    && flip3dSurfaceTensionSigma({ gpgpuFlipSurfaceTension: 0 }) === 0);
  check('tension key defaults to 0 (the passes do not exist)',
    APP_STATE_DEFAULT_GPGPU.gpgpuFlipSurfaceTension === 0);
  check('GLSL correspondence: the tension pass adds dt * sigma * kappa * grad(chi)',
    FLIP3D_TENSION_FRAG.includes('vel += uDelta * uSigma * kappa * gradChi;'));
  const passesSrc = readFileSync(join(ROOT, 'components', 'gpgpuFlip3dPasses.ts'), 'utf8');
  check('GLSL correspondence: uSigma is fed from the key with the floored rule',
    passesSrc.includes('Math.max(0, config.gpgpuFlipSurfaceTension || 0)')
    && passesSrc.includes('mat.uniforms.uSigma.value = tension'));

  const n = 16;
  const total = n * n * n;
  const centre = (n - 1) / 2;
  const radius = 5;
  const sphereChi = (sign) => {
    const chi = new Float32Array(total);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dist = Math.hypot(x - centre, y - centre, z - centre);
      chi[flip3dIndex(n, x, y, z)] = Math.max(0, Math.min(1, 0.5 + sign * (radius - dist) / 2));
    }
    return chi;
  };
  const chi = sphereChi(1);
  const phi = flip3dPhiFromChi(chi);
  const sx = Math.round(centre + radius);
  const sy = Math.round(centre);
  const sigma = 2;
  const dt = 0.25;
  const d = flip3dSurfaceTensionDelta(phi, chi, n, sx, sy, sy, sigma, dt);
  check('drop surface: the CSF delta points inward (-x at the +x surface)',
    d.x < 0, `dx=${d.x.toFixed(4)}`);
  // Self-consistency: the twin is dt * sigma * kappa * grad(chi)
  // with kappa from flip3dCurvatureAt — recomputed here from
  // the same primitives the GLSL pass consumes.
  const kappa = flip3dCurvatureAt(phi, n, sx, sy, sy);
  const gx = (chi[flip3dIndex(n, sx + 1, sy, sy)] - chi[flip3dIndex(n, sx - 1, sy, sy)]) * 0.5;
  const gy = (chi[flip3dIndex(n, sx, sy + 1, sy)] - chi[flip3dIndex(n, sx, sy - 1, sy)]) * 0.5;
  const gz = (chi[flip3dIndex(n, sx, sy, sy + 1)] - chi[flip3dIndex(n, sx, sy, sy - 1)]) * 0.5;
  check('delta equals dt * sigma * kappa * grad(chi) componentwise',
    near(d.x, dt * sigma * kappa * gx, 1e-12) && near(d.y, dt * sigma * kappa * gy, 1e-12) && near(d.z, dt * sigma * kappa * gz, 1e-12),
    `kappa=${kappa.toFixed(4)}`);
  check('sigma 0 or dt 0 gives exactly zero delta',
    flip3dSurfaceTensionDelta(phi, chi, n, sx, sy, sy, 0, dt).x === 0
    && flip3dSurfaceTensionDelta(phi, chi, n, sx, sy, sy, sigma, 0).x === 0);
  const corner = flip3dSurfaceTensionDelta(phi, chi, n, 0, 0, 0, sigma, dt);
  check('air corner (chi <= 0.001) is outside the force: zero delta',
    corner.x === 0 && corner.y === 0 && corner.z === 0);
  const deep = flip3dSurfaceTensionDelta(phi, chi, n, 8, 8, 8, sigma, dt);
  check('deep interior (grad chi ~ 0) gets ~zero delta',
    Math.abs(deep.x) < 1e-9 && Math.abs(deep.y) < 1e-9 && Math.abs(deep.z) < 1e-9,
    JSON.stringify(deep));
  // The bubble field is the drop field relabelled (chi ->
  // 1 - chi, phi -> -phi): kappa and grad(chi) both flip
  // sign, so their product — the CSF force — is invariant.
  // Physically both deltas point -x at the +x surface: the
  // drop contracts and the pocket fills, each shrinking its
  // own interface.
  const chiBubble = sphereChi(-1);
  const phiBubble = flip3dPhiFromChi(chiBubble);
  const db = flip3dSurfaceTensionDelta(phiBubble, chiBubble, n, sx, sy, sy, sigma, dt);
  check('bubble (chi relabelled): the CSF delta is invariant and still points -x',
    db.x < 0 && near(db.x, d.x, 1e-6) && near(db.y, d.y, 1e-6) && near(db.z, d.z, 1e-6),
    `dx=${db.x.toFixed(4)} vs drop ${d.x.toFixed(4)}`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
