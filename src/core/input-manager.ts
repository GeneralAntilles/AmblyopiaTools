/**
 * Controller and hand input abstraction for Quest controllers.
 *
 * Maps XRInputSource events to simple action callbacks.
 * Supports both controllers and hand tracking (optional).
 */

export type InputAction =
  | 'page-forward'    // Thumbstick right, or trigger
  | 'page-back'       // Thumbstick left
  | 'chapter-next'    // Thumbstick down
  | 'chapter-prev'    // Thumbstick up
  | 'select'          // Primary trigger press
  | 'exit'            // Grip press (either hand)
  | 'menu'            // Menu button
  | 'button-a'        // A (right) / X (left) button
  | 'button-b';       // B (right) / Y (left) button

export type InputActionCallback = (action: InputAction) => void;

interface ControllerState {
  triggerPressed: boolean;
  gripPressed: boolean;
  thumbstickX: number;
  thumbstickY: number;
  thumbstickWasRight: boolean;
  thumbstickWasLeft: boolean;
  thumbstickWasUp: boolean;
  thumbstickWasDown: boolean;
  buttonAPressed: boolean;
  buttonBPressed: boolean;
}

const THUMBSTICK_THRESHOLD = 0.5;
const THUMBSTICK_DEADZONE = 0.2;

export class InputManager {
  private session: XRSession | null = null;
  private callbacks: InputActionCallback[] = [];
  private controllerStates = new Map<XRInputSource, ControllerState>();

  onAction(callback: InputActionCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx >= 0) this.callbacks.splice(idx, 1);
    };
  }

  setSession(session: XRSession): void {
    this.session = session;

    session.addEventListener('selectstart', this.handleSelect);
    session.addEventListener('squeezestart', this.handleSqueeze);
    session.addEventListener('inputsourceschange', this.handleInputSourcesChange);
  }

  /**
   * Poll gamepad state. Call this each frame.
   */
  update(): void {
    if (!this.session) return;

    for (const source of this.session.inputSources) {
      if (!source.gamepad) continue;

      let state = this.controllerStates.get(source);
      if (!state) {
        state = {
          triggerPressed: false,
          gripPressed: false,
          thumbstickX: 0,
          thumbstickY: 0,
          thumbstickWasRight: false,
          thumbstickWasLeft: false,
          thumbstickWasUp: false,
          thumbstickWasDown: false,
          buttonAPressed: false,
          buttonBPressed: false,
        };
        this.controllerStates.set(source, state);
      }

      const gp = source.gamepad;

      // Thumbstick axes (typically axes[2], axes[3] for primary thumbstick)
      const axisX = gp.axes[2] ?? gp.axes[0] ?? 0;
      const axisY = gp.axes[3] ?? gp.axes[1] ?? 0;

      state.thumbstickX = Math.abs(axisX) > THUMBSTICK_DEADZONE ? axisX : 0;
      state.thumbstickY = Math.abs(axisY) > THUMBSTICK_DEADZONE ? axisY : 0;

      // Detect thumbstick flick right (page forward)
      const isRight = state.thumbstickX > THUMBSTICK_THRESHOLD;
      if (isRight && !state.thumbstickWasRight) {
        this.emit('page-forward');
      }
      state.thumbstickWasRight = isRight;

      // Detect thumbstick flick left (page back)
      const isLeft = state.thumbstickX < -THUMBSTICK_THRESHOLD;
      if (isLeft && !state.thumbstickWasLeft) {
        this.emit('page-back');
      }
      state.thumbstickWasLeft = isLeft;

      // Detect thumbstick flick down (next chapter)
      // WebXR Y axis: negative = pushed forward/up, positive = pulled back/down
      const isDown = state.thumbstickY > THUMBSTICK_THRESHOLD;
      if (isDown && !state.thumbstickWasDown) {
        this.emit('chapter-next');
      }
      state.thumbstickWasDown = isDown;

      // Detect thumbstick flick up (prev chapter)
      const isUp = state.thumbstickY < -THUMBSTICK_THRESHOLD;
      if (isUp && !state.thumbstickWasUp) {
        this.emit('chapter-prev');
      }
      state.thumbstickWasUp = isUp;

      // A/X button (buttons[4])
      const btnA = gp.buttons[4]?.pressed ?? false;
      if (btnA && !state.buttonAPressed) {
        this.emit('button-a');
      }
      state.buttonAPressed = btnA;

      // B/Y button (buttons[5])
      const btnB = gp.buttons[5]?.pressed ?? false;
      if (btnB && !state.buttonBPressed) {
        this.emit('button-b');
      }
      state.buttonBPressed = btnB;
    }
  }

  private handleSelect = (_event: XRInputSourceEvent): void => {
    this.emit('select');
    this.emit('page-forward');
  };

  private handleSqueeze = (_event: XRInputSourceEvent): void => {
    this.emit('exit');
  };

  private handleInputSourcesChange = (_event: XRInputSourcesChangeEvent): void => {
    // Clean up states for removed sources
    const activeSources = new Set(this.session?.inputSources ?? []);
    for (const source of this.controllerStates.keys()) {
      if (!activeSources.has(source)) {
        this.controllerStates.delete(source);
      }
    }
  };

  private emit(action: InputAction): void {
    for (const cb of this.callbacks) {
      cb(action);
    }
  }

  /**
   * Get current thumbstick axis values (continuous, not flick-based).
   * Returns the first controller with non-zero input.
   */
  getThumbstickAxes(): { x: number; y: number } {
    if (!this.session) return { x: 0, y: 0 };
    for (const source of this.session.inputSources) {
      if (!source.gamepad) continue;
      const state = this.controllerStates.get(source);
      if (state && (state.thumbstickX !== 0 || state.thumbstickY !== 0)) {
        return { x: state.thumbstickX, y: state.thumbstickY };
      }
    }
    return { x: 0, y: 0 };
  }

  dispose(): void {
    if (this.session) {
      this.session.removeEventListener('selectstart', this.handleSelect);
      this.session.removeEventListener('squeezestart', this.handleSqueeze);
      this.session.removeEventListener('inputsourceschange', this.handleInputSourcesChange);
    }
    this.session = null;
    this.callbacks.length = 0;
    this.controllerStates.clear();
  }
}
