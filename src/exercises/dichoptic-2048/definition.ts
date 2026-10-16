import type { ExerciseDefinition, SummaryRow } from '../definition';
import { num, statRow } from '../definition';
import { Dichoptic2048Exercise } from './dichoptic-2048';

const MIN_PROGRESSION_MS = 5 * 60_000;
const MIN_PROGRESSION_MOVES = 30;

export const dichoptic2048Definition: ExerciseDefinition = {
  id: 'dichoptic-2048',
  name: 'Dichoptic 2048',
  description:
    'Play 2048 with the board visible to both eyes but tiles only to your training eye. Forces binocular cooperation during gameplay.',
  tag: 'dichoptic',

  create: () => new Dichoptic2048Exercise(),

  summarize: (stats) => {
    const rows: SummaryRow[] = [
      ...statRow(stats, 'score', 'Score'),
      ...statRow(stats, 'highestTile', 'Best Tile'),
      ...statRow(stats, 'moveCount', 'Moves'),
    ];
    if (stats.won) rows.push({ label: 'Result', value: 'Reached 2048!', highlight: true });
    return rows;
  },

  historyDetail: (stats) => {
    const score = num(stats, 'score');
    const best = num(stats, 'highestTile');
    return score !== undefined && best !== undefined ? [`${score} pts, best ${best}`] : [];
  },

  progressionBlocker: (stats) => {
    if (stats.durationMs < MIN_PROGRESSION_MS) return 'Played under 5 minutes';
    if ((num(stats, 'moveCount') ?? 0) < MIN_PROGRESSION_MOVES) return 'Too few moves to count as play';
    return null;
  },
};
