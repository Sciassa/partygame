import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TAU, segmentIndexAt, segmentLayout } from './kinematics.js';
import { drawWheelFace } from './wheelTexture.js';
import { enableShadows, vinylMaterial } from '../stage/vinyl.js';

export const WHEEL_RADIUS = 3;
const R = WHEEL_RADIUS;
/** Raggio della faccia con gli spicchi (dentro il bordo spesso). */
export const FACE_RADIUS = R * 0.85;
const GOLD_RING_R = R * 0.875;
const NEON_R = R * 0.842;
/** Altezza del piedistallo sotto la ruota: il set piazza il bancone a questa quota. */
export const STAND_FLOOR_Y = -R - 1.35;

/** Palette della reference: vinile blu notte opaco, oro, ambra luminosa. Metalness sempre 0. */
const PALETTE = {
  navy: 0x26304a,
  navyDark: 0x161b29,
  gold: 0xd9a94f,
  amber: new THREE.Color('#ff9d3a'),
  // Happy Hour: neon viola e oro intenso
  violet: new THREE.Color('#b44dff'),
  hhGold: new THREE.Color('#ffc23a'),
};

/**
 * Modello 3D della ruota sul suo piedistallo (come nella reference "ruota dark"):
 *  - parte rotante: faccia con spicchi, filo neon ambra a segmenti, borchie oro (= pioli), mozzo
 *    a cupola con mezzaluna ambra
 *  - parte fissa: bordo spesso blu notte, anello oro, alloggiamento del puntatore con lampada,
 *    piedistallo con bordo oro, luce a mezza cupola e tre LED
 * Non gestisce il tempo dello spin: riceve l'angolo da StageRenderer.
 */
export class WheelModel {
  root = new THREE.Group();
  segments = [];
  angle = 0;
  lastIndex = -1;
  highlightIndex = -1;
  #pointer = { angle: 0, velocity: 0 };
  #lights = { mode: 'idle', color: new THREE.Color(), since: 0 };
  #lampFlash = 0;
  #tmpColor = new THREE.Color();
  #happyHour = false;
  layout = [];
  topSlotIndex = -1;
  /** true = l'angolo del puntatore lo imposta qualcun altro (FlapperPhysics in JuiceDirector). */
  externalPointer = false;

  constructor({ textureSize = 2048, anisotropy = 1 } = {}) {
    this.textureSize = textureSize;
    this.#buildRotating(anisotropy);
    this.#buildFrame();
    this.#buildPointer();
    this.#buildStand();
    enableShadows(this.root);
    for (const glowing of [this.lamp, this.baseDome, this.leds, this.crescent]) glowing.castShadow = false;
  }

  setSegments(segments) {
    this.segments = segments;
    this.layout = segmentLayout(segments);
    drawWheelFace(this.faceCanvas, segments, this.textureSize);
    this.faceTexture.needsUpdate = true;
    this.#buildStuds();
    this.#buildNeonArcs();
    this.lastIndex = segments.length ? segmentIndexAt(this.angle, this.layout) : -1;
    if (this.highlightIndex >= 0) this.setHighlight(this.highlightIndex);
    this.setTopSlot(this.topSlotIndex);
  }

  /** Ridisegna la texture (es. quando il web font è finalmente caricato). */
  redraw() {
    if (this.segments.length) {
      drawWheelFace(this.faceCanvas, this.segments, this.textureSize);
      this.faceTexture.needsUpdate = true;
    }
  }

  /** Imposta l'angolo. Restituisce true se il puntatore ha appena passato una borchia. */
  setAngle(angle) {
    this.angle = angle;
    this.rotating.rotation.z = angle;
    const n = this.segments.length;
    if (!n) return false;
    const index = segmentIndexAt(angle, this.layout);
    if (index === this.lastIndex) return false;
    this.lastIndex = index;
    return true;
  }

  /** La borchia spinge il puntatore (più forte a velocità alta, rad/s) e la lampada lampeggia. */
  kickPointer(speed) {
    this.#pointer.angle = Math.min(0.5, this.#pointer.angle + 0.1 + speed * 0.028);
    this.#lampFlash = 1;
  }

  setLights(mode, color = '#ffffff', now = 0) {
    this.#lights = { mode, color: new THREE.Color(color), since: now };
  }

