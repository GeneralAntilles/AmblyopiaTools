/**
 * 2D launcher page logic.
 *
 * Handles exercise selection, settings binding, file loading (EPUB/text),
 * and the "Enter VR" button.
 */

import type { SettingsStore, UserSettings } from '../core/settings-store';
import { loadEpub, type LoadedBook, type BookChapter } from '../utils/epub-loader';
import { EXERCISES, getExercise } from '../exercises/registry';
import type { LaunchOptions } from '../exercises/definition';
import { escapeHtml, formatDate, formatDuration } from '../utils/format';

const TYPE_LABELS: Record<string, string> = {
  monocular: 'Monocular',
  dichoptic: 'Dichoptic',
  binocular: 'Binocular',
  diagnostic: 'Diagnostic',
};

export class Launcher {
  private store: SettingsStore;
  private selectedExercise: string = 'monocular-reading';
  private onEnterVR: ((exerciseId: string) => void) | null = null;

  /** Loaded book data (EPUB or plain text file) */
  private loadedBook: LoadedBook | null = null;
  private selectedChapterIndex: number = 0;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  setEnterVRCallback(cb: (exerciseId: string) => void): void {
    this.onEnterVR = cb;
  }

  async init(): Promise<void> {
    const settings = await this.store.getSettings();
    this.selectedExercise = getExercise(settings.lastExercise) ? settings.lastExercise : EXERCISES[0].id;

    // Check for first-time user
    if (!settings.setupCompleted) {
      // Auto-detect existing users: if they have session history, skip wizard
      const history = await this.store.getSessionHistory(undefined, 1);
      if (history.length > 0) {
        await this.store.saveSettings({ setupCompleted: true, setupCompletedAt: Date.now() });
      } else {
        await this.showSetupWizard(settings);
      }
    }

    this.renderExerciseCards();
    this.bindSettings(settings);
    this.bindEnterVR();
    this.bindFileUpload();
    this.bindTherapySettings(settings);
    this.updateContrastProgress(settings.contrastDominant);

    // Load saved reading text
    const savedText = await this.store.getReadingText();
    if (savedText) {
      const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
      if (textarea) textarea.value = savedText;
    }

    // Render session history with recommendations
    await this.renderSessionHistory();
  }

