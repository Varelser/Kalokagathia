export interface ParticleConfigGpgpu {
  gpgpuEnabled: boolean;
  gpgpuCount: number;
  gpgpuGravity: number;
  gpgpuTurbulence: number;
  gpgpuBounce: number;
  gpgpuBounceRadius: number;
  gpgpuSeed: number;
  gpgpuCustomForceEnabled: boolean;
  gpgpuCustomForceCode: string;
  gpgpuSize: number;
  gpgpuSpeed: number;
  gpgpuColor: string;
  gpgpuOpacity: number;
  gpgpuAudioReactive: boolean;
  gpgpuAudioBlast: number;
  // Trail
  gpgpuTrailEnabled: boolean;
  gpgpuTrailLength: number;
  gpgpuTrailFade: number;
  gpgpuTrailVelocityScale: number;
  // Instanced Geometry
  gpgpuGeomMode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone';
  gpgpuGeomVelocityAlign: boolean;
  gpgpuGeomScale: number;
  // Geometry material extras (Kinetix integration B1b): procedural
  // environment reflection approximation for the crystal look (no PMREM),
  // per-instance self-rotation, and velocity stretch (meshStretch).
  // All default to 0 = legacy geometry behaviour.
  gpgpuGeomEnvReflect: number;
  gpgpuGeomSpinSpeed: number;
  gpgpuGeomStretch: number;
  // Point sprite shape (Kinetix integration B1b): 'soft' keeps the legacy
  // gaussian disc; the other values select the shared SDF/mask shape set
  // that the layer point shader also exposes via sdfShape.
  gpgpuPointShape: 'soft' | 'sphere' | 'ring' | 'star' | 'hexagon' | 'diamond' | 'flare' | 'cloud' | 'bokeh' | 'crosshair' | 'iris' | 'lightning';
  // N-Body
  gpgpuNBodyEnabled: boolean;
  gpgpuNBodyStrength: number;
  gpgpuNBodyRepulsion: number;
  gpgpuNBodySoftening: number;
  gpgpuNBodySampleCount: number;
  // Velocity color gradient
  gpgpuVelColorEnabled: boolean;
  gpgpuVelColorHueMin: number;
  gpgpuVelColorHueMax: number;
  gpgpuVelColorSaturation: number;
  // Life/Age
  gpgpuAgeEnabled: boolean;
  gpgpuAgeMax: number;
  gpgpuAgeFadeIn: number;
  gpgpuAgeFadeOut: number;
  // Curl Noise
  gpgpuCurlEnabled: boolean;
  gpgpuCurlStrength: number;
  gpgpuCurlScale: number;
  // Curl field symmetry (Kinetix integration B1b): folds the field
  // sampling coordinates before the curl is evaluated (Kinetix
  // sampleSymmetricCurl). 'none' (default) samples exactly as before.
  gpgpuCurlSymmetry: 'none' | 'mirrorX' | 'radial4' | 'radial6' | 'octahedral';
  // Curl field flavour + octave composition (Kinetix integration B3):
  // 'curl' with 1 octave is the exact legacy field. 'ridged' applies
  // Kinetix's per-component ridge shaping to the curl vector, 'vortex'
  // adds a tangential swirl around Y (Kinetix computeCurlNoise modes).
  // Octaves 2/3 add the 2.13x / 4.27x curl octaves at 0.45 / 0.22 gain,
  // mirroring Kinetix's sampleCurlOctave composition.
  gpgpuCurlMode: 'curl' | 'ridged' | 'vortex';
  gpgpuCurlOctaves: number;
  // Boids
  gpgpuBoidsEnabled: boolean;
  gpgpuBoidsSeparation: number;
  gpgpuBoidsAlignment: number;
  gpgpuBoidsCohesion: number;
  gpgpuBoidsRadius: number;
  // Strange Attractor
  gpgpuAttractorEnabled: boolean;
  gpgpuAttractorType: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda' | 'chua';
  gpgpuAttractorStrength: number;
  gpgpuAttractorScale: number;
  // Vortex
  gpgpuVortexEnabled: boolean;
  gpgpuVortexStrength: number;
  gpgpuVortexTilt: number;
  // Wind
  gpgpuWindEnabled: boolean;
  gpgpuWindStrength: number;
  gpgpuWindX: number;
  gpgpuWindY: number;
  gpgpuWindZ: number;
  gpgpuWindGust: number;
  // Gravity Well
  gpgpuWellEnabled: boolean;
  gpgpuWellStrength: number;
  gpgpuWellSoftening: number;
  gpgpuWellOrbit: number;
  // Multiple wells (Kinetix integration B3, Kinetix attractorCount):
  // count 1 (default) is the exact legacy single well at the origin.
  // Counts 2-4 place that many wells on a slowly rotating ring of
  // radius gpgpuWellSpread, each with the same strength/softening and
  // tangential orbit term as the single well.
  gpgpuWellCount: number;
  gpgpuWellSpread: number;
  // Elastic Spring
  gpgpuElasticEnabled: boolean;
  gpgpuElasticStrength: number;
  // Magnetic (Lorentz)
  gpgpuMagneticEnabled: boolean;
  gpgpuMagneticStrength: number;
  gpgpuMagneticBX: number;
  gpgpuMagneticBY: number;
  gpgpuMagneticBZ: number;
  // SPH Fluid
  gpgpuSphEnabled: boolean;
  gpgpuSphPressure: number;
  gpgpuSphViscosity: number;
  gpgpuSphRadius: number;
  gpgpuSphRestDensity: number;
  // Vector Field
  gpgpuVFieldEnabled: boolean;
  gpgpuVFieldType: 'dipole' | 'saddle' | 'spiral' | 'source' | 'abc' | 'gyre' | 'worley';
  gpgpuVFieldStrength: number;
  gpgpuVFieldScale: number;
  // Lévy flight (rare heavy-tailed impulses)
  gpgpuLevyEnabled: boolean;
  gpgpuLevyStrength: number;
  gpgpuLevyRate: number;
  // Kuramoto phase synchronization (phase lives in velocity texture .w)
  gpgpuKuramotoEnabled: boolean;
  gpgpuKuramotoCoupling: number;
  gpgpuKuramotoSpread: number;
  gpgpuKuramotoRadius: number;
  gpgpuKuramotoInfluence: number;
  // Particle Life (species interaction matrix force)
  gpgpuParticleLifeEnabled: boolean;
  gpgpuParticleLifePreset: 'cells' | 'snakes' | 'community' | 'random';
  gpgpuParticleLifeSpecies: number;
  gpgpuParticleLifeStrength: number;
  gpgpuParticleLifeRadius: number;
  gpgpuParticleLifeFriction: number;
  gpgpuParticleLifeSeed: number;
  // Spring (to spawn pos)
  gpgpuSpringEnabled: boolean;
  gpgpuSpringStrength: number;
  // Morph Targets (Kinetix integration B1a): per-particle target points
  // baked into a float texture; the velocity shader pulls each particle
  // toward its assigned target with the Kinetix morph spring law.
  gpgpuMorphEnabled: boolean;
  gpgpuMorphTarget: 'trefoil' | 'torusKnot' | 'galaxy' | 'mobius' | 'geodesic' | 'crown' | 'blackhole' | 'klein' | 'cymatic' | 'gyroid' | 'dnaRibbon' | 'hypercube' | 'mandelbulb' | 'shell' | 'text' | 'image';
  gpgpuMorphStrength: number;
  gpgpuMorphScale: number;
  gpgpuMorphJitter: number;
  gpgpuMorphOrbitSpeed: number;
  // Verlet Integration
  gpgpuVerletEnabled: boolean;
  // SDF Collider ('gyroid' added by Kinetix integration B3: the TPMS
  // gyroid surface as a signed-distance collider, Kinetix 'gyro')
  gpgpuSdfEnabled: boolean;
  gpgpuSdfShape: 'sphere' | 'box' | 'torus' | 'capsule' | 'gyroid';
  gpgpuSdfX: number;
  gpgpuSdfY: number;
  gpgpuSdfZ: number;
  gpgpuSdfSize: number;
  gpgpuSdfBounce: number;
  // Floor plane bounce (Kinetix integration B3, Kinetix floorBounce /
  // floorY / floorRestitution): a horizontal floor at gpgpuFloorY that
  // reflects velocity in the velocity pass and clamps position in the
  // position pass. Disabled by default (the sphere bound was the only
  // GPGPU boundary before).
  gpgpuFloorEnabled: boolean;
  gpgpuFloorY: number;
  gpgpuFloorBounce: number;
  // Aux event emission (Kinetix integration B3): a second, smaller
  // GPU particle pool whose particles are spawned by EVENTS in the
  // main pool — deathBurst on main-particle death (age wrap, needs the
  // Life System), bounceSplash on sphere/floor bounce, sparkTrail as
  // continuous spark shedding from live main particles (Kinetix
  // auxMode). 'none' (default) runs no aux passes at all. The layer
  // Aux/Spark systems are unrelated and keep working as before.
  gpgpuAuxMode: 'none' | 'deathBurst' | 'bounceSplash' | 'sparkTrail';
  gpgpuAuxCount: number;
  gpgpuAuxIntensity: number;
  gpgpuAuxLife: number;
  gpgpuAuxSpeed: number;
  gpgpuAuxSize: number;
  // Emission Shape
  gpgpuEmitShape: 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone';
  // Color over Lifetime
  gpgpuAgeColorEnabled: boolean;
  gpgpuAgeColorYoung: string;
  gpgpuAgeColorOld: string;
  // Kinetix Color gradient (Kinetix integration B2): a 3-stop gradient
  // (start/mid/end) sampled through a 256px LUT in the point shader,
  // driven by life / velocity / spatial position / prism / image /
  // blackbody. Opt-in only — when disabled the legacy colour paths
  // (single colour, age 2-stop, velocity hue) run exactly as before.
  // The 'image' driver is declared here but falls back to the life
  // driver in the shader until an RGB media colour map exists
  // (MediaLumaMap carries luma only).
  gpgpuGradEnabled: boolean;
  gpgpuGradDriver: 'life' | 'velocity' | 'spatial' | 'prism' | 'image' | 'blackbody';
  gpgpuGradStart: string;
  gpgpuGradMid: string;
  gpgpuGradEnd: string;
  gpgpuGradPreset: string;
  gpgpuGradSpatialScale: number;
  // Point material blending (Kinetix integration B2): 'additive' is the
  // legacy default; 'normal' is the Kinetix Normal blend. The sort-based
  // transparency path still forces Normal while sorting is on.
  gpgpuBlendMode: 'additive' | 'normal';
  // Size over Lifetime
  gpgpuAgeSizeEnabled: boolean;
  gpgpuAgeSizeStart: number;
  gpgpuAgeSizeEnd: number;
  // Size curve shape (Kinetix integration B1b): 'linear' is the legacy
  // start->end interpolation; 'bell' rises end->start->end over the life
  // (sin(pi * t)), matching Kinetix's bell SizeCurve.
  gpgpuAgeSizeCurve: 'linear' | 'bell';
  // Mouse Force ('paint' added by Kinetix integration B3: particles
  // are continuously re-emitted at the pointer position — a
  // deterministic per-tick hash gate in the velocity/position passes
  // teleports a small fraction of the pool to the brush each tick and
  // gives them a fresh random velocity, Kinetix's pointer paint).
  gpgpuMouseEnabled: boolean;
  gpgpuMouseStrength: number;
  gpgpuMouseRadius: number;
  gpgpuMouseMode: 'attract' | 'repel' | 'swirl' | 'paint';
  gpgpuMousePaintRate: number;
  // Streak Rendering
  gpgpuStreakEnabled: boolean;
  gpgpuStreakLength: number;
  gpgpuStreakOpacity: number;
  // Sort-based Transparency (GPU Bitonic Sort)
  gpgpuSortEnabled: boolean;
  // Fluid Advection (Navier-Stokes simplified)
  gpgpuFluidEnabled: boolean;
  gpgpuFluidDiffuse: number;
  gpgpuFluidDecay: number;
  gpgpuFluidStrength: number;
  gpgpuFluidInfluence: number;
  gpgpuFluidScale: number;
  gpgpuFluidExtForce: boolean;
  // WebGPU Compute Backend
  gpgpuWebGPUEnabled: boolean;
  gpgpuExecutionPreference: 'auto' | 'webgl' | 'webgpu';
  // Metaballs (Marching Cubes isosurface)
  gpgpuMetaballEnabled: boolean;
  gpgpuMetaballResolution: number;
  gpgpuMetaballStrength: number;
  gpgpuMetaballIsoLevel: number;
  gpgpuMetaballColor: string;
  gpgpuMetaballStyle: 'classic' | 'glass' | 'hologram' | 'chrome' | 'halftone';
  gpgpuMetaballOpacity: number;
  gpgpuMetaballWireframe: boolean;
  gpgpuMetaballParticleLimit: number;
  gpgpuMetaballMetalness: number;
  gpgpuMetaballRoughness: number;
  gpgpuMetaballSubtract: number;
  gpgpuMetaballUpdateSkip: number;
  // Ribbon Trail
  gpgpuRibbonEnabled: boolean;
  gpgpuRibbonWidth: number;
  gpgpuRibbonTaper: number;
  gpgpuRibbonOpacity: number;
  gpgpuRibbonMaxSegLen: number;
  // Tube Trail (circular cross-section)
  gpgpuTubeEnabled: boolean;
  gpgpuTubeRadius: number;
  gpgpuTubeOpacity: number;
  // Smooth Tube (CatmullRom per-particle subset)
  gpgpuSmoothTubeEnabled: boolean;
  gpgpuSmoothTubeCount: number;
  gpgpuSmoothTubeRadius: number;
  gpgpuSmoothTubeHistory: number;
  gpgpuSmoothTubeColor: string;
  gpgpuSmoothTubeOpacity: number;
  // Volumetric Ray Marching
  gpgpuVolumetricEnabled: boolean;
  gpgpuVolumetricRadius: number;
  gpgpuVolumetricDensity: number;
  gpgpuVolumetricColor: string;
  gpgpuVolumetricOpacity: number;
  gpgpuVolumetricSteps: number;
}
