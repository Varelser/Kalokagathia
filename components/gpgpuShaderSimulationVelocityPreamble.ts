import { PYRO_GRID_SAMPLING, PYRO_GRID_UNIFORMS, PYRO_GRID_WORLD } from './gpgpuShaderPyroGrid';

// ── Velocity sim fragment, part 1 of 5: preamble: precision + all uniform declarations ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
const VEL_FRAG_PREAMBLE_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uGravity;
  uniform float uTurbulence;
  uniform float uBounceRadius;
  uniform float uBounce;
  uniform float uAudioBlast;
  uniform bool  uNBodyEnabled;
  uniform float uNBodyStrength;
  uniform float uNBodySoftening;
  uniform float uNBodyRepulsion;
  uniform int   uNBodySamples;
  uniform float uTexSizeF;
  uniform bool  uCurlEnabled;
  uniform float uCurlStrength;
  uniform float uCurlScale;
  uniform int   uCurlSymmetry;
  uniform int   uCurlMode;
  uniform int   uCurlOctaves;
  uniform bool  uBoidsEnabled;
  uniform float uBoidsSeparation;
  uniform float uBoidsAlignment;
  uniform float uBoidsCohesion;
  uniform float uBoidsRadius;
  uniform bool  uAttractorEnabled;
  uniform int   uAttractorType;
  uniform float uAttractorStrength;
  uniform float uAttractorScale;
  uniform int   uAttractorSpaceMode;
  uniform bool  uLevyEnabled;
  uniform float uLevyStrength;
  uniform float uLevyRate;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoCoupling;
  uniform float uKuramotoSpread;
  uniform float uKuramotoRadius;
  uniform bool  uParticleLifeEnabled;
  uniform float uParticleLifeStrength;
  uniform float uParticleLifeRadius;
  uniform float uParticleLifeFriction;
  uniform int   uParticleLifeSpecies;
  uniform float uParticleLifeMatrix[36];
  uniform float uParticleLifePursue;
  uniform float uParticleLifeEvade;
  uniform float uParticleLifeVisionRange;
  uniform float uParticleLifeVisionAngle;
  uniform float uParticleLifeMaxSpeed;
  uniform float uParticleLifeMeanderAmount;
  uniform float uParticleLifeMeanderScale;
  uniform float uParticleLifeAvoid;
  // General steering avoidance (Phase 15): same law, all
  // particles, own range (0 = 1.5 * uSdfSize fallback).
  uniform float uSteerAvoid;
  uniform float uSteerAvoidRange;
  // Lifecycle grammar (Phase AB): spawn gate (burst < 1 holds part
  // of the pool parked until the release threshold crosses its
  // hash) and the pool-wide drag rate / max speed. uDragRate's
  // default 1.1 is the legacy fixed damping; uMaxSpeed 0 = off.
  uniform float uSpawnRate;
  uniform float uSpawnBurst;
  uniform float uSpawnTime;
  // Spawn pulse (Phase AH): interval 0 = off — spawnPulseTime then
  // returns max(t, 0) and the threshold expression below is the
  // legacy one verbatim. TS twin: spawnPulseTime in
  // lib/gpgpuLifecycle.ts.
  uniform float uSpawnPulseInterval;
  uniform float uSpawnPulseDuty;
  // Pulse cycles + probability, spawn order and the spawn burst
  // event (Phase AX): cycles 0 (unlimited) with probability 1
  // makes spawnPulseTimeEx delegate to the legacy spawnPulseTime;
  // order mode 0 reads the legacy spawnHash instead of the baked
  // distance texture; the event is disabled by default. TS twins:
  // lib/gpgpuLifecycle.ts.
  uniform float uSpawnPulseCycles;
  uniform float uSpawnPulseProbability;
  uniform sampler2D uSpawnOrderTex;
  uniform int uSpawnOrderMode;
  uniform bool uSpawnEventEnabled;
  uniform float uSpawnEventTime;
  uniform float uSpawnEventCount;
  uniform float uSpawnEventSpeed;
  uniform float uSpawnEventSpread;
  uniform float uDragRate;
  uniform float uMaxSpeed;
  // Signal & time grammar (Phase AC): the curl field's evolution
  // speed (1 = legacy rate, an exact IEEE identity) and the age
  // curves aimed at the simulation itself. The passes suppress a
  // curve whose points are all 1 (identity) by clearing its
  // Enabled uniform, so a flat curve takes the legacy path.
  uniform float uCurlSpeed;
  uniform bool  uAgeCurveVelocityEnabled;
  uniform float uAgeCurveVelocity[5];
  uniform bool  uAgeCurveForceEnabled;
  uniform float uAgeCurveForce[5];
  uniform bool  uVortexEnabled;
  uniform float uVortexStrength;
  uniform float uVortexTilt;
  uniform bool  uWindEnabled;
  uniform float uWindStrength;
  uniform float uWindX;
  uniform float uWindY;
  uniform float uWindZ;
  uniform float uWindGust;
  // Wind volume (Phase AL): a placed sphere localising the wind
  // above with the light-style falloff. TS twin:
  // lib/gpgpuWindVolume.ts. Disabled = the block is skipped and
  // the pass is verbatim legacy.
  uniform bool  uWindVolumeEnabled;
  uniform vec3  uWindVolumePos;
  uniform float uWindVolumeRadius;
  uniform float uWindVolumeStrength;
  // Terrain slope flow (Phase AE): the derived gradient bake of
  // the live terrain (RG = unit downhill direction, B = slope
  // magnitude normalised by the field's own maximum). Resolved
  // CPU-side (enabled key AND terrain mesh on AND plane mode AND
  // texture ready), so a false uniform is the exact legacy path.
  uniform bool  uSlopeForceEnabled;
  uniform float uSlopeForceStrength;
  uniform sampler2D uSlopeTex;
  uniform float uSlopeExtent;
  // Terrain collider (Phase AI): the derived collider bake
  // (RG = 16-bit packed height, B/A = gradient components).
  // Resolved CPU-side like the slope force (enabled key AND
  // terrain mesh on AND plane mode AND texture ready), so a
  // false uniform is the exact legacy path.
  uniform bool  uTerrainColliderEnabled;
  uniform sampler2D uTerrainColliderTex;
  uniform float uTerrainExtent;
  uniform float uTerrainHeightWorld;
  uniform float uTerrainGradScale;
  uniform float uTerrainTexSize;
  uniform float uTerrainBounce;
  uniform float uTerrainFriction;
  // Named attributes + group gate (Phase AK): the static
  // attribute texture (lib/gpgpuAttributes.ts) in the global
  // texel layout. Resolved CPU-side (texture built AND a
  // velocity consumer active), so false uniforms are the exact
  // legacy path.
  uniform sampler2D uAttrTex;
  uniform bool  uAttrEnabled;
  uniform bool  uAttrForceEnabled;
  uniform int   uAttrForceSlot;
  uniform float uAttrForceAmount;
  uniform bool  uGroupEnabled;
  uniform int   uGroupSlot;
  uniform int   uGroupMode;
  uniform float uGroupLow;
  uniform float uGroupHigh;
  uniform int   uGroupTarget;
  uniform bool  uGroupInvert;
  uniform bool  uWellEnabled;
  uniform float uWellStrength;
  uniform float uWellSoftening;
  uniform float uWellOrbit;
  uniform int   uWellCount;
  uniform float uWellSpread;
  uniform bool  uElasticEnabled;
  uniform float uElasticStrength;
  uniform bool  uMagneticEnabled;
  uniform float uMagneticStrength;
  uniform float uMagneticBX;
  uniform float uMagneticBY;
  uniform float uMagneticBZ;
  uniform bool  uSphEnabled;
  uniform float uSphPressure;
  uniform float uSphViscosity;
  uniform float uSphRadius;
  uniform float uSphRestDensity;
  uniform float uSphSurfaceTension;
  uniform float uSphSurfaceSelectivity;
  // Grains (Phase AQ): DEM-style penalty contact + Coulomb
  // friction over the shared subsample neighbourhood. Disabled
  // is the exact legacy path (the block is skipped whole).
  uniform bool  uGrainsEnabled;
  uniform float uGrainsSize;
  uniform float uGrainsStiffness;
  uniform float uGrainsFriction;
  uniform float uGrainsCohesion;
  uniform float uGrainsRestitution;
  uniform float uGrainsRestDamping;
