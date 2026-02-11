/**
 * Pure 2048 game engine — no rendering dependencies.
 *
 * Standard 4×4 sliding tile puzzle. Slide in any cardinal direction:
 * equal adjacent tiles merge into their sum. New tile (90% 2, 10% 4)
 * spawns after each valid move. Game over when no moves remain.
 */

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface TileState {
  value: number;
  row: number;
  col: number;
  prevRow: number;
  prevCol: number;
  merged: boolean;   // created by merge this turn
  isNew: boolean;    // just spawned this turn
  id: number;        // unique tile ID for tracking
}

export interface MoveResult {
  moved: boolean;
  mergeScore: number;
  tiles: TileState[];
}

export interface GameState {
  tiles: TileState[];
  score: number;
  moveCount: number;
  highestTile: number;
  gameOver: boolean;
  won: boolean;
}

export class Game2048 {
  private grid: (TileState | null)[][] = [];
  private score = 0;
  private moveCount = 0;
  private nextId = 1;
  private _gameOver = false;
  private _won = false;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.grid = Array.from({ length: 4 }, () => Array(4).fill(null) as (TileState | null)[]);
    this.score = 0;
    this.moveCount = 0;
    this.nextId = 1;
    this._gameOver = false;
    this._won = false;
    this.spawnTile();
    this.spawnTile();
  }

  getState(): GameState {
    const tiles: TileState[] = [];
    let highestTile = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = this.grid[r][c];
        if (t) {
          tiles.push(t);
          if (t.value > highestTile) highestTile = t.value;
        }
      }
    }
    return {
      tiles,
      score: this.score,
      moveCount: this.moveCount,
      highestTile,
      gameOver: this._gameOver,
      won: this._won,
    };
  }

  move(direction: Direction): MoveResult {
    if (this._gameOver) return { moved: false, mergeScore: 0, tiles: [] };

    // Snapshot prev positions
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = this.grid[r][c];
        if (t) {
          t.prevRow = t.row;
          t.prevCol = t.col;
          t.merged = false;
          t.isNew = false;
        }
      }
    }

    let totalMergeScore = 0;
    let anyMoved = false;

    // Process 4 rows/columns depending on direction
    const lines = this.extractLines(direction);
    const processed: { line: (TileState | null)[]; mergeScore: number; moved: boolean }[] = [];

    for (const line of lines) {
      const result = this.slideLine(line);
      processed.push(result);
      totalMergeScore += result.mergeScore;
      if (result.moved) anyMoved = true;
    }

    if (!anyMoved) {
      return { moved: false, mergeScore: 0, tiles: this.getState().tiles };
    }

    // Write processed lines back to grid
    this.writeLines(direction, processed.map((p) => p.line));

    // Update positions on tile objects
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = this.grid[r][c];
        if (t) {
          t.row = r;
          t.col = c;
        }
      }
    }

    this.score += totalMergeScore;
    this.moveCount++;

    // Check win
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (this.grid[r][c]?.value === 2048) this._won = true;
      }
    }

    // Spawn new tile
    this.spawnTile();

    // Check game over
    if (!this.canMove()) {
      this._gameOver = true;
    }

    return { moved: true, mergeScore: totalMergeScore, tiles: this.getState().tiles };
  }

  // --- Internal ---

  private spawnTile(): void {
    const empty: [number, number][] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (!this.grid[r][c]) empty.push([r, c]);
      }
    }
    if (empty.length === 0) return;

    const [row, col] = empty[Math.floor(Math.random() * empty.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile: TileState = {
      value,
      row,
      col,
      prevRow: row,
      prevCol: col,
      merged: false,
      isNew: true,
      id: this.nextId++,
    };
    this.grid[row][col] = tile;
  }

  /**
   * Slide and merge a single line of 4 cells (oriented left-to-right).
   * Returns the processed line plus merge score.
   */
  private slideLine(line: (TileState | null)[]): {
    line: (TileState | null)[];
    mergeScore: number;
    moved: boolean;
  } {
    // Compact non-nulls to the left
    const compacted = line.filter((t): t is TileState => t !== null);

    // Merge adjacent equals (left-to-right)
    const merged: (TileState | null)[] = [];
    let mergeScore = 0;
    let i = 0;
    while (i < compacted.length) {
      if (i + 1 < compacted.length && compacted[i].value === compacted[i + 1].value) {
        // Merge: keep the left tile with doubled value
        const newValue = compacted[i].value * 2;
        const mergedTile: TileState = {
          ...compacted[i],
          value: newValue,
          merged: true,
          // prevRow/prevCol stay from the left tile
        };
        merged.push(mergedTile);
        mergeScore += newValue;
        i += 2; // skip the consumed right tile
      } else {
        merged.push(compacted[i]);
        i++;
      }
    }

    // Pad with nulls to length 4
    while (merged.length < 4) merged.push(null);

    // Check if anything actually moved
    let moved = false;
    for (let j = 0; j < 4; j++) {
      const orig = line[j];
      const now = merged[j];
      if (orig === null && now === null) continue;
      if (orig === null || now === null || orig.id !== now.id || now.merged) {
        moved = true;
        break;
      }
    }

    return { line: merged, mergeScore, moved };
  }

  /**
   * Extract 4 lines of 4 cells each, oriented left-to-right per direction.
   */
  private extractLines(direction: Direction): (TileState | null)[][] {
    const lines: (TileState | null)[][] = [];
    for (let i = 0; i < 4; i++) {
      const line: (TileState | null)[] = [];
      for (let j = 0; j < 4; j++) {
        const [r, c] = this.mapCell(direction, i, j);
        line.push(this.grid[r][c]);
      }
      lines.push(line);
    }
    return lines;
  }

  /**
   * Write 4 processed lines back to the grid.
   */
  private writeLines(direction: Direction, lines: (TileState | null)[][]): void {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const [r, c] = this.mapCell(direction, i, j);
        this.grid[r][c] = lines[i][j];
      }
    }
  }

  /**
   * Map (lineIndex, cellIndex) to (row, col) based on direction.
   * Lines are always oriented so that cells slide toward cellIndex=0.
   */
  private mapCell(direction: Direction, lineIndex: number, cellIndex: number): [number, number] {
    switch (direction) {
      case 'left':  return [lineIndex, cellIndex];
      case 'right': return [lineIndex, 3 - cellIndex];
      case 'up':    return [cellIndex, lineIndex];
      case 'down':  return [3 - cellIndex, lineIndex];
    }
  }

  private canMove(): boolean {
    // Any empty cell?
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (!this.grid[r][c]) return true;
      }
    }
    // Any adjacent equal pair?
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = this.grid[r][c]!.value;
        if (c < 3 && this.grid[r][c + 1]!.value === v) return true;
        if (r < 3 && this.grid[r + 1][c]!.value === v) return true;
      }
    }
    return false;
  }
}
