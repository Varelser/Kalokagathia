import fs from 'node:fs';
import path from 'node:path';

interface Phase5AutoCloseoutReport {
  generatedAt: string;
  phase: 'phase5';
  status: 'repo-ready' | 'execution-ready' | 'execution-proven';
  flags: {
    repoReady: boolean;
    executionReady: boolean;
    executionProven: boolean;
    proofBundlePresent: boolean;
    proofBundleVerified: boolean;
    realExportFixturePresent: boolean;
  };
  derivedFrom: string[];
  nextSteps: string[];
}

const rootDir = process.cwd();
const evidence = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-evidence-index.json'), 'utf8')) as {
  summary?: {
    repoReady?: boolean;
    executionReady?: boolean;
    executionProven?: boolean;
    proofBundlePresent?: boolean;
    proofBundleVerified?: boolean;
    realExportFixtureCount?: number;
  };
  remainingSteps?: string[];
};

const summary = evidence.summary ?? {};
const repoReady = Boolean(summary.repoReady);
const executionReady = Boolean(summary.executionReady);
const executionProven = Boolean(summary.executionProven);
const proofBundlePresent = Boolean(summary.proofBundlePresent);
const proofBundleVerified = Boolean(summary.proofBundleVerified);
const realExportFixturePresent = (summary.realExportFixtureCount ?? 0) > 0;

const status: Phase5AutoCloseoutReport['status'] = executionProven
  ? 'execution-proven'
  : executionReady
    ? 'execution-ready'
    : 'repo-ready';

const report: Phase5AutoCloseoutReport = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  status,
  flags: {
    repoReady,
    executionReady,
    executionProven,
    proofBundlePresent,
    proofBundleVerified,
    realExportFixturePresent,
  },
  derivedFrom: [
    'docs/archive/phase5-proof-intake.json',
    'docs/archive/phase5-real-export-readiness-report.json',
    'docs/archive/phase5-execution-readiness-report.json',
    'docs/archive/phase5-evidence-index.json',
    'docs/archive/phase5-closeout-checklist.json',
  ],
  nextSteps: Array.isArray(evidence.remainingSteps) ? evidence.remainingSteps : [],
};

const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-auto-closeout.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`phase5 auto-closeout report written: ${outPath}`);
