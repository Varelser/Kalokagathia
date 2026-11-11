export const PHYSICS_MOTION_BRANCH_C = `
    } else if (motionType < 81.5) {
      float pinwheelAngle = atan(p.z, p.x) + time * 1.1;
      float pinwheelRadius = length(p.xz) + sin(pinwheelAngle * 4.0 + phase) * amp * 0.15;
      result.x = cos(pinwheelAngle) * pinwheelRadius;
      result.z = sin(pinwheelAngle) * pinwheelRadius;
      result.y += cos(pinwheelAngle * 2.0 + time) * amp * 0.18;
    } else if (motionType < 82.5) {
      result = mix(p, curlField * amp * 1.6 + noiseField * amp * 0.6, 0.32);
      result.y += sin(time * 0.9 + phase + length(p) * 0.025) * amp * 0.18;
    } else if (motionType < 83.5) {
      float frond = sin(p.y * 0.06 + time * 1.5 + phase);
      result.x += frond * amp * 0.18 + sin(p.y * 0.03 + time) * amp * 0.08;
      result.z += cos(p.y * 0.05 - time * 1.2 + phase) * amp * 0.18;
      result.y += noiseField.y * amp * 0.06;
    } else if (motionType < 84.5) {
      float flowerAngle = atan(p.z, p.x) + time * 0.65;
      float flowerRadius = length(p.xz) + cos(flowerAngle * 9.0 + phase) * amp * 0.16;
      result.x = cos(flowerAngle) * flowerRadius;
      result.z = sin(flowerAngle) * flowerRadius;
      result.y += sin(flowerAngle * 4.5 + time * 1.2) * amp * 0.14;
    } else if (motionType < 85.5) {
      vec3 block = vec3(round(p.x / 14.0), round(p.y / 24.0), round(p.z / 14.0));
      result = vec3(block.x * 14.0, block.y * 24.0, block.z * 14.0) + noiseField * amp * 0.05;
    } else if (motionType < 86.5) {
      vec3 glyph = abs(fract((p + time * 2.0) * 0.06) - 0.5);
      result = sign(p + vec3(0.0001)) * vec3(
        step(glyph.x, 0.18),
        step(glyph.y, 0.24),
        step(glyph.z, 0.18)
      ) * length(p) * 0.55;
    } else if (motionType < 87.5) {
      float spread = abs(sin(time * 1.7 + phase)) * amp * 0.22;
      result.x += sign(p.x + 0.0001) * spread;
      result.z += sign(p.z + 0.0001) * spread * 0.75;
      result.y += sin(time * 1.2 + p.x * 0.03) * amp * 0.1;
    } else if (motionType < 88.5) {
      vec3 eddy = vec3(-p.z, sin(length(p.xz) * 0.04 + time), p.x);
      result += normalize(eddy + noiseField * 0.3 + vec3(0.0001)) * amp * 0.22;
      result += curlField * amp * 0.08;
    } else if (motionType < 102.5) {
      vec3 novaDir = normalize(p + vec3(0.0001));
      float novaPulse = 0.7 + abs(sin(time * 3.0 + phase)) * 0.5;
      result = novaDir * length(p) * novaPulse + noiseField * amp * 0.08;
    } else if (motionType < 103.5) {
      float swarmAngle = atan(p.z, p.x) + time * 0.9 + sin(p.y * 0.04 + phase) * 0.35;
      float swarmRadius = length(p.xz) * (0.72 + sin(time * 1.7 + phase) * 0.08);
      result.x = cos(swarmAngle) * swarmRadius + noiseField.x * amp * 0.1;
      result.z = sin(swarmAngle) * swarmRadius + noiseField.z * amp * 0.1;
      result.y += sin(time * 1.5 + length(p.xz) * 0.03 + phase) * amp * 0.18;
    } else if (motionType < 104.5) {
      float braidAngle = atan(p.z, p.x) + p.y * 0.03 + time * 1.35;
      float braidRadius = 18.0 + sin(p.y * 0.1 + time * 1.8 + phase) * amp * 0.18;
      result.x = cos(braidAngle) * braidRadius;
      result.z = sin(braidAngle) * braidRadius;
      result.y += sin(braidAngle * 2.0 + time * 0.8) * amp * 0.2 + curlField.y * amp * 0.05;
    } else if (motionType < 105.5) {
      float breath = 0.7 + sin(time * 1.4 + phase) * 0.28;
      result *= breath;
      result += normalize(p + vec3(0.0001)) * sin(time * 2.6 + phase) * amp * 0.08;
      result.y += cos(time * 1.1 + length(p) * 0.03) * amp * 0.12;
    } else if (motionType < 106.5) {
      float fracture = step(0.58, fract(sin(dot(floor(p * 0.08), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
      vec3 shardDir = normalize(vec3(sign(p.x + 0.0001), noiseField.y * 0.35, sign(p.z + 0.0001)) + vec3(0.0001));
      result = mix(p * 0.82, p + shardDir * amp * 0.34, fracture);
      result += noiseField * amp * 0.06;
    } else if (motionType < 107.5) {
      vec3 creepDir = normalize(vec3(noiseField.x, noiseField.y * 0.2, noiseField.z) + vec3(0.0001));
      result += creepDir * amp * 0.16;
      result.y -= abs(sin(time * 1.3 + phase)) * amp * 0.06;
      result += vec3(sin(p.z * 0.03 + time), 0.0, cos(p.x * 0.03 - time)) * amp * 0.08;
    } else if (motionType < 108.5) {
      float interference = sin(p.x * 0.05 + time * 1.7) + cos(p.z * 0.05 - time * 1.3 + phase);
      result.y += interference * amp * 0.18;
      result.x += sin(p.y * 0.04 + time * 1.1) * amp * 0.08;
      result.z += cos(p.y * 0.04 - time * 1.1) * amp * 0.08;
    } else if (motionType < 109.5) {
      vec3 driftDir = normalize(curlField + noiseField * 0.4 + vec3(0.0001));
      float flockPulse = 0.55 + abs(sin(time * 1.6 + phase)) * 0.35;
      result += driftDir * amp * 0.18 * flockPulse;
      result += vec3(-p.z, 0.0, p.x) * 0.0009 * amp;
    } else if (motionType < 110.5) {
      float sheetAngle = atan(p.z, p.x) + time * 0.9;
      float sheetRadius = length(p.xz) + sin(p.y * 0.06 + phase + time) * amp * 0.12;
      result.x = cos(sheetAngle) * sheetRadius;
      result.z = sin(sheetAngle) * sheetRadius;
      result.y += sin(sheetAngle * 3.0 + time * 1.2) * amp * 0.18;
    } else if (motionType < 111.5) {
      float branchMask = step(0.0, sin(p.y * 0.08 + phase));
      result.x += branchMask * sin(p.y * 0.05 + time * 1.4) * amp * 0.16;
      result.z += (1.0 - branchMask) * cos(p.y * 0.05 - time * 1.4) * amp * 0.16;
      result.y += abs(sin(time * 1.1 + phase)) * amp * 0.14;
    } else if (motionType < 112.5) {
      vec3 seepDir = normalize(vec3(noiseField.x, -abs(noiseField.y) - 0.2, noiseField.z) + vec3(0.0001));
      float crack = step(0.62, fract(sin(dot(floor(p.xz * 0.1), vec2(12.9898,78.233))) * 43758.5453));
      result += seepDir * amp * mix(0.08, 0.28, crack);
      result.x += sign(p.x + 0.0001) * crack * amp * 0.12;
      result.z += sign(p.z + 0.0001) * crack * amp * 0.12;
    } else if (motionType < 113.5) {
      float standing = sin(p.x * 0.06 + time * 1.5) * cos(p.z * 0.06 - time * 1.5 + phase);
      result.y += standing * amp * 0.22;
      result.x += cos(p.y * 0.03 + time) * amp * 0.07;
      result.z += sin(p.y * 0.03 - time) * amp * 0.07;
    } else if (motionType < 114.5) {
      vec3 grid = round(p / vec3(12.0, 12.0, 12.0)) * vec3(12.0, 12.0, 12.0);
      result = mix(p, grid, 0.35);
      result += vec3(sin(time * 3.0 + grid.x * 0.03), cos(time * 2.2 + grid.y * 0.03), sin(time * 2.8 + grid.z * 0.03)) * amp * 0.1;
    } else if (motionType < 115.5) {
      vec3 bloomDir = normalize(p + noiseField * 0.5 + vec3(0.0001));
      float torrent = 0.4 + abs(sin(time * 2.1 + phase)) * 0.6;
      result += bloomDir * amp * 0.22 * torrent;
      result.y += abs(sin(time * 1.8 + length(p.xz) * 0.04)) * amp * 0.1;
    } else if (motionType < 116.5) {
      float orbitAngle = atan(p.z, p.x) + time * 1.25;
      float fractureRadius = length(p.xz) + step(0.55, fract(sin(dot(floor(p.xz * 0.12), vec2(31.2, 14.7))) * 43758.5453)) * amp * 0.2;
      result.x = cos(orbitAngle) * fractureRadius;
      result.z = sin(orbitAngle) * fractureRadius;
      result.y += sign(sin(orbitAngle * 6.0 + time)) * amp * 0.12;
    } else if (motionType < 117.5) {
      vec3 foam = vec3(sin(p.z * 0.09 + time * 1.6), cos(p.x * 0.08 - time * 1.4), sin(time * 2.3 + phase));
      result += foam * amp * 0.14;
      result += noiseField * amp * 0.08;
    } else if (motionType < 118.5) {
      float braid = sin(p.y * 0.07 + time * 1.6 + phase);
      result.x += braid * amp * 0.2 + sin(time * 2.0 + p.z * 0.04) * amp * 0.08;
      result.z += cos(p.y * 0.07 - time * 1.5 + phase) * amp * 0.2;
      result.y += sin((p.x + p.z) * 0.03 + time * 1.1) * amp * 0.08;
    } else if (motionType < 119.5) {
      float resonance = sin(p.x * 0.05 + time * 2.6 + phase) * cos(p.z * 0.05 - time * 2.1);
      result.y += resonance * amp * 0.24;
      result.x += sin(p.y * 0.06 + time * 1.3) * amp * 0.09;
      result.z += cos(p.y * 0.06 - time * 1.3) * amp * 0.09;
    } else if (motionType < 120.5) {
      float angle = atan(p.z, p.x) + time * 0.42;
      float lock = sin(angle * 2.0 + phase) * 0.5 + 0.5;
      float radius = length(p.xz) + lock * amp * 0.12;
      result.x = cos(angle) * radius;
      result.z = sin(angle) * radius;
      result.y += sin(time + angle + phase) * amp * 0.12;
    } else if (motionType < 121.5) {
      vec3 bloom = normalize(p + noiseField * 0.4 + vec3(0.0001));
      float fracture = step(0.58, fract(sin(dot(floor(p.xz * 0.14), vec2(18.4, 91.7))) * 43758.5453));
      result += bloom * amp * mix(0.08, 0.3, fracture);
      result += vec3(sign(p.x + 0.0001), 0.0, sign(p.z + 0.0001)) * fracture * amp * 0.1;
    } else if (motionType < 122.5) {
      vec3 ember = vec3(sin(time * 1.7 + p.y * 0.04), abs(cos(time * 1.1 + phase)), cos(time * 1.3 + p.x * 0.03));
      result += ember * amp * 0.14;
      result.y += abs(sin(time * 1.4 + length(p.xz) * 0.03)) * amp * 0.08;
    } else if (motionType < 123.5) {
      vec3 cell = round(p / vec3(10.0, 10.0, 10.0)) * vec3(10.0, 10.0, 10.0);
      float surge = sin(time * 2.4 + dot(cell, vec3(0.02, 0.03, 0.04))) * 0.5 + 0.5;
      result = mix(p, cell, 0.3 + surge * 0.15);
      result += noiseField * amp * 0.06;
    } else if (motionType < 124.5) {
      float weave = sin(p.y * 0.08 + time * 1.9 + phase);
      result.x += weave * amp * 0.18;
      result.z += cos(p.y * 0.08 - time * 1.7 + phase) * amp * 0.18;
      result.y += sin((p.x - p.z) * 0.035 + time) * amp * 0.1;
    } else if (motionType < 149.5) {
      vec3 fallback = normalize(curlField + noiseField + vec3(0.0001));
      result += fallback * amp * 0.16;
    } else if (motionType < 150.5) {
      result += vec3(
        -1.4 * p.x - 4.0 * p.y - 4.0 * p.z - p.y * p.y,
        -1.4 * p.y - 4.0 * p.z - 4.0 * p.x - p.z * p.z,
        -1.4 * p.z - 4.0 * p.x - 4.0 * p.y - p.x * p.x
      ) * amp * 0.002;
    } else if (motionType < 151.5) {
      result += vec3(35.0 * (p.y - p.x), -7.0 * p.x - p.x * p.z + 28.0 * p.y, p.x * p.y - 3.0 * p.z) * amp * 0.002;
    } else if (motionType < 152.5) {
      result += vec3(36.0 * (p.y - p.x), -p.x * p.z + 20.0 * p.y, p.x * p.y - 3.0 * p.z) * amp * 0.002;
    } else if (motionType < 153.5) {
      result += vec3(p.y + p.z, -p.x + 0.5 * p.y, p.x * p.x - p.z) * amp * 0.003;
    } else if (motionType < 154.5) {
      vec3 q = p * 0.01;
      result += vec3(
        q.y * (q.z - 1.0 + q.x * q.x) + 0.1 * q.x,
        q.x * (3.0 * q.z + 1.0 - q.x * q.x) + 0.1 * q.y,
        -2.0 * q.z * (0.14 + q.x * q.y)
      ) * amp * 30.0;
    } else if (motionType < 155.5) {
      vec3 q = p * 0.01;
      vec3 mapped = vec3(
        sin(1.4 * q.y) - cos(-2.3 * q.x),
        sin(2.4 * q.x) - cos(-2.1 * q.y),
        sin(1.7 * q.z) - cos(2.0 * q.x)
      ) * 100.0;
      result = mix(p, mapped, clamp(amp * 0.1, 0.0, 0.85));
    } else if (motionType < 156.5) {
      vec3 q = p * 0.01;
      float r2 = dot(q.xy, q.xy);
      float tt = 0.4 - 6.0 / (1.0 + r2);
      float ct = cos(tt); float st = sin(tt);
      vec3 mapped = vec3(
        1.0 + 0.918 * (q.x * ct - q.y * st),
        0.918 * (q.x * st + q.y * ct),
        q.z * 0.3 + 0.4 * sin(q.x + q.y)
      ) * 100.0;
      result = mix(p, mapped, clamp(amp * 0.1, 0.0, 0.85));
    } else if (motionType < 157.5) {
      vec2 grad = vec2(0.0);
      float wfreq = max(0.02, freq * 0.06);
      float wph = time * 0.35 + phase;
      for (int i = 0; i < 5; i++) {
        float a = float(i) * 0.62832;
        vec2 k = vec2(cos(a), sin(a));
        grad += k * sin(dot(k, p.xy) * wfreq + wph);
      }
      result.xy += grad * amp * 0.4;
      result.z += sin(dot(vec2(0.8, 0.6), p.xy) * wfreq + wph) * amp * 0.22;
    } else if (motionType < 158.5) {
      vec3 n = normalize(p + vec3(0.0001));
      float hu = sqrt(clamp((1.0 + n.z) * 0.5, 0.0, 1.0));
      float hv = sqrt(clamp((1.0 - n.z) * 0.5, 0.0, 1.0));
      float hb = atan(n.y, n.x);
      float hs = phase + rnd * 6.2831 + time * 0.25;
      vec2 z1 = hu * vec2(cos(hs), sin(hs));
      vec2 z2 = hv * vec2(cos(hs + hb), sin(hs + hb));
      vec3 proj = vec3(z1.x, z2.x, z1.y) / max(0.3, 1.0 + z2.y);
      result = mix(p, proj * length(p), clamp(amp * 0.12, 0.0, 0.8));
    } else {
      vec3 fallback = normalize(curlField + noiseField + vec3(0.0001));
      result += fallback * amp * 0.16;
    }
`;
