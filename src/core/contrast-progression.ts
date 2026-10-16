/**
 * Cross-session contrast progression evaluator.
 *
 * After each session, decides whether fellow-eye contrast should rise.
 * Based on research: +2% per successful dichoptic session, starting at
 * 20-30%, targeting 100% (equal contrast = normal binocular vision).
 *
 * Only sessions that actually trained against reduced fellow-eye contrast
 * count — the exercise declares this via `fellowEyeContrast` in its stats.
 * Each exercise definition can add its own success bar (duration, play).
 *
 * Progression is one-way (never auto-decrements). Users can manually
 * lower contrast via A/B buttons or the launcher slider.
 */

import type { SessionStats } from '../exercises/base-exercise';
import type { ExerciseDefinition } from '../exercises/definition';

export interface ProgressionDecision {
  shouldIncrement: boolean;
  reason: string;
  newContrast: number;
  previousContrast: number;
}

export interface ProgressionConfig {
  increment: number;
  maxContrast: number;
  minSessionDurationMs: number;
}

const DEFAULT_CONFIG: ProgressionConfig = {
  increment: 0.02,              // 2%
  maxContrast: 1.0,             // 100%
  minSessionDurationMs: 120000, // 2 minutes (skip accidental starts)
};

/** True if the session showed the fellow eye reduced-contrast content. */
export function wasDichoptic(stats: SessionStats): boolean {
  return typeof stats.fellowEyeContrast === 'number' && stats.fellowEyeContrast > 0;
}

export function evaluateProgression(
  stats: SessionStats,
  definition: ExerciseDefinition | undefined,
  currentContrast: number,
  configOverrides?: Partial<ProgressionConfig>,
): ProgressionDecision {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const hold = (reason: string): ProgressionDecision => ({
    shouldIncrement: false,
    reason,
    previousContrast: currentContrast,
    newContrast: currentContrast,
  });

  if (!wasDichoptic(stats)) return hold('Not a dichoptic session');
  if (currentContrast >= config.maxContrast) return hold('Already at maximum contrast');
  if (stats.durationMs < config.minSessionDurationMs) return hold('Session too short');

  const blocker = definition?.progressionBlocker?.(stats);
  if (blocker) return hold(blocker);

  return {
    shouldIncrement: true,
    reason: 'Successful dichoptic session',
    previousContrast: currentContrast,
    newContrast: Math.min(config.maxContrast, Math.round((currentContrast + config.increment) * 100) / 100),
  };
}
