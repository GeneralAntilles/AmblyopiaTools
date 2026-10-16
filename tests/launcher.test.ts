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

    document.querySelector<HTMLElement>('.exercise-card[data-exercise="dichoptic-2048"]')!.click();
    expect(isShown('reading-settings-section')).toBe(false);
    expect(isShown('game-2048-settings-section')).toBe(true);

    document.querySelector<HTMLElement>('.exercise-card[data-exercise="brock-string"]')!.click();
    expect(isShown('reading-settings-section')).toBe(false);
    expect(isShown('game-2048-settings-section')).toBe(false);
  });

  it('saves the 2048 dichoptic toggle and the fellow-eye contrast slider', async () => {
    const { store, launch } = await openLauncher({ contrastDominant: 0.3 });
    await launch();

    const slider = document.getElementById('contrast-dominant') as HTMLInputElement;
    expect(slider.value).toBe('30');
    expect(text('#contrast-current')).toBe('30%');
    slider.value = '42';
    slider.dispatchEvent(new Event('input'));

    const toggle = document.getElementById('dichoptic-2048') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    await new Promise((r) => setTimeout(r, 20));
    expect(await store.getSettings()).toMatchObject({ contrastDominant: 0.42, dichoptic2048: false });
    expect(text('#contrast-current')).toBe('42%');
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

  it('first run walks through the wizard to the eye balance measurement', async () => {
    const { store, launch } = await openLauncher({ setupCompleted: false });
    const launched = launch();

    // Welcome → eye choice → measure
    const click = async (id: string) => {
      await new Promise((r) => setTimeout(r, 10));
      document.getElementById(id)!.click();
    };
    await click('wizard-next');
    await new Promise((r) => setTimeout(r, 10));
    document.querySelector<HTMLElement>('.wizard-eye-btn[data-eye="left"]')!.click();
    await click('wizard-next');
    await click('wizard-baseline');
    await launched;

    expect(document.getElementById('setup-wizard')!.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.exercise-card.selected')?.getAttribute('data-exercise')).toBe('contrast-balance');
    expect(await store.getSettings()).toMatchObject({ setupCompleted: true, trainingEye: 'left' });
  });

  it('passes the loaded reading text to the session', async () => {
    const { launch } = await openLauncher();
    const launcher = await launch();
    (document.getElementById('reading-text') as HTMLTextAreaElement).value = 'Call me Ishmael.';

    expect(launcher.getLaunchOptions().reading?.text).toBe('Call me Ishmael.');
  });
});

describe('progress trends', () => {
  const trendRows = () =>
    Object.fromEntries(
      [...document.querySelectorAll('.trend-row')].map((r) => [
        r.querySelector('.trend-label')!.firstChild!.textContent!.trim(),
        `${r.querySelector('.trend-value')!.firstChild!.textContent!.trim()} ${r.querySelector('.trend-delta')!.textContent}`,
      ]),
    );

  it('shows a metric once it has two sessions, with direction-aware change', async () => {
    const { store, launch } = await openLauncher();
    const t = Date.now();
    const brock = (npcCm: number, i: number) => store.saveSessionRecord({
      exercise: 'brock-string', startTime: t - 100_000 * (10 - i), endTime: t, durationMs: 60_000,
      stats: { npcCm, fusionRate: 60 },
    });
    await brock(14, 0);
    await launch();
    expect(trendRows()).toEqual({});
    expect(text('#progress-trends')).toContain('two sessions');

    await brock(11, 1);
    await brock(9, 2);
    await launch();
    expect(trendRows()).toEqual({ 'Near point of convergence': '9 cm −5 cm' });
    // Smaller NPC is better
    expect(document.querySelector('.trend-delta')!.classList.contains('improved')).toBe(true);
  });

  it('tracks fellow-eye contrast across calibration and progression', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'dichoptic', contrastDominant: 0.2 });
    // Two dichoptic reading sessions that each earn +2%
    for (let i = 0; i < 2; i++) {
      await h.start('monocular-reading', { reading: { text: 'Some text.' } });
      h.wait(6 * 60_000, 500);
      await h.end();
    }
    const launcher = new Launcher(h.store);
    await launcher.init();
    expect(trendRows()).toMatchObject({ 'Fellow-eye contrast': '24% +4%' });
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
