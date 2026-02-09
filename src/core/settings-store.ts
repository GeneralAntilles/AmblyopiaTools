/**
 * Persisted user settings via IndexedDB.
 *
 * Uses the `idb` library for a cleaner async API.
 * Stores all user preferences: training eye, exercise settings, etc.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'openvisiontherapy';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';
const SESSIONS_STORE = 'sessions';

export interface UserSettings {
  trainingEye: 'left' | 'right';
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  nonTrainingDisplay: 'blank' | 'fixation' | 'pattern' | 'dichoptic';
  lastExercise: string;
  contrastDominant: number;
  contrastAmblyopic: number;
  // Contrast progression
  contrastProgressionEnabled: boolean;
  contrastAutoIncrement: number;
  contrastProgressionHistory: Array<{
    timestamp: number;
    contrast: number;
    exercise: string;
    fusionRate?: number;
    auto: boolean;
  }>;
  // Setup
  setupCompleted: boolean;
  setupCompletedAt: number | null;
  // Guided programs groundwork
  exerciseOrder: string[];
  lastCompletedExerciseIndex: number;
}

export interface SessionRecord {
  id?: number;
  exercise: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  stats: Record<string, unknown>;
}

const DEFAULT_SETTINGS: UserSettings = {
  trainingEye: 'right',
  fontSize: 48,
  lineHeight: 1.6,
  fontFamily: 'sans-serif',
  nonTrainingDisplay: 'blank',
  lastExercise: 'monocular-reading',
  contrastDominant: 0.2,
  contrastAmblyopic: 1.0,
  contrastProgressionEnabled: true,
  contrastAutoIncrement: 0.02,
  contrastProgressionHistory: [],
  setupCompleted: false,
  setupCompletedAt: null,
  exerciseOrder: ['suppression-check', 'monocular-reading', 'brock-string', 'vergence-training', 'depth-scaffolding'],
  lastCompletedExerciseIndex: -1,
};

export class SettingsStore {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE);
        }
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const store = db.createObjectStore(SESSIONS_STORE, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('exercise', 'exercise');
          store.createIndex('startTime', 'startTime');
        }
      },
    });
  }

  async getSettings(): Promise<UserSettings> {
    const db = await this.dbPromise;
    const stored = await db.get(SETTINGS_STORE, 'user-settings');
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(settings: Partial<UserSettings>): Promise<void> {
    const db = await this.dbPromise;
    const current = await this.getSettings();
    const merged = { ...current, ...settings };
    await db.put(SETTINGS_STORE, merged, 'user-settings');
  }

  async saveSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): Promise<void> {
    await this.saveSettings({ [key]: value } as Partial<UserSettings>);
  }

  async saveSessionRecord(record: Omit<SessionRecord, 'id'>): Promise<number> {
    const db = await this.dbPromise;
    return (await db.add(SESSIONS_STORE, record)) as number;
  }

  async getSessionHistory(exercise?: string, limit = 50): Promise<SessionRecord[]> {
    const db = await this.dbPromise;
    let records: SessionRecord[];

    if (exercise) {
      records = await db.getAllFromIndex(SESSIONS_STORE, 'exercise', exercise);
    } else {
      records = await db.getAll(SESSIONS_STORE);
    }

    // Sort by startTime descending, limit
    records.sort((a, b) => b.startTime - a.startTime);
    return records.slice(0, limit);
  }

  /**
   * Get saved reading text, if any.
   */
  async getReadingText(): Promise<string | null> {
    const db = await this.dbPromise;
    return (await db.get(SETTINGS_STORE, 'reading-text')) ?? null;
  }

  async saveReadingText(text: string): Promise<void> {
    const db = await this.dbPromise;
    await db.put(SETTINGS_STORE, text, 'reading-text');
  }
}
