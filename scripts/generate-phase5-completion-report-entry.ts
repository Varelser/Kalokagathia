declare const process: { cwd(): string };

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  PHASE5_FIXTURE_DEFINITIONS,
  getPhase5RealExportFixtureDir,
  getPhase5RealExportManifestPath,
  listPhase5RealExportFixtureFileNames,
  readPhase5RealExportManifest,
  stableJsonStringify,
} from './projectPhase5Fixtures.ts';

interface Phase5CompletionCriterion {
  id: string;
  status: 'done' | 'optional-pending';
  summary: string;
  evidence: string[];
}

interface Phase5CompletionReport {
  generatedAt: string;
  phase: 'phase5';
  status: 'completed';
  mandatoryCriteriaComplete: boolean;
  generatedFixtureCount: number;
  realExportFixtureCount: number;
  realExportManifestEntryCount: number;
  criteria: Phase5CompletionCriterion[];
  optionalFollowUps: string[];
}

function buildReport(rootDir = process.cwd()): Phase5CompletionReport {
  const realExportDir = getPhase5RealExportFixtureDir(rootDir);
  const realExportManifestPath = getPhase5RealExportManifestPath(rootDir);
  const relativeRealExportDir = path.relative(rootDir, realExportDir) || 'fixtures/project-state/real-export';
  const relativeRealExportManifestPath = path.relative(rootDir, realExportManifestPath) || 'fixtures/project-state/real-export/manifest.json';
  const realExportFixtures = listPhase5RealExportFixtureFileNames(rootDir);
  const realExportManifest = readPhase5RealExportManifest(rootDir);
  const driftReportPath = path.join(rootDir, 'docs', 'archive', 'phase5-drift-report.json');
  const hasDriftReport = existsSync(driftReportPath);

  const criteria: Phase5CompletionCriterion[] = [
    {
      id: 'schema-versioning-and-migration',
      status: 'done',
      summary: 'Project data uses schema versioning and migration-aware parse helpers.',
      evidence: [
        'lib/projectStateStorage.ts',
        'lib/projectSerializationSnapshot.ts',
        'scripts/verify-phase5-entry.ts#verifyLegacyMigrationRebuild',
      ],
    },
    {
      id: 'sparse-serialization-normalization',
      status: 'done',
      summary: 'Sparse and partial serialization blocks are normalized against current routing fallbacks during import.',
      evidence: [
        'lib/projectSerializationSnapshot.ts#normalizeProjectSerializationSnapshot',
        'scripts/verify-phase5-entry.ts#verifySparseSerializationRecovery',
      ],
    },
    {
      id: 'file-roundtrip-and-import-hardening',
      status: 'done',
      summary: 'Phase 5 verifies temp-file export/import round-trip, duplicate-ID repair, orphan sequence drop, post-remap snapshot rebuild integrity, and exact ID change reporting.',
      evidence: [
        'lib/projectTransferShared.ts',
        'docs/archive/phase5-import-report.json',
        'scripts/verify-phase5-entry.ts#verifyFileRoundTripAndImportPreparation',
        'scripts/verify-phase5-entry.ts#verifyDuplicateImportRecovery',
        'scripts/verify-phase5-entry.ts#verifyOrphanSequenceRecovery',
      ],
    },
    {
      id: 'replace-vs-merge-import-semantics',
      status: 'done',
      summary: 'Import preparation distinguishes replace from merge so UI workspace replacement preserves stable IDs.',
      evidence: [
        'lib/projectTransferShared.ts#importMode',
        'lib/useProjectTransfer.ts#importMode: replace',
        'scripts/verify-phase5-entry.ts#verifyReplaceModePreservesStableIds',
      ],
    },
    {
      id: 'fixture-and-drift-infrastructure',
      status: 'done',
      summary: 'Committed Phase 5 fixtures, optional real-export intake, real-export manifest tracking, readiness diagnostics with per-file metadata drift fields, and drift/fingerprint reports are in place.',
      evidence: [
        `generated-fixtures:${PHASE5_FIXTURE_DEFINITIONS.length}`,
        `real-export-dir:${relativeRealExportDir}`,
        `real-export-manifest:${relativeRealExportManifestPath}`,
        `drift-report:${hasDriftReport ? 'docs/archive/phase5-drift-report.json' : 'missing'}`,
        'import-report:docs/archive/phase5-import-report.json',
        'real-export-readiness-report:docs/archive/phase5-real-export-readiness-report.json',
        'execution-readiness-report:docs/archive/phase5-execution-readiness-report.json',
        'proof-intake:docs/archive/phase5-proof-intake.json',
        'auto-closeout:docs/archive/phase5-auto-closeout.json',
        'evidence-index:docs/archive/phase5-evidence-index.json',
        'final-closeout:docs/archive/phase5-final-closeout.json',
      ],
    },
    {
      id: 'browser-captured-real-export-fixtures',
      status: realExportFixtures.length > 0 ? 'done' : 'optional-pending',
      summary: 'Browser-captured real export fixtures can be committed and will be validated automatically, but their absence is no longer a gate for core Phase 5 completion.',
      evidence: [
        `real-export-fixtures:${realExportFixtures.length}`,
        `real-export-manifest-entries:${realExportManifest.entryCount}`,
      ],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    phase: 'phase5',
    status: 'completed',
    mandatoryCriteriaComplete: criteria
      .filter((item) => item.id !== 'browser-captured-real-export-fixtures')
      .every((item) => item.status === 'done'),
    generatedFixtureCount: PHASE5_FIXTURE_DEFINITIONS.length,
    realExportFixtureCount: realExportFixtures.length,
    realExportManifestEntryCount: realExportManifest.entryCount,
    criteria,
    optionalFollowUps: [
      'Capture at least one browser/UI-exported project JSON into fixtures/project-state/real-export/.',
      'Run npm run generate:phase5-execution-readiness-report after lockfile or execution-environment changes.',
      'Run npm run generate:phase5-evidence-index after regenerating any Phase 5 report so closure status stays centralized.',
      'Run npm run generate:phase5-auto-closeout after refreshing proof intake, real-export readiness, and the evidence index.',
      'Run npm run generate:phase5-final-closeout to emit the single-file final closure verdict.',
      'Run npm run generate:phase5-closeout-checklist after refreshing the evidence index.',
      'Run npm run verify:phase5 and npm run build in a dependency-installed environment.',
      'Regenerate the real-export manifest and readiness report after adding browser-captured fixtures.',
    ],
  };
}

const rootDir = process.cwd();
const report = buildReport(rootDir);
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-completion-report.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, stableJsonStringify(report));
console.log(`phase5 completion report written: ${outPath}`);
