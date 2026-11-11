import type { RenderModeDefinition } from './renderModeRegistryShared';
import { getGpgpuPlan, hasGpgpuCore } from './renderModeRegistryShared';
import { doesGpgpuRouteRenderMetaball, getGpgpuRoute } from './sceneRenderRouting';

export const RENDER_MODE_GPGPU_MODES: RenderModeDefinition[] = [
  {
      id: 'gpgpu-points',
      label: 'GPGPU Point Cloud',
      category: 'particles',
      support: 'stable',
      description: 'GPU particle core rendered as point sprites.',
      activeWhen: (config) => hasGpgpuCore(config),
    },
  {
      id: 'gpgpu-instanced-solids',
      label: 'GPGPU Instanced Solids',
      category: 'instanced solids',
      support: 'stable',
      description: 'GPU particles rendered as cubes, tetrahedra, octahedra, or icosahedra.',
      activeWhen: (config) => getGpgpuPlan(config).instancedSolids,
    },
  {
      id: 'gpgpu-streak-lines',
      label: 'GPGPU Streak Lines',
      category: 'lines',
      support: 'stable',
      description: 'Velocity-driven line streak rendering from GPU particles.',
      activeWhen: (config) => getGpgpuPlan(config).streakLines,
    },
  {
      id: 'gpgpu-ribbons',
      label: 'GPGPU Ribbon Trails',
      category: 'ribbons',
      support: 'experimental',
      description: 'Quad-strip ribbons generated from particle trail history.',
      activeWhen: (config) => getGpgpuPlan(config).ribbons,
    },
  {
      id: 'gpgpu-tubes',
      label: 'GPGPU Tube Trails',
      category: 'tubes',
      support: 'heavy',
      description: 'Circular trail tubes extruded from GPU particle paths.',
      activeWhen: (config) => getGpgpuPlan(config).tubes,
    },
  {
      id: 'gpgpu-smooth-tubes',
      label: 'GPGPU Smooth Tubes',
      category: 'tubes',
      support: 'heavy',
      description: 'Catmull-Rom smoothed subset tubes for thicker volumetric motion.',
      activeWhen: (config) => getGpgpuPlan(config).smoothTubes,
    },
  {
      id: 'gpgpu-metaballs',
      label: 'Metaball Surface',
      category: 'metaballs',
      support: 'heavy',
      description: 'Marching Cubes isosurface generated from GPU particle positions.',
      activeWhen: (config) => doesGpgpuRouteRenderMetaball(getGpgpuRoute(config), config),
    },
  {
      id: 'gpgpu-volumetric',
      label: 'Volumetric Ray March',
      category: 'volumetric',
      support: 'heavy',
      description: 'Particle field rendered as a ray-marched density volume.',
      activeWhen: (config) => getGpgpuPlan(config).volumetric,
    },
];
