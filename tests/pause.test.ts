/**
 * The pause menu: grip pauses instead of quitting, and a paused session
 * is frozen.
 */

import { describe, it, expect } from 'vitest';
import { createHarness, type Harness } from './support/harness';

async function started(id: string, settings = {}) {
  const h = await createHarness(settings);
  let exitRequests = 0;
  h.host.onExitRequested = () => exitRequests++;
  await h.start(id);
  return { h, exits: () => exitRequests };
}

const menuVisible = (h: Harness) =>
  h.renderer.visibleMeshes('training').some((m) => m.renderOrder > 1000);

describe('pause menu', () => {
  it('an accidental grip in 2048 pauses; grip again resumes the same game', async () => {
    const { h, exits } = await started('dichoptic-2048');
    h.tap('page-back', 400);
    h.tap('chapter-prev', 400);

    h.tap('menu');
    expect(h.host.isPaused).toBe(true);
    expect(menuVisible(h)).toBe(true);

    h.tap('menu');
    expect(h.host.isPaused).toBe(false);
    expect(menuVisible(h)).toBe(false);
    expect(exits()).toBe(0);

    h.tap('page-forward', 400);
    const outcome = await h.end();
    expect(outcome?.stats.moveCount).toBeGreaterThanOrEqual(2);
  });

  it('trigger on Resume resumes without also answering the exercise', async () => {
    const { h } = await started('vergence-training');
    h.wait(1500); // rings settle; awaiting an answer

    h.tap('menu');
    h.tap('select'); // Resume — must not count as "fused"
    expect(h.host.isPaused).toBe(false);

    const outcome = await h.end();
    expect(outcome?.stats.trials).toBe(0);
  });

  it('while paused the exercise gets no input and no time', async () => {
    const { h } = await started('suppression-check');
    h.tap('menu');

    // Long enough for several trials if time were running; answers go to the menu
    for (let i = 0; i < 10; i++) {
      h.wait(2000);
      h.tap('button-a');
    }
    expect(h.hud.elapsedMs).toBeLessThan(100);

    h.tap('menu');
    const outcome = await h.end();
    expect(outcome?.stats.trials).toBe(0);
  });

  it('paused time does not count toward session length or progression', async () => {
    const { h } = await started('monocular-reading', { nonTrainingDisplay: 'dichoptic', contrastDominant: 0.3 });
    h.wait(3 * 60_000, 500);
    h.tap('menu');
    h.wait(10 * 60_000, 500); // headset off for ten minutes
    h.tap('menu');
    h.wait(60_000, 500);

    const outcome = await h.end();
    expect(outcome?.stats.durationMs).toBeCloseTo(4 * 60_000 + 50, -2);
    expect(outcome?.progression).toMatchObject({ shouldIncrement: false, reason: 'Reading session under 5 minutes' });
  });

  it('stick moves between items; End Session asks to leave', async () => {
    const { h, exits } = await started('brock-string');
    h.tap('menu');
    h.tap('chapter-next'); // End Session
    h.tap('chapter-next'); // wraps to Resume
    h.tap('chapter-prev'); // End Session
    h.tap('select');
    expect(exits()).toBe(1);
  });

  it('pausing from outside (system menu, headset off) is the same pause', async () => {
    const { h, exits } = await started('depth-scaffolding');
    h.host.pause();
    h.host.pause(); // idempotent
    expect(h.host.isPaused).toBe(true);
    h.tap('select');
    expect(h.host.isPaused).toBe(false);
    expect(exits()).toBe(0);
  });

  it('on a results screen, trigger finishes the session', async () => {
    const { h, exits } = await started('vergence-training');
    h.playUntilFinished((h) => {
      h.wait(1500);
      h.tap('select');
    });
    // A leftover press right after the last answer doesn't skip the results
    h.tap('select');
    expect(exits()).toBe(0);

    h.wait(1000);
    h.tap('select');
    expect(exits()).toBe(1);
  });
});