  /** Refresh session history display (call after session ends too) */
  async renderSessionHistory(): Promise<void> {
    // Refresh contrast progress bar
    const settings = await this.store.getSettings();
    this.updateContrastProgress(settings.contrastDominant);

    // Add recommended badge to exercise cards
    const rec = this.getRecommendedExercise(settings);
    document.querySelectorAll('.exercise-card .recommended-badge').forEach((b) => b.remove());
    if (rec) {
      const card = document.querySelector(`.exercise-card[data-exercise="${rec}"]`);
      if (card) {
        const h3 = card.querySelector('h3');
        if (h3 && !h3.querySelector('.recommended-badge')) {
          h3.insertAdjacentHTML('beforeend', '<span class="recommended-badge">Recommended</span>');
        }
      }
    }

    const container = document.getElementById('session-history');
    if (!container) return;

    const records = await this.store.getSessionHistory(undefined, 20);

    if (records.length === 0) {
      container.innerHTML = '<p class="history-empty">No sessions recorded yet. Complete a VR exercise to see your history.</p>';
      return;
    }

    // Summary stats
    const totalSessions = records.length;
    const totalTimeMs = records.reduce((s, r) => s + r.durationMs, 0);
    const totalMinutes = Math.round(totalTimeMs / 60000);

    // Streak: count consecutive days with sessions (working backward from today)
    const sessionDays = new Set(records.map((r) => new Date(r.startTime).toDateString()));
    let streak = 0;
    const day = new Date();
    while (sessionDays.has(day.toDateString())) {
      streak++;
      day.setDate(day.getDate() - 1);
    }

    const statsHtml = `
      <div class="history-stats">
        <div class="history-stat">
          <div class="stat-value">${totalSessions}</div>
          <div class="stat-label">Sessions</div>
        </div>
        <div class="history-stat">
          <div class="stat-value">${totalMinutes}m</div>
          <div class="stat-label">Total Time</div>
        </div>
        <div class="history-stat">
          <div class="stat-value">${streak}</div>
          <div class="stat-label">Day Streak</div>
        </div>
      </div>
    `;

    const rowsHtml = records.map((r) => {
      const def = getExercise(r.exercise);
      const stats = r.stats ?? {};
      const name = def?.sessionName?.(stats) ?? def?.name ?? r.exercise;
      const dur = formatDuration(r.durationMs);
      const date = formatDate(r.startTime);
      const details = def?.historyDetail(stats).join(', ') ?? '';

      return `
        <div class="history-row">
          <div class="exercise-name">${escapeHtml(name)}${details ? `<span class="exercise-type">${escapeHtml(details)}</span>` : ''}</div>
          <div class="duration">${dur}</div>
          <div class="date">${date}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = statsHtml + rowsHtml;
  }

  private renderExerciseCards(): void {
    const container = document.getElementById('exercise-list');
    if (!container) return;

    container.innerHTML = EXERCISES.map(
      (ex) => `
      <div class="exercise-card ${ex.id === this.selectedExercise ? 'selected' : ''}" data-exercise="${ex.id}">
        <h3>${escapeHtml(ex.name)}</h3>
        <p>${escapeHtml(ex.description)}</p>
        <span class="tag ${ex.tag}">${TYPE_LABELS[ex.tag] ?? ex.tag}</span>
      </div>
    `
    ).join('');

    container.querySelectorAll('.exercise-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.exercise!;
        this.selectedExercise = id;
        this.store.saveSetting('lastExercise', id);

        container.querySelectorAll('.exercise-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');

        this.updateSettingsVisibility();
      });
    });

    this.updateSettingsVisibility();
  }

  /** Show only the selected exercise's settings section. */
  private updateSettingsVisibility(): void {
    const selected = getExercise(this.selectedExercise)?.settingsSection;
    for (const ex of EXERCISES) {
      if (!ex.settingsSection) continue;
      document.getElementById(ex.settingsSection)?.classList.toggle('hidden', ex.settingsSection !== selected);
    }
  }

  private bindFileUpload(): void {
    const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
    const uploadBtn = document.getElementById('file-upload-btn') as HTMLButtonElement | null;

    if (!fileInput || !uploadBtn) return;

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const fileInfo = document.getElementById('file-info')!;
      fileInfo.textContent = 'Loading...';

      try {
        if (file.name.endsWith('.epub')) {
          await this.loadEpubFile(file);
        } else {
          await this.loadTextFile(file);
        }
      } catch (err) {
        fileInfo.textContent = `Error: ${err instanceof Error ? err.message : 'Failed to load file'}`;
        console.error('File load error:', err);
      }

      // Reset input so the same file can be re-selected
      fileInput.value = '';
    });
  }

  private async loadEpubFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    const book = await loadEpub(arrayBuffer);

    this.loadedBook = book;
    this.selectedChapterIndex = 0;

    // Update UI
    const fileInfo = document.getElementById('file-info')!;
    fileInfo.innerHTML = `<span class="book-title">${escapeHtml(book.title)}</span> by ${escapeHtml(book.author)} &mdash; ${book.chapters.length} chapters`;

    // Populate chapter selector
    this.populateChapterSelect(book.chapters);

    // Load first chapter into textarea
    this.selectChapter(0);
  }

  private async loadTextFile(file: File): Promise<void> {
    const text = await file.text();

    this.loadedBook = {
      title: file.name.replace(/\.[^.]+$/, ''),
      author: '',
      chapters: [{ index: 0, title: file.name, href: '', text }],
    };
    this.selectedChapterIndex = 0;

    const fileInfo = document.getElementById('file-info')!;
    fileInfo.innerHTML = `<span class="book-title">${escapeHtml(file.name)}</span> &mdash; ${text.length.toLocaleString()} characters`;

    // Hide chapter nav for single-chapter text files
    const chapterNav = document.getElementById('chapter-nav');
    if (chapterNav) chapterNav.classList.add('hidden');

    const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = text;
      this.store.saveReadingText(text);
    }
  }

  private populateChapterSelect(chapters: BookChapter[]): void {
    const select = document.getElementById('chapter-select') as HTMLSelectElement | null;
    const chapterNav = document.getElementById('chapter-nav');
    if (!select || !chapterNav) return;

    if (chapters.length <= 1) {
      chapterNav.classList.add('hidden');
      return;
    }

    chapterNav.classList.remove('hidden');
    select.innerHTML = chapters
      .map((ch, i) => `<option value="${i}">${escapeHtml(ch.title)}</option>`)
      .join('');

    select.value = '0';
    select.addEventListener('change', () => {
      this.selectChapter(parseInt(select.value, 10));
    });
  }

  private selectChapter(index: number): void {
    if (!this.loadedBook) return;
    const chapter = this.loadedBook.chapters[index];
    if (!chapter) return;

    this.selectedChapterIndex = index;

    const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = chapter.text;
      this.store.saveReadingText(chapter.text);
    }

    const select = document.getElementById('chapter-select') as HTMLSelectElement | null;
    if (select) select.value = String(index);
  }

  private bindSettings(settings: UserSettings): void {
    this.bindSelect('training-eye', settings.trainingEye, (val) =>
      this.store.saveSetting('trainingEye', val as 'left' | 'right')
    );
    this.bindNumber('font-size', settings.fontSize, (val) =>
      this.store.saveSetting('fontSize', val)
    );
    this.bindNumber('line-height', settings.lineHeight, (val) =>
      this.store.saveSetting('lineHeight', val)
    );
    this.bindSelect('font-family', settings.fontFamily, (val) =>
      this.store.saveSetting('fontFamily', val)
    );
    this.bindSelect('non-training-display', settings.nonTrainingDisplay, (val) => {
      this.store.saveSetting('nonTrainingDisplay', val as 'blank' | 'fixation' | 'pattern' | 'dichoptic');
      this.updateContrastVisibility();
    });

    // Contrast slider for dichoptic mode
    this.bindContrastSlider(settings.contrastDominant);
    this.updateContrastVisibility();

    const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
    if (textarea) {
      let saveTimeout: number | undefined;
      textarea.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = window.setTimeout(() => {
          this.store.saveReadingText(textarea.value);
        }, 500);
      });
    }
  }

  private bindSelect(id: string, value: string, onChange: (val: string) => void): void {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
  }

  private bindNumber(id: string, value: number, onChange: (val: number) => void): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.value = String(value);
    el.addEventListener('change', () => {
      const num = parseFloat(el.value);
      if (!isNaN(num)) onChange(num);
    });
  }

  private bindContrastSlider(value: number): void {
    const slider = document.getElementById('contrast-dominant') as HTMLInputElement | null;
    const label = document.getElementById('contrast-dominant-value');
    if (!slider) return;

    const pct = Math.round(value * 100);
    slider.value = String(pct);
    if (label) label.textContent = `${pct}%`;

    slider.addEventListener('input', () => {
      const num = parseInt(slider.value, 10);
      if (label) label.textContent = `${num}%`;
      this.store.saveSetting('contrastDominant', num / 100);
    });
  }

  private updateContrastVisibility(): void {
    const contrastSection = document.getElementById('contrast-settings');
    const displaySelect = document.getElementById('non-training-display') as HTMLSelectElement | null;
    if (contrastSection && displaySelect) {
      contrastSection.style.display = displaySelect.value === 'dichoptic' ? 'grid' : 'none';
    }
  }

  private bindEnterVR(): void {
    const btn = document.getElementById('enter-vr-btn') as HTMLButtonElement | null;
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!this.onEnterVR) return;
      this.onEnterVR(this.selectedExercise);
    });
  }

  getSelectedExercise(): string {
    return this.selectedExercise;
  }

  /** Inputs for the selected exercise that come from the page rather than settings. */
  getLaunchOptions(): LaunchOptions {
    const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
    const chapters = this.loadedBook && this.loadedBook.chapters.length > 1
      ? this.loadedBook.chapters.map((ch) => ({ title: ch.title, text: ch.text }))
      : undefined;

    return {
      reading: {
        text: textarea?.value ?? '',
        chapters,
        startChapter: chapters ? this.selectedChapterIndex : undefined,
      },
    };
  }

  private bindTherapySettings(settings: UserSettings): void {
    // Auto-progression toggle
    const toggle = document.getElementById('auto-progression') as HTMLInputElement | null;
    if (toggle) {
      toggle.checked = settings.contrastProgressionEnabled;
      toggle.addEventListener('change', () => {
        this.store.saveSetting('contrastProgressionEnabled', toggle.checked);
      });
    }
  }

  private updateContrastProgress(contrast: number): void {
    const pct = Math.round(contrast * 100);
    const label = document.getElementById('contrast-current');
    const bar = document.getElementById('contrast-bar-fill');
    if (label) label.textContent = `${pct}%`;
    if (bar) bar.style.width = `${pct}%`;

    // Also update the contrast slider if visible
    const slider = document.getElementById('contrast-dominant') as HTMLInputElement | null;
    const sliderLabel = document.getElementById('contrast-dominant-value');
    if (slider) slider.value = String(pct);
    if (sliderLabel) sliderLabel.textContent = `${pct}%`;
  }

  private async showSetupWizard(settings: UserSettings): Promise<void> {
    const overlay = document.getElementById('setup-wizard');
    const card = document.getElementById('wizard-card');
    if (!overlay || !card) return;

    overlay.classList.remove('hidden');

    let selectedEye: 'left' | 'right' = settings.trainingEye;

    return new Promise<void>((resolve) => {
      const showStep1 = () => {
        card.innerHTML = `
          <h2>Welcome to OpenVisionTherapy</h2>
          <p>An open-source VR vision therapy platform for amblyopia. This app provides exercises
          that use your headset's stereoscopic display to train binocular vision.</p>
          <p style="color:var(--text-tertiary);font-size:12px;">Not a medical device. Use under guidance of a qualified practitioner.</p>
          <button class="wizard-btn wizard-btn-primary" id="wizard-next">Get Started</button>
        `;
        document.getElementById('wizard-next')!.addEventListener('click', showStep2);
      };

      const showStep2 = () => {
        card.innerHTML = `
          <h2>Which is your weaker eye?</h2>
          <p>Select your amblyopic (training) eye. This is the eye that exercises will target.
          If you're unsure, your eye doctor can tell you.</p>
          <div class="wizard-eye-btns">
            <button class="wizard-eye-btn ${selectedEye === 'left' ? 'selected' : ''}" data-eye="left">Left Eye</button>
            <button class="wizard-eye-btn ${selectedEye === 'right' ? 'selected' : ''}" data-eye="right">Right Eye</button>
          </div>
          <button class="wizard-btn wizard-btn-primary" id="wizard-next">Continue</button>
        `;

        card.querySelectorAll('.wizard-eye-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            selectedEye = (btn as HTMLElement).dataset.eye as 'left' | 'right';
            card.querySelectorAll('.wizard-eye-btn').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
          });
        });

        document.getElementById('wizard-next')!.addEventListener('click', showStep3);
      };

      const showStep3 = () => {
        card.innerHTML = `
          <h2>Ready to begin</h2>
          <p>We recommend running a <strong>Suppression Check</strong> first to establish your baseline.
          It takes about 2 minutes.</p>
          <button class="wizard-btn wizard-btn-primary" id="wizard-baseline">Run Suppression Check</button>
          <button class="wizard-btn wizard-btn-secondary" id="wizard-skip">Skip for Now</button>
        `;

        const finish = async (exercise?: string) => {
          await this.store.saveSettings({
            trainingEye: selectedEye,
            setupCompleted: true,
            setupCompletedAt: Date.now(),
          });
          if (exercise) {
            this.selectedExercise = exercise;
            await this.store.saveSetting('lastExercise', exercise);
          }
          overlay.classList.add('hidden');
          resolve();
        };

        document.getElementById('wizard-baseline')!.addEventListener('click', () => finish('suppression-check'));
        document.getElementById('wizard-skip')!.addEventListener('click', () => finish());
      };

      showStep1();
    });
  }

  /**
   * Simple exercise recommender based on session history.
   * Returns the exercise ID to recommend, or null.
   */
  private getRecommendedExercise(settings: UserSettings): string | null {
    const order = settings.exerciseOrder;
    if (!order || order.length === 0) return null;

    // Recommend next in the configured order (round-robin)
    const nextIndex = (settings.lastCompletedExerciseIndex + 1) % order.length;
    const exerciseId = order[nextIndex];

    return getExercise(exerciseId) ? exerciseId : null;
  }
}
