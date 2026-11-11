export const SCREEN_OVERLAY_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const SCREEN_OVERLAY_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uScanlineIntensity;
  uniform float uScanlineDensity;
  uniform float uNoiseIntensity;
  uniform float uVignetteIntensity;
  uniform float uPulseIntensity;
  uniform float uPulseSpeed;
  uniform float uImpactFlashIntensity;
  uniform float uImpactAmount;
  uniform float uInterferenceIntensity;
  uniform float uPersistenceIntensity;
  uniform float uPersistenceLayers;
  uniform float uSplitIntensity;
  uniform float uSplitOffset;
  uniform float uSweepIntensity;
  uniform float uSweepSpeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float lineWave = 0.5 + 0.5 * sin(vUv.y * uScanlineDensity * 3.14159265 + uTime * 1.8);
    float scanline = pow(lineWave, 2.4) * uScanlineIntensity;
    vec2 noiseUv = vUv * vec2(960.0, 540.0) + vec2(uTime * 37.0, uTime * 19.0);
    float grain = (hash(floor(noiseUv)) - 0.5) * 2.0;
    float noise = abs(grain) * uNoiseIntensity;
    float vignetteShape = smoothstep(0.95, 0.18, distance(vUv, vec2(0.5)));
    float vignette = (1.0 - vignetteShape) * uVignetteIntensity;
    vec2 centeredUv = vUv - vec2(0.5);
    float radialDistance = length(centeredUv);
    float pulsePhase = uTime * (0.4 + uPulseSpeed * 2.2) - radialDistance * 18.0;
    float pulseWave = 0.5 + 0.5 * sin(pulsePhase);
    float pulseMask = smoothstep(0.9, 0.0, radialDistance);
    float pulse = pow(pulseWave, 3.0) * pulseMask * uPulseIntensity;
    float impactCenter = smoothstep(0.72, 0.0, radialDistance);
    float impactFlash = impactCenter * uImpactFlashIntensity * uImpactAmount;
    float bandPrimary = sin(vUv.y * 42.0 + uTime * 4.8);
    float bandSecondary = sin(vUv.y * 87.0 - uTime * 7.2 + sin(vUv.x * 12.0 + uTime * 0.9));
    float interference = smoothstep(0.58, 1.0, abs(bandPrimary * 0.7 + bandSecondary * 0.3)) * uInterferenceIntensity;

    float persistence = 0.0;
    for (int i = 0; i < 4; i++) {
      float layerIndex = float(i + 1);
      float enabled = step(layerIndex - 0.5, uPersistenceLayers);
      float ghostTime = uTime - layerIndex * 0.14;
      float ghostLine = pow(0.5 + 0.5 * sin((vUv.y + layerIndex * 0.012) * uScanlineDensity * 3.14159265 + ghostTime * 1.8), 2.1);
      float ghostSweepProgress = fract(ghostTime * max(0.05, uSweepSpeed) * 0.12);
      float ghostSweepCenter = mix(-0.35, 1.35, ghostSweepProgress);
      float ghostSweep = 1.0 - smoothstep(0.0, 0.24 + layerIndex * 0.02, abs((vUv.x + vUv.y * 0.22) - ghostSweepCenter));
      float decay = 1.0 / (1.0 + layerIndex * 1.35);
      persistence += enabled * (ghostLine * 0.16 + ghostSweep * 0.22) * decay;
    }
    persistence *= uPersistenceIntensity;

    float splitOffset = max(0.0, uSplitOffset) * 0.025;
    float splitGhostA = pow(0.5 + 0.5 * sin((vUv.y + splitOffset) * uScanlineDensity * 3.14159265 + uTime * 1.85), 2.2);
    float splitGhostB = pow(0.5 + 0.5 * sin((vUv.y - splitOffset) * uScanlineDensity * 3.14159265 + uTime * 1.75), 2.2);
    float splitMask = smoothstep(0.04, 0.45, abs(vUv.x - 0.5));
    float split = abs(splitGhostA - splitGhostB) * splitMask * uSplitIntensity;

    float sweepProgress = fract(uTime * max(0.05, uSweepSpeed) * 0.12);
    float sweepCenter = mix(-0.35, 1.35, sweepProgress);
    float sweepBand = 1.0 - smoothstep(0.0, 0.24, abs((vUv.x + vUv.y * 0.22) - sweepCenter));
    float sweep = sweepBand * uSweepIntensity;

    float alpha = clamp(scanline * 0.45 + noise * 0.35 + vignette + pulse * 0.55 + impactFlash * 0.8 + interference * 0.35 + persistence + split * 0.4 + sweep * 0.28, 0.0, 0.92);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;
