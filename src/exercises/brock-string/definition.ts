import type { ExerciseDefinition } from '../definition';
import { num, statRow } from '../definition';
import { BrockStringExercise } from './brock-string';

export const brockStringDefinition: ExerciseDefinition = {
  id: 'brock-string',
  name: 'Brock String',
  description:
    'Virtual Brock string for convergence training. Focus on beads at different depths to see the X pattern. Trains eye teaming.',
  tag: 'binocular',

  create: () => new BrockStringExercise(),

  summarize: (stats) => [
    ...statRow(stats, 'fusionRate', 'Fusion Rate', '%'),
    ...statRow(stats, 'npcCm', 'Near Point', ' cm'),
    ...statRow(stats, 'avgReactionTimeMs', 'Avg Reaction Time', 'ms'),
  ],

  historyDetail: (stats) => {
    const parts: string[] = [];
    const fusion = num(stats, 'fusionRate');
    const npc = num(stats, 'npcCm');
    if (fusion !== undefined) parts.push(`${fusion}% fusion`);
    if (npc !== undefined) parts.push(`NPC ${npc} cm`);
    return parts;
  },
};
