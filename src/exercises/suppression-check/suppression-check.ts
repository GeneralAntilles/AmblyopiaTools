/**
 * Worth 4-Dot Suppression Check
 *
 * VR implementation of the classic Worth 4-dot test for detecting
 * binocular suppression. Uses per-eye layers instead of red/green filters.
 *
 * Dot layout (diamond pattern):
 *        [RED]         ← training eye only (Layer 1)
 *   [GREEN]  [GREEN]   ← non-training eye only (Layer 2)
 *        [WHITE]       ← both eyes (Layer 0)
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

interface TrialResult {
  response: SuppressionResult;
  reactionTimeMs: number;
}

const TOTAL_TRIALS = 10;

// Dot visual settings — sized for Quest 3 (~25 PPD)
const DOT_RADIUS = 0.06;
const DOT_SPREAD = 0.2; // Distance from center to each dot
const DOT_Y = 1.5;
const DOT_Z = -1.8;

// Colors
const RED = 0xdd3333;
const GREEN = 0x33bb55;
const WHITE = 0xeeeeee;
const PANEL_BG = '#111119';

export class SuppressionCheckExercise extends BaseExercise {
  readonly name = 'Suppression Check';
  readonly description = 'Worth 4-dot test to detect binocular suppression.';
  readonly type = 'diagnostic' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private dotMeshes: THREE.Mesh[] = [];
  private dotMaterials: THREE.MeshBasicMaterial[] = [];
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;

  // Trial state
  private results: TrialResult[] = [];
  private currentTrial: number = 0;
  private trialStartTime: number = 0;
  private awaitingResponse: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private completed: boolean = false;

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

    // Environment
    this.createEnvironment();

    // Create dots
    this.createDots();

    // Instruction panel (both eyes)
    const instructGeo = new THREE.PlaneGeometry(1.4, 0.25);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, DOT_Y - 0.4, DOT_Z);
    this.renderer.addToBothEyes(this.instructionMesh);

    // Feedback panel (both eyes)
    const feedbackGeo = new THREE.PlaneGeometry(0.8, 0.08);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, DOT_Y + 0.35, DOT_Z);
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

    this.startTrial();
    this.markStarted();
  }

  update(_dt: number): void {
    if (this.showingFeedback && Date.now() > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;

      if (this.currentTrial >= TOTAL_TRIALS) {
        this.showResults();
      } else {
        this.startTrial();
      }
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      for (const m of this.dotMeshes) this.renderer.removeFromScene(m);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
    }

    for (let i = 0; i < this.dotMeshes.length; i++) {
      this.dotMeshes[i].geometry.dispose();
      this.dotMaterials[i].dispose();
    }

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
    let totalReactionTime = 0;

    for (const r of this.results) {
      counts[r.response]++;
      totalReactionTime += r.reactionTimeMs;
    }

    const total = this.results.length || 1;
    return {
      exercise: 'suppression-check',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      fusionRate: Math.round((counts.fusion / total) * 100),
      trainingSuppressionRate: Math.round((counts['training-suppressed'] / total) * 100),
      fellowSuppressionRate: Math.round((counts['fellow-suppressed'] / total) * 100),
      diplopiaRate: Math.round((counts.diplopia / total) * 100),
      avgReactionTimeMs: Math.round(totalReactionTime / total),
    };
  }

  // --- Scene Setup ---

  private createEnvironment(): void {
    if (!this.renderer) return;

    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0.0, '#0e0e1c');
    gradient.addColorStop(0.35, '#0a0a14');
    gradient.addColorStop(0.7, '#060610');
    gradient.addColorStop(1.0, '#040408');
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

    const dotGeo = new THREE.CircleGeometry(DOT_RADIUS, 32);

    // Red dot — top — training eye only (Layer 1)
    const redMat = new THREE.MeshBasicMaterial({ color: RED });
    const redDot = new THREE.Mesh(dotGeo.clone(), redMat);
    redDot.position.set(0, DOT_Y + DOT_SPREAD, DOT_Z);
    this.renderer.addToTrainingEye(redDot);
    this.dotMeshes.push(redDot);
    this.dotMaterials.push(redMat);

    // Green dot — left — non-training eye only (Layer 2)
    const greenMat1 = new THREE.MeshBasicMaterial({ color: GREEN });
    const greenDot1 = new THREE.Mesh(dotGeo.clone(), greenMat1);
    greenDot1.position.set(-DOT_SPREAD, DOT_Y, DOT_Z);
    this.renderer.addToNonTrainingEye(greenDot1);
    this.dotMeshes.push(greenDot1);
    this.dotMaterials.push(greenMat1);

    // Green dot — right — non-training eye only (Layer 2)
    const greenMat2 = new THREE.MeshBasicMaterial({ color: GREEN });
    const greenDot2 = new THREE.Mesh(dotGeo.clone(), greenMat2);
    greenDot2.position.set(DOT_SPREAD, DOT_Y, DOT_Z);
    this.renderer.addToNonTrainingEye(greenDot2);
    this.dotMeshes.push(greenDot2);
    this.dotMaterials.push(greenMat2);

    // White dot — bottom — both eyes (Layer 0)
    const whiteMat = new THREE.MeshBasicMaterial({ color: WHITE });
    const whiteDot = new THREE.Mesh(dotGeo.clone(), whiteMat);
    whiteDot.position.set(0, DOT_Y - DOT_SPREAD, DOT_Z);
    this.renderer.addToBothEyes(whiteDot);
    this.dotMeshes.push(whiteDot);
    this.dotMaterials.push(whiteMat);
  }

  // --- Trial Logic ---

  private startTrial(): void {
    this.trialStartTime = Date.now();
    this.awaitingResponse = true;
    this.renderInstructions();
  }

  private recordResponse(response: SuppressionResult): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    this.results.push({ response, reactionTimeMs });
    this.currentTrial++;

    // Show brief feedback
    this.showFeedback(response);
  }

  private showFeedback(response: SuppressionResult): void {
    const labels: Record<SuppressionResult, string> = {
      fusion: '4 dots — Fusion',
      'fellow-suppressed': '2 dots — Fellow eye suppressed',
      'training-suppressed': '3 dots — Training eye suppressed',
      diplopia: '5 dots — Diplopia',
    };

    const colors: Record<SuppressionResult, string> = {
      fusion: '#44aa66',
      'fellow-suppressed': '#aa8844',
      'training-suppressed': '#aa8844',
      diplopia: '#aa6644',
    };

    const tex = this.textRenderer.renderToTexture({
      text: `Trial ${this.currentTrial}/${TOTAL_TRIALS}: ${labels[response]}`,
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

    const stats = this.getSessionStats();
    const lines = [
      `Suppression Check Complete — ${stats.trials} trials`,
      '',
      `Fusion: ${stats.fusionRate}%`,
      `Training eye suppressed: ${stats.trainingSuppressionRate}%`,
      `Fellow eye suppressed: ${stats.fellowSuppressionRate}%`,
      `Diplopia: ${stats.diplopiaRate}%`,
      `Avg reaction time: ${stats.avgReactionTimeMs}ms`,
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 576,
      fontSize: 38,
      lineHeight: 1.5,
      color: '#d4d4dc',
      background: PANEL_BG,
      paddingX: 60,
      paddingY: 50,
      borderRadius: 32,
      borderColor: '#2a2a40',
      borderWidth: 3,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
    this.instructionMesh!.geometry.dispose();
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.3, 0.75);
    this.instructionMesh!.position.set(0, DOT_Y - 0.55, DOT_Z + 0.1);

    // Hide dots
    for (const m of this.dotMeshes) m.visible = false;
    this.feedbackMesh!.visible = false;
  }

  private renderInstructions(): void {
    const trialLabel = this.currentTrial < TOTAL_TRIALS
      ? `Trial ${this.currentTrial + 1} of ${TOTAL_TRIALS}`
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
      color: '#8888aa',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
