/**
 * WebXR session lifecycle management.
 *
 * Handles feature detection, requesting, and ending immersive-vr sessions.
 * The render loop is owned by Three.js (via PerEyeRenderer.startSession),
 * so this module only manages the session object itself.
 */

export type XRSessionState = 'inactive' | 'requesting' | 'active' | 'ending';

export class XRSessionManager {
  private session: XRSession | null = null;
  private state: XRSessionState = 'inactive';
  private onSessionEndedCb: (() => void) | null = null;

  getState(): XRSessionState {
    return this.state;
  }

  getSession(): XRSession | null {
    return this.session;
  }

  static async isSupported(): Promise<boolean> {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  setOnSessionEnded(callback: () => void): void {
    this.onSessionEndedCb = callback;
  }

  async requestSession(): Promise<XRSession> {
    if (this.state !== 'inactive') {
      throw new Error(`Cannot start session in state: ${this.state}`);
    }

    if (!navigator.xr) {
      throw new Error('WebXR not available');
    }

    this.state = 'requesting';

    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
      });

      this.session = session;
      this.state = 'active';

      session.addEventListener('end', () => {
        this.session = null;
        this.state = 'inactive';
        this.onSessionEndedCb?.();
      });

      return session;
    } catch (error) {
      this.state = 'inactive';
      throw error;
    }
  }

  async end(): Promise<void> {
    if (!this.session || this.state !== 'active') return;

    this.state = 'ending';
    try {
      await this.session.end();
    } catch {
      // Session may already be ended
      this.session = null;
      this.state = 'inactive';
      this.onSessionEndedCb?.();
    }
  }
}
