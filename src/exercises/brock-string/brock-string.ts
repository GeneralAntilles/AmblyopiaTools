/**
 * Virtual Brock String Exercise
 *
 * VR implementation of the classic Brock string convergence exercise.
 * A string stretches from the user's controller (held near the nose,
 * like the real exercise) toward the distance with 3 colored beads.
 * The user focuses on each highlighted bead in turn, and when converged
 * correctly the string naturally appears as an X pattern through the
 * bead (due to binocular parallax in VR).
 *
 * Controller-attached mode: the string's near end tracks whichever
 * controller the user moves toward the golden guide ring. Beads
 * maintain their proportional positions along the dynamic string.
 *
 * Trains:
 *   - Eye convergence (especially for near beads — hardest for amblyopes)
 *   - Rapid vergence changes (jumping between beads)
 *   - Anti-suppression (requires both eyes to be active for X pattern)
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

interface BeadDef {
  color: number;
  z: number;
  label: string;
}

interface BeadResult {
  beadIndex: number;
  label: string;
  fused: boolean;
  reactionTimeMs: number;
}

// Bead positions — near is harder (more convergence needed)
const BEADS: BeadDef[] = [
  { color: 0xc95a5a, z: -2.5, label: 'Far (red)' },
  { color: 0xc9a85a, z: -1.5, label: 'Middle (yellow)' },
  { color: 0x5ac97a, z: -0.8, label: 'Near (green)' },
];

const STRING_Y = 1.5;
const STRING_START_Z = -0.4;
const STRING_END_Z = -3.0;
const BEAD_RADIUS = 0.03;
const SEQUENCES = 3;
const PANEL_BG = '#16111e';

export class BrockStringExercise extends BaseExercise {
  readonly name = 'Brock String';
  readonly description = 'Virtual Brock string for convergence training. Focus on each bead to see the X pattern.';
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

  // Exercise state
  private currentSequence: number = 0;
  private currentBeadIndex: number = 0;
  private results: BeadResult[] = [];
  private trialStartTime: number = 0;
  private awaitingResponse: boolean = false;
  private showingFeedback: boolean = false;
  private feedbackTimeout: number = 0;
  private completed: boolean = false;
  private pulseTime: number = 0;
  private waitingForStart: boolean = false;
  private highlightTransitioning: boolean = false;

  // Controller-attached mode
  private controllerAttached: boolean = false;
  private controllerIndex: number = -1;
  private stringNearEnd: THREE.Vector3 = new THREE.Vector3(0, STRING_Y, STRING_START_Z);
  private readonly stringFarEnd: THREE.Vector3 = new THREE.Vector3(0, STRING_Y, STRING_END_Z);
  private beadProportions: number[] = [];

  private exitCallback: (() => void) | null = null;

  constructor() {
    super();
    this.textRenderer = new TextRenderer();

    // Pre-compute proportional bead positions along the string
    const totalLength = Math.abs(STRING_END_Z - STRING_START_Z);
    for (const bead of BEADS) {
      this.beadProportions.push(Math.abs(bead.z - STRING_START_Z) / totalLength);
    }
  }

  setExitCallback(cb: () => void): void {
    this.exitCallback = cb;
  }

  async setup(config: ExerciseConfig): Promise<void> {
    this.renderer = config.renderer;
    this.input = config.input;
    this.results = [];
    this.currentSequence = 0;
    this.currentBeadIndex = 0;
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
        // Trigger fallback: attach to nearest controller and start
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
        this.orientStringBetween(localPos, this.stringFarEnd);
        this.repositionBeads(localPos, this.stringFarEnd);

        // Keep highlight ring on current bead
        if (this.highlightRing?.visible && !this.highlightTransitioning) {
          this.highlightRing.position.copy(this.beadMeshes[this.currentBeadIndex].position);
        }
      }
    }

    // Guide phase: detect controller proximity
    if (this.waitingForStart && this.guideMesh && this.renderer) {
      const guideWorldPos = new THREE.Vector3();
      this.guideMesh.getWorldPosition(guideWorldPos);

      // Find closest controller
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
        // Close enough — attach controller and auto-start
        this.controllerAttached = true;
        this.controllerIndex = closestIndex;
        this.waitingForStart = false;
        this.guideMesh.visible = false;
        for (const a of this.arrowMeshes) a.visible = false;
        this.startTrial();
      } else if (closestPos) {
        // Color guide by proximity
        const t = Math.max(0, Math.min(1, 1 - (closestDist - 0.15) / 0.6));
        if (t > 0.6) {
          this.guideMaterial!.color.set(0x5ac97a);
        } else if (t > 0.3) {
          this.guideMaterial!.color.set(0xc9a85a);
        } else {
          this.guideMaterial!.color.set(0xc95a5a);
        }

        // Pulse guide ring
        const guidePulse = 0.4 + 0.3 * Math.sin(this.pulseTime * 3);
        this.guideMaterial!.opacity = guidePulse;

        // Position chevron waypoints between controller and guide
        for (let i = 0; i < this.arrowMeshes.length; i++) {
          const frac = 0.3 + i * 0.2;
          const worldPos = new THREE.Vector3().lerpVectors(closestPos, guideWorldPos, frac);
          const localPos = this.renderer.worldToContentLocal(worldPos);
          this.arrowMeshes[i].position.copy(localPos);

          // Sequential wave animation
          const phase = this.pulseTime * 4 - i * 1.2;
          const pulse = 0.2 + 0.5 * Math.max(0, Math.sin(phase));
          this.arrowMaterials[i].opacity = pulse;
        }
      }
    }

    // Smooth highlight ring transition to new bead
    if (this.highlightTransitioning && this.highlightRing) {
      const targetPos = this.beadMeshes[this.currentBeadIndex].position;
      this.highlightRing.position.lerp(targetPos, Math.min(1, 5.0 * dt));

      if (this.highlightRing.position.distanceTo(targetPos) < 0.01) {
        this.highlightRing.position.copy(targetPos);
        this.highlightTransitioning = false;
        this.trialStartTime = Date.now();
        this.awaitingResponse = true;
      }
    }

    // Pulse the highlight ring
    if (this.highlightRing?.visible && !this.highlightTransitioning) {
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
    this.instructionMaterial?.dispose();
    this.feedbackMesh?.geometry.dispose();
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
    const beadStats = BEADS.map(() => ({ fused: 0, total: 0, totalMs: 0 }));

    for (const r of this.results) {
      if (r.fused) fusedCount++;
      totalReaction += r.reactionTimeMs;
      beadStats[r.beadIndex].total++;
      if (r.fused) beadStats[r.beadIndex].fused++;
      beadStats[r.beadIndex].totalMs += r.reactionTimeMs;
    }

    const total = this.results.length || 1;
    return {
      exercise: 'brock-string',
      durationMs: this.getElapsedMs(),
      trials: this.results.length,
      sequences: this.currentSequence,
      fusionRate: Math.round((fusedCount / total) * 100),
      avgReactionTimeMs: Math.round(totalReaction / total),
      beadResults: beadStats.map((s, i) => ({
        label: BEADS[i].label,
        fusionRate: s.total > 0 ? Math.round((s.fused / s.total) * 100) : 0,
        avgMs: s.total > 0 ? Math.round(s.totalMs / s.total) : 0,
      })),
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

  private createString(): void {
    if (!this.renderer) return;

    // Unit-height cylinder — oriented dynamically via quaternion
    const geo = new THREE.CylinderGeometry(0.002, 0.002, 1, 8);
    this.stringMaterial = new THREE.MeshBasicMaterial({ color: 0xddd0c0 });
    this.stringMesh = new THREE.Mesh(geo, this.stringMaterial);
    this.orientStringBetween(this.stringNearEnd, this.stringFarEnd);
    this.renderer.addToBothEyes(this.stringMesh);
  }

  private orientStringBetween(near: THREE.Vector3, far: THREE.Vector3): void {
    if (!this.stringMesh) return;

    const dir = new THREE.Vector3().subVectors(far, near);
    const length = dir.length();
    dir.normalize();

    const mid = new THREE.Vector3().lerpVectors(near, far, 0.5);
    this.stringMesh.position.copy(mid);

    // Orient cylinder's Y axis along the direction vector
    const up = new THREE.Vector3(0, 1, 0);
    this.stringMesh.quaternion.setFromUnitVectors(up, dir);
    this.stringMesh.scale.set(1, length, 1);
  }

  private createBeads(): void {
    if (!this.renderer) return;

    const beadGeo = new THREE.SphereGeometry(BEAD_RADIUS, 16, 12);

    for (const bead of BEADS) {
      const mat = new THREE.MeshBasicMaterial({ color: bead.color });
      const mesh = new THREE.Mesh(beadGeo.clone(), mat);
      mesh.position.set(0, STRING_Y, bead.z);
      this.renderer.addToBothEyes(mesh);
      this.beadMeshes.push(mesh);
      this.beadMaterials.push(mat);
    }
  }

  private repositionBeads(near: THREE.Vector3, far: THREE.Vector3): void {
    for (let i = 0; i < BEADS.length; i++) {
      const pos = new THREE.Vector3().lerpVectors(near, far, this.beadProportions[i]);
      this.beadMeshes[i].position.copy(pos);
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
    this.highlightRing.position.set(0, STRING_Y, BEADS[0].z);
    this.renderer.addToBothEyes(this.highlightRing);
  }

  private createUI(): void {
    if (!this.renderer) return;

    const instructGeo = new THREE.PlaneGeometry(1.4, 0.18);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, STRING_Y - 0.35, -2.0);
    this.renderer.addToBothEyes(this.instructionMesh);

    const feedbackGeo = new THREE.PlaneGeometry(0.8, 0.12);
    this.feedbackMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.feedbackMesh = new THREE.Mesh(feedbackGeo, this.feedbackMaterial);
    this.feedbackMesh.position.set(0, STRING_Y + 0.35, -2.0);
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

    // Flat chevron ">" waypoint markers
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
    // No controller tracked — fall back to static string
    this.controllerAttached = false;
  }

  // --- Trial Logic ---

  private startTrial(): void {
    const bead = BEADS[this.currentBeadIndex];

    this.highlightMaterial!.color.set(bead.color);
    this.highlightRing!.visible = true;
    this.highlightTransitioning = true;
    this.awaitingResponse = false;
    this.pulseTime = 0;

    this.renderInstructions();
  }

  private recordResponse(fused: boolean): void {
    if (!this.awaitingResponse) return;
    this.awaitingResponse = false;

    const reactionTimeMs = Date.now() - this.trialStartTime;
    this.results.push({
      beadIndex: this.currentBeadIndex,
      label: BEADS[this.currentBeadIndex].label,
      fused,
      reactionTimeMs,
    });

    this.showFeedbackText(fused);
  }

  private showFeedbackText(fused: boolean): void {
    const text = fused ? 'Fused' : 'Double';
    const color = fused ? '#5cb87a' : '#c47a5c';

    const tex = this.textRenderer.renderToTexture({
      text,
      width: 512,
      height: 72,
      fontSize: 36,
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

  private advanceTrial(): void {
    this.currentBeadIndex++;

    if (this.currentBeadIndex >= BEADS.length) {
      this.currentBeadIndex = 0;
      this.currentSequence++;

      if (this.currentSequence >= SEQUENCES) {
        this.showResults();
        return;
      }
    }

    this.startTrial();
  }

  private showResults(): void {
    this.completed = true;
    this.highlightRing!.visible = false;

    const stats = this.getSessionStats();
    const beadResults = stats.beadResults as Array<{ label: string; fusionRate: number; avgMs: number }>;

    const lines = [
      `Brock String Complete — ${stats.sequences} sequences`,
      '',
      `Overall fusion: ${stats.fusionRate}%`,
      '',
      ...beadResults.map((b) => `${b.label}: ${b.fusionRate}% fused, ${b.avgMs}ms avg`),
      '',
      'Grip to exit',
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 576,
      fontSize: 36,
      lineHeight: 1.5,
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
      color: '#c0b8a8',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 16,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }

  private renderInstructions(): void {
    const bead = BEADS[this.currentBeadIndex];
    const seqLabel = `Sequence ${this.currentSequence + 1}/${SEQUENCES}`;
    const lines = [
      `Focus on the ${bead.label} bead — see the X in the string?`,
      `Trigger = fused    A = double    ${seqLabel}`,
    ];

    const tex = this.textRenderer.renderToTexture({
      text: lines.join('\n'),
      width: 1024,
      height: 130,
      fontSize: 30,
      lineHeight: 1.5,
      color: '#9688a0',
      background: 'rgba(0,0,0,0)',
      align: 'center',
      paddingX: 30,
      paddingY: 12,
    });

    this.instructionMaterial!.map = tex;
    this.instructionMaterial!.needsUpdate = true;
  }
}
