import fs from 'node:fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Preset-count injection (Phase A): index.html carries the literal
 * token __PRESET_COUNT__ wherever the copy states how many generated
 * presets ship with the app (description / og:description). At build
 * time the token is replaced with the real count from
 * public/generated-collection.json — which the prebuild step
 * (scripts/build-generated-index.mjs) has just regenerated — so the
 * public copy can never go stale the way the hand-written "750" did.
 * If the index cannot be read, the count phrase is dropped instead
 * of leaving a wrong number (or the raw token) in the page.
 */
function presetCountPlugin(): Plugin {
  return {
    name: 'kalokagathia-preset-count',
    transformIndexHtml(html) {
      let count = '';
      try {
        const raw = fs.readFileSync(path.resolve(import.meta.dirname, 'public/generated-collection.json'), 'utf8');
        const parsed = JSON.parse(raw) as { count?: unknown };
        if (typeof parsed.count === 'number' && parsed.count > 0) {
          count = parsed.count.toLocaleString('en-US');
        }
      } catch {
        // Fall through to the count-free wording below.
      }
      if (count) return html.replaceAll('__PRESET_COUNT__', count);
      return html
        .replaceAll('__PRESET_COUNT__種の', '')
        .replaceAll('__PRESET_COUNT__ ', '');
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
  const libraryScope = env.VITE_LIBRARY_SCOPE ?? process.env.VITE_LIBRARY_SCOPE ?? 'private';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [tailwindcss(), react(), presetCountPlugin()],
      define: {
        '__LIBRARY_SCOPE__': JSON.stringify(libraryScope),
      },
      resolve: {
        alias: {
          '@': path.resolve(import.meta.dirname, '.'),
        }
      },
      build: {
        chunkSizeWarningLimit: 700,
        // Vite 8 (Rolldown): the former rollupOptions.manualChunks rules,
        // translated into codeSplitting groups. Two Rolldown semantics differ
        // from Rollup and shape this table:
        //  - manualChunks is not honored by Rolldown (silently ignored).
        //  - A codeSplitting group also captures the still-unclaimed
        //    dependencies of its modules, so vendor groups must outrank the
        //    app groups that depend on them, or e.g. three would be pulled
        //    into the scene chunks. Within each tier the order matches the
        //    original manualChunks rule order.
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: 'three-core', priority: 100, test: /\/node_modules\/three\// },
                { name: 'r3f-fiber', priority: 95, test: /@react-three\/fiber/ },
                { name: 'r3f-drei', priority: 90, test: /(@react-three\/drei|three-stdlib|@react-three\/postprocessing|\/node_modules\/postprocessing\/)/ },
                { name: 'r3f-utils', priority: 85, test: /\/(maath|react-use-measure|debounce|its-fine|react-reconciler)\// },
                { name: 'react-vendor', priority: 80, test: /\/node_modules\/(react|react-dom|scheduler|zustand)\// },
                { name: 'ui-vendor', priority: 75, test: /lucide-react/ },
                { name: 'jszip', priority: 76, test: /\/node_modules\/(jszip|pako|lie|setimmediate|readable-stream|inherits|core-util-is|process-nextick-args|util-deprecate|isarray|string_decoder|safe-buffer)\// },
                { name: 'vendor', priority: 70, test: /\/node_modules\// },
                { name: 'public-library-data', priority: 62, test: /\/public-library\.json/ },
                // App-core modules are needed by the initial chunks (state,
                // routing, scene generation, particle physics/shaders). They
                // must be claimed BEFORE the depiction/gpgpu/surface groups,
                // whose dependency capture otherwise drags them into those
                // chunks and makes the whole group a static startup import.
                { name: 'app-core', priority: 60, test: /\/(lib\/(appState|sceneRenderRouting|sceneGeneration|gpuTier|storageDb|raymarchDefaults|executionFoundation|simulationAdapter|sourceFieldFoundation|webgpuComputeFoundation|gpgpuExecutionFoundation|temporalProfiles|motionChain|motionDag|motionGraph|motionRoute|lodSystem|webgpuCompute|sourceAwareShaping|seededRng)|components\/(scenePhysics|sceneShader|sceneMotionEstimator|particleData))/ },
                // Lowest priority on purpose: this group backs the lazily
                // imported starter library. Groups capture their modules'
                // still-unclaimed dependencies, so a high priority here would
                // pull shared app modules (appStateConfig & friends, also
                // needed by the initial chunks) into the lazy chunk and make
                // it a static dependency of the entry again. At priority 10
                // every other group claims its shared dependencies first and
                // only the starter/operator data itself lands in this chunk.
                { name: 'starter-library-data', priority: 10, test: /\/lib\/(starterLibrary|operatorGeneratedStarters)/ },
                { name: 'depiction-catalog', priority: 55, test: /\/lib\/(depiction|productPack|temporalProfiles|renderModeRegistry|materialMoodBundles|motionArchitecture|expressionAtlas|hybridExpression|hybridTemporalVariant)/ },
                { name: 'scene-gpgpu', priority: 50, test: /\/components\/(gpgpu|useGpgpu|sceneGpgpu)/ },
                { name: 'scene-surface-families', priority: 45, test: /\/components\/(sceneSurface|sceneVolume|sceneBrushSurface|sceneGrowthField|sceneMembrane|sceneFiberField|sceneDepositionField|sceneCrystal|sceneErosionTrail|sceneSdfSurfaceShell|sceneVolumetricField)/ },
                { name: 'scene-core-families', priority: 40, test: /\/components\/(sceneParticle|sceneLine|sceneReactionDiffusion|sceneVoxelLattice|sceneGlyphOutline|sceneMotionEstimator|scenePhysics|sceneShader)/ },
              ],
            },
          },
        },
      }
    };
});
