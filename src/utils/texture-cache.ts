/**
 * Texture cache to avoid regenerating textures every frame.
 *
 * Keyed by string (e.g., page number + settings hash).
 * Disposes old textures when capacity is exceeded.
 */

import * as THREE from 'three';

export class TextureCache {
  private cache = new Map<string, THREE.Texture>();
  private accessOrder: string[] = [];
  private maxSize: number;

  constructor(maxSize = 20) {
    this.maxSize = maxSize;
  }

  get(key: string): THREE.Texture | undefined {
    const tex = this.cache.get(key);
    if (tex) {
      // Move to end of access order (most recently used)
      const idx = this.accessOrder.indexOf(key);
      if (idx >= 0) this.accessOrder.splice(idx, 1);
      this.accessOrder.push(key);
    }
    return tex;
  }

  set(key: string, texture: THREE.Texture): void {
    // If key already exists, update it
    if (this.cache.has(key)) {
      this.cache.get(key)!.dispose();
      this.cache.set(key, texture);
      return;
    }

    // Evict least recently used if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const evictKey = this.accessOrder.shift()!;
      const evicted = this.cache.get(evictKey);
      evicted?.dispose();
      this.cache.delete(evictKey);
    }

    this.cache.set(key, texture);
    this.accessOrder.push(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  get size(): number {
    return this.cache.size;
  }
}
