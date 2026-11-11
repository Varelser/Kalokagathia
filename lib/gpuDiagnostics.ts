// GPU environment diagnostics (2026-11-08): reports what the current
// browser/GPU can actually do, so "does it run here?" is answered from
// evidence instead of assumptions. Pure DOM/WebGL probes — no renderer
// state is touched (a throwaway canvas is used and released).

export interface GpuDiagnosticsReport {
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  softwareRendering: boolean;
  colorBufferFloat: boolean;
  colorBufferHalfFloat: boolean;
  floatLinearFiltering: boolean;
  maxTextureSize: number | null;
  fragmentHighp: boolean;
  webgpu: 'supported' | 'no-adapter' | 'unsupported';
  webgpuAdapter: string | null;
}

const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

export function isSoftwareRenderer(renderer: string | null): boolean {
  return renderer !== null && SOFTWARE_RENDERER_PATTERN.test(renderer);
}

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string; description?: string };
}

interface NavigatorWithGpu {
  gpu?: { requestAdapter?: () => Promise<GpuAdapterLike | null> };
}

export async function collectGpuDiagnostics(): Promise<GpuDiagnosticsReport> {
  const report: GpuDiagnosticsReport = {
    webgl2: false,
    renderer: null,
    vendor: null,
    softwareRendering: false,
    colorBufferFloat: false,
    colorBufferHalfFloat: false,
    floatLinearFiltering: false,
    maxTextureSize: null,
    fragmentHighp: false,
    webgpu: 'unsupported',
    webgpuAdapter: null,
  };

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (gl) {
    report.webgl2 = true;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      report.renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '') || null;
      report.vendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? '') || null;
    }
    if (!report.renderer) {
      report.renderer = String(gl.getParameter(gl.RENDERER) ?? '') || null;
    }
    report.softwareRendering = isSoftwareRenderer(report.renderer);
    report.colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
    report.colorBufferHalfFloat = gl.getExtension('EXT_color_buffer_half_float') !== null;
    report.floatLinearFiltering = gl.getExtension('OES_texture_float_linear') !== null;
    report.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    report.fragmentHighp = precision !== null && precision.precision > 0;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  const nav = navigator as unknown as NavigatorWithGpu;
  if (nav.gpu && typeof nav.gpu.requestAdapter === 'function') {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        report.webgpu = 'supported';
        const info = adapter.info;
        report.webgpuAdapter = [info?.vendor, info?.architecture, info?.description]
          .filter((part) => typeof part === 'string' && part.length > 0)
          .join(' / ') || 'adapter (no info)';
      } else {
        report.webgpu = 'no-adapter';
      }
    } catch {
      report.webgpu = 'no-adapter';
    }
  }

  return report;
}
