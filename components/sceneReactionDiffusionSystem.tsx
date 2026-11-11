import React from 'react';
import type { ReactionDiffusionSystemProps } from './sceneReactionDiffusionSystemShared';
import { ReactionDiffusionSystemRender } from './sceneReactionDiffusionSystemRender';
import { useReactionDiffusionRuntime } from './sceneReactionDiffusionSystemRuntime';

export const ReactionDiffusionSystem: React.FC<ReactionDiffusionSystemProps> = (props) => {
  const { displayMaterial, planeSize, zOffset, mode, source } = useReactionDiffusionRuntime(props);
  return <ReactionDiffusionSystemRender displayMaterial={displayMaterial} planeSize={planeSize} zOffset={zOffset} mode={mode} source={source} />;
};
