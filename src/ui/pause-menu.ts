/**
 * In-VR pause menu: a dimming veil over the whole scene and a card with
 * the menu items. Both eyes see it. Selection logic lives in SessionHost.
 *
 * The veil and card ignore depth and draw last, so they cover exercise
 * content at any distance (the Brock string comes within 40 cm).
 */

import * as THREE from 'three';
import { TextPanel, resultsText } from './text-panel';
import { CONTENT_Y } from './vr-constants';

const MENU_Z = -1.4;
const DRAW_LAST = 1000;

export class PauseMenu {
  readonly root = new THREE.Group();
  private card = new TextPanel(0.75);

  constructor() {
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false }),
    );
    veil.position.set(0, CONTENT_Y, MENU_Z - 0.05);
    veil.renderOrder = DRAW_LAST;

    this.card.mesh.material.depthTest = false;
    this.card.mesh.renderOrder = DRAW_LAST + 1;
    this.card.position.set(0, CONTENT_Y, MENU_Z);

    this.root.add(veil, this.card.mesh);
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(items: string[], selected: number): void {
    const lines = [
      'Paused',
      '',
      ...items.map((item, i) => `${i === selected ? '●' : '○'} ${item}`),
      '',
      '↕ choose · Trigger select',
      'Grip: resume',
    ];
    this.card.setText(resultsText(lines, { width: 640, fontSize: 34, align: 'left', paddingX: 56, paddingY: 44 }));
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
  }
}
