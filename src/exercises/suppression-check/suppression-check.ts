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
 * On fusion responses, enters a vergence offset measurement phase:
 * a crosshair on the non-training eye is moved via joystick to where
 * the user perceives the training eye's red dot. The offset measures
 * vergence error without moving the training eye's stimulus.
 *
 * User reports how many dots they see:
 *   - Trigger: 4 dots (fusion — both eyes contributing)
 *   - A button: 2 dots (non-training eye suppressed)
 *   - B button: 3 dots (training eye suppressed)
 *   - Thumbstick down: 5 dots (diplopia — white dot doubled)
 *
 * Runs 12 trials (4 per distance) and tracks suppression + vergence.
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';
import { createEnvironmentSphere } from '../../ui/vr-environment';
import { COLORS, FONTS, PANELS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

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
  vergenceOffset?: { x: number; y: number };
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
const CROSSHAIR_COLOR = 0xdbb870;

export class SuppressionCheckExercise extends BaseExercise {
  readonly name = 'Suppression Check';
  readonly description = 'Worth 4-dot test to detect binocular suppression.';
  readonly type = 'diagnostic' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private redDot: THREE.Mesh | null = null;
  private redMaterial: THREE.MeshBasicMaterial | null = null;
  private greenDot1: THREE.Mesh | null = null;
  private greenMat1: THREE.MeshBasicMaterial | null = null;
  private greenDot2: THREE.Mesh | null = null;
  private greenMat2: THREE.MeshBasicMaterial | null = null;
  private whiteDot: THREE.Mesh | null = null;
  private whiteMaterial: THREE.MeshBasicMaterial | null = null;
  private fixationGroup: THREE.Group | null = null;
  private fixationMaterial: THREE.MeshBasicMaterial | null = null;
  private crosshairGroup: THREE.Group | null = null;
  private crosshairMaterial: THREE.MeshBasicMaterial | null = null;
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;
  private scatterMesh: THREE.Mesh | null = null;
  private scatterMaterial: THREE.MeshBasicMaterial | null = null;

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

  // Vergence offset measurement
  private offsetPhase: boolean = false;
  private crosshairOffsetX: number = 0;
  private crosshairOffsetY: number = 0;
  private pendingResult: TrialResult | null = null;

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

    this.trialConditions = this.generateTrialConditions();

    this.createEnvironment();
    this.createDots();
    this.createFixationCross();
    this.createCrosshair();

    // Instruction panel (both eyes)
    const instructGeo = new THREE.PlaneGeometry(PANELS.INSTRUCTION_WIDTH, PANELS.INSTRUCTION_HEIGHT);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, DOT_Y - 0.4, PANELS.INSTRUCTION_Z);
    this.renderer.addToBothEyes(this.instructionMesh);

    // Feedback panel (both eyes)
    const feedbackGeo = new THREE.PlaneGeometry(PANELS.FEEDBACK_WIDTH, PANELS.FEEDBACK_HEIGHT);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, DOT_Y + 0.35, -1.8);
    this.feedbackMesh.visible = false;
    this.renderer.addToBothEyes(this.feedbackMesh);

    // Scatter plot panel (both eyes, shown during results)
    const scatterGeo = new THREE.PlaneGeometry(0.8, 0.8);
    this.scatterMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.scatterMesh = new THREE.Mesh(scatterGeo, this.scatterMaterial);
    this.scatterMesh.visible = false;
    this.renderer.addToBothEyes(this.scatterMesh);

    this.renderInstructions();

    // Input
    this.unsubInput = this.input.onAction((action) => {
      if (this.completed) {
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      // During offset measurement, only trigger and exit work
      if (this.offsetPhase) {
        if (action === 'select') {
          this.confirmOffset();
        } else if (action === 'exit') {
          this.exitCallback?.();
        }
        return;
      }

      if (this.awaitingResponse) {
        switch (action) {
          case 'select':
            this.recordResponse('fusion');
            break;
          case 'button-a':
            this.recordResponse('fellow-suppressed');
            break;
          case 'button-b':
            this.recordResponse('training-suppressed');
            break;
          case 'chapter-next':
            this.recordResponse('diplopia');
            break;
        }
      }

      if (action === 'exit') {
        this.exitCallback?.();
      }
    });

    this.beginInterTrial();
    this.markStarted();
  }

  update(dt: number): void {
    const now = Date.now();

    // Crosshair positioning during offset phase via controller ray
    if (this.offsetPhase && this.crosshairGroup && this.renderer && this.redDot) {
      // Get world position of the red dot (defines the plane we intersect)
      const redDotWorld = new THREE.Vector3();
      this.redDot.getWorldPosition(redDotWorld);

      // Define a plane at the red dot's depth, facing the user (normal = +Z)
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -redDotWorld.z);

      // Try each controller — use the first one that's tracked
      let intersection: THREE.Vector3 | null = null;
      for (let i = 0; i < 2; i++) {
        const ray = this.renderer.getControllerRay(i);
        if (!ray) continue;

        const threeRay = new THREE.Ray(ray.origin, ray.direction);
        const target = new THREE.Vector3();
        const hit = threeRay.intersectPlane(plane, target);
        if (hit) {
          intersection = target;
          break;
        }
      }

      if (intersection) {
        // Convert intersection from world space to content-local space
        const localHit = this.renderer.worldToContentLocal(intersection);

        // Compute offset from red dot position (both in content-local space)
        this.crosshairOffsetX = localHit.x - this.redDot.position.x;
        this.crosshairOffsetY = localHit.y - this.redDot.position.y;

        // Clamp to reasonable range
        const dist = Math.abs(this.trialConditions[this.currentTrial]?.distance ?? -1.8);
        const maxOffset = 0.3 * (dist / REF_DISTANCE);
        this.crosshairOffsetX = THREE.MathUtils.clamp(this.crosshairOffsetX, -maxOffset, maxOffset);
        this.crosshairOffsetY = THREE.MathUtils.clamp(this.crosshairOffsetY, -maxOffset, maxOffset);

        this.crosshairGroup.position.set(
          this.redDot.position.x + this.crosshairOffsetX,
          this.redDot.position.y + this.crosshairOffsetY,
          this.redDot.position.z,
        );
      }

      // Pulse crosshair gently
      if (this.crosshairMaterial) {
        this.crosshairMaterial.opacity = 0.6 + 0.3 * Math.sin(now * 0.004);
      }
    }

    // Feedback timeout -> inter-trial or results
    if (this.showingFeedback && now > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;

      if (this.currentTrial >= TOTAL_TRIALS) {
        this.showResults();
      } else {
        this.beginInterTrial();
      }
    }

    // Inter-trial fixation -> start trial with fade-in
    if (this.interTrialActive && now > this.interTrialEndTime) {
      this.interTrialActive = false;
      if (this.fixationGroup) this.fixationGroup.visible = false;
      this.startTrial();
    }

    // Dot fade-in animation
    if (this.fadingIn) {
      const elapsed = now - this.fadeStartTime;
      const t = Math.min(1, elapsed / TIMING.FADE_IN_MS);
      const alpha = 1 - (1 - t) * (1 - t); // ease-out

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
      if (this.fixationGroup) this.renderer.removeFromScene(this.fixationGroup);
      if (this.crosshairGroup) this.renderer.removeFromScene(this.crosshairGroup);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
      if (this.scatterMesh) this.renderer.removeFromScene(this.scatterMesh);
    }

    this.redDot?.geometry.dispose();
    this.redMaterial?.dispose();
    this.greenDot1?.geometry.dispose();
    this.greenMat1?.dispose();
    this.greenDot2?.geometry.dispose();
    this.greenMat2?.dispose();
    this.whiteDot?.geometry.dispose();
    this.whiteMaterial?.dispose();
    this.fixationGroup?.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.fixationMaterial?.dispose();
    this.crosshairGroup?.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.crosshairMaterial?.dispose();
    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.instructionMesh?.geometry.dispose();
    this.instructionMaterial?.map?.dispose();
    this.instructionMaterial?.dispose();
    this.feedbackMesh?.geometry.dispose();
    this.feedbackMaterial?.map?.dispose();
    this.feedbackMaterial?.dispose();
    this.scatterMesh?.geometry.dispose();
    this.scatterMaterial?.map?.dispose();
    this.scatterMaterial?.dispose();

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

    const perDistance: Record<string, number> = {};
    for (const [label, data] of Object.entries(distanceCounts)) {
      perDistance[label] = Math.round((data.fusion / data.total) * 100);
    }

    // Vergence offset stats
    const offsets = this.results
      .filter((r) => r.vergenceOffset)
      .map((r) => r.vergenceOffset!);

    let avgOffsetMm = 0;
    if (offsets.length > 0) {
      const totalMag = offsets.reduce(
        (sum, o) => sum + Math.sqrt(o.x * o.x + o.y * o.y),
        0,
      );
      avgOffsetMm = Math.round((totalMag / offsets.length) * 1000);
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
      avgVergenceOffsetMm: avgOffsetMm,
      vergenceOffsetCount: offsets.length,
      vergenceOffsets: this.results
        .filter((r) => r.vergenceOffset)
        .map((r) => ({
          xMm: Math.round(r.vergenceOffset!.x * 1000),
          yMm: Math.round(r.vergenceOffset!.y * 1000),
          distance: r.condition.distanceLabel,
        })),
    };
  }

  // --- Trial Condition Generation ---

  private generateTrialConditions(): TrialCondition[] {
    const conditions: TrialCondition[] = [];

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

    const { mesh, material } = createEnvironmentSphere(this.renderer);
    this.envSphereMesh = mesh;
    this.envMaterial = material;
  }

  private createDots(): void {
    if (!this.renderer) return;

    const dotGeo = new THREE.CircleGeometry(DOT_RADIUS_BASE, 32);

    this.redMaterial = new THREE.MeshBasicMaterial({
      color: RED, transparent: true, opacity: 0,
    });
    this.redDot = new THREE.Mesh(dotGeo.clone(), this.redMaterial);
    this.renderer.addToTrainingEye(this.redDot);

    this.greenMat1 = new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0,
    });
    this.greenDot1 = new THREE.Mesh(dotGeo.clone(), this.greenMat1);
    this.renderer.addToNonTrainingEye(this.greenDot1);

    this.greenMat2 = new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0,
    });
    this.greenDot2 = new THREE.Mesh(dotGeo.clone(), this.greenMat2);
    this.renderer.addToNonTrainingEye(this.greenDot2);

    this.whiteMaterial = new THREE.MeshBasicMaterial({
      color: WHITE, transparent: true, opacity: 0,
    });
    this.whiteDot = new THREE.Mesh(dotGeo.clone(), this.whiteMaterial);
    this.renderer.addToBothEyes(this.whiteDot);
  }

  private createFixationCross(): void {
    if (!this.renderer) return;

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

    this.fixationGroup = group;
    this.renderer.addToBothEyes(group);
  }

  private createCrosshair(): void {
    if (!this.renderer) return;

    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: CROSSHAIR_COLOR, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this.crosshairMaterial = mat;

    // "+" shape — slightly larger than the dots
    const hBar = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.005), mat);
    const vBar = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.08), mat);
    group.add(hBar, vBar);
    group.visible = false;

    this.crosshairGroup = group;
    this.renderer.addToNonTrainingEye(group);
  }

  // --- Trial Logic ---

  private beginInterTrial(): void {
    this.setDotsOpacity(0);

    const condition = this.trialConditions[this.currentTrial];
    if (this.fixationGroup) {
      this.fixationGroup.position.z = condition.distance;
      this.fixationGroup.visible = true;
    }

    this.interTrialActive = true;
    this.interTrialEndTime = Date.now() + TIMING.INTER_TRIAL_MS;
    this.renderInstructions();
  }

  private startTrial(): void {
    const condition = this.trialConditions[this.currentTrial];

    this.positionDots(condition);

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

    const positions = [
      { dx: Math.sin(rot) * spread, dy: Math.cos(rot) * spread },
      { dx: Math.sin(rot - Math.PI / 2) * spread, dy: Math.cos(rot - Math.PI / 2) * spread },
      { dx: Math.sin(rot + Math.PI / 2) * spread, dy: Math.cos(rot + Math.PI / 2) * spread },
      { dx: Math.sin(rot + Math.PI) * spread, dy: Math.cos(rot + Math.PI) * spread },
    ];

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

    if (response === 'fusion') {
      // Enter offset measurement phase — dots stay visible
      this.input?.haptic('confirm');
      this.pendingResult = { response, reactionTimeMs, condition };
      this.enterOffsetPhase(condition);
    } else {
      this.input?.haptic('light');
      this.results.push({ response, reactionTimeMs, condition });
      this.currentTrial++;
      this.setDotsOpacity(0);
      this.showFeedback(response, condition);
    }
  }

  // --- Vergence Offset Measurement ---

  private enterOffsetPhase(condition: TrialCondition): void {
    this.offsetPhase = true;
    this.crosshairOffsetX = 0;
    this.crosshairOffsetY = 0;

    // Position crosshair at red dot's location (zero offset = perfect alignment)
    if (this.crosshairGroup && this.redDot) {
      this.crosshairGroup.position.copy(this.redDot.position);
      this.crosshairGroup.visible = true;
      const scale = Math.abs(condition.distance) / REF_DISTANCE;
      this.crosshairGroup.scale.set(scale, scale, 1);
    }

    this.renderOffsetInstructions();
  }

  private confirmOffset(): void {
    this.input?.haptic('medium');
    this.offsetPhase = false;
    if (this.crosshairGroup) this.crosshairGroup.visible = false;

    const result = this.pendingResult!;
    result.vergenceOffset = { x: this.crosshairOffsetX, y: this.crosshairOffsetY };
    this.results.push(result);
    this.currentTrial++;
    this.pendingResult = null;

    this.setDotsOpacity(0);

    const offsetMm = Math.round(
      Math.sqrt(
        this.crosshairOffsetX * this.crosshairOffsetX +
        this.crosshairOffsetY * this.crosshairOffsetY,
      ) * 1000,
    );
    this.showFeedback(result.response, result.condition, offsetMm);
  }

  private renderOffsetInstructions(): void {
    const tex = this.textRenderer.renderToTexture({
      text: 'Point controller where you see the red dot\nAim to move  •  Trigger to confirm',
      width: 1024,
      height: 140,
      fontSize: FONTS.INSTRUCTION,
      lineHeight: 1.6,
      color: COLORS.TEXT_SPECIAL,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }

  // --- Feedback ---

  private showFeedback(
    response: SuppressionResult,
    condition: TrialCondition,
    offsetMm?: number,
  ): void {
    const labels: Record<SuppressionResult, string> = {
      fusion: '4 dots — Fusion',
      'fellow-suppressed': '2 dots — Fellow eye suppressed',
      'training-suppressed': '3 dots — Training eye suppressed',
      diplopia: '5 dots — Diplopia',
    };

    const colors: Record<SuppressionResult, string> = {
      fusion: COLORS.FEEDBACK_SUCCESS,
      'fellow-suppressed': COLORS.FEEDBACK_WARNING,
      'training-suppressed': COLORS.FEEDBACK_WARNING,
      diplopia: COLORS.FEEDBACK_FAILURE,
    };

    const distLabel = condition.distanceLabel.charAt(0).toUpperCase() + condition.distanceLabel.slice(1);
    let text = `${distLabel}: ${labels[response]}`;
    if (offsetMm !== undefined) {
      text += `  (${offsetMm}mm offset)`;
    }

    const tex = this.textRenderer.renderToTexture({
      text,
      width: 900,
      height: 80,
      fontSize: FONTS.FEEDBACK,
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
    this.feedbackTimeout = Date.now() + TIMING.FEEDBACK_MS;
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
    ];

    if ((stats.vergenceOffsetCount as number) > 0) {
      lines.push('');
      lines.push(`Avg vergence offset: ${stats.avgVergenceOffsetMm}mm`);
      lines.push(`  (${stats.vergenceOffsetCount} measurements)`);
    }

    lines.push('', 'Grip to exit');

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 880,
      fontSize: FONTS.RESULTS,
      lineHeight: 1.4,
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
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.3, 1.1);
    this.instructionMesh!.position.set(0, DOT_Y - 0.55, -1.7);

    this.feedbackMesh!.visible = false;

    // Render and show scatter plot if there are offset measurements
    const scatterTex = this.renderScatterPlot();
    if (scatterTex && this.scatterMesh && this.scatterMaterial) {
      this.scatterMaterial.map = scatterTex;
      this.scatterMaterial.needsUpdate = true;
      this.scatterMesh.position.set(1.1, DOT_Y - 0.55, -1.7);
      this.scatterMesh.visible = true;
    }
  }

  private renderScatterPlot(): THREE.CanvasTexture | null {
    const offsets = this.results
      .filter((r) => r.vergenceOffset)
      .map((r) => ({
        x: r.vergenceOffset!.x,
        y: r.vergenceOffset!.y,
        distance: r.condition.distanceLabel,
      }));

    if (offsets.length === 0) return null;

    const SIZE = 800;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = COLORS.PANEL_BG;
    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, 24);
    ctx.fill();

    // Border
    ctx.strokeStyle = COLORS.PANEL_BORDER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, SIZE - 3, SIZE - 3, 24);
    ctx.stroke();

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const plotRadius = SIZE * 0.35;

    // Scale: 30mm maps to plotRadius (covers clinically meaningful FD range)
    const maxMm = 30;
    const scale = plotRadius / maxMm;

    // Title
    ctx.fillStyle = '#e0d6cc';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Vergence Offset Map', cx, 20);

    // Concentric range circles
    const rings = [5, 10, 20];
    ctx.strokeStyle = '#2a2235';
    ctx.lineWidth = 1;
    for (const mm of rings) {
      const r = mm * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#5a4f66';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${mm}mm`, cx + r + 4, cy - 2);
    }

    // Crosshair grid lines
    ctx.strokeStyle = '#3a2f46';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - plotRadius - 20, cy);
    ctx.lineTo(cx + plotRadius + 20, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - plotRadius - 20);
    ctx.lineTo(cx, cy + plotRadius + 20);
    ctx.stroke();

    // Axis labels — nasal/temporal depends on training eye
    const isRightEye = this.renderer?.getTrainingEye() === 'right';
    const leftLabel = isRightEye ? 'Nasal (eso)' : 'Temporal (exo)';
    const rightLabel = isRightEye ? 'Temporal (exo)' : 'Nasal (eso)';

    ctx.fillStyle = '#7a6f88';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(rightLabel, cx + plotRadius + 8, cy + 18);

    ctx.textAlign = 'right';
    ctx.fillText(leftLabel, cx - plotRadius - 8, cy + 18);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Up (hyper)', cx, cy - plotRadius - 8);
    ctx.textBaseline = 'top';
    ctx.fillText('Down (hypo)', cx, cy + plotRadius + 8);

    // Distance color map
    const distColors: Record<string, string> = {
      near: '#5ac97a',
      medium: '#c9a85a',
      far: '#c95a5a',
    };

    // Legend
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let legendY = SIZE - 60;
    for (const [label, color] of Object.entries(distColors)) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx - 80, legendY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label.charAt(0).toUpperCase() + label.slice(1), cx - 66, legendY);
      legendY += 20;
    }

    // Plot data points
    for (const pt of offsets) {
      const color = distColors[pt.distance] ?? '#888888';
      const px = cx + (pt.x * 1000) * scale;
      // Canvas Y is inverted (positive offset = up in scene = up on chart)
      const py = cy - (pt.y * 1000) * scale;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Center dot (zero offset = perfect alignment)
    ctx.fillStyle = '#dbb870';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
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
      fontSize: FONTS.INSTRUCTION,
      lineHeight: 1.5,
      color: COLORS.TEXT_INSTRUCTION,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
