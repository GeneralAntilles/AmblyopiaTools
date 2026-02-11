/**
 * Virtual Brock String Exercise — 3-Bead Adaptive Convergence Training
 *
 * VR implementation of the clinical Brock string convergence exercise.
 * A string stretches from the user's controller (held near the nose)
 * toward the distance with THREE beads at near/mid/far depths.
 *
 * Each sweep cycles far → mid → near. The user reports fusion or
 * diplopia at each bead. After each sweep, a 1-up/1-down staircase
 * shifts all 3 beads closer (if near bead fused) or farther (if not).
 * Reversals converge on the Near Point of Convergence (NPC).
 *
 * The rapid switching between beads at different depths is the core
 * training mechanic — it forces the vergence system to re-converge
 * at each new distance.
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
  beadIndex: number;       // 0=far, 1=mid, 2=near
  z: number;
  distanceCm: number;
  fused: boolean;
  reactionTimeMs: number;
}

// --- 3 Beads ---
const BEAD_COUNT = 3;
const BEAD_SPACING = 0.6;      // 60cm between beads
const BEAD_COLORS = [
  0xc95a5a,  // Far = red
  0xdbb870,  // Mid = gold
  0x5ac97a,  // Near = green
];
const BEAD_LABELS = ['Far (red)', 'Middle (gold)', 'Near (green)'];

// --- Staircase parameters (controls the near bead position) ---
const START_NEAR_Z = -1.4;     // Near bead starts here (easy — all beads far)
const STEP_CLOSER = 0.12;      // 12cm closer after fused sweep
const STEP_FARTHER = 0.16;     // 16cm farther after failed sweep
const MIN_NEAR_Z = -0.5;       // Closest the near bead can go
const MAX_NEAR_Z = -1.6;       // Farthest near bead (far bead = -2.8)
const REVERSALS_TO_END = 6;    // End after 6 direction changes
const MAX_SWEEPS = 12;         // Safety cap (= 36 individual trials)

// --- String geometry ---
const STRING_Y = 1.5;
const STRING_START_Z = -0.4;
const STRING_END_Z = -3.0;
const BEAD_RADIUS = 0.03;
const STRING_SEGMENTS = 32;
const STRING_SAG = 0.06;

export class BrockStringExercise extends BaseExercise {
  readonly name = 'Brock String';
  readonly description = 'Convergence training — focus on each bead in turn, see the X pattern';
  readonly type = 'binocular' as const;

  private renderer: PerEyeRenderer | null = null;
  private input: InputManager | null = null;
  private unsubInput: (() => void) | null = null;
  private textRenderer: TextRenderer;

  // Scene objects
  private stringMesh: THREE.Mesh | null = null;
  private stringMaterial: THREE.MeshBasicMaterial | null = null;
  private beadMeshes: THREE.Mesh[] = [];
  private beadMaterials: THREE.MeshBasicMaterial[] = [];
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

  // Staircase state (tracks the near bead Z position)
  private currentNearZ: number = START_NEAR_Z;
  private previousDirection: 'closer' | 'farther' | null = null;
  private reversalCount: number = 0;
  private reversalZs: number[] = [];
  private sweepCount: number = 0;
  private results: TrialResult[] = [];

  // Sweep state: cycle through far(0) → mid(1) → near(2)
  private currentBeadIndex: number = 0;
  private sweepFused: boolean[] = [];  // fusion result per bead this sweep

  // Trial timing
  private trialStartTime: number = 0;
  private awaitingResponse: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private completed: boolean = false;
  private pulseTime: number = 0;
  private waitingForStart: boolean = false;

  // Bead transition animation (all 3 beads shift together)
  private beadsTransitioning: boolean = false;
  private targetNearZ: number = START_NEAR_Z;

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
    this.currentNearZ = START_NEAR_Z;
    this.previousDirection = null;
    this.reversalCount = 0;
    this.reversalZs = [];
    this.sweepCount = 0;
    this.currentBeadIndex = 0;
    this.sweepFused = [];
    this.controllerAttached = false;
    this.controllerIndex = -1;
    this.stringNearEnd.set(0, STRING_Y, STRING_START_Z);

    this.createEnvironment();
    this.createString();
    this.createBeads();
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
        this.startSweep();
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
        this.repositionAllBeads();
      }
    }

    // Guide phase: detect controller proximity
    if (this.waitingForStart && this.guideMesh && this.renderer) {
      this.updateGuidePhase();
    }

    // Smooth bead transition (all beads shift to new positions)
    if (this.beadsTransitioning) {
      this.animateBeadTransition(dt);
    }

    // Pulse the highlight ring on the active bead
    if (this.highlightRing?.visible && !this.beadsTransitioning) {
      const scale = 1.0 + 0.15 * Math.sin(this.pulseTime * 4);
      this.highlightRing.scale.set(scale, scale, 1);
    }

    // Auto-hide feedback overlay (non-blocking — next bead/sweep already started)
    if (this.showingFeedback && Date.now() > this.feedbackTimeout) {
      this.showingFeedback = false;
      this.feedbackMesh!.visible = false;
    }
  }

  teardown(): void {
    this.markStopped();
    this.unsubInput?.();

    if (this.renderer) {
      if (this.stringMesh) this.renderer.removeFromScene(this.stringMesh);
      for (const m of this.beadMeshes) this.renderer.removeFromScene(m);
      if (this.highlightRing) this.renderer.removeFromScene(this.highlightRing);
      if (this.envSphereMesh) this.renderer.removeFromScene(this.envSphereMesh);
      if (this.instructionMesh) this.renderer.removeFromScene(this.instructionMesh);
      if (this.feedbackMesh) this.renderer.removeFromScene(this.feedbackMesh);
      if (this.guideMesh) this.renderer.removeFromScene(this.guideMesh);
      for (const a of this.arrowMeshes) this.renderer.removeFromScene(a);
    }

    this.stringMesh?.geometry.dispose();
    this.stringMaterial?.dispose();
    for (let i = 0; i < this.beadMeshes.length; i++) {
      this.beadMeshes[i].geometry.dispose();
      this.beadMaterials[i].dispose();
    }
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

    this.beadMeshes = [];
    this.beadMaterials = [];
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
      sweeps: this.sweepCount,
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
      // No reversals yet — use the closest near-bead Z where they fused
      const nearFused = this.results.filter((r) => r.beadIndex === 2 && r.fused);
      if (nearFused.length === 0) return Math.abs(START_NEAR_Z - this.stringNearEnd.z);
      const closestFused = nearFused.reduce((a, b) => (a.z > b.z ? a : b));
      return Math.abs(closestFused.z - this.stringNearEnd.z);
    }

    // Average the last 4 reversal Z positions (or all if fewer)
    const recent = this.reversalZs.slice(-4);
    const avgZ = recent.reduce((sum, z) => sum + z, 0) / recent.length;
    return Math.abs(avgZ - this.stringNearEnd.z);
  }

  // --- Bead Z positions ---

  /** Get the Z for a bead by index (0=far, 1=mid, 2=near) given the near bead Z */
  private getBeadZ(beadIndex: number, nearZ: number): number {
    return nearZ - (BEAD_COUNT - 1 - beadIndex) * BEAD_SPACING;
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

  private createBeads(): void {
    if (!this.renderer) return;

    const beadGeo = new THREE.SphereGeometry(BEAD_RADIUS, 16, 12);

    for (let i = 0; i < BEAD_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: BEAD_COLORS[i] });
      const mesh = new THREE.Mesh(beadGeo.clone(), mat);
      const z = this.getBeadZ(i, this.currentNearZ);
      const pos = this.getPointOnString(z);
      mesh.position.copy(pos);
      this.renderer.addToBothEyes(mesh);
      this.beadMeshes.push(mesh);
      this.beadMaterials.push(mat);
    }
  }

  private getPointOnString(z: number): THREE.Vector3 {
    if (!this.stringCurve) {
      return new THREE.Vector3(0, STRING_Y, z);
    }
    const nearZ = this.stringNearEnd.z;
    const farZ = this.stringFarEnd.z;
    const proportion = Math.max(0, Math.min(1, (z - nearZ) / (farZ - nearZ)));
    return this.stringCurve.getPointAt(proportion);
  }

  private repositionAllBeads(): void {
    if (!this.stringCurve || this.beadsTransitioning) return;
    for (let i = 0; i < BEAD_COUNT; i++) {
      const z = this.getBeadZ(i, this.currentNearZ);
      const pos = this.getPointOnString(z);
      this.beadMeshes[i].position.copy(pos);
    }
    // Keep highlight on active bead
    if (this.highlightRing?.visible) {
      this.highlightRing.position.copy(this.beadMeshes[this.currentBeadIndex].position);
    }
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
    this.highlightRing.visible = false;
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

  // --- Guide phase animation ---

  private updateGuidePhase(): void {
    if (!this.guideMesh || !this.renderer) return;

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
      this.startSweep();
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

  // --- Bead transition animation ---

  private animateBeadTransition(dt: number): void {
    let allDone = true;

    for (let i = 0; i < BEAD_COUNT; i++) {
      const targetZ = this.getBeadZ(i, this.targetNearZ);
      const targetPos = this.getPointOnString(targetZ);
      this.beadMeshes[i].position.lerp(targetPos, Math.min(1, 4.0 * dt));

      if (this.beadMeshes[i].position.distanceTo(targetPos) > 0.005) {
        allDone = false;
      } else {
        this.beadMeshes[i].position.copy(targetPos);
      }
    }

    // Keep highlight on active bead during transition
    if (this.highlightRing?.visible) {
      this.highlightRing.position.copy(this.beadMeshes[this.currentBeadIndex].position);
    }

    if (allDone) {
      this.beadsTransitioning = false;
      this.currentNearZ = this.targetNearZ;
      // Now start accepting input for the first bead of the new sweep
      this.trialStartTime = Date.now();
      this.awaitingResponse = true;
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

  // --- Sweep & Trial Logic ---

  /** Begin a new 3-bead sweep (far → mid → near) */
  private startSweep(): void {
    this.currentBeadIndex = 0; // start with far bead
    this.sweepFused = [];
    this.startBeadTrial();
  }

  /** Highlight the current bead and await response */
  private startBeadTrial(): void {
    this.highlightRing!.visible = true;
    this.awaitingResponse = false;
    this.pulseTime = 0;

    // Position highlight ring on the active bead
    const pos = this.beadMeshes[this.currentBeadIndex].position;
    this.highlightRing!.position.copy(pos);

    // If beads need to shift (start of new sweep after staircase), animate
    if (this.beadsTransitioning) {
      // awaitingResponse will be set to true when animation completes
    } else {
      this.trialStartTime = Date.now();
      this.awaitingResponse = true;
    }

    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    const z = this.getBeadZ(this.currentBeadIndex, this.currentNearZ);
    const distanceCm = Math.round(Math.abs(z - this.stringNearEnd.z) * 100);

    this.results.push({
      beadIndex: this.currentBeadIndex,
      z,
      distanceCm,
      fused,
      reactionTimeMs,
    });

    this.sweepFused.push(fused);

    this.input?.haptic(fused ? 'confirm' : 'error');
    this.showFeedbackText(fused);

    // Immediately advance — feedback overlay displays concurrently
    this.advanceTrial();
  }

  private showFeedbackText(fused: boolean): void {
    const beadLabel = BEAD_LABELS[this.currentBeadIndex];
    const text = fused
      ? `${beadLabel} — fused`
      : `${beadLabel} — double`;
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
    // Move to next bead in sweep, or finish sweep
    if (this.currentBeadIndex < BEAD_COUNT - 1) {
      // Next bead in this sweep
      this.currentBeadIndex++;
      this.startBeadTrial();
      return;
    }

    // Sweep complete — run staircase based on near bead result
    this.sweepCount++;
    const nearFused = this.sweepFused[BEAD_COUNT - 1]; // last bead = near

    const direction: 'closer' | 'farther' = nearFused ? 'closer' : 'farther';
    if (this.previousDirection !== null && direction !== this.previousDirection) {
      this.reversalCount++;
      this.reversalZs.push(this.currentNearZ);
    }
    this.previousDirection = direction;

    // Check end conditions
    if (this.reversalCount >= REVERSALS_TO_END || this.sweepCount >= MAX_SWEEPS) {
      this.showResults();
      return;
    }

    // Adjust positions for next sweep
    if (nearFused) {
      this.targetNearZ = Math.max(MIN_NEAR_Z, this.currentNearZ + STEP_CLOSER);
    } else {
      this.targetNearZ = Math.min(MAX_NEAR_Z, this.currentNearZ - STEP_FARTHER);
    }

    // Start new sweep with bead transition animation
    this.currentBeadIndex = 0;
    this.sweepFused = [];
    this.beadsTransitioning = true;
    this.startBeadTrial();
  }

  private showResults(): void {
    this.completed = true;
    this.highlightRing!.visible = false;

    const stats = this.getSessionStats();

    const lines = [
      `Brock String Complete — ${stats.sweeps} sweeps, ${stats.trials} trials`,
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
    const z = this.getBeadZ(this.currentBeadIndex, this.currentNearZ);
    const distanceCm = Math.round(Math.abs(z - this.stringNearEnd.z) * 100);
    const beadLabel = BEAD_LABELS[this.currentBeadIndex];
    const trialNum = this.results.length + 1;
    const lines = [
      `Focus on ${beadLabel} bead — see the X?    ${distanceCm} cm`,
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
