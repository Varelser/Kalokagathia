import fs from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const distDir = path.join(workspaceRoot, 'dist');
const sourceHtmlPath = path.join(distDir, 'index.html');
const sourceAssetsPath = path.join(distDir, 'assets');

// Output: dist/deploy/ — this is what gets copied to varelser.github.io root
const deployDir = path.join(distDir, 'deploy');
const targetHtmlPath = path.join(deployDir, 'kalokagathia.html');
const targetAssetsPath = path.join(deployDir, 'assets');

async function main() {
  let sourceHtml = await fs.readFile(sourceHtmlPath, 'utf8');

  // Inject service-worker unregistration script to prevent root SW cache interference
  const swCleanupScript = `<script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(r) { r.unregister(); });
        });
        caches.keys().then(function(names) {
          names.filter(function(n) { return n.startsWith('thought-workbench'); }).forEach(function(n) { caches.delete(n); });
        });
      }
    </script>`;
  sourceHtml = sourceHtml.replace(
    /<script type="module"/,
    swCleanupScript + '\n    <script type="module"'
  );

  await fs.mkdir(deployDir, { recursive: true });
  await fs.writeFile(targetHtmlPath, sourceHtml, 'utf8');
  await fs.cp(sourceAssetsPath, targetAssetsPath, { recursive: true });

  console.log(JSON.stringify({
    html: path.relative(workspaceRoot, targetHtmlPath),
    assets: path.relative(workspaceRoot, targetAssetsPath),
    deployDir: path.relative(workspaceRoot, deployDir),
    passed: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
