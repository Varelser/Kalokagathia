import type { UseGpgpuAssetsArgs } from "./gpgpuAssetShared";
import { useGpgpuDrawAssets } from "./useGpgpuDrawAssets";
import { useGpgpuMeshAssets } from "./useGpgpuMeshAssets";
import { useGpgpuSimulationAssets } from "./useGpgpuSimulationAssets";
import { useGpgpuTrailAssets } from "./useGpgpuTrailAssets";

export function useGpgpuAssets({ config, texSize, simScene, simGeo }: UseGpgpuAssetsArgs) {
  const simulationAssets = useGpgpuSimulationAssets({ config, texSize, simScene, simGeo });
  const drawAssets = useGpgpuDrawAssets(config, texSize);
  const trailAssets = useGpgpuTrailAssets(config, texSize);
  const meshAssets = useGpgpuMeshAssets(config, texSize);

  return {
    ...simulationAssets,
    ...drawAssets,
    ...trailAssets,
    ...meshAssets,
  };
}

export type GpgpuAssetBundle = ReturnType<typeof useGpgpuAssets>;
