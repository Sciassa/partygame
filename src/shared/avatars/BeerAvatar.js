import * as THREE from 'three';
import { getBeer } from './beers.js';
import { vinylMaterial } from '../stage/vinyl.js';

/**
 * Avatar 3D "designer toy": un bicchiere di birra colmo, costruito con primitive
 * (cilindri, sfere, torus), materiali vinile opachi e una faccina.
 *
 * API minima (sostituibile in futuro con modelli GLB senza toccare il resto):
 *   new BeerAvatar(beerId | null) → .root, .body, .height, .setBeer(), .setDimmed(), .dispose()
 * beerId null = bicchiere vuoto (giocatore disconnesso: la sua birra è tornata nel pool).
 *
 * Unità: origine alla base del bicchiere (y = 0), alto ~1.2–1.5.
 */

/**
 * Forme dei bicchieri.
 *  kind 'cup':  corpo cilindrico (raggio basso rb, alto rt, altezza h), eventuale piede/rigonfiamento
 *  kind 'bowl': calice a coppa sferica su stelo
 */
export const GLASS_SHAPES = {
  shaker: { kind: 'cup', rb: 0.3, rt: 0.39, h: 1.05 },
  nonic: { kind: 'cup', rb: 0.3, rt: 0.36, h: 1.05, bulge: 0.82 },
  weizen: { kind: 'cup', rb: 0.21, rt: 0.34, h: 1.32 },
  pilsner: { kind: 'cup', rb: 0.16, rt: 0.33, h: 1.18, foot: true },
  stange: { kind: 'cup', rb: 0.24, rt: 0.26, h: 1.3 },
  tumbler: { kind: 'cup', rb: 0.33, rt: 0.41, h: 0.88 },
  mug: { kind: 'cup', rb: 0.4, rt: 0.4, h: 0.95, handle: true },
  tulip: { kind: 'bowl', r: 0.38, stem: 0.32, mouth: 0.3, lip: 0.14 },
  snifter: { kind: 'bowl', r: 0.44, stem: 0.26, mouth: 0.27, lip: 0.05 },
};

