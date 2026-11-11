import fs from 'node:fs';
import path from 'node:path';

interface PackageLockDependencySnapshot {
  name: string;
  version: string | null;
  declaredInPackageJson: boolean;
  presentInPackageLock: boolean;
}

interface Phase5ExecutionReadinessReport {
  generatedAt: string;
  phase: 'phase5';
  lockfileSynchronized: boolean;
  nodeModulesPresent: boolean;
  realExportFixtureCount: number;
  readyForRepoLevelExecution: boolean;
  environmentBlockers: string[];
  requiredCommands: string[];
  dependencySnapshots: PackageLockDependencySnapshot[];
  notes: string[];
}

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const realExportDir = path.join(rootDir, 'fixtures', 'project-state', 'real-export');
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-execution-readiness-report.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8')) as {
  dependencies?: Record<string, { version?: string }>;
  packages?: Record<string, { version?: string }>;
};

const requiredDeps = ['esbuild', 'skia-canvas'];
const declared = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};

const snapshots: PackageLockDependencySnapshot[] = requiredDeps.map((name) => {
  const lockDep = packageLock.packages?.[`node_modules/${name}`] ?? packageLock.dependencies?.[name];
  return {
    name,
    version: typeof lockDep?.version === 'string' ? lockDep.version : null,
    declaredInPackageJson: typeof declared[name] === 'string',
    presentInPackageLock: Boolean(lockDep),
  };
});

const lockfileSynchronized = snapshots.every((snapshot) => snapshot.declaredInPackageJson && snapshot.presentInPackageLock);
const nodeModulesPresent = fs.existsSync(path.join(rootDir, 'node_modules'));
const realExportFixtureCount = fs.existsSync(realExportDir)
  ? fs.readdirSync(realExportDir).filter((name) => name.endsWith('.json') && name !== 'manifest.json').length
  : 0;

const environmentBlockers: string[] = [];
if (!nodeModulesPresent) {
  environmentBlockers.push('node_modules directory is missing; npm run verify:phase5 and npm run build cannot be executed in this checkout yet.');
}
if (realExportFixtureCount === 0) {
  environmentBlockers.push('No browser-captured real-export fixture is committed under fixtures/project-state/real-export/.');
}

const report: Phase5ExecutionReadinessReport = {
  generatedAt: new Date().toISOString(),
  phase: 'phase5',
  lockfileSynchronized,
  nodeModulesPresent,
  realExportFixtureCount,
  readyForRepoLevelExecution: lockfileSynchronized,
  environmentBlockers,
  requiredCommands: [
    'npm ci',
    'npm run verify:project-state',
    'npm run verify:phase5',
    'npm run build',
  ],
  dependencySnapshots: snapshots,
  notes: [
    'This report separates repository-level readiness from environment-level blockers.',
    'Lockfile synchronization for esbuild/skia-canvas is a repository requirement because Phase 5 verification depends on those packages directly.',
    'Browser-captured real-export fixtures remain optional for core Phase 5 completion but are still listed as a follow-through blocker for execution-proven closure.',
  ],
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`phase5 execution readiness report written: ${outPath}`);
