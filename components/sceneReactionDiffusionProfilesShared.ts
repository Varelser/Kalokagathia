import type React from "react";
import type { ParticleConfig } from "../types";
import { REACTION_PROFILES } from "./sceneReactionDiffusionProfilesModes";

export type ReactionAudioRef = React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
export type ReactionLayerIndex = 2 | 3;
export type ReactionDiffusionSystemProps = {
  config: ParticleConfig;
  layerIndex: ReactionLayerIndex;
  audioRef: ReactionAudioRef;
  isPlaying: boolean;
};

export type ReactionMode = ParticleConfig["layer2Type"];
export type ReactionSource = ParticleConfig["layer2Source"];

export type ReactionProfile = {
  feedAdd: number;
  killAdd: number;
  dtMul: number;
  warpMul: number;
  flowAniso: number;
  diffusionA: number;
  diffusionB: number;
  reactionBoost: number;
  poolMix: number;
  colonyBands: number;
  cellScale: number;
  contourTightness: number;
  hueShift: number;
  lightnessShift: number;
  opacityMul: number;
  heightGain: number;
  ridgeGain: number;
  pitGain: number;
  wetness: number;
  scarStrength: number;
  bulge: number;
  rimPinch: number;
  shear: number;
  tiltX: number;
  tiltY: number;
  curl: number;
  depthBands: number;
  frontBias: number;
  seedRing: number;
  seedLedger: number;
  seedSweep: number;
  seedCanopy: number;
  seedColumn: number;
  seedTerrace: number;
  seedBlob: number;
};

export type ReactionSourceProfile = {
  bulgeAdd: number;
  rimPinchAdd: number;
  shearAdd: number;
  tiltXAdd: number;
  tiltYAdd: number;
  curlAdd: number;
  depthBandsAdd: number;
  frontBiasAdd: number;
  seedRingAdd: number;
  seedLedgerAdd: number;
  seedSweepAdd: number;
  seedCanopyAdd: number;
  seedColumnAdd: number;
  seedTerraceAdd: number;
  seedBlobAdd: number;
  hueShiftAdd: number;
  lightnessShiftAdd: number;
  opacityMul: number;
};

export const DEFAULT_REACTION_PROFILE: ReactionProfile = {
  feedAdd: 0,
  killAdd: 0,
  dtMul: 1,
  warpMul: 1,
  flowAniso: 1,
  diffusionA: 1,
  diffusionB: 0.5,
  reactionBoost: 1,
  poolMix: 0.28,
  colonyBands: 0.34,
  cellScale: 1,
  contourTightness: 1,
  hueShift: 0,
  lightnessShift: 0,
  opacityMul: 1,
  heightGain: 0.22,
  ridgeGain: 0.42,
  pitGain: 0.18,
  wetness: 0.18,
  scarStrength: 0.12,
  bulge: 0.18,
  rimPinch: 0.12,
  shear: 0.04,
  tiltX: 0,
  tiltY: 0,
  curl: 0.08,
  depthBands: 0.18,
  frontBias: 0.08,
  seedRing: 0.18,
  seedLedger: 0,
  seedSweep: 0.12,
  seedCanopy: 0.08,
  seedColumn: 0,
  seedTerrace: 0,
  seedBlob: 0.12,
};

export const DEFAULT_SOURCE_PROFILE: ReactionSourceProfile = {
  bulgeAdd: 0,
  rimPinchAdd: 0,
  shearAdd: 0,
  tiltXAdd: 0,
  tiltYAdd: 0,
  curlAdd: 0,
  depthBandsAdd: 0,
  frontBiasAdd: 0,
  seedRingAdd: 0,
  seedLedgerAdd: 0,
  seedSweepAdd: 0,
  seedCanopyAdd: 0,
  seedColumnAdd: 0,
  seedTerraceAdd: 0,
  seedBlobAdd: 0,
  hueShiftAdd: 0,
  lightnessShiftAdd: 0,
  opacityMul: 1,
};

export function resolveReactionParams(config: ParticleConfig, layerIndex: ReactionLayerIndex) {
  return layerIndex === 2 ? {
    color: config.layer2Color,
    spread: config.layer2SourceSpread,
    feed: config.layer2ReactionFeed,
    kill: config.layer2ReactionKill,
    scale: config.layer2ReactionScale,
    warp: config.layer2ReactionWarp,
    opacity: config.layer2ReactionOpacity,
    audioReactive: config.layer2ReactionAudioReactive,
    model: config.layer2ReactionModel,
    fhnEpsilon: config.layer2ReactionFhnEpsilon,
    fhnA: config.layer2ReactionFhnA,
    fhnB: config.layer2ReactionFhnB,
    fhnGain: config.layer2ReactionFhnGain ?? 1,
    leniaMu: config.layer2ReactionLeniaMu ?? 0.15,
    leniaSigma: config.layer2ReactionLeniaSigma ?? 0.016,
    leniaRadius: config.layer2ReactionLeniaRadius ?? 13,
    leniaDt: config.layer2ReactionLeniaDt ?? 0.1,
    leniaKernel: config.layer2ReactionLeniaKernel ?? 'ring',
    leniaGain: config.layer2ReactionLeniaGain ?? 1,
  } : {
    color: config.layer3Color,
    spread: config.layer3SourceSpread,
    feed: config.layer3ReactionFeed,
    kill: config.layer3ReactionKill,
    scale: config.layer3ReactionScale,
    warp: config.layer3ReactionWarp,
    opacity: config.layer3ReactionOpacity,
    audioReactive: config.layer3ReactionAudioReactive,
    model: config.layer3ReactionModel,
    fhnEpsilon: config.layer3ReactionFhnEpsilon,
    fhnA: config.layer3ReactionFhnA,
    fhnB: config.layer3ReactionFhnB,
    fhnGain: config.layer3ReactionFhnGain ?? 1,
    leniaMu: config.layer3ReactionLeniaMu ?? 0.15,
    leniaSigma: config.layer3ReactionLeniaSigma ?? 0.016,
    leniaRadius: config.layer3ReactionLeniaRadius ?? 13,
    leniaDt: config.layer3ReactionLeniaDt ?? 0.1,
    leniaKernel: config.layer3ReactionLeniaKernel ?? 'ring',
    leniaGain: config.layer3ReactionLeniaGain ?? 1,
  };
}

export function getReactionProfile(mode: ReactionMode): ReactionProfile {
  return { ...DEFAULT_REACTION_PROFILE, ...(REACTION_PROFILES[mode] ?? {}) };
}

export function getReactionMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2Type : config.layer3Type;
}

export function getLayerSource(config: ParticleConfig, layerIndex: 2 | 3): ReactionSource {
  return layerIndex === 2 ? config.layer2Source : config.layer3Source;
}
