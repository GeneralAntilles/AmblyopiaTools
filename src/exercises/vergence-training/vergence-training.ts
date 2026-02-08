/**
 * Vergence Training Exercise
 *
 * Trains voluntary vergence control (convergence and divergence) using
 * binocular disparity. Each eye sees a ring with a different inner symbol
 * (cross vs dot). When fused correctly, you see a single ring containing
 * both symbols, with a sense of depth.
 *
 * This is the VR equivalent of eccentric circles and variable vectographs
 * from clinical vision therapy — but with true binocular disparity instead
 * of anaglyph (no light leak, no color artifacts).
 *
 * Adaptive staircase: increases disparity after successful fusion,
 * decreases after failure. Separately tracks convergence and divergence.
 *
 * Controls:
 *   - Trigger: "I see one ring with both symbols" (fused)
 *   - A button: "I see two separate rings" (double)
 *   - Grip: exit
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';

type VergenceDirection = 'convergence' | 'divergence';

interface TrialResult {
  direction: VergenceDirection;
  disparityM: number;
  fused: boolean;
  reactionTimeMs: number;
}

const TOTAL_TRIALS = 24; // 12 convergence + 12 divergence, interleaved
const RING_Y = 1.5;
const RING_Z = -2.0;
const RING_SIZE = 0.2; // Outer radius of the ring in meters
const INITIAL_DISPARITY = 0.01; // Starting disparity in meters (~6mm)
const STEP_UP = 0.004; // Increase disparity after fusion
const STEP_DOWN = 0.008; // Decrease disparity after failure (larger to stay in range)
const MIN_DISPARITY = 0.002;
const MAX_DISPARITY = 0.06;
const PANEL_BG = '#111119';

export class VergenceTrainingExercise extends BaseExercise {
  readonly name = 'Vergence Training';
  readonly description = 'Train convergence and divergence with binocular disparity rings.';
  readonly type = 'binocular' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private trainingRingGroup: THREE.Group = new THREE.Group();
  private nonTrainingRingGroup: THREE.Group = new THREE.Group();
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;

  // Staircase state
  private convergenceDisparity: number = INITIAL_DISPARITY;
  private divergenceDisparity: number = INITIAL_DISPARITY;
  private maxConvergenceDisparity: number = 0;
  private maxDivergenceDisparity: number = 0;

  // Trial state
  private trialOrder: VergenceDirection[] = [];
  private currentTrialIndex: number = 0;
  private results: TrialResult[] = [];
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
    this.currentTrialIndex = 0;
    this.convergenceDisparity = INITIAL_DISPARITY;
    this.divergenceDisparity = INITIAL_DISPARITY;
    this.maxConvergenceDisparity = 0;
    this.maxDivergenceDisparity = 0;

    // Build interleaved trial order
    this.trialOrder = [];
    for (let i = 0; i < TOTAL_TRIALS / 2; i++) {
      this.trialOrder.push('convergence', 'divergence');
    }

    this.createEnvironment();
    this.createRings();
    this.createUI();

    this.startTrial();

    this.unsubInput = this.input.onAction((action) => {
      if (this.completed) {
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      if (this.awaitingResponse) {
        switch (action) {
          case 'select':
            this.recordResponse(true);
            break;
          case 'button-a':
            this.recordResponse(false);
            break;
        }
      }

      if (action === 'exit') {
        this.exitCallback?.();
      }
    });

    this.markStarted();
  }

  update(_dt: number): void {
    if (this.showingFeedback && Date.now() > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;

      this.currentTrialIndex++;
      if (this.currentTrialIndex >= TOTAL_TRIALS) {
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
      this.renderer.removeFromScene(this.trainingRingGroup);
      this.renderer.removeFromScene(this.nonTrainingRingGroup);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
    }

    const dispose = (group: THREE.Group) => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    };

    dispose(this.trainingRingGroup);
    dispose(this.nonTrainingRingGroup);
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
    const conv = this.results.filter((r) => r.direction === 'convergence');
    const div = this.results.filter((r) => r.direction === 'divergence');

    const fusionRate = (arr: TrialResult[]) =>
      arr.length > 0 ? Math.round((arr.filter((r) => r.fused).length / arr.length) * 100) : 0;

    const avgMs = (arr: TrialResult[]) =>
      arr.length > 0 ? Math.round(arr.reduce((s, r) => s + r.reactionTimeMs, 0) / arr.length) : 0;

    return {
      exercise: 'vergence-training',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      convergenceFusionRate: fusionRate(conv),
      divergenceFusionRate: fusionRate(div),
      maxConvergenceDisparityMm: Math.round(this.maxConvergenceDisparity * 1000 * 10) / 10,
      maxDivergenceDisparityMm: Math.round(this.maxDivergenceDisparity * 1000 * 10) / 10,
      avgReactionTimeMs: avgMs(this.results),
      convergenceAvgMs: avgMs(conv),
      divergenceAvgMs: avgMs(div),
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

  private createRings(): void {
    if (!this.renderer) return;

    // Training eye: ring with a cross inside
    this.buildRingWithSymbol(this.trainingRingGroup, 'cross', 0x6688cc);
    this.renderer.addToTrainingEye(this.trainingRingGroup);

    // Non-training eye: ring with a dot inside
    this.buildRingWithSymbol(this.nonTrainingRingGroup, 'dot', 0x88cc66);
    this.renderer.addToNonTrainingEye(this.nonTrainingRingGroup);
  }

  private buildRingWithSymbol(group: THREE.Group, symbol: 'cross' | 'dot', color: number): void {
    // Outer ring
    const ringGeo = new THREE.RingGeometry(RING_SIZE * 0.85, RING_SIZE, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);

    // Inner ring (thinner, for alignment reference)
    const innerRingGeo = new THREE.RingGeometry(RING_SIZE * 0.45, RING_SIZE * 0.5, 48);
    const innerRingMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    group.add(innerRing);

    if (symbol === 'cross') {
      // Horizontal bar
      const hGeo = new THREE.PlaneGeometry(RING_SIZE * 0.5, RING_SIZE * 0.06);
      const hMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(hGeo, hMat));

      // Vertical bar
      const vGeo = new THREE.PlaneGeometry(RING_SIZE * 0.06, RING_SIZE * 0.5);
      const vMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(vGeo, vMat));
    } else {
      // Filled circle dot
      const dotGeo = new THREE.CircleGeometry(RING_SIZE * 0.12, 24);
      const dotMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(dotGeo, dotMat));
    }

    // Position at center
    group.position.set(0, RING_Y, RING_Z);
  }

  private createUI(): void {
    if (!this.renderer) return;

    const instructGeo = new THREE.PlaneGeometry(1.2, 0.12);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, RING_Y - 0.45, RING_Z);
    this.renderer.addToBothEyes(this.instructionMesh);

    const feedbackGeo = new THREE.PlaneGeometry(0.8, 0.06);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, RING_Y + 0.4, RING_Z);
    this.feedbackMesh.visible = false;
    this.renderer.addToBothEyes(this.feedbackMesh);
  }

  // --- Trial Logic ---

  private startTrial(): void {
    const direction = this.trialOrder[this.currentTrialIndex];
    const disparity = direction === 'convergence'
      ? this.convergenceDisparity
      : this.divergenceDisparity;

    // Apply disparity: shift each eye's ring in opposite X directions
    // Convergence: training eye ring shifts right, non-training shifts left
    //   → eyes must converge (toe in) to fuse
    // Divergence: training eye ring shifts left, non-training shifts right
    //   → eyes must diverge (toe out) to fuse
    const halfD = disparity / 2;

    if (direction === 'convergence') {
      this.trainingRingGroup.position.x = halfD;
      this.nonTrainingRingGroup.position.x = -halfD;
    } else {
      this.trainingRingGroup.position.x = -halfD;
      this.nonTrainingRingGroup.position.x = halfD;
    }

    this.trialStartTime = Date.now();
    this.awaitingResponse = true;
    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const direction = this.trialOrder[this.currentTrialIndex];
    const disparity = direction === 'convergence'
      ? this.convergenceDisparity
      : this.divergenceDisparity;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    this.results.push({ direction, disparityM: disparity, fused, reactionTimeMs });

    // Update staircase
    if (fused) {
      if (direction === 'convergence') {
        this.maxConvergenceDisparity = Math.max(this.maxConvergenceDisparity, this.convergenceDisparity);
        this.convergenceDisparity = Math.min(MAX_DISPARITY, this.convergenceDisparity + STEP_UP);
      } else {
        this.maxDivergenceDisparity = Math.max(this.maxDivergenceDisparity, this.divergenceDisparity);
        this.divergenceDisparity = Math.min(MAX_DISPARITY, this.divergenceDisparity + STEP_UP);
      }
    } else {
      if (direction === 'convergence') {
        this.convergenceDisparity = Math.max(MIN_DISPARITY, this.convergenceDisparity - STEP_DOWN);
      } else {
        this.divergenceDisparity = Math.max(MIN_DISPARITY, this.divergenceDisparity - STEP_DOWN);
      }
    }

    this.showFeedbackText(fused, direction);
  }

  private showFeedbackText(fused: boolean, direction: VergenceDirection): void {
    const dirLabel = direction === 'convergence' ? 'Conv' : 'Div';
    const text = fused ? `${dirLabel}: Fused` : `${dirLabel}: Double`;
    const color = fused ? '#44aa66' : '#aa6644';

    const tex = this.textRenderer.renderToTexture({
      text,
      width: 384,
      height: 48,
      fontSize: 24,
      lineHeight: 1.0,
      color,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 16,
      paddingY: 10,
    });

    this.feedbackMaterial!.map = tex;
    this.feedbackMaterial!.needsUpdate = true;
    this.feedbackMesh!.visible = true;
    this.showingFeedback = true;
    this.feedbackTimeout = Date.now() + 800;
  }

  private showResults(): void {
    this.completed = true;
    this.trainingRingGroup.visible = false;
    this.nonTrainingRingGroup.visible = false;

    const stats = this.getSessionStats();
    const lines = [
      `Vergence Training Complete — ${stats.trials} trials`,
      '',
      `Convergence: ${stats.convergenceFusionRate}% fused`,
      `  Max disparity: ${stats.maxConvergenceDisparityMm}mm`,
      `  Avg reaction: ${stats.convergenceAvgMs}ms`,
      '',
      `Divergence: ${stats.divergenceFusionRate}% fused`,
      `  Max disparity: ${stats.maxDivergenceDisparityMm}mm`,
      `  Avg reaction: ${stats.divergenceAvgMs}ms`,
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 576,
      fontSize: 28,
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
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.2, 0.68);
    this.instructionMesh!.position.set(0, RING_Y - 0.5, RING_Z + 0.1);
  }

  private renderInstructions(): void {
    const direction = this.trialOrder[this.currentTrialIndex];
    const disparity = direction === 'convergence'
      ? this.convergenceDisparity
      : this.divergenceDisparity;
    const dMm = (disparity * 1000).toFixed(1);
    const dirLabel = direction === 'convergence' ? 'Converge' : 'Diverge';
    const trialNum = this.currentTrialIndex + 1;

    const lines = [
      `${dirLabel} to fuse the rings (${dMm}mm) — see cross + dot?`,
      `Trigger = fused    A = double    Trial ${trialNum}/${TOTAL_TRIALS}`,
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 96,
      fontSize: 22,
      lineHeight: 1.5,
      color: '#8888aa',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 12,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
