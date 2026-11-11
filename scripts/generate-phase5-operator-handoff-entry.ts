import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ARCHIVE_DIR = join(process.cwd(), "docs", "archive");
const OUTPUT_PATH = join(ARCHIVE_DIR, "phase5-operator-handoff.json");

interface ArchiveJson {
  status?: string;
  summary?: { repoReady?: boolean; executionReady?: boolean; executionProven?: boolean; proofBundleVerified?: boolean };
  items?: Array<{ status?: string; id?: string }>;
  fixtureCount?: number;
  statusCounts?: Record<string, number>;
}

function readJson(path: string): ArchiveJson | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ArchiveJson;
}

function sha256(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const evidence = readJson(join(ARCHIVE_DIR, "phase5-evidence-index.json"));
const checklist = readJson(join(ARCHIVE_DIR, "phase5-closeout-checklist.json"));
const realExportReadiness = readJson(join(ARCHIVE_DIR, "phase5-real-export-readiness-report.json"));
const autoCloseout = readJson(join(ARCHIVE_DIR, "phase5-auto-closeout.json"));

const proofInputDir = join(ARCHIVE_DIR, "phase5-proof-input");
const requiredProofFiles = [
  "npm-ci.log",
  "verify-project-state.log",
  "verify-phase5.log",
  "build.log",
];

const proofFileStatus = requiredProofFiles.map((name) => {
  const path = join(proofInputDir, name);
  return {
    fileName: name,
    present: existsSync(path),
    sizeBytes: existsSync(path) ? statSync(path).size : 0,
    sha256: sha256(path),
  };
});

const commands = [
  "npm ci",
  "npm run verify:project-state",
  "npm run verify:phase5",
  "npm run build",
  "npm run generate:phase5-refresh-closeout",
];

const requiredRealExportNotes = join(proofInputDir, "real-export-capture-notes.md");

const report = {
  generatedAt: new Date().toISOString(),
  status: autoCloseout?.status ?? "unknown",
  summary: {
    repoReady: Boolean(evidence?.summary?.repoReady),
    executionReady: Boolean(evidence?.summary?.executionReady),
    executionProven: Boolean(evidence?.summary?.executionProven),
    proofBundleVerified: Boolean(evidence?.summary?.proofBundleVerified),
    realExportFixtureCount: Number(realExportReadiness?.fixtureCount ?? 0),
    pendingChecklistItems: Array.isArray(checklist?.items)
      ? checklist.items.filter((item) => item.status !== "done").map((item) => item.id)
      : [],
  },
  requiredCommands: commands,
  proofInputs: {
    directory: "docs/archive/phase5-proof-input",
    files: proofFileStatus,
    optionalFiles: [
      {
        fileName: "real-export-capture-notes.md",
        present: existsSync(requiredRealExportNotes),
        sizeBytes: existsSync(requiredRealExportNotes) ? statSync(requiredRealExportNotes).size : 0,
        sha256: sha256(requiredRealExportNotes),
      },
    ],
  },
  realExportFixtureIntake: {
    directory: "fixtures/project-state/real-export",
    expectedPattern: "monosphere-project-*.json",
    fixtureCount: Number(realExportReadiness?.fixtureCount ?? 0),
    readinessStatuses: realExportReadiness?.statusCounts ?? {},
  },
  nextActions: [
    "Run the required commands in a dependency-installed environment and save each stdout/stderr log to docs/archive/phase5-proof-input using the fixed file names.",
    "Capture at least one browser-exported monosphere-project-*.json file and place it in fixtures/project-state/real-export/.",
    "Add real-export-capture-notes.md describing browser, route, and capture date if a real export fixture is added.",
    "Run npm run generate:phase5-refresh-closeout to refresh all reports and auto-closeout status.",
  ],
};

mkdirSync(ARCHIVE_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${OUTPUT_PATH}`);
