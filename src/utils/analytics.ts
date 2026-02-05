/**
 * Local-only session tracking.
 *
 * Records exercise sessions with timing and performance data.
 * All data stays in IndexedDB — no cloud, no telemetry.
 */

import type { SettingsStore, SessionRecord } from '../core/settings-store';

export interface ActiveSession {
  exercise: string;
  startTime: number;
  stats: Record<string, unknown>;
}

export class Analytics {
  private store: SettingsStore;
  private activeSession: ActiveSession | null = null;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  startSession(exercise: string): void {
    this.activeSession = {
      exercise,
      startTime: Date.now(),
      stats: {},
    };
  }

  updateStats(stats: Record<string, unknown>): void {
    if (!this.activeSession) return;
    Object.assign(this.activeSession.stats, stats);
  }

  async endSession(finalStats?: Record<string, unknown>): Promise<SessionRecord | null> {
    if (!this.activeSession) return null;

    const endTime = Date.now();
    const record: Omit<SessionRecord, 'id'> = {
      exercise: this.activeSession.exercise,
      startTime: this.activeSession.startTime,
      endTime,
      durationMs: endTime - this.activeSession.startTime,
      stats: { ...this.activeSession.stats, ...finalStats },
    };

    this.activeSession = null;

    await this.store.saveSessionRecord(record);
    return record as SessionRecord;
  }

  getActiveSession(): ActiveSession | null {
    return this.activeSession;
  }

  async getHistory(exercise?: string, limit?: number): Promise<SessionRecord[]> {
    return this.store.getSessionHistory(exercise, limit);
  }

  /**
   * Format duration in ms to a human-readable string.
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
}
