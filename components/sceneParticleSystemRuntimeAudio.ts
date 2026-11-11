import * as THREE from 'three';
import type { ParticleConfig } from '../types';
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
    const bassInput = audioRef.current.bass * config.audioBeatScale;
    const trebleInput = audioRef.current.treble * config.audioJitterScale;
    const pulseInput = audioRef.current.pulse * config.audioPulseScale;
    const morphInput = audioRef.current.pulse * config.audioMorphScale;
    const shatterInput = (trebleInput * 0.75 + pulseInput * 0.35) * config.audioShatterScale;
    const twistInput = (bassInput * 0.6 + pulseInput * 0.9) * config.audioTwistScale;
    const bendInput = (trebleInput * 0.55 + pulseInput * 0.7) * config.audioBendScale;
    const warpInput = (bassInput * 0.35 + trebleInput * 0.35 + pulseInput) * config.audioWarpScale;
    const bandAInput = audioRef.current.bandA;
    const bandBInput = audioRef.current.bandB;

    mat.uniforms.uAudioBass.value = bassInput;
    mat.uniforms.uAudioTreble.value = trebleInput;
    mat.uniforms.uAudioBassMotion.value = bassInput * config.audioBassMotionScale;
    mat.uniforms.uAudioTrebleMotion.value = trebleInput * config.audioTrebleMotionScale;
    mat.uniforms.uAudioBassSize.value = bassInput * config.audioBassSizeScale;
    mat.uniforms.uAudioTrebleSize.value = trebleInput * config.audioTrebleSizeScale;
    mat.uniforms.uAudioBassAlpha.value = bassInput * config.audioBassAlphaScale;
    mat.uniforms.uAudioTrebleAlpha.value = trebleInput * config.audioTrebleAlphaScale;
    mat.uniforms.uAudioBassLine.value = bassInput * config.audioLineScale;
    mat.uniforms.uAudioTrebleLine.value = trebleInput * config.audioLineScale;
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
