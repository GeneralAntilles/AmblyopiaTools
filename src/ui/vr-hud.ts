/**
 * In-VR floating UI panels.
 *
 * Provides a simple HUD overlay within the VR scene for status info,
 * session timer, and controls hints.
 */

import * as THREE from 'three';
import { TextRenderer } from '../utils/text-renderer';

export class VRHud {
  private textRenderer: TextRenderer;
  private hudGroup: THREE.Group;
  private statusMesh: THREE.Mesh;
  private statusMaterial: THREE.MeshBasicMaterial;
  private timerMesh: THREE.Mesh;
  private timerMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.textRenderer = new TextRenderer();
    this.hudGroup = new THREE.Group();

    // Status panel (top-left in view)
    this.statusMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const statusGeo = new THREE.PlaneGeometry(0.5, 0.08);
    this.statusMesh = new THREE.Mesh(statusGeo, this.statusMaterial);
    this.statusMesh.position.set(-0.5, 1.9, -2.0);
    this.hudGroup.add(this.statusMesh);

    // Timer (top-right)
    this.timerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const timerGeo = new THREE.PlaneGeometry(0.35, 0.08);
    this.timerMesh = new THREE.Mesh(timerGeo, this.timerMaterial);
    this.timerMesh.position.set(0.5, 1.9, -2.0);
    this.hudGroup.add(this.timerMesh);
  }

  getGroup(): THREE.Group {
    return this.hudGroup;
  }

  updateStatus(text: string): void {
    const tex = this.textRenderer.renderToTexture({
      text,
      width: 512,
      height: 64,
      fontSize: 24,
      lineHeight: 1.0,
      color: '#aaaaaa',
      background: '#0a0a1200',
      paddingX: 8,
      paddingY: 8,
      align: 'left',
    });
    this.statusMaterial.map = tex;
    this.statusMaterial.needsUpdate = true;
  }

  updateTimer(elapsedMs: number): void {
    const seconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

    const tex = this.textRenderer.renderToTexture({
      text: display,
      width: 256,
      height: 64,
      fontSize: 28,
      lineHeight: 1.0,
      color: '#888888',
      background: '#0a0a1200',
      paddingX: 8,
      paddingY: 8,
      align: 'right',
    });
    this.timerMaterial.map = tex;
    this.timerMaterial.needsUpdate = true;
  }

  dispose(): void {
    this.statusMesh.geometry.dispose();
    this.statusMaterial.dispose();
    this.timerMesh.geometry.dispose();
    this.timerMaterial.dispose();
  }
}
