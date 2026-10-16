/**
 * Dichoptic 2048 Exercise
 *
 * The classic 2048 tile-merging puzzle, adapted for amblyopia therapy.
 * Both eyes see the board grid, score and instructions.
 *
 * Dichoptic mode (default): tiles are split between the eyes — about half
 * go to the training eye at full contrast, half to the fellow eye at the
 * current fellow-eye contrast. Seeing the whole board takes both eyes, and
 * the fellow eye's share is deliberately weaker (the Li et al. Tetris
 * design applied to 2048). A tile keeps its eye for its whole life.
 *
 * Training-eye-only mode: every tile goes to the training eye; the fellow
 * eye sees an empty grid. Equivalent to patching with a game.
 *
 * Controls:
 *   - Thumbstick left/right/up/down: slide tiles
 *   - A / B: lower / raise fellow-eye contrast (dichoptic, during play)
 *   - A button: new game (after game over)
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats, type EyeTarget } from '../base-exercise';
import { TextPanel, instructionText, resultsText } from '../../ui/text-panel';
import { COLORS, PANELS, CONTENT_Y } from '../../ui/vr-constants';
import { Game2048, type Direction, type GameState, type TileState } from './game-logic';
import { TileTextureCache } from './tile-renderer';

// --- Board geometry ---
const BOARD_SIZE = 1.0;          // 1m × 1m
const BOARD_Z = -2.0;
const BOARD_Y = CONTENT_Y;
const CELL_COUNT = 4;
const BOARD_PADDING = 0.04;      // padding inside board edges
const CELL_GAP = 0.02;
const CELL_SIZE = (BOARD_SIZE - BOARD_PADDING * 2 - CELL_GAP * (CELL_COUNT - 1)) / CELL_COUNT;
const TILE_Z_OFFSET = 0.01;      // 1cm forward of board — clean depth separation

// --- Animation ---
const SLIDE_DURATION = 0.12;     // seconds
const SPAWN_DURATION = 0.10;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const CONTRAST_STEP = 0.05;

/** Tile meshes for one eye. A board holds at most 16 tiles. */
class TilePool {
  readonly meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  used = 0;

  constructor(add: (mesh: THREE.Mesh) => void, opacity: number) {
    const geo = new THREE.PlaneGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        opacity,
      }));
      mesh.visible = false;
      add(mesh);
      this.meshes.push(mesh);
    }
    geo.dispose();
  }

  reset(): void {
    this.used = 0;
    for (const m of this.meshes) m.visible = false;
  }

  next(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    return this.meshes[this.used++];
  }

  setOpacity(opacity: number): void {
    for (const m of this.meshes) m.material.opacity = opacity;
  }

  /** Textures belong to the shared cache, not to the materials. */
  detachTextures(): void {
    for (const m of this.meshes) m.material.map = null;
  }
}

export class Dichoptic2048Exercise extends BaseExercise {
  private tileTextures = this.own(new TileTextureCache());
  private game = new Game2048();
  private dichoptic = true;

  private scorePanel!: TextPanel;
  private gameOverPanel!: TextPanel;

  private trainingTiles!: TilePool;
  private fellowTiles: TilePool | null = null;
  private meshByTileId = new Map<number, THREE.Mesh>();

  // Animation state
  private animPhase: 'idle' | 'slide' | 'spawn' = 'idle';
  private animProgress = 0;
  private spawnTileId = -1;

  protected setup(): void {
    this.dichoptic = this.ctx.settings.dichoptic2048;
    this.game.reset();

    this.tileTextures.prerender();
    this.addEnvironment();
    this.createBoard();

    const addTo = (eye: EyeTarget) => (mesh: THREE.Mesh) => {
      mesh.position.z = BOARD_Z + TILE_Z_OFFSET;
      this.add(mesh, eye);
    };
    this.trainingTiles = new TilePool(addTo('training'), 1);
    if (this.dichoptic) {
      this.fellowTiles = new TilePool(addTo('fellow'), this.ctx.contrast.getDominantContrast());
    }

    this.scorePanel = this.panel(0.6);
    this.scorePanel.position.set(0, BOARD_Y + BOARD_SIZE / 2 + 0.08, BOARD_Z);

    this.panel(PANELS.INSTRUCTION_WIDTH)
      .setText(instructionText([
        this.dichoptic
          ? 'Flick stick to slide tiles — A/B fellow-eye contrast — Grip to exit'
          : 'Flick stick to slide tiles — Grip to exit',
      ]))
      .position.set(0, BOARD_Y - BOARD_SIZE / 2 - 0.08, BOARD_Z);

    this.gameOverPanel = this.panel(0.7);
    this.gameOverPanel.position.set(0, BOARD_Y, BOARD_Z + 0.05);
    this.gameOverPanel.visible = false;

    this.placeTiles(null);
    this.renderScore();

    this.onInput((action) => {
      if (this.animPhase !== 'idle') return;

      if (this.game.getState().gameOver) {
        if (action === 'button-a') this.handleRestart();
        return;
      }

      let direction: Direction | null = null;
      switch (action) {
        case 'page-back':    direction = 'left';  break;
        case 'page-forward': direction = 'right'; break;
        case 'chapter-prev': direction = 'up';    break;
        case 'chapter-next': direction = 'down';  break;
        case 'button-a':     this.adjustContrast(-CONTRAST_STEP); break;
        case 'button-b':     this.adjustContrast(CONTRAST_STEP);  break;
      }

      if (direction) this.handleMove(direction);
    });

    this.updateStatus();
  }

