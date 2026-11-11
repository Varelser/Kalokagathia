export const PHYSICS_MOTION_PRELUDE = `
vec3 applyMotion(vec3 p, float motionType, float t, float speed, float amp, float freq, float phase, float rnd, vec3 wind, float noiseScale, float evolution, float complexity, float fluidForce, float viscosity, float fidelity, float octaveMult) {
    float time = t * speed;
    vec3 result = p;
    float motionFamily = getMotionFamily(motionType);
    float familyFieldScale =
      motionFamily < 0.5 ? 0.72 :
      motionFamily < 1.5 ? 0.48 :
      motionFamily < 2.5 ? 0.36 :
      motionFamily < 3.5 ? 0.58 :
      motionFamily < 4.5 ? 0.44 :
      motionFamily < 5.5 ? 0.62 : 0.65;
    vec3 fieldPos = p * max(0.05, freq * familyFieldScale) * max(0.05, noiseScale) + wind * time * 0.025;
    float octaves = clamp(max(1.0, fidelity), 1.0, 8.0);
    float lacunarity = max(1.1, octaveMult);
    vec3 noiseField = noiseVec(fieldPos + time * max(0.05, evolution) * 0.3 + rnd * 3.7);
    vec3 curlField = curlNoise(fieldPos + phase * 0.35, 0.1, octaves, lacunarity);
    float attractorScale = max(0.15, complexity) * (motionFamily < 1.5 ? 1.08 : motionFamily < 2.5 ? 0.9 : 1.0);

`;
