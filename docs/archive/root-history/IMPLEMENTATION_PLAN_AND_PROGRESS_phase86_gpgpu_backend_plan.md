Phase 86 — GPGPU backend planning and runtime fallback

Added gpgpuExecutionPreference (auto / webgl / webgpu).

Added requestedBackend to the GPGPU execution foundation.

Scene GPGPU runtime now resolves backend through the shared foundation instead of reading gpgpuWebGPUEnabled directly.

WebGPU request now falls back to WebGL through the same resolver when WebGPU state is unavailable.

Diagnostics overlay now shows requested vs resolved backend for GPGPU.