  protected onUpdate(dt: number): void {
    if (this.animPhase === 'slide') {
      this.animProgress = Math.min(1, this.animProgress + dt / SLIDE_DURATION);
      this.placeTiles(easeOutCubic(this.animProgress));

      if (this.animProgress >= 1) {
        // Slide complete — start spawn animation
        this.animPhase = 'spawn';
        this.animProgress = 0;
        this.placeTiles(null);
      }
      return;
    }

    if (this.animPhase === 'spawn') {
      this.animProgress = Math.min(1, this.animProgress + dt / SPAWN_DURATION);
      const scale = easeOutBack(this.animProgress);
      this.meshByTileId.get(this.spawnTileId)?.scale.set(scale, scale, 1);

      if (this.animProgress >= 1) {
        this.animPhase = 'idle';
        this.placeTiles(null);

        // Check game state after animation
        const state = this.game.getState();
        if (state.won) {
          this.ctx.input.haptic('confirm');
          this.showGameOver(state);
        } else if (state.gameOver) {
          this.showGameOver(state);
        }
      }
    }
  }

  protected onTeardown(): void {
    this.trainingTiles.detachTextures();
    this.fellowTiles?.detachTextures();
  }

  getStats(): ExerciseStats {
    const state = this.game.getState();
    return {
      mode: this.dichoptic ? 'dichoptic' : 'training-eye',
      score: state.score,
      highestTile: state.highestTile,
      moveCount: state.moveCount,
      won: state.won,
      gameOver: state.gameOver,
      fellowEyeContrast: this.dichoptic ? Math.round(this.ctx.contrast.getDominantContrast() * 100) : 0,
    };
  }

  // --- Game Actions ---

  private handleMove(direction: Direction): void {
    const result = this.game.move(direction);

    if (!result.moved) {
      this.ctx.input.haptic('error');
      return;
    }

    this.ctx.input.haptic('tick');

    // Find the newly spawned tile for animation
    this.spawnTileId = result.tiles.find((t) => t.isNew)?.id ?? -1;

    this.animPhase = 'slide';
    this.animProgress = 0;

    this.renderScore();
  }

  private handleRestart(): void {
    this.game.reset();
    this.gameOverPanel.visible = false;
    this.animPhase = 'idle';
    this.placeTiles(null);
    this.renderScore();
    this.ctx.input.haptic('confirm');
  }

  private adjustContrast(delta: number): void {
    if (!this.fellowTiles) return;
    const contrast = this.ctx.contrast;
    contrast.setDominantContrast(Math.round((contrast.getDominantContrast() + delta) * 100) / 100);
    this.fellowTiles.setOpacity(contrast.getDominantContrast());
    this.ctx.input.haptic('tick');
    this.updateStatus();
  }

  private updateStatus(): void {
    if (this.dichoptic) {
      const pct = Math.round(this.ctx.contrast.getDominantContrast() * 100);
      this.ctx.hud.setStatus(`2048 · fellow eye ${pct}% — A/B adjust, grip exit`);
    } else {
      this.ctx.hud.setStatus('2048 — flick to slide, A = new game, grip exit');
    }
  }

  // --- Tile Rendering ---

  /** Which eye a tile is shown to. Stable for a tile's lifetime (merges keep the left tile's id). */
  private poolFor(tile: TileState): TilePool {
    return this.fellowTiles && tile.id % 2 === 0 ? this.fellowTiles : this.trainingTiles;
  }

