import React from 'react';
import { EffectComposer, Bloom, BrightnessContrast, ChromaticAberration, DepthOfField, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getOrderedActivePostFxStageIds } from '../lib/postFxStack';
import { FeedbackPass } from './feedbackPass';
import { KaleidoscopePass } from './kaleidoscopePass';
import { SlitScanPass } from './slitScanPass';

export const AppScenePostFx: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const orderedPostFxStages = React.useMemo(() => getOrderedActivePostFxStageIds(config), [config]);
  const feedbackPass = React.useMemo(() => new FeedbackPass(), []);
  React.useEffect(() => () => feedbackPass.dispose(), [feedbackPass]);
  feedbackPass.decay = config.postFeedbackDecay;
  feedbackPass.zoom = config.postFeedbackZoom;
  feedbackPass.rotation = config.postFeedbackRotation;
  const kaleidoscopePass = React.useMemo(() => new KaleidoscopePass(), []);
  React.useEffect(() => () => kaleidoscopePass.dispose(), [kaleidoscopePass]);
  kaleidoscopePass.segments = config.postKaleidoscopeSegments;
  kaleidoscopePass.rotation = config.postKaleidoscopeRotation;
  const slitScanPass = React.useMemo(() => new SlitScanPass(), []);
  React.useEffect(() => () => slitScanPass.dispose(), [slitScanPass]);
  slitScanPass.bands = config.postSlitScanBands;
  slitScanPass.cycle = config.postSlitScanCycle;

  if (orderedPostFxStages.length === 0) {
    return null;
  }

  return (
    <EffectComposer>
      {orderedPostFxStages.map((stage) => {
        switch (stage) {
          case 'brightness-contrast':
            return (
              <BrightnessContrast
                key={stage}
                brightness={config.postBrightness}
                contrast={config.postContrastAmount}
              />
            );
          case 'noise':
            return (
              <Noise
                key={stage}
                premultiply
                opacity={config.postNoiseOpacity}
                blendFunction={BlendFunction.NORMAL}
              />
            );
          case 'bloom':
            return (
              <Bloom
                key={stage}
                intensity={config.postBloomIntensity}
                radius={config.postBloomRadius}
                luminanceThreshold={config.postBloomThreshold}
                luminanceSmoothing={0.1}
                mipmapBlur
              />
            );
          case 'chromatic-aberration':
            return (
              <ChromaticAberration
                key={stage}
                blendFunction={BlendFunction.NORMAL}
                offset={new THREE.Vector2(config.postChromaticAberrationOffset, config.postChromaticAberrationOffset)}
                radialModulation={false}
                modulationOffset={0}
              />
            );
          case 'depth-of-field':
            return (
              <DepthOfField
                key={stage}
                focusDistance={config.postDofFocusDistance}
                focalLength={config.postDofFocalLength}
                bokehScale={config.postDofBokehScale}
              />
            );
          case 'vignette':
            return (
              <Vignette
                key={stage}
                eskil={false}
                offset={config.postVignetteOffset}
                darkness={config.postVignetteDarkness}
              />
            );
          case 'kaleidoscope':
            return <primitive key={stage} object={kaleidoscopePass} />;
          case 'slit-scan':
            return <primitive key={stage} object={slitScanPass} />;
          case 'feedback':
            return <primitive key={stage} object={feedbackPass} />;
          default:
            return null;
        }
      })}
    </EffectComposer>
  );
};
