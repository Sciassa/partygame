import * as THREE from 'three';
import { TAU, segmentIndexAt } from './kinematics.js';
import { drawWheelFace } from './wheelTexture.js';
import { enableShadows, vinylMaterial } from '../stage/vinyl.js';

export const WHEEL_RADIUS = 3;
const R = WHEEL_RADIUS;
const BULB_COUNT = 36;

/** Palette materiali "pub": tutto opaco/satinato, metalness 0 (l'ottone è un colore, non un metallo). */
const PALETTE = {
  walnut: 0x22160f,
  matteBlack: 0x161a24, // nero-blu vinile
  brass: 0xd4a24c, // oro opaco
  cream: 0xf4ead5,
  ruby: 0xc81d43,
  bulb: new THREE.Color('#ffb257'),
  neon: new THREE.Color('#ff3d7f'),
};

/**
 * Modello 3D della ruota: parte rotante (faccia, pioli, tappo-mozzo) + cornice fissa
 * (anello, lampadine "marquee", tubo neon) + puntatore a molla.
 * Non gestisce il tempo dello spin: riceve l'angolo da StageRenderer.
 */
export class WheelModel {
  root = new THREE.Group();
  segments = [];
  angle = 0;
  lastIndex = -1;
  #pointer = { angle: 0, velocity: 0 };
  #lights = { mode: 'idle', color: new THREE.Color(), since: 0 };
  #tmpColor = new THREE.Color();

  constructor({ textureSize = 2048, anisotropy = 1 } = {}) {
    this.textureSize = textureSize;
    this.#buildRotating(anisotropy);
    this.#buildFrame();
    this.#buildPointer();
    // ombre: la ruota proietta sul muro, puntatore e pioli proiettano sulla faccia
    enableShadows(this.root);
    this.bulbs.castShadow = false;
    this.neon.castShadow = false;
  }

  setSegments(segments) {
    this.segments = segments;
    drawWheelFace(this.faceCanvas, segments, this.textureSize);
    this.faceTexture.needsUpdate = true;
    this.#buildPegs(segments.length);
    this.lastIndex = segments.length ? segmentIndexAt(this.angle, segments.length) : -1;
  }

  /** Ridisegna la texture (es. quando il web font è finalmente caricato). */
  redraw() {
    if (this.segments.length) this.setSegments(this.segments);
  }

  /**
   * Imposta l'angolo. Restituisce true se il puntatore è appena passato su un nuovo spicchio
   * (= ha sbattuto contro un piolo).
   */
  setAngle(angle) {
    this.angle = angle;
    this.rotating.rotation.z = angle;
    const n = this.segments.length;
    if (!n) return false;
    const index = segmentIndexAt(angle, n);
    if (index === this.lastIndex) return false;
    this.lastIndex = index;
    return true;
  }

  /** Il piolo spinge il puntatore nel verso di rotazione, più forte a velocità alta (rad/s). */
  kickPointer(speed) {
    this.#pointer.angle = Math.min(0.55, this.#pointer.angle + 0.1 + speed * 0.03);
  }

  setLights(mode, color = '#ffffff', now = 0) {
    this.#lights = { mode, color: new THREE.Color(color), since: now };
  }

  setHighlight(index) {
    if (index < 0 || !this.segments.length) {
      this.highlight.visible = false;
      return;
    }
    const s = TAU / this.segments.length;
    this.highlight.geometry.dispose();
    // CircleGeometry misura thetaStart da +X: lo spicchio i parte da +Y + i*s
    this.highlight.geometry = new THREE.CircleGeometry(R * 0.995, 32, Math.PI / 2 + index * s, s);
    this.highlight.visible = true;
  }

  update(t, dt) {
    // Molla smorzata del puntatore, integrata a passi fissi (1/240 s): stabile anche se il frame
    // rate crolla (con un dt di 0.1 s una molla così rigida "esploderebbe")
    const p = this.#pointer;
    const STEP = 1 / 240;
    for (let left = dt; left > 0; left -= STEP) {
      const h = Math.min(STEP, left);
      p.velocity += (-180 * p.angle - 13 * p.velocity) * h;
      p.angle += p.velocity * h;
    }
    this.pointerPivot.rotation.z = p.angle;

    if (this.highlight.visible) this.highlight.material.opacity = 0.1 + 0.08 * Math.sin(t * 7);
    this.neon.material.color.copy(PALETTE.neon).multiplyScalar(2.2 + 0.25 * Math.sin(t * 3.1) + (Math.random() < 0.004 ? -1.2 : 0));
    this.#updateBulbs(t);
  }

