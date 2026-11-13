import * as THREE from 'three';
import { MOTION_MAP } from './sceneMotionMap';
import { tempDir, tempNoise } from './sceneMotionEstimatorShared';

export function applySpecificMotionEstimate(
  target: THREE.Vector3,
  source: THREE.Vector3,
  motionType: number,
  timePhase: number,
  amp: number,
  freq: number,
  phase: number,
  rnd: number,
  variant: number,
) {
  if (motionType === MOTION_MAP.orbit) {
    const radial = Math.max(1, Math.hypot(source.x, source.z));
    const angle = Math.atan2(source.z, source.x) + timePhase * 0.35;
    target.set(
      Math.cos(angle) * radial,
      source.y,
      Math.sin(angle) * radial,
    );
    return true;
  }
  if (motionType === MOTION_MAP.spiral_motion) {
    const spiralAngle = Math.atan2(source.z, source.x) + timePhase * 0.75;
    const spiralRadius = Math.max(1, Math.hypot(source.x, source.z)) + Math.sin(timePhase + source.y * 0.02) * amp * 0.12;
    target.set(
      Math.cos(spiralAngle) * spiralRadius,
      source.y,
      Math.sin(spiralAngle) * spiralRadius,
    );
    return true;
  }
  if (motionType === MOTION_MAP.helix) {
    target.copy(source).applyAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), timePhase * 0.55 + phase);
    return true;
  }
  if (motionType === MOTION_MAP.lorenz) {
    const x = source.x * 0.01;
    const y = source.y * 0.01;
    const z = source.z * 0.01;
    target.set(
      source.x + 10 * (y - x) * amp * 0.002,
      source.y + (x * (28 - z) - y) * amp * 0.002,
      source.z + (x * y - (8 / 3) * z) * amp * 0.002,
    );
    return true;
  }
  if (motionType === MOTION_MAP.aizawa) {
    const x = source.x * 0.01;
    const y = source.y * 0.01;
    const z = source.z * 0.01;
    target.set(
      source.x + (((z - 0.7) * x - 3.5 * y) * amp * 0.002),
      source.y + ((3.5 * x + (z - 0.7) * y) * amp * 0.002),
      source.z + ((0.6 + 0.95 * z - (Math.pow(z, 3) / 3) - (x * x + y * y) * (1 + 0.25 * z)) * amp * 0.002),
    );
    return true;
  }
  if (motionType === MOTION_MAP.rossler) {
    const x = source.x * 0.01;
    const y = source.y * 0.01;
    const z = source.z * 0.01;
    target.set(
      source.x + (-y - z) * amp * 0.003,
      source.y + (x + 0.2 * y) * amp * 0.003,
      source.z + (0.2 + z * (x - 5.7)) * amp * 0.003,
    );
    return true;
  }
  if (motionType === MOTION_MAP.thomas) {
    target.set(
      source.x + (Math.sin(source.y * 0.01) - 0.2 * source.x * 0.01) * amp * 0.3,
      source.y + (Math.sin(source.z * 0.01) - 0.2 * source.y * 0.01) * amp * 0.3,
      source.z + (Math.sin(source.x * 0.01) - 0.2 * source.z * 0.01) * amp * 0.3,
    );
    return true;
  }
  if (motionType === MOTION_MAP.lissajous) {
    target.set(
      Math.sin(timePhase * 1.7 + phase + source.y * 0.02) * amp * 0.55 + source.x * 0.35,
      Math.sin(timePhase * 2.3 + phase * 1.3 + source.z * 0.02) * amp * 0.45 + source.y * 0.2,
      Math.sin(timePhase * 2.9 + phase * 0.7 + source.x * 0.02) * amp * 0.55 + source.z * 0.35,
    );
    return true;
  }
  if (motionType === MOTION_MAP.toroidal) {
    const torusAngle = Math.atan2(source.z, source.x) + timePhase * 0.55;
    const torusMinor = Math.sin(timePhase * 1.4 + phase + source.y * 0.03) * amp * 0.18;
    const torusMajor = Math.max(10, Math.hypot(source.x, source.z) + amp * 0.12);
    target.set(
      Math.cos(torusAngle) * (torusMajor + Math.cos(timePhase + phase) * torusMinor),
      source.y + Math.sin(torusAngle * 2 + timePhase * 1.2) * amp * 0.22,
      Math.sin(torusAngle) * (torusMajor + Math.sin(timePhase + phase) * torusMinor),
    );
    return true;
  }
  if (motionType === MOTION_MAP.pendulum) {
    target.set(
      source.x + Math.sin(timePhase * 1.5 + phase) * amp * 0.3,
      source.y + Math.cos(timePhase * 2.1 + phase + source.x * 0.015) * amp * 0.42,
      source.z + Math.sin(timePhase * 1.1 + phase * 0.6) * amp * 0.18,
    );
    return true;
  }
  if (motionType === MOTION_MAP.lattice) {
    const cell = Math.max(6, amp * 0.14);
    target.set(
      Math.round(source.x / cell) * cell,
      Math.round(source.y / cell) * cell,
      Math.round(source.z / cell) * cell,
    ).lerp(source, 0.72);
    return true;
  }
  if (motionType === MOTION_MAP.epicycle) {
    const baseAngle = Math.atan2(source.z, source.x);
    const majorRadius = Math.hypot(source.x, source.z) * 0.75 + amp * 0.22;
    const minorRadius = amp * 0.18 + 8;
    const epicycleAngle = timePhase * 1.4 + phase * 1.7;
    target.set(
      Math.cos(baseAngle + timePhase * 0.55) * majorRadius + Math.cos(epicycleAngle) * minorRadius,
      source.y + Math.sin(timePhase * 1.9 + phase + baseAngle * 2) * amp * 0.2,
      Math.sin(baseAngle + timePhase * 0.55) * majorRadius + Math.sin(epicycleAngle) * minorRadius,
    );
    return true;
  }
  if (motionType === MOTION_MAP.ripple_ring) {
    const radial = Math.hypot(source.x, source.z);
    const ring = Math.sin(radial * Math.max(0.02, freq * 0.08) - timePhase * 3.2 + phase);
    target.copy(source);
    tempDir.set(source.x, 0, source.z).normalize();
    target.addScaledVector(tempDir, ring * amp * 0.26);
    target.y += Math.cos(radial * 0.04 - timePhase * 2.2 + phase) * amp * 0.18;
    return true;
  }
  if (motionType === MOTION_MAP.kaleidoscope) {
    const sectorCount = 6;
    const sectorAngle = (Math.PI * 2) / sectorCount;
    const angle = Math.atan2(source.z, source.x) + timePhase * 0.45;
    const mirrored = Math.abs(((angle % sectorAngle) + sectorAngle) % sectorAngle - sectorAngle * 0.5);
    const radius = Math.hypot(source.x, source.z) + Math.sin(timePhase + phase) * amp * 0.14;
    target.set(
      Math.cos(mirrored) * radius,
      source.y,
      Math.sin(mirrored) * radius * Math.sign(Math.cos(angle * sectorCount) || 1),
    );
    return true;
  }
  if (motionType === MOTION_MAP.braid) {
    const braidPhase = timePhase * 1.25 + source.y * 0.035 + phase;
    target.set(
      Math.sin(braidPhase) * amp * 0.32 + Math.sin(braidPhase * 2) * amp * 0.08,
      source.y + Math.sin(timePhase * 0.9 + phase) * amp * 0.08,
      Math.cos(braidPhase) * amp * 0.32 - Math.cos(braidPhase * 2) * amp * 0.08,
    );
    return true;
  }
  if (motionType === MOTION_MAP.web) {
    target.copy(source);
    tempDir.set(Math.sign(source.x || 1), Math.sign(source.y || 1), Math.sign(source.z || 1)).normalize();
    target.lerp(tempDir.multiplyScalar(source.length() * 0.85), 0.24);
    return true;
  }
  if (motionType === MOTION_MAP.pulse_shell) {
    const shellRadius = source.length() + Math.sin(source.length() * 0.05 - timePhase * 2.4 + phase) * amp * 0.22;
    target.copy(source).normalize().multiplyScalar(shellRadius);
    return true;
  }
  if (motionType === MOTION_MAP.mandala) {
    const angle = Math.atan2(source.z, source.x) + timePhase * 0.38;
    const radius = Math.hypot(source.x, source.z) + Math.cos(angle * 8) * amp * 0.16;
    target.set(
      Math.cos(angle) * radius,
      source.y + Math.sin(angle * 4 + timePhase) * amp * 0.18,
      Math.sin(angle) * radius,
    );
    return true;
  }
  if (motionType === MOTION_MAP.ribbon) {
    const ribbonPhase = timePhase * 1.35 + phase + source.y * 0.02;
    target.set(
      Math.sin(ribbonPhase) * amp * 0.28,
      source.y + Math.sin(ribbonPhase * 1.8) * amp * 0.14,
      Math.cos(ribbonPhase * 0.7) * amp * 0.34,
    );
    return true;
  }
  if (motionType === MOTION_MAP.spokes) {
    const spokeAngle = Math.atan2(source.z, source.x);
    const snapped = Math.round(spokeAngle / 0.52359877559) * 0.52359877559;
    const spokeRadius = Math.hypot(source.x, source.z) + Math.sin(timePhase * 1.4 + phase) * amp * 0.12;
    target.set(
      Math.cos(snapped) * spokeRadius,
      source.y,
      Math.sin(snapped) * spokeRadius,
    );
    return true;
  }
  if (motionType === MOTION_MAP.breathing) {
    const breathe = 1 + Math.sin(timePhase * 1.6 + phase + source.length() * 0.02) * 0.22;
    target.copy(source).multiplyScalar(breathe);
    return true;
  }
  if (motionType === MOTION_MAP.torus_knot) {
    const knotAngle = Math.atan2(source.z, source.x) + timePhase * 0.65;
    const knotRadius = Math.hypot(source.x, source.z) * 0.55 + amp * 0.12;
    const knotWave = Math.cos(knotAngle * 3 - timePhase * 1.1 + phase) * amp * 0.18;
    target.set(
      Math.cos(knotAngle * 2) * (knotRadius + knotWave),
      source.y + Math.sin(knotAngle * 3 + timePhase * 1.3) * amp * 0.2,
      Math.sin(knotAngle * 2) * (knotRadius - knotWave),
    );
    return true;
  }
  if (motionType === MOTION_MAP.cellular) {
    const cell = Math.max(10, amp * 0.12);
    const x = (source.x) / cell;
    const y = (source.y) / cell;
    const z = (source.z) / cell;
    target.set(
      Math.floor(x) * cell + Math.sign((x % 1) - 0.5 || 1) * Math.max(2, amp * 0.04),
      Math.floor(y) * cell + Math.sign((y % 1) - 0.5 || 1) * Math.max(2, amp * 0.04),
      Math.floor(z) * cell + Math.sign((z % 1) - 0.5 || 1) * Math.max(2, amp * 0.04),
    );
    return true;
  }
  if (motionType === MOTION_MAP.cyclone) {
    target.copy(source).applyAxisAngle(new THREE.Vector3(0.2, 1, 0.15).normalize(), timePhase * 0.9 + Math.hypot(source.x, source.z) * 0.002);
    target.y += Math.sin(Math.hypot(source.x, source.z) * 0.04 - timePhase * 2 + phase) * amp * 0.18;
    return true;
  }
  if (motionType === MOTION_MAP.nebula) {
    target.copy(source);
    tempNoise.set(
      Math.sin(timePhase * 0.8 + phase + source.z * 0.01),
      Math.cos(timePhase * 0.6 + rnd * 5 + source.x * 0.01),
      Math.sin(timePhase * 1.1 + variant * 7 + source.y * 0.01),
    );
    target.addScaledVector(tempNoise, amp * 0.24);
    return true;
  }
  if (motionType === MOTION_MAP.monolith) {
    const cell = Math.max(14, amp * 0.18);
    target.set(
      Math.round(source.x / cell) * cell,
      Math.round(source.y / (cell * 1.6)) * (cell * 1.6),
      Math.round(source.z / cell) * cell,
    ).lerp(source, 0.35);
    return true;
  }

  if (motionType === MOTION_MAP.halvorsen) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      source.x + (-1.4 * x - 4 * y - 4 * z - y * y) * amp * 0.002,
      source.y + (-1.4 * y - 4 * z - 4 * x - z * z) * amp * 0.002,
      source.z + (-1.4 * z - 4 * x - 4 * y - x * x) * amp * 0.002,
    );
    return true;
  }
  if (motionType === MOTION_MAP.chen) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      source.x + 35 * (y - x) * amp * 0.002,
      source.y + (-7 * x - x * z + 28 * y) * amp * 0.002,
      source.z + (x * y - 3 * z) * amp * 0.002,
    );
    return true;
  }
  if (motionType === MOTION_MAP.chua) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    const fx = -0.714 * x - 0.2145 * (Math.abs(x + 1) - Math.abs(x - 1));
    target.set(
      source.x + 15.6 * (y - x - fx) * amp * 0.002,
      source.y + (x - y + z) * amp * 0.002,
      source.z + (-28 * y) * amp * 0.002,
    );
    return true;
  }
  if (motionType === MOTION_MAP.lu) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      source.x + 36 * (y - x) * amp * 0.002,
      source.y + (-x * z + 20 * y) * amp * 0.002,
      source.z + (x * y - 3 * z) * amp * 0.002,
    );
    return true;
  }
  if (motionType === MOTION_MAP.sprott) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      source.x + (y + z) * amp * 0.003,
      source.y + (-x + 0.5 * y) * amp * 0.003,
      source.z + (x * x - z) * amp * 0.003,
    );
    return true;
  }
  if (motionType === MOTION_MAP.rabinovich) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      source.x + (y * (z - 1 + x * x) + 0.1 * x) * amp * 0.3,
      source.y + (x * (3 * z + 1 - x * x) + 0.1 * y) * amp * 0.3,
      source.z + (-2 * z * (0.14 + x * y)) * amp * 0.3,
    );
    return true;
  }
  if (motionType === MOTION_MAP.dejong) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    target.set(
      (Math.sin(1.4 * y) - Math.cos(-2.3 * x)) * 100,
      (Math.sin(2.4 * x) - Math.cos(-2.1 * y)) * 100,
      (Math.sin(1.7 * z) - Math.cos(2.0 * x)) * 100,
    ).lerp(source, 1 - Math.min(0.85, Math.max(0, amp * 0.1)));
    return true;
  }
  if (motionType === MOTION_MAP.ikeda) {
    const x = source.x * 0.01; const y = source.y * 0.01; const z = source.z * 0.01;
    const tt = 0.4 - 6 / (1 + x * x + y * y);
    const ct = Math.cos(tt); const st = Math.sin(tt);
    target.set(
      (1 + 0.918 * (x * ct - y * st)) * 100,
      (0.918 * (x * st + y * ct)) * 100,
      (z * 0.3 + 0.4 * Math.sin(x + y)) * 100,
    ).lerp(source, 1 - Math.min(0.85, Math.max(0, amp * 0.1)));
    return true;
  }
  if (motionType === MOTION_MAP.quasicrystal) {
    const wfreq = Math.max(0.02, freq * 0.06);
    const wph = timePhase * 0.35 + phase;
    let gx = 0; let gy = 0;
    for (let i = 0; i < 5; i++) {
      const a = i * 0.62832;
      const kx = Math.cos(a); const ky = Math.sin(a);
      const sn = Math.sin((kx * source.x + ky * source.y) * wfreq + wph);
      gx += kx * sn; gy += ky * sn;
    }
    target.set(
      source.x + gx * amp * 0.4,
      source.y + gy * amp * 0.4,
      source.z + Math.sin((0.8 * source.x + 0.6 * source.y) * wfreq + wph) * amp * 0.22,
    );
    return true;
  }
  if (motionType === MOTION_MAP.hopf) {
    const len = Math.max(0.001, source.length());
    const nx = source.x / len; const ny = source.y / len; const nz = source.z / len;
    const hu = Math.sqrt(Math.min(1, Math.max(0, (1 + nz) * 0.5)));
    const hv = Math.sqrt(Math.min(1, Math.max(0, (1 - nz) * 0.5)));
    const hb = Math.atan2(ny, nx);
    const hs = phase + rnd * 6.2831 + timePhase * 0.25;
    const z1x = hu * Math.cos(hs); const z1y = hu * Math.sin(hs);
    const z2x = hv * Math.cos(hs + hb); const z2y = hv * Math.sin(hs + hb);
    const den = Math.max(0.3, 1 + z2y);
    target.set((z1x / den) * len, (z2x / den) * len, (z1y / den) * len)
      .lerp(source, 1 - Math.min(0.8, Math.max(0, amp * 0.12)));
    return true;
  }

  return false;
}
