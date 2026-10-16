import type { ExerciseDefinition } from '../definition';
import { num, statRow } from '../definition';
import { MonocularReadingExercise } from './monocular-reading';

const MIN_PROGRESSION_MS = 5 * 60_000;

export const readingDefinition: ExerciseDefinition = {
  id: 'monocular-reading',
  name: 'Reading',
  description:
    'Read your own text or EPUB with the training eye. Dichoptic mode shows the fellow eye the same page at reduced contrast; other modes occlude it.',
  tag: 'monocular',
  settingsSection: 'reading-settings-section',

  create: (launch) => new MonocularReadingExercise(launch.reading),

  sessionName: (stats) => (stats.mode === 'dichoptic' ? 'Dichoptic Reading' : 'Monocular Reading'),

  summarize: (stats) => {
    const contrast = num(stats, 'fellowEyeContrast');
    return [
      ...statRow(stats, 'pagesRead', 'Pages Read'),
      ...statRow(stats, 'totalPages', 'Total Pages'),
      ...(contrast ? [{ label: 'Fellow-Eye Contrast', value: `${contrast}%` }] : []),
    ];
  },

  historyDetail: (stats) => {
    const parts: string[] = [];
    const pages = num(stats, 'pagesRead');
    const contrast = num(stats, 'fellowEyeContrast');
    if (pages) parts.push(`${pages} pages`);
    if (contrast) parts.push(`${contrast}% contrast`);
    return parts;
  },

  progressionBlocker: (stats) =>
    stats.durationMs < MIN_PROGRESSION_MS ? 'Reading session under 5 minutes' : null,
};
