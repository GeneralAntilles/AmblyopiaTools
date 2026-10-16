/**
 * Floating text panel — a plane whose texture is re-rendered from text.
 *
 * The plane keeps a fixed width; its height follows the canvas aspect ratio
 * of whatever was last rendered, so text is never stretched and taller
 * content (results) just grows the panel.
 *
 * Owns its material and current texture. Add `panel.mesh` to the scene;
 * disposal happens through the normal object cleanup (geometry, material, map).
 */

import * as THREE from 'three';
import { TextRenderer, type TextRenderOptions } from '../utils/text-renderer';
import { COLORS, FONTS, CANVAS, PANELS } from './vr-constants';

const textRenderer = new TextRenderer();
const TRANSPARENT = 'rgba(0,0,0,0)';

export class TextPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly widthM: number;

  constructor(widthM: number) {
    this.widthM = widthM;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    // Unit-height plane, scaled to the rendered aspect in setTexture()
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, 1), material);
    this.mesh.scale.y = 0;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  setText(opts: TextRenderOptions): this {
    return this.setTexture(textRenderer.renderToTexture(opts));
  }

  /** Show an arbitrary canvas texture (e.g. a chart). Takes ownership of it. */
  setTexture(texture: THREE.CanvasTexture): this {
    const material = this.mesh.material;
    if (material.map && material.map !== texture) material.map.dispose();
    material.map = texture;
    material.needsUpdate = true;

    const image = texture.image as { width: number; height: number };
    this.mesh.scale.y = this.widthM * (image.height / image.width);
    return this;
  }
}

// --- Shared text styles -------------------------------------------------

/** Exercise instructions below the stimulus. One string per line. */
export function instructionText(lines: string[], color: string = COLORS.TEXT_INSTRUCTION): TextRenderOptions {
  const lineHeight = 1.5;
  const paddingY = 12;
  return {
    text: lines.join('\n'),
    width: CANVAS.INSTRUCTION_WIDTH,
    height: Math.max(CANVAS.INSTRUCTION_HEIGHT, Math.ceil(paddingY * 2 + lines.length * FONTS.INSTRUCTION * lineHeight)),
    fontSize: FONTS.INSTRUCTION,
    lineHeight,
    color,
    background: TRANSPARENT,
    align: 'center',
    paddingX: 30,
    paddingY,
  };
}

/** Brief per-trial feedback ("Fused", "Correct", ...). */
export function feedbackText(text: string, color: string, width: number = CANVAS.FEEDBACK_WIDTH): TextRenderOptions {
  return {
    text,
    width,
    height: CANVAS.FEEDBACK_HEIGHT,
    fontSize: FONTS.FEEDBACK,
    lineHeight: 1.0,
    color,
    background: TRANSPARENT,
    align: 'center',
    paddingX: 16,
    paddingY: 16,
  };
}

/** Bordered card for end-of-exercise results. Height fits the line count. */
export function resultsText(
  lines: string[],
  opts: {
    fontSize?: number;
    lineHeight?: number;
    align?: 'left' | 'center';
    width?: number;
    color?: string;
    paddingX?: number;
    paddingY?: number;
  } = {},
): TextRenderOptions {
  const fontSize = opts.fontSize ?? FONTS.RESULTS;
  const lineHeight = opts.lineHeight ?? 1.5;
  const paddingY = opts.paddingY ?? PANELS.RESULTS_PADDING_Y;
  return {
    text: lines.join('\n'),
    width: opts.width ?? CANVAS.RESULTS_WIDTH,
    height: Math.ceil(paddingY * 2 + lines.length * fontSize * lineHeight),
    fontSize,
    lineHeight,
    color: opts.color ?? COLORS.TEXT_PRIMARY,
    background: COLORS.PANEL_BG,
    align: opts.align ?? 'left',
    paddingX: opts.paddingX ?? PANELS.RESULTS_PADDING_X,
    paddingY,
    borderRadius: PANELS.RESULTS_BORDER_RADIUS,
    borderColor: COLORS.PANEL_BORDER,
    borderWidth: PANELS.RESULTS_BORDER_WIDTH,
  };
}
