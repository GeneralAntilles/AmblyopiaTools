/**
 * Eye Balance: a simulated observer with a known balance point should get
 * that balance point back as their starting fellow-eye contrast.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createHarness, type Harness } from './support/harness';

type Orientation = 'vertical' | 'horizontal';

const grating = (h: Harness, eye: 'training' | 'fellow') => h.renderer.eyeOnlyMeshes(eye)[0] as THREE.Mesh | undefined;
const orientation = (m: THREE.Mesh): Orientation => (Math.abs(m.rotation.z) > 0.1 ? 'horizontal' : 'vertical');
const opacity = (m: THREE.Mesh) => (m.material as THREE.MeshBasicMaterial).opacity;

/**
 * Responds like someone whose fellow eye wins rivalry once its contrast
 * exceeds `balance`. `seesFellowAlone` = false models a fellow eye that
 * can't see the stimulus on its own.
 */
function observer(balance: number, seesFellowAlone = true) {
  return (h: Harness) => {
    for (let i = 0; i < 80 && !grating(h, 'training') && !grating(h, 'fellow'); i++) h.wait(50);
    const t = grating(h, 'training');
    const f = grating(h, 'fellow');
    if (!t && !f) return;

    let seen: Orientation | 'mixed';
    if (t && f) seen = opacity(f) > balance ? orientation(f) : orientation(t);
    else if (t) seen = orientation(t);
    else seen = seesFellowAlone ? orientation(f!) : 'mixed';

    h.tap(seen === 'vertical' ? 'chapter-prev' : seen === 'horizontal' ? 'page-back' : 'select');
  };
}

async function measure(trueBalance: number, opts: { seesFellowAlone?: boolean } = {}) {
  const h = await createHarness({ contrastDominant: 0.2 });
  await h.start('contrast-balance');
  h.playUntilFinished(observer(trueBalance, opts.seesFellowAlone));
  return { h, outcome: (await h.end())! };
}

describe('eye balance measurement', () => {
  it.each([0.35, 0.08, 0.7])('finds a balance point of %s and starts training there', async (trueBalance) => {
    const { h, outcome } = await measure(trueBalance);

    const measured = outcome.stats.balanceContrast as number;
    expect(measured).toBeGreaterThan(trueBalance / 1.25);
    expect(measured).toBeLessThan(trueBalance * 1.25);

    expect(outcome.contrastChange).toMatchObject({ from: 0.2, to: measured, source: 'calibration' });
    const settings = await h.settings();
    expect(settings.contrastDominant).toBe(measured);
    expect(settings.contrastProgressionHistory.at(-1)).toMatchObject({ exercise: 'contrast-balance', auto: false });
  });

  it('does not count as dichoptic training', async () => {
    const { outcome } = await measure(0.35);
    expect(outcome.progression?.shouldIncrement).toBe(false);
  });

  it('records whether practice stripes were seen by each eye', async () => {
    const seen = await measure(0.35);
    expect(seen.outcome.stats).toMatchObject({ practiceTrainingCorrect: true, practiceFellowCorrect: true });

    const missed = await measure(0.35, { seesFellowAlone: false });
    expect(missed.outcome.stats).toMatchObject({ practiceTrainingCorrect: true, practiceFellowCorrect: false });
  });

  it('stopping early leaves contrast alone', async () => {
    const h = await createHarness({ contrastDominant: 0.2 });
    await h.start('contrast-balance');
    const look = observer(0.35);
    for (let i = 0; i < 5; i++) look(h);
    const outcome = (await h.end())!;

    expect(outcome.stats.completed).toBe(false);
    expect(outcome.contrastChange).toBeUndefined();
    expect((await h.settings()).contrastDominant).toBe(0.2);
  });
});
