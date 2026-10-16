import type { ExerciseDefinition, SummaryRow } from '../definition';
import { num, statRow } from '../definition';
import { Dichoptic2048Exercise } from './dichoptic-2048';

const MIN_PROGRESSION_MS = 5 * 60_000;
const MIN_PROGRESSION_MOVES = 30;

export const dichoptic2048Definition: ExerciseDefinition = {
  id: 'dichoptic-2048',
  name: 'Dichoptic 2048',
  description:
    'Play 2048 with the tiles split between your eyes — the fellow eye’s share at reduced contrast — so seeing the whole board takes both eyes working together.',
  tag: 'dichoptic',
  settingsSection: 'game-2048-settings-section',

  create: () => new Dichoptic2048Exercise(),

  // Sessions recorded before the dichoptic setting existed have no mode and were training-eye only
  sessionName: (stats) => (stats.mode === 'dichoptic' ? 'Dichoptic 2048' : '2048 (training eye only)'),

  summarize: (stats) => {
    const contrast = num(stats, 'fellowEyeContrast');
    const rows: SummaryRow[] = [
      ...statRow(stats, 'score', 'Score'),
      ...statRow(stats, 'highestTile', 'Best Tile'),
      ...statRow(stats, 'moveCount', 'Moves'),
      ...(contrast ? [{ label: 'Fellow-Eye Contrast', value: `${contrast}%` }] : []),
    ];
    if (stats.won) rows.push({ label: 'Result', value: 'Reached 2048!', highlight: true });
    return rows;
  },

  historyDetail: (stats) => {
    const parts: string[] = [];
    const score = num(stats, 'score');
    const best = num(stats, 'highestTile');
    const contrast = num(stats, 'fellowEyeContrast');
    if (score !== undefined && best !== undefined) parts.push(`${score} pts, best ${best}`);
    if (contrast) parts.push(`${contrast}% contrast`);
    return parts;
  },

  progressionBlocker: (stats) => {
    if (stats.durationMs < MIN_PROGRESSION_MS) return 'Played under 5 minutes';
    if ((num(stats, 'moveCount') ?? 0) < MIN_PROGRESSION_MOVES) return 'Too few moves to count as play';
    return null;
  },
};
