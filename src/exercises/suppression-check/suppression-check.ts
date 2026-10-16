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
import { BaseExercise, type ExerciseStats } from '../base-exercise';
import { TextPanel, instructionText, feedbackText } from '../../ui/text-panel';
import { COLORS, PANELS, TIMING } from '../../ui/vr-constants';

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
  // Dots: red → training eye, greens → fellow eye, white → both
  private redDot!: THREE.Mesh;
  private greenDot1!: THREE.Mesh;
  private greenDot2!: THREE.Mesh;
  private whiteDot!: THREE.Mesh;
  private dotMaterials: THREE.MeshBasicMaterial[] = [];
  private fixationGroup!: THREE.Group;
  private crosshairGroup!: THREE.Group;
  private crosshairMaterial!: THREE.MeshBasicMaterial;
  private instructions!: TextPanel;
  private feedback!: TextPanel;
  private scatter!: TextPanel;

  // Trial state
  private results: TrialResult[] = [];
  private trialConditions: TrialCondition[] = [];
  private currentTrial = 0;
  private trialStartTime = 0;
  private awaitingResponse = false;

  // Dot fade-in
  private fadingIn = false;
  private fadeStartTime = 0;

  // Vergence offset measurement
  private offsetPhase = false;
  private crosshairOffsetX = 0;
  private crosshairOffsetY = 0;
  private pendingResult: TrialResult | null = null;

  protected setup(): void {
    this.trialConditions = this.generateTrialConditions();

    this.addEnvironment();
    this.createDots();
    this.createFixationCross();
    this.createCrosshair();

    this.instructions = this.panel(PANELS.INSTRUCTION_WIDTH);
    this.instructions.position.set(0, DOT_Y - 0.4, PANELS.INSTRUCTION_Z);

    this.feedback = this.panel(PANELS.FEEDBACK_WIDTH * 1.75);
    this.feedback.position.set(0, DOT_Y + 0.35, -1.8);
    this.feedback.visible = false;

    // Scatter plot (shown with results)
    this.scatter = this.panel(0.8);
    this.scatter.visible = false;

    this.renderInstructions();

    this.onInput((action) => {
      // During offset measurement, only trigger works
      if (this.offsetPhase) {
        if (action === 'select') this.confirmOffset();
        return;
      }

      if (!this.awaitingResponse) return;
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
    });

    this.beginInterTrial();
    this.ctx.hud.setStatus('Suppression Check — grip pause');
  }

  protected onUpdate(): void {
    const now = this.now();

    // Crosshair positioning during offset phase via controller ray
    if (this.offsetPhase) {
      this.trackCrosshair();
      this.crosshairMaterial.opacity = 0.6 + 0.3 * Math.sin(now * 0.004);
    }

    // Dot fade-in animation
    if (this.fadingIn) {
      const t = Math.min(1, (now - this.fadeStartTime) / TIMING.FADE_IN_MS);
      this.setDotsOpacity(1 - (1 - t) * (1 - t)); // ease-out
      if (t >= 1) this.fadingIn = false;
    }
  }

  getStats(): ExerciseStats {
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
    const offsets = this.results.filter((r) => r.vergenceOffset).map((r) => r.vergenceOffset!);

    let avgOffsetMm = 0;
    if (offsets.length > 0) {
      const totalMag = offsets.reduce((sum, o) => sum + Math.sqrt(o.x * o.x + o.y * o.y), 0);
      avgOffsetMm = Math.round((totalMag / offsets.length) * 1000);
    }

    return {
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

  private createDots(): void {
    const dotGeo = new THREE.CircleGeometry(DOT_RADIUS_BASE, 32);
    const makeDot = (color: number, eye: 'training' | 'fellow' | 'both') => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      this.dotMaterials.push(mat);
      return this.add(new THREE.Mesh(dotGeo.clone(), mat), eye);
    };

    this.redDot = makeDot(RED, 'training');
    this.greenDot1 = makeDot(GREEN, 'fellow');
    this.greenDot2 = makeDot(GREEN, 'fellow');
    this.whiteDot = makeDot(WHITE, 'both');
    dotGeo.dispose();
  }

  private createFixationCross(): void {
    const mat = new THREE.MeshBasicMaterial({ color: FIXATION_COLOR, transparent: true, opacity: 0.6 });
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.005), mat),
      new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.04), mat),
    );
    group.position.set(0, DOT_Y, -1.8);
    group.visible = false;
    this.fixationGroup = this.add(group);
  }

  private createCrosshair(): void {
    this.crosshairMaterial = new THREE.MeshBasicMaterial({
      color: CROSSHAIR_COLOR, transparent: true, opacity: 0.8, depthWrite: false,
    });
    // "+" shape — slightly larger than the dots
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.005), this.crosshairMaterial),
      new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.08), this.crosshairMaterial),
    );
    group.visible = false;
    this.crosshairGroup = this.add(group, 'fellow');
  }

  // --- Trial Logic ---

  private beginInterTrial(): void {
    this.setDotsOpacity(0);

    const condition = this.trialConditions[this.currentTrial];
    this.fixationGroup.position.z = condition.distance;
    this.fixationGroup.visible = true;
    this.renderInstructions();

    this.after(TIMING.INTER_TRIAL_MS, () => {
      this.fixationGroup.visible = false;
      this.startTrial();
    });
  }

  private startTrial(): void {
    this.positionDots(this.trialConditions[this.currentTrial]);

    this.fadingIn = true;
    this.fadeStartTime = this.now();

    this.trialStartTime = this.now();
    this.awaitingResponse = true;
    this.renderInstructions();
  }

  private positionDots(condition: TrialCondition): void {
    const z = condition.distance;
    const scale = Math.abs(z) / REF_DISTANCE;
    const spread = DOT_SPREAD_BASE * scale;
    const rot = condition.rotation;

    const dots = [this.redDot, this.greenDot1, this.greenDot2, this.whiteDot];
    const angles = [rot, rot - Math.PI / 2, rot + Math.PI / 2, rot + Math.PI];

    for (let i = 0; i < 4; i++) {
      dots[i].position.set(Math.sin(angles[i]) * spread, DOT_Y + Math.cos(angles[i]) * spread, z);
      dots[i].scale.set(scale, scale, 1);
    }
  }

  private setDotsOpacity(opacity: number): void {
    for (const m of this.dotMaterials) m.opacity = opacity;
  }

  private recordResponse(response: SuppressionResult): void {
    this.awaitingResponse = false;

    const reactionTimeMs = this.now() - this.trialStartTime;
    const condition = this.trialConditions[this.currentTrial];

    if (response === 'fusion') {
      // Enter offset measurement phase — dots stay visible
      this.ctx.input.haptic('confirm');
      this.pendingResult = { response, reactionTimeMs, condition };
      this.enterOffsetPhase(condition);
    } else {
      this.ctx.input.haptic('light');
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
    this.crosshairGroup.position.copy(this.redDot.position);
    this.crosshairGroup.visible = true;
    const scale = Math.abs(condition.distance) / REF_DISTANCE;
    this.crosshairGroup.scale.set(scale, scale, 1);

    this.instructions.setText(instructionText(
      ['Point controller where you see the red dot', 'Aim to move  •  Trigger to confirm'],
      COLORS.TEXT_SPECIAL,
    ));
  }

  /** Move the crosshair to where a controller ray hits the red dot's depth plane. */
  private trackCrosshair(): void {
    const renderer = this.ctx.renderer;
    const redDotWorld = new THREE.Vector3();
    this.redDot.getWorldPosition(redDotWorld);

    // Plane at the red dot's depth, facing the user (normal = +Z)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -redDotWorld.z);

    // Use the first tracked controller whose ray hits the plane
    let intersection: THREE.Vector3 | null = null;
    for (let i = 0; i < 2; i++) {
      const ray = renderer.getControllerRay(i);
      if (!ray) continue;
      const target = new THREE.Vector3();
      if (new THREE.Ray(ray.origin, ray.direction).intersectPlane(plane, target)) {
        intersection = target;
        break;
      }
    }
    if (!intersection) return;

    // Offset from the red dot, both in content-local space
    const localHit = renderer.worldToContentLocal(intersection);
    const dist = Math.abs(this.trialConditions[this.currentTrial]?.distance ?? -1.8);
    const maxOffset = 0.3 * (dist / REF_DISTANCE);
    this.crosshairOffsetX = THREE.MathUtils.clamp(localHit.x - this.redDot.position.x, -maxOffset, maxOffset);
    this.crosshairOffsetY = THREE.MathUtils.clamp(localHit.y - this.redDot.position.y, -maxOffset, maxOffset);

    this.crosshairGroup.position.set(
      this.redDot.position.x + this.crosshairOffsetX,
      this.redDot.position.y + this.crosshairOffsetY,
      this.redDot.position.z,
    );
  }

  private confirmOffset(): void {
    this.ctx.input.haptic('medium');
    this.offsetPhase = false;
    this.crosshairGroup.visible = false;

    const result = this.pendingResult!;
    result.vergenceOffset = { x: this.crosshairOffsetX, y: this.crosshairOffsetY };
    this.results.push(result);
    this.currentTrial++;
    this.pendingResult = null;

    this.setDotsOpacity(0);

    const offsetMm = Math.round(Math.hypot(this.crosshairOffsetX, this.crosshairOffsetY) * 1000);
    this.showFeedback(result.response, result.condition, offsetMm);
  }

  // --- Feedback ---

  private showFeedback(response: SuppressionResult, condition: TrialCondition, offsetMm?: number): void {
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

    let text = `${capitalize(condition.distanceLabel)}: ${labels[response]}`;
    if (offsetMm !== undefined) text += `  (${offsetMm}mm offset)`;

    this.feedback.setText(feedbackText(text, colors[response], 900));
    this.feedback.visible = true;

    this.after(TIMING.FEEDBACK_MS, () => {
      this.feedback.visible = false;
      if (this.currentTrial >= TOTAL_TRIALS) {
        this.finish();
      } else {
        this.beginInterTrial();
      }
    });
  }

  private finish(): void {
    this.setDotsOpacity(0);
    this.instructions.visible = false;

    const stats = this.getStats();
    const lines = [
      `Suppression Check — ${stats.trials} trials`,
      '',
      `Overall Fusion: ${stats.fusionRate}%`,
      '',
      `  Near:   ${stats.nearFusionRate}% fused`,
      `  Medium: ${stats.mediumFusionRate}% fused`,
      `  Far:    ${stats.farFusionRate}% fused`,
      '',
      `Training suppressed: ${stats.trainingSuppressionRate}%`,
      `Fellow suppressed: ${stats.fellowSuppressionRate}%`,
      `Diplopia: ${stats.diplopiaRate}%`,
      `Avg reaction: ${stats.avgReactionTimeMs}ms`,
    ];

    if ((stats.vergenceOffsetCount as number) > 0) {
      lines.push('', `Avg vergence offset: ${stats.avgVergenceOffsetMm}mm`, `  (${stats.vergenceOffsetCount} measurements)`);
    }

    this.showResults(lines, { x: 0, y: DOT_Y - 0.55, z: -1.7 });

    const scatterTex = this.renderScatterPlot();
    if (scatterTex) {
      this.scatter.setTexture(scatterTex);
      this.scatter.position.set(1.1, DOT_Y - 0.55, -1.7);
      this.scatter.visible = true;
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
    const isRightEye = this.ctx.renderer.getTrainingEye() === 'right';
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
    const condition = this.trialConditions[this.currentTrial];
    const trialLabel = condition
      ? `Trial ${this.currentTrial + 1} of ${TOTAL_TRIALS}  •  ${capitalize(condition.distanceLabel)} distance`
      : '';

    this.instructions.setText(instructionText([
      'How many dots do you see?',
      'Trigger = 4    A = 2    B = 3    Stick↓ = 5',
      trialLabel,
    ]));
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
