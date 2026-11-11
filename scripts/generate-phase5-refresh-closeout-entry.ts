import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface RefreshStepResult {
  script: string;
  command: string;
  status: 'success' | 'failed' | 'skipped';
  exitCode: number | null;
}

interface Phase5RefreshCloseoutReport {
  generatedAt: string;
  phase: 'phase5';
  mode: 'pipeline';
  steps: RefreshStepResult[];
  summary: {
    successCount: number;
    failedCount: number;
    skippedCount: number;
  };
  nextSteps: string[];
}

const rootDir = process.cwd();
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-refresh-closeout-report.json');
const scripts = [
  'generate:phase5-fixtures',
  'generate:phase5-real-export-manifest',
  'generate:phase5-real-export-readiness-report',
  'generate:phase5-drift-report',
  'generate:phase5-import-report',
  'generate:phase5-execution-readiness-report',
  'generate:phase5-proof-intake',
  'generate:phase5-external-blockers-report',
  'generate:phase5-completion-report',
  'generate:phase5-evidence-index',
  'generate:phase5-closeout-checklist',
  'generate:phase5-auto-closeout',
  'generate:phase5-operator-handoff',
  'generate:phase5-final-closeout',
  'generate:phase5-completion-report',
  'generate:phase5-evidence-index',
  'generate:phase5-closeout-checklist',
  'generate:phase5-auto-closeout',
  'generate:phase5-operator-handoff',
  'generate:phase5-final-closeout',
] as const;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps: RefreshStepResult[] = [];

for (const script of scripts) {
  const result = spawnSync(npmCommand, ['run', script], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  const status: RefreshStepResult['status'] = result.status === 0 ? 'success' : 'failed';
  steps.push({
    script,
    command: `${npmCommand} run ${script}`,
    status,
    exitCode: result.status,
  });
  if (status === 'failed') {
    break;
  }
}

const successCount = steps.filter((step) => step.status === 'success').length;
const failedCount = steps.filter((step) => step.status === 'failed').length;
const skippedCount = scripts.length - steps.length;
for (let index = steps.length; index < scripts.length; index += 1) {
  steps.push({
    script: scripts[index],
    command: `${npmCommand} run ${scripts[index]}`,
    status: 'skipped',
    exitCode: null,
  });
}

const nextSteps: string[] = [];
if (failedCount > 0) {
  const failed = steps.find((step) => step.status === 'failed');
  nextSteps.push(`Fix the first failing refresh stage and rerun the pipeline: ${failed?.script ?? 'unknown'}.`);
}
if (failedCount === 0) {
  nextSteps.push('Review docs/archive/phase5-auto-closeout.json and docs/archive/phase5-closeout-checklist.json for the updated closure state.');
}

const report: Phase5RefreshCloseoutReport = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  mode: 'pipeline',
  steps,
  summary: {
    successCount,
    failedCount,
    skippedCount,
  },
  nextSteps,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`phase5 refresh closeout report written: ${outPath}`);
