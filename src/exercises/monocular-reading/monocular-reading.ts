/**
 * Reading Exercise (Monocular or Dichoptic)
 *
 * Renders paginated text to the training (amblyopic) eye.
 * The non-training (fellow) eye sees a configurable alternative:
 *   - blank: dark panel
 *   - fixation: fixation cross
 *   - pattern: low-contrast noise
 *   - dichoptic: same text at reduced contrast (evidence-based therapy)
 *
 * In dichoptic mode, both eyes see the reading text but the fellow eye's
 * contrast is reduced via the ContrastEngine. This forces binocular
 * cooperation rather than pure monocular occlusion.
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
import type { ContrastEngine } from '../../core/contrast-engine';
import { TextRenderer, paginateByFit } from '../../utils/text-renderer';
import { TextureCache } from '../../utils/texture-cache';
import { createEnvironmentSphere } from '../../ui/vr-environment';
import { COLORS } from '../../ui/vr-constants';

export interface BookChapterData {
  title: string;
  text: string;
}

export type NonTrainingDisplay = 'blank' | 'fixation' | 'pattern' | 'dichoptic';

export interface MonocularReadingSettings {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  nonTrainingDisplay: NonTrainingDisplay;
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
const PANEL_BORDER_W = 4;
const PANEL_RADIUS = 48;

// Parsed RGB values for color interpolation
const BG_RGB = { r: 0x16, g: 0x11, b: 0x1e };
const FG_RGB = { r: 0xe0, g: 0xd6, b: 0xcc };

export class MonocularReadingExercise extends BaseExercise {
  readonly name = 'Monocular Reading';
  readonly description = 'Read text with your training eye only. Strengthens amblyopic eye neural pathways.';
  readonly type = 'monocular' as const;

  private settings: MonocularReadingSettings;
  private contrastEngine: ContrastEngine | null = null;

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
  private contrastChangedCallback: ((contrast: number) => void) | null = null;

  constructor(settings?: Partial<MonocularReadingSettings>) {
    super();
    this.settings = { ...DEFAULT_READING_SETTINGS, ...settings };
    this.textRenderer = new TextRenderer();
    // Larger cache for dichoptic mode (2 textures per page)
    this.textureCache = new TextureCache(20);
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  setContrastChangedCallback(cb: (contrast: number) => void): void {
    this.contrastChangedCallback = cb;
  }

  get isDichoptic(): boolean {
    return this.settings.nonTrainingDisplay === 'dichoptic';
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;
    this.contrastEngine = config.contrast;

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
        case 'button-a':
          this.adjustContrast(-0.05);
          break;
        case 'button-b':
          this.adjustContrast(0.05);
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
    this.textMaterial?.map?.dispose();
    this.textMaterial?.dispose();
    this.pageIndicatorMesh?.geometry.dispose();
    this.pageIndicatorMaterial?.map?.dispose();
    this.pageIndicatorMaterial?.dispose();
    this.progressMesh?.geometry.dispose();
    this.progressMaterial?.map?.dispose();
    this.progressMaterial?.dispose();
    this.nonTrainingMesh?.geometry.dispose();
    this.nonTrainingMaterial?.map?.dispose();
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
    this.contrastEngine = null;
  }

  getSessionStats(): SessionStats {
    const contrast = this.contrastEngine?.getDominantContrast() ?? 0;
    return {
      exercise: this.isDichoptic ? 'dichoptic-reading' : 'monocular-reading',
      durationMs: this.getElapsedMs(),
      pagesRead: this.pagesRead,
      totalPages: this.pages.length,
      currentPage: this.currentPage + 1,
      chaptersRead: this.chaptersRead,
      totalChapters: this.chapters.length,
      currentChapter: this.currentChapter + 1,
      mode: this.settings.nonTrainingDisplay,
      fellowEyeContrast: this.isDichoptic ? Math.round(contrast * 100) : 0,
    };
  }

  // --- Environment ---

  private createEnvironment(): void {
    if (!this.renderer) return;

    const env = createEnvironmentSphere(this.renderer);
    this.envSphereMesh = env.mesh;
    this.envMaterial = env.material;
  }

  private createGlow(): void {
    if (!this.renderer) return;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, 'rgba(60, 40, 25, 0.15)');
    gradient.addColorStop(0.5, 'rgba(35, 22, 12, 0.07)');
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

  private onPageChanged(): void {
    this.renderCurrentPage();
    this.renderPageIndicator();
    this.renderProgressBar();
    // Dichoptic: non-training eye shows the same page text
    if (this.isDichoptic) {
      this.renderNonTrainingEye();
    }
  }

  private nextPage(): void {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      this.pagesRead++;
      this.onPageChanged();
    } else if (this.currentChapter < this.chapters.length - 1) {
      this.nextChapter();
    }
  }

  private prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.onPageChanged();
    } else if (this.currentChapter > 0) {
      this.currentChapter--;
      this.loadChapter(this.currentChapter);
      this.currentPage = Math.max(0, this.pages.length - 1);
      this.onPageChanged();
    }
  }

  private nextChapter(): void {
    if (this.currentChapter < this.chapters.length - 1) {
      this.chaptersRead++;
      this.loadChapter(this.currentChapter + 1);
      this.onPageChanged();
    }
  }

  private prevChapter(): void {
    if (this.currentChapter > 0) {
      this.loadChapter(this.currentChapter - 1);
      this.onPageChanged();
    }
  }

  /**
   * Adjust fellow eye contrast in-VR (A button = decrease, B button = increase).
   * Only applies in dichoptic mode.
   */
  private adjustContrast(delta: number): void {
    if (!this.isDichoptic || !this.contrastEngine) return;

    const current = this.contrastEngine.getDominantContrast();
    const next = Math.max(0, Math.min(1, current + delta));
    this.contrastEngine.setDominantContrast(next);

    // Clear cached non-training textures (contrast changed)
    this.textureCache.clear();

    // Re-render non-training eye with new contrast
    this.renderNonTrainingEye();

    // Notify main.ts to update HUD
    this.contrastChangedCallback?.(next);
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
        color: COLORS.TEXT_PRIMARY,
        background: COLORS.PANEL_BG,
        paddingX: 100,
        paddingY: 100,
        borderRadius: PANEL_RADIUS,
        borderColor: COLORS.PANEL_BORDER,
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
      case 'dichoptic': {
        // Same text as training eye, but at reduced contrast
        const contrast = this.contrastEngine?.getDominantContrast() ?? 0.2;
        const dimColor = lerpColor(BG_RGB, FG_RGB, contrast);

        const cacheKey = `nt-ch${this.currentChapter}-p${this.currentPage}-${this.settings.fontSize}-${this.settings.fontFamily}-c${Math.round(contrast * 100)}`;
        const cached = this.textureCache.get(cacheKey) as THREE.CanvasTexture | undefined;

        if (cached) {
          texture = cached;
        } else {
          texture = this.textRenderer.renderToTexture({
            text: this.pages[this.currentPage] ?? '',
            fontSize: this.settings.fontSize,
            lineHeight: this.settings.lineHeight,
            fontFamily: this.settings.fontFamily,
            color: dimColor,
            background: COLORS.PANEL_BG,
            paddingX: 100,
            paddingY: 100,
            borderRadius: PANEL_RADIUS,
            borderColor: COLORS.PANEL_BORDER,
            borderWidth: PANEL_BORDER_W,
          });
          this.textureCache.set(cacheKey, texture);
        }
        break;
      }
      case 'fixation':
        texture = this.textRenderer.renderFixationCross(2048, '#3a3a50', COLORS.PANEL_BG);
        break;
      case 'pattern':
        texture = this.textRenderer.renderNoisePattern();
        break;
      case 'blank':
      default:
        texture = this.textRenderer.renderToTexture({
          text: '',
          background: COLORS.PANEL_BG,
          borderRadius: PANEL_RADIUS,
          borderColor: COLORS.PANEL_BORDER,
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

    ctx.fillStyle = '#221a2c';
    this.roundRectFill(ctx, 0, 2, w, h - 4, (h - 4) / 2);

    const fillW = Math.max(h - 4, w * progress);
    ctx.fillStyle = '#7a5a30';
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
      color: '#6a5a70',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 10,
      paddingY: 10,
    });

    this.pageIndicatorMaterial.map = texture;
    this.pageIndicatorMaterial.needsUpdate = true;
  }

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

/**
 * Linearly interpolate between background and foreground RGB colors.
 * t=0 returns background (invisible text), t=1 returns foreground (full contrast).
 */
function lerpColor(
  bg: { r: number; g: number; b: number },
  fg: { r: number; g: number; b: number },
  t: number
): string {
  const r = Math.round(bg.r + t * (fg.r - bg.r));
  const g = Math.round(bg.g + t * (fg.g - bg.g));
  const b = Math.round(bg.b + t * (fg.b - bg.b));
  return `rgb(${r},${g},${b})`;
}
