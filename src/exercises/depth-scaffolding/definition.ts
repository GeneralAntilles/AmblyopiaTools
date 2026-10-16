import type { ExerciseDefinition } from '../definition';
import { num, statRow } from '../definition';
import { DepthScaffoldingExercise } from './depth-scaffolding';

export const depthScaffoldingDefinition: ExerciseDefinition = {
  id: 'depth-scaffolding',
  name: 'Depth Scaffolding',
  description:
    'Stereopsis trainer with progressive cue removal. Starts with size + brightness cues alongside stereo, strips them away. VR-unique — impossible on flat screens.',
  tag: 'binocular',

  create: () => new DepthScaffoldingExercise(),

  summarize: (stats) => [
    ...statRow(stats, 'trials', 'Trials'),
    ...statRow(stats, 'accuracy', 'Accuracy', '%'),
    ...(typeof stats.maxCueLevelName === 'string' ? [{ label: 'Max Level', value: stats.maxCueLevelName }] : []),
  ],

  trends: [{
    label: 'Finest stereo-only depth',
    unit: ' mm',
    better: 'lower',
    value: (stats) => {
      const levels = stats.levelResults as Array<{ finestDepthMm?: number | null }> | undefined;
      const pure = levels?.[2]?.finestDepthMm;
      return typeof pure === 'number' ? pure : undefined;
    },
  }],

  historyDetail: (stats) => {
    const accuracy = num(stats, 'accuracy');
    return accuracy === undefined ? [] : [`${accuracy}% correct`];
  },
};
