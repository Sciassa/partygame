import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine.ts';
import type { BuiltBeerAvatar } from './BeerAvatarBuilder.ts';
import { EMOTES as EMOTE_DATA } from '../shared/game/emotes.js';

/**
 * JuiceDirector — il "game feel" della scena 3D, aggiornato a ogni frame con (delta, elapsed).
 *
 *  1. Vita degli avatar: respiro a squash & stretch, dondolio, palpebre, bollicine di carbonazione.
 *  2. Pedana di Lancio: il giocatore di turno ci cammina sopra, sotto un occhio di bue caldo.
 *  3. Puntatore (flapper) fisico: molla smorzata che reagisce a ogni piolo, con il "clack" audio.
 *  4. Regia della telecamera: campo largo → carrellata durante il lancio → zoom di suspense
 *     sul puntatore quando la ruota rallenta.
 *  5. Emote: saltello balistico dell'avatar, fumetto HTML sopra la testa, spruzzo di schiuma.
 */

const TAU = Math.PI * 2;
const PHASE_STEP = 1.37;

/** Fattore di inseguimento indipendente dal frame rate: 1 - e^(-k·dt). */
export function follow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

// =====================================================================================
// 1. Vita degli avatar
// =====================================================================================

const BUBBLES_PER_AVATAR = 18;
const BUBBLE_RISE = 0.6;

export interface AvatarJuiceOutput {
  /** Fattori di scala del respiro (da moltiplicare allo squash del comportamento). */
  scaleX: number;
  scaleY: number;
  /** Rotazione z di dondolio (da sommare). */
  sway: number;
  /** Quota extra del salto da emote. */
  jump: number;
  /** Moltiplicatore della velocità delle braccia (2 per chi è sulla pedana). */
  armSpeed: number;
}

/** Stato "juice" di un singolo avatar. */
export class AvatarJuice {
  readonly index: number;
  readonly phaseOffset: number;
  readonly avatar: BuiltBeerAvatar;
  #bubbles: THREE.InstancedMesh;
  #bubbleState: Float32Array; // per bolla: [y, angolo, raggioRel, velocità, fase]
  #nextBlink: number;
  #blinkUntil = 0;
  #jumpY = 0;
  #jumpV = 0;
  #dummy = new THREE.Object3D();
  armClock = 0;

