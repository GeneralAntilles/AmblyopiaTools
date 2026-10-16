/**
 * Depth Scaffolding Stereopsis Trainer
 *
 * The VR-unique exercise that cannot exist on flat screens.
 *
 * Three colored objects float at different depths. The user identifies which
 * is closest. Initially, monocular depth cues (relative size, brightness)
 * are present alongside binocular disparity. As the user succeeds, monocular
 * cues are progressively stripped away until only stereo disparity remains.
 *
 * This bridges the gap between "no stereopsis" and "stereogram-ready" by
 * providing a scaffold the brain can lean on while learning to use binocular
 * disparity for depth judgment.
 *
 * Cue Levels:
 *   1. Full scaffolding: size + brightness + stereo
 *   2. Size removed: brightness + stereo
 *   3. Pure stereo: only binocular disparity
 *
 * Within each level, a 3-up/1-down staircase adjusts depth magnitude.
 * After 6 correct at a level, the next monocular cue is stripped.
 *
 * Controls:
 *   - Thumbstick left:  select left object
 *   - Thumbstick up:    select center object
 *   - Thumbstick right: select right object
 *   - Trigger:          confirm selection
 *   - A button:         "I can't tell" (counts as incorrect)
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextPanel, instructionText, feedbackText, resultsText } from '../../ui/text-panel';
import { COLORS, PANELS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

// --- Constants ---

const TOTAL_TRIALS = 30;

// Object positions (X spread)
const POSITIONS_X = [-0.35, 0, 0.35];
const BASE_Y = 1.5;
const BASE_Z = -2.0;
const OBJECT_RADIUS = 0.06;

// Object colors
const OBJECT_COLORS = [0xc9935a, 0x5ac98a, 0xc95a8a]; // Amber, Emerald, Rose

// Staircase parameters
const INITIAL_DEPTH_RANGE = 0.20;    // Starting depth offset in meters
const LEVEL_UP_DEPTH_RANGE = 0.15;   // Depth range when advancing a cue level
const MIN_DEPTH_RANGE = 0.005;       // 5mm — fine stereo acuity
const MAX_DEPTH_RANGE = 0.40;
const STEP_DOWN_FACTOR = 0.75;       // Multiply depth by this after 3 correct
const STEP_UP_FACTOR = 1.4;          // Multiply depth by this after 1 incorrect
const CORRECT_STREAK_TO_STEP = 3;    // 3-up staircase
const CORRECT_TO_ADVANCE_LEVEL = 4;  // Advance cue level after this many correct

// Cue level names
const CUE_LEVEL_NAMES = [
  'Full Scaffolding',    // Level 1: size + brightness + stereo
  'Size Removed',        // Level 2: brightness + stereo
  'Pure Stereo',         // Level 3: stereo only
];

// --- Types ---

interface Trial {
  closestIndex: number;       // Which position (0/1/2) is closest
  depths: number[];           // Z position for each object
  sizes: number[];            // Scale factor for each object
  brightnesses: number[];     // Brightness multiplier for each object
  depthRange: number;         // The depth offset used for this trial
  cueLevel: number;           // 0, 1, or 2
}

interface TrialResult {
  cueLevel: number;
  depthRange: number;
  selectedIndex: number;
  correctIndex: number;
  correct: boolean;
  reactionTimeMs: number;
}

// --- Exercise ---

const LEVEL_BANNER_MS = 2500;

export class DepthScaffoldingExercise extends BaseExercise {
  private objectMeshes: THREE.Mesh[] = [];
  private objectMaterials: THREE.MeshBasicMaterial[] = [];
  private selectorMesh!: THREE.Mesh;
  private selectorMaterial!: THREE.MeshBasicMaterial;
  private instructions!: TextPanel;
  private feedback!: TextPanel;
  private levelBanner!: TextPanel;

  // Staircase state
  private cueLevel = 0;
  private depthRange = INITIAL_DEPTH_RANGE;
  private correctStreak = 0;
  private correctAtLevel = 0;
  private finestDepthPerLevel: number[] = [Infinity, Infinity, Infinity];
  private maxCueLevel = 0;

  // Trial state
  private currentTrial: Trial | null = null;
  private trialIndex = 0;
  private results: TrialResult[] = [];
  private trialStartTime = 0;
  private selectedIndex = -1; // -1 = none, 0/1/2 = left/center/right
  private awaitingSelection = false;

  // Animation
  private rotationTime = 0;
  private objectTransitioning = false;
  private objectTransitionProgress = 0;

  protected setup(): void {
    this.addEnvironment();
    this.createObjects();
    this.createSelector();

    this.instructions = this.panel(PANELS.INSTRUCTION_WIDTH);
    this.instructions.position.set(0, CONTENT_Y + PANELS.INSTRUCTION_Y_OFFSET, BASE_Z);

    this.feedback = this.panel(PANELS.FEEDBACK_WIDTH);
    this.feedback.position.set(0, CONTENT_Y + PANELS.FEEDBACK_Y_OFFSET, BASE_Z);
    this.feedback.visible = false;

    this.levelBanner = this.panel(1.1);
    this.levelBanner.position.set(0, BASE_Y, BASE_Z + 0.1);
    this.levelBanner.visible = false;

    this.showLevelBanner(0);

    this.onInput((action) => {
      if (!this.awaitingSelection) return;
      switch (action) {
        case 'page-back':     // Thumbstick left
          this.selectObject(0);
          break;
        case 'chapter-prev':  // Thumbstick up
          this.selectObject(1);
          break;
        case 'page-forward':  // Thumbstick right
          this.selectObject(2);
          break;
        case 'select':        // Trigger = confirm
          if (this.selectedIndex >= 0) this.answer(this.selectedIndex);
          break;
        case 'button-a':      // "Can't tell"
          this.answer(-1);
          break;
      }
    });

    this.ctx.hud.setStatus('Depth — ←↑→ select, trigger confirm, grip pause');
  }

  protected onUpdate(dt: number): void {
    this.rotationTime += dt;

    // Gentle rotation on objects
    for (const mesh of this.objectMeshes) {
      if (mesh.visible) {
        mesh.rotation.y = this.rotationTime * 0.5;
        mesh.rotation.x = Math.sin(this.rotationTime * 0.3) * 0.1;
      }
    }

    // Pulse selector
    if (this.selectorMesh.visible) {
      const pulse = 0.7 + 0.3 * Math.sin(this.rotationTime * 5);
      this.selectorMaterial.opacity = pulse * 0.6;
    }

    // Smooth object scale-in
    if (this.objectTransitioning && this.currentTrial) {
      this.objectTransitionProgress = Math.min(1, this.objectTransitionProgress + dt * 4);
      const t = this.objectTransitionProgress;
      const eased = 1 - Math.pow(1 - t, 3); // Ease-out cubic

      for (let i = 0; i < 3; i++) {
        this.objectMeshes[i].scale.setScalar(this.currentTrial.sizes[i] * eased);
      }

      if (t >= 1) {
        this.objectTransitioning = false;
        this.trialStartTime = this.now();
        this.awaitingSelection = true;
      }
    }
  }

  getStats(): ExerciseStats {
    const byLevel = [0, 1, 2].map((level) => {
      const trials = this.results.filter((r) => r.cueLevel === level);
      const correct = trials.filter((r) => r.correct).length;
      return {
        level: level + 1,
        name: CUE_LEVEL_NAMES[level],
        trials: trials.length,
        accuracy: trials.length > 0 ? Math.round((correct / trials.length) * 100) : 0,
        finestDepthMm: this.finestDepthPerLevel[level] < Infinity
          ? Math.round(this.finestDepthPerLevel[level] * 1000 * 10) / 10
          : null,
      };
    });

    const totalCorrect = this.results.filter((r) => r.correct).length;
    const totalTrials = this.results.length || 1;

    return {
      trials: this.results.length,
      accuracy: Math.round((totalCorrect / totalTrials) * 100),
      maxCueLevel: this.maxCueLevel + 1,
      maxCueLevelName: CUE_LEVEL_NAMES[this.maxCueLevel],
      levelResults: byLevel,
    };
  }

  // --- Scene Setup ---

  private createObjects(): void {
    // Use icosahedron (gem-like) for visual interest
    const geo = new THREE.IcosahedronGeometry(OBJECT_RADIUS, 1);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: OBJECT_COLORS[i] });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.position.set(POSITIONS_X[i], BASE_Y, BASE_Z);
      mesh.visible = false;
      this.add(mesh);
      this.objectMeshes.push(mesh);
      this.objectMaterials.push(mat);
    }
    geo.dispose();
  }

  private createSelector(): void {
    const ringGeo = new THREE.RingGeometry(OBJECT_RADIUS * 1.6, OBJECT_RADIUS * 2.0, 32);
    this.selectorMaterial = new THREE.MeshBasicMaterial({
      color: 0xdbb870,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.selectorMesh = new THREE.Mesh(ringGeo, this.selectorMaterial);
    this.selectorMesh.visible = false;
    this.add(this.selectorMesh);
  }

  // --- Trial Generation ---

  private generateTrial(): Trial {
    // Pick which position is closest
    const closestIndex = Math.floor(Math.random() * 3);

    // Assign depths
    const depths = [BASE_Z, BASE_Z, BASE_Z];
    depths[closestIndex] = BASE_Z + this.depthRange; // Closer (less negative Z)

    // Pick a farthest one too (not the closest)
    const otherIndices = [0, 1, 2].filter((i) => i !== closestIndex);
    const farthestIndex = otherIndices[Math.floor(Math.random() * 2)];
    depths[farthestIndex] = BASE_Z - this.depthRange * 0.5; // Farther

    // Apply cue scaffolding
    const sizes = [1, 1, 1];
    const brightnesses = [1, 1, 1];

    for (let i = 0; i < 3; i++) {
      const relativeDepth = (depths[i] - BASE_Z) / this.depthRange;
      // relativeDepth: +1 = closest, 0 = base, -0.5 = farthest

      if (this.cueLevel === 0) {
        // Level 1: full cues — closer objects are bigger AND brighter
        sizes[i] = 1 + relativeDepth * 0.35;
        brightnesses[i] = 1 + relativeDepth * 0.35;
      } else if (this.cueLevel === 1) {
        // Level 2: size removed, brightness remains
        brightnesses[i] = 1 + relativeDepth * 0.35;
      }
      // Level 3 (cueLevel 2): no monocular cues — sizes and brightnesses stay at 1
    }

    return {
      closestIndex,
      depths,
      sizes,
      brightnesses,
      depthRange: this.depthRange,
      cueLevel: this.cueLevel,
    };
  }

  // --- Trial Flow ---

  private startNextTrial(): void {
    this.currentTrial = this.generateTrial();
    this.selectedIndex = -1;

    for (let i = 0; i < 3; i++) {
      const mesh = this.objectMeshes[i];
      mesh.position.set(POSITIONS_X[i], BASE_Y, this.currentTrial.depths[i]);
      mesh.scale.setScalar(this.currentTrial.sizes[i]);
      mesh.visible = true;
      mesh.rotation.set(0, 0, 0);

      // Apply brightness via color
      const baseColor = new THREE.Color(OBJECT_COLORS[i]);
      const b = this.currentTrial.brightnesses[i];
      this.objectMaterials[i].color.setRGB(
        Math.min(1, baseColor.r * b),
        Math.min(1, baseColor.g * b),
        Math.min(1, baseColor.b * b),
      );
    }

    this.selectorMesh.visible = false;

    // Start scale-in transition
    this.objectTransitioning = true;
    this.objectTransitionProgress = 0;
    this.awaitingSelection = false;

    this.renderInstructions();
  }

  private selectObject(index: number): void {
    this.ctx.input.haptic('tick');
    this.selectedIndex = index;

    // Move selector ring just in front of the selected object
    this.selectorMesh.position.set(POSITIONS_X[index], BASE_Y, this.currentTrial!.depths[index] + 0.01);
    this.selectorMesh.visible = true;
  }

  /** Record an answer. selected = -1 means "can't tell" (scored incorrect). */
  private answer(selected: number): void {
    if (!this.currentTrial) return;
    this.awaitingSelection = false;

    const correct = selected === this.currentTrial.closestIndex;
    this.results.push({
      cueLevel: this.currentTrial.cueLevel,
      depthRange: this.currentTrial.depthRange,
      selectedIndex: selected,
      correctIndex: this.currentTrial.closestIndex,
      correct,
      reactionTimeMs: this.now() - this.trialStartTime,
    });

    this.ctx.input.haptic(correct ? 'confirm' : 'error');
    this.updateStaircase(correct);

    this.feedback.setText(feedbackText(
      correct ? 'Correct' : 'Incorrect',
      correct ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE,
    ));
    this.feedback.visible = true;

    this.after(TIMING.FEEDBACK_MS, () => {
      this.feedback.visible = false;
      this.trialIndex++;
      if (this.trialIndex >= TOTAL_TRIALS) {
        this.finish();
      } else if (this.cueLevel < 2 && this.correctAtLevel >= CORRECT_TO_ADVANCE_LEVEL) {
        this.advanceCueLevel();
      } else {
        this.startNextTrial();
      }
    });
  }

  // --- Staircase ---

  private updateStaircase(correct: boolean): void {
    if (correct) {
      this.correctStreak++;
      this.correctAtLevel++;

      // Track finest depth at which user was correct
      if (this.depthRange < this.finestDepthPerLevel[this.cueLevel]) {
        this.finestDepthPerLevel[this.cueLevel] = this.depthRange;
      }

      // 3-up: after 3 consecutive correct, make it harder (smaller depth)
      if (this.correctStreak >= CORRECT_STREAK_TO_STEP) {
        this.depthRange = Math.max(MIN_DEPTH_RANGE, this.depthRange * STEP_DOWN_FACTOR);
        this.correctStreak = 0;
      }
    } else {
      this.correctStreak = 0;
      // 1-down: after 1 incorrect, make it easier (larger depth)
      this.depthRange = Math.min(MAX_DEPTH_RANGE, this.depthRange * STEP_UP_FACTOR);
    }
  }

  private advanceCueLevel(): void {
    this.cueLevel++;
    this.maxCueLevel = Math.max(this.maxCueLevel, this.cueLevel);
    this.correctAtLevel = 0;
    this.correctStreak = 0;
    this.depthRange = LEVEL_UP_DEPTH_RANGE;

    // Hide objects during banner
    for (const mesh of this.objectMeshes) mesh.visible = false;
    this.selectorMesh.visible = false;

    this.showLevelBanner(this.cueLevel);
  }

  private showLevelBanner(level: number): void {
    const details = [
      'Size + brightness cues active',
      'Size cue removed — brightness + stereo',
      'Pure stereo — only binocular disparity',
    ];

    this.levelBanner.setText(resultsText(
      [`Level ${level + 1}: ${CUE_LEVEL_NAMES[level]}`, details[level]],
      { width: 768, fontSize: 36, lineHeight: 1.6, align: 'center', paddingX: 40, paddingY: 40 },
    ));
    this.levelBanner.visible = true;

    this.after(LEVEL_BANNER_MS, () => {
      this.levelBanner.visible = false;
      this.startNextTrial();
    });
  }

  private finish(): void {
    for (const mesh of this.objectMeshes) mesh.visible = false;
    this.selectorMesh.visible = false;
    this.instructions.visible = false;

    const stats = this.getStats();
    const levelResults = stats.levelResults as Array<{
      level: number; name: string; trials: number; accuracy: number; finestDepthMm: number | null;
    }>;

    this.showResults([
      'Depth Scaffolding Complete',
      `Max level: ${stats.maxCueLevelName}`,
      `Overall accuracy: ${stats.accuracy}%`,
      '',
      ...levelResults
        .filter((l) => l.trials > 0)
        .map((l) => {
          const depth = l.finestDepthMm !== null ? ` (finest: ${l.finestDepthMm}mm)` : '';
          return `L${l.level} ${l.name}: ${l.accuracy}%${depth}`;
        }),
    ], { x: 0, y: BASE_Y - 0.4, z: BASE_Z + 0.1 });
  }

  private renderInstructions(): void {
    const depthMm = (this.depthRange * 1000).toFixed(1);
    this.instructions.setText(instructionText([
      'Which object is closest? ← left  ↑ center  → right',
      `Trigger = confirm   A = can't tell   ${CUE_LEVEL_NAMES[this.cueLevel]} (${depthMm}mm)   ${this.trialIndex + 1}/${TOTAL_TRIALS}`,
    ]));
  }
}