const BASE_T = 0.1; // spessore del fondo di vetro
const SEG = 40;

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Colori per vertice lungo Y: liquido più scuro e saturo sul fondo, più chiaro verso la schiuma. */
function paintGradient(geometry, bottomColor, topColor) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    c.copy(bottomColor).lerp(topColor, k ** 0.8);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class BeerAvatar {
  root = new THREE.Group(); // posizionato/animato da AvatarLineup
  body = new THREE.Group(); // contenuto (squash & stretch senza toccare root)
  #materials = [];
  #geometries = [];

  constructor(beerId) {
    this.root.add(this.body);
    this.setBeer(beerId);
  }

  get height() {
    return this._height ?? 1.3;
  }

  setBeer(beerId) {
    if (this.beerId === beerId && this.body.children.length) return;
    this.beerId = beerId;
    this.#clear();
    const beer = beerId ? getBeer(beerId) : null;
    const shape = GLASS_SHAPES[beer?.glass ?? 'shaker'];
    const g = shape.kind === 'bowl' ? this.#buildBowl(shape, beer) : this.#buildCup(shape, beer);
    this._height = g.foamTop;
    this.#buildFace(g, beer);
    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      }
    });
    this.#applyDim();
  }

  /** Giocatore disconnesso: tutto sbiadito (l'inclinazione la fa AvatarLineup). */
  setDimmed(dimmed) {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    this.#applyDim();
  }

  dispose() {
    this.#clear();
  }

  // ------------------------------------------------------------------ materiali

  #glassMaterial() {
    return this.#mat(
      vinylMaterial({
        color: 0xe9f1f8,
        roughness: 0.32,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: THREE.DoubleSide,
        rimStrength: 1.6,
        rimPower: 2.0,
      }),
    );
  }

  #frostMaterial() {
    // fondo spesso e bordo: vetro "smerigliato" più pieno
    return this.#mat(vinylMaterial({ color: 0xdfe9f2, roughness: 0.45, transparent: true, opacity: 0.42, rimStrength: 1.2 }));
  }

  #liquidMaterial(beer) {
    return this.#mat(
      vinylMaterial({
        vertexColors: true,
        roughness: 0.62,
        emissive: beer.liquid,
        emissiveIntensity: 0.2,
        rimStrength: 0.7,
      }),
    );
  }

  #foamMaterial(beer) {
    return this.#mat(vinylMaterial({ color: beer.foam, roughness: 0.92, rimStrength: 0.9, rimPower: 2.2 }));
  }

  #liquidGeometry(geometry, beer) {
    const base = new THREE.Color(beer.liquid);
    const deep = base.clone().multiplyScalar(0.55);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.18);
    return paintGradient(geometry, deep, light);
  }

  // ------------------------------------------------------------------ bicchieri

  /** Pinta, nonic, weizen, pilsner, stange, tumbler, boccale. */
  #buildCup(shape, beer) {
    const { rb, rt, h } = shape;
    const glassMat = this.#glassMaterial();
    const frostMat = this.#frostMaterial();
    let y0 = 0;

    if (shape.foot) {
      const foot = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(0.27, 0.29, 0.07, SEG)), frostMat);
      foot.position.y = 0.035;
      this.body.add(foot);
      y0 = 0.07;
    }

    const bottom = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(rb * 1.02, rb * 1.05, BASE_T, SEG)), frostMat);
    bottom.position.y = y0 + BASE_T / 2;
    this.body.add(bottom);

    const wall = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(rt, rb, h, SEG, 1, true)), glassMat);
    wall.position.y = y0 + h / 2;
    wall.renderOrder = 2;
    this.body.add(wall);

    const rimY = y0 + h;
    const rim = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(rt, 0.028, 10, SEG)), frostMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = rimY;
    this.body.add(rim);

    const radiusAt = (y) => rb + ((rt - rb) * (y - y0)) / h;

    if (shape.bulge) {
      // il "gradino" della nonic
      const ring = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(radiusAt(y0 + h * shape.bulge) + 0.02, 0.035, 10, SEG)), frostMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y0 + h * shape.bulge;
      this.body.add(ring);
    }
    if (shape.handle) {
      const handle = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.26, 0.065, 12, 28, Math.PI * 1.15)), frostMat);
      handle.rotation.z = -Math.PI / 2 - 0.23;
      handle.position.set(rt + 0.02, y0 + h * 0.52, 0);
      this.body.add(handle);
    }

    // liquido: cilindro pieno leggermente più stretto del vetro
    const liquidBottom = y0 + BASE_T;
    const liquidTop = rimY - 0.04;
    if (beer) {
      const lh = liquidTop - liquidBottom;
      const liquidGeo = this.#liquidGeometry(
        new THREE.CylinderGeometry(radiusAt(liquidTop) * 0.92, radiusAt(liquidBottom) * 0.92, lh, SEG),
        beer,
      );
      const liquid = new THREE.Mesh(this.#geo(liquidGeo), this.#liquidMaterial(beer));
      liquid.position.y = liquidBottom + lh / 2;
      this.body.add(liquid);
      this.#addBubbles(beer, radiusAt(liquidTop) * 0.8, liquidBottom + 0.15, liquidTop - 0.05);
    }

    const foamTop = beer ? this.#buildFoam(beer, rt, rimY) : rimY;
    return { kind: 'cup', faceY: y0 + h * 0.48, faceR: radiusAt(y0 + h * 0.48), foamTop, rimY, rt };
  }

  /** Tulipano e ballon: piede + stelo + coppa sferica. */
  #buildBowl(shape, beer) {
    const { r, stem, mouth, lip } = shape;
    const glassMat = this.#glassMaterial();
    const frostMat = this.#frostMaterial();

    const foot = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(0.26, 0.29, 0.06, SEG)), frostMat);
    foot.position.y = 0.03;
    const stemMesh = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(0.055, 0.075, stem, 16)), frostMat);
    stemMesh.position.y = 0.06 + stem / 2;
    this.body.add(foot, stemMesh);

    // coppa: sfera aperta in alto dove il raggio scende a `mouth`
    const cy = 0.06 + stem + r * 0.92; // centro della sfera
    const thetaMouth = Math.asin(Math.min(0.99, mouth / r)); // angolo dall'asse +Y
    const bowl = new THREE.Mesh(this.#geo(new THREE.SphereGeometry(r, SEG, 24, 0, Math.PI * 2, thetaMouth, Math.PI - thetaMouth)), glassMat);
    bowl.position.y = cy;
    bowl.renderOrder = 2;
    this.body.add(bowl);

    let rimY = cy + Math.cos(thetaMouth) * r;
    let rimR = mouth;
    if (lip > 0) {
      // labbro svasato del tulipano
      const lipMesh = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(mouth * 1.18, mouth, lip, SEG, 1, true)), glassMat);
      lipMesh.position.y = rimY + lip / 2;
      lipMesh.renderOrder = 2;
      this.body.add(lipMesh);
      rimY += lip;
      rimR = mouth * 1.18;
    }
    const rim = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(rimR, 0.026, 10, SEG)), frostMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = rimY;
    this.body.add(rim);

    if (beer) {
      // liquido: sfera più piccola tagliata al livello di riempimento + tappo piatto
      const lr = r * 0.92;
      const fillY = Math.cos(thetaMouth) * r * 0.98; // quasi alla bocca
      const thetaFill = Math.acos(Math.min(0.99, fillY / lr));
      const liquidGeo = this.#liquidGeometry(new THREE.SphereGeometry(lr, SEG, 20, 0, Math.PI * 2, thetaFill, Math.PI - thetaFill), beer);
      const liquid = new THREE.Mesh(this.#geo(liquidGeo), this.#liquidMaterial(beer));
      liquid.position.y = cy;
      const capMat = this.#mat(vinylMaterial({ color: new THREE.Color(beer.liquid).lerp(new THREE.Color(0xffffff), 0.18), roughness: 0.62 }));
      const cap = new THREE.Mesh(this.#geo(new THREE.CircleGeometry(Math.sin(thetaFill) * lr, SEG)), capMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = cy + fillY;
      this.body.add(liquid, cap);
      this.#addBubbles(beer, lr * 0.55, cy - lr * 0.4, cy + fillY - 0.05);
    }

    const foamTop = beer ? this.#buildFoam(beer, rimR, rimY) : rimY;
    return { kind: 'bowl', faceY: cy - r * 0.05, faceR: r, foamTop, rimY, rt: rimR };
  }

  /**
   * Schiuma da toy: collare che deborda dal bordo, cupola, sbuffi tondi e una goccia
   * che cola sul davanti a destra.
   */
  #buildFoam(beer, rimR, rimY) {
    const foamMat = this.#foamMaterial(beer);
    const foam = new THREE.Group();
    const s = rimR / 0.38; // scala sulla bocca del bicchiere

    const collar = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(rimR * 0.98, 0.085 * s, 14, SEG)), foamMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = rimY + 0.03;
    foam.add(collar);

    const dome = new THREE.Mesh(this.#geo(new THREE.SphereGeometry(rimR * 0.98, SEG, 14, 0, Math.PI * 2, 0, Math.PI / 2)), foamMat);
    dome.scale.y = 0.55;
    dome.position.y = rimY + 0.03;
    foam.add(dome);

    const puffGeo = this.#geo(new THREE.SphereGeometry(1, 20, 14));
    const puffs = [
      [-0.17, 0.14, 0.06, 0.15],
      [0.15, 0.16, -0.04, 0.17],
      [0.0, 0.24, 0.02, 0.15],
      [-0.05, 0.12, -0.18, 0.13],
      [0.19, 0.08, 0.15, 0.11],
    ];
    for (const [x, y, z, r] of puffs) {
      const puff = new THREE.Mesh(puffGeo, foamMat);
      puff.scale.setScalar(r * s);
      puff.position.set(x * s, rimY + y * s, z * s);
      foam.add(puff);
    }

    // goccia di schiuma che cola fuori dal bicchiere
    const drip = new THREE.Mesh(this.#geo(new THREE.CapsuleGeometry(0.045 * s, 0.14 * s, 6, 12)), foamMat);
    const a = Math.PI * 0.32;
    drip.position.set(Math.sin(a) * (rimR + 0.02), rimY - 0.07 * s, Math.cos(a) * (rimR + 0.02));
    foam.add(drip);

    this.body.add(foam);
    return rimY + 0.36 * s;
  }

  /** Bollicine chiare dentro il liquido (vista attraverso il vetro). */
  #addBubbles(beer, spread, yMin, yMax) {
    const mat = this.#mat(vinylMaterial({ color: new THREE.Color(beer.liquid).lerp(new THREE.Color(0xffffff), 0.6), roughness: 0.4, rimStrength: 0.4 }));
    const geo = this.#geo(new THREE.SphereGeometry(0.028, 8, 6));
    const seed = [...beer.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    for (let i = 0; i < 5; i++) {
      const t = ((seed * (i + 3)) % 97) / 97;
      const ang = ((seed * (i + 7)) % 360) * (Math.PI / 180);
      const b = new THREE.Mesh(geo, mat);
      b.position.set(Math.cos(ang) * spread * 0.9, yMin + (yMax - yMin) * t, Math.abs(Math.sin(ang)) * spread * 0.9 + 0.02);
      this.body.add(b);
    }
  }

  // ------------------------------------------------------------------ faccina

  #buildFace(g, beer) {
    const faceY = g.faceY;
    const faceR = g.faceR + 0.012; // stampata sul vetro, davanti (+Z, verso la camera)
    const dark = beer && luminance(beer.liquid) < 0.12;
    const inkColor = dark ? 0xf4ead5 : 0x1a100a;
    const ink = this.#mat(vinylMaterial({ color: inkColor, roughness: 0.25, rimStrength: 0.3 })); // occhi lucidi
    const spread = Math.min(0.13, faceR * 0.4);
    const onSurface = (x, y, push = 0) => {
      const ang = Math.asin(Math.max(-0.95, Math.min(0.95, x / faceR)));
      return new THREE.Vector3(Math.sin(ang) * (faceR + push), y, Math.cos(ang) * (faceR + push));
    };

    if (beer) {
      const eyeGeo = this.#geo(new THREE.SphereGeometry(0.06, 18, 14));
      const sparkleGeo = this.#geo(new THREE.SphereGeometry(0.018, 8, 6));
      const sparkleMat = this.#mat(new THREE.MeshBasicMaterial({ color: dark ? 0x1a100a : 0xffffff }));
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, ink);
        eye.scale.set(1, 1.2, 0.5);
        eye.position.copy(onSurface(side * spread, faceY));
        const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
        sparkle.position.set(0.02, 0.025, 0.05);
        eye.add(sparkle);
        this.body.add(eye);
      }
      const smile = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.06, 0.015, 8, 20, Math.PI)), ink);
      smile.rotation.z = Math.PI;
      smile.position.copy(onSurface(0, faceY - 0.085, 0.004));
      this.body.add(smile);
    } else {
      // bicchiere vuoto: occhi chiusi (archetti) — "è uscito dal pub"
      for (const side of [-1, 1]) {
        const lid = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.045, 0.012, 6, 14, Math.PI)), ink);
        lid.rotation.z = Math.PI;
        lid.position.copy(onSurface(side * spread, faceY));
        this.body.add(lid);
      }
    }

    const blushMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xff7a8a, transparent: true, opacity: 0.45, depthWrite: false }));
    const blushGeo = this.#geo(new THREE.CircleGeometry(0.042, 16));
    for (const side of [-1, 1]) {
      const p = onSurface(side * spread * 1.55, faceY - 0.075, 0.002);
      const blush = new THREE.Mesh(blushGeo, blushMat);
      blush.position.copy(p);
      blush.rotation.y = Math.atan2(p.x, p.z);
      this.body.add(blush);
    }
  }

  // ------------------------------------------------------------------ util

  #applyDim() {
    for (const m of this.#materials) {
      m.userData.baseOpacity ??= m.opacity;
      m.userData.baseTransparent ??= m.transparent;
      m.transparent = this.dimmed ? true : m.userData.baseTransparent;
      m.opacity = this.dimmed ? m.userData.baseOpacity * 0.4 : m.userData.baseOpacity;
      m.needsUpdate = true;
    }
  }

  #mat(m) {
    this.#materials.push(m);
    return m;
  }

  #geo(g) {
    this.#geometries.push(g);
    return g;
  }

  #clear() {
    this.body.clear();
    this.#materials.forEach((m) => m.dispose());
    this.#geometries.forEach((g) => g.dispose());
    this.#materials = [];
    this.#geometries = [];
  }
}
