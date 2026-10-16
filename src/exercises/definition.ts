/**
 * Exercise definitions: everything the app needs to know about an exercise
 * outside of VR — how to list it, build it, and present its results.
 *
 * Each exercise folder exports one definition; registry.ts collects them.
 * Stats passed to the presentation functions may come from old session
 * records in IndexedDB, so read them defensively (see `num`).
 */

import type { BaseExercise, SessionStats } from './base-exercise';
import type { UserSettings } from '../core/settings-store';
import type { ReadingSource } from './monocular-reading/monocular-reading';

export type ExerciseTag = 'monocular' | 'dichoptic' | 'binocular' | 'diagnostic';

/** Session stats as stored — fields may be missing on older records. */
export type StoredStats = Record<string, unknown>;

export interface SummaryRow {
  label: string;
  value: string;
  highlight?: boolean;
}

/** Launcher-provided inputs that aren't persisted settings. */
export interface LaunchOptions {
  reading?: ReadingSource;
}

export interface ExerciseDefinition {
  id: string;
  name: string;
  description: string;
  tag: ExerciseTag;
  /** Element id of the launcher section holding this exercise's settings. */
  settingsSection?: string;

  create(launch: LaunchOptions): BaseExercise;

  /** Name for a recorded session (e.g. by mode). Defaults to `name`. */
  sessionName?(stats: StoredStats): string;
  /** Exercise-specific rows for the post-session summary. */
  summarize(stats: StoredStats): SummaryRow[];
  /** Short detail for the session history list. */
  historyDetail(stats: StoredStats): string[];
  /**
   * For dichoptic sessions: the reason this session doesn't earn a
   * contrast increase, or null if it does.
   */
  progressionBlocker?(stats: SessionStats): string | null;
  /**
   * Settings this session's result should change (e.g. a calibration
   * setting the starting contrast). Applied before progression.
   */
  applyResult?(stats: SessionStats, settings: Readonly<UserSettings>): Partial<UserSettings> | null;
}

/** Read a numeric stat, or undefined if absent/non-numeric. */
export function num(stats: StoredStats, key: string): number | undefined {
  const v = stats[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Summary row for a numeric stat, skipped if absent. */
export function statRow(stats: StoredStats, key: string, label: string, unit = ''): SummaryRow[] {
  const v = num(stats, key);
  return v === undefined ? [] : [{ label, value: `${v}${unit}` }];
}
