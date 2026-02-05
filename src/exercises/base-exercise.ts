/**
 * Abstract base class for all therapy exercises.
 *
 * Each exercise manages its own scenes, handles input, and tracks session stats.
 */

import type { PerEyeRenderer } from '../core/per-eye-renderer';
import type { InputManager } from '../core/input-manager';
import type { ContrastEngine } from '../core/contrast-engine';

export interface SessionStats {
  exercise: string;
  durationMs: number;
  [key: string]: unknown;
}

export interface ExerciseConfig {
  renderer: PerEyeRenderer;
  input: InputManager;
  contrast: ContrastEngine;
}

export abstract class BaseExercise {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly type: 'monocular' | 'dichoptic' | 'binocular' | 'diagnostic';

  protected startTime: number = 0;
  protected running: boolean = false;

  /**
   * Initialize the exercise. Set up scenes, meshes, and input bindings.
   */
  abstract setup(config: ExerciseConfig): Promise<void>;

  /**
   * Per-frame update. Called each XR frame with delta time in seconds.
   */
  abstract update(dt: number): void;

  /**
   * Clean up resources. Remove meshes, unbind input, etc.
   */
  abstract teardown(): void;

  /**
   * Return stats for the completed session.
   */
  abstract getSessionStats(): SessionStats;

  protected markStarted(): void {
    this.startTime = Date.now();
    this.running = true;
  }

  protected markStopped(): void {
    this.running = false;
  }

  protected getElapsedMs(): number {
    if (!this.startTime) return 0;
    return Date.now() - this.startTime;
  }
}
