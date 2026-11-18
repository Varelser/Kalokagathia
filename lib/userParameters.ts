import React from 'react';
import type { ParticleConfig } from '../types';
import { PARAMETER_CATALOG } from './parameterCatalog';
import { AI_SPEC_BY_KEY } from './aiControlCatalog';
import { DEFAULT_CONFIG } from './appStateConfigDefaults';

/**
 * User Parameters (Phase AO): user-declared public parameters.
 *
 * The macro system is a fixed set of eight code-defined compound
 * controls; there was no way for a user to DECLARE "these are the
 * parameters I publish" — every key is technically reachable, but
 * nothing names a public subset (UE5 audit #06). A declaration
 * cuts one existing catalog key out onto a public surface with a
 * label, a group and a declared default:
 *
 *   { id, label, group, key, defaultValue }
 *
 * Design invariants:
 * - Declarations are a SETUP-side grammar: they persist under
 *   their own localStorage key (the modulation / sequence-tracks
 *   precedent), never inside config or project files. With zero
 *   declarations the public surface renders nothing and nothing
 *   is written — identity by construction.
 * - A declaration adds no range of its own: numeric ranges come
 *   from PARAMETER_CATALOG, boolean / enum shapes from the AI
 *   control catalog (both derive from the panel itself).
 * - Values are read from and written to the target key through
 *   the normal config update path — no effective-config overlay
 *   (the macro discipline). The embed script API can also write
 *   by declared name (lib/embedControl.ts).
 */

export interface UserParameterDeclaration {
  id: string;
  /** Public name: the surface label and the script-API name. */
  label: string;
  /** Group heading on the public surface ('' = ungrouped). */
  group: string;
  key: keyof ParticleConfig;
  defaultValue: number | boolean | string;
}

export const USER_PARAMETERS_STORAGE_KEY = 'kalokagathia.userParameters.v1';
export const MAX_USER_PARAMETERS = 32;
export const MAX_USER_PARAMETER_LABEL_LENGTH = 48;
export const MAX_USER_PARAMETER_GROUP_LENGTH = 24;

export type UserParameterKind = 'number' | 'boolean' | 'enum';

export interface UserParameterTarget {
  key: keyof ParticleConfig;
  kind: UserParameterKind;
  /** Panel label of the underlying key (for the declaration editor). */
  catalogLabel: string;
  min?: number;
  max?: number;
  step?: number;
  values?: readonly string[];
}

/**
 * Resolve a config key to its declarable target shape, or null
 * when the key is not declarable. Numeric keys resolve through
 * PARAMETER_CATALOG; boolean / enum keys through the AI control
 * catalog. String-valued config keys that are neither (free text,
 * colors, sources) are not declarable.
 */
export function resolveUserParameterTarget(key: string): UserParameterTarget | null {
  const numeric = PARAMETER_CATALOG.find((entry) => entry.key === key);
  if (numeric) {
    return {
      key: numeric.key,
      kind: 'number',
      catalogLabel: numeric.label,
      min: numeric.min,
      max: numeric.max,
      step: numeric.step,
    };
  }
  const spec = AI_SPEC_BY_KEY.get(key);
  if (spec && spec.kind === 'boolean') {
    return { key: spec.key, kind: 'boolean', catalogLabel: spec.gloss };
  }
  if (spec && spec.kind === 'enum') {
    return { key: spec.key, kind: 'enum', catalogLabel: spec.gloss, values: spec.values };
  }
  return null;
}

/** Every declarable key, sorted by catalog label (editor lists). */
export const USER_PARAMETER_TARGETS: UserParameterTarget[] = (() => {
  const byKey = new Map<string, UserParameterTarget>();
  for (const entry of PARAMETER_CATALOG) {
    const target = resolveUserParameterTarget(entry.key as string);
    if (target) byKey.set(entry.key as string, target);
  }
  for (const spec of AI_SPEC_BY_KEY.values()) {
    if (spec.kind === 'number') continue;
    const target = resolveUserParameterTarget(spec.key as string);
    if (target) byKey.set(spec.key as string, target);
  }
  return [...byKey.values()].sort((a, b) => a.catalogLabel.localeCompare(b.catalogLabel));
})();

let userParameterIdCounter = 0;
export function createUserParameterId(): string {
  userParameterIdCounter += 1;
  return `up-${Date.now().toString(36)}-${userParameterIdCounter.toString(36)}`;
}

/** Validate / normalise a value for a target; null = reject. */
export function validateUserParameterValue(
  target: UserParameterTarget,
  value: unknown,
): number | boolean | string | null {
  if (target.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const min = target.min ?? value;
    const max = target.max ?? value;
    const clamped = Math.min(max, Math.max(min, value));
    const step = target.step ?? 0;
    const snapped = step > 0 ? Math.round(clamped / step) * step : clamped;
    return Math.round(snapped * 10000) / 10000;
  }
  if (target.kind === 'boolean') {
    return typeof value === 'boolean' ? value : null;
  }
  return typeof value === 'string' && (target.values ?? []).includes(value) ? value : null;
}