`;
const VEL_FRAG_PREAMBLE_GRAINS_SCAN = /* glsl */ `  // Neighbourhood scan (Phase 19): 0 = the AQ subsample above;
  // 1 = the complete scan over the whole position texture (the
  // Grains loops' candidate plan switches; SPH is untouched).
  uniform int   uGrainsNeighborhood;
`;
const VEL_FRAG_PREAMBLE_GRAINS_CELL = /* glsl */ `  // Cell sort (Phase 19 fix2): the complete neighbourhood's
  // fast path. uGrainsSortTex holds the pool sorted DESCENDING
  // by spatial cell key (the bitonic output order), built once
  // per frame from the frame-start positions by the passes;
  // uGrainsCellSort is true only on frames where that sort
  // actually ran — otherwise the Grains loops keep the
  // complete-scan fallback branch. The grid is resolved
  // CPU-side (grainsCellGrid in lib/gpgpuGrains.ts): cell size
  // >= grain diameter, every dim <= 256 so keys stay exact in
  // float32. TS twin: grainsNeighborsViaCellSearch there.
  uniform sampler2D uGrainsSortTex;
  uniform bool  uGrainsCellSort;
  uniform float uGrainsCellOrigin;
  uniform float uGrainsCellSize;
  uniform vec3  uGrainsCellDims;
  float grainsCellKeyAt(float idx) {
    vec2 uv = (vec2(mod(idx, uTexSizeF), floor(idx / uTexSizeF)) + 0.5) / uTexSizeF;
    return texture2D(uGrainsSortTex, uv).z;
  }
  // First index whose key is <= K in the descending order, or
  // the pool size when every key is greater.
  float grainsCellLowerBound(float K) {
    float total = uTexSizeF * uTexSizeF;
    float lo = 0.0;
    float hi = total;
    for (int s = 0; s < 24; s++) {
      if (lo >= hi) break;
      float mid = floor((lo + hi) * 0.5);
      if (grainsCellKeyAt(mid) > K) lo = mid + 1.0;
      else hi = mid;
    }
    return lo;
  }
  vec3 grainsCellOf(vec3 p) {
    return clamp(floor((p - uGrainsCellOrigin) / uGrainsCellSize), vec3(0.0), uGrainsCellDims - vec3(1.0));
  }
  float grainsCellKeyOf(vec3 cell) {
    return (cell.x * uGrainsCellDims.y + cell.y) * uGrainsCellDims.z + cell.z;
  }
