import type { ParticleConfig } from '../types';
import { buildPostFxStackPatch } from './postFxLibrary';
import type { ProductPackBundle, ProductPackFamily } from './productPackLibraryTypes';
import { TOUCHDESIGNER_PRODUCT_PACK_BUNDLES } from './productPackLibraryTouchDesigner';
import { TRAPCODE_PRODUCT_PACK_BUNDLES } from './productPackLibraryTrapcode';
import { UNIVERSE_PRODUCT_PACK_BUNDLES } from './productPackLibraryUniverse';
import { HYBRID_PRODUCT_PACK_BUNDLES } from './productPackLibraryHybrid';
import { HOUDINI_PRODUCT_PACK_BUNDLES } from './productPackLibraryHoudini';
import { NIAGARA_PRODUCT_PACK_BUNDLES } from './productPackLibraryNiagara';
import { GEOMETRY_NODES_PRODUCT_PACK_BUNDLES } from './productPackLibraryGeometryNodes';
import { UNITY_VFX_PRODUCT_PACK_BUNDLES } from './productPackLibraryUnityVfx';

export type { ProductPackBundle, ProductPackFamily } from './productPackLibraryTypes';

export const PRODUCT_PACK_BUNDLES: ProductPackBundle[] = [
  ...TOUCHDESIGNER_PRODUCT_PACK_BUNDLES,
  ...TRAPCODE_PRODUCT_PACK_BUNDLES,
  ...UNIVERSE_PRODUCT_PACK_BUNDLES,
  ...HYBRID_PRODUCT_PACK_BUNDLES,
  ...HOUDINI_PRODUCT_PACK_BUNDLES,
  ...NIAGARA_PRODUCT_PACK_BUNDLES,
  ...GEOMETRY_NODES_PRODUCT_PACK_BUNDLES,
  ...UNITY_VFX_PRODUCT_PACK_BUNDLES,
];

const PRODUCT_PACK_BUNDLES_BY_ID = new Map(PRODUCT_PACK_BUNDLES.map((bundle) => [bundle.id, bundle]));

function matchesSignature(config: ParticleConfig, signature: Partial<ParticleConfig>) {
  return (Object.keys(signature) as Array<keyof ParticleConfig>).every((key) => config[key] === signature[key]);
}

export function getProductPackBundleById(id: string | null | undefined) {
  if (!id) return null;
  return PRODUCT_PACK_BUNDLES_BY_ID.get(id) ?? null;
}

export function buildProductPackPatch(bundleOrId: ProductPackBundle | string): Partial<ParticleConfig> {
  const bundle = typeof bundleOrId === 'string' ? getProductPackBundleById(bundleOrId) : bundleOrId;
  if (!bundle) return {};
  return {
    ...bundle.patch,
    ...buildPostFxStackPatch(bundle.postStackId),
  };
}

export function applyProductPackBundle(config: ParticleConfig, bundleOrId: ProductPackBundle | string): ParticleConfig {
  return {
    ...config,
    ...buildProductPackPatch(bundleOrId),
  };
}

export function inferProductPackBundleId(config: ParticleConfig): string | null {
  const exact = PRODUCT_PACK_BUNDLES.find((bundle) => matchesSignature(config, bundle.signature));
  if (exact) return exact.id;
  return null;
}

export function getReferencedProductPackBundleIds(configs: ParticleConfig[]): string[] {
  return Array.from(new Set(configs
    .map((config) => inferProductPackBundleId(config))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

export function getReferencedProductPackFamilies(configs: ParticleConfig[]): ProductPackFamily[] {
  return Array.from(new Set(getReferencedProductPackBundleIds(configs)
    .map((id) => getProductPackBundleById(id)?.family)
    .filter((value): value is ProductPackFamily => typeof value === 'string' && value.length > 0)));
}
