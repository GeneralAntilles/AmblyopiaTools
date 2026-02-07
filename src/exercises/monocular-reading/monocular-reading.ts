/**
 * Monocular Reading Exercise
 *
 * Renders paginated text to the training (amblyopic) eye only.
 * The non-training eye sees a configurable alternative:
 *   - blank (dark panel)
 *   - fixation cross
 *   - low-contrast noise pattern
 *
 * Supports multi-chapter books (EPUB). In VR:
 *   - Thumbstick left/right or trigger: page back/forward
 *   - Thumbstick up/down: previous/next chapter
 *   - Grip: exit exercise
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer, paginateText } from '../../utils/text-renderer';
import { TextureCache } from '../../utils/texture-cache';

export interface BookChapterData {
  title: string;
  text: string;
}

export interface MonocularReadingSettings {
  text: string;
  fontSize: number;
  lineHeight: number;
  wordsPerPage: number;
  fontFamily: string;
  nonTrainingDisplay: 'blank' | 'fixation' | 'pattern';
  /** Optional multi-chapter content. If provided, overrides `text`. */
  chapters?: BookChapterData[];
  /** Starting chapter index (default 0) */
  startChapter?: number;
}

const DEFAULT_READING_SETTINGS: MonocularReadingSettings = {
  text: 'No text provided. Please paste reading text on the launcher page.',
  fontSize: 48,
  lineHeight: 1.6,
  wordsPerPage: 40,
  fontFamily: 'sans-serif',
  nonTrainingDisplay: 'blank',
};

export class MonocularReadingExercise extends BaseExercise {
  readonly name = 'Monocular Reading';
  readonly description = 'Read text with your training eye only. Strengthens amblyopic eye neural pathways.';
  readonly type = 'monocular' as const;

  private settings: MonocularReadingSettings;

  // Chapter management
  private chapters: BookChapterData[] = [];
  private currentChapter: number = 0;

  // Page management for current chapter
  private pages: string[] = [];
  private currentPage: number = 0;
  private pagesRead: number = 0;
  private chaptersRead: number = 0;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;

  private textRenderer: TextRenderer;
  private textureCache: TextureCache;

  // Three.js objects for the training eye
  private textMesh: THREE.Mesh | null = null;
  private textMaterial: THREE.MeshBasicMaterial | null = null;
  private pageIndicatorMesh: THREE.Mesh | null = null;
  private pageIndicatorMaterial: THREE.MeshBasicMaterial | null = null;

  // Three.js objects for the non-training eye
  private nonTrainingMesh: THREE.Mesh | null = null;
  private nonTrainingMaterial: THREE.MeshBasicMaterial | null = null;

  private exitCallback: (() => void) | null = null;