`;
const VEL_FRAG_PREAMBLE_MID = /* glsl */ `  // Vellum (Phase AR): the pressure force + velocity damping
  // of the constraint solver (the projection itself lives in a
  // dedicated pass). uVellumEnabled false is the exact legacy
  // path — both blocks below are skipped whole. The pressure
  // reads the texel neighbours of uPosTex: right / up in grid
  // space (shell mode wraps x, like the projection pass).
  uniform bool  uVellumEnabled;
  uniform int   uVellumMode;
  uniform float uVellumPressure;
  uniform float uVellumDamping;
  // Rigid bodies (Phase AU): while the CPU rigid body solver is
  // bound, this pass writes the rigid velocity of the particle's
  // point on its body — body linear velocity + ω × (rotated
  // local offset) — converted to the velocity texture's units
  // (world / s ÷ 60, the position pass's integration scale).
  // Body texture rows: 0 = position + radius, 1 = quaternion,
  // 2 = linear velocity + sleep flag, 3 = angular velocity.
  // False (default) keeps every statement below verbatim.
  uniform bool  uRigidEnabled;
  uniform sampler2D uRigidCellTex;
  uniform sampler2D uRigidBodyTex;
  // Pyro (Phase AS): the particle-side temperature / buoyancy
  // solver. The temperature is a pure function of the normalised
  // age (derived below, next to ageNorm) — no new textures, no
  // new passes. uPyroEnabled false skips every Pyro block whole
  // and the curl modulation factor stays the literal 1.0, so the
  // disabled path is verbatim legacy.
  uniform bool  uPyroEnabled;
  uniform float uPyroTemperature;
  uniform float uPyroBuoyancy;
  uniform float uPyroCooling;
  uniform float uPyroDisturbance;
  uniform float uPyroDisturbanceHeat;
  uniform bool  uVFieldEnabled;
  uniform int   uVFieldType;
  uniform float uVFieldStrength;
  uniform float uVFieldScale;
  uniform bool  uSpringEnabled;
  uniform float uSpringStrength;
  uniform sampler2D uInitPosTex;
  uniform bool  uMorphEnabled;
  uniform sampler2D uMorphTex;
  uniform sampler2D uMorphNormalTex;
  uniform float uMorphObjNormalSpeed;
  uniform float uMorphKickStart;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform float uMorphStrength;
  uniform float uMorphOrbitSpeed;
  uniform float uMorphReplicaPhaseGain;
  // Replica independent simulation (Phase W2): per-stack field
  // seed / clock offsets (zero in the shared path, where they are
  // exact neutrals) and the stack-mode remap of this stack's
  // texels onto the global layout for the textures that live
  // there (morph targets / normals / initial positions).
  uniform vec3  uReplicaSeedOffset;
  uniform float uReplicaTimeOffset;
  uniform float uStackMode;
  uniform float uStackGlobalStart;
  uniform float uStackGlobalTexSizeF;
  uniform float uSpeed;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  uniform float uSdfBounce;
  // Mesh SDF collider (Phase BY): the baked signed-distance grid
  // of the imported OBJ mesh (lib/meshSdfCollider.ts), R16F 3D
  // texture holding NORMALISED distances. Resolved CPU-side
  // (enabled key AND bake complete), so a false uniform is the
  // exact legacy path. uMeshSdfOrigin / uMeshSdfDomainWorld map
  // world → texture space; uMeshSdfScale is the morph world
  // scale W (normalised distance × W = world distance).
  uniform bool  uMeshSdfEnabled;
  uniform sampler3D uMeshSdfTex;
  uniform vec3  uMeshSdfOrigin;
  uniform float uMeshSdfDomainWorld;
  uniform float uMeshSdfScale;
  uniform float uMeshSdfVoxelWorld;
  uniform float uMeshSdfBounce;
  uniform float uMeshSdfFriction;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  uniform float uFloorBounce;
  uniform bool  uMouseEnabled;
  uniform vec3  uMousePos;
  uniform float uMouseStrength;
  uniform float uMouseRadius;
  uniform int   uMouseMode;
  uniform float uMousePaintRate;
  // Multi-touch interference (Phase AO): world positions of all
  // tracked pointers (index 0 = the primary, same value as
  // uMousePos). uMouseCount stays 0 unless the CPU side resolved
  // multi-touch on, which keeps the block below inert and the
  // legacy path bit-identical.
  uniform vec3  uMousePosMulti[4];
  uniform int   uMouseCount;
  uniform bool  uFluidEnabled;
  uniform sampler2D uFluidTex;
  uniform float uFluidInfluence;
  uniform float uFluidScale;
  // FLIP layer (Phase AT): uFlipBaseTex carries this frame's
  // composite grid velocity BEFORE the pressure projection, so
  // the pass can form the FLIP increment (projected - base)
  // against uFluidTex (the projected field). uFlipEnabled is
  // only ever true together with uFluidEnabled, and only the
  // CPU side's FLIP field pipeline sets it — off, the fluid
  // block below is the legacy external-force sample verbatim.
  uniform bool  uFlipEnabled;
  uniform sampler2D uFlipBaseTex;
  uniform float uFlipBlend;
  uniform float uFlipTransfer;
  // Pyro grid coupling (Phase CB): G2P transfer from the grid
  // solver's atlas fields, in the FLIP pattern but on all three
  // components (the grid solves y motion too, unlike the 2.5D
  // FLIP field). uPyroGridCouple is only ever true while the
  // grid is enabled, stepped, and its blend key is above 0 —
  // set by applyPyroGridCoupleUniforms on the CPU side; off,
  // the block in the main tail never runs. The atlas sampling
  // and the world->grid mapping are the grid solver's own
  // shared chunks (PYRO_GRID_*), not a second copy.
  uniform bool  uPyroGridCouple;
  uniform sampler2D uPyroGridVelTex;
  uniform sampler2D uPyroGridBaseTex;
  uniform float uPyroGridBlend;
  uniform float uPyroGridTransfer;
  uniform float uPyroGridVelScale;
  ${PYRO_GRID_UNIFORMS}
  ${PYRO_GRID_SAMPLING}
  ${PYRO_GRID_WORLD}
