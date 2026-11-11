export const BRUSH_VERTEX_SHADER = `
  attribute float layerMix;
  varying vec2 vUv;
  varying float vLayerMix;
  varying float vBrushNoise;
  uniform float uTime;
  uniform float uJitter;
  uniform float uPulse;
  uniform float uTrailShear;

  void main() {
    vUv = uv;
    vLayerMix = layerMix;
    vec3 transformed = position;
    float wave = sin((position.x + layerMix * 0.5) * 5.0 + uTime * 0.8) * 0.08;
    float noise = sin(dot(position.xy + vec2(layerMix * 1.3, uTime * 0.12), vec2(14.73, 9.17))) * 0.5 + 0.5;
    transformed.x += (uv.y - 0.5) * uTrailShear * mix(0.35, 1.0, layerMix);
    transformed.y += wave + (noise - 0.5) * uJitter * 0.02;
    transformed.z += sin((position.y + layerMix) * 4.0 + uTime * 0.7) * 0.05 + uPulse * 0.02;
    vBrushNoise = noise;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

export const BRUSH_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uJitter;
  uniform float uPulse;
  uniform float uAudioReactive;
  uniform float uVeilCurve;
  uniform float uBleedWarp;
  uniform float uEdgeSoftness;
  uniform float uStreakFreq;
  uniform float uTearFreq;
  uniform float uBandFreq;
  uniform float uAlphaMul;
  uniform float uMaterialStyle;
  varying vec2 vUv;
  varying float vLayerMix;
  varying float vBrushNoise;

  float brushMask(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0;
    float curve = mix(1.0, 0.42 + uv.y * 1.25, clamp(uVeilCurve, 0.0, 1.0));
    float ellipse = 1.0 - smoothstep(0.45, 0.45 + uEdgeSoftness * 0.72, length(vec2(p.x * 0.78, p.y * (1.18 + curve * 0.12))));
    float streak = 0.5 + 0.5 * sin(uv.y * uStreakFreq + uv.x * 21.0 + vLayerMix * 11.0 + vBrushNoise * 8.0);
    float torn = 0.5 + 0.5 * sin(uv.x * uTearFreq - uv.y * (uTearFreq * 0.5) + vBrushNoise * 10.0);
    float bleed = 0.5 + 0.5 * sin((uv.x + uv.y) * (18.0 + uBleedWarp * 24.0) + vBrushNoise * 16.0);
    return ellipse * mix(0.45, 1.0, streak * torn) * mix(0.8, 1.14, bleed);
  }

  void main() {
    float mask = brushMask(vUv);
    if (mask < 0.02) discard;
    vec3 color = uColor;
    float alpha = uOpacity * uAlphaMul * mask * mix(0.95, 0.28, vLayerMix);
    float edge = smoothstep(0.15, 0.95, mask);
    float band = 0.5 + 0.5 * sin(vUv.x * uBandFreq + vUv.y * (uBandFreq * 0.72) + vLayerMix * 5.0 + vBrushNoise * 4.0);
    color *= 0.52 + edge * 0.48 + vBrushNoise * 0.18;
    color = mix(color, color * (0.82 + band * 0.26), 0.32 + uBleedWarp * 0.3);
    color += vec3(1.0) * uPulse * 0.05;

    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.92, 0.97, 1.0), 0.22);
      alpha *= 0.82;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      float scan = 0.5 + 0.5 * sin(vUv.y * 140.0 + uPulse * 10.0 + vLayerMix * 8.0);
      color = mix(color, vec3(0.18, 0.95, 1.0), 0.48);
      color += vec3(0.1, 0.55, 0.7) * scan * 0.12;
      alpha *= 1.05;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      color = mix(vec3(0.16), vec3(1.0), band) * mix(uColor, vec3(1.0), 0.38);
    } else if (uMaterialStyle > 3.5) {
      vec2 cell = fract(vUv * 18.0) - 0.5;
      float dots = 1.0 - smoothstep(0.14, 0.34, length(cell));
      alpha *= mix(0.38, 1.0, dots);
      color *= 0.44 + dots * 0.72;
    }

    gl_FragColor = vec4(color, alpha);
  }
`;
