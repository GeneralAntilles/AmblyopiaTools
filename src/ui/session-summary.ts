/**
 * Post-session stats display.
 *
 * Renders session results to the 2D launcher page after exiting VR.
 * Exercise-specific rows come from the exercise definition.
 */

import type { SessionOutcome } from '../core/session-host';
import type { SummaryRow } from '../exercises/definition';
import { escapeHtml, formatDuration } from '../utils/format';

export function showSessionSummary(container: HTMLElement, outcome: SessionOutcome): void {
  const { definition, stats, progression } = outcome;
  container.style.display = 'block';

  const statsContainer = container.querySelector('#summary-stats');
  if (!statsContainer) return;

  const rows: SummaryRow[] = [
    { label: 'Exercise', value: definition.sessionName?.(stats) ?? definition.name },
    { label: 'Duration', value: formatDuration(stats.durationMs) },
    ...definition.summarize(stats),
  ];

  if (progression?.shouldIncrement) {
    const prev = Math.round(progression.previousContrast * 100);
    const next = Math.round(progression.newContrast * 100);
    rows.push({ label: 'Contrast Progression', value: `${prev}% → ${next}%`, highlight: true });
  }

  statsContainer.innerHTML = rows
    .map(
      (r) =>
        `<div class="stat-row${r.highlight ? ' highlight' : ''}"><span class="label">${escapeHtml(r.label)}</span><span class="value">${escapeHtml(r.value)}</span></div>`,
    )
    .join('');
}
