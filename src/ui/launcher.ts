/**
 * 2D launcher page logic.
 *
 * Handles exercise selection, settings binding, and the "Enter VR" button.
 * This runs in the normal browser context before WebXR is initiated.
 */

import type { SettingsStore, UserSettings } from '../core/settings-store';

export interface ExerciseDefinition {
  id: string;
  name: string;
  description: string;
  type: 'monocular' | 'dichoptic' | 'binocular' | 'diagnostic';
  available: boolean;
}

const EXERCISES: ExerciseDefinition[] = [
  {
    id: 'monocular-reading',
    name: 'Monocular Reading',
    description:
      'Read text with your training eye only. The non-training eye sees a blank screen, fixation cross, or pattern.',
    type: 'monocular',
    available: true,
  },
  {
    id: 'dichoptic-tetris',
    name: 'Dichoptic Tetris',
    description:
      'Play Tetris with falling pieces visible to the amblyopic eye and placed pieces to the dominant eye. Forces binocular cooperation.',
    type: 'dichoptic',
    available: false,
  },
  {
    id: 'dichoptic-movie',
    name: 'Dichoptic Movie Viewing',
    description:
      'Watch video with per-eye contrast masks. Passive dichoptic training during media consumption.',
    type: 'dichoptic',
    available: false,
  },
  {
    id: 'gabor-patches',
    name: 'Gabor Patch Training',
    description:
      'Identify Gabor patch orientations to improve contrast sensitivity. Adaptive difficulty.',
    type: 'monocular',
    available: false,
  },
  {
    id: 'stereogram-trainer',
    name: 'Random Dot Stereograms',
    description:
      'Identify hidden shapes visible only through binocular fusion. Trains stereopsis recovery.',
    type: 'binocular',
    available: false,
  },
  {
    id: 'suppression-check',
    name: 'Suppression Check',
    description:
      'Worth 4-dot style diagnostic. Detect binocular suppression before and after training.',
    type: 'diagnostic',
    available: false,
  },
];

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

  constructor(store: SettingsStore) {
    this.store = store;
  }

  setEnterVRCallback(cb: (exerciseId: string) => void): void {
    this.onEnterVR = cb;
  }

  async init(): Promise<void> {
    const settings = await this.store.getSettings();
    this.selectedExercise = settings.lastExercise || 'monocular-reading';

    this.renderExerciseCards();
    this.bindSettings(settings);
    this.bindEnterVR();

    // Load saved reading text
    const savedText = await this.store.getReadingText();
    if (savedText) {
      const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
      if (textarea) textarea.value = savedText;
    }
  }

  private renderExerciseCards(): void {
    const container = document.getElementById('exercise-list');
    if (!container) return;

    container.innerHTML = EXERCISES.map(
      (ex) => `
      <div class="exercise-card ${ex.id === this.selectedExercise ? 'selected' : ''} ${!ex.available ? 'disabled' : ''}"
           data-exercise="${ex.id}"
           ${!ex.available ? 'style="opacity: 0.5; cursor: not-allowed;"' : ''}>
        <h3>${ex.name}${!ex.available ? ' (Coming Soon)' : ''}</h3>
        <p>${ex.description}</p>
        <span class="tag ${ex.type}">${TYPE_LABELS[ex.type] ?? ex.type}</span>
      </div>
    `
    ).join('');

    // Click handlers
    container.querySelectorAll('.exercise-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.exercise;
        const exercise = EXERCISES.find((e) => e.id === id);
        if (!exercise?.available) return;

        this.selectedExercise = id!;
        this.store.saveSetting('lastExercise', id!);

        // Update selection UI
        container.querySelectorAll('.exercise-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');

        // Show/hide reading settings
        this.updateSettingsVisibility();
      });
    });

    this.updateSettingsVisibility();
  }

  private updateSettingsVisibility(): void {
    const readingSection = document.getElementById('reading-settings-section');
    if (readingSection) {
      readingSection.classList.toggle('hidden', this.selectedExercise !== 'monocular-reading');
    }
  }

  private bindSettings(settings: UserSettings): void {
    // Training eye
    this.bindSelect('training-eye', settings.trainingEye, (val) =>
      this.store.saveSetting('trainingEye', val as 'left' | 'right')
    );

    // Font size
    this.bindNumber('font-size', settings.fontSize, (val) =>
      this.store.saveSetting('fontSize', val)
    );

    // Line height
    this.bindNumber('line-height', settings.lineHeight, (val) =>
      this.store.saveSetting('lineHeight', val)
    );

    // Words per page
    this.bindNumber('words-per-page', settings.wordsPerPage, (val) =>
      this.store.saveSetting('wordsPerPage', val)
    );

    // Font family
    this.bindSelect('font-family', settings.fontFamily, (val) =>
      this.store.saveSetting('fontFamily', val)
    );

    // Non-training display
    this.bindSelect('non-training-display', settings.nonTrainingDisplay, (val) =>
      this.store.saveSetting('nonTrainingDisplay', val as 'blank' | 'fixation' | 'pattern')
    );

    // Reading text auto-save
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

  getReadingText(): string {
    const textarea = document.getElementById('reading-text') as HTMLTextAreaElement | null;
    return textarea?.value ?? '';
  }

  getCurrentSettings(): Record<string, unknown> {
    return {
      fontSize: parseFloat((document.getElementById('font-size') as HTMLInputElement)?.value ?? '48'),
      lineHeight: parseFloat((document.getElementById('line-height') as HTMLInputElement)?.value ?? '1.6'),
      wordsPerPage: parseInt((document.getElementById('words-per-page') as HTMLInputElement)?.value ?? '40', 10),
      fontFamily: (document.getElementById('font-family') as HTMLSelectElement)?.value ?? 'sans-serif',
      nonTrainingDisplay: (document.getElementById('non-training-display') as HTMLSelectElement)?.value ?? 'blank',
      trainingEye: (document.getElementById('training-eye') as HTMLSelectElement)?.value ?? 'right',
    };
  }
}
