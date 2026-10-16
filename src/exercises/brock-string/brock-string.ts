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
 */

import * as THREE from 'three';
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import type { EyeRenderer } from '../../core/per-eye-renderer';
import { TextPanel, instructionText, feedbackText } from '../../ui/text-panel';
import { COLORS, PANELS, TIMING, CONTENT_Y } from '../../ui/vr-constants';

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
  // Scene objects
  private stringMesh: THREE.Mesh | null = null;
  private stringMaterial = new THREE.MeshBasicMaterial({ color: 0xddd0c0 });
  private beadMesh!: THREE.Mesh;
  private beadMaterial!: THREE.MeshBasicMaterial;
  private highlightRing!: THREE.Mesh;
  private guideMesh!: THREE.Mesh;
  private guideMaterial!: THREE.MeshBasicMaterial;
  private arrowMeshes: THREE.Mesh[] = [];
  private arrowMaterials: THREE.MeshBasicMaterial[] = [];
  private instructions!: TextPanel;
  private feedback!: TextPanel;

  // Staircase state
  private currentZ: number = START_Z;
  private previousDirection: 'closer' | 'farther' | null = null;
  private reversalCount = 0;
  private reversalZs: number[] = [];
  private results: TrialResult[] = [];
  private trialStartTime = 0;
  private awaitingResponse = false;
  private pulseTime = 0;
  private waitingForStart = true;

  // Bead transition animation
  private beadTransitioning = false;
  private beadTargetZ: number = START_Z;

  // Controller-attached mode
  private controllerAttached = false;
  private controllerIndex = -1;
  private stringNearEnd = new THREE.Vector3(0, STRING_Y, STRING_START_Z);
  private readonly stringFarEnd = new THREE.Vector3(0, STRING_Y, STRING_END_Z);
  private stringCurve: THREE.CatmullRomCurve3 | null = null;

  protected setup(): void {
    this.addEnvironment();
    this.rebuildStringGeometry(this.stringNearEnd, this.stringFarEnd);
    this.createBead();
    this.createHighlightRing();
    this.createUI();
    this.createGuide();

    this.instructions.setText(instructionText(
      ['Hold your controller to the golden ring', 'Like holding the string to your nose'],
      COLORS.TEXT_WARM,
    ));

    this.onInput((action) => {
      if (this.waitingForStart) {
        // Trigger starts without docking: attach to whichever controller is tracked
        if (action === 'select') {
          this.ctx.input.haptic('light');
          this.attachNearestController();
          this.beginTrials();
        }
        return;
      }

      if (!this.awaitingResponse) return;
      if (action === 'select') this.recordResponse(true);
      else if (action === 'button-a') this.recordResponse(false);
    });

    this.ctx.hud.setStatus('Brock String — trigger=fused, A=double, grip exit');
  }

  protected onUpdate(dt: number): void {
    this.pulseTime += dt;
    const renderer = this.ctx.renderer;

    // Controller-attached string tracking
    if (this.controllerAttached) {
      const pos = renderer.getControllerPosition(this.controllerIndex);
      if (pos) {
        const localPos = renderer.worldToContentLocal(pos);
        this.stringNearEnd.copy(localPos);
        this.rebuildStringGeometry(localPos, this.stringFarEnd);
        this.repositionBead();

        // Keep highlight ring on bead
        if (this.highlightRing.visible && !this.beadTransitioning) {
          this.highlightRing.position.copy(this.beadMesh.position);
        }
      }
    }

    // Guide phase: detect controller proximity
    if (this.waitingForStart) this.updateGuide(renderer);

    // Smooth bead transition to new Z
    if (this.beadTransitioning) {
      const targetPos = this.getBeadPosition(this.beadTargetZ);
      this.beadMesh.position.lerp(targetPos, Math.min(1, 4.0 * dt));
      this.highlightRing.position.copy(this.beadMesh.position);

      if (this.beadMesh.position.distanceTo(targetPos) < 0.01) {
        this.beadMesh.position.copy(targetPos);
        this.highlightRing.position.copy(targetPos);
        this.beadTransitioning = false;
        this.currentZ = this.beadTargetZ;
        this.updateBeadColor();
        this.trialStartTime = this.now();
        this.awaitingResponse = true;
      }
    }

    // Pulse the highlight ring
    if (this.highlightRing.visible && !this.beadTransitioning) {
      const scale = 1.0 + 0.15 * Math.sin(this.pulseTime * 4);
      this.highlightRing.scale.set(scale, scale, 1);
    }
  }

  getStats(): ExerciseStats {
    let fusedCount = 0;
    let totalReaction = 0;

    for (const r of this.results) {
      if (r.fused) fusedCount++;
      totalReaction += r.reactionTimeMs;
    }

    const total = this.results.length || 1;
    const npcMeters = this.calculateNPC();

    return {
      trials: this.results.length,
      fusionRate: Math.round((fusedCount / total) * 100),
      avgReactionTimeMs: Math.round(totalReaction / total),
      npcMeters,
      npcCm: Math.round(npcMeters * 100),
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

  private buildStringCurve(near: THREE.Vector3, far: THREE.Vector3): THREE.CatmullRomCurve3 {
    const length = near.distanceTo(far);
    const sagAmount = STRING_SAG * length;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= STRING_SEGMENTS; i++) {
      const t = i / STRING_SEGMENTS;
      const pos = new THREE.Vector3().lerpVectors(near, far, t);
      pos.y -= sagAmount * 4 * t * (1 - t);
      points.push(pos);
    }

    return new THREE.CatmullRomCurve3(points);
  }

  private rebuildStringGeometry(near: THREE.Vector3, far: THREE.Vector3): void {
    this.stringCurve = this.buildStringCurve(near, far);
    const geo = new THREE.TubeGeometry(this.stringCurve, STRING_SEGMENTS, 0.002, 6, false);

    if (this.stringMesh) {
      this.stringMesh.geometry.dispose();
      this.stringMesh.geometry = geo;
    } else {
      this.stringMesh = this.add(new THREE.Mesh(geo, this.stringMaterial));
    }
  }

  private createBead(): void {
    this.beadMaterial = new THREE.MeshBasicMaterial({ color: 0x5ac97a });
    this.beadMesh = new THREE.Mesh(new THREE.SphereGeometry(BEAD_RADIUS, 16, 12), this.beadMaterial);
    this.beadMesh.position.copy(this.getBeadPosition(this.currentZ));
    this.updateBeadColor();
    this.add(this.beadMesh);
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
    if (!this.stringCurve || this.beadTransitioning) return;
    this.beadMesh.position.copy(this.getBeadPosition(this.currentZ));
  }

  private updateBeadColor(): void {
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
    const ringGeo = new THREE.RingGeometry(BEAD_RADIUS * 1.8, BEAD_RADIUS * 2.4, 32);
    this.highlightRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xdbb870,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.highlightRing.position.copy(this.getBeadPosition(this.currentZ));
    this.add(this.highlightRing);
  }

  private createUI(): void {
    this.instructions = this.panel(PANELS.INSTRUCTION_WIDTH);
    this.instructions.position.set(0, CONTENT_Y + PANELS.INSTRUCTION_Y_OFFSET, -2.0);

    this.feedback = this.panel(PANELS.FEEDBACK_WIDTH);
    this.feedback.position.set(0, CONTENT_Y + PANELS.FEEDBACK_Y_OFFSET, -2.0);
    this.feedback.visible = false;
  }

  private createGuide(): void {
    this.guideMaterial = new THREE.MeshBasicMaterial({
      color: 0xdbb870,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    this.guideMesh = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 12, 32), this.guideMaterial);
    this.guideMesh.position.set(0, STRING_Y, STRING_START_Z);
    this.add(this.guideMesh);

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
      this.add(mesh);
      this.arrowMeshes.push(mesh);
      this.arrowMaterials.push(mat);
    }
    chevronGeo.dispose();
  }

  // --- Guide / Controller Attachment ---

  private updateGuide(renderer: EyeRenderer): void {
    const guideWorldPos = new THREE.Vector3();
    this.guideMesh.getWorldPosition(guideWorldPos);

    let closestDist = Infinity;
    let closestIndex = -1;
    let closestPos: THREE.Vector3 | null = null;

    for (let i = 0; i < 2; i++) {
      const pos = renderer.getControllerPosition(i);
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
      this.beginTrials();
    } else if (closestPos) {
      const t = Math.max(0, Math.min(1, 1 - (closestDist - 0.15) / 0.6));
      if (t > 0.6) {
        this.guideMaterial.color.set(0x5ac97a);
      } else if (t > 0.3) {
        this.guideMaterial.color.set(0xc9a85a);
      } else {
        this.guideMaterial.color.set(0xc95a5a);
      }

      this.guideMaterial.opacity = 0.4 + 0.3 * Math.sin(this.pulseTime * 3);

      for (let i = 0; i < this.arrowMeshes.length; i++) {
        const frac = 0.3 + i * 0.2;
        const worldPos = new THREE.Vector3().lerpVectors(closestPos, guideWorldPos, frac);
        this.arrowMeshes[i].position.copy(renderer.worldToContentLocal(worldPos));

        const phase = this.pulseTime * 4 - i * 1.2;
        this.arrowMaterials[i].opacity = 0.2 + 0.5 * Math.max(0, Math.sin(phase));
      }
    }
  }

  private attachNearestController(): void {
    for (let i = 0; i < 2; i++) {
      if (this.ctx.renderer.getControllerPosition(i)) {
        this.controllerAttached = true;
        this.controllerIndex = i;
        return;
      }
    }
    this.controllerAttached = false;
  }

  private beginTrials(): void {
    this.waitingForStart = false;
    this.guideMesh.visible = false;
    for (const a of this.arrowMeshes) a.visible = false;
    this.startTrial();
  }

  // --- Trial Logic ---

  private startTrial(): void {
    this.highlightRing.visible = true;
    this.awaitingResponse = false;
    this.pulseTime = 0;

    // Move bead to currentZ with animation
    this.beadTargetZ = this.currentZ;
    this.beadTransitioning = true;

    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    this.awaitingResponse = false;

    this.results.push({
      z: this.currentZ,
      distanceCm: Math.round(Math.abs(this.currentZ - this.stringNearEnd.z) * 100),
      fused,
      reactionTimeMs: this.now() - this.trialStartTime,
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

    this.ctx.input.haptic(fused ? 'confirm' : 'error');
    this.feedback.setText(feedbackText(
      fused ? 'Fused — moving closer' : 'Double — easing back',
      fused ? COLORS.FEEDBACK_SUCCESS : COLORS.FEEDBACK_FAILURE,
    ));
    this.feedback.visible = true;

    this.after(TIMING.FEEDBACK_MS, () => {
      this.feedback.visible = false;
      if (this.reversalCount >= REVERSALS_TO_END || this.results.length >= MAX_TRIALS) {
        this.finish();
      } else {
        this.startTrial();
      }
    });
  }

  private finish(): void {
    this.highlightRing.visible = false;
    this.instructions.visible = false;

    const stats = this.getStats();
    this.showResults([
      `Brock String Complete — ${stats.trials} trials`,
      '',
      `Near Point of Convergence: ${stats.npcCm} cm`,
      `Fusion rate: ${stats.fusionRate}%`,
      `Avg reaction time: ${stats.avgReactionTimeMs}ms`,
      `Reversals: ${stats.reversals}`,
    ], { x: 0, y: STRING_Y - 0.45, z: -2.0 });
  }

  private renderInstructions(): void {
    const distanceCm = Math.round(Math.abs(this.currentZ - this.stringNearEnd.z) * 100);
    this.instructions.setText(instructionText([
      `Focus on the bead — see the X?    Distance: ${distanceCm} cm`,
      `Trigger = fused    A = double    Trial ${this.results.length + 1}`,
    ]));
  }
}
