/**
 * EyeRenderer with a plain Three.js scene and no WebGL.
 *
 * Lets tests inspect exactly what each eye would be shown, using the same
 * layer rules as PerEyeRenderer's cameras.
 */

import * as THREE from 'three';
import {
  LAYER_NON_TRAINING,
  LAYER_SHARED,
  LAYER_TRAINING,
  setLayerRecursive,
  type EyeRenderer,
  type EyeSide,
} from '../../src/core/per-eye-renderer';

type Ray = { origin: THREE.Vector3; direction: THREE.Vector3 };

export class HeadlessRenderer implements EyeRenderer {
  readonly scene = new THREE.Scene();
  readonly content = new THREE.Group();

  /** World-space controller positions; null = not tracked. */
  controllers: Array<THREE.Vector3 | null> = [null, null];
  rays: Array<Ray | null> = [null, null];
  head = new THREE.Vector3(0, 1.5, 0);

  constructor(private trainingEye: EyeSide = 'right') {
    this.scene.add(this.content);
  }

  getTrainingEye(): EyeSide {
    return this.trainingEye;
  }

  addToTrainingEye(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_TRAINING);
    this.content.add(obj);
  }

  addToNonTrainingEye(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_NON_TRAINING);
    this.content.add(obj);
  }

  addToBothEyes(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_SHARED);
    this.content.add(obj);
  }

  removeFromScene(obj: THREE.Object3D): void {
    this.content.remove(obj);
  }

  getHeadPosition(): THREE.Vector3 {
    return this.head.clone();
  }

  worldToContentLocal(pos: THREE.Vector3): THREE.Vector3 {
    return this.content.worldToLocal(pos.clone());
  }

  getControllerPosition(index: number): THREE.Vector3 | null {
    return this.controllers[index]?.clone() ?? null;
  }

  getControllerRay(index: number): Ray | null {
    const ray = this.rays[index];
    return ray ? { origin: ray.origin.clone(), direction: ray.direction.clone() } : null;
  }

  /** Visible meshes shown to this eye and not the other. */
  eyeOnlyMeshes(eye: 'training' | 'fellow'): THREE.Mesh[] {
    const layer = eye === 'training' ? LAYER_TRAINING : LAYER_NON_TRAINING;
    return this.visibleMeshes(eye).filter((m) => m.layers.mask === 1 << layer);
  }

  /** Meshes the given eye would render: visible all the way up, on a layer that eye sees. */
  visibleMeshes(eye: 'training' | 'fellow'): THREE.Mesh[] {
    const camera = new THREE.Layers();
    camera.set(LAYER_SHARED);
    camera.enable(eye === 'training' ? LAYER_TRAINING : LAYER_NON_TRAINING);

    const meshes: THREE.Mesh[] = [];
    this.content.traverseVisible((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.layers.test(camera)) meshes.push(obj as THREE.Mesh);
    });
    return meshes;
  }
}
