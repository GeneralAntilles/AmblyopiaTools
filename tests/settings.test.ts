/**
 * Settings persistence.
 */

import { describe, it, expect } from 'vitest';
import { createHarness } from './support/harness';

describe('settings', () => {
  it('overlapping saves of different settings all stick', async () => {
    const { store } = await createHarness();
    await Promise.all([
      store.saveSetting('contrastDominant', 0.42),
      store.saveSetting('nonTrainingDisplay', 'dichoptic'),
      store.saveSetting('fontSize', 60),
    ]);
    expect(await store.getSettings()).toMatchObject({ contrastDominant: 0.42, nonTrainingDisplay: 'dichoptic', fontSize: 60 });
  });
});
