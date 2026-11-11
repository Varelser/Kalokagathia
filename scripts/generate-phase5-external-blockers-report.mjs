import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const outDir = path.join(rootDir, ".phase5-tmp");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "generate-phase5-external-blockers-report-entry.mjs");

await build({
  entryPoints: [path.join(rootDir, "scripts", "generate-phase5-external-blockers-report-entry.ts")],
  outfile: outFile,
  platform: "node",
  format: "esm",
  bundle: true,
  sourcemap: false,
  target: ["node20"],
});

await import(pathToFileURL(outFile).href);
