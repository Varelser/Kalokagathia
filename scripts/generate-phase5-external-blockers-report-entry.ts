import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const archiveDir = path.join(repoRoot, "docs", "archive");
const outputPath = path.join(archiveDir, "phase5-external-blockers-report.json");
const realExportDir = path.join(repoRoot, "fixtures", "project-state", "real-export");
const npmLogPath = path.join(process.env.HOME ?? "", ".npm", "_logs", "2026-03-31T07_20_46_177Z-debug-0.log");

const realExportFixtureCount = fs.existsSync(realExportDir)
  ? fs.readdirSync(realExportDir).filter((name) => name.endsWith(".json") && name !== "manifest.json").length
  : 0;

const npmCi = {
  attempted: true,
  command: "npm ci",
  status: "blocked",
  blockerCode: "E401",
  blockerReason: "Incorrect or missing password / npm registry authentication required in the execution environment.",
  logPath: fs.existsSync(npmLogPath) ? npmLogPath : null,
};

const buildAndVerify = [
  "npm run verify:project-state",
  "npm run verify:phase5",
  "npm run build",
].map((command) => ({
  command,
  status: "blocked",
  blockedBy: "npm ci / dependency installation unavailable due to npm registry authentication in this environment.",
}));

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    repoCoreComplete: true,
    executionProven: false,
    unresolvedBlockerCount: 2,
  },
  blockers: [
    {
      id: "npm-authentication",
      type: "environment",
      severity: "high",
      description: "Dependency installation cannot complete in this environment because npm registry authentication is required.",
      evidence: npmCi,
      nextStep: "Run npm ci in a checkout with valid npm registry credentials or an environment that can access the public registry without stale auth.",
    },
    {
      id: "browser-real-export-fixture-missing",
      type: "artifact",
      severity: "medium",
      description: "No browser-captured real export fixture has been committed yet.",
      evidence: {
        fixtureDirectory: realExportDir,
        realExportFixtureCount,
      },
      nextStep: "Capture at least one JSON export from the actual UI and commit it under fixtures/project-state/real-export/, then regenerate manifest/readiness/evidence reports.",
    },
  ],
  blockedCommands: buildAndVerify,
};

fs.mkdirSync(archiveDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