  constructor(avatar: BuiltBeerAvatar, index: number, bubbleGeometry: THREE.BufferGeometry, bubbleMaterial: THREE.Material, now: number) {
    this.avatar = avatar;
    this.index = index;
    this.phaseOffset = index * PHASE_STEP;
    this.#nextBlink = now + 1 + (index % 3) * 0.7;

    this.#bubbles = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, BUBBLES_PER_AVATAR);
    this.#bubbles.frustumCulled = false;
    this.#bubbles.renderOrder = 1;
    this.#bubbleState = new Float32Array(BUBBLES_PER_AVATAR * 5);
    const { bottom, top } = avatar.liquid;
    const span = Math.max(0.01, top - bottom);
    for (let i = 0; i < BUBBLES_PER_AVATAR; i++) {
      const o = i * 5;
      this.#bubbleState[o] = bottom + Math.random() * span;
      this.#bubbleState[o + 1] = Math.random() * TAU;
      this.#bubbleState[o + 2] = 0.15 + Math.random() * 0.75;
      this.#bubbleState[o + 3] = 0.8 + Math.random() * 0.5;
      this.#bubbleState[o + 4] = Math.random() * TAU;
    }
    this.#bubbles.visible = Boolean(avatar.beerId) && span > 0.05;
    avatar.body.add(this.#bubbles);
  }

  /** Salto da emote: velocità iniziale 4.5, gravità -15. */
  jump(): void {
    if (this.#jumpY > 0.05) this.#jumpV = Math.max(this.#jumpV, 3.2);
    else this.#jumpV = 4.5;
  }

  get airborne(): boolean {
    return this.#jumpY > 0.001 || this.#jumpV > 0;
  }

  update(t: number, dt: number, { active, alive }: { active: boolean; alive: boolean }): AvatarJuiceOutput {
    const p = this.phaseOffset;
    // respiro: s = sin(t·3.2 + φ)·0.035 → (1 - s/2, 1 + s, 1 - s/2) — volume costante
    const s = alive ? Math.sin(t * 3.2 + p) * 0.035 : 0;
    const sway = alive ? Math.sin(t * 1.6 + p) * 0.04 : 0;

    // palpebre: ogni 3.5 + (indice % 3) secondi, chiuse (scala 0.05) per 120 ms
    if (t >= this.#nextBlink) {
      this.#blinkUntil = t + 0.12;
      this.#nextBlink = t + 3.5 + (this.index % 3);
    }
    this.avatar.eyes.scale.y = alive && t < this.#blinkUntil ? 0.05 : 1;

    // salto balistico
    if (this.#jumpV !== 0 || this.#jumpY > 0) {
      this.#jumpV += -15 * dt;
      this.#jumpY += this.#jumpV * dt;
      if (this.#jumpY <= 0) {
        this.#jumpY = 0;
        this.#jumpV = 0;
      }
    }

    this.armClock += dt * (active ? 2 : 1);
    this.#updateBubbles(dt, alive);
    return { scaleX: 1 - s * 0.5, scaleY: 1 + s, sway, jump: this.#jumpY, armSpeed: active ? 2 : 1 };
  }

  /** Bollicine: salgono di 0.6 u/s nel liquido, ondeggiando in x e rimpicciolendosi; poi ricominciano dal fondo. */
  #updateBubbles(dt: number, alive: boolean): void {
    if (!this.#bubbles.visible) return;
    const { bottom, top } = this.avatar.liquid;
    const st = this.#bubbleState;
    const d = this.#dummy;
    for (let i = 0; i < BUBBLES_PER_AVATAR; i++) {
      const o = i * 5;
      st[o] += BUBBLE_RISE * st[o + 3] * dt * (alive ? 1 : 0.2);
      st[o + 4] += dt * 6;
      if (st[o] > top) {
        st[o] = bottom + Math.random() * 0.05;
        st[o + 1] = Math.random() * TAU;
        st[o + 2] = 0.15 + Math.random() * 0.75;
      }
      const y = st[o];
      const k = (y - bottom) / Math.max(0.01, top - bottom); // 0 sul fondo → 1 in cima
      const r = this.avatar.innerRadiusAt(y) * st[o + 2];
      const wobble = Math.sin(st[o + 4]) * 0.018;
      d.position.set(Math.cos(st[o + 1]) * r + wobble, y, Math.sin(st[o + 1]) * r);
      d.scale.setScalar(1 - k * 0.7);
      d.updateMatrix();
      this.#bubbles.setMatrixAt(i, d.matrix);
    }
    this.#bubbles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.#bubbles.removeFromParent();
    this.#bubbles.dispose();
  }
}

// =====================================================================================
// 2. Pedana di Lancio
// =====================================================================================

export class LaunchPad {
  readonly group = new THREE.Group();
  readonly spot: THREE.SpotLight;
  readonly position: THREE.Vector3;
  #disc: THREE.Mesh;
  #ring: THREE.Mesh;
  #cone: THREE.Mesh;
  #level = 0;
  #target = 0;
  #color = new THREE.Color('#ffb547');

  constructor(position: THREE.Vector3, { shadows = false }: { shadows?: boolean } = {}) {
    this.position = position.clone();
    const discMat = new THREE.MeshStandardMaterial({ color: 0x1c2233, roughness: 0.55, metalness: 0 });
    this.#disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.08, 40), discMat);
    this.#disc.position.copy(position).add(new THREE.Vector3(0, 0.04, 0));
    this.#disc.receiveShadow = true;
    this.#ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.025, 8, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.#color.clone(), transparent: true, opacity: 0.4 }),
    );
    this.#ring.position.copy(position).add(new THREE.Vector3(0, 0.085, 0));

    // occhio di bue caldo dedicato
    this.spot = new THREE.SpotLight(0xffc98a, 0, 12, 0.32, 0.6, 1.2);
    this.spot.position.copy(position).add(new THREE.Vector3(-0.6, 6.5, 2.2));
    this.spot.target.position.copy(position);
    if (shadows) {
      this.spot.castShadow = true;
      this.spot.shadow.mapSize.set(512, 512);
      this.spot.shadow.radius = 6;
      this.spot.shadow.bias = -0.0005;
    }
    // cono volumetrico finto (additivo, tenue)
    const coneGeo = new THREE.ConeGeometry(0.85, 6, 32, 1, true).translate(0, -3, 0);
    this.#cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.#cone.position.copy(this.spot.position);
    this.#cone.lookAt(position);
    this.#cone.rotateX(-Math.PI / 2);
    this.group.add(this.#disc, this.#ring, this.spot, this.spot.target, this.#cone);
  }

  setOccupied(occupied: boolean, color?: string): void {
    this.#target = occupied ? 1 : 0;
    if (color) this.#color.set(color);
  }

  update(t: number, dt: number): void {
    this.#level += (this.#target - this.#level) * follow(4, dt);
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);
    this.spot.intensity = 26 * this.#level;
    (this.#cone.material as THREE.MeshBasicMaterial).opacity = 0.05 * this.#level * pulse;
    const ringMat = this.#ring.material as THREE.MeshBasicMaterial;
    ringMat.color.copy(this.#color).multiplyScalar(1 + this.#level * 1.5 * pulse);
    ringMat.opacity = 0.35 + 0.6 * this.#level;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.spot.dispose();
    this.group.removeFromParent();
  }
}

// =====================================================================================
// 3. Puntatore fisico
// =====================================================================================

/**
 * Molla smorzata del puntatore:
 *   a ogni piolo:  vel = ±min(velocità·1.8, 12)   (il segno fa piegare la punta nel verso della rotazione)
 *   ogni passo:    angolo += vel·dt;  vel += (-angolo·180 - vel·14)·dt
 * Integrata a passi fissi di 1/240 s: stabile anche se il frame rate crolla.
 */
export class FlapperPhysics {
  angle = 0;
  velocity = 0;
  pegs = 0;
  #lastPointer: number | null = null;

  /** La punta del puntatore viene colpita da un piolo. `speed` in rad/s (segno = verso di rotazione). */
  hit(speed: number): void {
    const impulse = Math.min(Math.abs(speed) * 1.8, 12);
    // la ruota gira in senso orario (velocità negativa): la punta è spinta verso sinistra (+z)
    this.velocity = speed <= 0 ? impulse : -impulse;
    this.pegs++;
    SoundEngine.playPegClack(Math.abs(speed));
  }

  /**
   * Conta quanti confini di spicchio (pioli) sono passati sotto il puntatore tra il frame precedente e
   * questo. `pointerLocal` = angolo del puntatore nel riferimento della ruota, in [0, 2π).
   * A ruota velocissima in un frame se ne possono passare più d'uno: li contiamo tutti.
   */
  countCrossings(pointerLocal: number, boundaries: number[]): number {
    const prev = this.#lastPointer;
    this.#lastPointer = pointerLocal;
    if (prev === null || !boundaries.length) return 0;
    let delta = pointerLocal - prev;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    if (delta === 0) return 0;
    let count = 0;
    const lo = Math.min(prev, prev + delta);
    const hi = Math.max(prev, prev + delta);
    for (const b of boundaries) {
      for (const shift of [-TAU, 0, TAU]) {
        const x = b + shift;
        if (x > lo && x <= hi) count++;
      }
    }
    return count;
  }

  resetTracking(): void {
    this.#lastPointer = null;
  }

  update(dt: number): number {
    const STEP = 1 / 240;
    for (let left = dt; left > 1e-6; left -= STEP) {
      const h = Math.min(STEP, left);
      this.angle += this.velocity * h;
      this.velocity += (-this.angle * 180 - this.velocity * 14) * h;
    }
    // fine corsa meccanica: il puntatore non può ribaltarsi
    if (Math.abs(this.angle) > 0.75) {
      this.angle = Math.sign(this.angle) * 0.75;
      this.velocity *= -0.3;
    }
    return this.angle;
  }
}

// =====================================================================================
// 4. Regia della telecamera
// =====================================================================================

export type CameraShot = 'idle' | 'spinning' | 'slowing';

export interface CameraFraming {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Sotto questa velocità (rad/s) la ruota "sta per fermarsi": zoom di suspense. */
export const SLOWING_SPEED = 1.8;

export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  shot: CameraShot = 'idle';
  #base: CameraFraming = { position: new THREE.Vector3(0, 0.5, 30), target: new THREE.Vector3(0, -0.85, 0) };
  #suspense: CameraFraming = { position: new THREE.Vector3(0, 2.4, 14), target: new THREE.Vector3(0, 1.9, 0) };
  #pos = new THREE.Vector3();
  #look = new THREE.Vector3();
  #desiredPos = new THREE.Vector3();
  #desiredLook = new THREE.Vector3();
  #holdUntil = 0;
  #initialized = false;
  #shotSince = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Inquadrature calcolate in base al formato dello schermo (vedi StageRenderer.#resize). */
  setFraming(base: CameraFraming, suspense: CameraFraming): void {
    this.#base = { position: base.position.clone(), target: base.target.clone() };
    this.#suspense = { position: suspense.position.clone(), target: suspense.target.clone() };
    if (!this.#initialized) {
      this.#pos.copy(base.position);
      this.#look.copy(base.target);
      this.#initialized = true;
      this.#apply();
    }
  }

  /** Aggiorna lo stato della regia dalla velocità della ruota (null = ruota ferma). */
  setSpin(speed: number | null, t: number): void {
    let next: CameraShot;
    if (speed !== null) {
      this.#holdUntil = 0;
      next = Math.abs(speed) < SLOWING_SPEED ? 'slowing' : 'spinning';
    } else if (this.shot !== 'idle') {
      // ruota appena ferma: teniamo lo zoom sul risultato per 1.6 s, poi campo largo
      if (this.#holdUntil === 0) this.#holdUntil = t + 1.6;
      next = t < this.#holdUntil ? 'slowing' : 'idle';
      if (next === 'idle') this.#holdUntil = 0;
    } else {
      next = 'idle';
    }
    if (next !== this.shot) {
      this.shot = next;
      this.#shotSince = t;
    }
  }

  update(t: number, dt: number): void {
    const base = this.#base;
    if (this.shot === 'slowing') {
      this.#desiredPos.copy(this.#suspense.position);
      this.#desiredLook.copy(this.#suspense.target);
    } else if (this.shot === 'spinning') {
      // leggera carrellata all'indietro + orbita lenta attorno alla ruota
      const orbit = Math.sin((t - this.#shotSince) * 0.45) * 0.09;
      const dist = base.position.distanceTo(base.target) * 1.05;
      const dir = new THREE.Vector3().subVectors(base.position, base.target).normalize();
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
      this.#desiredPos.copy(base.target).addScaledVector(dir, dist);
      this.#desiredLook.copy(base.target);
    } else {
      // campo largo con un respiro impercettibile (la scena non è mai del tutto ferma)
      this.#desiredPos.copy(base.position);
      this.#desiredPos.x += Math.sin(t * 0.21) * 0.12;
      this.#desiredPos.y += Math.sin(t * 0.17) * 0.06;
      this.#desiredLook.copy(base.target);
    }
    const k = follow(3.5, dt);
    this.#pos.lerp(this.#desiredPos, k);
    this.#look.lerp(this.#desiredLook, k);
    this.#apply();
  }

  #apply(): void {
    this.camera.position.copy(this.#pos);
    this.camera.lookAt(this.#look);
  }
}

// =====================================================================================
// 5. Emote
// =====================================================================================

export type EmoteId = 'cheers' | 'laugh' | 'boo' | 'fire';

export const EMOTES: Record<EmoteId, { label: string; icon: string; text: string; color: string }> = EMOTE_DATA;

export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(EMOTES, x);
}

/** Spruzzi di schiuma (15 particelle per emote) in un unico THREE.Points. */
export class FoamBurst {
  static readonly MAX = 180;
  readonly points: THREE.Points;
  #pos = new Float32Array(FoamBurst.MAX * 3);
  #vel = new Float32Array(FoamBurst.MAX * 3);
  #life = new Float32Array(FoamBurst.MAX);
  #col = new Float32Array(FoamBurst.MAX * 3);
  #cursor = 0;
  #tint = new THREE.Color();

  constructor(texture: THREE.Texture) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.#pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.#col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.13, map: texture, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  emit(origin: THREE.Vector3, count = 15, color = '#fff8e7'): void {
    this.#tint.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.#cursor;
      this.#cursor = (this.#cursor + 1) % FoamBurst.MAX;
      const a = Math.random() * TAU;
      const sp = 0.8 + Math.random() * 1.6;
      this.#pos.set([origin.x, origin.y, origin.z], i * 3);
      this.#vel.set([Math.cos(a) * sp * 0.6, 2 + Math.random() * 2.2, Math.sin(a) * sp * 0.6], i * 3);
      this.#life[i] = 0.9 + Math.random() * 0.5;
      this.#col.set([this.#tint.r, this.#tint.g, this.#tint.b], i * 3);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < FoamBurst.MAX; i++) {
      if (this.#life[i] <= 0) {
        this.#pos[i * 3 + 1] = -999;
        continue;
      }
      this.#life[i] -= dt;
      this.#vel[i * 3 + 1] -= 7 * dt;
      for (let c = 0; c < 3; c++) this.#pos[i * 3 + c] += this.#vel[i * 3 + c] * dt;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Fumetti HTML proiettati sopra le teste degli avatar. */
export class EmoteBubbles {
  readonly layer: HTMLDivElement;
  #items: Array<{ el: HTMLDivElement; anchor: () => THREE.Vector3 | null; born: number; ttl: number }> = [];
  #v = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'emote-layer';
    container.append(this.layer);
  }

  show(text: string, color: string, anchor: () => THREE.Vector3 | null, now: number, ttl = 2.6): void {
    const el = document.createElement('div');
    el.className = 'emote-bubble';
    el.textContent = text;
    el.style.setProperty('--ec', color);
    this.layer.append(el);
    this.#items.push({ el, anchor, born: now, ttl });
    // massimo 8 fumetti contemporanei: i più vecchi spariscono
    while (this.#items.length > 8) this.#items.shift()?.el.remove();
  }

  update(camera: THREE.Camera, width: number, height: number, now: number): void {
    this.#items = this.#items.filter((item) => {
      const age = now - item.born;
      const p = item.anchor();
      if (age > item.ttl || !p) {
        item.el.remove();
        return false;
      }
      this.#v.copy(p).project(camera);
      const x = (this.#v.x * 0.5 + 0.5) * width;
      const y = (-this.#v.y * 0.5 + 0.5) * height - age * 14;
      const fade = age > item.ttl - 0.35 ? (item.ttl - age) / 0.35 : 1;
      const pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.4 : 1;
      item.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${pop.toFixed(3)})`;
      item.el.style.opacity = fade.toFixed(3);
      return true;
    });
  }

  dispose(): void {
    this.layer.remove();
    this.#items = [];
  }
}

// =====================================================================================
// Regista
// =====================================================================================

export interface JuiceDirectorOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  overlay: HTMLElement;
  padPosition: THREE.Vector3;
  softTexture: THREE.Texture;
  shadows?: boolean;
}

export class JuiceDirector {
  readonly flapper = new FlapperPhysics();
  readonly cameraDirector: CameraDirector;
  readonly pad: LaunchPad;
  readonly foam: FoamBurst;
  readonly bubbles: EmoteBubbles;
  #bubbleGeo = new THREE.SphereGeometry(0.014, 6, 4);
  #bubbleMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.7, depthWrite: false });
  #avatars = new Map<string, AvatarJuice>();
  #scene: THREE.Scene;

  constructor({ scene, camera, overlay, padPosition, softTexture, shadows = false }: JuiceDirectorOptions) {
    this.#scene = scene;
    this.cameraDirector = new CameraDirector(camera);
    this.pad = new LaunchPad(padPosition, { shadows });
    this.foam = new FoamBurst(softTexture);
    this.bubbles = new EmoteBubbles(overlay);
    scene.add(this.pad.group, this.foam.points);
  }

  /** Registra (o ri-registra dopo un cambio birra) l'avatar del giocatore `id`. */
  attach(id: string, avatar: BuiltBeerAvatar, index: number, now: number): AvatarJuice {
    this.#avatars.get(id)?.dispose();
    const juice = new AvatarJuice(avatar, index, this.#bubbleGeo, this.#bubbleMat, now);
    this.#avatars.set(id, juice);
    return juice;
  }

  detach(id: string): void {
    this.#avatars.get(id)?.dispose();
    this.#avatars.delete(id);
  }

  get(id: string): AvatarJuice | undefined {
    return this.#avatars.get(id);
  }

  /** Emote: salto, fumetto, schiuma e suono. `anchor` dà la posizione mondo sopra la testa. */
  emote(id: string, emote: EmoteId, anchor: () => THREE.Vector3 | null, now: number, playSound = true): void {
    const info = EMOTES[emote];
    this.#avatars.get(id)?.jump();
    this.bubbles.show(info.text, info.color, anchor, now);
    const at = anchor();
    if (at) this.foam.emit(at.clone().add(new THREE.Vector3(0, -0.25, 0)), 15, emote === 'boo' ? '#ff6b5a' : '#fff8e7');
    if (!playSound) return;
    if (emote === 'cheers') SoundEngine.playCheersEmote();
    else if (emote === 'laugh') SoundEngine.playLaughEmote();
    else if (emote === 'boo') SoundEngine.playBooEmote();
    else SoundEngine.playFireEmote();
  }

  update(t: number, dt: number, camera: THREE.Camera, width: number, height: number): void {
    this.pad.update(t, dt);
    this.foam.update(dt);
    this.cameraDirector.update(t, dt);
    this.bubbles.update(camera, width, height, t);
  }

  dispose(): void {
    for (const juice of this.#avatars.values()) juice.dispose();
    this.#avatars.clear();
    this.pad.dispose();
    this.foam.dispose();
    this.bubbles.dispose();
    this.#bubbleGeo.dispose();
    this.#bubbleMat.dispose();
    this.#scene.remove(this.foam.points);
  }
}
