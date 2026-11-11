export const PHYSICS_MOTION_BRANCH_A = `
    if (motionType < 0.5) {
      result += noiseField * amp * 0.35;
    } else if (motionType < 1.5) {
      result += vec3(noiseField.x, abs(noiseField.y), noiseField.z) * amp * 0.45;
    } else if (motionType < 2.5) {
      result += curlField * amp * max(0.2, fluidForce);
    } else if (motionType < 3.5) {
      result += wind * time * 0.02 + curlField * amp * 0.25;
    } else if (motionType < 4.5) {
      result.y -= abs(sin(time + phase)) * amp * 0.4;
    } else if (motionType < 5.5) {
      result += normalize(p + vec3(0.0001)) * amp * sin(time + phase * 1.7);
    } else if (motionType < 6.5) {
      result += vec3(cos(time + phase), sin(time * 0.8 + phase), cos(time * 0.6 + phase * 0.5)) * amp * 0.3;
    } else if (motionType < 7.5) {
      result += noiseField * amp * attractorScale * 0.2;
    } else if (motionType < 8.5) {
      result += normalize(noiseField + p * 0.2) * amp * 0.22;
    } else if (motionType < 9.5) {
      result += normalize(-p + noiseField * 0.5) * amp * 0.26;
    } else if (motionType < 10.5) {
      result = rotate(result, vec3(0.0, 1.0, 0.0), time * 0.7 + phase) + noiseField * amp * 0.15;
    } else if (motionType < 11.5) {
      result.y += sin((p.x + p.z) * freq + time + phase) * amp * 0.35;
    } else if (motionType < 12.5) {
      result += curlField * amp * 0.45;
    } else if (motionType < 13.5) {
      result += noiseField * amp * 0.4;
    } else if (motionType < 14.5) {
      result += vec3(sin(time + p.y), cos(time + p.z), sin(time + p.x)) * amp * 0.22;
    } else if (motionType < 15.5) {
      result += vec3(
        10.0 * (p.y - p.x),
        p.x * (28.0 - p.z) - p.y,
        p.x * p.y - (8.0 / 3.0) * p.z
      ) * amp * 0.002;
    } else if (motionType < 16.5) {
      result += vec3(
        (p.z - 0.7) * p.x - 3.5 * p.y,
        3.5 * p.x + (p.z - 0.7) * p.y,
        0.6 + 0.95 * p.z - (pow(p.z, 3.0) / 3.0) - (p.x * p.x + p.y * p.y) * (1.0 + 0.25 * p.z) + 0.1 * p.z * pow(p.x, 3.0)
      ) * amp * 0.002;
    } else if (motionType < 17.5) {
      result += vec3(-p.y - p.z, p.x + 0.2 * p.y, 0.2 + p.z * (p.x - 5.7)) * amp * 0.003;
    } else if (motionType < 18.5) {
      result += vec3(sin(p.y) - 0.2 * p.x, sin(p.z) - 0.2 * p.y, sin(p.x) - 0.2 * p.z) * amp * 0.3;
    } else if (motionType < 19.5) {
      result += normalize(-p) * amp * 0.2 + noiseField * viscosity * 0.15;
    } else if (motionType < 20.5) {
      result = rotate(result, vec3(0.0, 1.0, 0.0), amp * 0.015 + time * 0.5);
    } else if (motionType < 21.5) {
      result += (wind + curlField * fluidForce) * amp * 0.08;
    } else if (motionType < 22.5) {
      result += noiseField * amp * 0.12 + wind * 0.05;
    } else if (motionType < 23.5) {
      result = rotate(result, vec3(0.0, 1.0, 0.0), time * 0.35) + normalize(result + vec3(0.0001)) * amp * 0.15;
    } else if (motionType < 24.5) {
      float spiralAngle = atan(p.z, p.x) + time * 0.75;
      float spiralRadius = length(p.xz) + sin(time + p.y) * amp * 0.12;
      result.x = cos(spiralAngle) * spiralRadius;
      result.z = sin(spiralAngle) * spiralRadius;
    } else if (motionType < 25.5) {
      result = rotate(result, normalize(vec3(1.0, 1.0, 0.0)), time * 0.55 + phase);
    } else if (motionType < 26.5) {
      result += normalize(noiseField + vec3(0.0001)) * amp * 0.18;
    } else if (motionType < 27.5) {
      result += noiseField * noiseField * sign(noiseField) * amp * 0.3;
    } else if (motionType < 28.5) {
      result += hash3(rnd * 97.0 + floor(time * 18.0)) * amp * 0.25 - amp * 0.125;
    } else if (motionType < 29.5) {
      float angle = atan(p.z, p.x) + time * 0.4;
      float radius = length(p.xz) + sin(time + phase) * amp * 0.12;
      result.x = cos(angle * 1.618) * radius;
      result.z = sin(angle * 1.618) * radius;
    } else if (motionType < 30.5) {
      float rose = cos(5.0 * atan(p.z, p.x) + time) * amp * 0.18;
      result += normalize(p + vec3(0.0001)) * rose;
    } else if (motionType < 31.5) {
      float ridge = abs(fbm(fieldPos * 1.6, octaves, lacunarity) * 2.0 - 1.0);
      result += normalize(noiseField + curlField) * ridge * amp * 0.32;
    } else if (motionType < 32.5) {
      result.x = sin(time * 1.7 + phase + p.y * 0.02) * amp * 0.55 + p.x * 0.35;
      result.y = sin(time * 2.3 + phase * 1.3 + p.z * 0.02) * amp * 0.45 + p.y * 0.2;
      result.z = sin(time * 2.9 + phase * 0.7 + p.x * 0.02) * amp * 0.55 + p.z * 0.35;
    } else if (motionType < 33.5) {
      float torusAngle = atan(p.z, p.x) + time * 0.55;
      float torusMinor = sin(time * 1.4 + phase + p.y * 0.03) * amp * 0.18;
      float torusMajor = max(10.0, length(p.xz) + amp * 0.12);
      result.x = cos(torusAngle) * (torusMajor + cos(time + phase) * torusMinor);
      result.z = sin(torusAngle) * (torusMajor + sin(time + phase) * torusMinor);
      result.y += sin(torusAngle * 2.0 + time * 1.2) * amp * 0.22;
    } else if (motionType < 34.5) {
      result.x += sin(time * 1.5 + phase) * amp * 0.3;
      result.y += cos(time * 2.1 + phase + p.x * 0.015) * amp * 0.42;
      result.z += sin(time * 1.1 + phase * 0.6) * amp * 0.18;
    } else if (motionType < 35.5) {
      vec3 latticeCell = round((p + noiseField * amp * 0.08) / max(6.0, amp * 0.14));
      vec3 latticeTarget = latticeCell * max(6.0, amp * 0.14);
      result = mix(p, latticeTarget, 0.28) + curlField * amp * 0.08;
    } else if (motionType < 36.5) {
      float baseAngle = atan(p.z, p.x);
      float majorRadius = length(p.xz) * 0.75 + amp * 0.22;
      float minorRadius = amp * 0.18 + 8.0;
      float epicycleAngle = time * 1.4 + phase * 1.7;
      result.x = cos(baseAngle + time * 0.55) * majorRadius + cos(epicycleAngle) * minorRadius;
      result.z = sin(baseAngle + time * 0.55) * majorRadius + sin(epicycleAngle) * minorRadius;
      result.y += sin(time * 1.9 + phase + baseAngle * 2.0) * amp * 0.2;
    } else if (motionType < 37.5) {
      vec3 gyre = vec3(-p.z, sin(time + phase) * 0.5, p.x);
      result += normalize(gyre + curlField * 0.6 + vec3(0.0001)) * amp * 0.28;
      result += noiseField * amp * 0.1;
    } else if (motionType < 38.5) {
      vec3 crystalDir = sign(p + noiseField * 0.25 + vec3(0.0001));
      vec3 crystalTarget = crystalDir * length(p) * 0.78;
      result = mix(p, crystalTarget, 0.24) + noiseField * amp * 0.06;
    } else if (motionType < 39.5) {
      float ring = sin(length(p.xz) * max(0.02, freq * 0.08) - time * 3.2 + phase);
      result += normalize(vec3(p.x, 0.0, p.z) + vec3(0.0001)) * ring * amp * 0.26;
      result.y += cos(length(p.xz) * 0.04 - time * 2.2 + phase) * amp * 0.18;
    } else if (motionType < 40.5) {
      vec3 folded = vec3(
        abs(sin(p.x * 0.025 + time + phase)),
        abs(sin(p.y * 0.03 + time * 1.3 + phase)),
        abs(sin(p.z * 0.025 + time * 0.8 + phase))
      ) * amp * 0.55;
      result = mix(p, (folded - amp * 0.275) * sign(noiseField + vec3(0.0001)), 0.32);
`;
