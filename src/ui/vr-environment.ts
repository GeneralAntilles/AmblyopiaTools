/**
 * Shared VR environment sphere (warm nebula gradient dome).
 * Used by all exercises for consistent ambient backdrop.
 */

import * as THREE from 'three';
import type { PerEyeRenderer } from '../core/per-eye-renderer';
import { COLORS } from './vr-constants';

export function createEnvironmentSphere(renderer: PerEyeRenderer): {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  const stops = COLORS.ENV_GRADIENT;
  gradient.addColorStop(0.0, stops[0]);
  gradient.addColorStop(0.35, stops[1]);
  gradient.addColorStop(0.7, stops[2]);
  gradient.addColorStop(1.0, stops[3]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 512);

  const envTexture = new THREE.CanvasTexture(canvas);
  const sphereGeo = new THREE.SphereGeometry(40, 32, 16);
  const material = new THREE.MeshBasicMaterial({ map: envTexture, side: THREE.BackSide });
  const mesh = new THREE.Mesh(sphereGeo, material);
  renderer.addToBothEyes(mesh);
  return { mesh, material };
}
