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
import { TextRenderer, paginateByFit } from '../../utils/text-renderer';
import { TextureCache } from '../../utils/texture-cache';

export interface BookChapterData {
  title: string;
  text: string;
}

export interface MonocularReadingSettings {
  text: string;
  fontSize: number;
  lineHeight: number;
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
  fontFamily: 'sans-serif',
  nonTrainingDisplay: 'blank',
};

// Visual constants
const PANEL_W = 1.7;
const PANEL_H = 1.5;
const PANEL_Y = 1.4;
const PANEL_Z = -2.0;
const PANEL_BG = '#111119';
const PANEL_BORDER = '#2a2a40';
const PANEL_BORDER_W = 4;
const PANEL_RADIUS = 48;
const TEXT_COLOR = '#d4d4dc';

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

  // Scene objects — training eye
  private textMesh: THREE.Mesh | null = null;
  private textMaterial: THREE.MeshBasicMaterial | null = null;
  private pageIndicatorMesh: THREE.Mesh | null = null;
  private pageIndicatorMaterial: THREE.MeshBasicMaterial | null = null;
  private progressMesh: THREE.Mesh | null = null;
  private progressMaterial: THREE.MeshBasicMaterial | null = null;

  // Scene objects — non-training eye
  private nonTrainingMesh: THREE.Mesh | null = null;
  private nonTrainingMaterial: THREE.MeshBasicMaterial | null = null;

  // Scene objects — shared (both eyes)
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private glowMesh: THREE.Mesh | null = null;
  private glowMaterial: THREE.MeshBasicMaterial | null = null;

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

    // --- Environment (both eyes) ---
    this.createEnvironment();

    // --- Glow behind text panel (training eye) ---
    this.createGlow();

    // --- Training eye content ---

    const planeGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    this.textMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.FrontSide,
    });
    this.textMesh = new THREE.Mesh(planeGeo, this.textMaterial);
    this.textMesh.position.set(0, PANEL_Y, PANEL_Z);
    this.renderer.addToTrainingEye(this.textMesh);

    // Progress bar below text panel
    const progressGeo = new THREE.PlaneGeometry(PANEL_W, 0.012);
    this.progressMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });
    this.progressMesh = new THREE.Mesh(progressGeo, this.progressMaterial);
    this.progressMesh.position.set(0, PANEL_Y - PANEL_H / 2 - 0.02, PANEL_Z);
    this.renderer.addToTrainingEye(this.progressMesh);

    // Page/chapter indicator below progress bar
    const indicatorGeo = new THREE.PlaneGeometry(1.4, 0.06);
    this.pageIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });
    this.pageIndicatorMesh = new THREE.Mesh(indicatorGeo, this.pageIndicatorMaterial);
    this.pageIndicatorMesh.position.set(0, PANEL_Y - PANEL_H / 2 - 0.06, PANEL_Z);
    this.renderer.addToTrainingEye(this.pageIndicatorMesh);

    // --- Non-training eye content ---

    this.nonTrainingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });
    const nonTrainingGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    this.nonTrainingMesh = new THREE.Mesh(nonTrainingGeo, this.nonTrainingMaterial);
    this.nonTrainingMesh.position.set(0, PANEL_Y, PANEL_Z);
    this.renderer.addToNonTrainingEye(this.nonTrainingMesh);

    // Render initial content
    this.renderCurrentPage();
    this.renderNonTrainingEye();
    this.renderPageIndicator();
    this.renderProgressBar();

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
      if (this.progressMesh) this.renderer.removeFromScene(this.progressMesh);
      if (this.nonTrainingMesh) this.renderer.removeFromScene(this.nonTrainingMesh);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.glowMesh) this.renderer.removeFromScene(this.glowMesh);
    }

    this.textMesh?.geometry.dispose();
    this.textMaterial?.dispose();
    this.pageIndicatorMesh?.geometry.dispose();
    this.pageIndicatorMaterial?.dispose();
    this.progressMesh?.geometry.dispose();
    this.progressMaterial?.dispose();
    this.nonTrainingMesh?.geometry.dispose();
    this.nonTrainingMaterial?.dispose();
    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.glowMesh?.geometry.dispose();
    this.glowMaterial?.map?.dispose();
    this.glowMaterial?.dispose();
    this.textureCache.clear();

    this.textMesh = null;
    this.textMaterial = null;
    this.pageIndicatorMesh = null;
    this.pageIndicatorMaterial = null;
    this.progressMesh = null;
    this.progressMaterial = null;
    this.nonTrainingMesh = null;
    this.nonTrainingMaterial = null;
    this.envSphereMesh = null;
    this.envMaterial = null;
    this.glowMesh = null;
    this.glowMaterial = null;
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
    };
  }

  // --- Environment ---

  private createEnvironment(): void {
    if (!this.renderer) return;

    // Gradient sky dome — subtle dark ambient, not pure black
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0.0, '#0e0e1c'); // overhead — slight blue glow
    gradient.addColorStop(0.35, '#0a0a14');
    gradient.addColorStop(0.7, '#060610');
    gradient.addColorStop(1.0, '#040408'); // floor level — very dark
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 512);

    const envTexture = new THREE.CanvasTexture(canvas);
    const sphereGeo = new THREE.SphereGeometry(40, 32, 16);
    this.envMaterial = new THREE.MeshBasicMaterial({
      map: envTexture,
      side: THREE.BackSide,
    });
    this.envSphereMesh = new THREE.Mesh(sphereGeo, this.envMaterial);
    this.renderer.addToBothEyes(this.envSphereMesh);
  }

  private createGlow(): void {
    if (!this.renderer) return;

    // Soft radial glow behind the reading panel
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, 'rgba(30, 45, 90, 0.12)');
    gradient.addColorStop(0.5, 'rgba(15, 25, 50, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    const glowTexture = new THREE.CanvasTexture(canvas);
    const glowGeo = new THREE.PlaneGeometry(PANEL_W * 1.8, PANEL_H * 1.8);
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, this.glowMaterial);
    this.glowMesh.position.set(0, PANEL_Y, PANEL_Z - 0.05);
    this.renderer.addToTrainingEye(this.glowMesh);
  }

  // --- Pagination ---

  private loadChapter(index: number): void {
    const chapter = this.chapters[index];
    if (!chapter) return;

    this.currentChapter = index;
    this.pages = paginateByFit(chapter.text, {
      fontSize: this.settings.fontSize,
      lineHeight: this.settings.lineHeight,
      fontFamily: this.settings.fontFamily,
      paddingX: 100,
      paddingY: 100,
    });
    this.currentPage = 0;
    this.textureCache.clear();
  }

  // --- Navigation ---

  private nextPage(): void {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      this.pagesRead++;
      this.renderCurrentPage();
      this.renderPageIndicator();
      this.renderProgressBar();
    } else if (this.currentChapter < this.chapters.length - 1) {
      this.nextChapter();
    }
  }

  private prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.renderCurrentPage();
      this.renderPageIndicator();
      this.renderProgressBar();
    } else if (this.currentChapter > 0) {
      this.currentChapter--;
      this.loadChapter(this.currentChapter);
      this.currentPage = Math.max(0, this.pages.length - 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
      this.renderProgressBar();
    }
  }

  private nextChapter(): void {
    if (this.currentChapter < this.chapters.length - 1) {
      this.chaptersRead++;
      this.loadChapter(this.currentChapter + 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
      this.renderProgressBar();
    }
  }

  private prevChapter(): void {
    if (this.currentChapter > 0) {
      this.loadChapter(this.currentChapter - 1);
      this.renderCurrentPage();
      this.renderPageIndicator();
      this.renderProgressBar();
    }
  }

  // --- Rendering ---

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
        color: TEXT_COLOR,
        background: PANEL_BG,
        paddingX: 100,
        paddingY: 100,
        borderRadius: PANEL_RADIUS,
        borderColor: PANEL_BORDER,
        borderWidth: PANEL_BORDER_W,
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
        texture = this.textRenderer.renderFixationCross(2048, '#3a3a50', PANEL_BG);
        break;
      case 'pattern':
        texture = this.textRenderer.renderNoisePattern();
        break;
      case 'blank':
      default:
        texture = this.textRenderer.renderToTexture({
          text: '',
          background: PANEL_BG,
          borderRadius: PANEL_RADIUS,
          borderColor: PANEL_BORDER,
          borderWidth: PANEL_BORDER_W,
        });
        break;
    }

    this.nonTrainingMaterial.map = texture;
    this.nonTrainingMaterial.needsUpdate = true;
  }

  private renderProgressBar(): void {
    if (!this.progressMaterial) return;

    const progress = this.pages.length > 1
      ? (this.currentPage) / (this.pages.length - 1)
      : 1;

    const w = 1024;
    const h = 16;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    // Track background
    ctx.fillStyle = '#1a1a2c';
    this.roundRectFill(ctx, 0, 2, w, h - 4, (h - 4) / 2);

    // Fill
    const fillW = Math.max(h - 4, w * progress);
    ctx.fillStyle = '#3060a0';
    this.roundRectFill(ctx, 0, 2, fillW, h - 4, (h - 4) / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.progressMaterial.map = texture;
    this.progressMaterial.needsUpdate = true;
  }

  private renderPageIndicator(): void {
    if (!this.pageIndicatorMaterial) return;

    const chapterTitle = this.chapters[this.currentChapter]?.title;
    const hasChapters = this.chapters.length > 1;

    let text = `Page ${this.currentPage + 1} of ${this.pages.length}`;
    if (hasChapters) {
      const label = chapterTitle || `Chapter ${this.currentChapter + 1}`;
      text = `${label}  \u00b7  Page ${this.currentPage + 1} of ${this.pages.length}`;
    }

    const texture = this.textRenderer.renderToTexture({
      text,
      width: 1024,
      height: 48,
      fontSize: 20,
      lineHeight: 1.0,
      color: '#5a5a70',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 10,
      paddingY: 10,
    });

    this.pageIndicatorMaterial.map = texture;
    this.pageIndicatorMaterial.needsUpdate = true;
  }

  // Canvas helper
  private roundRectFill(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number, r: number
  ): void {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }
}
