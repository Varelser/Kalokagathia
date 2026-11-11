import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const entry = join(scriptDir, "generate-phase5-operator-handoff-entry.ts");
const outfile = join(scriptDir, ".tmp-generate-phase5-operator-handoff-entry.cjs");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  logLevel: "silent",
});

await import(`file://${outfile}`);
