import { createHash } from 'node:crypto';

import type { ProjectData, ProjectLayerSnapshotKey } from '../types';
import { arePhase5ProjectFingerprintsEqual, buildPhase5ProjectFingerprint, stableJsonStringify } from './projectPhase5Fixtures.ts';

interface VerificationResult {
  id: string;
  checks: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getLayer(project: ProjectData, key: ProjectLayerSnapshotKey) {
  const layer = project.serialization.layers.find((entry) => entry.key === key);
  assert(layer, `[${key}] serialization layer missing`);
  return layer;
}

function assertProjectFingerprintStable(
  before: ProjectData,
  after: ProjectData,
  scope: string,
  checks: string[],
  label: string,
) {
  const beforeFingerprint = buildPhase5ProjectFingerprint(before);
  const afterFingerprint = buildPhase5ProjectFingerprint(after);
  assert(
    arePhase5ProjectFingerprintsEqual(beforeFingerprint, afterFingerprint),
    `[${scope}] project fingerprint drifted after normalize/roundtrip`,
  );
  checks.push(label);
}

export { assert, assertProjectFingerprintStable, createHash, getLayer, stableJsonStringify };
export type { VerificationResult };
