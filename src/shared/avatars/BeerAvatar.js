import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getBeer } from './beers.js';
import { vinylMaterial } from '../stage/vinyl.js';

/**
 * Avatar 3D "designer toy" come nella reference: bicchiere di vetro smerigliato colmo di birra,
 * schiuma cremosa che deborda appena, faccina minimale e braccine/gambette a tubo
 * del colore della birra. Sta seduto sul bancone con le gambe in avanti.
 *
 * Rig per le animazioni (pilotato da AvatarLineup):
 *  - body:            tutto il bicchiere (squash, inclinazioni)
 *  - arms[0|1]:       perni delle spalle sinistra/destra (rotation.z = alza di lato, .x = in avanti)
 *  - legs[0|1]:       perni delle anche (rotation.x negativa = calcia/alza il piede)
 *  - eyes:            gruppo occhi (scale.y per sbattere le palpebre)
 *
 * Prestazioni: le parti fisse sono fuse per materiale (≈ 10 draw call per avatar invece di ~40).
 * beerId null = bicchiere vuoto (giocatore disconnesso: la sua birra è tornata nel pool).
 */

/**
 * Forme dei bicchieri.
 *  kind 'cup':  corpo a tronco di cono (rb raggio sotto, rt sopra, h altezza) + dettagli
 *  kind 'bowl': calice a coppa sferica su stelo
 */
export const GLASS_SHAPES = {
  shaker: { kind: 'cup', rb: 0.3, rt: 0.37, h: 1.05 },
  nonic: { kind: 'cup', rb: 0.29, rt: 0.35, h: 1.12, bulge: 0.8 },
  weizen: { kind: 'cup', rb: 0.22, rt: 0.33, h: 1.3 },
  pilsner: { kind: 'cup', rb: 0.17, rt: 0.32, h: 1.15, foot: true },
  stange: { kind: 'cup', rb: 0.24, rt: 0.26, h: 1.22 },
  tumbler: { kind: 'cup', rb: 0.34, rt: 0.4, h: 0.86 },
  mug: { kind: 'cup', rb: 0.4, rt: 0.4, h: 0.95, handle: true, dimples: true },
  tulip: { kind: 'bowl', r: 0.4, stem: 0.3, mouth: 0.34, lip: 0.12 },
  snifter: { kind: 'bowl', r: 0.45, stem: 0.24, mouth: 0.3, lip: 0.04 },
};

const SEG = 36;
const BASE_T = 0.1;

