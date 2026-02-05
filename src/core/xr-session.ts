/**
 * WebXR session lifecycle management.
 *
 * Handles requesting, starting, and ending immersive-vr sessions.
 * Provides the render loop and reference space for exercises.
 */

export type XRSessionState = 'inactive' | 'requesting' | 'active' | 'ending';

export interface XRSessionCallbacks {
  onSessionStarted?: (session: XRSession) => void;
  onSessionEnded?: () => void;
  onFrame?: (time: number, frame: XRFrame, refSpace: XRReferenceSpace) => void;
  onError?: (error: Error) => void;
}

export class XRSessionManager {
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private state: XRSessionState = 'inactive';
  private callbacks: XRSessionCallbacks = {};
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private animFrameHandle: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  getState(): XRSessionState {
    return this.state;
  }

  getSession(): XRSession | null {
    return this.session;
  }

  getGL(): WebGL2RenderingContext | null {
    return this.gl;
  }

  getReferenceSpace(): XRReferenceSpace | null {
    return this.refSpace;
  }

  setCallbacks(callbacks: XRSessionCallbacks): void {
    this.callbacks = callbacks;
  }

  static async isSupported(): Promise<boolean> {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (this.state !== 'inactive') {
      throw new Error(`Cannot start session in state: ${this.state}`);
    }

    if (!navigator.xr) {
      throw new Error('WebXR not available');
    }

    this.state = 'requesting';

    try {
      // Initialize WebGL context
      const gl = this.canvas.getContext('webgl2', { xrCompatible: true });
      if (!gl) {
        throw new Error('Failed to create WebGL2 context');
      }
      this.gl = gl;

      // Request immersive VR session
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
      });

      this.session = session;

      // Configure the session's render target
      const glLayer = new XRWebGLLayer(session, gl);
      await session.updateRenderState({ baseLayer: glLayer });

      // Get reference space
      this.refSpace = await session.requestReferenceSpace('local-floor');

      // Handle session end
      session.addEventListener('end', () => {
        this.handleSessionEnd();
      });

      this.state = 'active';
      this.callbacks.onSessionStarted?.(session);

      // Start the render loop
      this.session.requestAnimationFrame(this.onXRFrame);
    } catch (error) {
      this.state = 'inactive';
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  async end(): Promise<void> {
    if (this.state !== 'active' || !this.session) return;

    this.state = 'ending';
    try {
      await this.session.end();
    } catch {
      // Session may already be ended
      this.handleSessionEnd();
    }
  }

  private handleSessionEnd = (): void => {
    if (this.animFrameHandle && this.session) {
      this.session.cancelAnimationFrame(this.animFrameHandle);
    }
    this.session = null;
    this.refSpace = null;
    this.state = 'inactive';
    this.callbacks.onSessionEnded?.();
  };

  private onXRFrame = (time: number, frame: XRFrame): void => {
    const session = frame.session;

    // Schedule next frame first
    this.animFrameHandle = session.requestAnimationFrame(this.onXRFrame);

    if (!this.refSpace) return;

    this.callbacks.onFrame?.(time, frame, this.refSpace);
  };
}
