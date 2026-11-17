import React from 'react';
import { EffectComposer, Bloom, BrightnessContrast, ChromaticAberration, DepthOfField, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getOrderedActivePostFxStageIds } from '../lib/postFxStack';
import { FeedbackPass } from './feedbackPass';
import { KaleidoscopePass } from './kaleidoscopePass';
import { SlitScanPass } from './slitScanPass';
import { RadialBlurPass } from './radialBlurPass';
import { LightFxPass } from './lightFxPass';
import { OutputGradePass } from './outputGradePass';
import { PosterizePass, OrderedDitherPass, HalftonePass } from './toneGradePasses';
import { EdgeDetectPass } from './edgeDetectPass';
import { DisplacePass } from './displacePass';
import { getGradImageTexture } from '../lib/gradImageTexture';
import { displaceChannelIndex } from '../lib/postFxMath';

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
  const radialBlurPass = React.useMemo(() => new RadialBlurPass(), []);
  React.useEffect(() => () => radialBlurPass.dispose(), [radialBlurPass]);
  radialBlurPass.strength = config.postRadialBlurStrength;
  const lightFxPass = React.useMemo(() => new LightFxPass(), []);
  React.useEffect(() => () => lightFxPass.dispose(), [lightFxPass]);
  lightFxPass.lightPos.set(config.postLightX, config.postLightY);
  lightFxPass.shineEnabled = config.postShineEnabled;
  lightFxPass.shineIntensity = config.postShineIntensity;
  lightFxPass.shineLength = config.postShineLength;
  lightFxPass.shineThreshold = config.postShineThreshold;
  lightFxPass.starglowEnabled = config.postStarglowEnabled;
  lightFxPass.starglowIntensity = config.postStarglowIntensity;
  lightFxPass.starglowLength = config.postStarglowLength;
  lightFxPass.starglowThreshold = config.postStarglowThreshold;
  lightFxPass.starglowDiagonal = config.postStarglowDiagonal;
  lightFxPass.starglowShimmer = config.postStarglowShimmer;
  lightFxPass.starglowShimmerSpeed = config.postStarglowShimmerSpeed;
  lightFxPass.luxEnabled = config.postLuxEnabled;
  lightFxPass.luxIntensity = config.postLuxIntensity;
  lightFxPass.luxSize = config.postLuxSize;
  lightFxPass.luxConeLength = config.postLuxConeLength;
  lightFxPass.luxConeAngle = config.postLuxConeAngle;
  lightFxPass.luxConeSpread = config.postLuxConeSpread;
  const outputGradePass = React.useMemo(() => new OutputGradePass(), []);
  React.useEffect(() => () => outputGradePass.dispose(), [outputGradePass]);
  outputGradePass.exposure = config.postExposure;
  outputGradePass.aces = config.postToneMapping === 'aces';
  outputGradePass.brandEnabled = config.postBrandColorEnabled;
  outputGradePass.brandColor.set(config.postBrandColor || '#000000');
  // Phase AD passes: tone grade trio, Sobel edge, image displace.
  const posterizePass = React.useMemo(() => new PosterizePass(), []);
  React.useEffect(() => () => posterizePass.dispose(), [posterizePass]);
  posterizePass.levels = config.postPosterizeLevels;
  const ditherPass = React.useMemo(() => new OrderedDitherPass(), []);
  React.useEffect(() => () => ditherPass.dispose(), [ditherPass]);
  ditherPass.strength = config.postDitherStrength;
  const halftonePass = React.useMemo(() => new HalftonePass(), []);
  React.useEffect(() => () => halftonePass.dispose(), [halftonePass]);
  halftonePass.cellSize = config.postHalftoneCellSize;
  halftonePass.angle = config.postHalftoneAngle;
  const edgeDetectPass = React.useMemo(() => new EdgeDetectPass(), []);
  React.useEffect(() => () => edgeDetectPass.dispose(), [edgeDetectPass]);
  edgeDetectPass.threshold = config.postEdgeThreshold;
  edgeDetectPass.mode = config.postEdgeMode;
  const displacePass = React.useMemo(() => new DisplacePass(), []);
  React.useEffect(() => () => displacePass.dispose(), [displacePass]);
  displacePass.amount = config.postDisplaceAmount;
  displacePass.channelIndex = displaceChannelIndex(config.postDisplaceChannel);
  if (config.postDisplaceEnabled) {
    const gradState = getGradImageTexture(config.gpgpuGradImageSource);
    displacePass.mapTexture = gradState.texture;
    displacePass.mapReady = gradState.ready;
  } else {
    displacePass.mapTexture = null;
    displacePass.mapReady = false;
  }

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
          case 'displace':
            return <primitive key={stage} object={displacePass} />;
          case 'feedback':
            return <primitive key={stage} object={feedbackPass} />;
          case 'posterize':
            return <primitive key={stage} object={posterizePass} />;
          case 'ordered-dither':
            return <primitive key={stage} object={ditherPass} />;
          case 'halftone':
            return <primitive key={stage} object={halftonePass} />;
          case 'edge-detect':
            return <primitive key={stage} object={edgeDetectPass} />;
          case 'radial-blur':
            return <primitive key={stage} object={radialBlurPass} />;
          case 'light-fx':
            return <primitive key={stage} object={lightFxPass} />;
          case 'output-grade':
            return <primitive key={stage} object={outputGradePass} />;
          default:
            return null;
        }
      })}
    </EffectComposer>
  );
};