`;
const VEL_FRAG_PREAMBLE_FLIP3D = /* glsl */ `  // FLIP 3D coupling (Phase 19 stage 2): G2P transfer from the
  // atlas-packed 3D FLIP solver, in the same PIC/FLIP pattern
  // as the Pyro coupling above but with its OWN atlas uniforms
  // (the two grids may run at different resolutions in the same
  // pass, so the shared uGridN family cannot serve both).
  // uFlip3dCouple is only ever true while the FLIP mode is
  // '3d', the solver has stepped, and the couple fill ran — set
  // by applyFlip3dCoupleUniforms; off, the block in the main
  // tail never runs.
  uniform bool  uFlip3dCouple;
  uniform float uFlip3dBlend;
  uniform float uFlip3dTransfer;
  uniform float uFlip3dVelScale;
  uniform vec4  uFlip3dBounds;
  uniform float uFlip3dGridN;
  uniform vec2  uFlip3dAtlasSize;
  uniform vec2  uFlip3dAtlasTiles;
  // Atlas merge (案B): the projected and base fields live in
  // ONE merged atlas bound through the (otherwise dead) 2D
  // FLIP slot uFlipBaseTex — Vel in the first tile half, Base
  // offset by uFlip3dBaseTileOffset tiles (the single-layout
  // tile capacity, cols x rows). The offset enters ONLY here,
  // in the UV generation layer: grid-space clamp / floor /
  // fraction are settled before it, so the interpolation
  // weights and the domain fade keep their meaning, and the
  // manual trilinear path and the hardware path share the
  // same transform.
  uniform float uFlip3dBaseTileOffset;
  uniform bool  uFlip3dManualTrilinear;
  vec2 flip3dUvOfCell(vec3 cell, float zOff) {
    float z = cell.z + zOff;
    vec2 tile = vec2(mod(z, uFlip3dAtlasTiles.x), floor(z / uFlip3dAtlasTiles.x));
    return (tile * uFlip3dGridN + cell.xy + 0.5) / uFlip3dAtlasSize;
  }
  vec4 flip3dFetch(sampler2D tex, vec3 cell, float zOff) {
    vec3 c = clamp(cell, vec3(0.0), vec3(uFlip3dGridN - 1.0));
    return texture2D(tex, flip3dUvOfCell(c, zOff));
  }
  vec4 flip3dSample(sampler2D tex, vec3 p, float zOff) {
    vec3 pc = clamp(p, vec3(0.0), vec3(uFlip3dGridN - 1.0));
    vec3 b = floor(pc);
    vec3 f = pc - b;
    if (uFlip3dManualTrilinear) {
      vec4 c000 = flip3dFetch(tex, b, zOff);
      vec4 c100 = flip3dFetch(tex, b + vec3(1.0, 0.0, 0.0), zOff);
      vec4 c010 = flip3dFetch(tex, b + vec3(0.0, 1.0, 0.0), zOff);
      vec4 c110 = flip3dFetch(tex, b + vec3(1.0, 1.0, 0.0), zOff);
      vec4 c001 = flip3dFetch(tex, b + vec3(0.0, 0.0, 1.0), zOff);
      vec4 c101 = flip3dFetch(tex, b + vec3(1.0, 0.0, 1.0), zOff);
      vec4 c011 = flip3dFetch(tex, b + vec3(0.0, 1.0, 1.0), zOff);
      vec4 c111 = flip3dFetch(tex, b + vec3(1.0, 1.0, 1.0), zOff);
      return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
                 mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
    }
    float z1 = min(b.z + 1.0, uFlip3dGridN - 1.0);
    vec2 tile0 = vec2(mod(b.z + zOff, uFlip3dAtlasTiles.x), floor((b.z + zOff) / uFlip3dAtlasTiles.x));
    vec2 tile1 = vec2(mod(z1 + zOff, uFlip3dAtlasTiles.x), floor((z1 + zOff) / uFlip3dAtlasTiles.x));
    vec2 xy = pc.xy + 0.5;
    vec4 s0 = texture2D(tex, (tile0 * uFlip3dGridN + xy) / uFlip3dAtlasSize);
    vec4 s1 = texture2D(tex, (tile1 * uFlip3dGridN + xy) / uFlip3dAtlasSize);
    return mix(s0, s1, f.z);
  }
  vec3 flip3dCellOfWorld(vec3 worldPos) {
    return ((worldPos - uFlip3dBounds.xyz) / (2.0 * uFlip3dBounds.w) + 0.5) * uFlip3dGridN - 0.5;
  }
  float flip3dDomainFade(vec3 cellPos) {
    vec3 d = min(cellPos, vec3(uFlip3dGridN - 1.0) - cellPos);
    float m = min(d.x, min(d.y, d.z));
    return clamp(m + 0.5, 0.0, 1.0);
  }
