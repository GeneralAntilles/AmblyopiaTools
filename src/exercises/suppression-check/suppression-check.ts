/**
 * Worth 4-Dot Suppression Check
 *
 * VR implementation of the classic Worth 4-dot test for detecting
 * binocular suppression. Uses per-eye layers instead of red/green filters.
 *
 * Dot layout (diamond pattern, rotated randomly each trial):
 *        [RED]         ← training eye only (Layer 1)
 *   [GREEN]  [GREEN]   ← non-training eye only (Layer 2)
 *        [WHITE]       ← both eyes (Layer 0)
 *
 * Varies distance each trial (near/medium/far) since suppression
 * is often distance-dependent. Dots scale with distance to subtend
 * similar visual angles.
 *
 * User reports how many dots they see:
 *   - Trigger: 4 dots (fusion — both eyes contributing)
 *   - A button: 2 dots (non-training eye suppressed)
 *   - B button: 3 dots (training eye suppressed)
 *   - Thumbstick down: 5 dots (diplopia — white dot doubled)
 *
 * Runs multiple trials and tracks suppression over time.
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';

type SuppressionResult = 'fusion' | 'training-suppressed' | 'fellow-suppressed' | 'diplopia';

interface TrialCondition {
  distance: number;       // Z depth in meters
  distanceLabel: string;  // 'near' | 'medium' | 'far'
  rotation: number;       // Rotation in radians
}

interface TrialResult {
  response: SuppressionResult;
  reactionTimeMs: number;
  condition: TrialCondition;
}

const TOTAL_TRIALS = 12;

// Dot visual settings — sized for Quest 3 (~25 PPD) at medium distance
const DOT_RADIUS_BASE = 0.06;
const DOT_SPREAD_BASE = 0.2;
const DOT_Y = 1.5;

// Distance conditions (Z depth, negative = forward)
const DISTANCES: { z: number; label: string }[] = [
  { z: -1.0, label: 'near' },
  { z: -1.8, label: 'medium' },
  { z: -3.0, label: 'far' },
];

// Reference distance for scaling (medium)
const REF_DISTANCE = 1.8;

// Rotation angles for diamond pattern (4 orientations)
const ROTATIONS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];

// Colors
const RED = 0xdd4444;
const GREEN = 0x44bb66;
const WHITE = 0xeeeedd;
const FIXATION_COLOR = 0x9688a0;
const PANEL_BG = '#16111e';

// Timing
const INTER_TRIAL_MS = 800;   // Fixation cross display time
const FADE_IN_MS = 300;       // Dot fade-in duration

export class SuppressionCheckExercise extends BaseExercise {
  readonly name = 'Suppression Check';
  readonly description = 'Worth 4-dot test to detect binocular suppression.';
  readonly type = 'diagnostic' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private dotGroup: THREE.Group | null = null;
  private redDot: THREE.Mesh | null = null;
  private redMaterial: THREE.MeshBasicMaterial | null = null;
  private greenDot1: THREE.Mesh | null = null;
  private greenMat1: THREE.MeshBasicMaterial | null = null;
  private greenDot2: THREE.Mesh | null = null;
  private greenMat2: THREE.MeshBasicMaterial | null = null;
  private whiteDot: THREE.Mesh | null = null;
  private whiteMaterial: THREE.MeshBasicMaterial | null = null;
  private fixationMesh: THREE.Mesh | null = null;
  private fixationMaterial: THREE.MeshBasicMaterial | null = null;
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;

  // Trial state
  private results: TrialResult[] = [];
  private trialConditions: TrialCondition[] = [];
  private currentTrial: number = 0;
  private trialStartTime: number = 0;
  private awaitingResponse: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private completed: boolean = false;

  // Transition state
  private interTrialActive: boolean = false;
  private interTrialEndTime: number = 0;
  private fadingIn: boolean = false;
  private fadeStartTime: number = 0;

  private exitCallback: (() => void) | null = null;

  constructor() {
    super();
    this.textRenderer = new TextRenderer();
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;
    this.results = [];
    this.currentTrial = 0;

    // Generate randomized trial conditions
    this.trialConditions = this.generateTrialConditions();

    // Environment
    this.createEnvironment();

    // Create dot group and dots
    this.createDots();

    // Fixation cross (both eyes)
    this.createFixationCross();

    // Instruction panel (both eyes)
    const instructGeo = new THREE.PlaneGeometry(1.4, 0.25);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, DOT_Y - 0.4, -1.8);
    this.renderer.addToBothEyes(this.instructionMesh);

    // Feedback panel (both eyes)
    const feedbackGeo = new THREE.PlaneGeometry(0.8, 0.08);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, DOT_Y + 0.35, -1.8);
    this.feedbackMesh.visible = false;
    this.renderer.addToBothEyes(this.feedbackMesh);

    // Show instructions
    this.renderInstructions();

    // Input
    this.unsubInput = this.input.onAction((action) => {
      if (this.completed) {
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      if (this.awaitingResponse) {
        switch (action) {
          case 'select': // Trigger = 4 dots (fusion)
            this.recordResponse('fusion');
            break;
          case 'button-a': // A = 2 dots (fellow suppressed)
            this.recordResponse('fellow-suppressed');
            break;
          case 'button-b': // B = 3 dots (training suppressed)
            this.recordResponse('training-suppressed');
            break;
          case 'chapter-next': // Thumbstick down = 5 dots (diplopia)
            this.recordResponse('diplopia');
            break;
        }
      }

      if (action === 'exit') {
        this.exitCallback?.();
      }
    });

    // Start first trial with brief fixation
    this.beginInterTrial();
    this.markStarted();
  }

  update(_dt: number): void {
    const now = Date.now();

    // Feedback timeout → inter-trial or results
    if (this.showingFeedback && now > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;

      if (this.currentTrial >= TOTAL_TRIALS) {
        this.showResults();
      } else {
        this.beginInterTrial();
      }
    }

    // Inter-trial fixation → start trial with fade-in
    if (this.interTrialActive && now > this.interTrialEndTime) {
      this.interTrialActive = false;
      this.fixationMesh!.visible = false;
      this.startTrial();
    }

    // Dot fade-in animation
    if (this.fadingIn) {
      const elapsed = now - this.fadeStartTime;
      const t = Math.min(1, elapsed / FADE_IN_MS);

      // Ease-out
      const alpha = 1 - (1 - t) * (1 - t);

      if (this.redMaterial) this.redMaterial.opacity = alpha;
      if (this.greenMat1) this.greenMat1.opacity = alpha;
      if (this.greenMat2) this.greenMat2.opacity = alpha;
      if (this.whiteMaterial) this.whiteMaterial.opacity = alpha;

      if (t >= 1) {
        this.fadingIn = false;
      }
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      if (this.redDot) this.renderer.removeFromScene(this.redDot);
      if (this.greenDot1) this.renderer.removeFromScene(this.greenDot1);
      if (this.greenDot2) this.renderer.removeFromScene(this.greenDot2);
      if (this.whiteDot) this.renderer.removeFromScene(this.whiteDot);
      if (this.fixationMesh) this.renderer.removeFromScene(this.fixationMesh);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
    }

    this.redDot?.geometry.dispose();
    this.redMaterial?.dispose();
    this.greenDot1?.geometry.dispose();
    this.greenMat1?.dispose();
    this.greenDot2?.geometry.dispose();
    this.greenMat2?.dispose();
    this.whiteDot?.geometry.dispose();
    this.whiteMaterial?.dispose();
    this.fixationMesh?.geometry.dispose();
    this.fixationMaterial?.dispose();
    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.instructionMesh?.geometry.dispose();
    this.instructionMaterial?.dispose();
    this.feedbackMesh?.geometry.dispose();
    this.feedbackMaterial?.dispose();

    this.renderer = null;
    this.input = null;
  }

  getSessionStats(): SessionStats {
    const counts = { fusion: 0, 'training-suppressed': 0, 'fellow-suppressed': 0, diplopia: 0 };
    const distanceCounts: Record<string, { total: number; fusion: number }> = {};
    let totalReactionTime = 0;

    for (const r of this.results) {
      counts[r.response]++;
      totalReactionTime += r.reactionTimeMs;

      const label = r.condition.distanceLabel;
      if (!distanceCounts[label]) distanceCounts[label] = { total: 0, fusion: 0 };
      distanceCounts[label].total++;
      if (r.response === 'fusion') distanceCounts[label].fusion++;
    }

    const total = this.results.length || 1;

    // Per-distance fusion rates
    const perDistance: Record<string, number> = {};
    for (const [label, data] of Object.entries(distanceCounts)) {
      perDistance[label] = Math.round((data.fusion / data.total) * 100);
    }

    return {
      exercise: 'suppression-check',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      fusionRate: Math.round((counts.fusion / total) * 100),
      trainingSuppressionRate: Math.round((counts['training-suppressed'] / total) * 100),
      fellowSuppressionRate: Math.round((counts['fellow-suppressed'] / total) * 100),
      diplopiaRate: Math.round((counts.diplopia / total) * 100),
      avgReactionTimeMs: Math.round(totalReactionTime / total),
      nearFusionRate: perDistance['near'] ?? 0,
      mediumFusionRate: perDistance['medium'] ?? 0,
      farFusionRate: perDistance['far'] ?? 0,
    };
  }

  // --- Trial Condition Generation ---

  private generateTrialConditions(): TrialCondition[] {
    const conditions: TrialCondition[] = [];

    // 4 trials per distance (12 total), randomly shuffled
    for (const dist of DISTANCES) {
      for (let i = 0; i < 4; i++) {
        conditions.push({
          distance: dist.z,
          distanceLabel: dist.label,
          rotation: ROTATIONS[Math.floor(Math.random() * ROTATIONS.length)],
        });
      }
    }

    // Fisher-Yates shuffle
    for (let i = conditions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [conditions[i], conditions[j]] = [conditions[j], conditions[i]];
    }

    return conditions;
  }

  // --- Scene Setup ---

  private createEnvironment(): void {
    if (!this.renderer) return;

    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0.0, '#1a0f20');
    gradient.addColorStop(0.35, '#160c1a');
    gradient.addColorStop(0.7, '#0f0812');
    gradient.addColorStop(1.0, '#0a060c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 512);

    const envTexture = new THREE.CanvasTexture(canvas);
    const sphereGeo = new THREE.SphereGeometry(40, 32, 16);
    this.envMaterial = new THREE.MeshBasicMaterial({ map: envTexture, side: THREE.BackSide });
    this.envSphereMesh = new THREE.Mesh(sphereGeo, this.envMaterial);
    this.renderer.addToBothEyes(this.envSphereMesh);
  }

  private createDots(): void {
    if (!this.renderer) return;

    const dotGeo = new THREE.CircleGeometry(DOT_RADIUS_BASE, 32);

    // Red dot — training eye only (Layer 1)
    this.redMaterial = new THREE.MeshBasicMaterial({
      color: RED, transparent: true, opacity: 0,
    });
    this.redDot = new THREE.Mesh(dotGeo.clone(), this.redMaterial);
    this.renderer.addToTrainingEye(this.redDot);

    // Green dot 1 — non-training eye only (Layer 2)
    this.greenMat1 = new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0,
    });
    this.greenDot1 = new THREE.Mesh(dotGeo.clone(), this.greenMat1);
    this.renderer.addToNonTrainingEye(this.greenDot1);

    // Green dot 2 — non-training eye only (Layer 2)
    this.greenMat2 = new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0,
    });
    this.greenDot2 = new THREE.Mesh(dotGeo.clone(), this.greenMat2);
    this.renderer.addToNonTrainingEye(this.greenDot2);

    // White dot — both eyes (Layer 0)
    this.whiteMaterial = new THREE.MeshBasicMaterial({
      color: WHITE, transparent: true, opacity: 0,
    });
    this.whiteDot = new THREE.Mesh(dotGeo.clone(), this.whiteMaterial);
    this.renderer.addToBothEyes(this.whiteDot);
  }

  private createFixationCross(): void {
    if (!this.renderer) return;

    // Small cross made of two thin rectangles
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: FIXATION_COLOR, transparent: true, opacity: 0.6,
    });
    this.fixationMaterial = mat;

    const hBar = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.005), mat);
    const vBar = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.04), mat);
    group.add(hBar, vBar);
    group.position.set(0, DOT_Y, -1.8);
    group.visible = false;

    this.fixationMesh = group as unknown as THREE.Mesh;
    this.renderer.addToBothEyes(group);
  }

  // --- Trial Logic ---

  private beginInterTrial(): void {
    // Hide dots during inter-trial
    this.setDotsOpacity(0);

    // Show fixation cross at the upcoming trial distance
    const condition = this.trialConditions[this.currentTrial];
    if (this.fixationMesh) {
      this.fixationMesh.position.z = condition.distance;
      this.fixationMesh.visible = true;
    }

    this.interTrialActive = true;
    this.interTrialEndTime = Date.now() + INTER_TRIAL_MS;
    this.renderInstructions();
  }

  private startTrial(): void {
    const condition = this.trialConditions[this.currentTrial];

    // Position and scale dots for this trial's distance
    this.positionDots(condition);

    // Start fade-in
    this.fadingIn = true;
    this.fadeStartTime = Date.now();

    this.trialStartTime = Date.now();
    this.awaitingResponse = true;
    this.renderInstructions();
  }

  private positionDots(condition: TrialCondition): void {
    const z = condition.distance;
    const scale = Math.abs(z) / REF_DISTANCE;
    const spread = DOT_SPREAD_BASE * scale;
    const rot = condition.rotation;

    // Diamond offsets rotated by condition.rotation
    // Original: top (0, +spread), left (-spread, 0), right (+spread, 0), bottom (0, -spread)
    const positions = [
      { dx: Math.sin(rot) * spread, dy: Math.cos(rot) * spread },         // Red (was top)
      { dx: Math.sin(rot - Math.PI / 2) * spread, dy: Math.cos(rot - Math.PI / 2) * spread }, // Green1 (was left)
      { dx: Math.sin(rot + Math.PI / 2) * spread, dy: Math.cos(rot + Math.PI / 2) * spread }, // Green2 (was right)
      { dx: Math.sin(rot + Math.PI) * spread, dy: Math.cos(rot + Math.PI) * spread },         // White (was bottom)
    ];

    // Scale dot geometry for distance
    const dotScale = scale;

    if (this.redDot) {
      this.redDot.position.set(positions[0].dx, DOT_Y + positions[0].dy, z);
      this.redDot.scale.set(dotScale, dotScale, 1);
    }
    if (this.greenDot1) {
      this.greenDot1.position.set(positions[1].dx, DOT_Y + positions[1].dy, z);
      this.greenDot1.scale.set(dotScale, dotScale, 1);
    }
    if (this.greenDot2) {
      this.greenDot2.position.set(positions[2].dx, DOT_Y + positions[2].dy, z);
      this.greenDot2.scale.set(dotScale, dotScale, 1);
    }
    if (this.whiteDot) {
      this.whiteDot.position.set(positions[3].dx, DOT_Y + positions[3].dy, z);
      this.whiteDot.scale.set(dotScale, dotScale, 1);
    }
  }

  private setDotsOpacity(opacity: number): void {
    if (this.redMaterial) this.redMaterial.opacity = opacity;
    if (this.greenMat1) this.greenMat1.opacity = opacity;
    if (this.greenMat2) this.greenMat2.opacity = opacity;
    if (this.whiteMaterial) this.whiteMaterial.opacity = opacity;
  }

  private recordResponse(response: SuppressionResult): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    const condition = this.trialConditions[this.currentTrial];
    this.results.push({ response, reactionTimeMs, condition });
    this.currentTrial++;

    // Hide dots and show brief feedback
    this.setDotsOpacity(0);
    this.showFeedback(response, condition);
  }

  private showFeedback(response: SuppressionResult, condition: TrialCondition): void {
    const labels: Record<SuppressionResult, string> = {
      fusion: '4 dots — Fusion',
      'fellow-suppressed': '2 dots — Fellow eye suppressed',
      'training-suppressed': '3 dots — Training eye suppressed',
      diplopia: '5 dots — Diplopia',
    };

    const colors: Record<SuppressionResult, string> = {
      fusion: '#5cb87a',
      'fellow-suppressed': '#c49a5c',
      'training-suppressed': '#c49a5c',
      diplopia: '#c47a5c',
    };

    const distLabel = condition.distanceLabel.charAt(0).toUpperCase() + condition.distanceLabel.slice(1);
    const tex = this.textRenderer.renderToTexture({
      text: `${distLabel}: ${labels[response]}`,
      width: 768,
      height: 80,
      fontSize: 36,
      lineHeight: 1.0,
      color: colors[response],
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 16,
      paddingY: 16,
    });

    this.feedbackMaterial!.map = tex;
    this.feedbackMaterial!.needsUpdate = true;
    this.feedbackMesh!.visible = true;
    this.showingFeedback = true;
    this.feedbackTimeout = Date.now() + 1200;
  }

  private showResults(): void {
    this.completed = true;
    this.setDotsOpacity(0);

    const stats = this.getSessionStats();
    const lines = [
      `Suppression Check — ${stats.trials} trials`,
      '',
      `Overall Fusion: ${stats.fusionRate}%`,
      '',
      `  Near:   ${stats.nearFusionRate ?? 0}% fused`,
      `  Medium: ${stats.mediumFusionRate ?? 0}% fused`,
      `  Far:    ${stats.farFusionRate ?? 0}% fused`,
      '',
      `Training suppressed: ${stats.trainingSuppressionRate}%`,
      `Fellow suppressed: ${stats.fellowSuppressionRate}%`,
      `Diplopia: ${stats.diplopiaRate}%`,
      `Avg reaction: ${stats.avgReactionTimeMs}ms`,
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 780,
      fontSize: 34,
      lineHeight: 1.45,
      color: '#e0d6cc',
      background: PANEL_BG,
      paddingX: 60,
      paddingY: 50,
      borderRadius: 32,
      borderColor: '#362a40',
      borderWidth: 3,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
    this.instructionMesh!.geometry.dispose();
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.3, 1.0);
    this.instructionMesh!.position.set(0, DOT_Y - 0.55, -1.7);

    this.feedbackMesh!.visible = false;
  }

  private renderInstructions(): void {
    const condition = this.currentTrial < TOTAL_TRIALS
      ? this.trialConditions[this.currentTrial]
      : null;

    const distLabel = condition
      ? `${condition.distanceLabel.charAt(0).toUpperCase() + condition.distanceLabel.slice(1)} distance`
      : '';

    const trialLabel = this.currentTrial < TOTAL_TRIALS
      ? `Trial ${this.currentTrial + 1} of ${TOTAL_TRIALS}  •  ${distLabel}`
      : '';

    const lines = [
      'How many dots do you see?',
      '',
      'Trigger = 4    A = 2    B = 3    Stick↓ = 5',
      trialLabel,
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 180,
      fontSize: 32,
      lineHeight: 1.5,
      color: '#9688a0',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
