export const PHYSICS_NOISE_LOGIC = `
  vec3 rotate(vec3 p, vec3 axis, float angle) {
    float s = sin(angle); float c = cos(angle); float oc = 1.0 - c;
    mat3 rot = mat3(
      oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
      oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s,
      oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
    );
    return rot * p;
  }

  float hash1(float n) { return fract(sin(n) * 43758.5453123); }
  vec3 hash3(float n) { return fract(sin(vec3(n, n + 1.0, n + 2.0)) * 43758.5453123); }

  float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(1.0, 57.0, 113.0));
    return mix(
      mix(mix(hash1(n + 0.0), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y),
      mix(mix(hash1(n + 113.0), hash1(n + 114.0), f.x), mix(hash1(n + 170.0), hash1(n + 171.0), f.x), f.y),
      f.z
    );
  }

  vec3 noiseVec(vec3 p) {
    return vec3(
      valueNoise(p + vec3(0.0, 0.0, 0.0)),
      valueNoise(p + vec3(31.416, 17.903, 11.0)),
      valueNoise(p + vec3(59.2, 7.21, 41.0))
    ) * 2.0 - 1.0;
  }

  float fbm(vec3 p, float octaves, float lacunarity) {
    float value = 0.0;
    float amplitude = 0.5;
    vec3 samplePos = p;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= octaves) break;
      value += valueNoise(samplePos) * amplitude;
      samplePos *= lacunarity;
      amplitude *= 0.5;
    }
    return value;
  }

  vec3 curlNoise(vec3 p, float eps, float octaves, float lacunarity) {
    vec3 dx = vec3(eps, 0.0, 0.0);
    vec3 dy = vec3(0.0, eps, 0.0);
    vec3 dz = vec3(0.0, 0.0, eps);
    float p_x0 = fbm(p - dx, octaves, lacunarity);
    float p_x1 = fbm(p + dx, octaves, lacunarity);
    float p_y0 = fbm(p - dy, octaves, lacunarity);
    float p_y1 = fbm(p + dy, octaves, lacunarity);
    float p_z0 = fbm(p - dz, octaves, lacunarity);
    float p_z1 = fbm(p + dz, octaves, lacunarity);
    return normalize(vec3(
      (p_y1 - p_y0) - (p_z1 - p_z0),
      (p_z1 - p_z0) - (p_x1 - p_x0),
      (p_x1 - p_x0) - (p_y1 - p_y0)
    ));
  }
`;
