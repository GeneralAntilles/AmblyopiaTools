import type { ExerciseDefinition, SummaryRow } from '../definition';
import { num, statRow } from '../definition';
import { SuppressionCheckExercise } from './suppression-check';

export const suppressionCheckDefinition: ExerciseDefinition = {
  id: 'suppression-check',
  name: 'Suppression Check',
  description:
    'Worth 4-dot test at varying distances. Detects binocular suppression with per-distance breakdown. 12 trials (~2 min).',
  tag: 'diagnostic',

  create: () => new SuppressionCheckExercise(),

  summarize: (stats) => {
    const rows: SummaryRow[] = [
      ...statRow(stats, 'fusionRate', 'Fusion Rate', '%'),
      ...statRow(stats, 'nearFusionRate', 'Near Fusion', '%'),
      ...statRow(stats, 'mediumFusionRate', 'Medium Fusion', '%'),
      ...statRow(stats, 'farFusionRate', 'Far Fusion', '%'),
    ];
    const ifPositive = (key: string, label: string) => ((num(stats, key) ?? 0) > 0 ? statRow(stats, key, label, '%') : []);
    rows.push(
      ...ifPositive('trainingSuppressionRate', 'Training Eye Suppressed'),
      ...ifPositive('fellowSuppressionRate', 'Fellow Eye Suppressed'),
      ...ifPositive('diplopiaRate', 'Diplopia'),
      ...statRow(stats, 'avgReactionTimeMs', 'Avg Reaction Time', 'ms'),
    );
    if ((num(stats, 'vergenceOffsetCount') ?? 0) > 0) {
      rows.push(...statRow(stats, 'avgVergenceOffsetMm', 'Avg Vergence Offset', 'mm'));
    }
    return rows;
  },

  trends: [{ label: 'Fusion (Worth 4-dot)', unit: '%', better: 'higher', value: (stats) => num(stats, 'fusionRate') }],

  historyDetail: (stats) => {
    const fusion = num(stats, 'fusionRate');
    return fusion === undefined ? [] : [`${fusion}% fusion`];
  },
};
