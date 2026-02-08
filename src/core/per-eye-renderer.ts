/**
 * Per-eye rendering via Three.js layers.
 *
 * Uses Three.js's built-in XR pipeline (setAnimationLoop, ArrayCamera)
 * with the Layers system for per-eye visibility control:
 *   Layer 0: visible to both eyes (shared content, HUD)
 *   Layer 1: training (amblyopic) eye only
 *   Layer 2: non-training (fellow) eye only
 *
 * Three.js handles all XR framebuffer binding, viewports, and camera setup.
 */

import * as THREE from 'three';

export type EyeSide = 'left' | 'right';

export const LAYER_SHARED = 0;
export const LAYER_TRAINING = 1;
export const LAYER_NON_TRAINING = 2;

export type FrameCallback = (time: number, frame: XRFrame | null) => void;

export class PerEyeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private contentGroup: THREE.Group;
  private dummyCamera: THREE.PerspectiveCamera;
  private trainingEye: EyeSide = 'right';
  private frameCallback: FrameCallback | null = null;
  private headYDetected: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Content group: all exercise objects go here.
    // Auto-adjusts Y offset based on detected head height so
    // exercises work for both sitting (~1.2m) and standing (~1.6m).
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    // Needed for renderer.render() signature; ignored in XR mode
    this.dummyCamera = new THREE.PerspectiveCamera();
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getTrainingEye(): EyeSide {
    return this.trainingEye;
  }

  setTrainingEye(eye: EyeSide): void {
    this.trainingEye = eye;
  }

  /**
   * Add an object visible only to the training (amblyopic) eye.
   */
  addToTrainingEye(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_TRAINING);
    this.contentGroup.add(obj);
  }

  /**
   * Add an object visible only to the non-training (fellow) eye.
   */
  addToNonTrainingEye(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_NON_TRAINING);
    this.contentGroup.add(obj);
  }

  /**
   * Add an object visible to both eyes.
   */
  addToBothEyes(obj: THREE.Object3D): void {
    setLayerRecursive(obj, LAYER_SHARED);
    this.contentGroup.add(obj);
  }

  /**
   * Remove an object from the content group.
   */
  removeFromScene(obj: THREE.Object3D): void {
    this.contentGroup.remove(obj);
  }

  /**
   * Get the user's head position in world space.
   */
  getHeadPosition(): THREE.Vector3 {
    return this.renderer.xr.getCamera().position.clone();
  }

  /**
   * Convert a world-space position to content-local space
   * (accounts for the head-height Y offset).
   */
  worldToContentLocal(pos: THREE.Vector3): THREE.Vector3 {
    return this.contentGroup.worldToLocal(pos.clone());
  }

  onFrame(callback: FrameCallback): void {
    this.frameCallback = callback;
  }

  /**
   * Hand the XR session to Three.js and start the render loop.
   */
  async startSession(session: XRSession): Promise<void> {
    await this.renderer.xr.setSession(session);

    this.renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
      // Configure per-eye camera layers before Three.js renders
      this.configureCameraLayers();

      // Auto-detect head height and offset content for sitting vs standing.
      // Exercises assume eye height ~1.5m. Offset on first valid frame.
      if (!this.headYDetected) {
        const headY = this.renderer.xr.getCamera().position.y;
        if (headY > 0.1) {
          this.headYDetected = true;
          const offset = headY - 1.5;
          if (Math.abs(offset) > 0.05) {
            this.contentGroup.position.y = offset;
          }
        }
      }

      // Let consumer do input polling, exercise updates, etc.
      this.frameCallback?.(time, frame ?? null);

      // Three.js handles framebuffer, viewport, and per-eye rendering
      this.renderer.render(this.scene, this.dummyCamera);
    });
  }

  stopSession(): void {
    this.renderer.setAnimationLoop(null);
    this.headYDetected = false;
    this.contentGroup.position.y = 0;
  }

  private configureCameraLayers(): void {
    const xrCamera = this.renderer.xr.getCamera() as THREE.ArrayCamera;
    const cameras = xrCamera.cameras;
    if (!cameras || cameras.length < 2) return;

    // Determine left vs right sub-camera by X position
    // (left eye camera is further left in world space)
    let leftCam: THREE.Camera;
    let rightCam: THREE.Camera;

    if (cameras[0].position.x <= cameras[1].position.x) {
      leftCam = cameras[0];
      rightCam = cameras[1];
    } else {
      leftCam = cameras[1];
      rightCam = cameras[0];
    }

    const trainingCam = this.trainingEye === 'left' ? leftCam : rightCam;
    const nonTrainingCam = this.trainingEye === 'left' ? rightCam : leftCam;

    // Training eye: sees shared (0) + training (1), NOT non-training (2)
    trainingCam.layers.enable(LAYER_SHARED);
    trainingCam.layers.enable(LAYER_TRAINING);
    trainingCam.layers.disable(LAYER_NON_TRAINING);

    // Non-training eye: sees shared (0) + non-training (2), NOT training (1)
    nonTrainingCam.layers.enable(LAYER_SHARED);
    nonTrainingCam.layers.disable(LAYER_TRAINING);
    nonTrainingCam.layers.enable(LAYER_NON_TRAINING);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.scene.clear();
    this.renderer.dispose();
  }
}

/**
 * Recursively set the layer on an object and all its descendants.
 */
function setLayerRecursive(obj: THREE.Object3D, layer: number): void {
  obj.layers.set(layer);
  obj.traverse((child) => {
    child.layers.set(layer);
  });
}
