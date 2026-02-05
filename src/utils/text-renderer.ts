/**
 * Canvas-based text-to-texture pipeline.
 *
 * Renders text onto an offscreen canvas, then uploads it as a Three.js texture.
 * This is the standard approach for text in WebGL — avoids SDF/glyph complexity.
 */

import * as THREE from 'three';

export interface TextRenderOptions {
  /** Text to render */
  text: string;
  /** Canvas width in pixels */
  width?: number;
  /** Canvas height in pixels */
  height?: number;
  /** Font size in pixels */
  fontSize?: number;
  /** Line height multiplier */
  lineHeight?: number;
  /** Font family */
  fontFamily?: string;
  /** Text color */
  color?: string;
  /** Background color */
  background?: string;
  /** Horizontal padding in pixels */
  paddingX?: number;
  /** Vertical padding in pixels */
  paddingY?: number;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
}

const DEFAULT_OPTIONS: Required<TextRenderOptions> = {
  text: '',
  width: 2048,
  height: 2048,
  fontSize: 48,
  lineHeight: 1.6,
  fontFamily: 'sans-serif',
  color: '#e0e0e0',
  background: '#000000',
  paddingX: 80,
  paddingY: 80,
  align: 'left',
};

export class TextRenderer {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor() {
    // Use OffscreenCanvas if available (Quest Browser supports it)
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(DEFAULT_OPTIONS.width, DEFAULT_OPTIONS.height);
      this.ctx = this.canvas.getContext('2d')!;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = DEFAULT_OPTIONS.width;
      this.canvas.height = DEFAULT_OPTIONS.height;
      this.ctx = this.canvas.getContext('2d')!;
    }
  }

  /**
   * Render text to a Three.js CanvasTexture.
   */
  renderToTexture(opts: TextRenderOptions): THREE.CanvasTexture {
    const o = { ...DEFAULT_OPTIONS, ...opts };

    this.canvas.width = o.width;
    this.canvas.height = o.height;

    const ctx = this.ctx;

    // Background
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, o.width, o.height);

    // Font setup
    ctx.fillStyle = o.color;
    ctx.font = `${o.fontSize}px ${o.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = o.align;

    // Word-wrap and render
    const maxWidth = o.width - o.paddingX * 2;
    const lines = this.wordWrap(ctx, o.text, maxWidth);
    const lineHeightPx = o.fontSize * o.lineHeight;

    let x: number;
    switch (o.align) {
      case 'center':
        x = o.width / 2;
        break;
      case 'right':
        x = o.width - o.paddingX;
        break;
      default:
        x = o.paddingX;
    }

    let y = o.paddingY;
    for (const line of lines) {
      if (y + lineHeightPx > o.height - o.paddingY) break; // Don't overflow
      ctx.fillText(line, x, y);
      y += lineHeightPx;
    }

    // Create Three.js texture
    const texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Render a fixation cross texture.
   */
  renderFixationCross(size = 2048, crossColor = '#444444'): THREE.CanvasTexture {
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.ctx;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const armLength = size * 0.06;
    const thickness = size * 0.008;

    ctx.fillStyle = crossColor;
    // Horizontal
    ctx.fillRect(cx - armLength, cy - thickness, armLength * 2, thickness * 2);
    // Vertical
    ctx.fillRect(cx - thickness, cy - armLength, thickness * 2, armLength * 2);

    const texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Render a low-contrast noise/pattern texture.
   */
  renderNoisePattern(size = 2048, contrast = 0.05): THREE.CanvasTexture {
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.ctx;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // Draw random noise dots at low contrast
    const maxBrightness = Math.floor(255 * contrast);
    const dotSize = 4;

    for (let x = 0; x < size; x += dotSize) {
      for (let y = 0; y < size; y += dotSize) {
        const v = Math.floor(Math.random() * maxBrightness);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }

    const texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Calculate the number of lines that fit in a given canvas size.
   */
  getLinesPerPage(opts: Partial<TextRenderOptions>): number {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    const lineHeightPx = o.fontSize * o.lineHeight;
    const availableHeight = o.height - o.paddingY * 2;
    return Math.floor(availableHeight / lineHeightPx);
  }

  private wordWrap(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    const paragraphs = text.split('\n');
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        lines.push('');
        continue;
      }

      const words = paragraph.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines;
  }
}

/**
 * Paginate text into pages of approximately `wordsPerPage` words.
 * Tries to break at paragraph boundaries when possible.
 */
export function paginateText(text: string, wordsPerPage: number): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const pages: string[] = [];

  for (let i = 0; i < words.length; i += wordsPerPage) {
    const pageWords = words.slice(i, i + wordsPerPage);
    pages.push(pageWords.join(' '));
  }

  return pages;
}
