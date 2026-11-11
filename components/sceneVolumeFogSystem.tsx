import React from 'react';
import type { VolumeFogSystemProps } from './sceneVolumeFogSystemTypes';
import { useVolumeFogRuntime } from './sceneVolumeFogSystemRuntime';
import { VolumeFogSystemRender } from './sceneVolumeFogSystemRender';

export const VolumeFogSystem: React.FC<VolumeFogSystemProps> = (props) => {
  const runtime = useVolumeFogRuntime(props);
  return <VolumeFogSystemRender layerIndex={props.layerIndex} runtime={runtime} />;
};
