/**
 * All available exercises, in launcher order.
 *
 * To add an exercise: create its folder with the exercise class and a
 * definition.ts, then list the definition here. Nothing else needs editing.
 */

import type { ExerciseDefinition } from './definition';
import { readingDefinition } from './monocular-reading/definition';
import { depthScaffoldingDefinition } from './depth-scaffolding/definition';
import { dichoptic2048Definition } from './dichoptic-2048/definition';
import { suppressionCheckDefinition } from './suppression-check/definition';
import { brockStringDefinition } from './brock-string/definition';
import { vergenceTrainingDefinition } from './vergence-training/definition';
import { contrastBalanceDefinition } from './contrast-balance/definition';

export const EXERCISES: readonly ExerciseDefinition[] = [
  readingDefinition,
  depthScaffoldingDefinition,
  dichoptic2048Definition,
  contrastBalanceDefinition,
  suppressionCheckDefinition,
  brockStringDefinition,
  vergenceTrainingDefinition,
];

export function getExercise(id: string): ExerciseDefinition | undefined {
  return EXERCISES.find((e) => e.id === id);
}
