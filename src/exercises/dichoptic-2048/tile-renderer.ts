/**
 * Pre-renders canvas textures for all 2048 tile values.
 *
 * Only 11 unique values (2→2048), each rendered once at setup time.
 * The cache is shared across tile meshes — dispose via dispose(), not per-material.
 */

import * as THREE from 'three';

interface TileStyle {
  bg: string;
  text: string;
  fontSize: number;
}

// Warm nebula palette — darker for low values, gold/amber for high
const TILE_STYLES: Record<number, TileStyle> = {
  2:    { bg: '#3d3245', text: '#e0d6cc', fontSize: 72 },
  4:    { bg: '#4a3850', text: '#e0d6cc', fontSize: 72 },
  8:    { bg: '#7a5a3a', text: '#faf0e6', fontSize: 72 },
  16:   { bg: '#8c6030', text: '#faf0e6', fontSize: 64 },
  32:   { bg: '#a06828', text: '#faf0e6', fontSize: 64 },
  64:   { bg: '#b87020', text: '#faf0e6', fontSize: 64 },
  128:  { bg: '#c9935a', text: '#1a0f12', fontSize: 56 },
  256:  { bg: '#d4a04a', text: '#1a0f12', fontSize: 56 },
  512:  { bg: '#dbb040', text: '#1a0f12', fontSize: 56 },
  1024: { bg: '#dbb870', text: '#1a0f12', fontSize: 44 },
  2048: { bg: '#e8c84a', text: '#1a0f12', fontSize: 44 },
};

const TILE_TEX_SIZE = 256;
const TILE_BORDER_RADIUS = 20;

export class TileTextureCache {
  private cache = new Map<number, THREE.CanvasTexture>();

  /** Pre-render textures for all tile values. */
  prerender(): void {
    for (const valueStr of Object.keys(TILE_STYLES)) {
      const value = Number(valueStr);
      const style = TILE_STYLES[value];
      this.cache.set(value, this.renderTileTexture(value, style));
    }
  }

  /** Get the cached texture for a tile value. */
  get(value: number): THREE.CanvasTexture {
    let tex = this.cache.get(value);
    if (!tex) {
      // Fallback for values beyond 2048 (keep playing)
      const style = TILE_STYLES[2048] ?? TILE_STYLES[2];
      tex = this.renderTileTexture(value, style);
      this.cache.set(value, tex);
    }
    return tex;
  }

  /** Dispose all cached textures. */
  dispose(): void {
    for (const tex of this.cache.values()) tex.dispose();
    this.cache.clear();
  }

  private renderTileTexture(value: number, style: TileStyle): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_TEX_SIZE;
    canvas.height = TILE_TEX_SIZE;
    const ctx = canvas.getContext('2d')!;

    // Rounded rectangle background
    ctx.fillStyle = style.bg;
    ctx.beginPath();
    this.roundRect(ctx, 0, 0, TILE_TEX_SIZE, TILE_TEX_SIZE, TILE_BORDER_RADIUS);
    ctx.fill();

    // Number text
    ctx.fillStyle = style.text;
    ctx.font = `bold ${style.fontSize}px -apple-system, 'Helvetica Neue', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), TILE_TEX_SIZE / 2, TILE_TEX_SIZE / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
