import React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  getHorizonEquirectTexture,
  getHorizonGradientTexture,
  getHorizonImageTexture,
  horizonEquirectYawRadians,
  isHorizonActive,
  isHorizonSuppressed,
} from '../lib/horizonBackground';

// Horizon background sync (Phase I, equirect added in Phase N):
// when the Horizon background is active and not suppressed, this
// component owns scene.background and points it at the gradient /
// image texture from lib/horizonBackground.ts. It mounts AFTER
// SceneBackgroundSync and the declarative <color attach="background">
// in AppScene, so its effect wins while active; when it deactivates
// (mode back to 'solid', image cleared, stream override appearing)
// it restores the legacy colour itself, because the declarative
// colour's args may not have changed and R3F would not re-attach it.
//
// Image projection (Phase N): 'flat' (default) is the Phase I plane
// backdrop — the image is baked at the frame aspect with cover/fit.
// 'equirect' loads the source with EquirectangularReflectionMapping
// and also owns scene.backgroundRotation (yaw offset); three.js
// then renders the panorama on the inside of the background sphere
// and the view follows the camera. The rotation is reset to zero
// whenever equirect is not the active projection, so the flat /
// gradient / solid paths are untouched by it. Deterministic
// captures keep working through the same scene.background channel:
// transparent nulls the background, UnMult forces black, and the
// Phase G camera pin makes the panorama reproducible frame-for-
// frame in opaque renders.
//
// The decode of an image source is asynchronous: until the texture
// is ready the legacy colour stays (the UI states the fallback
// explicitly), then a local state bump re-runs the effect and the
// texture takes over. A generation counter guards against a slow
// decode of a superseded source landing last.

export const HorizonBackground: React.FC<{
  config: ParticleConfig;
  /** Legacy rendered colour (backgroundOverride ?? backgroundHex ??
   *  backgroundColor tone), used as the restore target and as the
   *  image mode's letterbox / not-ready fallback. */
  legacyColor: string;
  transparentBackground?: boolean;
  backgroundOverrideColor?: string;
}> = ({ config, legacyColor, transparentBackground = false, backgroundOverrideColor }) => {
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const [textureTick, setTextureTick] = React.useState(0);

  const suppressed = isHorizonSuppressed(transparentBackground, backgroundOverrideColor);
  const active = !suppressed && isHorizonActive(config);
  const mode = config.backgroundMode;
  const imageSource = config.backgroundImageSource;
  const imageFit = config.backgroundImageFit;
  const equirect = mode === 'image' && config.backgroundImageProjection === 'equirect';
  const yawRad = horizonEquirectYawRadians(config.backgroundEquirectYaw);
  const frameAspect = size.height > 0 ? size.width / size.height : 1;

  const readImageState = React.useCallback(() => {
    return equirect
      ? getHorizonEquirectTexture(imageSource)
      : getHorizonImageTexture(imageSource, imageFit, frameAspect, legacyColor);
  }, [equirect, imageSource, imageFit, frameAspect, legacyColor]);

  // Re-run the effect when an image decode lands: the texture getter
  // is cache-based, so poll it briefly while a source is pending.
  React.useEffect(() => {
    if (!active || mode !== 'image' || !imageSource) return undefined;
    const state = readImageState();
    if (state.ready) return undefined;
    const timer = window.setInterval(() => {
      const next = readImageState();
      if (next.ready) {
        window.clearInterval(timer);
        setTextureTick((tick) => tick + 1);
      }
    }, 120);
    const stop = window.setTimeout(() => window.clearInterval(timer), 5000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [active, mode, imageSource, readImageState]);

  React.useEffect(() => {
    if (!active) {
      // Restore the legacy colour only if the current background is
      // one of ours (a texture); the transparent stream variant owns
      // the null background and must not be touched.
      if (scene.background && scene.background instanceof THREE.Texture) {
        scene.background = new THREE.Color(legacyColor);
      }
      if (scene.backgroundRotation && (scene.backgroundRotation.x !== 0 || scene.backgroundRotation.y !== 0 || scene.backgroundRotation.z !== 0)) {
        scene.backgroundRotation.set(0, 0, 0);
      }
      return;
    }
    if (mode === 'gradient') {
      if (scene.backgroundRotation) scene.backgroundRotation.set(0, 0, 0);
      scene.background = getHorizonGradientTexture(config);
      return;
    }
    // image mode
    const state = readImageState();
    if (state.ready && state.texture) {
      scene.background = state.texture;
      if (scene.backgroundRotation) {
        if (equirect) scene.backgroundRotation.set(0, yawRad, 0);
        else scene.backgroundRotation.set(0, 0, 0);
      }
    } else if (scene.background && scene.background instanceof THREE.Texture) {
      // A previous texture (older source / aspect) is still attached
      // while the new one decodes: keep it rather than flashing the
      // solid colour — the new bake replaces it within a frame or
      // two. If decoding fails the stale image stays and the config
      // still carries the new source; the UI status line reports the
      // source as set, so this is a decode-failure corner only.
      return;
    }
  }, [active, config, equirect, yawRad, legacyColor, mode, readImageState, scene, textureTick]);

  return null;
};
