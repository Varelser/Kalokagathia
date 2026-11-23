import React from 'react';
import { EffectComposer, Bloom, BrightnessContrast, ChromaticAberration, DepthOfField, Noise, Vignette } from '@react-three/postprocessing';
import { useThree } from '@react-three/fiber';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getOrderedActivePostFxStageIds } from '../lib/postFxStack';
import { SAFE_MODE_HEAVY_POST_STAGES, useSafeMode } from '../lib/safeMode';
import { compileCheckShader } from '../lib/glslInjection';
import {
  buildCustomPostGlslHarness,
  setCustomPostGlslStatus,
  validateCustomPostGlslCode,
  CUSTOM_POST_GLSL_CHECK_VERTEX,
} from '../lib/customPostGlsl';
import { FeedbackPass } from './feedbackPass';
import { KaleidoscopePass } from './kaleidoscopePass';
import { SlitScanPass } from './slitScanPass';
import { RadialBlurPass } from './radialBlurPass';
import { LightFxPass } from './lightFxPass';
import { OutputGradePass } from './outputGradePass';
import { ChromaKeyPass } from './chromaKeyPass';
import { BrushAccumPass } from './brushAccumPass';
import { PosterizePass, OrderedDitherPass, HalftonePass } from './toneGradePasses';
import { EdgeDetectPass } from './edgeDetectPass';
import { EdgeCapturePass } from './edgeCapturePass';
import { DisplacePass } from './displacePass';
import { FractalPass } from './fractalPass';
import { CompositePass } from './compositePass';
import { CustomGlslPostPass } from './customGlslPostPass';
import { GlitchPass } from './glitchPass';
import { PixelSortPass } from './pixelSortPass';
import { CellularPass } from './cellularPass';
import { MoirePass } from './moirePass';
import { getGradImageTexture } from '../lib/gradImageTexture';
import { resolveMapSourceTexture } from '../lib/terrainDerivedMaps';
import { displaceChannelIndex } from '../lib/postFxMath';
import { afMapSource, parseAfMapSource, resolveAfMapSourceTexture } from '../lib/mapSourceSupply';
import { compositeBlendModeIndex } from '../lib/compositeBlend';