  constructor(settings?: Partial<MonocularReadingSettings>) {
    super();
    this.settings = { ...DEFAULT_READING_SETTINGS, ...settings };
    this.textRenderer = new TextRenderer();
    this.textureCache = new TextureCache(10);
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;

    // Build chapter list
    if (this.settings.chapters?.length) {
      this.chapters = this.settings.chapters;
    } else {
      this.chapters = [{ title: '', text: this.settings.text }];
    }
    this.currentChapter = this.settings.startChapter ?? 0;
    this.pagesRead = 0;
    this.chaptersRead = 0;

    // Paginate first chapter
    this.loadChapter(this.currentChapter);

    // --- Training eye content ---

    const planeGeo = new THREE.PlaneGeometry(1.6, 1.6);
    this.textMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.FrontSide,
    });
    this.textMesh = new THREE.Mesh(planeGeo, this.textMaterial);
    this.textMesh.position.set(0, 1.4, -2.0);
    this.renderer.addToTrainingEye(this.textMesh);

    // Page/chapter indicator below text
    const indicatorGeo = new THREE.PlaneGeometry(1.2, 0.08);
    this.pageIndicatorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pageIndicatorMesh = new THREE.Mesh(indicatorGeo, this.pageIndicatorMaterial);
    this.pageIndicatorMesh.position.set(0, 0.52, -2.0);
    this.renderer.addToTrainingEye(this.pageIndicatorMesh);

    // --- Non-training eye content ---

    this.nonTrainingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nonTrainingGeo = new THREE.PlaneGeometry(1.6, 1.6);
    this.nonTrainingMesh = new THREE.Mesh(nonTrainingGeo, this.nonTrainingMaterial);
    this.nonTrainingMesh.position.set(0, 1.4, -2.0);
    this.renderer.addToNonTrainingEye(this.nonTrainingMesh);

    // Render initial content
    this.renderCurrentPage();
    this.renderNonTrainingEye();
    this.renderPageIndicator();

    // Set up input
    this.unsubInput = this.input.onAction((action) => {
      switch (action) {
        case 'page-forward':
          this.nextPage();
          break;
        case 'page-back':
          this.prevPage();
          break;
        case 'chapter-next':
          this.nextChapter();
          break;
        case 'chapter-prev':
          this.prevChapter();
          break;
        case 'exit':
          this.exitCallback?.();
          break;
      }
    });

    this.markStarted();
  }

  update(_dt: number): void {
    // Static per page; input is event-driven.
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      if (this.textMesh) this.renderer.removeFromScene(this.textMesh);
      if (this.pageIndicatorMesh) this.renderer.removeFromScene(this.pageIndicatorMesh);
      if (this.nonTrainingMesh) this.renderer.removeFromScene(this.nonTrainingMesh);
    }

    this.textMesh?.geometry.dispose();
    this.textMaterial?.dispose();
    this.pageIndicatorMesh?.geometry.dispose();
    this.pageIndicatorMaterial?.dispose();
    this.nonTrainingMesh?.geometry.dispose();
    this.nonTrainingMaterial?.dispose();
    this.textureCache.clear();

    this.textMesh = null;
    this.textMaterial = null;
    this.pageIndicatorMesh = null;
    this.pageIndicatorMaterial = null;
    this.nonTrainingMesh = null;
    this.nonTrainingMaterial = null;
    this.renderer = null;
    this.input = null;
  }

  getSessionStats(): SessionStats {
    return {
      exercise: 'monocular-reading',
      durationMs: this.getElapsedMs(),
      pagesRead: this.pagesRead,
      totalPages: this.pages.length,
      currentPage: this.currentPage + 1,
      chaptersRead: this.chaptersRead,
      totalChapters: this.chapters.length,
      currentChapter: this.currentChapter + 1,
      wordsPerPage: this.settings.wordsPerPage,
      estimatedWordsRead: this.pagesRead * this.settings.wordsPerPage,
    };
  }

  private loadChapter(index: number): void {
    const chapter = this.chapters[index];
    if (!chapter) return;

    this.currentChapter = index;
    this.pages = paginateText(chapter.text, this.settings.wordsPerPage);
    this.currentPage = 0;
    this.textureCache.clear();
  }

  private nextPage(): void {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      this.pagesRead++;
      this.renderCurrentPage();
      this.renderPageIndicator();
    } else if (this.currentChapter < this.chapters.length - 1) {
      // Auto-advance to next chapter at end of pages
      this.nextChapter();
    }
  }

  private prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.renderCurrentPage();
      this.renderPageIndicator();
    } else if (this.currentChapter > 0) {
      // Go to end of previous chapter
      this.currentChapter--;
      this.loadChapter(this.currentChapter);
      this.currentPage = Math.max(0, this.pages.length - 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
    }
  }

  private nextChapter(): void {
    if (this.currentChapter < this.chapters.length - 1) {
      this.chaptersRead++;
      this.loadChapter(this.currentChapter + 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
    }
  }

  private prevChapter(): void {
    if (this.currentChapter > 0) {
      this.loadChapter(this.currentChapter - 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
    }
  }

  private renderCurrentPage(): void {
    if (!this.textMaterial) return;

    const cacheKey = `ch${this.currentChapter}-p${this.currentPage}-${this.settings.fontSize}-${this.settings.fontFamily}`;

    let texture = this.textureCache.get(cacheKey);
    if (!texture) {
      texture = this.textRenderer.renderToTexture({
        text: this.pages[this.currentPage] ?? '',
        fontSize: this.settings.fontSize,
        lineHeight: this.settings.lineHeight,
        fontFamily: this.settings.fontFamily,
        color: '#e0e0e0',
        background: '#0a0a0f',
      });
      this.textureCache.set(cacheKey, texture);
    }

    this.textMaterial.map = texture;
    this.textMaterial.needsUpdate = true;
  }

  private renderNonTrainingEye(): void {
    if (!this.nonTrainingMaterial) return;

    let texture: THREE.CanvasTexture;

    switch (this.settings.nonTrainingDisplay) {
      case 'fixation':
        texture = this.textRenderer.renderFixationCross(2048, '#444444', '#0a0a0f');
        break;
      case 'pattern':
        texture = this.textRenderer.renderNoisePattern();
        break;
      case 'blank':
      default:
        texture = this.textRenderer.renderToTexture({
          text: '',
          background: '#0a0a0f',
        });
        break;
    }

    this.nonTrainingMaterial.map = texture;
    this.nonTrainingMaterial.needsUpdate = true;
  }

  private renderPageIndicator(): void {
    if (!this.pageIndicatorMaterial) return;

    const chapterTitle = this.chapters[this.currentChapter]?.title;
    const hasChapters = this.chapters.length > 1;

    let text = `Page ${this.currentPage + 1} / ${this.pages.length}`;
    if (hasChapters) {
      const label = chapterTitle || `Chapter ${this.currentChapter + 1}`;
      text = `${label}  |  Page ${this.currentPage + 1} / ${this.pages.length}`;
    }

    const texture = this.textRenderer.renderToTexture({
      text,
      width: 1024,
      height: 64,
      fontSize: 24,
      lineHeight: 1.0,
      color: '#666666',
      background: '#0a0a0f',
      align: 'center',
      paddingX: 10,
      paddingY: 12,
    });

    this.pageIndicatorMaterial.map = texture;
    this.pageIndicatorMaterial.needsUpdate = true;
  }
}
