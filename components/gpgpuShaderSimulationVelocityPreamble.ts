import { PYRO_GRID_SAMPLING, PYRO_GRID_UNIFORMS, PYRO_GRID_WORLD } from './gpgpuShaderPyroGrid';

// ── Velocity sim fragment, part 1 of 5: preamble: precision + all uniform declarations ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
export const VEL_FRAG_PREAMBLE = /* glsl */ `
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
  // Vellum (Phase AR): the pressure force + velocity damping
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
  varying vec2 vUv;

`;
