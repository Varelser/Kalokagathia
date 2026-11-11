export const VERTEX_SHADER = `
  varying vec2 vUv;
  varying float vSlice;
  void main() {
    vUv = uv;
    vSlice = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDensity;
  uniform float uScale;
  uniform float uDrift;
  uniform float uAudio;
  uniform float uSliceIndex;
  uniform float uSliceCount;
  uniform float uMaterialStyle;
  uniform float uGlow;
  uniform float uAnisotropy;
  uniform float uStreak;
  uniform float uGrain;
  uniform float uSwirl;
  uniform float uVerticalBias;
  uniform float uCoreTightness;
  uniform float uPulseNoise;
  uniform float uEmber;
  uniform float uPlumeAmount;
  uniform float uFallAmount;
  uniform float uMirageAmount;
  uniform float uStaticAmount;
  uniform float uDustAmount;
  uniform float uSootAmount;
  uniform float uRuneAmount;
  uniform float uVelvetAmount;
  uniform float uLedgerAmount;
  uniform float uEdgeFade;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) +
           (c - a) * u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amp * noise(p);
      p = p * 2.03 + vec2(17.2, 9.4);
      amp *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float radius = length(uv);
    float sliceT = uSliceCount > 1.0 ? uSliceIndex / max(1.0, uSliceCount - 1.0) : 0.0;
    vec2 drift = vec2(uTime * 0.035 * uDrift, -uTime * 0.022 * uDrift + sliceT * 0.37);
    float n1 = fbm(uv * (1.2 + uScale * 0.45) + drift + vec2(sliceT * 1.7, 0.0));
    float n2 = fbm(uv.yx * (2.4 + uScale) - drift * 1.35 + vec2(0.0, sliceT * 2.1));
    float pulseNoise = fbm(uv * (1.8 + uPulseNoise * 2.6) - drift * (0.7 + uPulseNoise) + vec2(0.0, sliceT * 4.3));
    float theta = atan(uv.y, uv.x);
    float swirlWave = sin(theta * (2.0 + uSwirl * 8.0) + radius * (1.6 + uSwirl * 5.0) - uTime * (0.2 + uSwirl * 2.0) + sliceT * 5.0);
    float plumeColumn = smoothstep(1.08, 0.18, abs(uv.x) * (1.0 + uPlumeAmount * 2.8) + max(0.0, -uv.y) * (0.22 + uPlumeAmount * 0.44));
    plumeColumn *= smoothstep(-0.92, 0.52 + uPlumeAmount * 0.34, uv.y + n1 * 0.12);
    float fallLines = pow(abs(sin((uv.x * (10.0 + uFallAmount * 34.0) + drift.y * 3.6) * 3.14159)), mix(5.0, 18.0, clamp(uFallAmount, 0.0, 1.0)));
    float mirageLine = sin((uv.y * (18.0 + uMirageAmount * 44.0) + n1 * 5.0 + uTime * (1.4 + uMirageAmount * 3.2)) + sliceT * 8.0) * 0.5 + 0.5;
    float staticScan = sin((uv.y * (40.0 + uStaticAmount * 120.0) + sliceT * 32.0) + uTime * (4.0 + uStaticAmount * 12.0)) * 0.5 + 0.5;
    float staticBlocks = step(0.58 - uStaticAmount * 0.22, noise(floor((uv + 1.0) * (8.0 + uStaticAmount * 18.0)) + vec2(sliceT * 6.0, floor(uTime * 8.0))));
    float dustField = noise(uv * (12.0 + uDustAmount * 28.0) + vec2(sliceT * 19.0, uTime * 0.18));
    float dustMotes = smoothstep(0.78, 0.97, dustField) * smoothstep(1.08, 0.12, radius);
    float ledgerBands = sin((uv.y * (7.0 + uLedgerAmount * 21.0) + sliceT * 9.0) + n1 * (0.6 + uLedgerAmount * 1.8));
    float ledgerMask = 1.0 - smoothstep(0.22, 0.82 - uLedgerAmount * 0.24, abs(ledgerBands));
    vec2 runeUv = (uv + vec2(n1 * 0.08, n2 * 0.08) + drift * 0.06) * (8.0 + uRuneAmount * 24.0);
    vec2 runeCell = abs(fract(runeUv) - 0.5);
    float runeCross = 1.0 - smoothstep(0.05, 0.18, min(runeCell.x, runeCell.y));
    float runeGate = step(0.46 - uRuneAmount * 0.14, noise(floor(runeUv) + vec2(sliceT * 8.0, floor(uTime * 2.0))));
    float runePattern = runeCross * runeGate;
    float velvetField = smoothstep(0.08, 0.9, fbm(uv * (3.2 + uVelvetAmount * 5.6) - drift * 0.22 + vec2(0.0, sliceT * 2.0)));
    float wisps = smoothstep(0.34, 0.88, mix(n1, n2, 0.45 + uAudio * 0.08));
    wisps = mix(wisps, wisps * (0.84 + swirlWave * 0.16) + pulseNoise * 0.22, clamp(uSwirl * 0.65 + uPulseNoise * 0.25, 0.0, 1.0));
    wisps = mix(wisps, wisps * (0.86 + (mirageLine - 0.5) * 0.24), clamp(uMirageAmount, 0.0, 1.0));
    float coreEdge = mix(0.3, 0.1, clamp(uCoreTightness, 0.0, 1.0));
    float core = smoothstep(1.18, coreEdge, radius + (0.28 - wisps * 0.22));
    float veil = smoothstep(1.35, 0.3, radius) * wisps;
    float band = sin((uv.y + sliceT * 2.5 + uTime * 0.07) * 7.0) * 0.5 + 0.5;
    float forward = pow(max(0.0, 1.0 - radius), 1.2 + uAnisotropy * 2.2);
    float streak = pow(abs(sin((uv.x * (3.0 + uStreak * 12.0) + drift.x * 2.4) * 3.14159 + sliceT * 10.0)), mix(4.0, 18.0, clamp(uStreak, 0.0, 1.0)));
    float grain = noise(uv * (26.0 + uGrain * 44.0) + vec2(sliceT * 31.0, uTime * 0.45));
    float anisotropicLift = mix(1.0, 1.0 + forward * 1.8, clamp(uAnisotropy, 0.0, 2.0));
    float alpha = (core * 0.6 + veil * 0.85) * mix(0.6, 1.0, band * 0.25 + 0.75);
    alpha += streak * uStreak * (0.08 + (1.0 - radius) * 0.18);
    alpha += plumeColumn * uPlumeAmount * 0.22;
    alpha += fallLines * uFallAmount * (0.06 + (1.0 - radius) * 0.12);
    alpha += dustMotes * uDustAmount * 0.16;
    alpha += staticScan * staticBlocks * uStaticAmount * 0.18;
    alpha += ledgerMask * uLedgerAmount * 0.14;
    alpha += runePattern * uRuneAmount * 0.16;
    alpha *= (0.28 + uDensity * 1.35) * (0.78 + uAudio * 0.3) * anisotropicLift;
    alpha *= smoothstep(1.08, 0.12 + uEdgeFade * 0.26, radius);
    alpha *= smoothstep(0.0, 0.18, sliceT + 0.02) * smoothstep(0.0, 0.18, 1.02 - sliceT);
    alpha *= 0.92 + mix(-0.18, 0.2, grain) * uGrain;
    alpha *= mix(1.0, 0.8 + velvetField * 0.24, clamp(uVelvetAmount, 0.0, 1.0));
    alpha *= mix(1.0, 0.84 + ledgerMask * 0.2, clamp(uSootAmount + uLedgerAmount * 0.4, 0.0, 1.0));
    if (uVerticalBias > 0.001) {
      float upward = clamp(0.45 + (uv.y + 1.0) * (0.34 + uVerticalBias * 0.4), 0.06, 1.5);
      alpha *= mix(1.0, upward, min(1.0, uVerticalBias * 0.65));
    } else if (uVerticalBias < -0.001) {
      float downward = clamp(0.45 + (1.0 - (uv.y + 1.0) * 0.5) * (0.5 + abs(uVerticalBias) * 0.7), 0.06, 1.6);
      alpha *= mix(1.0, downward, min(1.0, abs(uVerticalBias) * 0.65));
    }
    if (alpha <= 0.003) discard;
    vec3 color = uColor * (0.55 + wisps * 0.95 + uAudio * 0.1);
    color += uColor * (0.08 + 0.28 * uGlow) * forward;
    color += vec3(1.0, 0.42, 0.12) * (streak * uEmber * 0.18 + pulseNoise * uEmber * 0.08);
    color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), clamp(uDustAmount * 0.34 + uFallAmount * 0.18, 0.0, 0.72));
    color += vec3(0.24, 0.42, 0.5) * (mirageLine - 0.5) * uMirageAmount * 0.22;
    color = mix(color, color * (0.42 + ledgerMask * 0.18) + vec3(0.16, 0.12, 0.09) * 0.22, clamp(uSootAmount, 0.0, 1.0));
    color += vec3(0.9, 0.84, 0.72) * ledgerMask * uLedgerAmount * 0.06;
    color += vec3(0.7, 0.9, 1.0) * runePattern * uRuneAmount * (0.08 + uGlow * 0.04);
    color = mix(color, color * (0.68 + velvetField * 0.16) + vec3(dot(color, vec3(0.299, 0.587, 0.114))) * 0.22, clamp(uVelvetAmount, 0.0, 1.0));
    color = mix(color, color * 0.78 + vec3(0.38, 0.48, 0.72) * 0.12, clamp(uStaticAmount * 0.58, 0.0, 0.58));
    color += vec3(0.88, 0.9, 1.0) * staticScan * staticBlocks * uStaticAmount * 0.08;
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.92, 0.97, 1.0), 0.22 + wisps * 0.08 + uGlow * 0.06);
      color += vec3(0.65, 0.78, 1.0) * forward * (0.1 + uGlow * 0.22);
      alpha *= 0.74;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      float holo = 0.5 + 0.5 * sin((uv.y + sliceT * 1.4) * 90.0 + uTime * 4.0);
      color = mix(color, vec3(0.18, 0.9, 1.0), 0.38);
      color += vec3(0.1, 0.75, 1.0) * holo * (0.18 + uGlow * 0.12);
      alpha *= 0.92 + uGlow * 0.08;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float metalBand = 0.5 + 0.5 * sin((uv.x - uv.y + sliceT) * 18.0);
      color = mix(vec3(0.2, 0.22, 0.25), vec3(0.95), metalBand * 0.75);
      color *= mix(uColor, vec3(1.0), 0.3);
      color += vec3(1.0) * forward * (0.05 + uGlow * 0.08);
    } else if (uMaterialStyle > 3.5) {
      vec2 cell = fract(vUv * 18.0) - 0.5;
      float dots = 1.0 - smoothstep(0.06, 0.28, length(cell));
      alpha *= mix(0.38, 1.0, dots);
      color *= 0.45 + dots * 0.75;
    } else {
      color += uColor * (wisps * 0.08 + forward * uGlow * 0.14);
    }
    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`;

