/**
 * Node graph model (roadmap Phase 10, first slice).
 *
 * The engine's architecture is a fixed set of parallel pipelines —
 * Layer 1 (SDF core), Layer 2, Layer 3 and the GPGPU layer each run
 * source -> motion -> render and are composited into one output.
 * This module models THAT structure as a node graph: every node is
 * a stage of a real pipeline, and editing a node writes the same
 * config fields the panels write (through updateConfig), so
 * presets, project files and compatibility are untouched.
 *
 * What this is not: a free-form dataflow engine. The pipeline
 * order is the engine's own; the graph reconfigures stages and
 * gives the whole construction a spatial, draggable overview —
 * it does not rewire arbitrary data flow.
 *
 * Node positions are a view preference only; they persist in
 * localStorage and never enter the config.
 */

export type GraphNodeId =
  | 'l2-source'
  | 'l2-motion'
  | 'l2-render'
  | 'l3-source'
  | 'l3-motion'
  | 'l3-render'
  | 'l1-core'
  | 'gpgpu'
  | 'output';

export interface GraphPoint {
  x: number;
  y: number;
}

export const GRAPH_NODE_WIDTH = 204;

export const DEFAULT_GRAPH_LAYOUT: Record<GraphNodeId, GraphPoint> = {
  'l2-source': { x: 8, y: 12 },
  'l2-motion': { x: 232, y: 12 },
  'l2-render': { x: 456, y: 12 },
  'l3-source': { x: 8, y: 218 },
  'l3-motion': { x: 232, y: 218 },
  'l3-render': { x: 456, y: 218 },
  'l1-core': { x: 8, y: 424 },
  gpgpu: { x: 232, y: 424 },
  output: { x: 692, y: 218 },
};

export const GRAPH_EDGES: [GraphNodeId, GraphNodeId][] = [
  ['l2-source', 'l2-motion'],
  ['l2-motion', 'l2-render'],
  ['l2-render', 'output'],
  ['l3-source', 'l3-motion'],
  ['l3-motion', 'l3-render'],
  ['l3-render', 'output'],
  ['l1-core', 'output'],
  ['gpgpu', 'output'],
];

const LAYOUT_STORAGE_KEY = 'kalokagathia.graphLayout.v1';

export function loadGraphLayout(storage: Pick<Storage, 'getItem'> | undefined): Record<GraphNodeId, GraphPoint> {
  const layout = { ...DEFAULT_GRAPH_LAYOUT };
  if (!storage) return layout;
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return layout;
    const parsed = JSON.parse(raw) as Partial<Record<GraphNodeId, GraphPoint>>;
    (Object.keys(DEFAULT_GRAPH_LAYOUT) as GraphNodeId[]).forEach((id) => {
      const point = parsed[id];
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        layout[id] = { x: Math.max(0, point.x), y: Math.max(0, point.y) };
      }
    });
    return layout;
  } catch {
    return layout;
  }
}

export function saveGraphLayout(storage: Pick<Storage, 'setItem'>, layout: Record<GraphNodeId, GraphPoint>): void {
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage full/blocked: the layout simply won't persist.
  }
}

export interface GraphOption {
  value: string;
  label: string;
}

/** Layer3Source union (types/scene.ts) — the emitter shapes both particle layers accept. */
export const GRAPH_SOURCE_OPTIONS: GraphOption[] = [
  { value: 'sphere', label: 'Sphere 球' },
  { value: 'center', label: 'Center 中心' },
  { value: 'ring', label: 'Ring 環' },
  { value: 'disc', label: 'Disc 円盤' },
  { value: 'cube', label: 'Cube 立方体' },
  { value: 'cylinder', label: 'Cylinder 円柱' },
  { value: 'random', label: 'Random 乱数' },
  { value: 'cone', label: 'Cone 円錐' },
  { value: 'torus', label: 'Torus トーラス' },
  { value: 'spiral', label: 'Spiral 螺旋' },
  { value: 'galaxy', label: 'Galaxy 銀河' },
  { value: 'grid', label: 'Grid 格子' },
  { value: 'plane', label: 'Plane 平面' },
  { value: 'image', label: 'Image 画像' },
  { value: 'video', label: 'Video 映像' },
  { value: 'text', label: 'Text 文字' },
];

/** ParticleSpriteMode union (types/scene.ts). */
export const GRAPH_SPRITE_OPTIONS: GraphOption[] = [
  { value: 'soft', label: 'Soft 柔らかい点' },
  { value: 'ring', label: 'Ring 輪' },
  { value: 'spark', label: 'Spark 火花' },
];

/** ConnectionRenderStyle union (types/scene.ts). */
export const GRAPH_CONNECTION_OPTIONS: GraphOption[] = [
  { value: 'classic', label: 'Classic 線' },
  { value: 'brush', label: 'Brush 筆' },
  { value: 'filament', label: 'Filament 糸' },
];

/** GpgpuEmitShape union (types/configGpgpu.ts). */
export const GRAPH_EMIT_SHAPE_OPTIONS: GraphOption[] = [
  { value: 'sphere', label: 'Sphere 球' },
  { value: 'shell', label: 'Shell 殻' },
  { value: 'disc', label: 'Disc 円盤' },
  { value: 'ring', label: 'Ring 環' },
  { value: 'box', label: 'Box 箱' },
  { value: 'cone', label: 'Cone 円錐' },
];
