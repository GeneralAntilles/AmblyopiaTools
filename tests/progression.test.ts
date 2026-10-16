/**
 * Fellow-eye contrast only progresses after real dichoptic training.
 */

import { describe, it, expect } from 'vitest';
import { createHarness, type Harness } from './support/harness';

const MINUTE = 60_000;
const BOOK = Array.from({ length: 2000 }, (_, i) => `Line ${i} of a long book.`).join('\n');

async function readFor(h: Harness, minutes: number) {
  await h.start('monocular-reading', { reading: { text: BOOK } });
  for (let m = 0; m < minutes; m++) {
    h.tap('page-forward');
    h.wait(MINUTE, 250);
  }
  return h.end();
}

async function play2048For(h: Harness, minutes: number) {
  await h.start('dichoptic-2048');
  const moves = ['page-back', 'chapter-prev', 'page-forward', 'chapter-next'] as const;
  for (let m = 0; m < minutes; m++) {
    for (let i = 0; i < 12; i++) h.tap(moves[i % 4], 300);
    h.wait(MINUTE - 12 * 300, 250);
  }
  return h.end();
}

describe('contrast progression', () => {
  it('a 6-minute dichoptic reading session raises fellow-eye contrast by 2%', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'dichoptic', contrastDominant: 0.3 });
    const outcome = await readFor(h, 6);

    expect(outcome?.progression).toMatchObject({ shouldIncrement: true, previousContrast: 0.3, newContrast: 0.32 });
    const settings = await h.settings();
    expect(settings.contrastDominant).toBe(0.32);
    expect(settings.contrastProgressionHistory.at(-1)).toMatchObject({ contrast: 0.32, exercise: 'monocular-reading' });
  });

  it('monocular reading (fellow eye blanked) never changes contrast', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'blank', contrastDominant: 0.3 });
    const outcome = await readFor(h, 6);

    expect(outcome?.progression?.shouldIncrement).toBe(false);
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });

  it('a short dichoptic reading session holds contrast and says why', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'dichoptic', contrastDominant: 0.3 });
    const outcome = await readFor(h, 3);

    expect(outcome?.progression).toMatchObject({ shouldIncrement: false, reason: 'Reading session under 5 minutes' });
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });

  it('A/B contrast changes in VR persist and progression builds on them', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'dichoptic', contrastDominant: 0.3 });
    await h.start('monocular-reading', { reading: { text: BOOK } });
    h.tap('button-a'); // -5%
    expect(h.hud.status).toContain('25%');
    h.wait(6 * MINUTE, 250);
    const outcome = await h.end();

    expect(outcome?.stats.fellowEyeContrast).toBe(25);
    expect(outcome?.progression).toMatchObject({ previousContrast: 0.25, newContrast: 0.27 });
    expect((await h.settings()).contrastDominant).toBe(0.27);
  });

  it('a well-fused binocular session does not change contrast (both eyes see full contrast)', async () => {
    const h = await createHarness({ contrastDominant: 0.3 });
    await h.start('vergence-training');
    h.playUntilFinished((h) => {
      h.wait(1500);
      h.tap('select');
    });
    h.wait(3 * MINUTE, 250);
    const outcome = await h.end();

    expect(outcome?.stats.fusionRate).toBe(100);
    expect(outcome?.progression?.shouldIncrement).toBe(false);
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });

  it('2048 with tiles hidden from the fellow eye does not count as dichoptic', async () => {
    const h = await createHarness({ contrastDominant: 0.3, dichoptic2048: false });
    const outcome = await play2048For(h, 6);

    expect(outcome?.stats.moveCount).toBeGreaterThan(30);
    expect(outcome?.progression?.shouldIncrement).toBe(false);
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });

  it('turning auto-progression off leaves contrast alone', async () => {
    const h = await createHarness({
      nonTrainingDisplay: 'dichoptic',
      contrastDominant: 0.3,
      contrastProgressionEnabled: false,
    });
    const outcome = await readFor(h, 6);

    expect(outcome?.progression).toBeUndefined();
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });
});
