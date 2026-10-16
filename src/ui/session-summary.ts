/**
 * Post-session stats display.
 *
 * Renders session results to the 2D launcher page after exiting VR.
 * Exercise-specific rows come from the exercise definition.
 */

import type { SessionOutcome } from '../core/session-host';
import { wasDichoptic } from '../core/contrast-progression';
import type { SummaryRow } from '../exercises/definition';
import { escapeHtml, formatDuration } from '../utils/format';

export function showSessionSummary(container: HTMLElement, outcome: SessionOutcome): void {
  const { definition, stats, progression, contrastChange } = outcome;
  container.style.display = 'block';

  const statsContainer = container.querySelector('#summary-stats');
  if (!statsContainer) return;

  const rows: SummaryRow[] = [
    { label: 'Exercise', value: definition.sessionName?.(stats) ?? definition.name },
    { label: 'Duration', value: formatDuration(stats.durationMs) },
    ...definition.summarize(stats),
  ];

  if (contrastChange) {
    const from = Math.round(contrastChange.from * 100);
    const to = Math.round(contrastChange.to * 100);
    rows.push({
      label: contrastChange.source === 'calibration' ? 'Fellow-Eye Contrast Set' : 'Contrast Progression',
      value: `${from}% → ${to}%`,
      highlight: true,
    });
  } else if (progression && wasDichoptic(stats)) {
    // Say why a dichoptic session didn't move contrast
    rows.push({ label: 'Contrast Progression', value: `Unchanged — ${progression.reason.toLowerCase()}` });
  }

  statsContainer.innerHTML = rows
    .map(
      (r) =>
        `<div class="stat-row${r.highlight ? ' highlight' : ''}"><span class="label">${escapeHtml(r.label)}</span><span class="value">${escapeHtml(r.value)}</span></div>`,
    )
    .join('');
}
