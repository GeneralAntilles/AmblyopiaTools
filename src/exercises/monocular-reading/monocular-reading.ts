/**
 * Monocular Reading Exercise
 *
 * Renders paginated text to the training (amblyopic) eye only.
 * The non-training eye sees a configurable alternative:
 *   - blank (black)
 *   - fixation cross
 *   - low-contrast noise pattern
 *
 * Controls:
 *   - Trigger / thumbstick right: next page
 *   - Thumbstick left: previous page
 *   - Grip: exit exercise
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer, paginateText } from '../../utils/text-renderer';
import { TextureCache } from '../../utils/texture-cache';

export interface MonocularReadingSettings {
  text: string;
  fontSize: number;
  lineHeight: number;
  wordsPerPage: number;
  fontFamily: string;
  nonTrainingDisplay: 'blank' | 'fixation' | 'pattern';
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
  private pages: string[] = [];
  private currentPage: number = 0;
  private pagesRead: number = 0;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;

  private textRenderer: TextRenderer;
  private textureCache: TextureCache;

  // Three.js objects for the training eye scene
  private textMesh: THREE.Mesh | null = null;
  private textMaterial: THREE.MeshBasicMaterial | null = null;

  // Three.js objects for the non-training eye scene
  private nonTrainingMesh: THREE.Mesh | null = null;
  private nonTrainingMaterial: THREE.MeshBasicMaterial | null = null;

  // Page indicator mesh
  private pageIndicatorMesh: THREE.Mesh | null = null;
  private pageIndicatorMaterial: THREE.MeshBasicMaterial | null = null;

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

    // Paginate text
    this.pages = paginateText(this.settings.text, this.settings.wordsPerPage);
    this.currentPage = 0;
    this.pagesRead = 0;

    // Create text display quad in training eye scene
    const planeGeo = new THREE.PlaneGeometry(1.6, 1.6);

    this.textMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      side: THREE.FrontSide,
    });
    this.textMesh = new THREE.Mesh(planeGeo, this.textMaterial);
    this.textMesh.position.set(0, 1.4, -2.0);
    this.renderer.getTrainingScene().add(this.textMesh);

    // Page indicator below text
    const indicatorGeo = new THREE.PlaneGeometry(0.6, 0.08);
    this.pageIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
    });
    this.pageIndicatorMesh = new THREE.Mesh(indicatorGeo, this.pageIndicatorMaterial);
    this.pageIndicatorMesh.position.set(0, 0.5, -2.0);
    this.renderer.getTrainingScene().add(this.pageIndicatorMesh);

    // Non-training eye display
    this.nonTrainingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
    });
    const nonTrainingGeo = new THREE.PlaneGeometry(1.6, 1.6);
    this.nonTrainingMesh = new THREE.Mesh(nonTrainingGeo, this.nonTrainingMaterial);
    this.nonTrainingMesh.position.set(0, 1.4, -2.0);
    this.renderer.getNonTrainingScene().add(this.nonTrainingMesh);

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
        case 'exit':
          this.exitCallback?.();
          break;
      }
    });

    this.markStarted();
  }

  update(_dt: number): void {
    // Monocular reading is mostly static per page.
    // Input is event-driven. Nothing to update per-frame.
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      const trainingScene = this.renderer.getTrainingScene();
      const nonTrainingScene = this.renderer.getNonTrainingScene();

      if (this.textMesh) trainingScene.remove(this.textMesh);
      if (this.pageIndicatorMesh) trainingScene.remove(this.pageIndicatorMesh);
      if (this.nonTrainingMesh) nonTrainingScene.remove(this.nonTrainingMesh);
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
      wordsPerPage: this.settings.wordsPerPage,
      estimatedWordsRead: this.pagesRead * this.settings.wordsPerPage,
    };
  }

  getCurrentPage(): number {
    return this.currentPage;
  }

  getTotalPages(): number {
    return this.pages.length;
  }

  private nextPage(): void {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      this.pagesRead++;
      this.renderCurrentPage();
      this.renderPageIndicator();
    }
  }

  private prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.renderCurrentPage();
      this.renderPageIndicator();
    }
  }

  private renderCurrentPage(): void {
    if (!this.textMaterial) return;

    const cacheKey = `page-${this.currentPage}-${this.settings.fontSize}-${this.settings.fontFamily}`;

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
        texture = this.textRenderer.renderFixationCross();
        break;
      case 'pattern':
        texture = this.textRenderer.renderNoisePattern();
        break;
      case 'blank':
      default:
        // Just a black texture
        texture = this.textRenderer.renderToTexture({
          text: '',
          background: '#000000',
        });
        break;
    }

    this.nonTrainingMaterial.map = texture;
    this.nonTrainingMaterial.needsUpdate = true;
  }

  private renderPageIndicator(): void {
    if (!this.pageIndicatorMaterial) return;

    const text = `Page ${this.currentPage + 1} / ${this.pages.length}`;
    const texture = this.textRenderer.renderToTexture({
      text,
      width: 512,
      height: 64,
      fontSize: 28,
      lineHeight: 1.0,
      color: '#666666',
      background: '#0a0a0f',
      align: 'center',
      paddingX: 10,
      paddingY: 10,
    });

    this.pageIndicatorMaterial.map = texture;
    this.pageIndicatorMaterial.needsUpdate = true;
  }
}
