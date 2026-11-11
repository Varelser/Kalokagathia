import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

interface ReportFileSummary {
  path: string;
  exists: boolean;
  sizeBytes: number;
  sha256: string | null;
  generatedAt: string | null;
}

interface Phase5EvidenceIndex {
  generatedAt: string;
  phase: 'phase5';
  reports: ReportFileSummary[];
  summary: {
    completionCriteriaDone: number;
    completionCriteriaTotal: number;
    importScenarioCount: number;
    importAggregateSummary: Record<string, number>;
    driftGeneratedFixtureCount: number;
    realExportFixtureCount: number;
    realExportVerifiedCount: number;
    realExportFailingCount: number;
    readinessBlockerCount: number;
    proofBundlePresent: boolean;
    proofBundleVerified: boolean;
    repoReady: boolean;
    executionReady: boolean;
    executionProven: boolean;
    staleRealExportManifestEntryCount: number;
    realExportStatusCounts: Record<string, number>;
  };
  remainingSteps: string[];
  notes: string[];
}

const rootDir = process.cwd();
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-evidence-index.json');
const reportPaths = [
  'docs/archive/phase5-completion-report.json',
  'docs/archive/phase5-import-report.json',
  'docs/archive/phase5-drift-report.json',
  'docs/archive/phase5-real-export-readiness-report.json',
  'docs/archive/phase5-execution-readiness-report.json',
  'docs/archive/phase5-proof-intake.json',
  'docs/archive/phase5-final-closeout.json',
] as const;

function summarizeReport(relativePath: string): ReportFileSummary {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { path: relativePath, exists: false, sizeBytes: 0, sha256: null, generatedAt: null };
  }
  const text = fs.readFileSync(absolutePath, 'utf8');
  let generatedAt: string | null;
  try {
    const parsed = JSON.parse(text) as { generatedAt?: unknown };
    generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null;
  } catch {
    generatedAt = null;
  }
  return {
    path: relativePath,
    exists: true,
    sizeBytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    generatedAt,
  };
}

const reports = reportPaths.map(summarizeReport);
const completionReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-completion-report.json'), 'utf8')) as {
  criteria?: Array<{ status?: string }>;
  mandatoryCriteriaComplete?: boolean;
};
const importReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-import-report.json'), 'utf8')) as {
  scenarioCount?: number;
  aggregateSummary?: Record<string, number>;
};
const driftReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-drift-report.json'), 'utf8')) as {
  generatedFixtures?: unknown[];
};
const realExportReadinessReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-real-export-readiness-report.json'), 'utf8')) as {
  fixtureCount?: number;
  verifiedCount?: number;
  failingCount?: number;
  staleManifestEntries?: string[];
  statusCounts?: Record<string, number>;
};
const executionReadinessReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-execution-readiness-report.json'), 'utf8')) as {
  environmentBlockers?: string[];
  lockfileSynchronized?: boolean;
  nodeModulesPresent?: boolean;
  realExportFixtureCount?: number;
};
const proofIntakeReport = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-proof-intake.json'), 'utf8')) as {
  summary?: { executionProofBundlePresent?: boolean; executionProofBundleVerified?: boolean };
};

const criteria = Array.isArray(completionReport.criteria) ? completionReport.criteria : [];
const doneCount = criteria.filter((criterion) => criterion.status === 'done').length;
const importAggregateSummary = importReport.aggregateSummary ?? {};
const readinessBlockers = executionReadinessReport.environmentBlockers ?? [];
const realExportFixtureCount = typeof realExportReadinessReport.fixtureCount === 'number'
  ? realExportReadinessReport.fixtureCount
  : (typeof executionReadinessReport.realExportFixtureCount === 'number' ? executionReadinessReport.realExportFixtureCount : 0);
const realExportStatusCounts = realExportReadinessReport.statusCounts ?? {};
const staleRealExportManifestEntryCount = Array.isArray(realExportReadinessReport.staleManifestEntries)
  ? realExportReadinessReport.staleManifestEntries.length
  : 0;
const proofBundlePresent = Boolean(proofIntakeReport.summary?.executionProofBundlePresent);
const proofBundleVerified = Boolean(proofIntakeReport.summary?.executionProofBundleVerified);
const repoReady = Boolean(completionReport.mandatoryCriteriaComplete) && Boolean(executionReadinessReport.lockfileSynchronized);
const executionReady = repoReady && Boolean(executionReadinessReport.nodeModulesPresent) && readinessBlockers.length === 0;
const executionProven = executionReady && realExportFixtureCount > 0 && proofBundleVerified;

const remainingSteps: string[] = [];
if (!executionReadinessReport.nodeModulesPresent) {
  remainingSteps.push('Install dependencies and run npm ci in an environment with registry access.');
}
if (realExportFixtureCount === 0) {
  remainingSteps.push('Commit at least one browser-captured real export fixture under fixtures/project-state/real-export/.');
}
if (!proofBundlePresent) {
  remainingSteps.push('Capture npm ci / verify:project-state / verify:phase5 / build logs under docs/archive/phase5-proof-input/.');
} else if (!proofBundleVerified) {
  remainingSteps.push('Replace or rerun proof logs until all required command logs show success markers.');
}
if (readinessBlockers.length > 0) {
  remainingSteps.push('Re-run npm run verify:project-state, npm run verify:phase5, and npm run build after environment blockers are removed.');
}
if (staleRealExportManifestEntryCount > 0) {
  remainingSteps.push('Regenerate the real-export manifest after removing or renaming real-export fixture files.');
}

const index: Phase5EvidenceIndex = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  reports,
  summary: {
    completionCriteriaDone: doneCount,
    completionCriteriaTotal: criteria.length,
    importScenarioCount: typeof importReport.scenarioCount === 'number' ? importReport.scenarioCount : 0,
    importAggregateSummary,
    driftGeneratedFixtureCount: Array.isArray(driftReport.generatedFixtures) ? driftReport.generatedFixtures.length : 0,
    realExportFixtureCount,
    realExportVerifiedCount: typeof realExportReadinessReport.verifiedCount === 'number' ? realExportReadinessReport.verifiedCount : 0,
    realExportFailingCount: typeof realExportReadinessReport.failingCount === 'number' ? realExportReadinessReport.failingCount : 0,
    readinessBlockerCount: readinessBlockers.length,
    proofBundlePresent,
    proofBundleVerified,
    repoReady,
    executionReady,
    executionProven,
    staleRealExportManifestEntryCount,
    realExportStatusCounts,
  },
  remainingSteps,
  notes: [
    'This index condenses the scattered Phase 5 reports into one file so closure status can be reviewed without opening each report manually.',
    'repoReady means mandatory Phase 5 criteria are complete and the lockfile is synchronized.',
    'executionReady means repoReady plus a dependency-installed checkout with no current execution blockers.',
    'executionProven remains false until the dependency-installed commands are re-run successfully and at least one browser-captured real export fixture is committed.',
  ],
};

fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`phase5 evidence index written: ${outPath}`);
