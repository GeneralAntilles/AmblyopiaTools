/**
 * Every exercise can be played through a full session: it starts, responds
 * to controller input, records its stats, and leaves nothing behind.
 */

import { describe, it, expect } from 'vitest';
import { createHarness } from './support/harness';
import { EXERCISES } from '../src/exercises/registry';

describe('a full session of each exercise', () => {
  it('suppression check runs 12 trials, including the vergence offset step on fusion', async () => {
    const h = await createHarness();
    await h.start('suppression-check');

    // Alternate "4 dots" (fusion → aim crosshair → confirm) with "2 dots"
    let i = 0;
    h.playUntilFinished((h) => {
      h.wait(1800); // feedback + inter-trial fixation + fade-in
      if (i++ % 2 === 0) {
        h.tap('select'); // 4 dots
        h.tap('select'); // confirm crosshair position
      } else {
        h.tap('button-a'); // 2 dots
      }
    });

    const outcome = await h.end();
    expect(outcome?.stats).toMatchObject({
      exercise: 'suppression-check',
      trials: 12,
      fusionRate: 50,
      fellowSuppressionRate: 50,
      vergenceOffsetCount: 6,
    });
  });

  it('brock string starts on trigger and ends after enough reversals', async () => {
    const h = await createHarness();
    await h.start('brock-string');
    h.tap('select'); // start without docking the controller

    let fuse = true;
    h.playUntilFinished((h) => {
      h.wait(1500); // bead travels to its new position
      h.tap(fuse ? 'select' : 'button-a');
      fuse = !fuse;
    });

    const outcome = await h.end();
    expect(outcome?.stats.exercise).toBe('brock-string');
    expect(outcome?.stats.reversals).toBeGreaterThanOrEqual(6);
    expect(outcome?.stats.npcCm).toBeGreaterThan(0);
  });

  it('vergence training runs 24 interleaved trials', async () => {
    const h = await createHarness();
    await h.start('vergence-training');

    h.playUntilFinished((h) => {
      h.wait(1500);
      h.tap('select');
    });

    const outcome = await h.end();
    expect(outcome?.stats).toMatchObject({
      exercise: 'vergence-training',
      trials: 24,
      fusionRate: 100,
      convergenceFusionRate: 100,
      divergenceFusionRate: 100,
    });
  });

  it('depth scaffolding runs 30 trials and records accuracy per cue level', async () => {
    const h = await createHarness();
    await h.start('depth-scaffolding');

    h.playUntilFinished((h) => {
      h.wait(3000); // level banner or object scale-in
      h.tap('page-back'); // pick the left object
      h.tap('select');
    });

    const outcome = await h.end();
    expect(outcome?.stats.exercise).toBe('depth-scaffolding');
    expect(outcome?.stats.trials).toBe(30);
    expect(outcome?.stats.accuracy).toBeGreaterThanOrEqual(0);
    expect(outcome?.stats.levelResults).toHaveLength(3);
  });

  it('reading pages through text', async () => {
    const h = await createHarness({ nonTrainingDisplay: 'blank' });
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} of the sample.`).join('\n');
    await h.start('monocular-reading', { reading: { text } });

    h.tap('page-forward');
    h.tap('page-forward');
    h.tap('page-back');

    const outcome = await h.end();
    expect(outcome?.stats).toMatchObject({ exercise: 'monocular-reading', pagesRead: 2, mode: 'blank' });
  });

  it('2048 slides tiles and counts moves', async () => {
    const h = await createHarness();
    await h.start('dichoptic-2048');

    for (const dir of ['page-back', 'chapter-prev', 'page-forward', 'chapter-next'] as const) {
      h.tap(dir, 400);
    }

    const outcome = await h.end();
    expect(outcome?.stats.exercise).toBe('dichoptic-2048');
    expect(outcome?.stats.moveCount).toBeGreaterThan(0);
  });
});

describe('leaving a session', () => {
  it('grip asks the host to exit, from any exercise', async () => {
    for (const ex of EXERCISES) {
      const h = await createHarness();
      let exitRequests = 0;
      h.host.onExitRequested = () => exitRequests++;
      await h.start(ex.id);
      h.wait(500);
      h.press('exit');
      expect(exitRequests, ex.id).toBe(1);
      await h.end();
    }
  });

  it('ending mid-exercise records a partial session and empties the scene', async () => {
    for (const ex of EXERCISES) {
      const h = await createHarness();
      await h.start(ex.id);
      expect(h.renderer.content.children.length, ex.id).toBeGreaterThan(0);
      h.wait(3000);

      const outcome = await h.end();
      expect(outcome?.record.durationMs, ex.id).toBeCloseTo(3000, 0);
      expect(h.renderer.content.children, ex.id).toHaveLength(0);

      const history = await h.store.getSessionHistory();
      expect(history.map((r) => r.exercise), ex.id).toEqual([ex.id]);
    }
  });

  it('controller input after a session ends is ignored', async () => {
    const h = await createHarness();
    let exitRequests = 0;
    h.host.onExitRequested = () => exitRequests++;
    await h.start('dichoptic-2048');
    await h.end();

    h.press('page-back');
    h.press('exit');
    h.wait(500);
    expect(exitRequests).toBe(0);
  });
});