`;
const VEL_FRAG_PREAMBLE_STEERING = /* glsl */ `  // Crowd steering (Phase 20 stage 2): the uniform set of the
  // 'steer-seek' force chunk — the GPU twin of lib/steering.ts
  // (seek / arrive / path following / two-state switching).
  // Mode ids: 0 seek, 1 arrive, 2 path, 3 state. The path is a
  // fixed 8-point uniform array (STEERING_PATH_MAX in
  // lib/steering.ts); PathCount 0 leaves the path mode inert.
  uniform bool  uSteerSeekEnabled;
  uniform int   uSteerSeekMode;
  uniform float uSteerSeekStrength;
  uniform float uSteerSeekMaxSpeed;
  uniform float uSteerSeekMaxForce;
  uniform vec3  uSteerSeekTarget;
  uniform vec3  uSteerSeekTarget1;
  uniform float uSteerSeekSlowingRadius;
  uniform int   uSteerSeekStateSlot;
  uniform float uSteerSeekStateThreshold;
  uniform vec3  uSteerSeekPath[8];
  uniform int   uSteerSeekPathCount;
  uniform float uSteerSeekPathLookAhead;
  uniform float uSteerSeekPathRadius;
`;
const VEL_FRAG_PREAMBLE_AKINCI = /* glsl */ `  // Surface tension, Akinci form (Phase 24): the strength of
  // the two-term model accumulated inside the SPH sample loop
  // (sphAkinci variant of the SPH/Grains chunk). Spliced in
  // only behind this option, in the Phase 19 manner — the
  // stock preamble carries no trace of it.
  uniform float uSphSurfaceTensionAkinci;
