/**
 * Virtual Brock String Exercise
 *
 * VR implementation of the classic Brock string convergence exercise.
 * A string stretches from near the user toward the distance with 3 colored
 * beads (green=near, yellow=mid, red=far). The user focuses on each
 * highlighted bead in turn, and when converged correctly the string
 * naturally appears as an X pattern through the bead (due to binocular
 * parallax in VR).
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
// Keep nearest bead at Z=-0.8 to avoid extreme vergence-accommodation conflict
const BEADS: BeadDef[] = [
  { color: 0xff4444, z: -3.5, label: 'Far (red)' },
  { color: 0xddbb33, z: -2.0, label: 'Middle (yellow)' },
  { color: 0x44cc66, z: -1.0, label: 'Near (green)' },
];

const STRING_Y = 1.5;
const STRING_START_Z = -0.4;
const STRING_END_Z = -4.0;
const BEAD_RADIUS = 0.03;
const SEQUENCES = 3; // Number of full bead sequences
const PANEL_BG = '#111119';

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
    this.currentSequence = 0;
    this.currentBeadIndex = 0;

    this.createEnvironment();
    this.createString();
    this.createBeads();
    this.createHighlightRing();
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

  update(dt: number): void {
    this.pulseTime += dt;

    // Pulse the highlight ring
    if (this.highlightRing && this.awaitingResponse) {
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

  private createString(): void {
    if (!this.renderer) return;

    // Thin cylinder for the string
    const length = Math.abs(STRING_END_Z - STRING_START_Z);
    const geo = new THREE.CylinderGeometry(0.002, 0.002, length, 8);
    geo.rotateX(Math.PI / 2); // Align along Z axis
    this.stringMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    this.stringMesh = new THREE.Mesh(geo, this.stringMaterial);
    this.stringMesh.position.set(0, STRING_Y, (STRING_START_Z + STRING_END_Z) / 2);
    this.renderer.addToBothEyes(this.stringMesh);
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

  private createHighlightRing(): void {
    if (!this.renderer) return;

    const ringGeo = new THREE.RingGeometry(BEAD_RADIUS * 1.8, BEAD_RADIUS * 2.4, 32);
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.highlightRing = new THREE.Mesh(ringGeo, this.highlightMaterial);
    this.renderer.addToBothEyes(this.highlightRing);
  }

  private createUI(): void {
    if (!this.renderer) return;

    // Instructions
    const instructGeo = new THREE.PlaneGeometry(1.2, 0.12);
    this.instructionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    this.instructionMesh = new THREE.Mesh(instructGeo, this.instructionMaterial);
    this.instructionMesh.position.set(0, STRING_Y - 0.35, -2.0);
    this.renderer.addToBothEyes(this.instructionMesh);

    // Feedback
    const feedbackGeo = new THREE.PlaneGeometry(0.8, 0.06);
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

  // --- Trial Logic ---

  private startTrial(): void {
    const bead = BEADS[this.currentBeadIndex];

    // Move highlight ring to current bead
    this.highlightRing!.position.set(0, STRING_Y, bead.z);
    this.highlightMaterial!.color.set(bead.color);
    this.highlightRing!.visible = true;

    this.trialStartTime = Date.now();
    this.awaitingResponse = true;
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
      height: 512,
      fontSize: 30,
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
    this.instructionMesh!.geometry = new THREE.PlaneGeometry(1.2, 0.6);
    this.instructionMesh!.position.set(0, STRING_Y - 0.45, -2.0);
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