  private cellToWorld(row: number, col: number): { x: number; y: number } {
    const boardLeft = -BOARD_SIZE / 2 + BOARD_PADDING;
    const boardTop = BOARD_Y + BOARD_SIZE / 2 - BOARD_PADDING;

    return {
      x: boardLeft + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
      y: boardTop - row * (CELL_SIZE + CELL_GAP) - CELL_SIZE / 2,
    };
  }

  /**
   * Lay out tile meshes. t = null places every tile at rest; otherwise
   * existing tiles slide from their previous cell (new spawns stay hidden).
   */
  private placeTiles(t: number | null): void {
    this.trainingTiles.reset();
    this.fellowTiles?.reset();
    this.meshByTileId.clear();

    for (const tile of this.game.getState().tiles) {
      if (t !== null && tile.isNew) continue;

      const mesh = this.poolFor(tile).next();
      const to = this.cellToWorld(tile.row, tile.col);
      if (t === null) {
        mesh.position.x = to.x;
        mesh.position.y = to.y;
      } else {
        const from = this.cellToWorld(tile.prevRow, tile.prevCol);
        mesh.position.x = from.x + (to.x - from.x) * t;
        mesh.position.y = from.y + (to.y - from.y) * t;
      }
      mesh.scale.set(1, 1, 1);
      mesh.visible = true;

      // Show pre-merge value during most of the slide
      const value = t !== null && tile.merged && t < 0.7 ? tile.value / 2 : tile.value;
      const tex = this.tileTextures.get(value);
      if (mesh.material.map !== tex) {
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      }

      this.meshByTileId.set(tile.id, mesh);
    }
  }

  // --- Scene Setup ---

  private createBoard(): void {
    const material = new THREE.MeshBasicMaterial({
      map: this.renderBoardTexture(),
      transparent: true,
      depthWrite: false,
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE), material);
    board.position.set(0, BOARD_Y, BOARD_Z);
    this.add(board, 'both');
  }

  private renderBoardTexture(): THREE.CanvasTexture {
    const SIZE = 512;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;

    // Board background
    const r = 16;
    ctx.fillStyle = COLORS.PANEL_BG;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(SIZE, 0, SIZE, SIZE, r);
    ctx.arcTo(SIZE, SIZE, 0, SIZE, r);
    ctx.arcTo(0, SIZE, 0, 0, r);
    ctx.arcTo(0, 0, SIZE, 0, r);
    ctx.closePath();
    ctx.fill();

    // Border
    ctx.strokeStyle = COLORS.PANEL_BORDER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r, 1.5);
    ctx.arcTo(SIZE - 1.5, 1.5, SIZE - 1.5, SIZE - 1.5, r);
    ctx.arcTo(SIZE - 1.5, SIZE - 1.5, 1.5, SIZE - 1.5, r);
    ctx.arcTo(1.5, SIZE - 1.5, 1.5, 1.5, r);
    ctx.arcTo(1.5, 1.5, SIZE - 1.5, 1.5, r);
    ctx.closePath();
    ctx.stroke();

    // Grid lines (thin dividers between cells, no filled wells)
    const padding = 20;
    const gap = 10;
    const cellPx = (SIZE - padding * 2 - gap * 3) / 4;

    ctx.strokeStyle = COLORS.PANEL_BORDER;
    ctx.lineWidth = 1.5;

    // Vertical lines
    for (let col = 1; col < 4; col++) {
      const x = padding + col * (cellPx + gap) - gap / 2;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, SIZE - padding);
      ctx.stroke();
    }

    // Horizontal lines
    for (let row = 1; row < 4; row++) {
      const y = padding + row * (cellPx + gap) - gap / 2;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(SIZE - padding, y);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  // --- UI Rendering ---

  private renderScore(): void {
    this.scorePanel.setText({
      text: `Score: ${this.game.getState().score}`,
      width: 512,
      height: 72,
      fontSize: 40,
      lineHeight: 1.0,
      color: COLORS.TEXT_PRIMARY,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 16,
      paddingY: 12,
    });
  }

  private showGameOver(state: GameState): void {
    const title = state.won ? 'You reached 2048!' : 'Game Over';

    const card = resultsText([
      title,
      '',
      `Score: ${state.score}`,
      `Best Tile: ${state.highestTile}`,
      `Moves: ${state.moveCount}`,
      '',
      'A = New Game    Grip = Exit',
    ], {
      width: 512,
      lineHeight: 1.4,
      align: 'center',
      color: state.won ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE,
      paddingX: 40,
      paddingY: 36,
    });

    this.gameOverPanel.setText(card);
    this.gameOverPanel.visible = true;
  }
}
