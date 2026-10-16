/**
 * Abstract base class for all therapy exercises.
 *
 * Subclasses implement setup(), getStats() and optionally onUpdate() /
 * onTeardown(). The base class owns the plumbing every exercise needs:
 *
 *   - Scene ownership: objects added via add() are removed and disposed
 *     (geometry, materials, textures) automatically on teardown.
 *   - Input: onInput() subscriptions are released on teardown. Exiting is
 *     handled by the session host, not by exercises.
 *   - Time: an exercise clock (ms) advanced by update(dt). Use now() for
 *     reaction times and after() for delays, so exercises stay deterministic
 *     under test.
 *   - Results: showResults() renders the standard end-of-exercise card and
 *     stops further input.
 */

import * as THREE from 'three';
import type { EyeRenderer } from '../core/per-eye-renderer';
import type { InputManager, InputAction } from '../core/input-manager';
import type { ContrastEngine } from '../core/contrast-engine';
import type { UserSettings } from '../core/settings-store';
import { TextPanel, resultsText } from '../ui/text-panel';
import { createEnvironmentSphere } from '../ui/vr-environment';
import { PANELS } from '../ui/vr-constants';

/** Exercise-specific session metrics. Keys are persisted in session history. */
export type ExerciseStats = Record<string, unknown>;

/** A recorded session: exercise metrics plus host-supplied id and duration. */
export interface SessionStats extends ExerciseStats {
  exercise: string;
  durationMs: number;
  /**
   * Fellow-eye contrast (0–100) this session trained at, if the exercise
   * presented reduced-contrast content to the fellow eye. Absent or 0 means
   * the session was not dichoptic; only dichoptic sessions drive contrast
   * progression.
   */
  fellowEyeContrast?: number;
}

export interface StatusDisplay {
  setStatus(text: string): void;
}

export interface ExerciseContext {
  renderer: EyeRenderer;
  input: InputManager;
  contrast: ContrastEngine;
  settings: Readonly<UserSettings>;
  hud: StatusDisplay;
}

export type EyeTarget = 'both' | 'training' | 'fellow';

interface Timer {
  at: number;
  fn: () => void;
}

export abstract class BaseExercise {
  protected ctx!: ExerciseContext;

  /** True once showResults() has been called; input is ignored after that. */
  protected finished = false;

  private clockMs = 0;
  private timers: Timer[] = [];
  private owned: THREE.Object3D[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private unsubscribers: Array<() => void> = [];
  private resultsPanel: TextPanel | null = null;

  /** Whether the exercise has reached its results screen. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** Called by the session host. */
  async start(ctx: ExerciseContext): Promise<void> {
    this.ctx = ctx;
    await this.setup();
  }

  /** Build the scene and subscribe to input. `this.ctx` is available. */
  protected abstract setup(): void | Promise<void>;

  /** Exercise-specific metrics for the session record. */
  abstract getStats(): ExerciseStats;

  /** Called by the session host each frame with delta time in seconds. */
  update(dt: number): void {
    this.clockMs += dt * 1000;

    if (this.timers.length > 0) {
      const due = this.timers.filter((t) => t.at <= this.clockMs);
      if (due.length > 0) {
        this.timers = this.timers.filter((t) => t.at > this.clockMs);
        for (const t of due) t.fn();
      }
    }

    this.onUpdate(dt);
  }

  /** Per-frame hook for animation. */
  protected onUpdate(_dt: number): void {}

  /** Release extra resources not covered by add()/own(). */
  protected onTeardown(): void {}

  /** Called by the session host. Removes and disposes everything the exercise created. */
  teardown(): void {
    this.onTeardown();

    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.timers = [];

    for (const obj of this.owned) {
      this.ctx.renderer.removeFromScene(obj);
      disposeObject(obj);
    }
    this.owned = [];

    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // --- Helpers for subclasses ---

  /** Milliseconds of exercise time since setup. */
  protected now(): number {
    return this.clockMs;
  }

  /** Run fn after the given delay (exercise time). */
  protected after(ms: number, fn: () => void): void {
    this.timers.push({ at: this.clockMs + ms, fn });
  }

  /** Add an object to the scene for the given eye(s); disposed on teardown. */
  protected add<T extends THREE.Object3D>(obj: T, eye: EyeTarget = 'both'): T {
    const r = this.ctx.renderer;
    if (eye === 'training') r.addToTrainingEye(obj);
    else if (eye === 'fellow') r.addToNonTrainingEye(obj);
    else r.addToBothEyes(obj);
    this.owned.push(obj);
    return obj;
  }

  /** Register a non-scene resource (e.g. a texture cache) for disposal on teardown. */
  protected own<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  /** Create a text panel of the given width (m) and add it to the scene. */
  protected panel(widthM: number, eye: EyeTarget = 'both'): TextPanel {
    const panel = new TextPanel(widthM);
    this.add(panel.mesh, eye);
    return panel;
  }

  /** Add the shared nebula backdrop. */
  protected addEnvironment(): void {
    this.owned.push(createEnvironmentSphere(this.ctx.renderer).mesh);
  }

  /** Subscribe to controller actions. Not called once the exercise has finished. */
  protected onInput(cb: (action: InputAction) => void): void {
    this.unsubscribers.push(
      this.ctx.input.onAction((action) => {
        if (!this.finished) cb(action);
      }),
    );
  }

  /** Show the standard results card and stop accepting input. */
  protected showResults(lines: string[], position: { x: number; y: number; z: number }): TextPanel {
    this.finished = true;
    this.timers = [];
    if (!this.resultsPanel) this.resultsPanel = this.panel(PANELS.RESULTS_WIDTH);
    this.resultsPanel.setText(resultsText([...lines, '', 'Grip to exit']));
    this.resultsPanel.position.set(position.x, position.y, position.z);
    this.resultsPanel.visible = true;
    return this.resultsPanel;
  }
}

/** Dispose geometry, materials and material textures under an object. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}
