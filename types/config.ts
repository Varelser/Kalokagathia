import { ParticleConfigAmbient } from './configAmbient';
import { ParticleConfigAudio } from './configAudio';
import { ParticleConfigCore } from './configCore';
import { ParticleConfigGpgpu } from './configGpgpu';
import { ParticleConfigLayer1 } from './configLayer1';
import { ParticleConfigLayer2 } from './configLayer2';
import { ParticleConfigLayer3 } from './configLayer3';

export interface ParticleConfig extends
  ParticleConfigCore,
  ParticleConfigAudio,
  ParticleConfigLayer1,
  ParticleConfigLayer2,
  ParticleConfigLayer3,
  ParticleConfigAmbient,
  ParticleConfigGpgpu {}
