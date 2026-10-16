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
 *   - A/B: lower/raise fellow-eye contrast (dichoptic mode)
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextRenderer, paginateByFit } from '../../utils/text-renderer';
import { TextureCache } from '../../utils/texture-cache';
import { COLORS } from '../../ui/vr-constants';

export interface BookChapterData {
  title: string;
  text: string;
}

export type NonTrainingDisplay = 'blank' | 'fixation' | 'pattern' | 'dichoptic';

/** What to read. Comes from the launcher (pasted text or a loaded book). */
export interface ReadingSource {
  text?: string;
  /** Multi-chapter content. If provided, overrides `text`. */
  chapters?: BookChapterData[];
  /** Starting chapter index (default 0) */
  startChapter?: number;
}

const PLACEHOLDER_TEXT = 'No text provided. Please paste reading text on the launcher page.';

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
  private source: ReadingSource;
  private fontSize = 48;
  private lineHeight = 1.6;
  private fontFamily = 'sans-serif';
  private nonTrainingDisplay: NonTrainingDisplay = 'blank';

  // Chapter management
  private chapters: BookChapterData[] = [];
  private currentChapter = 0;

  // Page management for current chapter
  private pages: string[] = [];
  private currentPage = 0;
  private pagesRead = 0;
  private chaptersRead = 0;

  private textRenderer = new TextRenderer();
  // Room for two textures per page in dichoptic mode
  private textureCache = this.own(new TextureCache(20));

  // Training eye
  private textMaterial!: THREE.MeshBasicMaterial;
  private pageIndicatorMaterial!: THREE.MeshBasicMaterial;
  private progressMaterial!: THREE.MeshBasicMaterial;

  // Non-training eye
  private nonTrainingMaterial!: THREE.MeshBasicMaterial;

  constructor(source: ReadingSource = {}) {
    super();
    this.source = source;
  }

  get isDichoptic(): boolean {
    return this.nonTrainingDisplay === 'dichoptic';
  }

  protected setup(): void {
    const settings = this.ctx.settings;
    this.fontSize = settings.fontSize;
    this.lineHeight = settings.lineHeight;
    this.fontFamily = settings.fontFamily;
    this.nonTrainingDisplay = settings.nonTrainingDisplay;

    // Build chapter list
    this.chapters = this.source.chapters?.length
      ? this.source.chapters
      : [{ title: '', text: this.source.text || PLACEHOLDER_TEXT }];
    this.currentChapter = this.source.startChapter ?? 0;

    // Paginate first chapter
    this.loadChapter(this.currentChapter);

    this.addEnvironment();
    this.createGlow();

    // --- Training eye content ---

    this.textMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.FrontSide,
    });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), this.textMaterial), 'training')
      .position.set(0, PANEL_Y, PANEL_Z);

    // Progress bar below text panel
    this.progressMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, 0.012), this.progressMaterial), 'training')
      .position.set(0, PANEL_Y - PANEL_H / 2 - 0.02, PANEL_Z);

    // Page/chapter indicator below progress bar
    this.pageIndicatorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.06), this.pageIndicatorMaterial), 'training')
      .position.set(0, PANEL_Y - PANEL_H / 2 - 0.06, PANEL_Z);

    // --- Non-training eye content ---

    this.nonTrainingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), this.nonTrainingMaterial), 'fellow')
      .position.set(0, PANEL_Y, PANEL_Z);

    // Render initial content
    this.renderCurrentPage();
    this.renderNonTrainingEye();
    this.renderPageIndicator();
    this.renderProgressBar();

    this.onInput((action) => {
      switch (action) {
        case 'page-forward':
        case 'select':
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
      }
    });

    this.updateStatus();
  }

  protected onTeardown(): void {
    // Materials only point at cached page textures; the cache disposes them.
    this.textMaterial.map = null;
    this.nonTrainingMaterial.map = null;
  }

  getStats(): ExerciseStats {
    const contrast = this.ctx.contrast.getDominantContrast();
    return {
      pagesRead: this.pagesRead,
      totalPages: this.pages.length,
      currentPage: this.currentPage + 1,
      chaptersRead: this.chaptersRead,
      totalChapters: this.chapters.length,
      currentChapter: this.currentChapter + 1,
      mode: this.nonTrainingDisplay,
      fellowEyeContrast: this.isDichoptic ? Math.round(contrast * 100) : 0,
    };
  }

  private updateStatus(): void {
    let status: string;
    if (this.isDichoptic) {
      const pct = Math.round(this.ctx.contrast.getDominantContrast() * 100);
      status = `Dichoptic ${pct}% — A/B adjust, grip exit`;
    } else if (this.chapters.length > 1) {
      status = 'Reading — ↔ page, ↕ chapter, grip exit';
    } else {
      status = 'Reading — grip exit';
    }
    this.ctx.hud.setStatus(status);
  }

  // --- Environment ---

  private createGlow(): void {
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

    const material = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W * 1.8, PANEL_H * 1.8), material), 'training')
      .position.set(0, PANEL_Y, PANEL_Z - 0.05);
  }

  // --- Pagination ---

  private loadChapter(index: number): void {
    const chapter = this.chapters[index];
    if (!chapter) return;

    this.currentChapter = index;
    this.pages = paginateByFit(chapter.text, {
      fontSize: this.fontSize,
      lineHeight: this.lineHeight,
      fontFamily: this.fontFamily,
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
      this.ctx.input.haptic('tick');
      this.onPageChanged();
    } else if (this.currentChapter < this.chapters.length - 1) {
      this.nextChapter();
    }
  }

  private prevPage(): void {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.ctx.input.haptic('tick');
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
      this.ctx.input.haptic('light');
      this.loadChapter(this.currentChapter + 1);
      this.onPageChanged();
    }
  }

  private prevChapter(): void {
    if (this.currentChapter > 0) {
      this.ctx.input.haptic('light');
      this.loadChapter(this.currentChapter - 1);
      this.onPageChanged();
    }
  }

  /**
   * Adjust fellow eye contrast in-VR (A button = decrease, B button = increase).
   * Only applies in dichoptic mode.
   */
  private adjustContrast(delta: number): void {
    if (!this.isDichoptic) return;

    const contrast = this.ctx.contrast;
    contrast.setDominantContrast(Math.round((contrast.getDominantContrast() + delta) * 100) / 100);

    // Cached non-training textures carry the old contrast
    this.textureCache.clear();
    this.renderCurrentPage();
    this.renderNonTrainingEye();
    this.updateStatus();
  }

  // --- Rendering ---

  private renderCurrentPage(): void {
    const cacheKey = `ch${this.currentChapter}-p${this.currentPage}-${this.fontSize}-${this.fontFamily}`;

    let texture = this.textureCache.get(cacheKey);
    if (!texture) {
      texture = this.textRenderer.renderToTexture({
        text: this.pages[this.currentPage] ?? '',
        fontSize: this.fontSize,
        lineHeight: this.lineHeight,
        fontFamily: this.fontFamily,
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
    let texture: THREE.CanvasTexture;

    switch (this.nonTrainingDisplay) {
      case 'dichoptic': {
        // Same text as training eye, but at reduced contrast
        const contrast = this.ctx.contrast.getDominantContrast();
        const dimColor = lerpColor(BG_RGB, FG_RGB, contrast);

        const cacheKey = `nt-ch${this.currentChapter}-p${this.currentPage}-${this.fontSize}-${this.fontFamily}-c${Math.round(contrast * 100)}`;
        const cached = this.textureCache.get(cacheKey) as THREE.CanvasTexture | undefined;

        if (cached) {
          texture = cached;
        } else {
          texture = this.textRenderer.renderToTexture({
            text: this.pages[this.currentPage] ?? '',
            fontSize: this.fontSize,
            lineHeight: this.lineHeight,
            fontFamily: this.fontFamily,
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
    this.progressMaterial.map?.dispose();
    this.progressMaterial.map = texture;
    this.progressMaterial.needsUpdate = true;
  }

  private renderPageIndicator(): void {
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

    this.pageIndicatorMaterial.map?.dispose();
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
