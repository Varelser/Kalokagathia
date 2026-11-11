import type { Layer2Type, Layer3Source } from '../types';
import type { MotionGroupName } from '../components/motionCatalog';

export type MotionDriver =
  | 'field'
  | 'orbit'
  | 'oscillation'
  | 'chaos'
  | 'structural'
  | 'transform'
  | 'growth'
  | 'deposition'
  | 'volumetric';

export type TemporalBehavior = 'steady' | 'oscillatory' | 'emergent' | 'decay' | 'pulsed';
export type EditingProfile = 'explore' | 'shape' | 'weave' | 'grow' | 'accumulate' | 'atmosphere';

export interface MotionArchitecture {
  id: Layer2Type;
  family: MotionGroupName;
  driver: MotionDriver;
  temporalBehavior: TemporalBehavior;
  editingProfile: EditingProfile;
  depictionHint: string;
  recommendedSources: Layer3Source[];
  editingFocus: string[];
}
