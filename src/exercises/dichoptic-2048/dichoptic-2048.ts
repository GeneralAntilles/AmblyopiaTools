/**
 * Dichoptic 2048 Exercise
 *
 * The classic 2048 tile-merging puzzle, adapted for amblyopia therapy.
 * Both eyes see the board grid, score, and instructions. Only the
 * training (amblyopic) eye sees the numbered tiles — forcing the brain
 * to keep both eyes active to play the game.
 *
 * Controls:
 *   - Thumbstick left/right/up/down: slide tiles
 *   - A button: new game (after game over)
 *   - Grip: exit
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextPanel, instructionText, resultsText } from '../../ui/text-panel';
import { COLORS, PANELS, CONTENT_Y } from '../../ui/vr-constants';
import { Game2048, type Direction, type GameState } from './game-logic';
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

export class Dichoptic2048Exercise extends BaseExercise {
  private tileTextures = this.own(new TileTextureCache());
  private game = new Game2048();

  // Both eyes
  private scorePanel!: TextPanel;
  private gameOverPanel!: TextPanel;

  // Training eye only
  private tileMeshes: THREE.Mesh[] = [];
  private tileMaterials: THREE.MeshBasicMaterial[] = [];

  // Animation state
  private animPhase: 'idle' | 'slide' | 'spawn' = 'idle';
  private animProgress = 0;
  private spawnTileId: number = -1;

  protected setup(): void {
    this.game.reset();

    this.tileTextures.prerender();
    this.addEnvironment();
    this.createBoard();
    this.createTileMeshPool();

    this.scorePanel = this.panel(0.6);
    this.scorePanel.position.set(0, BOARD_Y + BOARD_SIZE / 2 + 0.08, BOARD_Z);

    this.panel(PANELS.INSTRUCTION_WIDTH)
      .setText(instructionText(['Flick stick to slide tiles — Grip to exit']))
      .position.set(0, BOARD_Y - BOARD_SIZE / 2 - 0.08, BOARD_Z);

    this.gameOverPanel = this.panel(0.7);
    this.gameOverPanel.position.set(0, BOARD_Y, BOARD_Z + 0.05);
    this.gameOverPanel.visible = false;

    this.syncTileMeshes();
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
      }

      if (direction) this.handleMove(direction);
    });

    this.ctx.hud.setStatus('2048 — flick to slide, A = new game, grip exit');
  }

  protected onUpdate(dt: number): void {
    if (this.animPhase === 'slide') {
      this.animProgress = Math.min(1, this.animProgress + dt / SLIDE_DURATION);
      const t = easeOutCubic(this.animProgress);
      this.renderTilesInterpolated(t);

      if (this.animProgress >= 1) {
        // Slide complete — start spawn animation
        this.animPhase = 'spawn';
        this.animProgress = 0;
        this.syncTileMeshes();
      }
      return;
    }

    if (this.animPhase === 'spawn') {
      this.animProgress = Math.min(1, this.animProgress + dt / SPAWN_DURATION);
      const scale = easeOutBack(this.animProgress);
      this.applySpawnScale(scale);

      if (this.animProgress >= 1) {
        this.animPhase = 'idle';
        this.syncTileMeshes();

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

  getStats(): ExerciseStats {
    const state = this.game.getState();
    return {
      score: state.score,
      highestTile: state.highestTile,
      moveCount: state.moveCount,
      won: state.won,
      gameOver: state.gameOver,
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
    const spawned = result.tiles.find((t) => t.isNew);
    this.spawnTileId = spawned?.id ?? -1;

    // Start slide animation
    this.animPhase = 'slide';
    this.animProgress = 0;

    this.renderScore();
  }

  private handleRestart(): void {
    this.game.reset();
    this.gameOverPanel.visible = false;
    this.animPhase = 'idle';
    this.syncTileMeshes();
    this.renderScore();
    this.ctx.input.haptic('confirm');
  }

  // --- Coordinate Mapping ---

  private cellToWorld(row: number, col: number): { x: number; y: number } {
    const boardLeft = -BOARD_SIZE / 2 + BOARD_PADDING;
    const boardTop = BOARD_Y + BOARD_SIZE / 2 - BOARD_PADDING;

    return {
      x: boardLeft + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
      y: boardTop - row * (CELL_SIZE + CELL_GAP) - CELL_SIZE / 2,
    };
  }

  // --- Tile Rendering ---

  private syncTileMeshes(): void {
    const tiles = this.game.getState().tiles;

    for (let i = 0; i < 16; i++) {
      this.tileMeshes[i].visible = false;
    }

    for (let i = 0; i < tiles.length && i < 16; i++) {
      const tile = tiles[i];
      const mesh = this.tileMeshes[i];
      const mat = this.tileMaterials[i];
      const pos = this.cellToWorld(tile.row, tile.col);

      mesh.position.set(pos.x, pos.y, BOARD_Z + TILE_Z_OFFSET);
      mesh.scale.set(1, 1, 1);
      mesh.visible = true;

      const tex = this.tileTextures.get(tile.value);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  }

  private renderTilesInterpolated(t: number): void {
    const tiles = this.game.getState().tiles;

    for (let i = 0; i < 16; i++) {
      this.tileMeshes[i].visible = false;
    }

    // Render non-new tiles with interpolation
    let meshIndex = 0;
    for (const tile of tiles) {
      if (tile.isNew || meshIndex >= 16) continue;

      const mesh = this.tileMeshes[meshIndex];
      const mat = this.tileMaterials[meshIndex];

      const from = this.cellToWorld(tile.prevRow, tile.prevCol);
      const to = this.cellToWorld(tile.row, tile.col);

      mesh.position.set(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        BOARD_Z + TILE_Z_OFFSET,
      );
      mesh.scale.set(1, 1, 1);
      mesh.visible = true;

      // Show pre-merge value during most of the animation
      const displayValue = tile.merged && t < 0.7 ? tile.value / 2 : tile.value;
      const tex = this.tileTextures.get(displayValue);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }

      meshIndex++;
    }
  }

  private applySpawnScale(scale: number): void {
    const tiles = this.game.getState().tiles;
    const spawnIndex = tiles.findIndex((t) => t.id === this.spawnTileId);
    if (spawnIndex < 0) return;

    // Find which mesh corresponds to the spawn tile in syncTileMeshes ordering
    // After syncTileMeshes, tiles[i] maps to tileMeshes[i]
    if (spawnIndex < 16) {
      this.tileMeshes[spawnIndex].scale.set(scale, scale, 1);
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

  private createTileMeshPool(): void {
    const geo = new THREE.PlaneGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95);

    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;
      mesh.position.set(0, 0, BOARD_Z + TILE_Z_OFFSET);
      this.add(mesh, 'training');
      this.tileMeshes.push(mesh);
      this.tileMaterials.push(mat);
    }
    geo.dispose();
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
