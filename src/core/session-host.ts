/**
 * Runs one exercise session, independent of WebXR.
 *
 * start() builds the exercise for the given renderer/input, tick() drives
 * it each frame, and end() tears it down, records the session, applies
 * contrast progression and returns the outcome. main.ts wires this to the
 * XR session lifecycle; tests drive it headlessly.
 *
 * Exiting is centralized here: the exit action (grip) asks the owner to end
 * the session via onExitRequested, whatever the exercise is doing.
 */

import { ContrastEngine } from './contrast-engine';
import { evaluateProgression, type ProgressionDecision } from './contrast-progression';
import type { EyeRenderer } from './per-eye-renderer';
import type { InputManager } from './input-manager';
import type { SettingsStore, SessionRecord } from './settings-store';
import type { BaseExercise, SessionStats, StatusDisplay } from '../exercises/base-exercise';
import type { ExerciseDefinition, LaunchOptions } from '../exercises/definition';
import { getExercise } from '../exercises/registry';

export interface SessionHud extends StatusDisplay {
  setElapsed(ms: number): void;
}

export interface SessionEnvironment {
  renderer: EyeRenderer;
  input: InputManager;
  hud: SessionHud;
}

export interface ContrastChange {
  from: number;
  to: number;
  source: 'calibration' | 'progression';
}

export interface SessionOutcome {
  definition: ExerciseDefinition;
  stats: SessionStats;
  record: SessionRecord;
  /** Present when auto-progression is enabled. */
  progression?: ProgressionDecision;
  /** Set when the session changed the stored fellow-eye contrast. */
  contrastChange?: ContrastChange;
}

interface ActiveSession {
  definition: ExerciseDefinition;
  exercise: BaseExercise;
  env: SessionEnvironment;
  startTime: number;
  release: Array<() => void>;
}

export class SessionHost {
  /** Called when the user asks to leave (grip). The owner should then call end(). */
  onExitRequested: (() => void) | null = null;

  private active: ActiveSession | null = null;
  private pendingWrites: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  /** Whether the running exercise has reached its results screen. */
  get exerciseFinished(): boolean {
    return this.active?.exercise.isFinished ?? false;
  }

  async start(exerciseId: string, launch: LaunchOptions, env: SessionEnvironment): Promise<void> {
    if (this.active) throw new Error('A session is already running');

    const definition = getExercise(exerciseId);
    if (!definition) throw new Error(`Unknown exercise "${exerciseId}"`);

    const settings = await this.store.getSettings();
    const contrast = new ContrastEngine({
      dominantEyeContrast: settings.contrastDominant,
      amblyopicEyeContrast: settings.contrastAmblyopic,
    });

    const release = [
      // In-session contrast changes (A/B) persist immediately
      contrast.onDominantContrastChange((value) => {
        this.pendingWrites = this.pendingWrites.then(() => this.store.saveSetting('contrastDominant', value));
      }),
      env.input.onAction((action) => {
        if (action === 'exit') this.onExitRequested?.();
      }),
    ];

    const exercise = definition.create(launch);
    await exercise.start({ renderer: env.renderer, input: env.input, contrast, settings, hud: env.hud });

    this.active = { definition, exercise, env, startTime: this.now(), release };
  }

  /** Advance the exercise one frame. dt in seconds. */
  tick(dt: number): void {
    if (!this.active) return;
    this.active.exercise.update(dt);
    this.active.env.hud.setElapsed(this.now() - this.active.startTime);
  }

  /** Tear down, record the session and apply progression. Null if nothing was running. */
  async end(): Promise<SessionOutcome | null> {
    const session = this.active;
    if (!session) return null;
    this.active = null;

    const { definition, exercise, startTime } = session;
    const endTime = this.now();
    const stats: SessionStats = {
      ...exercise.getStats(),
      exercise: definition.id,
      durationMs: endTime - startTime,
    };

    exercise.teardown();
    for (const release of session.release) release();
    await this.pendingWrites;

    const id = await this.store.saveSessionRecord({
      exercise: definition.id,
      startTime,
      endTime,
      durationMs: stats.durationMs,
      stats,
    });
    const record: SessionRecord = { id, exercise: definition.id, startTime, endTime, durationMs: stats.durationMs, stats };

    let settings = await this.store.getSettings();
    let progression: ProgressionDecision | undefined;
    let contrastChange: ContrastChange | undefined;

    const applied = definition.applyResult?.(stats, settings);
    if (applied) {
      if (applied.contrastDominant !== undefined && applied.contrastDominant !== settings.contrastDominant) {
        contrastChange = { from: settings.contrastDominant, to: applied.contrastDominant, source: 'calibration' };
        applied.contrastProgressionHistory = [
          ...settings.contrastProgressionHistory.slice(-99),
          { timestamp: endTime, contrast: applied.contrastDominant, exercise: definition.id, auto: false },
        ];
      }
      await this.store.saveSettings(applied);
      settings = await this.store.getSettings();
    }

    if (settings.contrastProgressionEnabled) {
      progression = evaluateProgression(stats, definition, settings.contrastDominant, {
        increment: settings.contrastAutoIncrement,
      });

      if (progression.shouldIncrement) {
        contrastChange = { from: progression.previousContrast, to: progression.newContrast, source: 'progression' };
        await this.store.saveSettings({
          contrastDominant: progression.newContrast,
          contrastProgressionHistory: [
            ...settings.contrastProgressionHistory.slice(-99),
            {
              timestamp: endTime,
              contrast: progression.newContrast,
              exercise: definition.id,
              auto: true,
            },
          ],
        });
      }
    }

    // Advance the recommender's position in the exercise rotation
    const orderIndex = settings.exerciseOrder.indexOf(definition.id);
    if (orderIndex >= 0) {
      await this.store.saveSetting('lastCompletedExerciseIndex', orderIndex);
    }

    return { definition, stats, record, progression, contrastChange };
  }
}