`;
// Phase 29 (9-6 stage 2): the attractor unit preamble blocks
// are generated, one per replicated unit. The generator's
// unit-2 output reproduces the historical Phase 27 literal
// byte-for-byte (pinned by the phase29 test); units 3 and 4
// come from the same function.
export function buildAttractorUnitPreamble(unit: number, ordinal: string, phaseNote: string): string {
  return `  // Strange attractor unit ${unit} (${phaseNote}): the
  // ${ordinal} parameter set of the attractor force ('attractor-${unit}'
  // chunk). Spliced in only behind this option, in the
  // Phase 19 manner — the stock preamble carries no trace
  // of it.
  uniform bool  uAttractor${unit}Enabled;
  uniform int   uAttractor${unit}Type;
  uniform float uAttractor${unit}Strength;
  uniform float uAttractor${unit}Scale;
  uniform int   uAttractor${unit}SpaceMode;
`;
}
const VEL_FRAG_PREAMBLE_ATTRACTOR2 = buildAttractorUnitPreamble(2, 'second', 'Phase 27, 9-6 stage 1');
const VEL_FRAG_PREAMBLE_ATTRACTOR3 = buildAttractorUnitPreamble(3, 'third', 'Phase 29, 9-6 stage 2');
const VEL_FRAG_PREAMBLE_ATTRACTOR4 = buildAttractorUnitPreamble(4, 'fourth', 'Phase 29, 9-6 stage 2');
const VEL_FRAG_PREAMBLE_TAIL = /* glsl */ `  varying vec2 vUv;

