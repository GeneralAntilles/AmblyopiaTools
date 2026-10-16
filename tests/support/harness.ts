/**
 * Headless session harness: the real SessionHost, exercises and settings
 * store (on an in-memory IndexedDB), with scripted controller input and a
 * manual clock. Tests read like a user session.
 */

import { IDBFactory } from 'fake-indexeddb';
import { SettingsStore, type UserSettings } from '../../src/core/settings-store';
import { SessionHost, type SessionHud } from '../../src/core/session-host';
import { InputManager, type InputAction } from '../../src/core/input-manager';
import type { LaunchOptions } from '../../src/exercises/definition';
import { HeadlessRenderer } from './headless-renderer';

const FRAME_MS = 1000 / 60;

export class RecordingHud implements SessionHud {
  status = '';
  elapsedMs = 0;
  setStatus(text: string): void {
    this.status = text;
  }
  setElapsed(ms: number): void {
    this.elapsedMs = ms;
  }
}

export interface Harness {
  store: SettingsStore;
  host: SessionHost;
  renderer: HeadlessRenderer;
  input: InputManager;
  hud: RecordingHud;
  start(exerciseId: string, launch?: LaunchOptions): Promise<void>;
  press(action: InputAction): void;
  /** Let time pass, running frames. */
  wait(ms: number, frameMs?: number): void;
  /** Press an action, then let a few frames run. */
  tap(action: InputAction, settleMs?: number): void;
  /** Repeat `step` until the exercise reaches its results screen. */
  playUntilFinished(step: (h: Harness) => void, maxSteps?: number): void;
  end(): ReturnType<SessionHost['end']>;
  settings(): Promise<UserSettings>;
}

export async function createHarness(settings: Partial<UserSettings> = {}): Promise<Harness> {
  // Fresh database per harness
  globalThis.indexedDB = new IDBFactory();

  const store = new SettingsStore();
  await store.saveSettings({ setupCompleted: true, ...settings });

  let clock = Date.UTC(2026, 0, 5, 9, 0, 0);
  const host = new SessionHost(store, () => clock);
  const renderer = new HeadlessRenderer((settings.trainingEye as 'left' | 'right') ?? 'right');
  const input = new InputManager();
  const hud = new RecordingHud();

  const h: Harness = {
    store,
    host,
    renderer,
    input,
    hud,
    start: (exerciseId, launch = {}) => host.start(exerciseId, launch, { renderer, input, hud }),
    press: (action) => input.dispatch(action),
    wait(ms, frameMs = FRAME_MS) {
      let remaining = ms;
      while (remaining > 0) {
        const step = Math.min(frameMs, remaining);
        clock += step;
        host.tick(step / 1000);
        remaining -= step;
      }
    },
    tap(action, settleMs = 50) {
      h.press(action);
      h.wait(settleMs);
    },
    playUntilFinished(step, maxSteps = 2000) {
      for (let i = 0; i < maxSteps && !host.exerciseFinished; i++) step(h);
      if (!host.exerciseFinished) throw new Error(`Exercise did not finish within ${maxSteps} steps`);
    },
    end: () => host.end(),
    settings: () => store.getSettings(),
  };
  return h;
}
