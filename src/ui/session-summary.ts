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