export const AppScenePostFx: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const safeMode = useSafeMode();
  const orderedPostFxStages = React.useMemo(() => {
    const stages = getOrderedActivePostFxStageIds(config);
    // Safe mode (Phase 15, Abyssal B): at ladder level >= 2 the
    // heavy stages are dropped as a runtime override — the config
    // itself is never rewritten.
    if (safeMode.step.post !== 'reduced') return stages;
    return stages.filter((stage) => !SAFE_MODE_HEAVY_POST_STAGES.has(stage));
  }, [config, safeMode.step.post]);
  const feedbackPass = React.useMemo(() => new FeedbackPass(), []);
  React.useEffect(() => () => feedbackPass.dispose(), [feedbackPass]);
  feedbackPass.decay = config.postFeedbackDecay;
  feedbackPass.zoom = config.postFeedbackZoom;
  feedbackPass.rotation = config.postFeedbackRotation;
  // Feedback mask (Phase AF): the raster mask source (image /
  // terrain-derived / text / path / edge) modulates the decay
  // spatially. Unready source → no modulation (legacy decay).
  if (config.postFeedbackMaskEnabled && config.gpgpuMaskSource) {
    const maskState = resolveMapSourceTexture(config.gpgpuMaskSource, config);
    feedbackPass.maskTexture = maskState.ready ? maskState.texture : null;
    feedbackPass.maskStrength = config.postFeedbackMaskStrength;
  } else {
    feedbackPass.maskTexture = null;
    feedbackPass.maskStrength = 0;
  }
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
  // Scene depth occlusion (Phase 16 stage 1): the pass binds the
  // shared depth capture itself while this is positive.
  lightFxPass.depthOcclusion = config.gpgpuDepthOcclusion;
  // Chroma key (Phase 15, TD §6): final delivery stage; exists
  // only while enabled in the stack order.
  const chromaKeyPass = React.useMemo(() => new ChromaKeyPass(), []);
  React.useEffect(() => () => chromaKeyPass.dispose(), [chromaKeyPass]);
  chromaKeyPass.keyColor.set(config.postChromaKeyColor || '#00ff00');
  chromaKeyPass.similarity = config.postChromaKeySimilarity;
  chromaKeyPass.smoothness = config.postChromaKeySmoothness;
  chromaKeyPass.spill = config.postChromaKeySpill;
  // Brush accumulation (Phase 15, 2D §6): dedicated ping-pong
  // accumulation of the brush line ribbons; exists only while
  // enabled in the stack order. The pass re-renders the scene's
  // brush layer itself, so it needs the live scene and camera.
  const brushAccumPass = React.useMemo(() => new BrushAccumPass(), []);
  React.useEffect(() => () => brushAccumPass.dispose(), [brushAccumPass]);
  brushAccumPass.decay = config.layer1BrushAccumDecay;
  brushAccumPass.strength = config.layer1BrushAccumStrength;
  brushAccumPass.sceneRoot = useThree((state) => state.scene);
  brushAccumPass.viewCamera = useThree((state) => state.camera);
  const outputGradePass = React.useMemo(() => new OutputGradePass(), []);
  React.useEffect(() => () => outputGradePass.dispose(), [outputGradePass]);
  outputGradePass.exposure = config.postExposure;
  outputGradePass.aces = config.postToneMapping === 'aces';
  outputGradePass.brandEnabled = config.postBrandColorEnabled;
  outputGradePass.brandColor.set(config.postBrandColor || '#000000');
  outputGradePass.reservedEnabled = config.postReservedPaletteEnabled;
  outputGradePass.reservedFloor = config.postReservedFloor;
  outputGradePass.reservedCeiling = config.postReservedCeiling;
  // Phase AD passes: tone grade trio, Sobel edge, image displace.
  const posterizePass = React.useMemo(() => new PosterizePass(), []);
  React.useEffect(() => () => posterizePass.dispose(), [posterizePass]);
  posterizePass.levels = config.postPosterizeLevels;
  const ditherPass = React.useMemo(() => new OrderedDitherPass(), []);
  React.useEffect(() => () => ditherPass.dispose(), [ditherPass]);
  ditherPass.strength = config.postDitherStrength;
  ditherPass.mode = config.postDitherMode;
  ditherPass.anchor = config.postDitherAnchor;
  ditherPass.viewCamera = useThree((state) => state.camera);
  const halftonePass = React.useMemo(() => new HalftonePass(), []);
  React.useEffect(() => () => halftonePass.dispose(), [halftonePass]);
  halftonePass.cellSize = config.postHalftoneCellSize;
  halftonePass.angle = config.postHalftoneAngle;
  const edgeDetectPass = React.useMemo(() => new EdgeDetectPass(), []);
  React.useEffect(() => () => edgeDetectPass.dispose(), [edgeDetectPass]);
  edgeDetectPass.threshold = config.postEdgeThreshold;
  edgeDetectPass.mode = config.postEdgeMode;
  // Edge supply capture (Phase AF): pass-through Sobel capture
  // feeding the `edge-output` map source; threshold shared with
  // the display edge pass, activation independent of it.
  const edgeCapturePass = React.useMemo(() => new EdgeCapturePass(), []);
  React.useEffect(() => () => edgeCapturePass.dispose(), [edgeCapturePass]);
  edgeCapturePass.threshold = config.postEdgeThreshold;
  // Escape-time fractal (Phase AL): stateless field pass; the
  // stage exists only while enabled with a non-zero mix.
  const fractalPass = React.useMemo(() => new FractalPass(), []);
  React.useEffect(() => () => fractalPass.dispose(), [fractalPass]);
  fractalPass.kind = config.postFractalKind;
  fractalPass.centerX = config.postFractalCenterX;
  fractalPass.centerY = config.postFractalCenterY;
  fractalPass.zoom = config.postFractalZoom;
  fractalPass.iterations = config.postFractalIterations;
  fractalPass.juliaX = config.postFractalJuliaX;
  fractalPass.juliaY = config.postFractalJuliaY;
  fractalPass.mixAmount = config.postFractalMix;
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
  // Composite (Phase AM): B is an AF supply texture; unready
  // source → bit-identical passthrough inside the pass.
  const compositePass = React.useMemo(() => new CompositePass(), []);
  React.useEffect(() => () => compositePass.dispose(), [compositePass]);
  compositePass.modeIndex = compositeBlendModeIndex(config.postCompositeMode);
  compositePass.mixAmount = config.postCompositeMix;
  if (config.postCompositeEnabled) {
    // The stored source parses through the shared AF parser
    // (Phase BJ: 'noise-field' joins the original three; an
    // unrecognised value keeps the AM fallback to the text
    // supply, exactly as the original ternary resolved it).
    const afKind = parseAfMapSource(config.postCompositeSource) ?? 'text';
    const layerState = resolveAfMapSourceTexture(afMapSource(afKind), config);
    compositePass.sourceTexture = layerState && layerState.ready ? layerState.texture : null;
  } else {
    compositePass.sourceTexture = null;
  }
  // Glitch (Phase AM): stateless apart from its frame counter.
  const glitchPass = React.useMemo(() => new GlitchPass(), []);
  React.useEffect(() => () => glitchPass.dispose(), [glitchPass]);
  glitchPass.amount = config.postGlitchAmount;
  glitchPass.bands = config.postGlitchBands;
  glitchPass.rate = config.postGlitchRate;
  // Pixel sort (Phase AM): stateless across frames.
  const pixelSortPass = React.useMemo(() => new PixelSortPass(), []);
  React.useEffect(() => () => pixelSortPass.dispose(), [pixelSortPass]);
  pixelSortPass.direction = config.postPixelSortDirection;
  pixelSortPass.low = config.postPixelSortLow;
  pixelSortPass.high = config.postPixelSortHigh;
  pixelSortPass.passes = config.postPixelSortPasses;
  // Cellular automaton (Phase AM): stateful; re-seeds when the
  // rule / cell size / seed threshold signature changes (and on
  // first enable, via the pass's initial seed request).
  const cellularPass = React.useMemo(() => new CellularPass(), []);
  React.useEffect(() => () => cellularPass.dispose(), [cellularPass]);
  cellularPass.rule = config.postCellularRule;
  cellularPass.cellSize = config.postCellularCellSize;
  cellularPass.seedThreshold = config.postCellularSeedThreshold;
  cellularPass.mixAmount = config.postCellularMix;
  const cellularSeedSigRef = React.useRef('');
  const cellularSeedSig = `${config.postCellularRule}|${config.postCellularCellSize}|${config.postCellularSeedThreshold}`;
  if (config.postCellularEnabled && cellularSeedSigRef.current !== cellularSeedSig) {
    cellularSeedSigRef.current = cellularSeedSig;
    cellularPass.requestSeed();
  }
  // Moire (Phase AW): stateless pattern-product field; the stage
  // exists only while enabled with a non-zero mix.
  const moirePass = React.useMemo(() => new MoirePass(), []);
  React.useEffect(() => () => moirePass.dispose(), [moirePass]);
  moirePass.pattern = config.postMoirePattern;
  moirePass.spacing = config.postMoireSpacing;
  moirePass.angle = config.postMoireAngle;
  moirePass.phase = config.postMoirePhase;
  moirePass.mixAmount = config.postMoireMix;
  // Custom GLSL post (Phase BX): validate + compile-check the
  // snippet against the live GL context, and only then swap it
  // into the pass. On any failure the previously working fragment
  // stays active and the panel shows the error via the status
  // store — the custom-force fallback rule, on the shared
  // injection foundation. The stage itself is inserted by the
  // stack only while an enabled, statically valid snippet is set.
  const customGlslPostPass = React.useMemo(() => new CustomGlslPostPass(), []);
  React.useEffect(() => () => customGlslPostPass.dispose(), [customGlslPostPass]);
  customGlslPostPass.lumaLock = config.postCustomGlslLumaLock;
  const gl = useThree((state) => state.gl);
  const appliedPostCodeRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const code = config.postCustomGlslEnabled ? config.postCustomGlslCode : '';
    if (!code.trim()) {
      if (appliedPostCodeRef.current !== null) {
        customGlslPostPass.setUserCode(null);
        appliedPostCodeRef.current = null;
      }
      setCustomPostGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedPostCodeRef.current === code) return;
    const validation = validateCustomPostGlslCode(code);
    if (!validation.ok) {
      setCustomPostGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      CUSTOM_POST_GLSL_CHECK_VERTEX,
      buildCustomPostGlslHarness(code),
    );
    if (!check.ok) {
      setCustomPostGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    customGlslPostPass.setUserCode(code);
    appliedPostCodeRef.current = code;
    setCustomPostGlslStatus({ state: 'active' });
  }, [config.postCustomGlslEnabled, config.postCustomGlslCode, gl, customGlslPostPass]);

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
          case 'fractal':
            return <primitive key={stage} object={fractalPass} />;
          case 'glitch':
            return <primitive key={stage} object={glitchPass} />;
          case 'pixel-sort':
            return <primitive key={stage} object={pixelSortPass} />;
          case 'cellular':
            return <primitive key={stage} object={cellularPass} />;
          case 'moire':
            return <primitive key={stage} object={moirePass} />;
          case 'composite':
            return <primitive key={stage} object={compositePass} />;
          case 'custom-glsl-post':
            return <primitive key={stage} object={customGlslPostPass} />;
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
          case 'edge-capture':
            return <primitive key={stage} object={edgeCapturePass} />;
          case 'radial-blur':
            return <primitive key={stage} object={radialBlurPass} />;
          case 'light-fx':
            return <primitive key={stage} object={lightFxPass} />;
          case 'output-grade':
            return <primitive key={stage} object={outputGradePass} />;
          case 'chroma-key':
            return <primitive key={stage} object={chromaKeyPass} />;
          case 'brush-accum':
            return <primitive key={stage} object={brushAccumPass} />;
          default:
            return null;
        }
      })}
    </EffectComposer>
  );
};
