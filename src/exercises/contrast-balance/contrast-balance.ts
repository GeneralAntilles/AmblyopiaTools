/**
 * Eye Balance — measures the interocular contrast balance point.
 *
 * Both eyes look at the same grey patch. The training eye sees stripes at
 * full contrast; the fellow eye sees stripes at the orthogonal orientation
 * at a variable contrast. The two compete (binocular rivalry), and the user
 * reports which way the stripes run. When the fellow eye's stripes win, its
 * contrast goes down; when the training eye's win, it goes up.
 *
 * Two interleaved 1-up/1-down staircases (one starting high, one low)
 * converge on the contrast where each eye wins half the time — the balance
 * point. Dichoptic exercises start from there: the fellow eye is weakened
 * just enough for the training eye to compete.
 *
 * Fellow-eye contrast is applied the same way as in dichoptic 2048 (stripe
 * opacity over the grey patch), so the result is in the same units the
 * training uses.
 *
 * Two practice trials come first (stripes in one eye only) so the task is
 * learned before anything is measured; they also confirm each eye can see
 * the stimulus.
 *
 * Controls:
 *   - Stick up/down:    stripes run vertically
 *   - Stick left/right: stripes run horizontally
 *   - Trigger:          patchy / both / can't tell
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextPanel, instructionText, feedbackText } from '../../ui/text-panel';
import { COLORS, PANELS, CONTENT_Y } from '../../ui/vr-constants';

type Orientation = 'vertical' | 'horizontal';
type Report = Orientation | 'mixed';
type Dominance = 'training' | 'fellow' | 'mixed';

interface Staircase {
  contrast: number;
  lastDirection: -1 | 0 | 1;
  reversals: number[];
  trials: number;
}

interface Trial {
  kind: 'practice-training' | 'practice-fellow' | 'measure';
  staircase: number; // index into staircases, -1 for practice
  trainingOrientation: Orientation | null;
  fellowOrientation: Orientation | null;
  fellowContrast: number;
}

// --- Stimulus ---
const PATCH_Z = -2.0;
const PATCH_Y = CONTENT_Y;
const PATCH_RADIUS = 0.15;           // ~8.6° diameter at 2 m
const CYCLES_ACROSS = 12;            // ~1.4 cycles/degree
const GREY = 112;                    // patch mean luminance (0–255)
const FRAME_SIZE = 0.44;             // fusion lock square, both eyes

// --- Timing ---
const FIXATION_MS = 500;
const STIMULUS_MS = 1200;
const PRACTICE_FEEDBACK_MS = 1200;
const INTER_TRIAL_MS = 400;

// --- Staircases ---
const STAIRCASE_STARTS = [0.8, 0.1];
const COARSE_STEP = 1.5;             // multiplicative, until 2 reversals
const FINE_STEP = 1.2;
const MIN_CONTRAST = 0.02;
const MAX_CONTRAST = 1.0;
const REVERSALS_PER_STAIRCASE = 6;
const MAX_TRIALS_PER_STAIRCASE = 16;
const REVERSALS_IN_ESTIMATE = 4;

export class ContrastBalanceExercise extends BaseExercise {
  private trainingGrating!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private fellowGrating!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private instructions!: TextPanel;
  private feedback!: TextPanel;

  private staircases: Staircase[] = STAIRCASE_STARTS.map((c) => ({
    contrast: c,
    lastDirection: 0,
    reversals: [],
    trials: 0,
  }));
  private practice: Trial[] = [];
  private current: Trial | null = null;
  private awaitingResponse = false;
  private trialStart = 0;

  private practiceCorrect = { training: false, fellow: false };
  private measuredTrials = 0;
  private mixedReports = 0;
  private reactionTimes: number[] = [];

  protected setup(): void {
    this.addEnvironment();
    this.createStimulus();

    this.instructions = this.panel(PANELS.INSTRUCTION_WIDTH);
    this.instructions.position.set(0, PATCH_Y - 0.4, PATCH_Z);
    this.instructions.setText(instructionText([
      'Which way do the stripes run? Flick the stick along them',
      '↑↓ vertical    ←→ horizontal    Trigger = patchy / both',
    ]));

    this.feedback = this.panel(PANELS.FEEDBACK_WIDTH * 1.5);
    this.feedback.position.set(0, PATCH_Y + 0.32, PATCH_Z);
    this.feedback.visible = false;

    const first = randomOrientation();
    this.practice = [
      { kind: 'practice-training', staircase: -1, trainingOrientation: first, fellowOrientation: null, fellowContrast: 0 },
      { kind: 'practice-fellow', staircase: -1, trainingOrientation: null, fellowOrientation: other(first), fellowContrast: 1 },
    ];

    this.onInput((action) => {
      if (!this.awaitingResponse) return;
      switch (action) {
        case 'chapter-prev':
        case 'chapter-next':
          this.respond('vertical');
          break;
        case 'page-back':
        case 'page-forward':
          this.respond('horizontal');
          break;
        case 'select':
          this.respond('mixed');
          break;
      }
    });

    this.ctx.hud.setStatus('Eye Balance — stick along the stripes, grip pause');
    this.after(FIXATION_MS, () => this.startTrial());
  }

  getStats(): ExerciseStats {
    const completed = this.isFinished;
    const balance = this.estimateBalance();
    const rt = this.reactionTimes;
    return {
      completed,
      balanceContrast: balance,
      balancePct: Math.round(balance * 100),
      trials: this.measuredTrials,
      mixedRate: this.measuredTrials ? Math.round((this.mixedReports / this.measuredTrials) * 100) : 0,
      practiceTrainingCorrect: this.practiceCorrect.training,
      practiceFellowCorrect: this.practiceCorrect.fellow,
      avgReactionTimeMs: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length) : 0,
    };
  }

  // --- Stimulus ---

  private createStimulus(): void {
    // Grey patch both eyes see; stripes blend over it
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(PATCH_RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${GREY},${GREY},${GREY})`) }),
    );
    patch.position.set(0, PATCH_Y, PATCH_Z);
    this.add(patch, 'both');

    const makeGrating = (eye: 'training' | 'fellow') => {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(PATCH_RADIUS, 64),
        new THREE.MeshBasicMaterial({ map: renderGratingTexture(), transparent: true, depthWrite: false }),
      );
      mesh.position.set(0, PATCH_Y, PATCH_Z + 0.002);
      mesh.visible = false;
      return this.add(mesh, eye);
    };
    this.trainingGrating = makeGrating('training');
    this.fellowGrating = makeGrating('fellow');

    // Fusion lock: square frame and fixation dot, both eyes
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x9688a0 });
    const half = FRAME_SIZE / 2;
    const bar = 0.006;
    const frame = new THREE.Group();
    for (const [w, h, x, y] of [
      [FRAME_SIZE, bar, 0, half], [FRAME_SIZE, bar, 0, -half],
      [bar, FRAME_SIZE, half, 0], [bar, FRAME_SIZE, -half, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frameMat);
      m.position.set(x, y, 0);
      frame.add(m);
    }
    frame.position.set(0, PATCH_Y, PATCH_Z);
    this.add(frame, 'both');

    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), new THREE.MeshBasicMaterial({ color: 0xdbb870 }));
    dot.position.set(0, PATCH_Y, PATCH_Z + 0.004);
    this.add(dot, 'both');
  }

  private showStimulus(trial: Trial): void {
    const set = (mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>, o: Orientation | null, opacity: number) => {
      mesh.visible = o !== null;
      mesh.rotation.z = o === 'horizontal' ? Math.PI / 2 : 0;
      mesh.material.opacity = opacity;
    };
    set(this.trainingGrating, trial.trainingOrientation, 1);
    set(this.fellowGrating, trial.fellowOrientation, trial.fellowContrast);
  }

  private hideStimulus(): void {
    this.trainingGrating.visible = false;
    this.fellowGrating.visible = false;
  }

  // --- Trial flow ---

  private nextTrial(): Trial | null {
    const practice = this.practice.shift();
    if (practice) return practice;

    const open = this.staircases
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.reversals.length < REVERSALS_PER_STAIRCASE && s.trials < MAX_TRIALS_PER_STAIRCASE);
    if (open.length === 0) return null;

    const { s, i } = open[Math.floor(Math.random() * open.length)];
    const trainingOrientation = randomOrientation();
    return {
      kind: 'measure',
      staircase: i,
      trainingOrientation,
      fellowOrientation: other(trainingOrientation),
      fellowContrast: s.contrast,
    };
  }

  private startTrial(): void {
    const trial = this.nextTrial();
    if (!trial) {
      this.finish();
      return;
    }

    this.current = trial;
    this.showStimulus(trial);
    this.trialStart = this.now();
    this.awaitingResponse = true;

    // Brief presentation limits rivalry alternations; answers still count after it hides
    this.after(STIMULUS_MS, () => {
      if (this.current === trial) this.hideStimulus();
    });
  }

  private respond(report: Report): void {
    const trial = this.current;
    if (!trial) return;
    this.awaitingResponse = false;
    this.current = null;
    this.hideStimulus();

    if (trial.kind === 'measure') {
      this.reactionTimes.push(this.now() - this.trialStart);
      this.ctx.input.haptic('tick');
      this.measuredTrials++;
      this.updateStaircase(this.staircases[trial.staircase], dominance(trial, report));
      this.after(INTER_TRIAL_MS + FIXATION_MS, () => this.startTrial());
      return;
    }

    // Practice: there is a right answer — say so
    const shown = trial.trainingOrientation ?? trial.fellowOrientation!;
    const correct = report === shown;
    this.practiceCorrect[trial.kind === 'practice-training' ? 'training' : 'fellow'] = correct;
    this.ctx.input.haptic(correct ? 'confirm' : 'light');
    this.feedback.setText(feedbackText(
      correct ? 'That’s it' : `Those stripes were ${shown}`,
      correct ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_WARNING,
      768,
    ));
    this.feedback.visible = true;
    this.after(PRACTICE_FEEDBACK_MS, () => {
      this.feedback.visible = false;
      this.after(FIXATION_MS, () => this.startTrial());
    });
  }

  private updateStaircase(s: Staircase, who: Dominance): void {
    s.trials++;
    if (who === 'mixed') return; // near balance — hold

    // Fellow eye won → weaken it; training eye won → strengthen the fellow eye
    const direction = who === 'fellow' ? -1 : 1;
    if (s.lastDirection !== 0 && direction !== s.lastDirection) s.reversals.push(s.contrast);
    s.lastDirection = direction;

    const factor = s.reversals.length < 2 ? COARSE_STEP : FINE_STEP;
    s.contrast = clamp(s.contrast * factor ** direction, MIN_CONTRAST, MAX_CONTRAST);
  }

  /** Geometric mean of each staircase's late reversals (or its current level), then of both. */
  private estimateBalance(): number {
    const perStaircase = this.staircases.map((s) => {
      const points = s.reversals.length > 0 ? s.reversals.slice(-REVERSALS_IN_ESTIMATE) : [s.contrast];
      return geometricMean(points);
    });
    return Math.round(geometricMean(perStaircase) * 100) / 100;
  }

  private finish(): void {
    this.instructions.visible = false;
    const stats = this.getStats();
    const lines = [
      'Eye Balance Complete',
      '',
      `Balance point: fellow-eye contrast ${stats.balancePct}%`,
      'At this level both eyes compete equally.',
      'Dichoptic exercises will start from here.',
    ];
    if (!this.practiceCorrect.fellow) {
      lines.push('', 'Note: the fellow-eye practice stripes were missed.');
    }
    this.showResults(lines, { x: 0, y: PATCH_Y, z: PATCH_Z + 0.1 });
  }
}

function dominance(trial: Trial, report: Report): Dominance {
  if (report === 'mixed') return 'mixed';
  return report === trial.fellowOrientation ? 'fellow' : 'training';
}

function randomOrientation(): Orientation {
  return Math.random() < 0.5 ? 'vertical' : 'horizontal';
}

function other(o: Orientation): Orientation {
  return o === 'vertical' ? 'horizontal' : 'vertical';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function geometricMean(values: number[]): number {
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
}

/** Vertical sine grating around the patch grey, full contrast; opacity scales it. */
function renderGratingTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < size; x++) {
    const v = Math.round(GREY + GREY * Math.sin((x / size) * CYCLES_ACROSS * Math.PI * 2));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
