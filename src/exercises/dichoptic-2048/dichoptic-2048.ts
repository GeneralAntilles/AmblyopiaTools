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
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';
import { createEnvironmentSphere } from '../../ui/vr-environment';
import { COLORS, FONTS, PANELS, CONTENT_Y } from '../../ui/vr-constants';
import { Game2048, type Direction } from './game-logic';
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
  readonly name = 'Dichoptic 2048';
  readonly description = 'Play 2048 with tiles visible only to your training eye.';
  readonly type = 'dichoptic' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;
  private tileTextures: TileTextureCache;
  private game: Game2048;

  // Scene objects — Layer 0 (both eyes)
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private boardMesh: THREE.Mesh | null = null;
  private boardMaterial: THREE.MeshBasicMaterial | null = null;
  private scoreMesh: THREE.Mesh | null = null;
  private scoreMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private gameOverMesh: THREE.Mesh | null = null;
  private gameOverMaterial: THREE.MeshBasicMaterial | null = null;

  // Scene objects — Layer 1 (training eye only)
  private tileMeshes: THREE.Mesh[] = [];
  private tileMaterials: THREE.MeshBasicMaterial[] = [];

  // Animation state
  private animPhase: 'idle' | 'slide' | 'spawn' = 'idle';
  private animProgress = 0;
  private spawnTileId: number = -1;

  private exitCallback: (() => void) | null = null;

  constructor() {
    super();
    this.textRenderer = new TextRenderer();
    this.tileTextures = new TileTextureCache();
    this.game = new Game2048();
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;
    this.game.reset();

    this.tileTextures.prerender();
    this.createEnvironment();
    this.createBoard();
    this.createTileMeshPool();
    this.createScoreDisplay();
    this.createInstructions();
    this.createGameOverOverlay();

    this.syncTileMeshes();
    this.renderScore();

    this.unsubInput = this.input.onAction((action) => {
      if (this.animPhase !== 'idle') return;

      const state = this.game.getState();

      if (state.gameOver) {
        if (action === 'button-a') this.handleRestart();
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      let direction: Direction | null = null;
      switch (action) {
        case 'page-back':    direction = 'left';  break;
        case 'page-forward': direction = 'right'; break;
        case 'chapter-prev': direction = 'up';    break;
        case 'chapter-next': direction = 'down';  break;
        case 'exit':         this.exitCallback?.(); return;
      }

      if (direction) this.handleMove(direction);
    });

    this.markStarted();
  }

  update(dt: number): void {
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
          this.input?.haptic('confirm');
          this.showGameOver(state);
        } else if (state.gameOver) {
          this.showGameOver(state);
        }
      }
      return;
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.boardMesh) this.renderer.removeFromScene(this.boardMesh);
      if (this.scoreMesh) this.renderer.removeFromScene(this.scoreMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.gameOverMesh) this.renderer.removeFromScene(this.gameOverMesh);
      for (const mesh of this.tileMeshes) this.renderer.removeFromScene(mesh);
    }

    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.boardMesh?.geometry.dispose();
    this.boardMaterial?.map?.dispose();
    this.boardMaterial?.dispose();
    this.scoreMesh?.geometry.dispose();
    this.scoreMaterial?.map?.dispose();
    this.scoreMaterial?.dispose();
    this.instructionMesh?.geometry.dispose();
    this.instructionMaterial?.map?.dispose();
    this.instructionMaterial?.dispose();
    this.gameOverMesh?.geometry.dispose();
    this.gameOverMaterial?.map?.dispose();
    this.gameOverMaterial?.dispose();

    for (let i = 0; i < this.tileMeshes.length; i++) {
      this.tileMeshes[i].geometry.dispose();
      // Don't dispose tileMaterials[i].map — shared cache textures
      this.tileMaterials[i].dispose();
    }

    this.tileTextures.dispose();

    this.renderer = null;
    this.input = null;
  }

  getSessionStats(): SessionStats {
    const state = this.game.getState();
    return {
      exercise: 'dichoptic-2048',
      durationMs: this.getElapsedMs(),
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
      this.input?.haptic('error');
      return;
    }

    this.input?.haptic('tick');

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
    this.gameOverMesh!.visible = false;
    this.animPhase = 'idle';
    this.syncTileMeshes();
    this.renderScore();
    this.input?.haptic('confirm');
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

  private createEnvironment(): void {
    if (!this.renderer) return;
    const { mesh, material } = createEnvironmentSphere(this.renderer);
    this.envSphereMesh = mesh;
    this.envMaterial = material;
  }

  private createBoard(): void {
    if (!this.renderer) return;

    const tex = this.renderBoardTexture();
    this.boardMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });

    const geo = new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE);
    this.boardMesh = new THREE.Mesh(geo, this.boardMaterial);
    this.boardMesh.position.set(0, BOARD_Y, BOARD_Z);
    this.renderer.addToBothEyes(this.boardMesh);
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
    if (!this.renderer) return;

    const geo = new THREE.PlaneGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95);

    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;
      mesh.position.set(0, 0, BOARD_Z + TILE_Z_OFFSET);
      this.renderer.addToTrainingEye(mesh);
      this.tileMeshes.push(mesh);
      this.tileMaterials.push(mat);
    }
  }

  private createScoreDisplay(): void {
    if (!this.renderer) return;

    const geo = new THREE.PlaneGeometry(0.6, 0.10);
    this.scoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.scoreMesh = new THREE.Mesh(geo, this.scoreMaterial);
    this.scoreMesh.position.set(0, BOARD_Y + BOARD_SIZE / 2 + 0.08, BOARD_Z);
    this.renderer.addToBothEyes(this.scoreMesh);
  }

  private createInstructions(): void {
    if (!this.renderer) return;

    const geo = new THREE.PlaneGeometry(PANELS.INSTRUCTION_WIDTH, PANELS.INSTRUCTION_HEIGHT);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(geo, this.instructionMaterial);
    this.instructionMesh.position.set(0, BOARD_Y - BOARD_SIZE / 2 - 0.08, BOARD_Z);
    this.renderer.addToBothEyes(this.instructionMesh);

    const tex = this.textRenderer.renderToTexture({
      text: 'Flick stick to slide tiles — Grip to exit',
      width: 1024,
      height: 130,
      fontSize: FONTS.INSTRUCTION,
      lineHeight: 1.5,
      color: COLORS.TEXT_INSTRUCTION,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 12,
    });

    this.instructionMaterial.map = tex;
    this.instructionMaterial.needsUpdate = true;
  }

  private createGameOverOverlay(): void {
    if (!this.renderer) return;

    const geo = new THREE.PlaneGeometry(0.7, 0.5);
    this.gameOverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.gameOverMesh = new THREE.Mesh(geo, this.gameOverMaterial);
    this.gameOverMesh.position.set(0, BOARD_Y, BOARD_Z + 0.05);
    this.gameOverMesh.visible = false;
    this.renderer.addToBothEyes(this.gameOverMesh);
  }

  // --- UI Rendering ---

  private renderScore(): void {
    const state = this.game.getState();

    this.scoreMaterial!.map?.dispose();
    const tex = this.textRenderer.renderToTexture({
      text: `Score: ${state.score}`,
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

    this.scoreMaterial!.map = tex;
    this.scoreMaterial!.needsUpdate = true;
  }

  private showGameOver(state: import('./game-logic').GameState): void {
    const title = state.won ? 'You reached 2048!' : 'Game Over';
    const color = state.won ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE;

    const lines = [
      title,
      '',
      `Score: ${state.score}`,
      `Best Tile: ${state.highestTile}`,
      `Moves: ${state.moveCount}`,
      '',
      'A = New Game    Grip = Exit',
    ];

    this.gameOverMaterial!.map?.dispose();
    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 512,
      height: 384,
      fontSize: FONTS.RESULTS,
      lineHeight: 1.4,
      color,
      background: COLORS.PANEL_BG,
      paddingX: 40,
      paddingY: 36,
      borderRadius: PANELS.RESULTS_BORDER_RADIUS,
      borderColor: COLORS.PANEL_BORDER,
      borderWidth: PANELS.RESULTS_BORDER_WIDTH,
      align: 'center',
    });

    this.gameOverMaterial!.map = tex;
    this.gameOverMaterial!.needsUpdate = true;
    this.gameOverMesh!.visible = true;
  }
}
