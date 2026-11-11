import type { Layer2Type } from '../types';
import { getMotionGroupName } from '../components/motionCatalog';
import { DEFAULTS_BY_GROUP } from './motionArchitectureDefaults';
import { OVERRIDES as SYSTEM_OVERRIDES } from './motionArchitectureOverridesSystems';
import { OVERRIDES as EXPRESSION_OVERRIDES_A } from './motionArchitectureOverridesExpressionsA';
import { OVERRIDES as EXPRESSION_OVERRIDES_B } from './motionArchitectureOverridesExpressionsB';

export type { MotionArchitecture, MotionDriver, TemporalBehavior, EditingProfile } from './motionArchitectureTypes';

const OVERRIDES = {
  ...SYSTEM_OVERRIDES,
  ...EXPRESSION_OVERRIDES_A,
  ...EXPRESSION_OVERRIDES_B,
};

export function getMotionArchitecture(mode: Layer2Type) {
  const family = getMotionGroupName(mode);
  const defaults = DEFAULTS_BY_GROUP[family];
  const override = OVERRIDES[mode] ?? {};
  return {
    id: mode,
    family,
    ...defaults,
    ...override,
  };
}
