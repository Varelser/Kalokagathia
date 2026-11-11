import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type ProofCommandStatus = 'missing' | 'success' | 'failed' | 'unknown';

interface ProofFileSummary {
  fileName: string;
  exists: boolean;
  sizeBytes: number;
  sha256: string | null;
  status: ProofCommandStatus;
  detectedReason: string | null;
}

interface Phase5ProofIntakeReport {
  generatedAt: string;
  phase: 'phase5';
  proofInputDir: string;
  requiredFiles: ProofFileSummary[];
  optionalFiles: ProofFileSummary[];
  summary: {
    requiredPresentCount: number;
    requiredTotalCount: number;
    optionalPresentCount: number;
    successfulRequiredCount: number;
    failedRequiredCount: number;
    unknownRequiredCount: number;
    executionProofBundlePresent: boolean;
    executionProofBundleVerified: boolean;
  };
  nextSteps: string[];
}

const rootDir = process.cwd();
const relativeProofDir = path.join('docs', 'archive', 'phase5-proof-input');
const proofDir = path.join(rootDir, relativeProofDir);
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-proof-intake.json');
const requiredFileNames = ['npm-ci.log', 'verify-project-state.log', 'verify-phase5.log', 'build.log'] as const;
const optionalFileNames = ['real-export-capture-notes.md'] as const;

function detectLogStatus(fileName: string, text: string): { status: ProofCommandStatus; detectedReason: string | null } {
  const normalized = text.toLowerCase();
  if (/\be401\b/.test(normalized) || /incorrect or missing password/.test(normalized) || /authentication/i.test(text)) {
    return { status: 'failed', detectedReason: 'authentication-error' };
  }
  if (/\berr!\b/.test(normalized) || /failed/i.test(text) || /error:/i.test(text) || /command failed/i.test(text)) {
    return { status: 'failed', detectedReason: 'error-marker-detected' };
  }

  if (fileName === 'npm-ci.log') {
    if (/added\s+\d+\s+packages/i.test(text) || /up to date/i.test(text) || /audited\s+\d+\s+packages/i.test(text)) {
      return { status: 'success', detectedReason: 'npm-ci-success-marker' };
    }
  }

  if (fileName === 'build.log') {
    if (/vite v[\d.]+ building/i.test(text) && (/built in/i.test(text) || /✓ built in/i.test(text) || /dist\//i.test(text))) {
      return { status: 'success', detectedReason: 'build-success-marker' };
    }
  }

  if (fileName === 'verify-project-state.log' || fileName === 'verify-phase5.log') {
    if (/written:/i.test(text) || /completed/i.test(text) || /passed/i.test(text) || /ok\b/i.test(text) || /success/i.test(text)) {
      return { status: 'success', detectedReason: 'verify-success-marker' };
    }
  }

  return { status: 'unknown', detectedReason: null };
}

function summarizeFile(fileName: string): ProofFileSummary {
  const absolutePath = path.join(proofDir, fileName);
  if (!fs.existsSync(absolutePath)) {
    return { fileName, exists: false, sizeBytes: 0, sha256: null, status: 'missing', detectedReason: null };
  }
  const data = fs.readFileSync(absolutePath);
  const text = data.toString('utf8');
  const detection = detectLogStatus(fileName, text);
  return {
    fileName,
    exists: true,
    sizeBytes: data.byteLength,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    status: detection.status,
    detectedReason: detection.detectedReason,
  };
}

const requiredFiles = requiredFileNames.map((fileName) => summarizeFile(fileName));
const optionalFiles = optionalFileNames.map((fileName) => summarizeFile(fileName));
const requiredPresentCount = requiredFiles.filter((file) => file.exists).length;
const optionalPresentCount = optionalFiles.filter((file) => file.exists).length;
const successfulRequiredCount = requiredFiles.filter((file) => file.status === 'success').length;
const failedRequiredCount = requiredFiles.filter((file) => file.status === 'failed').length;
const unknownRequiredCount = requiredFiles.filter((file) => file.status === 'unknown').length;
const executionProofBundlePresent = requiredPresentCount === requiredFiles.length;
const executionProofBundleVerified = executionProofBundlePresent && successfulRequiredCount === requiredFiles.length;

const nextSteps: string[] = [];
if (!executionProofBundlePresent) {
  const missing = requiredFiles.filter((file) => !file.exists).map((file) => file.fileName);
  nextSteps.push(`Provide the missing proof logs under ${relativeProofDir}: ${missing.join(', ')}`);
}
if (failedRequiredCount > 0) {
  const failed = requiredFiles.filter((file) => file.status === 'failed').map((file) => `${file.fileName}:${file.detectedReason ?? 'failed'}`);
  nextSteps.push(`Re-run the failed proof commands until the logs no longer contain failure markers: ${failed.join(', ')}`);
}
if (unknownRequiredCount > 0) {
  const unknown = requiredFiles.filter((file) => file.status === 'unknown').map((file) => file.fileName);
  nextSteps.push(`Review or replace logs whose success could not be confirmed automatically: ${unknown.join(', ')}`);
}
if (!optionalFiles[0]?.exists) {
  nextSteps.push(`Optional: add ${path.join(relativeProofDir, 'real-export-capture-notes.md')} with browser capture details.`);
}

const report: Phase5ProofIntakeReport = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  proofInputDir: relativeProofDir,
  requiredFiles,
  optionalFiles,
  summary: {
    requiredPresentCount,
    requiredTotalCount: requiredFiles.length,
    optionalPresentCount,
    successfulRequiredCount,
    failedRequiredCount,
    unknownRequiredCount,
    executionProofBundlePresent,
    executionProofBundleVerified,
  },
  nextSteps,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`phase5 proof intake report written: ${outPath}`);
