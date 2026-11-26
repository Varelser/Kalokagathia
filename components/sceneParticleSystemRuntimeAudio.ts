import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { resolveAudioRoutingGraph, resolveAudioRoutingInputs } from '../lib/audioRouting';
import { resolveAudioSceneGraph, resolveAudioSceneOutputs } from '../lib/audioSceneGraph';
import type { ParticleSystemAudioRef } from './sceneParticleSystemRuntimeTypes';

export function applyParticleAudioUniforms(
  mat: THREE.ShaderMaterial,
  config: ParticleConfig,
  audioRef: ParticleSystemAudioRef,
  prevAudioEnabledRef: { current: boolean },
) {
  const audioEnabledChanged = prevAudioEnabledRef.current !== config.audioEnabled;
  prevAudioEnabledRef.current = config.audioEnabled;

  if (config.audioEnabled) {
    // TD §7 stage 1: the wiring lives in lib/audioRouting.ts
    // as data (config key audioRoutingGraph; '' = the default
    // graph, which reproduces the legacy fixed formulas
    // bit-identically — pinned by the phase33 test).
    const inputs = resolveAudioRoutingInputs(
      resolveAudioRoutingGraph(config.audioRoutingGraph),
      audioRef.current,
      config,
    );
    const bassInput = inputs.bass;
    const trebleInput = inputs.treble;
    const pulseInput = inputs.pulse;
    const morphInput = inputs.morph;
    const shatterInput = inputs.shatter;
    const twistInput = inputs.twist;
    const bendInput = inputs.bend;
    const warpInput = inputs.warp;
    const bandAInput = inputs.bandA;
    const bandBInput = inputs.bandB;

    mat.uniforms.uAudioBass.value = bassInput;
    mat.uniforms.uAudioTreble.value = trebleInput;
    mat.uniforms.uAudioBassMotion.value = bassInput * config.audioBassMotionScale;
    mat.uniforms.uAudioTrebleMotion.value = trebleInput * config.audioTrebleMotionScale;
    mat.uniforms.uAudioBassSize.value = bassInput * config.audioBassSizeScale;
    mat.uniforms.uAudioTrebleSize.value = trebleInput * config.audioTrebleSizeScale;
    mat.uniforms.uAudioBassAlpha.value = bassInput * config.audioBassAlphaScale;
    mat.uniforms.uAudioTrebleAlpha.value = trebleInput * config.audioTrebleAlphaScale;
    // TD §7 stage 2: the line uniforms read the scene graph's
    // line output, whose sources are the stage-1 inputs above
    // (the legacy wiring read those inputs directly; with the
    // default scene graph this is bit-identical).
    const lineParts = resolveAudioSceneOutputs(
      resolveAudioSceneGraph(config.audioSceneGraph),
      audioRef.current,
      inputs,
      config,
    ).line.parts;
    mat.uniforms.uAudioBassLine.value = lineParts.bass * config.audioLineScale;
    mat.uniforms.uAudioTrebleLine.value = lineParts.treble * config.audioLineScale;
    mat.uniforms.uAudioBandAMotion.value = bandAInput * config.audioBandAMotionScale;
    mat.uniforms.uAudioBandASize.value = bandAInput * config.audioBandASizeScale;
    mat.uniforms.uAudioBandAAlpha.value = bandAInput * config.audioBandAAlphaScale;
    mat.uniforms.uAudioBandBMotion.value = bandBInput * config.audioBandBMotionScale;
    mat.uniforms.uAudioBandBSize.value = bandBInput * config.audioBandBSizeScale;
    mat.uniforms.uAudioBandBAlpha.value = bandBInput * config.audioBandBAlphaScale;
    mat.uniforms.uAudioPulse.value = pulseInput;
    mat.uniforms.uAudioMorph.value = morphInput;
    mat.uniforms.uAudioShatter.value = shatterInput;
    mat.uniforms.uAudioTwist.value = twistInput;
    mat.uniforms.uAudioBend.value = bendInput;
    mat.uniforms.uAudioWarp.value = warpInput;
    return;
  }

  if (!audioEnabledChanged) return;
  mat.uniforms.uAudioBass.value = 0;
  mat.uniforms.uAudioTreble.value = 0;
  mat.uniforms.uAudioBassMotion.value = 0;
  mat.uniforms.uAudioTrebleMotion.value = 0;
  mat.uniforms.uAudioBassSize.value = 0;
  mat.uniforms.uAudioTrebleSize.value = 0;
  mat.uniforms.uAudioBassAlpha.value = 0;
  mat.uniforms.uAudioTrebleAlpha.value = 0;
  mat.uniforms.uAudioBassLine.value = 0;
  mat.uniforms.uAudioTrebleLine.value = 0;
  mat.uniforms.uAudioBandAMotion.value = 0;
  mat.uniforms.uAudioBandASize.value = 0;
  mat.uniforms.uAudioBandAAlpha.value = 0;
  mat.uniforms.uAudioBandBMotion.value = 0;
  mat.uniforms.uAudioBandBSize.value = 0;
  mat.uniforms.uAudioBandBAlpha.value = 0;
  mat.uniforms.uAudioPulse.value = 0;
  mat.uniforms.uAudioMorph.value = 0;
  mat.uniforms.uAudioShatter.value = 0;
  mat.uniforms.uAudioTwist.value = 0;
  mat.uniforms.uAudioBend.value = 0;
  mat.uniforms.uAudioWarp.value = 0;
}
