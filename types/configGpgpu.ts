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
  gpgpuMorphTarget: 'trefoil' | 'torusKnot' | 'galaxy' | 'mobius' | 'geodesic' | 'crown' | 'blackhole' | 'klein' | 'cymatic' | 'gyroid' | 'dnaRibbon' | 'hypercube' | 'mandelbulb' | 'shell' | 'text' | 'image' | 'svg' | 'obj' | 'terrain';
  // SVG import (Pro-2): the imported SVG document's source text. Like
  // the TextMap text it lives in the config so it persists with
  // projects / presets; the point cloud is re-sampled from it
  // deterministically at bake time (lib/svgMorph.ts).
  gpgpuMorphSvgSource: string;
  // OBJ import (Phase J): the imported Wavefront OBJ document's
  // source text, held in the config exactly like the SVG source; the
  // surface point cloud is re-sampled from it deterministically at
  // bake time (lib/objMorph.ts).
  gpgpuMorphObjSource: string;
  // OBJ sampling mode (Phase O): 'surface' (default) is the Phase J
  // area-weighted surface distribution, bit-identical to before;
  // 'vertices' places samples on the mesh vertices themselves;
  // 'volume' fills the interior of a closed mesh (a non-closed mesh
  // falls back to 'surface', which the UI states explicitly).
  gpgpuMorphObjSampleMode: 'surface' | 'vertices' | 'volume';
  // OBJ normal initial speed (Phase O): at (re)placement — the
  // simulation-start envelope and the age-respawn frame — particles
  // receive this velocity along their baked sample normal. 0
  // (default) disables the kick entirely (bit-identical legacy).
  gpgpuMorphObjNormalSpeed: number;
  gpgpuMorphStrength: number;
  gpgpuMorphScale: number;
  gpgpuMorphJitter: number;
  gpgpuMorphOrbitSpeed: number;
  // Replica grammar (Phase K): the baked morph cloud is split into
  // chained copies with cumulative translation / Y-rotation /
  // geometric-scale steps, plus a per-copy orbit phase offset — an
  // Echospace-style offset chain (lib/gpgpuMorphTargets.ts). Count 1
  // (the default) reproduces the legacy bake bit-for-bit. This is a
  // static bake-time grammar over one shared simulation: it does NOT
  // model Parent/Child dynamic child emitters (each copy would need
  // its own force/lifetime state).
  gpgpuMorphReplicaCount: number;
  gpgpuMorphReplicaSpacing: number;
  gpgpuMorphReplicaAxis: 'x' | 'y' | 'z';
  gpgpuMorphReplicaRotation: number;
  gpgpuMorphReplicaScaleStep: number;
  gpgpuMorphReplicaPhaseStep: number;
  // Replica age phase (Phase M): per-copy offset of the particle
  // lifecycle phase, as a fraction (0..1) of gpgpuAgeMax. Applied
  // to the initial age scatter and to the respawn restart age in
  // the position pass, keyed by the same contiguous replica blocks
  // as the bake. 0 (default) / count 1 reproduces the legacy
  // initial data and respawn behaviour bit-for-bit.
  gpgpuMorphReplicaAgeStep: number;
  // Terrain (Phase L, Mir-style): the 'terrain' morph target places
  // particles on a seeded fractal height field (value-noise fBm,
  // lib/gpgpuMorphTargets.ts). The field is a pure function of
  // (gpgpuSeed, terrain seed, amplitude, frequency, octaves), so the
  // bake stays deterministic. Height-driven colour comes from the
  // gradient 'height' driver below. These keys only take effect when
  // gpgpuMorphTarget is 'terrain'; every other target ignores them.
  gpgpuMorphTerrainAmplitude: number;
  gpgpuMorphTerrainFrequency: number;
  gpgpuMorphTerrainOctaves: number;
  gpgpuMorphTerrainSeed: number;
  // Terrain Mesh (Phase P, Mir-style): a polygon mesh system that
  // shares the terrain height field above (terrainHeightAt with the
  // same field-seed mixing as the morph bake, so the mesh landscape
  // and the 'terrain' point terrain are the same landscape). The
  // mesh is a plain scene object displaced on a 128x128 grid with
  // computeVertexNormals shading; it is NOT part of the GPGPU
  // simulation and mounts only when enabled. Disabled (default)
  // mounts nothing and the render is bit-identical to before.
  gpgpuTerrainMeshEnabled: boolean;
  /** Display form: shaded polygon mesh / wireframe / points cloud
   *  over the same displaced geometry. */
  gpgpuTerrainMeshDisplay: 'shaded' | 'wireframe' | 'points';
  /** Tunnel mode: wrap the field around a cylinder (x becomes the
   *  circumference, z the depth, height the radial relief) and view
   *  it from inside. The field is cross-fade tiled on both wrapped
   *  axes so the wrap is seamless. */
  gpgpuTerrainMeshTunnel: boolean;
  /** Surface texture: 'none' (default, plain shaded colour),
   *  'gradient' / 'grid' procedural monochrome canvas textures, or
   *  'image' (the Horizon background image source, reused as map). */
  gpgpuTerrainMeshTexture: 'none' | 'gradient' | 'grid' | 'image';
  /** Mesh size multiplier over the morph world scale (the point
   *  terrain's extent), 1 = same footprint as the point terrain. */
  gpgpuTerrainMeshScale: number;
  gpgpuTerrainMeshOpacity: number;
  /** Shading brightness multiplier (material colour / light gain). */
  gpgpuTerrainMeshBrightness: number;
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
  // blackbody / height (Phase L: world Y, for terrain-style height
  // shading; reuses gpgpuGradSpatialScale as its scale). Opt-in only
  // — when disabled the legacy colour paths
  // (single colour, age 2-stop, velocity hue) run exactly as before.
  // The 'image' driver samples a user image (gpgpuGradImageSource)
  // by particle position in the point shader; while no image is set
  // (or it is still loading) it falls back to the life driver, and
  // the UI says so explicitly.
  gpgpuGradEnabled: boolean;
  gpgpuGradDriver: 'life' | 'velocity' | 'spatial' | 'prism' | 'image' | 'blackbody' | 'height';
  gpgpuGradStart: string;
  gpgpuGradMid: string;
  gpgpuGradEnd: string;
  gpgpuGradPreset: string;
  gpgpuGradSpatialScale: number;
  // Source image for the 'image' gradient driver, held in the config
  // as a data URL (downscaled to <=256px by the UI) so it persists
  // with presets / projects like the SVG morph source does. Empty
  // string = no image (the driver falls back to life).
  gpgpuGradImageSource: string;
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
