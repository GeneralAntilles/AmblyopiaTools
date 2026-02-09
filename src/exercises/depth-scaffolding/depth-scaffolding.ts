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
 *   - Grip:             exit
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';
import { createEnvironmentSphere } from '../../ui/vr-environment';
import { COLORS, FONTS, PANELS, CANVAS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

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

export class DepthScaffoldingExercise extends BaseExercise {
  readonly name = 'Depth Scaffolding';
  readonly description = 'Stereopsis trainer with progressive monocular cue removal. VR-unique.';
  readonly type = 'binocular' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private objectMeshes: THREE.Mesh[] = [];
  private objectMaterials: THREE.MeshBasicMaterial[] = [];
  private selectorMesh: THREE.Mesh | null = null;
  private selectorMaterial: THREE.MeshBasicMaterial | null = null;
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;
  private levelBannerMesh: THREE.Mesh | null = null;
  private levelBannerMaterial: THREE.MeshBasicMaterial | null = null;

  // Staircase state
  private cueLevel: number = 0;
  private depthRange: number = INITIAL_DEPTH_RANGE;
  private correctStreak: number = 0;
  private correctAtLevel: number = 0;
  private finestDepthPerLevel: number[] = [Infinity, Infinity, Infinity];
  private maxCueLevel: number = 0;
  private startingCueLevel: number = 0;

  // Trial state
  private currentTrial: Trial | null = null;
  private trialIndex: number = 0;
  private results: TrialResult[] = [];
  private trialStartTime: number = 0;
  private selectedIndex: number = -1; // -1 = none, 0/1/2 = left/center/right
  private awaitingSelection: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private showingLevelBanner: boolean = false;
  private levelBannerTimeout: number = 0;
  private completed: boolean = false;

  // Animation
  private rotationTime: number = 0;
  private objectTransitioning: boolean = false;
  private objectTransitionProgress: number = 0;

  private exitCallback: (() => void) | null = null;

  constructor() {
    super();
    this.textRenderer = new TextRenderer();
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  setStartingCueLevel(level: number): void {
    this.startingCueLevel = Math.max(0, Math.min(2, level));
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;
    this.results = [];
    this.trialIndex = 0;
    this.cueLevel = this.startingCueLevel;
    this.depthRange = INITIAL_DEPTH_RANGE;
    this.correctStreak = 0;
    this.correctAtLevel = 0;
    this.finestDepthPerLevel = [Infinity, Infinity, Infinity];
    this.maxCueLevel = this.startingCueLevel;

    this.createEnvironment();
    this.createObjects();
    this.createSelector();
    this.createUI();

    // Show level 1 banner, then start
    this.showLevelBanner(0);

    this.unsubInput = this.input.onAction((action) => {
      if (this.completed) {
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      if (this.awaitingSelection) {
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
            this.confirmSelection();
            break;
          case 'button-a':      // "Can't tell"
            this.confirmCantTell();
            break;
        }
      }

      if (action === 'exit') {
        this.exitCallback?.();
      }
    });

    this.markStarted();
  }

  update(dt: number): void {
    this.rotationTime += dt;

    // Gentle rotation on objects
    for (const mesh of this.objectMeshes) {
      if (mesh.visible) {
        mesh.rotation.y = this.rotationTime * 0.5;
        mesh.rotation.x = Math.sin(this.rotationTime * 0.3) * 0.1;
      }
    }

    // Pulse selector
    if (this.selectorMesh?.visible) {
      const pulse = 0.7 + 0.3 * Math.sin(this.rotationTime * 5);
      this.selectorMaterial!.opacity = pulse * 0.6;
    }

    // Smooth object scale-in
    if (this.objectTransitioning) {
      this.objectTransitionProgress = Math.min(1, this.objectTransitionProgress + dt * 4);
      const t = this.objectTransitionProgress;
      const eased = 1 - Math.pow(1 - t, 3); // Ease-out cubic

      for (let i = 0; i < 3; i++) {
        if (this.currentTrial) {
          this.objectMeshes[i].scale.setScalar(this.currentTrial.sizes[i] * eased);
        }
      }

      if (t >= 1) {
        this.objectTransitioning = false;
        this.trialStartTime = Date.now();
        this.awaitingSelection = true;
      }
    }

    // Level banner timeout
    if (this.showingLevelBanner && Date.now() > this.levelBannerTimeout) {
      this.showingLevelBanner = false;
      this.levelBannerMesh!.visible = false;
      this.startNextTrial();
    }

    // Feedback timeout
    if (this.showingFeedback && Date.now() > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;

      this.trialIndex++;
      if (this.trialIndex >= TOTAL_TRIALS) {
        this.showResults();
      } else if (this.shouldAdvanceLevel()) {
        this.advanceCueLevel();
      } else {
        this.startNextTrial();
      }
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      for (const m of this.objectMeshes) this.renderer.removeFromScene(m);
      if (this.selectorMesh) this.renderer.removeFromScene(this.selectorMesh);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
      if (this.levelBannerMesh) this.renderer.removeFromScene(this.levelBannerMesh);
    }

    for (let i = 0; i < this.objectMeshes.length; i++) {
      this.objectMeshes[i].geometry.dispose();
      this.objectMaterials[i].dispose();
    }
    this.selectorMesh?.geometry.dispose();
    this.selectorMaterial?.dispose();
    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.instructionMesh?.geometry.dispose();
    this.instructionMaterial?.map?.dispose();
    this.instructionMaterial?.dispose();
    this.feedbackMesh?.geometry.dispose();
    this.feedbackMaterial?.map?.dispose();
    this.feedbackMaterial?.dispose();
    this.levelBannerMesh?.geometry.dispose();
    this.levelBannerMaterial?.map?.dispose();
    this.levelBannerMaterial?.dispose();

    this.renderer = null;
    this.input = null;
  }

  getSessionStats(): SessionStats {
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
      exercise: 'depth-scaffolding',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      accuracy: Math.round((totalCorrect / totalTrials) * 100),
      maxCueLevel: this.maxCueLevel + 1,
      maxCueLevelName: CUE_LEVEL_NAMES[this.maxCueLevel],
      levelResults: byLevel,
    };
  }

  // --- Scene Setup ---

  private createEnvironment(): void {
    if (!this.renderer) return;
    const { mesh, material } = createEnvironmentSphere(this.renderer);
    this.envSphereMesh = mesh;
    this.envMaterial = material;
  }

  private createObjects(): void {
    if (!this.renderer) return;

    // Use icosahedron (gem-like) for visual interest
    const geo = new THREE.IcosahedronGeometry(OBJECT_RADIUS, 1);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: OBJECT_COLORS[i] });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.position.set(POSITIONS_X[i], BASE_Y, BASE_Z);
      mesh.visible = false;
      this.renderer.addToBothEyes(mesh);
      this.objectMeshes.push(mesh);
      this.objectMaterials.push(mat);
    }
  }

  private createSelector(): void {
    if (!this.renderer) return;

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
    this.renderer.addToBothEyes(this.selectorMesh);
  }

  private createUI(): void {
    if (!this.renderer) return;

    // Instructions (below objects)
    const instructGeo = new THREE.PlaneGeometry(PANELS.INSTRUCTION_WIDTH, PANELS.INSTRUCTION_HEIGHT);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, CONTENT_Y + PANELS.INSTRUCTION_Y_OFFSET, BASE_Z);
    this.renderer.addToBothEyes(this.instructionMesh);

    // Feedback (above objects)
    const feedbackGeo = new THREE.PlaneGeometry(PANELS.FEEDBACK_WIDTH, PANELS.FEEDBACK_HEIGHT);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, CONTENT_Y + PANELS.FEEDBACK_Y_OFFSET, BASE_Z);
    this.feedbackMesh.visible = false;
    this.renderer.addToBothEyes(this.feedbackMesh);

    // Level banner (center, appears on level transitions)
    const bannerGeo = new THREE.PlaneGeometry(1.1, 0.32);
    this.levelBannerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.levelBannerMesh = new THREE.Mesh(bannerGeo, this.levelBannerMaterial);
    this.levelBannerMesh.position.set(0, BASE_Y, BASE_Z + 0.1);
    this.levelBannerMesh.visible = false;
    this.renderer.addToBothEyes(this.levelBannerMesh);
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

    // Position objects
    for (let i = 0; i < 3; i++) {
      const mesh = this.objectMeshes[i];
      const mat = this.objectMaterials[i];

      mesh.position.set(POSITIONS_X[i], BASE_Y, this.currentTrial.depths[i]);
      mesh.scale.setScalar(this.currentTrial.sizes[i]);
      mesh.visible = true;
      mesh.rotation.set(0, 0, 0); // Reset rotation

      // Apply brightness via color
      const baseColor = new THREE.Color(OBJECT_COLORS[i]);
      const b = this.currentTrial.brightnesses[i];
      mat.color.setRGB(
        Math.min(1, baseColor.r * b),
        Math.min(1, baseColor.g * b),
        Math.min(1, baseColor.b * b),
      );
    }

    // Hide selector
    this.selectorMesh!.visible = false;

    // Start scale-in transition
    this.objectTransitioning = true;
    this.objectTransitionProgress = 0;
    this.awaitingSelection = false;

    this.renderInstructions();
  }

  private selectObject(index: number): void {
    if (!this.awaitingSelection) return;
    this.input?.haptic('tick');
    this.selectedIndex = index;

    // Move selector ring to selected object
    this.selectorMesh!.position.set(
      POSITIONS_X[index],
      BASE_Y,
      this.currentTrial!.depths[index] + 0.01, // Just in front
    );
    this.selectorMesh!.visible = true;
  }

  private confirmSelection(): void {
    if (!this.awaitingSelection || this.selectedIndex < 0 || !this.currentTrial) return;
    this.awaitingSelection = false;

    const correct = this.selectedIndex === this.currentTrial.closestIndex;
    const reactionTimeMs = Date.now() - this.trialStartTime;

    this.results.push({
      cueLevel: this.currentTrial.cueLevel,
      depthRange: this.currentTrial.depthRange,
      selectedIndex: this.selectedIndex,
      correctIndex: this.currentTrial.closestIndex,
      correct,
      reactionTimeMs,
    });

    this.input?.haptic(correct ? 'confirm' : 'error');
    this.updateStaircase(correct);
    this.showFeedbackText(correct);
  }

  private confirmCantTell(): void {
    if (!this.awaitingSelection || !this.currentTrial) return;
    this.awaitingSelection = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;

    this.results.push({
      cueLevel: this.currentTrial.cueLevel,
      depthRange: this.currentTrial.depthRange,
      selectedIndex: -1,
      correctIndex: this.currentTrial.closestIndex,
      correct: false,
      reactionTimeMs,
    });

    this.input?.haptic('error');
    this.updateStaircase(false);
    this.showFeedbackText(false);
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

  private shouldAdvanceLevel(): boolean {
    return this.cueLevel < 2 && this.correctAtLevel >= CORRECT_TO_ADVANCE_LEVEL;
  }

  private advanceCueLevel(): void {
    this.cueLevel++;
    this.maxCueLevel = Math.max(this.maxCueLevel, this.cueLevel);
    this.correctAtLevel = 0;
    this.correctStreak = 0;
    this.depthRange = LEVEL_UP_DEPTH_RANGE;

    // Hide objects during banner
    for (const mesh of this.objectMeshes) mesh.visible = false;
    this.selectorMesh!.visible = false;

    this.showLevelBanner(this.cueLevel);
  }

  // --- Feedback ---

  private showFeedbackText(correct: boolean): void {
    const text = correct ? 'Correct' : 'Incorrect';
    const color = correct ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE;

    const tex = this.textRenderer.renderToTexture({
      text,
      width: CANVAS.FEEDBACK_WIDTH,
      height: CANVAS.FEEDBACK_HEIGHT,
      fontSize: FONTS.FEEDBACK,
      lineHeight: 1.0,
      color,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 16,
      paddingY: 8,
    });

    this.feedbackMaterial!.map = tex;
    this.feedbackMaterial!.needsUpdate = true;
    this.feedbackMesh!.visible = true;
    this.showingFeedback = true;
    this.feedbackTimeout = Date.now() + TIMING.FEEDBACK_MS;
  }

  private showLevelBanner(level: number): void {
    const levelNum = level + 1;
    const name = CUE_LEVEL_NAMES[level];

    let detail: string;
    if (level === 0) {
      detail = 'Size + brightness cues active';
    } else if (level === 1) {
      detail = 'Size cue removed — brightness + stereo';
    } else {
      detail = 'Pure stereo — only binocular disparity';
    }

    const tex = this.textRenderer.renderToTexture({
      text: `Level ${levelNum}: ${name}\n${detail}`,
      width: 768,
      height: 230,
      fontSize: 36,
      lineHeight: 1.6,
      color: COLORS.TEXT_PRIMARY,
      background: COLORS.PANEL_BG,
      paddingX: 40,
      paddingY: 40,
      borderRadius: PANELS.RESULTS_BORDER_RADIUS,
      borderColor: COLORS.PANEL_BORDER,
      borderWidth: PANELS.RESULTS_BORDER_WIDTH,
      align: 'center',
    });

    this.levelBannerMaterial!.map = tex;
    this.levelBannerMaterial!.needsUpdate = true;
    this.levelBannerMesh!.visible = true;
    this.showingLevelBanner = true;
    this.levelBannerTimeout = Date.now() + 2500;
  }

  private showResults(): void {
    this.completed = true;
    for (const mesh of this.objectMeshes) mesh.visible = false;
    this.selectorMesh!.visible = false;
    this.feedbackMesh!.visible = false;

    const stats = this.getSessionStats();
    const levelResults = stats.levelResults as Array<{
      level: number; name: string; trials: number; accuracy: number; finestDepthMm: number | null;
    }>;

    const lines = [
      `Depth Scaffolding Complete`,
      `Max level: ${stats.maxCueLevelName}`,
      `Overall accuracy: ${stats.accuracy}%`,
      '',
      ...levelResults
        .filter((l) => l.trials > 0)
        .map((l) => {
          const depth = l.finestDepthMm !== null ? ` (finest: ${l.finestDepthMm}mm)` : '';
          return `L${l.level} ${l.name}: ${l.accuracy}%${depth}`;
        }),
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: CANVAS.RESULTS_WIDTH,
      height: 576,
      fontSize: FONTS.RESULTS,
      lineHeight: 1.5,
      color: COLORS.TEXT_PRIMARY,
      background: COLORS.PANEL_BG,
      paddingX: PANELS.RESULTS_PADDING_X,
      paddingY: PANELS.RESULTS_PADDING_Y,
      borderRadius: PANELS.RESULTS_BORDER_RADIUS,
      borderColor: COLORS.PANEL_BORDER,
      borderWidth: PANELS.RESULTS_BORDER_WIDTH,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
    this.instructionMesh!.geometry.dispose();
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(PANELS.RESULTS_WIDTH, 0.7);
    this.instructionMesh!.position.set(0, BASE_Y - 0.4, BASE_Z + 0.1);
  }

  private renderInstructions(): void {
    if (!this.currentTrial) return;

    const levelName = CUE_LEVEL_NAMES[this.cueLevel];
    const depthMm = (this.depthRange * 1000).toFixed(1);
    const trialNum = this.trialIndex + 1;

    const lines = [
      'Which object is closest? ← left  ↑ center  → right',
      `Trigger = confirm   A = can't tell   ${levelName} (${depthMm}mm)   ${trialNum}/${TOTAL_TRIALS}`,
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: CANVAS.INSTRUCTION_WIDTH,
      height: CANVAS.INSTRUCTION_HEIGHT,
      fontSize: FONTS.INSTRUCTION,
      lineHeight: 1.6,
      color: COLORS.TEXT_INSTRUCTION,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 12,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