`;

// ── Phase 19 gate fix: string-level shader variants ──
// On the target GPU, ANY code-text change in these shaders
// breaks bit-identity with v2.00 — even code gated off by a
// false uniform (measured, see PHASE19_GATE_DIAGNOSIS). The
// Phase 19 additions therefore sit behind builder options:
// the default exports below are byte-identical to v2.00 and
// the *_PHASE19 exports are byte-identical to the Phase 19
// strings (both pinned by scripts/phase18-shader-hash.mjs).
export interface VelocityPreambleVariantOptions {
  grainsFullScan?: boolean;
  flip3dCouple?: boolean;
  // Phase 20 stage 2: crowd steering uniform set. Spliced in
  // only behind this option, in the Phase 19 manner — the
  // default preamble stays byte-identical to v2.00.
  steeringSeek?: boolean;
  // Phase 24: the Akinci surface-tension uniform. Same
  // discipline — the default preamble stays byte-identical.
  sphAkinci?: boolean;
  // Phase 27: the attractor unit-2 uniform set. Same
  // discipline — the default preamble stays byte-identical.
  attractor2?: boolean;
  // Phase 29: the attractor unit-3 / unit-4 uniform sets,
  // gated identically.
  attractor3?: boolean;
  attractor4?: boolean;
}

export function buildVelocityPreamble(options?: VelocityPreambleVariantOptions): string {
  return VEL_FRAG_PREAMBLE_HEAD
    + (options?.grainsFullScan ? VEL_FRAG_PREAMBLE_GRAINS_SCAN + VEL_FRAG_PREAMBLE_GRAINS_CELL : '')
    + VEL_FRAG_PREAMBLE_MID
    + (options?.flip3dCouple ? VEL_FRAG_PREAMBLE_FLIP3D : '')
    + (options?.steeringSeek ? VEL_FRAG_PREAMBLE_STEERING : '')
    + (options?.sphAkinci ? VEL_FRAG_PREAMBLE_AKINCI : '')
    + (options?.attractor2 ? VEL_FRAG_PREAMBLE_ATTRACTOR2 : '')
    + (options?.attractor3 ? VEL_FRAG_PREAMBLE_ATTRACTOR3 : '')
    + (options?.attractor4 ? VEL_FRAG_PREAMBLE_ATTRACTOR4 : '')
    + VEL_FRAG_PREAMBLE_TAIL;
}

export const VEL_FRAG_PREAMBLE = buildVelocityPreamble();
export const VEL_FRAG_PREAMBLE_PHASE19 = buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true });
export const VEL_FRAG_PREAMBLE_PHASE20 = buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true });
export const VEL_FRAG_PREAMBLE_PHASE24 = buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true });
export const VEL_FRAG_PREAMBLE_PHASE27 = buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true });
export const VEL_FRAG_PREAMBLE_PHASE29 = buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true, attractor3: true, attractor4: true });
