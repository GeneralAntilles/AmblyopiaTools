/**
 * Per-eye rendering abstraction.
 *
 * Maps WebXR left/right views to training/non-training eye,
 * handles viewport setup, and exposes render callbacks for exercises.
 */

import * as THREE from 'three';

export type EyeSide = 'left' | 'right';

export type EyeRenderCallback = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  eye: EyeSide
) => void;

export class PerEyeRenderer {
  private trainingEye: EyeSide = 'right';
  private trainingEyeCallback: EyeRenderCallback | null = null;
  private nonTrainingEyeCallback: EyeRenderCallback | null = null;

  private renderer: THREE.WebGLRenderer;
  private trainingScene: THREE.Scene;
  private nonTrainingScene: THREE.Scene;
  private cameraL: THREE.PerspectiveCamera;
  private cameraR: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: true,
      alpha: false,
    });
    this.renderer.autoClear = false;
    this.renderer.xr.enabled = true;

    this.trainingScene = new THREE.Scene();
    this.trainingScene.background = new THREE.Color(0x000000);

    this.nonTrainingScene = new THREE.Scene();
    this.nonTrainingScene.background = new THREE.Color(0x000000);

    this.cameraL = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
    this.cameraR = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getTrainingScene(): THREE.Scene {
    return this.trainingScene;
  }

  getNonTrainingScene(): THREE.Scene {
    return this.nonTrainingScene;
  }

  getTrainingEye(): EyeSide {
    return this.trainingEye;
  }

  setTrainingEye(eye: EyeSide): void {
    this.trainingEye = eye;
  }

  onRenderTrainingEye(callback: EyeRenderCallback): void {
    this.trainingEyeCallback = callback;
  }

  onRenderNonTrainingEye(callback: EyeRenderCallback): void {
    this.nonTrainingEyeCallback = callback;
  }

  /**
   * Set the XR session on the Three.js renderer.
   */
  async setSession(session: XRSession): Promise<void> {
    await this.renderer.xr.setSession(session);
  }

  /**
   * Called each XR frame. Iterates over pose views and renders
   * the appropriate scene to each eye.
   */
  renderFrame(frame: XRFrame, refSpace: XRReferenceSpace): void {
    const session = frame.session;
    const glLayer = session.renderState.baseLayer;
    if (!glLayer) return;

    const pose = frame.getViewerPose(refSpace);
    if (!pose) return;

    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);

    this.renderer.clear(true, true, true);

    for (const view of pose.views) {
      const viewport = glLayer.getViewport(view);
      if (!viewport) continue;

      const eye = view.eye as EyeSide;
      const isTrainingEye = eye === this.trainingEye;

      // Set up viewport
      this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
      this.renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
      this.renderer.setScissorTest(true);

      // Build camera from XR view
      const camera = eye === 'left' ? this.cameraL : this.cameraR;
      camera.matrix.fromArray(view.transform.matrix);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      camera.projectionMatrix.fromArray(view.projectionMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      // Render the appropriate scene
      if (isTrainingEye) {
        this.trainingEyeCallback?.(this.renderer, this.trainingScene, camera, eye);
        this.renderer.render(this.trainingScene, camera);
      } else {
        this.nonTrainingEyeCallback?.(this.renderer, this.nonTrainingScene, camera, eye);
        this.renderer.render(this.nonTrainingScene, camera);
      }
    }

    this.renderer.setScissorTest(false);
  }

  dispose(): void {
    this.trainingScene.clear();
    this.nonTrainingScene.clear();
    this.renderer.dispose();
  }
}
