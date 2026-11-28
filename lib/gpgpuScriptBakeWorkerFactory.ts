/**
 * Script bake (C1, Layer 1 WP11 phase D) — the production
 * Worker factory for the script-bake runner
 * (lib/gpgpuScriptBakeRunner.ts). This is the only module
 * that imports the Worker class (Vite `?worker`), keeping
 * that import out of the runner's graph so the runner stays
 * unit-testable with a fake worker.
 *
 * Asset URL discipline: the Pyodide assets are self-hosted,
 * version-pinned static files (public/pyodide/<version>/).
 * The index URL is built from the app's own base URL — same
 * origin, no CDN, nothing fetched until the runner first
 * constructs the Worker (lazy load on first enable).
 */

import ScriptBakeWorkerClass from '../workers/gpgpuScriptBakeWorker?worker';
import {
  GpgpuScriptBakeRunner,
  SCRIPT_PYODIDE_VERSION,
  type ScriptBakeWorkerLike,
} from './gpgpuScriptBakeRunner';
import type { GpgpuScriptBakeStore } from './gpgpuScriptBake';

/**
 * Absolute URL of the pinned Pyodide asset directory
 * (trailing slash included), resolved against the app base.
 */
export function scriptBakeAssetIndexUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const path = `${base.replace(/\/?$/, '/')}pyodide/${SCRIPT_PYODIDE_VERSION}/`;
  return new URL(path, self.location.origin).href;
}

/** Build the real script-bake Worker. */
export function createScriptBakeWorker(): ScriptBakeWorkerLike {
  return new ScriptBakeWorkerClass() as unknown as ScriptBakeWorkerLike;
}

/**
 * A runner wired with the real Worker and the self-hosted
 * asset URL — the production entry point for the bake-stage
 * consumers (panel wiring is phase C and not part of this
 * phase).
 */
export function createDefaultScriptBakeRunner(store: GpgpuScriptBakeStore): GpgpuScriptBakeRunner {
  return new GpgpuScriptBakeRunner(store, {
    workerFactory: createScriptBakeWorker,
    assetIndexUrl: scriptBakeAssetIndexUrl(),
  });
}
