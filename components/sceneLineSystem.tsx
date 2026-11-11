import React, { useRef } from 'react';
import * as THREE from 'three';
import type { LineSystemProps } from './sceneLineSystemShared';
import { useLineSystemRuntime } from './sceneLineSystemRuntime';
import { LineSystemRender } from './sceneLineSystemRender';

export const LineSystem: React.FC<LineSystemProps> = (props) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const brushRef = useRef<THREE.Mesh>(null);
  const { lineData, layerConnectionStyle } = useLineSystemRuntime(props, lineRef, brushRef);
  if (!lineData) return null;
  return <LineSystemRender config={props.config} lineData={lineData} layerConnectionStyle={layerConnectionStyle} uniforms={props.uniforms} lineRef={lineRef} brushRef={brushRef} />;
};