function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Colori per vertice lungo Y: liquido più profondo sul fondo, più chiaro in alto. */
function paintGradient(geometry, bottom, top) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    c.copy(bottom).lerp(top, k ** 0.9).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class BeerAvatar {
  root = new THREE.Group();
  body = new THREE.Group();
  eyes = new THREE.Group();
  arms = [];
  legs = [];
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
    const colors = this.#palette(beer);

    const parts = new THREE.Group(); // parti fisse, fuse alla fine
    const g = shape.kind === 'bowl' ? this.#buildBowl(parts, shape, beer, colors) : this.#buildCup(parts, shape, beer, colors);
    this.#mergeInto(parts);
    this.#buildFace(g, beer);
    this.#buildLimbs(g, colors);
    this._height = g.top;

    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      }
    });
    this.#applyDim();
  }

  setDimmed(dimmed) {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    this.#applyDim();
  }

  dispose() {
    this.#clear();
  }

  // ------------------------------------------------------------------ materiali

  #palette(beer) {
    const liquid = new THREE.Color(beer?.liquid ?? '#8a8f99');
    const dark = luminance(liquid) < 0.06;
    return {
      liquid,
      foam: new THREE.Color(beer?.foam ?? '#ffffff'),
      // arti: come nella reference, del colore della birra; "gomma nera" per le scure
      limb: dark ? new THREE.Color('#1c1d22') : liquid.clone().offsetHSL(0, 0.05, -0.04),
      dark,
    };
  }

  #materialsFor(colors) {
    if (this._mats) return this._mats;
    this._mats = {
      // vetro smerigliato: traslucido, ruvido, bordo acceso dalla luce di taglio
      glass: this.#mat(
        vinylMaterial({ color: 0xe4ebf2, roughness: 0.5, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, rimStrength: 1.1, rimPower: 2.2 }),
      ),
      frost: this.#mat(vinylMaterial({ color: 0xdfe6ee, roughness: 0.6, transparent: true, opacity: 0.38, rimStrength: 0.9 })),
      // pochi riflessi d'ambiente sul liquido: le birre scure restano scure (non grigie)
      liquid: this.#mat(vinylMaterial({ vertexColors: true, roughness: 0.55, emissive: colors.liquid, emissiveIntensity: 0.1, envMapIntensity: 0.3, rimStrength: 0.6 })),
      foam: this.#mat(vinylMaterial({ color: colors.foam.clone().multiplyScalar(0.88), roughness: 0.93, envMapIntensity: 0.5, rimStrength: 0.7, rimPower: 2.4 })),
    };
    return this._mats;
  }

  #liquidGeometry(geometry, colors) {
    const deep = colors.liquid.clone().multiplyScalar(colors.dark ? 0.6 : 0.62);
    const light = colors.liquid.clone().lerp(new THREE.Color(0xffffff), colors.dark ? 0.06 : 0.16);
    return paintGradient(geometry, deep, light);
  }

  // ------------------------------------------------------------------ bicchieri

  #buildCup(parts, shape, beer, colors) {
    const { rb, rt, h } = shape;
    const mats = this.#materialsFor(colors);
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      parts.add(m);
      return m;
    };
    let y0 = 0;
    if (shape.foot) {
      add(new THREE.CylinderGeometry(0.26, 0.28, 0.07, SEG), mats.frost, 0, 0.035);
      y0 = 0.07;
    }
    add(new THREE.CylinderGeometry(rb * 1.03, rb * 1.06, BASE_T, SEG), mats.frost, 0, y0 + BASE_T / 2);
    add(new THREE.CylinderGeometry(rt, rb, h, SEG, 1, true), mats.glass, 0, y0 + h / 2);
    const rimY = y0 + h;
    add(new THREE.TorusGeometry(rt, 0.025, 8, SEG), mats.frost, 0, rimY, 0, Math.PI / 2);
    const radiusAt = (y) => rb + ((rt - rb) * (y - y0)) / h;

    if (shape.bulge) add(new THREE.TorusGeometry(radiusAt(y0 + h * shape.bulge) + 0.015, 0.035, 8, SEG), mats.frost, 0, y0 + h * shape.bulge, 0, Math.PI / 2);
    if (shape.handle) {
      // manico spesso del boccale (a destra, come nella reference)
      add(new THREE.TorusGeometry(0.27, 0.07, 12, 26, Math.PI * 1.1), mats.frost, rt + 0.03, y0 + h * 0.52, 0, 0, -Math.PI / 2 - 0.16);
    }
    if (shape.dimples) {
      // bugne ovali del boccale
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const bump = add(new THREE.CapsuleGeometry(0.075, 0.32, 4, 10), mats.frost, Math.sin(a) * (rb + 0.005), y0 + h * 0.36, Math.cos(a) * (rb + 0.005));
        bump.scale.set(1, 1, 0.35);
        bump.rotation.y = a;
      }
    }

    // liquido fino a sotto la fascia di schiuma, che si vede attraverso il vetro
    const foamBand = h * 0.17;
    const liquidBottom = y0 + BASE_T;
    const liquidTop = rimY - foamBand;
    if (beer) {
      const lh = liquidTop - liquidBottom;
      add(this.#liquidGeometry(new THREE.CylinderGeometry(radiusAt(liquidTop) * 0.93, radiusAt(liquidBottom) * 0.93, lh, SEG), colors), mats.liquid, 0, liquidBottom + lh / 2);
      this.#buildFoam(parts, mats.foam, radiusAt(liquidTop) * 0.93, liquidTop, rt, rimY);
    }

    const faceY = y0 + h * (beer ? 0.5 : 0.45);
    return {
      top: rimY + (beer ? 0.2 : 0.02),
      faceY,
      faceR: radiusAt(faceY),
      shoulderY: y0 + h * 0.4,
      shoulderR: radiusAt(y0 + h * 0.4),
      hipY: y0 + 0.12,
      hipZ: rb * 0.78,
      hipX: Math.min(0.14, rb * 0.5),
    };
  }

  #buildBowl(parts, shape, beer, colors) {
    const { r, stem, mouth, lip } = shape;
    const mats = this.#materialsFor(colors);
    const add = (geo, mat, y = 0, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.rotation.x = rx;
      parts.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.27, 0.3, 0.06, SEG), mats.frost, 0.03);
    add(new THREE.CylinderGeometry(0.055, 0.08, stem, 14), mats.frost, 0.06 + stem / 2);

    const cy = 0.06 + stem + r * 0.9;
    const thetaMouth = Math.asin(Math.min(0.99, mouth / r));
    add(new THREE.SphereGeometry(r, SEG, 22, 0, Math.PI * 2, thetaMouth, Math.PI - thetaMouth), mats.glass, cy);
    let rimY = cy + Math.cos(thetaMouth) * r;
    let rimR = mouth;
    if (lip > 0) {
      add(new THREE.CylinderGeometry(mouth * 1.12, mouth, lip, SEG, 1, true), mats.glass, rimY + lip / 2);
      rimY += lip;
      rimR = mouth * 1.12;
    }
    add(new THREE.TorusGeometry(rimR, 0.024, 8, SEG), mats.frost, rimY, Math.PI / 2);

    if (beer) {
      // la coppa è piena: liquido pieno e opaco come il tulipano della reference
      const lr = r * 0.93;
      const fillY = Math.cos(thetaMouth) * r * 0.82;
      const thetaFill = Math.acos(Math.min(0.99, fillY / lr));
      add(this.#liquidGeometry(new THREE.SphereGeometry(lr, SEG, 18, 0, Math.PI * 2, thetaFill, Math.PI - thetaFill), colors), mats.liquid, cy);
      this.#buildFoam(parts, mats.foam, Math.sin(thetaFill) * lr, cy + fillY, rimR, rimY);
    }
    return {
      top: rimY + (beer ? 0.2 : 0.02),
      faceY: cy + r * 0.05,
      faceR: r,
      shoulderY: cy - r * 0.05,
      shoulderR: r * 0.98,
      hipY: cy - r * 0.62,
      hipZ: r * 0.55,
      hipX: r * 0.42,
    };
  }

  /**
   * Schiuma cremosa e liscia (reference): una fascia dentro il vetro dal livello del liquido
   * fino al bordo, poi un "cappello" un filo più largo del bordo con lo spigolo arrotondato.
   */
  #buildFoam(parts, foamMat, innerR, fromY, rimR, rimY) {
    const add = (geo, y, rx = 0, sy = 1) => {
      const m = new THREE.Mesh(geo, foamMat);
      m.position.y = y;
      m.rotation.x = rx;
      m.scale.y = sy;
      parts.add(m);
    };
    const band = rimY - fromY;
    add(new THREE.CylinderGeometry(rimR * 0.95, innerR, band, SEG), fromY + band / 2);
    const capR = rimR * 1.04;
    const capH = 0.11;
    add(new THREE.CylinderGeometry(capR, capR, capH, SEG), rimY + capH / 2 - 0.02);
    add(new THREE.TorusGeometry(capR - 0.045, 0.045, 10, SEG), rimY + capH - 0.02, Math.PI / 2);
    // sommità appena bombata
    add(new THREE.SphereGeometry(capR - 0.045, SEG, 10, 0, Math.PI * 2, 0, Math.PI / 2), rimY + capH - 0.02, 0, 0.16);
  }

  // ------------------------------------------------------------------ faccina e arti

  #buildFace(g, beer) {
    const faceR = g.faceR + 0.01; // stampata sul vetro, sul davanti (+Z verso la camera)
    const ink = this.#mat(vinylMaterial({ color: 0x0b0b0d, roughness: 0.22, rimStrength: 0.2 }));
    const onSurface = (x, y) => {
      const ang = Math.asin(Math.max(-0.9, Math.min(0.9, x / faceR)));
      return new THREE.Vector3(Math.sin(ang) * faceR, y, Math.cos(ang) * faceR);
    };
    const spread = Math.min(0.1, faceR * 0.3);
    this.eyes.position.set(0, 0, 0);
    this.body.add(this.eyes);

    if (beer) {
      // occhi a puntino con un minuscolo riflesso: piccoli, come nella reference
      const eyeGeo = this.#geo(new THREE.SphereGeometry(0.034, 14, 10));
      const sparkleGeo = this.#geo(new THREE.SphereGeometry(0.01, 6, 4));
      const sparkleMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, ink);
        eye.scale.set(1, 1.15, 0.55);
        eye.position.copy(onSurface(side * spread, g.faceY));
        const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
        sparkle.position.set(0.012, 0.014, 0.03);
        eye.add(sparkle);
        this.eyes.add(eye);
      }
      const smile = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.03, 0.008, 6, 16, Math.PI)), ink);
      smile.rotation.z = Math.PI;
      smile.position.copy(onSurface(0, g.faceY - 0.06));
      this.body.add(smile);
    } else {
      // vuoto: occhi chiusi (archetti)
      for (const side of [-1, 1]) {
        const lid = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.032, 0.008, 6, 12, Math.PI)), ink);
        lid.rotation.z = Math.PI;
        lid.position.copy(onSurface(side * spread, g.faceY));
        this.eyes.add(lid);
      }
    }
  }

  /** Braccine e gambette a "tubo" con mani e piedi tondi, ognuna su un perno animabile. */
  #buildLimbs(g, colors) {
    const mat = this.#mat(vinylMaterial({ color: colors.limb, roughness: colors.dark ? 0.5 : 0.45, rimStrength: 1.2 }));
    const limbGeometry = (points, endRadius, endScale, tubeR) => {
      const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
      const tube = new THREE.TubeGeometry(curve, 12, tubeR, 8, false);
      const end = new THREE.SphereGeometry(endRadius, 14, 10);
      end.scale(...endScale);
      const tip = points[points.length - 1];
      end.translate(tip[0], tip[1], tip[2]);
      // tappo rotondo sulla spalla/anca
      const cap = new THREE.SphereGeometry(tubeR, 10, 8);
      const merged = mergeGeometries([tube.toNonIndexed(), end.toNonIndexed(), cap.toNonIndexed()]);
      [tube, end, cap].forEach((x) => x.dispose());
      return this.#geo(merged);
    };

    this.arms = [];
    this.legs = [];
    for (const side of [-1, 1]) {
      // braccio: dalla spalla scende piegato verso l'esterno; mano tonda
      const arm = new THREE.Group();
      arm.position.set(side * (g.shoulderR - 0.01), g.shoulderY, 0.03);
      arm.add(new THREE.Mesh(limbGeometry([[0, 0, 0], [side * 0.1, -0.05, 0.02], [side * 0.15, -0.19, 0.05], [side * 0.15, -0.27, 0.06]], 0.055, [1, 1, 1], 0.034), mat));
      arm.rotation.z = side * 0.2;
      this.body.add(arm);
      this.arms.push(arm);

      // gamba: dall'anca va in avanti e giù fino al bancone; piede a fagiolo con la punta in su
      const drop = g.hipY - 0.035;
      const leg = new THREE.Group();
      leg.position.set(side * g.hipX, g.hipY, g.hipZ);
      leg.add(
        new THREE.Mesh(
          limbGeometry([[0, 0, 0], [side * 0.02, -drop * 0.6, 0.12], [side * 0.03, -drop, 0.27]], 0.06, [1, 0.85, 1.5], 0.04),
          mat,
        ),
      );
      this.body.add(leg);
      this.legs.push(leg);
    }
  }

  // ------------------------------------------------------------------ util

  /** Fonde le parti fisse per materiale: molte meno draw call, stesso aspetto. */
  #mergeInto(parts) {
    parts.updateMatrixWorld(true);
    const byMaterial = new Map();
    parts.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.toNonIndexed();
      geo.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
      if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
      byMaterial.get(o.material).push(geo);
      o.geometry.dispose();
    });
    for (const [material, geos] of byMaterial) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(this.#geo(merged), material);
      if (material.transparent) mesh.renderOrder = 2;
      this.body.add(mesh);
    }
  }

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
    this.eyes.clear();
    this.#materials.forEach((m) => m.dispose());
    this.#geometries.forEach((g) => g.dispose());
    this.#materials = [];
    this.#geometries = [];
    this._mats = null;
    this.arms = [];
    this.legs = [];
  }
}