function fallbackDefault(target: UserParameterTarget): number | boolean | string {
  const current = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[target.key as string];
  const validated = validateUserParameterValue(target, current);
  if (validated !== null) return validated;
  return target.kind === 'number' ? target.min ?? 0 : target.kind === 'boolean' ? false : (target.values?.[0] ?? '');
}

export function sanitizeUserParameters(raw: unknown): UserParameterDeclaration[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, UserParameterDeclaration>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== 'string') continue;
    const target = resolveUserParameterTarget(record.key);
    if (!target) continue;
    const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : createUserParameterId();
    const label = typeof record.label === 'string' && record.label.trim().length > 0
      ? record.label.trim().slice(0, MAX_USER_PARAMETER_LABEL_LENGTH)
      : target.catalogLabel.slice(0, MAX_USER_PARAMETER_LABEL_LENGTH);
    const group = typeof record.group === 'string' ? record.group.trim().slice(0, MAX_USER_PARAMETER_GROUP_LENGTH) : '';
    const defaultValue = validateUserParameterValue(target, record.defaultValue) ?? fallbackDefault(target);
    // Duplicate ids: the later declaration wins (brief discipline).
    byId.set(id, { id, label, group, key: target.key, defaultValue });
  }
  return [...byId.values()].slice(0, MAX_USER_PARAMETERS);
}

export function loadUserParameters(storage: Pick<Storage, 'getItem'> | undefined): UserParameterDeclaration[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(USER_PARAMETERS_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeUserParameters(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveUserParameters(storage: Pick<Storage, 'setItem'>, declarations: UserParameterDeclaration[]): void {
  try {
    storage.setItem(USER_PARAMETERS_STORAGE_KEY, JSON.stringify(declarations));
  } catch {
    // Storage full/blocked: the declarations simply won't persist.
  }
}

/* ---------------- shared store (editor <-> embed API) ---------------- */

let currentDeclarations: UserParameterDeclaration[] | null = null;
const declarationListeners = new Set<() => void>();

function ensureDeclarations(): UserParameterDeclaration[] {
  if (!currentDeclarations) {
    currentDeclarations = loadUserParameters(typeof window !== 'undefined' ? window.localStorage : undefined);
  }
  return currentDeclarations;
}

export function getUserParameters(): UserParameterDeclaration[] {
  return ensureDeclarations();
}

export function setUserParameters(next: UserParameterDeclaration[]): void {
  currentDeclarations = sanitizeUserParameters(next);
  if (typeof window !== 'undefined') saveUserParameters(window.localStorage, currentDeclarations);
  declarationListeners.forEach((listener) => listener());
}

export function subscribeUserParameters(listener: () => void): () => void {
  declarationListeners.add(listener);
  return () => {
    declarationListeners.delete(listener);
  };
}

export function useUserParameters(): UserParameterDeclaration[] {
  return React.useSyncExternalStore(subscribeUserParameters, getUserParameters, getUserParameters);
}

/* ---------------- mutations (pure; UI calls setUserParameters) ---------------- */

export function addUserParameter(
  declarations: UserParameterDeclaration[],
  key: keyof ParticleConfig,
): UserParameterDeclaration[] {
  const target = resolveUserParameterTarget(key as string);
  if (!target) return declarations;
  if (declarations.length >= MAX_USER_PARAMETERS) return declarations;
  const declaration: UserParameterDeclaration = {
    id: createUserParameterId(),
    label: target.catalogLabel,
    group: '',
    key: target.key,
    defaultValue: fallbackDefault(target),
  };
  return sanitizeUserParameters([...declarations, declaration]);
}

export function updateUserParameter(
  declarations: UserParameterDeclaration[],
  id: string,
  patch: Partial<Pick<UserParameterDeclaration, 'label' | 'group' | 'defaultValue'>>,
): UserParameterDeclaration[] {
  return sanitizeUserParameters(
    declarations.map((declaration) => (declaration.id === id ? { ...declaration, ...patch } : declaration)),
  );
}

export function removeUserParameter(
  declarations: UserParameterDeclaration[],
  id: string,
): UserParameterDeclaration[] {
  return declarations.filter((declaration) => declaration.id !== id);
}

/**
 * Find a declaration by its public name: exact label match first,
 * then id. This is the name the embed script API writes through.
 */
export function findUserParameterByName(
  declarations: UserParameterDeclaration[],
  name: string,
): UserParameterDeclaration | null {
  return declarations.find((declaration) => declaration.label === name)
    ?? declarations.find((declaration) => declaration.id === name)
    ?? null;
}
