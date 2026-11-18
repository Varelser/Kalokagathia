import { Position3D } from './scene';

export interface ParticleConfigLayer1 {
  layer1Enabled: boolean;
  layer1Count: number;
  layer1SourceCount: number;
  layer1SourceSpread: number;
  layer1SourcePositions: Position3D[];

  layer1Counts: number[];
  layer1Radii: number[];
  layer1Volumes: number[];
  layer1Jitters: number[];
  layer1Sizes: number[];
  layer1PulseSpeeds: number[];
  layer1PulseAmps: number[];

  layer1Color: string;
  baseSize: number;
  sphereRadius: number;
  layer1Volume: number;
  jitter: number;
  // Hand-drawn line jitter (Phase AH): deterministic per-endpoint
  // displacement in the line shaders. 0 = legacy lines.
  layer1LineJitter: number;
  // Path application of the line jitter (Phase AW): while ON,
  // the same jitter amount also displaces path drawing — the
  // L-System line geometry and the morph bake's path-placed
  // points (lib/pathJitter.ts). Default OFF = paths render
  // exactly as before.
  layer1LineJitterPaths: boolean;
  // Dashed lines (Phase AM): the line shaders discard the gap
  // part of a dash period along each segment. Length 0 = solid
  // (legacy) lines.
  layer1LineDashLength: number;
  layer1LineDashGap: number;
  pulseSpeed: number;
  pulseAmplitude: number;
  // Per-layer SDF
  layer1SdfEnabled: boolean;
  layer1SdfShape: 'sphere' | 'ring' | 'star' | 'hexagon' | 'diamond' | 'flare' | 'cloud' | 'bokeh' | 'crosshair' | 'iris' | 'lightning';
  layer1SdfLightX: number;
  layer1SdfLightY: number;
  layer1SdfSpecular: number;
  layer1SdfShininess: number;
  layer1SdfAmbient: number;
}
