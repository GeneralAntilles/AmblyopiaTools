import type { ExerciseDefinition } from '../definition';
import { num, statRow } from '../definition';
import { ContrastBalanceExercise } from './contrast-balance';

/** Keep the fellow eye's content at least faintly visible. */
const MIN_STARTING_CONTRAST = 0.05;

export const contrastBalanceDefinition: ExerciseDefinition = {
  id: 'contrast-balance',
  name: 'Eye Balance',
  description:
    'Measures how strongly each eye is seen when they compete, and sets the fellow-eye contrast your dichoptic exercises start from. About 2 minutes.',
  tag: 'diagnostic',

  create: () => new ContrastBalanceExercise(),

  summarize: (stats) => {
    const balance = num(stats, 'balancePct');
    if (stats.completed === false) return [{ label: 'Result', value: 'Stopped early — contrast unchanged' }];
    return [
      ...(balance !== undefined ? [{ label: 'Balance Point', value: `${balance}% fellow-eye contrast` }] : []),
      ...statRow(stats, 'trials', 'Trials'),
      ...statRow(stats, 'mixedRate', 'Patchy / Both', '%'),
    ];
  },

  historyDetail: (stats) => {
    const balance = num(stats, 'balancePct');
    return stats.completed && balance !== undefined ? [`balance ${balance}%`] : [];
  },

  applyResult: (stats) => {
    const balance = num(stats, 'balanceContrast');
    if (!stats.completed || balance === undefined) return null;
    return { contrastDominant: Math.max(MIN_STARTING_CONTRAST, Math.min(1, balance)) };
  },
};
