/**
 * Canvas-based text-to-texture pipeline.
 *
 * Renders text onto a canvas, then uploads it as a Three.js texture.
 * Each call creates its own canvas so textures don't share image data.
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
  /** Background color (supports rgba for transparency) */
  background?: string;
  /** Horizontal padding in pixels */
  paddingX?: number;
  /** Vertical padding in pixels */
  paddingY?: number;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
  /** Border radius in pixels (0 = sharp corners) */
  borderRadius?: number;
  /** Border color */
  borderColor?: string;
  /** Border width in pixels */
  borderWidth?: number;
}

const DEFAULT_OPTIONS: Required<TextRenderOptions> = {
  text: '',
  width: 2048,
  height: 2048,
  fontSize: 48,
  lineHeight: 1.6,
  fontFamily: 'sans-serif',
  color: '#d4d4dc',
  background: '#12121c',
  paddingX: 80,
  paddingY: 80,
  align: 'left',
  borderRadius: 0,
  borderColor: '',
  borderWidth: 0,
};

/**
 * Create a fresh canvas + context pair at the given dimensions.
 */
function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/**
 * Draw a rounded rectangle path on the context.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
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
}

export class TextRenderer {
  /**
   * Render text to a Three.js CanvasTexture.
   * Each call creates its own canvas so the texture owns its pixel data.
   */
  renderToTexture(opts: TextRenderOptions): THREE.CanvasTexture {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    const { canvas, ctx } = createCanvas(o.width, o.height);

    // Background — rounded or flat
    if (o.borderRadius > 0) {
      ctx.clearRect(0, 0, o.width, o.height);
      drawRoundedRect(ctx, 0, 0, o.width, o.height, o.borderRadius);
      ctx.fillStyle = o.background;
      ctx.fill();
      if (o.borderColor && o.borderWidth > 0) {
        ctx.strokeStyle = o.borderColor;
        ctx.lineWidth = o.borderWidth;
        drawRoundedRect(
          ctx,
          o.borderWidth / 2, o.borderWidth / 2,
          o.width - o.borderWidth, o.height - o.borderWidth,
          o.borderRadius
        );
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, o.width, o.height);
      if (o.borderColor && o.borderWidth > 0) {
        ctx.strokeStyle = o.borderColor;
        ctx.lineWidth = o.borderWidth;
        ctx.strokeRect(
          o.borderWidth / 2, o.borderWidth / 2,
          o.width - o.borderWidth, o.height - o.borderWidth
        );
      }
    }

    // Font setup
    ctx.fillStyle = o.color;
    ctx.font = `${o.fontSize}px ${o.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = o.align;

    // Word-wrap and render
    const maxWidth = o.width - o.paddingX * 2;
    const lines = wordWrap(ctx, o.text, maxWidth);
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
      if (y + lineHeightPx > o.height - o.paddingY) break;
      ctx.fillText(line, x, y);
      y += lineHeightPx;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Render a fixation cross texture.
   */
  renderFixationCross(size = 2048, crossColor = '#444444', bgColor = '#12121c'): THREE.CanvasTexture {
    const { canvas, ctx } = createCanvas(size, size);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const armLength = size * 0.06;
    const thickness = size * 0.008;

    ctx.fillStyle = crossColor;
    ctx.fillRect(cx - armLength, cy - thickness, armLength * 2, thickness * 2);
    ctx.fillRect(cx - thickness, cy - armLength, thickness * 2, armLength * 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Render a low-contrast noise/pattern texture.
   */
  renderNoisePattern(size = 2048, contrast = 0.05): THREE.CanvasTexture {
    const { canvas, ctx } = createCanvas(size, size);

    ctx.fillStyle = '#12121c';
    ctx.fillRect(0, 0, size, size);

    const maxBrightness = Math.floor(255 * contrast);
    const dotSize = 4;

    for (let x = 0; x < size; x += dotSize) {
      for (let y = 0; y < size; y += dotSize) {
        const v = Math.floor(Math.random() * maxBrightness);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
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
}

/**
 * Word-wrap text to fit within a max pixel width.
 */
function wordWrap(
  ctx: CanvasRenderingContext2D,
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

/**
 * Paginate text by fitting lines to the available canvas area.
 * Returns pages of text where each page fills the rendering area
 * based on font size, line height, and canvas dimensions.
 */
export function paginateByFit(
  text: string,
  opts?: Partial<Omit<TextRenderOptions, 'text'>>
): string[] {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const { ctx } = createCanvas(o.width, o.height);
  ctx.font = `${o.fontSize}px ${o.fontFamily}`;

  const maxWidth = o.width - o.paddingX * 2;
  const lines = wordWrap(ctx, text, maxWidth);
  const lineHeightPx = o.fontSize * o.lineHeight;
  const availableHeight = o.height - o.paddingY * 2;
  const linesPerPage = Math.max(1, Math.floor(availableHeight / lineHeightPx));

  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    const pageLines = lines.slice(i, i + linesPerPage);
    // Trim leading/trailing blank lines from each page
    while (pageLines.length > 0 && pageLines[0] === '') pageLines.shift();
    while (pageLines.length > 0 && pageLines[pageLines.length - 1] === '') pageLines.pop();
    if (pageLines.length > 0) {
      pages.push(pageLines.join('\n'));
    }
  }

  return pages.length > 0 ? pages : [''];
}
