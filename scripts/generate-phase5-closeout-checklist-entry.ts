import fs from 'node:fs';
import path from 'node:path';

interface Phase5CloseoutChecklistItem {
  id: string;
  status: 'done' | 'pending';
  category: 'repo' | 'execution' | 'real-export';
  summary: string;
  evidence: string[];
}

interface Phase5CloseoutChecklist {
  generatedAt: string;
  phase: 'phase5';
  counts: { done: number; pending: number };
  items: Phase5CloseoutChecklistItem[];
}

const rootDir = process.cwd();
const completion = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-completion-report.json'), 'utf8')) as {
  mandatoryCriteriaComplete?: boolean;
  realExportFixtureCount?: number;
};
const execution = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-execution-readiness-report.json'), 'utf8')) as {
  lockfileSynchronized?: boolean;
  nodeModulesPresent?: boolean;
};
const evidenceIndex = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'archive', 'phase5-evidence-index.json'), 'utf8')) as {
  summary?: { executionReady?: boolean; executionProven?: boolean; proofBundleVerified?: boolean };
};

const items: Phase5CloseoutChecklistItem[] = [
  {
    id: 'repo-core-complete',
    status: completion.mandatoryCriteriaComplete ? 'done' : 'pending',
    category: 'repo',
    summary: 'Core Phase 5 repository criteria are complete.',
    evidence: ['docs/archive/phase5-completion-report.json'],
  },
  {
    id: 'lockfile-synchronized',
    status: execution.lockfileSynchronized ? 'done' : 'pending',
    category: 'repo',
    summary: 'package-lock.json is synchronized with package.json for Phase 5 direct verifier dependencies.',
    evidence: ['package.json', 'package-lock.json', 'docs/archive/phase5-execution-readiness-report.json'],
  },
  {
    id: 'dependency-installed-verification-ready',
    status: execution.nodeModulesPresent ? 'done' : 'pending',
    category: 'execution',
    summary: 'A dependency-installed checkout is present so verify/build commands can be executed.',
    evidence: ['docs/archive/phase5-execution-readiness-report.json', 'docs/archive/phase5-proof-intake.json'],
  },
  {
    id: 'browser-real-export-fixture-committed',
    status: (completion.realExportFixtureCount ?? 0) > 0 ? 'done' : 'pending',
    category: 'real-export',
    summary: 'At least one browser-captured real export fixture is committed.',
    evidence: ['fixtures/project-state/real-export/', 'docs/archive/phase5-real-export-readiness-report.json'],
  },
  {
    id: 'proof-logs-verified',
    status: evidenceIndex.summary?.proofBundleVerified ? 'done' : 'pending',
    category: 'execution',
    summary: 'Required proof logs are present and show success markers for npm ci / verify / build commands.',
    evidence: ['docs/archive/phase5-proof-intake.json', 'docs/archive/phase5-evidence-index.json'],
  },
  {
    id: 'execution-proven-closeout',
    status: evidenceIndex.summary?.executionProven ? 'done' : 'pending',
    category: 'execution',
    summary: 'Phase 5 has execution-proven closure, not only repo-level readiness.',
    evidence: ['docs/archive/phase5-evidence-index.json', 'docs/archive/phase5-proof-intake.json'],
  },
];

const report: Phase5CloseoutChecklist = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  counts: {
    done: items.filter((item) => item.status === 'done').length,
    pending: items.filter((item) => item.status === 'pending').length,
  },
  items,
};

const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-closeout-checklist.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`phase5 closeout checklist written: ${outPath}`);
