/**
 * The 2D launcher, rendered from the real index.html.
 */

/// <reference types="vite/client" />
import { describe, it, expect, beforeEach } from 'vitest';
import html from '../index.html?raw';
import { IDBFactory } from 'fake-indexeddb';
import { SettingsStore, type UserSettings } from '../src/core/settings-store';
import { Launcher } from '../src/ui/launcher';
import { EXERCISES } from '../src/exercises/registry';
import { createHarness } from './support/harness';
import { showSessionSummary } from '../src/ui/session-summary';

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');

async function openLauncher(settings: Partial<UserSettings> = {}) {
  globalThis.indexedDB = new IDBFactory();
  const store = new SettingsStore();
  await store.saveSettings({ setupCompleted: true, ...settings });
  return { store, launch: async () => { const l = new Launcher(store); await l.init(); return l; } };
}

const text = (sel: string) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const isShown = (id: string) => !document.getElementById(id)!.classList.contains('hidden');

beforeEach(() => {
  document.body.innerHTML = body;
});

describe('launcher', () => {
  it('lists every registered exercise and nothing else', async () => {
    const { launch } = await openLauncher();
    await launch();

    const cards = [...document.querySelectorAll<HTMLElement>('.exercise-card')];
    expect(cards.map((c) => c.dataset.exercise)).toEqual(EXERCISES.map((e) => e.id));
    expect(text('#exercise-list')).not.toContain('Coming Soon');
  });

  it("shows an exercise's settings only while it is selected", async () => {
    const { launch } = await openLauncher({ lastExercise: 'monocular-reading' });
    await launch();
    expect(isShown('reading-settings-section')).toBe(true);

    document.querySelector<HTMLElement>('.exercise-card[data-exercise="brock-string"]')!.click();
    expect(isShown('reading-settings-section')).toBe(false);
  });

  it('renders history written by earlier versions of the app', async () => {
    const { store, launch } = await openLauncher();
    const t = Date.now();
    // Shapes as recorded before the exercise registry existed
    await store.saveSessionRecord({
      exercise: 'monocular-reading', startTime: t - 3_000_000, endTime: t - 2_400_000, durationMs: 600_000,
      stats: { exercise: 'dichoptic-reading', durationMs: 600_000, pagesRead: 12, mode: 'dichoptic', fellowEyeContrast: 24 },
    });
    await store.saveSessionRecord({
      exercise: 'suppression-check', startTime: t - 2_000_000, endTime: t - 1_900_000, durationMs: 100_000,
      stats: { exercise: 'suppression-check', durationMs: 100_000, fusionRate: 75 },
    });
    await store.saveSessionRecord({
      exercise: 'retired-exercise', startTime: t - 1_000_000, endTime: t - 900_000, durationMs: 100_000,
      stats: {},
    });
    await launch();

    const rows = [...document.querySelectorAll('.history-row')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('retired-exercise');
    expect(rows[1]).toContain('Suppression Check');
    expect(rows[1]).toContain('75% fusion');
    expect(rows[2]).toContain('Dichoptic Reading');
    expect(rows[2]).toContain('12 pages, 24% contrast');
  });

  it('passes the loaded reading text to the session', async () => {
    const { launch } = await openLauncher();
    const launcher = await launch();
    (document.getElementById('reading-text') as HTMLTextAreaElement).value = 'Call me Ishmael.';

    expect(launcher.getLaunchOptions().reading?.text).toBe('Call me Ishmael.');
  });
});

describe('session summary', () => {
  it('explains why a dichoptic session did not raise contrast', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'dichoptic', contrastDominant: 0.3 });
    await h.start('monocular-reading', { reading: { text: 'Short text.' } });
    h.wait(60_000, 250);
    const outcome = (await h.end())!;

    showSessionSummary(document.getElementById('session-summary')!, outcome);
    const rows = Object.fromEntries(
      [...document.querySelectorAll('#summary-stats .stat-row')].map((r) => [
        r.querySelector('.label')!.textContent,
        r.querySelector('.value')!.textContent,
      ]),
    );
    expect(rows).toMatchObject({
      Exercise: 'Dichoptic Reading',
      'Fellow-Eye Contrast': '30%',
      'Contrast Progression': 'Unchanged — session too short',
    });
  });
});