  setHighlight(index) {
    this.highlightIndex = index;
    if (index < 0 || !this.segments.length) {
      this.highlight.visible = false;
      return;
    }
    const { start, end } = this.layout[index];
    this.highlight.geometry.dispose();
    // CircleGeometry misura thetaStart da +X: lo spicchio parte da +Y + start
    this.highlight.geometry = new THREE.CircleGeometry(FACE_RADIUS, 32, Math.PI / 2 + start, end - start);
    this.highlight.visible = true;
  }

  /** Top Slot: cornice luminosa sullo spicchio estratto dal rullo (-1 per toglierla). */
  setTopSlot(index) {
    this.topSlotIndex = index;
    if (index < 0 || !this.layout[index]) {
      this.topSlotMarker.visible = false;
      return;
    }
    const { start, end } = this.layout[index];
    this.topSlotMarker.geometry.dispose();
    this.topSlotMarker.geometry = new THREE.RingGeometry(FACE_RADIUS * 0.3, FACE_RADIUS * 0.985, 48, 1, Math.PI / 2 + start, end - start);
    this.topSlotMarker.visible = true;
  }

  /** Happy Hour: neon viola/oro al posto dell'ambra. */
  setHappyHour(on) {
    this.#happyHour = on;
  }

  update(t, dt) {
    // Molla del puntatore a passi fissi (stabile anche se il frame rate crolla)
    if (!this.externalPointer) {
      const p = this.#pointer;
      const STEP = 1 / 240;
      for (let left = dt; left > 0; left -= STEP) {
        const h = Math.min(STEP, left);
        p.velocity += (-180 * p.angle - 13 * p.velocity) * h;
        p.angle += p.velocity * h;
      }
      this.pointerPivot.rotation.z = p.angle;
    }

    // Lampada del puntatore: brace calda che "scatta" a ogni borchia
    this.#lampFlash = Math.max(0, this.#lampFlash - dt * 6);
    const breathe = 0.85 + 0.15 * Math.sin(t * 2.1);
    const glowColor = this.#happyHour ? PALETTE.violet : PALETTE.amber;
    this.lamp.material.color.copy(this.#happyHour ? PALETTE.hhGold : PALETTE.amber).multiplyScalar(2.2 * breathe + 3 * this.#lampFlash);
    this.crescent.material.color.copy(glowColor).multiplyScalar(2.4 * breathe);
    this.baseDome.material.color.copy(glowColor).multiplyScalar(1.6 * breathe);

    if (this.highlight.visible) this.highlight.material.opacity = 0.1 + 0.07 * Math.sin(t * 7);
    if (this.topSlotMarker.visible) this.topSlotMarker.material.opacity = 0.16 + 0.1 * Math.sin(t * 4);
    this.#updateNeon(t);
  }

  dispose() {
    this.root.traverse((obj) => {
      obj.geometry?.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => m?.dispose());
    });
    this.faceTexture.dispose();
  }

  // ------------------------------------------------------------------ costruzione

  #buildRotating(anisotropy) {
    const rotating = new THREE.Group();
    this.rotating = rotating;
    this.root.add(rotating);