  dispose() {
    this.root.traverse((obj) => {
      obj.geometry?.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => m?.dispose());
    });
    this.faceTexture.dispose();
    this.pegGeometry.dispose();
  }

  // ------------------------------------------------------------------ costruzione

  #buildRotating(anisotropy) {
    const rotating = new THREE.Group();
    this.rotating = rotating;
    this.root.add(rotating);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.97, 0.4, 96, 1),
      vinylMaterial({ color: PALETTE.walnut, roughness: 0.75 }),
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.2;
    rotating.add(body);

    this.faceCanvas = document.createElement('canvas');
    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTexture.colorSpace = THREE.SRGBColorSpace;
    this.faceTexture.anisotropy = anisotropy;
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(R, 128),
      vinylMaterial({
        map: this.faceTexture,
        // un filo di emissione: i colori restano leggibili anche fuori dal fascio di luce
        emissive: 0xffffff,
        emissiveMap: this.faceTexture,
        emissiveIntensity: 0.13,
        roughness: 0.82,
        rimStrength: 0.15,
      }),
    );
    face.position.z = 0.001;
    rotating.add(face);

    this.highlight = new THREE.Mesh(
      new THREE.CircleGeometry(R, 8, 0, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.highlight.position.z = 0.01;
    this.highlight.visible = false;
    rotating.add(this.highlight);

    this.pegMaterial = vinylMaterial({ color: PALETTE.brass, roughness: 0.45 });
    this.pegGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 12);
    this.pegGeometry.rotateX(Math.PI / 2);

    // Mozzo a forma di tappo a corona (pub!): bordo zigrinato
    const capGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.22, 42, 1);
    const pos = capGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr > 0.5) {
        const a = Math.atan2(z, x);
        const crimp = 1 + 0.07 * Math.cos(a * 21);
        pos.setX(i, x * crimp);
        pos.setZ(i, z * crimp);
      }
    }
    capGeo.computeVertexNormals();
    const cap = new THREE.Mesh(capGeo, vinylMaterial({ color: PALETTE.brass, roughness: 0.5 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.12;
    rotating.add(cap);
    const capTop = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 48),
      vinylMaterial({ color: PALETTE.ruby, roughness: 0.6, emissive: PALETTE.ruby, emissiveIntensity: 0.25 }),
    );
    capTop.position.z = 0.235;
    rotating.add(capTop);
  }

  #buildFrame() {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.13, 0.18, 20, 160),
      vinylMaterial({ color: PALETTE.matteBlack, roughness: 0.72, rimStrength: 1.4, rimPower: 2.0 }),
    );
    rim.position.z = 0.02;
    this.root.add(rim);

    const brassRing = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.01, 0.035, 10, 160),
      vinylMaterial({ color: PALETTE.brass, roughness: 0.4 }),
    );
    brassRing.position.z = 0.08;
    this.root.add(brassRing);

    // Tubo al neon dietro la cornice: colore > 1 = HDR, così il bloom lo fa "accendere"
    this.neon = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.52, 0.04, 12, 200),
      new THREE.MeshBasicMaterial({ color: PALETTE.neon.clone().multiplyScalar(2.2) }),
    );
    this.neon.position.z = -0.12;
    this.root.add(this.neon);

    // Lampadine "marquee" ambra sulla cornice
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), BULB_COUNT);
    const m = new THREE.Matrix4();
    for (let i = 0; i < BULB_COUNT; i++) {
      const a = (i / BULB_COUNT) * TAU;
      m.makeTranslation(Math.cos(a) * (R + 0.13), Math.sin(a) * (R + 0.13), 0.2);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, PALETTE.bulb);
    }
    this.bulbs = bulbs;
    this.root.add(bulbs);
  }

  #buildPointer() {
    // Goccia rivolta verso il basso, imperniata in alto
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.9);
    shape.bezierCurveTo(0.1, -0.58, 0.34, -0.25, 0.33, 0.02);
    shape.absarc(0, 0.02, 0.33, 0, Math.PI, false);
    shape.bezierCurveTo(-0.34, -0.25, -0.1, -0.58, 0, -0.9);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 4 });
    geo.translate(0, 0, -0.08);
    const body = new THREE.Mesh(geo, vinylMaterial({ color: PALETTE.cream, roughness: 0.6, rimStrength: 1.3 }));
    const gem = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 24, 16),
      vinylMaterial({ color: PALETTE.ruby, roughness: 0.35, emissive: PALETTE.ruby, emissiveIntensity: 0.6 }),
    );
    gem.position.set(0, 0.02, 0.15);
    this.pointerPivot = new THREE.Group();
    this.pointerPivot.position.set(0, R + 0.4, 0.42);
    this.pointerPivot.add(body, gem);
    this.root.add(this.pointerPivot);
  }

  #buildPegs(count) {
    if (this.pegs) {
      this.rotating.remove(this.pegs);
      this.pegs.dispose();
    }
    const pegs = new THREE.InstancedMesh(this.pegGeometry, this.pegMaterial, count);
    const m = new THREE.Matrix4();
    const s = TAU / count;
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + i * s; // confine dello spicchio i (da +X)
      m.makeTranslation(Math.cos(a) * R * 0.935, Math.sin(a) * R * 0.935, 0.11);
      pegs.setMatrixAt(i, m);
    }
    pegs.castShadow = true;
    pegs.receiveShadow = true;
    this.pegs = pegs;
    this.rotating.add(pegs);
  }

  #updateBulbs(t) {
    const { mode, color, since } = this.#lights;
    const c = this.#tmpColor;
    for (let i = 0; i < BULB_COUNT; i++) {
      let k;
      if (mode === 'spin') {
        // inseguimento: una "onda" di luce che corre in senso orario
        k = (Math.sin(i * 0.7 + t * 18) + 1) / 2;
        c.copy(PALETTE.bulb).multiplyScalar(0.25 + 2.6 * k ** 3);
      } else if (mode === 'win') {
        // lampeggio alternato nel colore dello spicchio vincente
        const on = (Math.floor((t - since) * 5) + i) % 2 === 0;
        c.copy(color).multiplyScalar(on ? 2.4 : 0.25);
      } else {
        // idle: lampadine accese calde con un leggero sfarfallio da filamento
        k = 0.85 + 0.15 * Math.sin(t * 1.7 + i * 2.3);
        c.copy(PALETTE.bulb).multiplyScalar(1.5 * k);
      }
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor.needsUpdate = true;
  }
}

