/**
 * Post-session stats display.
 *
 * Renders session results to the 2D launcher page after exiting VR.
 */

import type { SessionStats } from '../exercises/base-exercise';
import { Analytics } from '../utils/analytics';

export function showSessionSummary(
  container: HTMLElement,
  stats: SessionStats
): void {
  container.style.display = 'block';

  const statsContainer = container.querySelector('#summary-stats');
  if (!statsContainer) return;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Exercise', value: formatExerciseName(stats.exercise) },
    { label: 'Duration', value: Analytics.formatDuration(stats.durationMs) },
  ];

  // Exercise-specific stats
  if ('pagesRead' in stats) {
    rows.push({ label: 'Pages Read', value: String(stats.pagesRead) });
  }
  if ('totalPages' in stats) {
    rows.push({ label: 'Total Pages', value: String(stats.totalPages) });
  }
  if ('estimatedWordsRead' in stats) {
    rows.push({ label: 'Est. Words Read', value: String(stats.estimatedWordsRead) });
  }

  // Suppression check stats
  if ('fusionRate' in stats) {
    rows.push({ label: 'Fusion Rate', value: `${stats.fusionRate}%` });
  }
  if ('nearFusionRate' in stats) {
    rows.push({ label: 'Near Fusion', value: `${stats.nearFusionRate}%` });
    rows.push({ label: 'Medium Fusion', value: `${stats.mediumFusionRate}%` });
    rows.push({ label: 'Far Fusion', value: `${stats.farFusionRate}%` });
  }
  if ('trainingSuppressionRate' in stats && Number(stats.trainingSuppressionRate) > 0) {
    rows.push({ label: 'Training Eye Suppressed', value: `${stats.trainingSuppressionRate}%` });
  }
  if ('fellowSuppressionRate' in stats && Number(stats.fellowSuppressionRate) > 0) {
    rows.push({ label: 'Fellow Eye Suppressed', value: `${stats.fellowSuppressionRate}%` });
  }
  if ('diplopiaRate' in stats && Number(stats.diplopiaRate) > 0) {
    rows.push({ label: 'Diplopia', value: `${stats.diplopiaRate}%` });
  }

  // Vergence / depth stats
  if ('trials' in stats && !('fusionRate' in stats)) {
    rows.push({ label: 'Trials', value: String(stats.trials) });
  }
  if ('avgReactionTimeMs' in stats) {
    rows.push({ label: 'Avg Reaction Time', value: `${stats.avgReactionTimeMs}ms` });
  }
  if ('avgVergenceOffsetMm' in stats && Number(stats.vergenceOffsetCount) > 0) {
    rows.push({ label: 'Avg Vergence Offset', value: `${stats.avgVergenceOffsetMm}mm` });
  }

  statsContainer.innerHTML = rows
    .map(
      (r) =>
        `<div class="stat-row"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`
    )
    .join('');
}

function formatExerciseName(exercise: string): string {
  return exercise
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
