/**
 * Designer blocks (limit plan stage 4, slice S7, first
 * instalment): the block-composition model behind the Designer
 * section. Decision: STAGE4_DECISIONS.md — 案3 ハイブリッド
 * (list assembly + a small read-only flow diagram in stage 4;
 * the diagram becomes the editable canvas in stage 5), the
 * saved form stays compatible with the stage-5 graph model
 * (STAGE5_DECISIONS.md 分岐A: one internal graph core, nodes /
 * edges JSON), and the template's primary form is a saved
 * block composition (決定3).
 *
 * The model is a pure projection of entities that already
 * exist — nothing here is a second source of truth:
 *
 *   - one `source` node for the particle pool itself (the
 *     pristine bake every group and rule reads);
 *   - one `group` node per GpgpuGroupDef (lib/gpgpuGroups.ts),
 *     plus a `dangling` group node for each group id a rule
 *     references but no definition provides — kept, never
 *     matching, exactly the evaluator's discipline for
 *     dangling references (lib/gpgpuParticleRules.ts);
 *   - one `rule` node per ParticleRule
 *     (lib/gpgpuParticleRules.ts), in list order.
 *
 * Edges: `flow` (the pool feeds every group and the first
 * rule), `sequence` (rule list order = evaluation order),
 * `reference` (a rule targets a group), `composite` (a
 * composite group is built from two other groups).
 *
 * A node's `params` carries the serialised entity itself (the
 * rule object / the group definition), so a saved composition
 * is self-contained and applying it is a write-back through
 * the entities' own serializers — the same discipline the
 * rule editor already uses for the `gpgpuParticleRules` key.
 *
 * Saved compositions live in their OWN storage key
 * (DESIGNER_BLOCKS_STORAGE_KEY), never in the preset library:
 * a composition is a partial key set (rules + groups), not a
 * full config, so it must not enter the preset records.
 * Persistence mirrors lib/presetLibraryPersist.ts: write,
 * read back, verify every record id is present; failures are
 * reported with a reason instead of losing data silently.
 *
 * This module is additive only: nothing in the render, save
 * or rule-evaluation paths reads it. The defaults therefore
 * cannot change existing behaviour.
 */

import {
  parseParticleRules,
  serializeParticleRules,
  validateParticleRule,
  type ParticleRule,
} from './gpgpuParticleRules';
import {
  parseGpgpuGroups,
  serializeGpgpuGroups,
  type GpgpuGroupDef,
} from './gpgpuGroups';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const DESIGNER_BLOCKS_FORMAT = 'designer-blocks-v1';

export type DesignerBlockNodeKind = 'source' | 'group' | 'rule';
export type DesignerBlockEdgeKind = 'flow' | 'sequence' | 'reference' | 'composite';

export interface DesignerBlockNode {
  id: string;
  kind: DesignerBlockNodeKind;
  label: string;
  enabled: boolean;
  /**
   * The serialised entity this node stands for (rule node:
   * the ParticleRule; group node: the GpgpuGroupDef). Absent
   * on the source node and on dangling group references.
   */
  params?: Record<string, unknown>;
  /** Group node referenced by a rule but defined nowhere. */
  dangling?: boolean;
}

export interface DesignerBlockEdge {
  id: string;
  from: string;
  to: string;
  kind: DesignerBlockEdgeKind;
}

export interface DesignerBlockModel {
  format: typeof DESIGNER_BLOCKS_FORMAT;
  nodes: DesignerBlockNode[];
  edges: DesignerBlockEdge[];
}

export const DESIGNER_SOURCE_NODE_ID = 'source:pool';
export const DESIGNER_BLOCKS_MAX_NODES = 64;
export const DESIGNER_BLOCKS_MAX_EDGES = 256;

const NODE_KINDS: readonly string[] = ['source', 'group', 'rule'];
const EDGE_KINDS: readonly string[] = ['flow', 'sequence', 'reference', 'composite'];
const NODE_ID_RE = /^[A-Za-z0-9:._-]{1,96}$/;

