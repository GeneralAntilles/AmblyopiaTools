/**
 * What each eye sees in 2048, in dichoptic and training-eye-only modes.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createHarness, type Harness } from './support/harness';

const MOVES = ['page-back', 'chapter-prev', 'page-forward', 'chapter-next'] as const;

function play(h: Harness, moves: number) {
  for (let i = 0; i < moves; i++) h.tap(MOVES[i % 4], 300);
}

const tiles = (h: Harness, eye: 'training' | 'fellow') => h.renderer.eyeOnlyMeshes(eye);
const opacity = (m: THREE.Mesh) => (m.material as THREE.MeshBasicMaterial).opacity;

describe('2048, dichoptic (default)', () => {
  it('splits tiles between the eyes, the fellow eye at reduced contrast', async () => {
    const h = await createHarness({ contrastDominant: 0.3 });
    await h.start('dichoptic-2048');

    // The opening two tiles go one to each eye
    expect(tiles(h, 'training')).toHaveLength(1);
    expect(tiles(h, 'fellow')).toHaveLength(1);

    play(h, 20);
    const training = tiles(h, 'training');
    const fellow = tiles(h, 'fellow');
    expect(training.length).toBeGreaterThan(0);
    expect(fellow.length).toBeGreaterThan(0);

    expect(training.every((m) => opacity(m) === 1)).toBe(true);
    expect(fellow.every((m) => opacity(m) === 0.3)).toBe(true);

    // No cell is shown to both eyes
    const cell = (m: THREE.Mesh) => `${m.position.x.toFixed(3)},${m.position.y.toFixed(3)}`;
    const trainingCells = new Set(training.map(cell));
    expect(fellow.some((m) => trainingCells.has(cell(m)))).toBe(false);
  });

  it('A/B adjust fellow-eye contrast during play and the change is kept', async () => {
    const h = await createHarness({ contrastDominant: 0.3 });
    await h.start('dichoptic-2048');

    h.tap('button-b');
    h.tap('button-b');
    expect(tiles(h, 'fellow').every((m) => opacity(m) === 0.4)).toBe(true);
    expect(h.hud.status).toContain('40%');

    h.tap('button-a');
    const outcome = await h.end();
    expect(outcome?.stats.fellowEyeContrast).toBe(35);
    expect((await h.settings()).contrastDominant).toBe(0.35);
  });

  it('counts toward contrast progression after 5 minutes of play', async () => {
    const h = await createHarness({ contrastDominant: 0.3 });
    await h.start('dichoptic-2048');
    for (let m = 0; m < 6; m++) {
      play(h, 12);
      h.wait(60_000 - 12 * 300, 250);
    }
    const outcome = await h.end();

    expect(outcome?.stats.mode).toBe('dichoptic');
    expect(outcome?.progression).toMatchObject({ shouldIncrement: true, newContrast: 0.32 });
  });
});

describe('2048, training eye only', () => {
  it('shows every tile to the training eye and none to the fellow eye', async () => {
    const h = await createHarness({ dichoptic2048: false, contrastDominant: 0.3 });
    await h.start('dichoptic-2048');
    play(h, 12);

    expect(tiles(h, 'training').length).toBeGreaterThanOrEqual(2);
    expect(tiles(h, 'fellow')).toHaveLength(0);

    // A/B do nothing to contrast in this mode
    h.tap('button-b');
    const outcome = await h.end();
    expect(outcome?.stats).toMatchObject({ mode: 'training-eye', fellowEyeContrast: 0 });
    expect((await h.settings()).contrastDominant).toBe(0.3);
  });
});
