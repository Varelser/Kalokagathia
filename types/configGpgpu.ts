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
  gpgpuGeomMode: 'point' | 'cube' | 'tetra' | 'octa' | 'icosa';
  gpgpuGeomVelocityAlign: boolean;
  gpgpuGeomScale: number;
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
  // Boids
  gpgpuBoidsEnabled: boolean;
  gpgpuBoidsSeparation: number;
  gpgpuBoidsAlignment: number;
  gpgpuBoidsCohesion: number;
  gpgpuBoidsRadius: number;
  // Strange Attractor
  gpgpuAttractorEnabled: boolean;
  gpgpuAttractorType: 'lorenz' | 'rossler' | 'thomas' | 'halvorsen' | 'chen' | 'lu' | 'aizawa' | 'sprott' | 'rabinovich' | 'dejong' | 'ikeda';
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
  // Verlet Integration
  gpgpuVerletEnabled: boolean;
  // SDF Collider
  gpgpuSdfEnabled: boolean;
  gpgpuSdfShape: 'sphere' | 'box' | 'torus' | 'capsule';
  gpgpuSdfX: number;
  gpgpuSdfY: number;
  gpgpuSdfZ: number;
  gpgpuSdfSize: number;
  gpgpuSdfBounce: number;
  // Emission Shape
  gpgpuEmitShape: 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone';
  // Color over Lifetime
  gpgpuAgeColorEnabled: boolean;
  gpgpuAgeColorYoung: string;
  gpgpuAgeColorOld: string;
  // Size over Lifetime
  gpgpuAgeSizeEnabled: boolean;
  gpgpuAgeSizeStart: number;
  gpgpuAgeSizeEnd: number;
  // Mouse Force
  gpgpuMouseEnabled: boolean;
  gpgpuMouseStrength: number;
  gpgpuMouseRadius: number;
  gpgpuMouseMode: 'attract' | 'repel' | 'swirl';
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