export const designerGroupNodeId = (groupId: string): string => `group:${groupId}`;
export const designerRuleNodeId = (ruleId: string): string => `rule:${ruleId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project the current rule list + group definitions into the
 * block model. Pure and deterministic: the same entities
 * always produce the same model (node order = source, groups
 * in definition order, dangling groups in first-reference
 * order, rules in list order).
 */
export function buildDesignerBlockModel(
  rules: readonly ParticleRule[],
  groups: readonly GpgpuGroupDef[],
): DesignerBlockModel {
  const nodes: DesignerBlockNode[] = [];
  const edges: DesignerBlockEdge[] = [];
  let edgeSeq = 0;
  const addEdge = (from: string, to: string, kind: DesignerBlockEdgeKind) => {
    edges.push({ id: `e${edgeSeq}`, from, to, kind });
    edgeSeq += 1;
  };

  nodes.push({
    id: DESIGNER_SOURCE_NODE_ID,
    kind: 'source',
    label: 'Particle Pool',
    enabled: true,
  });

  const definedGroupIds = new Set(groups.map((def) => def.id));
  for (const def of groups) {
    nodes.push({
      id: designerGroupNodeId(def.id),
      kind: 'group',
      label: def.name,
      enabled: true,
      params: def as unknown as Record<string, unknown>,
    });
    addEdge(DESIGNER_SOURCE_NODE_ID, designerGroupNodeId(def.id), 'flow');
  }

  // Composite groups are built from two other groups: a real
  // reference inside the entity set, drawn as its own edge.
  for (const def of groups) {
    if (def.source.kind !== 'composite') continue;
    for (const part of [def.source.a, def.source.b]) {
      if (definedGroupIds.has(part)) {
        addEdge(designerGroupNodeId(part), designerGroupNodeId(def.id), 'composite');
      }
    }
  }

  // Dangling group references (referenced, defined nowhere).
  const danglingSeen = new Set<string>();
  for (const rule of rules) {
    if (rule.target.type !== 'group') continue;
    const groupId = rule.target.id;
    if (definedGroupIds.has(groupId) || danglingSeen.has(groupId)) continue;
    danglingSeen.add(groupId);
    nodes.push({
      id: designerGroupNodeId(groupId),
      kind: 'group',
      label: groupId,
      enabled: true,
      dangling: true,
    });
    addEdge(DESIGNER_SOURCE_NODE_ID, designerGroupNodeId(groupId), 'flow');
  }

  let previousRuleNodeId: string | null = null;
  for (const rule of rules) {
    const nodeId = designerRuleNodeId(rule.id);
    nodes.push({
      id: nodeId,
      kind: 'rule',
      label: typeof rule.name === 'string' && rule.name.length > 0 ? rule.name : rule.id,
      enabled: rule.enabled,
      params: rule as unknown as Record<string, unknown>,
    });
    if (previousRuleNodeId === null) {
      addEdge(DESIGNER_SOURCE_NODE_ID, nodeId, 'flow');
    } else {
      addEdge(previousRuleNodeId, nodeId, 'sequence');
    }
    previousRuleNodeId = nodeId;
    if (rule.target.type === 'group') {
      addEdge(designerGroupNodeId(rule.target.id), nodeId, 'reference');
    }
  }

  return { format: DESIGNER_BLOCKS_FORMAT, nodes, edges };
}

/** Build the model straight from the two serialised config keys. */
export function buildDesignerBlockModelFromConfig(config: {
  gpgpuParticleRules?: string | null;
  gpgpuGroupsData?: string | null;
}): DesignerBlockModel {
  return buildDesignerBlockModel(
    parseParticleRules(config.gpgpuParticleRules),
    parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
  );
}

/** The rules a model stands for (validated by the entity's own validator). */
export function designerBlockModelRules(model: DesignerBlockModel): ParticleRule[] {
  const rules: ParticleRule[] = [];
  for (const node of model.nodes) {
    if (node.kind !== 'rule' || !node.params) continue;
    const rule = validateParticleRule(node.params);
    if (rule) rules.push(rule);
  }
  return rules;
}

/** The group definitions a model stands for (dangling nodes carry none). */
export function designerBlockModelGroups(model: DesignerBlockModel): GpgpuGroupDef[] {
  const defs: unknown[] = [];
  for (const node of model.nodes) {
    if (node.kind !== 'group' || node.dangling || !node.params) continue;
    defs.push(node.params);
  }
  // Round-trip through the entity's own parser so the result
  // is normalised and validated exactly like a config load.
  return parseGpgpuGroups(JSON.stringify(defs));
}

/**
 * The config write-back for applying a model: both serialised
 * keys, produced by the entities' own serializers.
 * `gpgpuGroupsData` is null when the group payload would
 * exceed its cap (the serializer's own refusal) — the caller
 * must surface that instead of applying a partial composition.
 */
export function designerBlockModelToConfigUpdates(model: DesignerBlockModel): {
  gpgpuParticleRules: string;
  gpgpuGroupsData: string | null;
} {
  return {
    gpgpuParticleRules: serializeParticleRules(designerBlockModelRules(model)),
    gpgpuGroupsData: serializeGpgpuGroups(designerBlockModelGroups(model)),
  };
}

// ---------------------------------------------------------------------------
// Validation / serialisation
// ---------------------------------------------------------------------------

export type DesignerBlockModelValidation =
  | { ok: true; model: DesignerBlockModel }
  | { ok: false; reason: string };

function validateNode(raw: unknown): DesignerBlockNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !NODE_ID_RE.test(raw.id)) return null;
  if (typeof raw.kind !== 'string' || !NODE_KINDS.includes(raw.kind)) return null;
  if (typeof raw.label !== 'string' || raw.label.length === 0 || raw.label.length > 120) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (raw.params !== undefined && !isRecord(raw.params)) return null;
  if (raw.dangling !== undefined && typeof raw.dangling !== 'boolean') return null;
  const node: DesignerBlockNode = {
    id: raw.id,
    kind: raw.kind as DesignerBlockNodeKind,
    label: raw.label,
    enabled: raw.enabled === undefined ? true : raw.enabled,
  };
  if (raw.params !== undefined) node.params = raw.params;
  if (raw.dangling === true) node.dangling = true;
  return node;
}

/**
 * Validate an untrusted value as a block model. Unlike the
 * entity parsers (which drop broken rows quietly), a stored
 * composition is refused wholesale with a reason: a partial
 * composition applied silently would rewrite the user's rule
 * list into something they never saved.
 */
export function validateDesignerBlockModel(raw: unknown): DesignerBlockModelValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'not-an-object' };
  if (raw.format !== DESIGNER_BLOCKS_FORMAT) return { ok: false, reason: 'format-mismatch' };
  if (!Array.isArray(raw.nodes)) return { ok: false, reason: 'nodes-not-array' };
  if (!Array.isArray(raw.edges)) return { ok: false, reason: 'edges-not-array' };
  if (raw.nodes.length > DESIGNER_BLOCKS_MAX_NODES) return { ok: false, reason: 'too-many-nodes' };
  if (raw.edges.length > DESIGNER_BLOCKS_MAX_EDGES) return { ok: false, reason: 'too-many-edges' };

  const nodes: DesignerBlockNode[] = [];
  const nodeIds = new Set<string>();
  for (const rawNode of raw.nodes) {
    const node = validateNode(rawNode);
    if (!node) return { ok: false, reason: 'invalid-node' };
    if (nodeIds.has(node.id)) return { ok: false, reason: 'duplicate-node-id' };
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const edges: DesignerBlockEdge[] = [];
  const edgeIds = new Set<string>();
  for (const rawEdge of raw.edges) {
    if (!isRecord(rawEdge)) return { ok: false, reason: 'invalid-edge' };
    if (typeof rawEdge.id !== 'string' || rawEdge.id.length === 0 || rawEdge.id.length > 96) {
      return { ok: false, reason: 'invalid-edge' };
    }
    if (edgeIds.has(rawEdge.id)) return { ok: false, reason: 'duplicate-edge-id' };
    if (typeof rawEdge.kind !== 'string' || !EDGE_KINDS.includes(rawEdge.kind)) {
      return { ok: false, reason: 'invalid-edge' };
    }
    if (typeof rawEdge.from !== 'string' || typeof rawEdge.to !== 'string'
      || !nodeIds.has(rawEdge.from) || !nodeIds.has(rawEdge.to)) {
      return { ok: false, reason: 'edge-endpoint-missing' };
    }
    edgeIds.add(rawEdge.id);
    edges.push({
      id: rawEdge.id,
      from: rawEdge.from,
      to: rawEdge.to,
      kind: rawEdge.kind as DesignerBlockEdgeKind,
    });
  }

  return { ok: true, model: { format: DESIGNER_BLOCKS_FORMAT, nodes, edges } };
}

/** Serialise a model (validated first; invalid models throw —
 *  this is the programmer-facing side, unlike stored input). */
export function serializeDesignerBlockModel(model: DesignerBlockModel): string {
  const result = validateDesignerBlockModel(model);
  if (!result.ok) throw new Error(`designer blocks: cannot serialise invalid model (${result.reason})`);
  return JSON.stringify(result.model);
}

/** Parse a serialised model; null when refused (see validate). */
export function parseDesignerBlockModel(text: string | null | undefined): DesignerBlockModel | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = validateDesignerBlockModel(parsed);
  return result.ok ? result.model : null;
}

// ---------------------------------------------------------------------------
// Flow-diagram layout (pure; the diagram is read-only in stage 4)
// ---------------------------------------------------------------------------

export const DESIGNER_LAYOUT_NODE_WIDTH = 176;
export const DESIGNER_LAYOUT_NODE_HEIGHT = 36;
export const DESIGNER_LAYOUT_COLUMN_GAP = 72;
export const DESIGNER_LAYOUT_ROW_GAP = 16;
export const DESIGNER_LAYOUT_PADDING = 12;

export interface DesignerBlockLayoutNode {
  id: string;
  kind: DesignerBlockNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignerBlockLayoutEdge {
  id: string;
  kind: DesignerBlockEdgeKind;
  /** Polyline points from the `from` node to the `to` node. */
  points: { x: number; y: number }[];
}

export interface DesignerBlockLayout {
  nodes: DesignerBlockLayoutNode[];
  edges: DesignerBlockLayoutEdge[];
  width: number;
  height: number;
}

const KIND_COLUMN: Record<DesignerBlockNodeKind, number> = { source: 0, group: 1, rule: 2 };

/**
 * Column-by-kind layout: pool on the left, groups in the
 * middle, rules on the right in evaluation order. Pure and
 * deterministic; nodes in a column stack in model order, so
 * coordinates can never overlap by construction.
 */
export function layoutDesignerBlockModel(model: DesignerBlockModel): DesignerBlockLayout {
  const columnCounts: Record<number, number> = {};
  const nodes: DesignerBlockLayoutNode[] = model.nodes.map((node) => {
    const column = KIND_COLUMN[node.kind];
    const row = columnCounts[column] ?? 0;
    columnCounts[column] = row + 1;
    return {
      id: node.id,
      kind: node.kind,
      x: DESIGNER_LAYOUT_PADDING + column * (DESIGNER_LAYOUT_NODE_WIDTH + DESIGNER_LAYOUT_COLUMN_GAP),
      y: DESIGNER_LAYOUT_PADDING + row * (DESIGNER_LAYOUT_NODE_HEIGHT + DESIGNER_LAYOUT_ROW_GAP),
      width: DESIGNER_LAYOUT_NODE_WIDTH,
      height: DESIGNER_LAYOUT_NODE_HEIGHT,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const maxRows = Math.max(1, ...Object.values(columnCounts));
  const width = DESIGNER_LAYOUT_PADDING * 2
    + 3 * DESIGNER_LAYOUT_NODE_WIDTH + 2 * DESIGNER_LAYOUT_COLUMN_GAP;
  const height = DESIGNER_LAYOUT_PADDING * 2
    + maxRows * DESIGNER_LAYOUT_NODE_HEIGHT + (maxRows - 1) * DESIGNER_LAYOUT_ROW_GAP;

  const edges: DesignerBlockLayoutEdge[] = [];
  for (const edge of model.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    let points: { x: number; y: number }[];
    if (from.x === to.x) {
      // Same column (rule sequence / composite): bottom -> top.
      points = [
        { x: from.x + from.width / 2, y: from.y + from.height },
        { x: to.x + to.width / 2, y: to.y },
      ];
    } else {
      // Cross-column: right edge -> left edge, with a mid jog
      // so overlapping rows stay distinguishable.
      const start = { x: from.x + from.width, y: from.y + from.height / 2 };
      const end = { x: to.x, y: to.y + to.height / 2 };
      const midX = (start.x + end.x) / 2;
      points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    edges.push({ id: edge.id, kind: edge.kind, points });
  }

  return { nodes, edges, width, height };
}

// ---------------------------------------------------------------------------
// Saved compositions (own storage key; verified persistence)
// ---------------------------------------------------------------------------

export const DESIGNER_BLOCKS_STORAGE_KEY = 'monosphere-designer-blocks-v1';
export const DESIGNER_BLOCKS_MAX_RECORDS = 64;
export const DESIGNER_BLOCKS_MAX_CHARS = 4_000_000;

/**
 * 種別 (DESIGN §6 / STAGE4_DECISIONS 決定3): a composition
 * saved as a finished form is a 'preset'; one saved as a
 * skeleton to build from is a 'template'. The hierarchy UI
 * that consumes this distinction is the next slice; the field
 * is carried from the start so saved assets never migrate.
 */
export type DesignerBlockRecordKind = 'preset' | 'template';

export interface DesignerBlockRecord {
  id: string;
  name: string;
  kind: DesignerBlockRecordKind;
  createdAt: number;
  model: DesignerBlockModel;
}

export interface DesignerBlocksStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type DesignerBlocksPersistResult =
  | { ok: true }
  | { ok: false; reason: 'serialize' | 'too-large' | 'write' | 'readback-missing' | 'readback-invalid' | 'readback-mismatch' };

let designerBlockRecordCounter = 0;
export function createDesignerBlockRecordId(): string {
  designerBlockRecordCounter += 1;
  return `designer-${Date.now().toString(36)}-${designerBlockRecordCounter.toString(36)}`;
}

export function createDesignerBlockRecord(args: {
  name: string;
  kind?: DesignerBlockRecordKind;
  model: DesignerBlockModel;
  createdAt?: number;
}): DesignerBlockRecord {
  return {
    id: createDesignerBlockRecordId(),
    name: args.name.trim().slice(0, 80) || 'Designer Blocks',
    kind: args.kind ?? 'preset',
    createdAt: args.createdAt ?? Date.now(),
    model: args.model,
  };
}

function validateRecord(raw: unknown): DesignerBlockRecord | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 96) return null;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return null;
  if (raw.kind !== 'preset' && raw.kind !== 'template') return null;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  const model = validateDesignerBlockModel(raw.model);
  if (!model.ok) return null;
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 80),
    kind: raw.kind,
    createdAt: raw.createdAt,
    model: model.model,
  };
}

/** Load the saved compositions; broken records drop quietly,
 *  a broken payload reads as empty. Never throws. */
export function loadDesignerBlockRecords(
  storage: DesignerBlocksStorageLike,
  key: string = DESIGNER_BLOCKS_STORAGE_KEY,
): DesignerBlockRecord[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw || raw.length > DESIGNER_BLOCKS_MAX_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: DesignerBlockRecord[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (records.length >= DESIGNER_BLOCKS_MAX_RECORDS) break;
    const record = validateRecord(item);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/**
 * Verified write, mirroring persistPresetRecordsVerified:
 * write, read back, and require the payload to parse as an
 * array containing every record id.
 */
export function persistDesignerBlockRecords(
  storage: DesignerBlocksStorageLike,
  records: readonly DesignerBlockRecord[],
  key: string = DESIGNER_BLOCKS_STORAGE_KEY,
): DesignerBlocksPersistResult {
  let payload: string;
  try {
    payload = JSON.stringify(records);
  } catch {
    return { ok: false, reason: 'serialize' };
  }
  if (payload.length > DESIGNER_BLOCKS_MAX_CHARS) return { ok: false, reason: 'too-large' };
  try {
    storage.setItem(key, payload);
  } catch {
    return { ok: false, reason: 'write' };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, reason: 'readback-missing' };
  }
  if (!raw) return { ok: false, reason: 'readback-missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'readback-invalid' };
  }
  if (!Array.isArray(parsed) || parsed.length !== records.length) {
    return { ok: false, reason: 'readback-mismatch' };
  }
  const ids = new Set(
    parsed.map((record) => (isRecord(record) ? record.id : undefined)),
  );
  for (const record of records) {
    if (!ids.has(record.id)) return { ok: false, reason: 'readback-mismatch' };
  }
  return { ok: true };
}

/** The browser storage, or null outside a browser context. */
export function defaultDesignerBlocksStorage(): DesignerBlocksStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