    // disco di fondo (si vede solo di taglio)
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(FACE_RADIUS, FACE_RADIUS, 0.3, 96, 1),
      vinylMaterial({ color: PALETTE.navyDark, roughness: 0.8 }),
    );
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.15;
    rotating.add(back);

    this.faceCanvas = document.createElement('canvas');
    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTexture.colorSpace = THREE.SRGBColorSpace;
    this.faceTexture.anisotropy = anisotropy;
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(FACE_RADIUS, 128),
      vinylMaterial({
        map: this.faceTexture,
        // un filo di emissione: oro e scritte restano leggibili anche nella penombra
        emissive: 0xffffff,
        emissiveMap: this.faceTexture,
        emissiveIntensity: 0.16,
        roughness: 0.82,
        rimStrength: 0.1,
      }),
    );
    face.position.z = 0.001;
    rotating.add(face);

    this.highlight = new THREE.Mesh(
      new THREE.CircleGeometry(FACE_RADIUS, 8, 0, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.highlight.position.z = 0.01;
    this.highlight.visible = false;
    rotating.add(this.highlight);

    this.topSlotMarker = new THREE.Mesh(
      new THREE.RingGeometry(1, 2, 8, 1, 0, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.topSlotMarker.position.z = 0.012;
    this.topSlotMarker.visible = false;
    rotating.add(this.topSlotMarker);

    this.goldMaterial = vinylMaterial({ color: PALETTE.gold, roughness: 0.5, rimStrength: 1.1 });

    // Mozzo: base cilindrica + cupola blu notte, con la mezzaluna ambra della reference
    const navy = vinylMaterial({ color: PALETTE.navy, roughness: 0.62, rimStrength: 0.8 });
    const hubBase = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.7, 0.16, 48), navy);
    hubBase.rotation.x = Math.PI / 2;
    hubBase.position.z = 0.08;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.56, 48, 24, 0, TAU, 0, Math.PI / 2), navy);
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(1, 0.62, 1);
    dome.position.z = 0.15;
    this.crescent = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 10, 48, Math.PI * 0.9), new THREE.MeshBasicMaterial({ color: PALETTE.amber.clone() }));
    this.crescent.rotation.z = -Math.PI * 0.45;
    this.crescent.position.z = 0.33;
    rotating.add(hubBase, dome, this.crescent);
  }

  #buildFrame() {
    // bordo spesso e tondeggiante (torus "ciccione" da toy)
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.97, R * 0.12, 28, 160),
      vinylMaterial({ color: PALETTE.navy, roughness: 0.66, rimStrength: 0.9, rimPower: 2.4 }),
    );
    rim.scale.z = 0.85;
    this.root.add(rim);

    // anello oro sul fronte del bordo
    const goldRing = new THREE.Mesh(new THREE.TorusGeometry(GOLD_RING_R, 0.075, 14, 160), this.goldMaterial);
    goldRing.scale.z = 0.6;
    goldRing.position.z = 0.17;
    this.root.add(goldRing);
  }

  #buildPointer() {
    const navy = vinylMaterial({ color: PALETTE.navy, roughness: 0.6, rimStrength: 0.9 });
    // alloggiamento sopra la ruota (fisso al bordo)
    const housing = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.62, 0.9, 4, 0.2), navy);
    housing.position.set(0, R * 1.08, -0.05);
    this.root.add(housing);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 24), this.goldMaterial);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, R * 1.1, 0.45);
    this.root.add(collar);

    // puntatore a goccia, imperniato sotto la lampada
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.62);
    shape.bezierCurveTo(0.08, -0.4, 0.24, -0.18, 0.23, 0.02);
    shape.absarc(0, 0.02, 0.23, 0, Math.PI, false);
    shape.bezierCurveTo(-0.24, -0.18, -0.08, -0.4, 0, -0.62);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 4 });
    geo.translate(0, 0, -0.07);
    const drop = new THREE.Mesh(geo, navy);

    // lampada ambra (HDR: con il bloom "brilla" come nella reference)
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 18), new THREE.MeshBasicMaterial({ color: PALETTE.amber.clone() }));
    this.lamp.position.set(0, 0.02, 0.13);

    this.pointerPivot = new THREE.Group();
    this.pointerPivot.position.set(0, R * 1.1, 0.5);
    this.pointerPivot.add(drop, this.lamp);
    this.root.add(this.pointerPivot);
  }

  #buildStand() {
    const navy = vinylMaterial({ color: PALETTE.navy, roughness: 0.64, rimStrength: 0.8 });
    const navyDark = vinylMaterial({ color: PALETTE.navyDark, roughness: 0.7, rimStrength: 0.9 });
    const floor = STAND_FLOOR_Y;

    // colonna trapezoidale dietro la ruota
    const shape = new THREE.Shape();
    shape.moveTo(-1.25, 0);
    shape.lineTo(1.25, 0);
    shape.lineTo(0.75, 2.6);
    shape.lineTo(-0.75, 2.6);
    shape.closePath();
    const columnGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 4 });
    columnGeo.translate(0, 0, -0.4);
    const column = new THREE.Mesh(columnGeo, navy);
    column.position.set(0, floor + 0.42, -0.55);
    this.root.add(column);

    // pannello frontale con cornice oro e luce a mezza cupola
    const panel = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.62, 0.08, 2, 0.03), navyDark);
    panel.position.set(0, floor + 0.76, -0.12);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.72, 0.05, 2, 0.03), this.goldMaterial);
    frame.position.set(0, floor + 0.76, -0.16);
    // mezza cupola luminosa appoggiata sul basamento, davanti al pannello
    this.baseDome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 12, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: PALETTE.amber.clone() }));
    this.baseDome.scale.z = 0.6;
    this.baseDome.position.set(0, floor + 0.42, 0.2);
    this.root.add(panel, frame, this.baseDome);

    // tre LED sul fronte del basamento, a destra (equalizzatore durante lo spin)
    this.leds = new THREE.InstancedMesh(new RoundedBoxGeometry(0.2, 0.05, 0.05, 1, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }), 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      m.makeTranslation(1.55, floor + 0.1 + i * 0.11, 0.81);
      this.leds.setMatrixAt(i, m);
      this.leds.setColorAt(i, PALETTE.amber);
    }
    this.root.add(this.leds);

    // basamento arrotondato con filetto oro
    const base = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.42, 2.3, 4, 0.16), navy);
    base.position.set(0, floor + 0.21, -0.35);
    const trim = new THREE.Mesh(new RoundedBoxGeometry(4.46, 0.035, 2.36, 2, 0.015), this.goldMaterial);
    trim.position.set(0, floor + 0.13, -0.35);
    this.root.add(base, trim);
  }

  /** Borchie oro sui confini degli spicchi: sono anche i pioli contro cui sbatte il puntatore. */
  #buildStuds() {
    if (this.studs) {
      this.rotating.remove(this.studs);
      this.studs.geometry.dispose();
      this.studs.dispose();
    }
    const count = this.layout.length;
    const studs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 20, 14), this.goldMaterial, Math.max(1, count));
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + this.layout[i].start; // confine dello spicchio i (da +X)
      m.makeTranslation(Math.cos(a) * GOLD_RING_R, Math.sin(a) * GOLD_RING_R, 0.24);
      studs.setMatrixAt(i, m);
    }
    studs.count = count;
    studs.castShadow = true;
    studs.receiveShadow = true;
    // ruotano con la ruota: dentro il gruppo rotante, davanti all'anello fisso
    this.studs = studs;
    this.rotating.add(studs);
  }

  /**
   * Filo neon: un arco per spicchio, lungo quanto lo spicchio (che può essere espanso).
   * Mesh separate (12 draw call) perché ogni arco ha lunghezza e colore propri.
   */
  #buildNeonArcs() {
    if (this.neonArcs) {
      this.rotating.remove(this.neonArcs);
      this.neonArcs.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.neonArcs = new THREE.Group();
    for (const { start, end } of this.layout) {
      const span = end - start;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(NEON_R, 0.03, 8, 24, span * 0.86), new THREE.MeshBasicMaterial({ color: PALETTE.amber.clone() }));
      arc.rotation.z = Math.PI / 2 + start + span * 0.07;
      arc.position.z = 0.05;
      this.neonArcs.add(arc);
    }
    this.rotating.add(this.neonArcs);
  }

  #updateNeon(t) {
    if (!this.neonArcs) return;
    const { mode, color, since } = this.#lights;
    const arcs = this.neonArcs.children;
    const c = this.#tmpColor;
    const hh = this.#happyHour;
    // in Happy Hour i neon alternano viola e oro
    const base = (i) => (hh ? (i % 2 ? PALETTE.violet : PALETTE.hhGold) : PALETTE.amber);
    for (let i = 0; i < arcs.length; i++) {
      if (mode === 'spin') {
        // onda di luce che rincorre gli spicchi
        const k = (Math.sin(i * 1.1 + t * 16) + 1) / 2;
        c.copy(base(i)).multiplyScalar(0.4 + 3.2 * k ** 3);
      } else if (mode === 'win') {
        const winner = i === this.highlightIndex;
        const on = Math.floor((t - since) * 6) % 2 === 0;
        c.copy(winner ? color : base(i)).multiplyScalar(winner ? (on ? 4 : 1.2) : 0.5);
      } else {
        c.copy(base(i)).multiplyScalar((hh ? 2.4 : 1.7) + 0.25 * Math.sin(t * (hh ? 4 : 1.6) + i * 0.8));
      }
      arcs[i].material.color.copy(c);
    }

    // LED del piedistallo: equalizzatore durante lo spin, fissi altrimenti
    for (let i = 0; i < 3; i++) {
      const level = mode === 'spin' ? (Math.sin(t * (9 + i * 3) + i) + 1) / 2 : 0.8;
      c.copy(hh ? PALETTE.violet : PALETTE.amber).multiplyScalar(0.3 + 2.4 * level);
      this.leds.setColorAt(i, c);
    }
    this.leds.instanceColor.needsUpdate = true;
  }
}
