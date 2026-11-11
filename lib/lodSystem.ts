// lib/lodSystem.ts
// FPS-based adaptive LOD manager for GPGPU particle system

const BUFFER_SIZE = 90; // 90-frame rolling average (~1.5 sec at 60fps)

export class LodSystem {
  private fpsBuffer: number[] = [];

  update(delta: number): void {
    const fps = 1 / Math.max(delta, 0.001);
    this.fpsBuffer.push(fps);
    if (this.fpsBuffer.length > BUFFER_SIZE) this.fpsBuffer.shift();
  }

  getAverageFps(): number {
    if (this.fpsBuffer.length === 0) return 60;
    return this.fpsBuffer.reduce((a, b) => a + b, 0) / this.fpsBuffer.length;
  }

  /** 0=full, 1=medium, 2=low */
  getLevel(): 0 | 1 | 2 {
    const fps = this.getAverageFps();
    if (fps >= 45) return 0;
    if (fps >= 25) return 1;
    return 2;
  }

  /** Multiplier to apply to particle count (0.25–1.0) */
  getCountMultiplier(): number {
    const level = this.getLevel();
    if (level === 0) return 1.0;
    if (level === 1) return 0.5;
    return 0.25;
  }

  /** Returns effective particle count after LOD */
  getEffectiveCount(nominal: number): number {
    return Math.max(16, Math.floor(nominal * this.getCountMultiplier()));
  }

  /** Whether expensive per-particle loop features should be skipped */
  shouldSkipExpensive(): boolean {
    return this.getLevel() >= 2;
  }
}
