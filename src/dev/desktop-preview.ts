/**
 * Desktop preview: run an exercise without a headset.
 *
 * Open the app with `?preview` and "Enter VR" renders both eyes side by side
 * (left eye on the left) using the same layer rules as the headset, so
 * per-eye content can be checked at a glance. Keyboard stands in for the
 * controllers:
 *
 *   Arrow keys      thumbstick flicks
 *   Space / Enter   trigger (select)
 *   A / B           A/X and B/Y buttons
 *   Escape / M      grip (pause menu)
 *
 * Controller-tracked features (Brock string docking, crosshair aiming) fall
 * back to their no-controller behaviour.
 */

import * as THREE from 'three';
import {
  LAYER_NON_TRAINING,
  LAYER_SHARED,
  LAYER_TRAINING,
  setLayerRecursive,
  type EyeRenderer,
  type EyeSide,
} from '../core/per-eye-renderer';
import type { InputAction, InputManager } from '../core/input-manager';

const IPD = 0.064;
const EYE_HEIGHT = 1.5;
const FOV = 90;

const KEY_ACTIONS: Record<string, InputAction> = {
  ArrowLeft: 'page-back',
  ArrowRight: 'page-forward',
  ArrowUp: 'chapter-prev',
  ArrowDown: 'chapter-next',
  ' ': 'select',
  Enter: 'select',
  a: 'button-a',
  b: 'button-b',
  m: 'menu',
  Escape: 'menu',
};

export function isPreviewMode(): boolean {
  return new URLSearchParams(location.search).has('preview');
}

export class DesktopPreviewRenderer implements EyeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private content = new THREE.Group();
  private eyes: Record<EyeSide, THREE.PerspectiveCamera>;
  private frameHandle = 0;
  private removeKeys: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, private trainingEye: EyeSide) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setScissorTest(true);
    this.scene.background = new THREE.Color(0x000000);
    this.scene.add(this.content);

    const makeEye = (side: EyeSide) => {
      const cam = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
      cam.position.set(side === 'left' ? -IPD / 2 : IPD / 2, EYE_HEIGHT, 0);
      cam.layers.set(LAYER_SHARED);
      cam.layers.enable(side === trainingEye ? LAYER_TRAINING : LAYER_NON_TRAINING);
      return cam;
    };
    this.eyes = { left: makeEye('left'), right: makeEye('right') };
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
    return new THREE.Vector3(0, EYE_HEIGHT, 0);
  }

  worldToContentLocal(pos: THREE.Vector3): THREE.Vector3 {
    return this.content.worldToLocal(pos.clone());
  }

  getControllerPosition(): THREE.Vector3 | null {
    return null;
  }

  getControllerRay(): null {
    return null;
  }

  /** Start rendering and map keys to input actions. onFrame gets dt in seconds. */
  start(input: InputManager, onFrame: (dt: number) => void): void {
    const onKey = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.key] ?? KEY_ACTIONS[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();
      input.dispatch(action);
    };
    window.addEventListener('keydown', onKey);
    this.removeKeys = () => window.removeEventListener('keydown', onKey);

    let last = performance.now();
    const loop = (now: number) => {
      onFrame(Math.min(0.1, (now - last) / 1000));
      last = now;
      this.render();
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  private render(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);

    const half = Math.floor(w / 2);
    for (const [side, x] of [['left', 0], ['right', half]] as const) {
      const cam = this.eyes[side];
      cam.aspect = half / h;
      cam.updateProjectionMatrix();
      this.renderer.setViewport(x, 0, half, h);
      this.renderer.setScissor(x, 0, half, h);
      this.renderer.render(this.scene, cam);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.removeKeys?.();
    this.scene.clear();
    this.renderer.dispose();
  }
}
