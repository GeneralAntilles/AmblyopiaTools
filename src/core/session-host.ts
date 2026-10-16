/**
 * Runs one exercise session, independent of WebXR.
 *
 * start() builds the exercise for the given renderer/input, tick() drives
 * it each frame, and end() tears it down, records the session, applies
 * contrast progression and returns the outcome. main.ts wires this to the
 * XR session lifecycle; tests drive it headlessly.
 *
 * Pausing is centralized here, like a Quest game's pause menu. Grip opens
 * it (Quest Browser keeps the Menu button for itself); the owner also calls
 * pause() when the headset loses focus. While paused the exercise gets no
 * input and no time, and paused time doesn't count toward session length.
 * From the menu the user resumes or ends the session — ending calls
 * onExitRequested, and the owner then calls end(). On an exercise's results
 * screen, trigger ends the session directly.
 */

import { ContrastEngine } from './contrast-engine';
import { evaluateProgression, type ProgressionDecision } from './contrast-progression';
import type { EyeRenderer } from './per-eye-renderer';
import type { ExerciseInput, HapticPreset, InputAction, InputActionCallback, InputManager } from './input-manager';
import { PauseMenu } from '../ui/pause-menu';
import type { SettingsStore, SessionRecord, UserSettings } from './settings-store';
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
  exerciseInput: ExerciseChannel;
  menu: PauseMenu;
  startTime: number;
  /** Total ms spent paused, excluding a pause in progress. */
  pausedMs: number;
  /** When the current pause began, or null if running. */
  pausedAt: number | null;
  menuIndex: number;
  /** When the results screen first showed, or null. */
  finishedAt: number | null;
  release: Array<() => void>;
}

/** Trigger presses this soon after results appear are leftovers from answering. */
const RESULTS_GRACE_MS = 1000;

const MENU_ITEMS = ['Resume', 'End Session'] as const;

/** Exercise-facing input: receives only what the pause menu doesn't consume. */
class ExerciseChannel implements ExerciseInput {
  private callbacks: InputActionCallback[] = [];

  constructor(private readonly input: InputManager) {}

  onAction(callback: InputActionCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx >= 0) this.callbacks.splice(idx, 1);
    };
  }

  haptic(preset: HapticPreset): void {
    this.input.haptic(preset);
  }

  deliver(action: InputAction): void {
    for (const cb of [...this.callbacks]) cb(action);
  }
}

export class SessionHost {
  /** Called when the user chooses to end the session. The owner should then call end(). */
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

  get isPaused(): boolean {
    return this.active?.pausedAt != null;
  }

  /** Open the pause menu (no-op if already paused or nothing is running). */
  pause(): void {
    const s = this.active;
    if (!s || s.pausedAt !== null) return;
    s.pausedAt = this.now();
    s.menuIndex = 0;
    s.menu.show([...MENU_ITEMS], s.menuIndex);
    s.env.input.haptic('light');
  }

  resume(): void {
    const s = this.active;
    if (!s || s.pausedAt === null) return;
    s.pausedMs += this.now() - s.pausedAt;
    s.pausedAt = null;
    s.menu.hide();
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

    const exerciseInput = new ExerciseChannel(env.input);
    const menu = new PauseMenu();
    env.renderer.addToBothEyes(menu.root);

    const release = [
      // In-session contrast changes (A/B) persist immediately
      contrast.onDominantContrastChange((value) => {
        this.pendingWrites = this.pendingWrites.then(() => this.store.saveSetting('contrastDominant', value));
      }),
      env.input.onAction((action) => this.route(action)),
      () => {
        env.renderer.removeFromScene(menu.root);
        menu.dispose();
      },
    ];

    const exercise = definition.create(launch);
    await exercise.start({ renderer: env.renderer, input: exerciseInput, contrast, settings, hud: env.hud });

    this.active = {
      definition, exercise, env, exerciseInput, menu,
      startTime: this.now(), pausedMs: 0, pausedAt: null, menuIndex: 0, finishedAt: null, release,
    };
  }

  /** Send an action to the pause menu or the exercise. */
  private route(action: InputAction): void {
    const s = this.active;
    if (!s) return;

    if (s.pausedAt === null) {
      if (action === 'menu') this.pause();
      else if (action === 'select' && s.finishedAt !== null) {
        if (this.now() - s.finishedAt >= RESULTS_GRACE_MS) this.onExitRequested?.();
      } else s.exerciseInput.deliver(action);
      return;
    }

    switch (action) {
      case 'menu':
        this.resume();
        break;
      case 'chapter-prev':
      case 'chapter-next': {
        const step = action === 'chapter-next' ? 1 : -1;
        s.menuIndex = (s.menuIndex + step + MENU_ITEMS.length) % MENU_ITEMS.length;
        s.menu.show([...MENU_ITEMS], s.menuIndex);
        s.env.input.haptic('tick');
        break;
      }
      case 'select':
        if (MENU_ITEMS[s.menuIndex] === 'Resume') this.resume();
        else this.onExitRequested?.();
        break;
    }
  }

  /** Session time so far, excluding pauses. */
  private activeMs(s: ActiveSession): number {
    const now = this.now();
    const currentPause = s.pausedAt === null ? 0 : now - s.pausedAt;
    return now - s.startTime - s.pausedMs - currentPause;
  }

  /** Advance the exercise one frame. dt in seconds. */
  tick(dt: number): void {
    const s = this.active;
    if (!s) return;
    if (s.pausedAt === null) s.exercise.update(dt);
    if (s.finishedAt === null && s.exercise.isFinished) s.finishedAt = this.now();
    s.env.hud.setElapsed(this.activeMs(s));
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
      durationMs: this.activeMs(session),
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
          ...withStartingPoint(settings, startTime),
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
            ...withStartingPoint(settings, startTime),
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

type ContrastHistory = UserSettings['contrastProgressionHistory'];

/** Recent contrast history, seeded with the level contrast started at if this is its first change. */
function withStartingPoint(settings: UserSettings, timestamp: number): ContrastHistory {
  const history = settings.contrastProgressionHistory;
  if (history.length > 0) return history.slice(-99);
  return [{ timestamp, contrast: settings.contrastDominant, exercise: 'start', auto: false }];
}
