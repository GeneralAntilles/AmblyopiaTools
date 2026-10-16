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
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextPanel, instructionText, feedbackText } from '../../ui/text-panel';
import { COLORS, PANELS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

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
const STEP_UP = 0.006; // Increase disparity after fusion
const STEP_DOWN = 0.008; // Decrease disparity after failure (larger to stay in range)
const MIN_DISPARITY = 0.002;
const MAX_DISPARITY = 0.12;

export class VergenceTrainingExercise extends BaseExercise {
  private trainingRingGroup = new THREE.Group();
  private nonTrainingRingGroup = new THREE.Group();
  private instructions!: TextPanel;
  private feedback!: TextPanel;

  // Staircase state
  private convergenceDisparity = INITIAL_DISPARITY;
  private divergenceDisparity = INITIAL_DISPARITY;
  private maxConvergenceDisparity = 0;
  private maxDivergenceDisparity = 0;

  // Trial state
  private trialOrder: VergenceDirection[] = [];
  private currentTrialIndex = 0;
  private results: TrialResult[] = [];
  private trialStartTime = 0;
  private awaitingResponse = false;

  // Transition animation
  private targetTrainingX = 0;
  private targetNonTrainingX = 0;
  private transitioning = false;

  protected setup(): void {
    // Interleaved trial order
    for (let i = 0; i < TOTAL_TRIALS / 2; i++) {
      this.trialOrder.push('convergence', 'divergence');
    }

    this.addEnvironment();

    // Training eye: ring with a cross inside
    buildRingWithSymbol(this.trainingRingGroup, 'cross', 0xc9935a);
    this.add(this.trainingRingGroup, 'training');

    // Non-training eye: ring with a dot inside
    buildRingWithSymbol(this.nonTrainingRingGroup, 'dot', 0x5a9ac9);
    this.add(this.nonTrainingRingGroup, 'fellow');

    this.instructions = this.panel(PANELS.INSTRUCTION_WIDTH);
    this.instructions.position.set(0, CONTENT_Y + PANELS.INSTRUCTION_Y_OFFSET, RING_Z);

    this.feedback = this.panel(PANELS.FEEDBACK_WIDTH);
    this.feedback.position.set(0, CONTENT_Y + PANELS.FEEDBACK_Y_OFFSET, RING_Z);
    this.feedback.visible = false;

    this.startTrial();

    this.onInput((action) => {
      if (!this.awaitingResponse) return;
      if (action === 'select') this.recordResponse(true);
      else if (action === 'button-a') this.recordResponse(false);
    });

    this.ctx.hud.setStatus('Vergence — trigger=fused, A=double, grip exit');
  }

  protected onUpdate(dt: number): void {
    if (!this.transitioning) return;

    const k = Math.min(1, 4.0 * dt);
    this.trainingRingGroup.position.x = THREE.MathUtils.lerp(this.trainingRingGroup.position.x, this.targetTrainingX, k);
    this.nonTrainingRingGroup.position.x = THREE.MathUtils.lerp(this.nonTrainingRingGroup.position.x, this.targetNonTrainingX, k);

    if (Math.abs(this.trainingRingGroup.position.x - this.targetTrainingX) < 0.0003 &&
        Math.abs(this.nonTrainingRingGroup.position.x - this.targetNonTrainingX) < 0.0003) {
      this.trainingRingGroup.position.x = this.targetTrainingX;
      this.nonTrainingRingGroup.position.x = this.targetNonTrainingX;
      this.transitioning = false;
      this.trialStartTime = this.now();
      this.awaitingResponse = true;
    }
  }

  getStats(): ExerciseStats {
    const conv = this.results.filter((r) => r.direction === 'convergence');
    const div = this.results.filter((r) => r.direction === 'divergence');

    const fusionRate = (arr: TrialResult[]) =>
      arr.length > 0 ? Math.round((arr.filter((r) => r.fused).length / arr.length) * 100) : 0;

    const avgMs = (arr: TrialResult[]) =>
      arr.length > 0 ? Math.round(arr.reduce((s, r) => s + r.reactionTimeMs, 0) / arr.length) : 0;

    return {
      trials: this.results.length,
      fusionRate: fusionRate(this.results),
      convergenceFusionRate: fusionRate(conv),
      divergenceFusionRate: fusionRate(div),
      maxConvergenceDisparityMm: Math.round(this.maxConvergenceDisparity * 1000 * 10) / 10,
      maxDivergenceDisparityMm: Math.round(this.maxDivergenceDisparity * 1000 * 10) / 10,
      avgReactionTimeMs: avgMs(this.results),
      convergenceAvgMs: avgMs(conv),
      divergenceAvgMs: avgMs(div),
    };
  }

  // --- Trial Logic ---

  private currentDisparity(direction: VergenceDirection): number {
    return direction === 'convergence' ? this.convergenceDisparity : this.divergenceDisparity;
  }

  private startTrial(): void {
    const direction = this.trialOrder[this.currentTrialIndex];
    const halfD = this.currentDisparity(direction) / 2;

    if (direction === 'convergence') {
      this.targetTrainingX = halfD;
      this.targetNonTrainingX = -halfD;
    } else {
      this.targetTrainingX = -halfD;
      this.targetNonTrainingX = halfD;
    }

    this.transitioning = true;
    this.awaitingResponse = false;
    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    this.awaitingResponse = false;

    const direction = this.trialOrder[this.currentTrialIndex];
    const disparity = this.currentDisparity(direction);
    this.results.push({ direction, disparityM: disparity, fused, reactionTimeMs: this.now() - this.trialStartTime });

    // Update staircase
    if (fused) {
      if (direction === 'convergence') {
        this.maxConvergenceDisparity = Math.max(this.maxConvergenceDisparity, this.convergenceDisparity);
        this.convergenceDisparity = Math.min(MAX_DISPARITY, this.convergenceDisparity + STEP_UP);
      } else {
        this.maxDivergenceDisparity = Math.max(this.maxDivergenceDisparity, this.divergenceDisparity);
        this.divergenceDisparity = Math.min(MAX_DISPARITY, this.divergenceDisparity + STEP_UP);
      }
    } else if (direction === 'convergence') {
      this.convergenceDisparity = Math.max(MIN_DISPARITY, this.convergenceDisparity - STEP_DOWN);
    } else {
      this.divergenceDisparity = Math.max(MIN_DISPARITY, this.divergenceDisparity - STEP_DOWN);
    }

    this.ctx.input.haptic(fused ? 'confirm' : 'error');

    const dirLabel = direction === 'convergence' ? 'Conv' : 'Div';
    this.feedback.setText(feedbackText(
      fused ? `${dirLabel}: Fused` : `${dirLabel}: Double`,
      fused ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE,
    ));
    this.feedback.visible = true;

    this.after(TIMING.FEEDBACK_MS, () => {
      this.feedback.visible = false;
      this.currentTrialIndex++;
      if (this.currentTrialIndex >= TOTAL_TRIALS) {
        this.finish();
      } else {
        this.startTrial();
      }
    });
  }

  private finish(): void {
    this.trainingRingGroup.visible = false;
    this.nonTrainingRingGroup.visible = false;
    this.instructions.visible = false;

    const stats = this.getStats();
    this.showResults([
      `Vergence Training Complete — ${stats.trials} trials`,
      '',
      `Convergence: ${stats.convergenceFusionRate}% fused`,
      `  Max disparity: ${stats.maxConvergenceDisparityMm}mm`,
      `  Avg reaction: ${stats.convergenceAvgMs}ms`,
      '',
      `Divergence: ${stats.divergenceFusionRate}% fused`,
      `  Max disparity: ${stats.maxDivergenceDisparityMm}mm`,
      `  Avg reaction: ${stats.divergenceAvgMs}ms`,
    ], { x: 0, y: RING_Y - 0.5, z: RING_Z + 0.1 });
  }

  private renderInstructions(): void {
    const direction = this.trialOrder[this.currentTrialIndex];
    const dMm = (this.currentDisparity(direction) * 1000).toFixed(1);
    const dirLabel = direction === 'convergence' ? 'Converge' : 'Diverge';

    this.instructions.setText(instructionText([
      `${dirLabel} to fuse the rings (${dMm}mm) — see cross + dot?`,
      `Trigger = fused    A = double    Trial ${this.currentTrialIndex + 1}/${TOTAL_TRIALS}`,
    ]));
  }
}

function buildRingWithSymbol(group: THREE.Group, symbol: 'cross' | 'dot', color: number): void {
  // Outer ring
  const ringGeo = new THREE.RingGeometry(RING_SIZE * 0.85, RING_SIZE, 48);
  group.add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));

  // Inner ring (thinner, for alignment reference)
  const innerRingGeo = new THREE.RingGeometry(RING_SIZE * 0.45, RING_SIZE * 0.5, 48);
  group.add(new THREE.Mesh(
    innerRingGeo,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
  ));

  if (symbol === 'cross') {
    const hGeo = new THREE.PlaneGeometry(RING_SIZE * 0.5, RING_SIZE * 0.06);
    group.add(new THREE.Mesh(hGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    const vGeo = new THREE.PlaneGeometry(RING_SIZE * 0.06, RING_SIZE * 0.5);
    group.add(new THREE.Mesh(vGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
  } else {
    const dotGeo = new THREE.CircleGeometry(RING_SIZE * 0.12, 24);
    group.add(new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
  }

  group.position.set(0, RING_Y, RING_Z);
}
