/**
 * Virtual Brock String Exercise — Progressive NPC Measurement
 *
 * VR implementation of the clinical Brock string convergence exercise.
 * A string stretches from the user's controller (held near the nose)
 * toward the distance with a single bead that progressively moves closer.
 *
 * Uses a 1-up/1-down staircase: fused → move bead closer (harder),
 * double → move bead farther (easier). Tracks reversal points to
 * converge on the Near Point of Convergence (NPC).
 *
 * The bead color shifts green→gold→red as it approaches, giving
 * intuitive visual feedback about convergence demand.
 *
 * Controller-attached mode: the string's near end tracks whichever
 * controller the user moves toward the golden guide ring.
 *
 * Controls:
 *   - Trigger: confirm convergence ("I see the X")
 *   - A button: can't fuse / seeing double
 *   - Grip: exit
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseConfig, type SessionStats } from '../base-exercise';
import type { PerEyeRenderer } from '../../core/per-eye-renderer';
import type { InputManager } from '../../core/input-manager';
import { TextRenderer } from '../../utils/text-renderer';
import { createEnvironmentSphere } from '../../ui/vr-environment';
import { COLORS, FONTS, PANELS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

interface TrialResult {
  z: number;
  distanceCm: number;
  fused: boolean;
  reactionTimeMs: number;
}

// --- Staircase parameters ---
const START_Z = -2.5;           // Start far (easy convergence)
const STEP_CLOSER = 0.15;      // 15cm closer after fusion
const STEP_FARTHER = 0.20;     // 20cm farther after double (conservative)
const MIN_Z = -0.45;           // Closest the bead can go
const MAX_Z = -2.8;            // Farthest the bead can go
const REVERSALS_TO_END = 6;    // End after 6 direction changes
const MAX_TRIALS = 30;         // Safety cap

// --- String geometry ---
const STRING_Y = 1.5;
const STRING_START_Z = -0.4;
const STRING_END_Z = -3.0;
const BEAD_RADIUS = 0.03;
const STRING_SEGMENTS = 32;
const STRING_SAG = 0.06;       // Max droop per meter of length

// --- Bead color gradient (far→near) ---
const COLOR_FAR = new THREE.Color(0x5ac97a);   // Green (easy)
const COLOR_MID = new THREE.Color(0xdbb870);   // Gold (medium)
const COLOR_NEAR = new THREE.Color(0xc95a5a);  // Red (hard)

export class BrockStringExercise extends BaseExercise {
  readonly name = 'Brock String';
  readonly description = 'Progressive convergence training — how close can you fuse?';
  readonly type = 'binocular' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private stringMesh: THREE.Mesh | null = null;
  private stringMaterial: THREE.MeshBasicMaterial | null = null;
  private beadMesh: THREE.Mesh | null = null;
  private beadMaterial: THREE.MeshBasicMaterial | null = null;
  private highlightRing: THREE.Mesh | null = null;
  private highlightMaterial: THREE.MeshBasicMaterial | null = null;
  private envSphereMesh: THREE.Mesh | null = null;
  private envMaterial: THREE.MeshBasicMaterial | null = null;
  private instructionMesh: THREE.Mesh | null = null;
  private instructionMaterial: THREE.MeshBasicMaterial | null = null;
  private feedbackMesh: THREE.Mesh | null = null;
  private feedbackMaterial: THREE.MeshBasicMaterial | null = null;
  private guideMesh: THREE.Mesh | null = null;
  private guideMaterial: THREE.MeshBasicMaterial | null = null;
  private arrowMeshes: THREE.Mesh[] = [];
  private arrowMaterials: THREE.MeshBasicMaterial[] = [];

  // Staircase state
  private currentZ: number = START_Z;
  private previousDirection: 'closer' | 'farther' | null = null;
  private reversalCount: number = 0;
  private reversalZs: number[] = [];
  private results: TrialResult[] = [];
  private trialStartTime: number = 0;
  private awaitingResponse: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private completed: boolean = false;
  private pulseTime: number = 0;
  private waitingForStart: boolean = false;

  // Bead transition animation
  private beadTransitioning: boolean = false;
  private beadTargetZ: number = START_Z;

  // Controller-attached mode
  private controllerAttached: boolean = false;
  private controllerIndex: number = -1;
  private stringNearEnd: THREE.Vector3 = new THREE.Vector3(0, STRING_Y, STRING_START_Z);
  private readonly stringFarEnd: THREE.Vector3 = new THREE.Vector3(0, STRING_Y, STRING_END_Z);
  private stringCurve: THREE.CatmullRomCurve3 | null = null;

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
    this.currentZ = START_Z;
    this.previousDirection = null;
    this.reversalCount = 0;
    this.reversalZs = [];
    this.controllerAttached = false;
    this.controllerIndex = -1;
    this.stringNearEnd.set(0, STRING_Y, STRING_START_Z);

    this.createEnvironment();
    this.createString();
    this.createBead();
    this.createHighlightRing();
    this.createUI();
    this.createGuide();

    this.waitingForStart = true;
    this.showControllerPrompt();

    this.unsubInput = this.input.onAction((action) => {
      if (this.completed) {
        if (action === 'exit') this.exitCallback?.();
        return;
      }

      if (this.waitingForStart && action === 'select') {
        this.input?.haptic('light');
        this.attachNearestController();
        this.waitingForStart = false;
        if (this.guideMesh) this.guideMesh.visible = false;
        for (const a of this.arrowMeshes) a.visible = false;
        this.startTrial();
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

  update(dt: number): void {
    this.pulseTime += dt;

    // Controller-attached string tracking
    if (this.controllerAttached && this.renderer) {
      const pos = this.renderer.getControllerPosition(this.controllerIndex);
      if (pos) {
        const localPos = this.renderer.worldToContentLocal(pos);
        this.stringNearEnd.copy(localPos);
        this.rebuildStringGeometry(localPos, this.stringFarEnd);
        this.repositionBead();

        // Keep highlight ring on bead
        if (this.highlightRing?.visible && !this.beadTransitioning) {
          this.highlightRing.position.copy(this.beadMesh!.position);
        }
      }
    }

    // Guide phase: detect controller proximity
    if (this.waitingForStart && this.guideMesh && this.renderer) {
      const guideWorldPos = new THREE.Vector3();
      this.guideMesh.getWorldPosition(guideWorldPos);

      let closestDist = Infinity;
      let closestIndex = -1;
      let closestPos: THREE.Vector3 | null = null;

      for (let i = 0; i < 2; i++) {
        const pos = this.renderer.getControllerPosition(i);
        if (pos) {
          const dist = pos.distanceTo(guideWorldPos);
          if (dist < closestDist) {
            closestDist = dist;
            closestIndex = i;
            closestPos = pos;
          }
        }
      }

      if (closestPos && closestDist < 0.15) {
        this.controllerAttached = true;
        this.controllerIndex = closestIndex;
        this.waitingForStart = false;
        this.guideMesh.visible = false;
        for (const a of this.arrowMeshes) a.visible = false;
        this.startTrial();
      } else if (closestPos) {
        const t = Math.max(0, Math.min(1, 1 - (closestDist - 0.15) / 0.6));
        if (t > 0.6) {
          this.guideMaterial!.color.set(0x5ac97a);
        } else if (t > 0.3) {
          this.guideMaterial!.color.set(0xc9a85a);
        } else {
          this.guideMaterial!.color.set(0xc95a5a);
        }

        const guidePulse = 0.4 + 0.3 * Math.sin(this.pulseTime * 3);
        this.guideMaterial!.opacity = guidePulse;

        for (let i = 0; i < this.arrowMeshes.length; i++) {
          const frac = 0.3 + i * 0.2;
          const worldPos = new THREE.Vector3().lerpVectors(closestPos, guideWorldPos, frac);
          const localPos = this.renderer.worldToContentLocal(worldPos);
          this.arrowMeshes[i].position.copy(localPos);

          const phase = this.pulseTime * 4 - i * 1.2;
          const pulse = 0.2 + 0.5 * Math.max(0, Math.sin(phase));
          this.arrowMaterials[i].opacity = pulse;
        }
      }
    }

    // Smooth bead transition to new Z
    if (this.beadTransitioning && this.beadMesh) {
      const targetPos = this.getBeadPosition(this.beadTargetZ);
      this.beadMesh.position.lerp(targetPos, Math.min(1, 4.0 * dt));
      if (this.highlightRing) {
        this.highlightRing.position.copy(this.beadMesh.position);
      }

      if (this.beadMesh.position.distanceTo(targetPos) < 0.01) {
        this.beadMesh.position.copy(targetPos);
        if (this.highlightRing) this.highlightRing.position.copy(targetPos);
        this.beadTransitioning = false;
        this.currentZ = this.beadTargetZ;
        this.updateBeadColor();
        this.trialStartTime = Date.now();
        this.awaitingResponse = true;
      }
    }

    // Pulse the highlight ring
    if (this.highlightRing?.visible && !this.beadTransitioning) {
      const scale = 1.0 + 0.15 * Math.sin(this.pulseTime * 4);
      this.highlightRing.scale.set(scale, scale, 1);
    }

    // Feedback timeout
    if (this.showingFeedback && Date.now() > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;
      this.advanceTrial();
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      if (this.stringMesh) this.renderer.removeFromScene(this.stringMesh);
      if (this.beadMesh) this.renderer.removeFromScene(this.beadMesh);
      if (this.highlightRing) this.renderer.removeFromScene(this.highlightRing);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
      if (this.guideMesh) this.renderer.removeFromScene(this.guideMesh);
      for (const a of this.arrowMeshes) this.renderer.removeFromScene(a);
    }

    this.stringMesh?.geometry.dispose();
    this.stringMaterial?.dispose();
    this.beadMesh?.geometry.dispose();
    this.beadMaterial?.dispose();
    this.highlightRing?.geometry.dispose();
    this.highlightMaterial?.dispose();
    this.envSphereMesh?.geometry.dispose();
    this.envMaterial?.map?.dispose();
    this.envMaterial?.dispose();
    this.instructionMesh?.geometry.dispose();
    this.instructionMaterial?.map?.dispose();
    this.instructionMaterial?.dispose();
    this.feedbackMesh?.geometry.dispose();
    this.feedbackMaterial?.map?.dispose();
    this.feedbackMaterial?.dispose();
    this.guideMesh?.geometry.dispose();
    this.guideMaterial?.dispose();
    for (let i = 0; i < this.arrowMeshes.length; i++) {
      this.arrowMeshes[i].geometry.dispose();
      this.arrowMaterials[i].dispose();
    }

    this.renderer = null;
    this.input = null;
  }

  getSessionStats(): SessionStats {
    let fusedCount = 0;
    let totalReaction = 0;

    for (const r of this.results) {
      if (r.fused) fusedCount++;
      totalReaction += r.reactionTimeMs;
    }

    const total = this.results.length || 1;
    const npcMeters = this.calculateNPC();
    const npcCm = Math.round(npcMeters * 100);

    return {
      exercise: 'brock-string',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      fusionRate: Math.round((fusedCount / total) * 100),
      avgReactionTimeMs: Math.round(totalReaction / total),
      npcMeters,
      npcCm,
      reversals: this.reversalCount,
    };
  }

  // --- NPC Calculation ---

  private calculateNPC(): number {
    if (this.reversalZs.length === 0) {
      // No reversals yet — use the closest Z where they fused
      const fusedResults = this.results.filter((r) => r.fused);
      if (fusedResults.length === 0) return Math.abs(START_Z - STRING_START_Z);
      const closestFused = fusedResults.reduce((a, b) => (a.z > b.z ? a : b));
      return Math.abs(closestFused.z - this.stringNearEnd.z);
    }

    // Average the last 4 reversal Z positions (or all if fewer)
    const recent = this.reversalZs.slice(-4);
    const avgZ = recent.reduce((sum, z) => sum + z, 0) / recent.length;
    return Math.abs(avgZ - this.stringNearEnd.z);
  }

  // --- Scene Setup ---

  private createEnvironment(): void {
    if (!this.renderer) return;
    const { mesh, material } = createEnvironmentSphere(this.renderer);
    this.envSphereMesh = mesh;
    this.envMaterial = material;
  }

  private createString(): void {
    if (!this.renderer) return;
    this.stringMaterial = new THREE.MeshBasicMaterial({ color: 0xddd0c0 });
    this.rebuildStringGeometry(this.stringNearEnd, this.stringFarEnd);
  }

  private buildStringCurve(near: THREE.Vector3, far: THREE.Vector3): THREE.CatmullRomCurve3 {
    const length = near.distanceTo(far);
    const sagAmount = STRING_SAG * length;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= STRING_SEGMENTS; i++) {
      const t = i / STRING_SEGMENTS;
      const pos = new THREE.Vector3().lerpVectors(near, far, t);
      const sag = sagAmount * 4 * t * (1 - t);
      pos.y -= sag;
      points.push(pos);
    }

    return new THREE.CatmullRomCurve3(points);
  }

  private rebuildStringGeometry(near: THREE.Vector3, far: THREE.Vector3): void {
    if (!this.stringMaterial || !this.renderer) return;

    this.stringCurve = this.buildStringCurve(near, far);
    const geo = new THREE.TubeGeometry(this.stringCurve, STRING_SEGMENTS, 0.002, 6, false);

    if (this.stringMesh) {
      this.stringMesh.geometry.dispose();
      this.stringMesh.geometry = geo;
    } else {
      this.stringMesh = new THREE.Mesh(geo, this.stringMaterial);
      this.renderer.addToBothEyes(this.stringMesh);
    }
  }

  private createBead(): void {
    if (!this.renderer) return;

    const beadGeo = new THREE.SphereGeometry(BEAD_RADIUS, 16, 12);
    this.beadMaterial = new THREE.MeshBasicMaterial({ color: 0x5ac97a });
    this.beadMesh = new THREE.Mesh(beadGeo, this.beadMaterial);

    const pos = this.getBeadPosition(this.currentZ);
    this.beadMesh.position.copy(pos);
    this.updateBeadColor();

    this.renderer.addToBothEyes(this.beadMesh);
  }

  private getBeadPosition(z: number): THREE.Vector3 {
    if (!this.stringCurve) {
      return new THREE.Vector3(0, STRING_Y, z);
    }
    const nearZ = this.stringNearEnd.z;
    const farZ = this.stringFarEnd.z;
    const proportion = Math.max(0, Math.min(1, (z - nearZ) / (farZ - nearZ)));
    return this.stringCurve.getPointAt(proportion);
  }

  private repositionBead(): void {
    if (!this.beadMesh || !this.stringCurve || this.beadTransitioning) return;
    const pos = this.getBeadPosition(this.currentZ);
    this.beadMesh.position.copy(pos);
  }

  private updateBeadColor(): void {
    if (!this.beadMaterial) return;

    // Lerp: MAX_Z (far, green) → midpoint (gold) → MIN_Z (near, red)
    const t = Math.max(0, Math.min(1, (this.currentZ - MAX_Z) / (MIN_Z - MAX_Z)));
    const color = new THREE.Color();

    if (t < 0.5) {
      color.lerpColors(COLOR_FAR, COLOR_MID, t * 2);
    } else {
      color.lerpColors(COLOR_MID, COLOR_NEAR, (t - 0.5) * 2);
    }

    this.beadMaterial.color.copy(color);
  }

  private createHighlightRing(): void {
    if (!this.renderer) return;

    const ringGeo = new THREE.RingGeometry(BEAD_RADIUS * 1.8, BEAD_RADIUS * 2.4, 32);
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xdbb870,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.highlightRing = new THREE.Mesh(ringGeo, this.highlightMaterial);

    const pos = this.getBeadPosition(this.currentZ);
    this.highlightRing.position.copy(pos);
    this.renderer.addToBothEyes(this.highlightRing);
  }

  private createUI(): void {
    if (!this.renderer) return;

    const instructGeo = new THREE.PlaneGeometry(PANELS.INSTRUCTION_WIDTH, PANELS.INSTRUCTION_HEIGHT);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, CONTENT_Y + PANELS.INSTRUCTION_Y_OFFSET, -2.0);
    this.renderer.addToBothEyes(this.instructionMesh);

    const feedbackGeo = new THREE.PlaneGeometry(PANELS.FEEDBACK_WIDTH, PANELS.FEEDBACK_HEIGHT);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, CONTENT_Y + PANELS.FEEDBACK_Y_OFFSET, -2.0);
    this.feedbackMesh.visible = false;
    this.renderer.addToBothEyes(this.feedbackMesh);
  }

  private createGuide(): void {
    if (!this.renderer) return;

    const guideGeo = new THREE.TorusGeometry(0.05, 0.008, 12, 32);
    this.guideMaterial = new THREE.MeshBasicMaterial({
      color: 0xdbb870,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    this.guideMesh = new THREE.Mesh(guideGeo, this.guideMaterial);
    this.guideMesh.position.set(0, STRING_Y, STRING_START_Z);
    this.renderer.addToBothEyes(this.guideMesh);

    // Flat chevron waypoint markers
    const cs = 0.03;
    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(-cs * 0.4, cs);
    chevronShape.lineTo(cs * 0.5, 0);
    chevronShape.lineTo(-cs * 0.4, -cs);
    chevronShape.lineTo(-cs * 0.05, -cs * 0.45);
    chevronShape.lineTo(cs * 0.12, 0);
    chevronShape.lineTo(-cs * 0.05, cs * 0.45);
    chevronShape.closePath();
    const chevronGeo = new THREE.ShapeGeometry(chevronShape);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdbb870,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(chevronGeo.clone(), mat);
      mesh.position.set(0, STRING_Y, STRING_START_Z + 0.15 + i * 0.12);
      this.renderer!.addToBothEyes(mesh);
      this.arrowMeshes.push(mesh);
      this.arrowMaterials.push(mat);
    }
  }

  // --- Controller Attachment ---

  private attachNearestController(): void {
    if (!this.renderer) return;

    for (let i = 0; i < 2; i++) {
      const pos = this.renderer.getControllerPosition(i);
      if (pos) {
        this.controllerAttached = true;
        this.controllerIndex = i;
        return;
      }
    }
    this.controllerAttached = false;
  }

  // --- Trial Logic ---

  private startTrial(): void {
    this.highlightRing!.visible = true;
    this.awaitingResponse = false;
    this.pulseTime = 0;

    // Move bead to currentZ with animation
    this.beadTargetZ = this.currentZ;
    this.beadTransitioning = true;

    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    const distanceCm = Math.round(Math.abs(this.currentZ - this.stringNearEnd.z) * 100);

    this.results.push({
      z: this.currentZ,
      distanceCm,
      fused,
      reactionTimeMs,
    });

    // Check for reversal
    const direction: 'closer' | 'farther' = fused ? 'closer' : 'farther';
    if (this.previousDirection !== null && direction !== this.previousDirection) {
      this.reversalCount++;
      this.reversalZs.push(this.currentZ);
    }
    this.previousDirection = direction;

    // Update bead position for next trial
    if (fused) {
      this.currentZ = Math.max(MIN_Z, this.currentZ + STEP_CLOSER); // closer = less negative
    } else {
      this.currentZ = Math.min(MAX_Z, this.currentZ - STEP_FARTHER); // farther = more negative
    }

    this.input?.haptic(fused ? 'confirm' : 'error');
    this.showFeedbackText(fused);
  }

  private showFeedbackText(fused: boolean): void {
    const text = fused ? 'Fused — moving closer' : 'Double — easing back';
    const color = fused ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE;

    const tex = this.textRenderer.renderToTexture({
      text,
      width: 512,
      height: 72,
      fontSize: FONTS.FEEDBACK,
      lineHeight: 1.0,
      color,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 16,
      paddingY: 10,
    });

    this.feedbackMaterial!.map?.dispose();
    this.feedbackMaterial!.map = tex;
    this.feedbackMaterial!.needsUpdate = true;
    this.feedbackMesh!.visible = true;
    this.showingFeedback = true;
    this.feedbackTimeout = Date.now() + TIMING.FEEDBACK_MS;
  }

  private advanceTrial(): void {
    // Check end conditions
    if (this.reversalCount >= REVERSALS_TO_END || this.results.length >= MAX_TRIALS) {
      this.showResults();
      return;
    }

    this.startTrial();
  }

  private showResults(): void {
    this.completed = true;
    this.highlightRing!.visible = false;

    const stats = this.getSessionStats();

    const lines = [
      `Brock String Complete — ${stats.trials} trials`,
      '',
      `Near Point of Convergence: ${stats.npcCm} cm`,
      `Fusion rate: ${stats.fusionRate}%`,
      `Avg reaction time: ${stats.avgReactionTimeMs}ms`,
      `Reversals: ${stats.reversals}`,
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
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

    this.instructionMaterial!.map?.dispose();
    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
    this.instructionMesh!.geometry.dispose();
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.3, 0.7);
    this.instructionMesh!.position.set(0, STRING_Y - 0.45, -2.0);
  }

  private showControllerPrompt(): void {
    const tex = this.textRenderer.renderToTexture({
      text: 'Hold your controller to the golden ring\nLike holding the string to your nose',
      width: 1024,
      height: 130,
      fontSize: 30,
      lineHeight: 1.6,
      color: COLORS.TEXT_WARM,
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map?.dispose();
    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }

  private renderInstructions(): void {
    const distanceCm = Math.round(Math.abs(this.currentZ - this.stringNearEnd.z) * 100);
    const trialNum = this.results.length + 1;
    const lines = [
      `Focus on the bead — see the X?    Distance: ${distanceCm} cm`,
      `Trigger = fused    A = double    Trial ${trialNum}`,
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
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

    this.instructionMaterial!.map?.dispose();
    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
