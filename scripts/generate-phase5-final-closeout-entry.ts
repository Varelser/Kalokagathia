import fs from 'node:fs';
import path from 'node:path';

interface Phase5FinalCloseoutReport {
  generatedAt: string;
  phase: 'phase5';
  status:
    | 'repo-complete-awaiting-external-proof'
    | 'execution-ready-awaiting-real-export'
    | 'execution-ready-awaiting-proof-logs'
    | 'execution-proven';
  verdict: {
    repoReady: boolean;
    executionReady: boolean;
    executionProven: boolean;
    realExportFixturePresent: boolean;
    proofBundlePresent: boolean;
    proofBundleVerified: boolean;
  };
  blockers: {
    environment: string[];
    operator: string[];
    repo: string[];
  };
  evidence: string[];
  actionsRequiredNow: string[];
}

const rootDir = process.cwd();
const archiveDir = path.join(rootDir, 'docs', 'archive');
const outPath = path.join(archiveDir, 'phase5-final-closeout.json');

const evidenceIndex = JSON.parse(fs.readFileSync(path.join(archiveDir, 'phase5-evidence-index.json'), 'utf8')) as {
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
const proofIntake = JSON.parse(fs.readFileSync(path.join(archiveDir, 'phase5-proof-intake.json'), 'utf8')) as { nextSteps?: string[] };
const executionReadiness = JSON.parse(fs.readFileSync(path.join(archiveDir, 'phase5-execution-readiness-report.json'), 'utf8')) as {
  nodeModulesPresent?: boolean;
  environmentBlockers?: string[];
};
const externalBlockers = JSON.parse(fs.readFileSync(path.join(archiveDir, 'phase5-external-blockers-report.json'), 'utf8')) as {
  blockers?: Array<{ category?: string; summary?: string }>;
};
const autoCloseout = JSON.parse(fs.readFileSync(path.join(archiveDir, 'phase5-auto-closeout.json'), 'utf8')) as { nextSteps?: string[] };

const summary = evidenceIndex.summary ?? {};
const repoReady = Boolean(summary.repoReady);
const executionReady = Boolean(summary.executionReady);
const executionProven = Boolean(summary.executionProven);
const proofBundlePresent = Boolean(summary.proofBundlePresent);
const proofBundleVerified = Boolean(summary.proofBundleVerified);
const realExportFixturePresent = (summary.realExportFixtureCount ?? 0) > 0;

const environment = new Set<string>();
const operator = new Set<string>();
const repo = new Set<string>();

if (!executionReadiness.nodeModulesPresent) environment.add('Dependencies are not installed in the current checkout.');
for (const item of executionReadiness.environmentBlockers ?? []) environment.add(item);
for (const blocker of externalBlockers.blockers ?? []) {
  if (blocker.category === 'environment' && blocker.summary) environment.add(blocker.summary);
  if (blocker.category === 'operator' && blocker.summary) operator.add(blocker.summary);
}
if (!realExportFixturePresent) operator.add('At least one browser-captured real export fixture still needs to be committed.');
if (!proofBundlePresent) operator.add('Required proof logs have not all been provided yet.');
else if (!proofBundleVerified) operator.add('Proof logs are present but not all of them show success markers.');

const status: Phase5FinalCloseoutReport['status'] = executionProven
  ? 'execution-proven'
  : executionReady && !realExportFixturePresent
    ? 'execution-ready-awaiting-real-export'
    : executionReady && realExportFixturePresent && !proofBundleVerified
      ? 'execution-ready-awaiting-proof-logs'
      : 'repo-complete-awaiting-external-proof';

const actionsRequiredNow = [
  ...(evidenceIndex.remainingSteps ?? []),
  ...(proofIntake.nextSteps ?? []),
  ...(autoCloseout.nextSteps ?? []),
].filter((value, index, array) => typeof value === 'string' && array.indexOf(value) === index);

const report: Phase5FinalCloseoutReport = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  status,
  verdict: { repoReady, executionReady, executionProven, realExportFixturePresent, proofBundlePresent, proofBundleVerified },
  blockers: { environment: [...environment], operator: [...operator], repo: [...repo] },
  evidence: [
    'docs/archive/phase5-evidence-index.json',
    'docs/archive/phase5-proof-intake.json',
    'docs/archive/phase5-execution-readiness-report.json',
    'docs/archive/phase5-external-blockers-report.json',
    'docs/archive/phase5-auto-closeout.json',
    'docs/archive/phase5-closeout-checklist.json',
  ],
  actionsRequiredNow,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`phase5 final closeout report written: ${outPath}`);
