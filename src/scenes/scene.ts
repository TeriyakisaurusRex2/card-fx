import * as THREE from 'three';
import type { Stage } from '../core/stage';

export interface SceneContext {
  stage: Stage;
  /** Container for this scene's DOM. main.ts empties it between scenes. */
  ui: HTMLElement;
  params: URLSearchParams;
}

export interface ShowScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, time: number): void;
  resize?(): void;
  dispose(): void;
}

export type SceneFactory = (ctx: SceneContext) => ShowScene;

/** Collects window listeners so a scene can drop them all at once on dispose. */
export class Listeners {
  private off: (() => void)[] = [];
  on<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) {
    target.addEventListener(type, fn as EventListener);
    this.off.push(() => target.removeEventListener(type, fn as EventListener));
  }
  add(fn: () => void) {
    this.off.push(fn);
  }
  clear() {
    this.off.forEach((f) => f());
    this.off = [];
  }
}

/** True when the event landed on the 3D canvas and not on a panel above it. */
export const onCanvas = (e: Event) => (e.target as HTMLElement | null)?.id === 'stage';
