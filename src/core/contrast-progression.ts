/**
 * Cross-session contrast progression evaluator.
 *
 * After each exercise session, evaluates whether the fellow eye contrast
 * should be automatically increased. Based on research: +2% per successful
 * session, starting at 20-30%, targeting 100% (equal contrast = normal
 * binocular vision).
 *
 * Progression is one-way (never auto-decrements). Users can manually
 * lower contrast via A/B buttons or the launcher slider.
 */

import type { SessionStats } from '../exercises/base-exercise';

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
  fusionThreshold: number;
}

const DEFAULT_CONFIG: ProgressionConfig = {
  increment: 0.02,            // 2%
  maxContrast: 1.0,           // 100%
  minSessionDurationMs: 120000, // 2 minutes (skip accidental starts)
  fusionThreshold: 0.70,      // 70% fusion rate
};

export function evaluateProgression(
  stats: SessionStats,
  currentContrast: number,
  configOverrides?: Partial<ProgressionConfig>,
): ProgressionDecision {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const base = {
    previousContrast: currentContrast,
    newContrast: currentContrast,
  };

  // Already at max
  if (currentContrast >= config.maxContrast) {
    return { ...base, shouldIncrement: false, reason: 'Already at maximum contrast' };
  }

  // Session too short (accidental start)
  if (stats.durationMs < config.minSessionDurationMs) {
    return { ...base, shouldIncrement: false, reason: 'Session too short' };
  }

  const exercise = stats.exercise;

  // Suppression check is diagnostic — never auto-increment
  if (exercise === 'suppression-check') {
    return { ...base, shouldIncrement: false, reason: 'Diagnostic exercise (no progression)' };
  }

  // Binocular exercises: require fusion/accuracy threshold
  if (exercise === 'brock-string' || exercise === 'vergence-training') {
    const fusionRate = (stats.fusionRate as number) ?? 0;
    if (fusionRate < config.fusionThreshold * 100) {
      return {
        ...base,
        shouldIncrement: false,
        reason: `Fusion rate ${fusionRate}% below ${Math.round(config.fusionThreshold * 100)}% threshold`,
      };
    }
  }

  if (exercise === 'depth-scaffolding') {
    const accuracy = (stats.accuracy as number) ?? 0;
    if (accuracy < config.fusionThreshold * 100) {
      return {
        ...base,
        shouldIncrement: false,
        reason: `Accuracy ${accuracy}% below ${Math.round(config.fusionThreshold * 100)}% threshold`,
      };
    }
  }

  // Reading: just need a reasonable session duration (5+ minutes)
  if (exercise === 'monocular-reading') {
    if (stats.durationMs < 300000) {
      return { ...base, shouldIncrement: false, reason: 'Reading session under 5 minutes' };
    }
  }

  // Success — increment
  const newContrast = Math.min(
    config.maxContrast,
    Math.round((currentContrast + config.increment) * 100) / 100,
  );

  return {
    shouldIncrement: true,
    reason: 'Successful session',
    previousContrast: currentContrast,
    newContrast,
  };
}
