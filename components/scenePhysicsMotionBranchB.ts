export const PHYSICS_MOTION_BRANCH_B = `
    } else if (motionType < 41.5) {
      float sectorCount = 6.0;
      float sectorAngle = 6.28318530718 / sectorCount;
      float angle = atan(p.z, p.x) + time * 0.45;
      float mirrored = abs(mod(angle, sectorAngle) - sectorAngle * 0.5);
      float radius = length(p.xz) + sin(time + phase) * amp * 0.14;
      result.x = cos(mirrored) * radius;
      result.z = sin(mirrored) * radius * sign(cos(angle * sectorCount));
      result.y += noiseField.y * amp * 0.2;
    } else if (motionType < 42.5) {
      float braidPhase = time * 1.25 + p.y * 0.035 + phase;
      result.x = sin(braidPhase) * amp * 0.32 + sin(braidPhase * 2.0) * amp * 0.08;
      result.z = cos(braidPhase) * amp * 0.32 - cos(braidPhase * 2.0) * amp * 0.08;
      result.y = p.y + sin(time * 0.9 + phase) * amp * 0.08;
    } else if (motionType < 43.5) {
      float arc = atan(p.y, length(p.xz) + 0.0001);
      result += vec3(
        cos(arc * 4.0 + time * 1.4),
        sin(arc * 3.0 - time * 1.2),
        sin(arc * 5.0 + time * 0.8)
      ) * amp * 0.22;
    } else if (motionType < 44.5) {
      vec3 spoke = normalize(vec3(sign(p.x + 0.0001), sign(p.y + 0.0001), sign(p.z + 0.0001)));
      result = mix(p, spoke * length(p) * 0.85, 0.24) + noiseField * amp * 0.08;
    } else if (motionType < 45.5) {
      float shellRadius = length(p) + sin(length(p) * 0.05 - time * 2.4 + phase) * amp * 0.22;
      vec3 shellDir = normalize(p + vec3(0.0001));
      result = shellDir * shellRadius + curlField * amp * 0.08;
    } else if (motionType < 46.5) {
      float petals = 8.0;
      float angle = atan(p.z, p.x) + time * 0.38;
      float radius = length(p.xz) + cos(angle * petals) * amp * 0.16;
      result.x = cos(angle) * radius;
      result.z = sin(angle) * radius;
      result.y += sin(angle * petals * 0.5 + time) * amp * 0.18;
    } else if (motionType < 47.5) {
      float ribbonPhase = time * 1.35 + phase + p.y * 0.02;
      result.x = sin(ribbonPhase) * amp * 0.28;
      result.z = cos(ribbonPhase * 0.7) * amp * 0.34;
      result.y = p.y + sin(ribbonPhase * 1.8) * amp * 0.14;
    } else if (motionType < 48.5) {
      result += vec3(
        p.y * 0.08 * amp * 0.1,
        sin(time + phase) * amp * 0.12,
        p.x * 0.08 * amp * 0.1
      ) + noiseField * amp * 0.08;
    } else if (motionType < 49.5) {
      float spokeAngle = atan(p.z, p.x);
      float snapped = round(spokeAngle / 0.52359877559) * 0.52359877559;
      float spokeRadius = length(p.xz) + sin(time * 1.4 + phase) * amp * 0.12;
      result.x = cos(snapped) * spokeRadius;
      result.z = sin(snapped) * spokeRadius;
      result.y += noiseField.y * amp * 0.1;
    } else if (motionType < 50.5) {
      float breathe = 1.0 + sin(time * 1.6 + phase + length(p) * 0.02) * 0.22;
      result = p * breathe + normalize(noiseField + vec3(0.0001)) * amp * 0.12;
    } else if (motionType < 51.5) {
      float knotAngle = atan(p.z, p.x) + time * 0.65;
      float knotRadius = length(p.xz) * 0.55 + amp * 0.12;
      float knotWave = cos(knotAngle * 3.0 - time * 1.1 + phase) * amp * 0.18;
      result.x = cos(knotAngle * 2.0) * (knotRadius + knotWave);
      result.z = sin(knotAngle * 2.0) * (knotRadius - knotWave);
      result.y += sin(knotAngle * 3.0 + time * 1.3) * amp * 0.2;
    } else if (motionType < 52.5) {
      float a = 1.7;
      float b = 1.3;
      float c = 1.1;
      float d = 1.7;
      result.x = sin(a * p.y + c * time + phase) * amp * 0.38;
      result.y = sin(b * p.z + d * time + phase * 0.7) * amp * 0.32;
      result.z = sin(a * p.x - b * time + phase * 1.2) * amp * 0.38;
    } else if (motionType < 53.5) {
      float a = 1.25;
      float b = 0.85;
      float c = 0.2;
      float signX = sign(p.x + 0.0001);
      float rootTerm = sqrt(abs(b * p.x - 1.0 - c));
      result.x = p.y - signX * rootTerm * amp * 0.12;
      result.y = a - p.x;
      result.z += sin(time * 1.1 + phase + p.y * 0.03) * amp * 0.22;
    } else if (motionType < 54.5) {
      vec3 cell = floor((p + noiseField * amp * 0.1) / max(10.0, amp * 0.12));
      vec3 local = fract((p + noiseField * amp * 0.1) / max(10.0, amp * 0.12)) - 0.5;
      result = cell * max(10.0, amp * 0.12) + sign(local) * max(2.0, amp * 0.04);
    } else if (motionType < 55.5) {
      vec3 cycloneAxis = normalize(vec3(0.2, 1.0, 0.15));
      result = rotate(result, cycloneAxis, time * 0.9 + length(p.xz) * 0.002);
      result.y += sin(length(p.xz) * 0.04 - time * 2.0 + phase) * amp * 0.18;
    } else if (motionType < 56.5) {
      float petalAngle = atan(p.z, p.x) + time * 0.5;
      float petalRadius = length(p.xz) + cos(petalAngle * 7.0 + phase) * amp * 0.2;
      result.x = cos(petalAngle) * petalRadius;
      result.z = sin(petalAngle) * petalRadius;
      result.y += sin(petalAngle * 3.5 + time) * amp * 0.16;
    } else if (motionType < 57.5) {
      result.x += sin(p.y * 0.04 + time * 1.4 + phase) * amp * 0.18;
      result.z += cos(p.x * 0.04 - time * 1.2 + phase) * amp * 0.18;
      result.y = sin((p.x + p.z) * 0.03 + time * 1.7) * amp * 0.22 + p.y * 0.45;
    } else if (motionType < 58.5) {
      vec3 flareDir = normalize(p + noiseField * 0.3 + vec3(0.0001));
      float flarePulse = 1.0 + sin(time * 2.1 + phase + length(p) * 0.03) * 0.35;
      result = flareDir * length(p) * flarePulse + curlField * amp * 0.1;
    } else if (motionType < 59.5) {
      float mobiusAngle = atan(p.z, p.x) + time * 0.55;
      float mobiusRadius = length(p.xz) * 0.62 + amp * 0.14;
      float twist = sin(mobiusAngle * 0.5 + time + phase) * amp * 0.18;
      result.x = cos(mobiusAngle) * (mobiusRadius + twist);
      result.z = sin(mobiusAngle) * (mobiusRadius + twist);
      result.y = sin(mobiusAngle * 0.5) * twist * 1.6 + p.y * 0.25;
    } else if (motionType < 60.5) {
      result += vec3(
        sin(time * 1.0 + phase + p.x * 0.03),
        sin(time * 1.7 + phase * 0.6 + p.y * 0.025),
        sin(time * 2.3 + phase * 1.1 + p.z * 0.02)
      ) * amp * 0.22;
    } else if (motionType < 61.5) {
      vec3 starDir = normalize(p + vec3(0.0001));
      float star = abs(cos(atan(p.z, p.x) * 6.0 + time * 0.9 + phase));
      result = starDir * length(p) * (0.75 + star * amp * 0.12) + noiseField * amp * 0.05;
    } else if (motionType < 62.5) {
      result.x += sin(p.z * 0.05 + time * 1.4) * amp * 0.18;
      result.z += cos(p.x * 0.05 - time * 1.4) * amp * 0.18;
      result.y += sin((p.x + p.z) * 0.04 + time * 2.0 + phase) * amp * 0.15;
    } else if (motionType < 63.5) {
      float heliAngle = atan(p.z, p.x) + time * 0.8;
      float heliRadius = length(p.xz) + sin(time * 1.5 + phase) * amp * 0.12;
      result.x = cos(heliAngle) * heliRadius;
      result.z = sin(heliAngle) * heliRadius;
      result.y += cos(heliAngle * 2.0 + time) * amp * 0.24;
    } else if (motionType < 64.5) {
      float zig = sign(sin(p.y * 0.08 + time * 2.0 + phase));
      result.x += zig * amp * 0.18;
      result.z += sign(cos(p.x * 0.08 - time * 1.7 + phase)) * amp * 0.18;
      result.y += noiseField.y * amp * 0.08;
    } else if (motionType < 65.5) {
      float shock = sin(length(p) * 0.06 - time * 3.5 + phase);
      result += normalize(p + vec3(0.0001)) * shock * amp * 0.28;
    } else if (motionType < 66.5) {
      result = mix(p, curlField * amp * 1.8 + noiseField * amp * 0.3, 0.35);
      result.y += sin(time + phase + p.x * 0.03) * amp * 0.12;
    } else if (motionType < 67.5) {
      vec3 mirrored = vec3(abs(p.x), p.y, abs(p.z));
      result = mix(p, mirrored * sign(noiseField + vec3(0.0001)), 0.28) + curlField * amp * 0.06;
    } else if (motionType < 68.5) {
      float stepAngle = atan(p.z, p.x);
      float snapped = floor((stepAngle + 3.14159265359) / 0.39269908169) * 0.39269908169;
      float stepRadius = floor((length(p.xz) + amp * 0.08) / max(6.0, amp * 0.08)) * max(6.0, amp * 0.08);
      result.x = cos(snapped) * stepRadius;
      result.z = sin(snapped) * stepRadius;
      result.y += noiseField.y * amp * 0.06;
    } else if (motionType < 69.5) {
      float coilPhase = time * 1.4 + phase + p.y * 0.03;
      result.x = sin(coilPhase) * amp * 0.24 + p.x * 0.18;
      result.z = cos(coilPhase) * amp * 0.24 + p.z * 0.18;
      result.y = p.y + sin(coilPhase * 2.0) * amp * 0.1;
    } else if (motionType < 70.5) {
      vec3 cell = floor((p + vec3(time * 5.0)) / max(8.0, amp * 0.1));
      vec3 maze = mod(cell, 2.0) * 2.0 - 1.0;
      result = maze * max(12.0, amp * 0.16) + noiseField * amp * 0.06;
    } else if (motionType < 71.5) {
      result = rotate(result, normalize(vec3(1.0, 1.0, 0.4)), time * 0.9 + phase);
      result += vec3(
        sin(time * 1.8 + p.y * 0.03),
        cos(time * 1.4 + p.z * 0.03),
        sin(time * 1.1 + p.x * 0.03)
      ) * amp * 0.14;
    } else if (motionType < 72.5) {
      float echo = sin(length(p.xz) * 0.07 - time * 2.6 + phase);
      result += normalize(vec3(p.x, 0.0, p.z) + vec3(0.0001)) * echo * amp * 0.2;
      result.y += echo * amp * 0.12;
    } else if (motionType < 73.5) {
      float shellPhase = time * 1.25 + phase + p.y * 0.02;
      result.x = sin(shellPhase) * amp * 0.22;
      result.z = cos(shellPhase) * amp * 0.22;
      result.y = sin(shellPhase * 1.8) * amp * 0.12 + cos(length(p.xz) * 0.05) * amp * 0.08;
    } else if (motionType < 74.5) {
      result += vec3(noiseField.z, noiseField.x, noiseField.y) * amp * 0.18;
      result += vec3(-curlField.z, curlField.y, curlField.x) * amp * 0.12;
    } else if (motionType < 75.5) {
      vec3 prismDir = normalize(sign(p + vec3(0.0001)));
      result = mix(p, prismDir * length(p) * 0.82, 0.26);
    } else if (motionType < 76.5) {
      vec3 tile = round((p + noiseField * amp * 0.08) / max(9.0, amp * 0.12));
      result = tile * max(9.0, amp * 0.12) + sign(sin(tile + time)) * amp * 0.04;
    } else if (motionType < 77.5) {
      result.x += sin(p.z * 0.06 + time * 1.5) * amp * 0.14;
      result.z += cos(p.x * 0.06 - time * 1.5) * amp * 0.14;
      result.y += sin(time * 2.4 + phase) * amp * 0.18;
    } else if (motionType < 78.5) {
      result += normalize(vec3(p.x, 0.0, p.z) + vec3(0.0001)) * sin(time * 1.8 + phase) * amp * 0.18;
      result.y += cos(time * 1.2 + length(p.xz) * 0.04) * amp * 0.18;
    } else if (motionType < 79.5) {
      vec3 beaconDir = normalize(p + vec3(0.0001));
      float beaconPulse = abs(sin(time * 2.6 + phase));
      result = beaconDir * length(p) * (0.82 + beaconPulse * amp * 0.1);
    } else if (motionType < 80.5) {
      result.x += sin(p.z * 0.08 + time * 1.9) * amp * 0.16;
      result.z += cos(p.x * 0.08 - time * 1.9) * amp * 0.16;
      result.y += sin((p.x + p.z) * 0.05 + time * 1.4 + phase) * amp * 0.12;
`;
