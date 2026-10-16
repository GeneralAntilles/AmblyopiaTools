/**
 * Launcher "Progress" section: one sparkline per tracked metric.
 *
 * Metrics come from exercise definitions (`trends`) plus fellow-eye
 * contrast from the progression history. A metric appears once it has
 * two data points.
 */

import type { SettingsStore, UserSettings } from '../core/settings-store';
import { EXERCISES } from '../exercises/registry';
import { escapeHtml } from '../utils/format';

const SESSIONS_PER_TREND = 30;
const SPARK_W = 120;
const SPARK_H = 28;

interface Trend {
  label: string;
  unit: string;
  better: 'higher' | 'lower';
  /** Oldest first. */
  points: number[];
}

export async function collectTrends(store: SettingsStore, settings: UserSettings): Promise<Trend[]> {
  const trends: Trend[] = [];

  const contrast = settings.contrastProgressionHistory.map((h) => Math.round(h.contrast * 100));
  if (contrast.length >= 2) {
    trends.push({ label: 'Fellow-eye contrast', unit: '%', better: 'higher', points: contrast });
  }

  for (const ex of EXERCISES) {
    if (!ex.trends?.length) continue;
    const records = (await store.getSessionHistory(ex.id, SESSIONS_PER_TREND)).reverse();
    for (const metric of ex.trends) {
      const points = records
        .map((r) => metric.value(r.stats ?? {}))
        .filter((v): v is number => v !== undefined);
      if (points.length >= 2) trends.push({ label: metric.label, unit: metric.unit, better: metric.better, points });
    }
  }

  return trends;
}

export async function renderProgressTrends(container: HTMLElement, store: SettingsStore, settings: UserSettings): Promise<void> {
  const trends = await collectTrends(store, settings);
  container.innerHTML = trends.length
    ? trends.map(trendRow).join('')
    : '<p class="history-empty">Trends appear here once an exercise has two sessions.</p>';
}

function trendRow(t: Trend): string {
  const first = t.points[0];
  const last = t.points[t.points.length - 1];
  const delta = Math.round((last - first) * 10) / 10;
  const improved = t.better === 'higher' ? delta > 0 : delta < 0;
  const deltaClass = delta === 0 ? '' : improved ? 'improved' : 'worse';
  const deltaText = delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}${t.unit}`;

  return `
    <div class="trend-row">
      <div class="trend-label">${escapeHtml(t.label)}<span class="trend-count">${t.points.length} sessions</span></div>
      ${sparkline(t.points)}
      <div class="trend-value">${last}${escapeHtml(t.unit)}<span class="trend-delta ${deltaClass}">${deltaText}</span></div>
    </div>
  `;
}

function sparkline(points: number[]): string {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const xy = points.map((p, i) => [
    pad + (i / (points.length - 1)) * (SPARK_W - pad * 2),
    SPARK_H - pad - ((p - min) / span) * (SPARK_H - pad * 2),
  ]);
  const [lx, ly] = xy[xy.length - 1];
  return `
    <svg class="sparkline" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">
      <polyline points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" />
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" />
    </svg>
  `;
}
