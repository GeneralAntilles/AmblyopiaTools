import type { ExerciseDefinition } from '../definition';
import { num, statRow } from '../definition';
import { VergenceTrainingExercise } from './vergence-training';

export const vergenceTrainingDefinition: ExerciseDefinition = {
  id: 'vergence-training',
  name: 'Vergence Training',
  description:
    'Train convergence and divergence with binocular disparity rings. VR equivalent of eccentric circles and vectographs.',
  tag: 'binocular',

  create: () => new VergenceTrainingExercise(),

  summarize: (stats) => [
    ...statRow(stats, 'fusionRate', 'Fusion Rate', '%'),
    ...statRow(stats, 'convergenceFusionRate', 'Convergence Fused', '%'),
    ...statRow(stats, 'divergenceFusionRate', 'Divergence Fused', '%'),
    ...statRow(stats, 'avgReactionTimeMs', 'Avg Reaction Time', 'ms'),
  ],

  historyDetail: (stats) => {
    const parts: string[] = [];
    const fusion = num(stats, 'fusionRate');
    const conv = num(stats, 'convergenceFusionRate');
    if (fusion !== undefined) parts.push(`${fusion}% fusion`);
    if (conv !== undefined) parts.push(`conv ${conv}%`);
    return parts;
  },
};
