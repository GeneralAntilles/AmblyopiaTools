/**
 * In-VR floating UI panels.
 *
 * Provides a minimal HUD overlay within the VR scene for status info
 * and session timer. Positioned above the reading panel.
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

    // Status panel (top-left, above reading panel)
    this.statusMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const statusGeo = new THREE.PlaneGeometry(0.55, 0.05);
    this.statusMesh = new THREE.Mesh(statusGeo, this.statusMaterial);
    this.statusMesh.position.set(-0.55, 2.22, -2.0);
    this.hudGroup.add(this.statusMesh);

    // Timer (top-right, above reading panel)
    this.timerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const timerGeo = new THREE.PlaneGeometry(0.3, 0.05);
    this.timerMesh = new THREE.Mesh(timerGeo, this.timerMaterial);
    this.timerMesh.position.set(0.55, 2.22, -2.0);
    this.hudGroup.add(this.timerMesh);
  }

  getGroup(): THREE.Group {
    return this.hudGroup;
  }

  updateStatus(text: string): void {
    const tex = this.textRenderer.renderToTexture({
      text,
      width: 512,
      height: 48,
      fontSize: 20,
      lineHeight: 1.0,
      color: '#6a6a80',
      background: 'rgba(0,0,0,0)',
      paddingX: 8,
      paddingY: 10,
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
      height: 48,
      fontSize: 22,
      lineHeight: 1.0,
      color: '#6a6a80',
      background: 'rgba(0,0,0,0)',
      paddingX: 8,
      paddingY: 10,
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
