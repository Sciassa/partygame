import * as THREE from 'three';
import { getBeer } from './beers.js';

/**
 * Avatar 3D "designer toy": un bicchiere di birra con faccina.
 * Placeholder procedurale (LatheGeometry), pensato per essere sostituito da modelli GLB
 * mantenendo la stessa API: new BeerAvatar(beerId) → .root (Group), .setBeer(), .setDimmed(), .dispose()
 *
 * Unità: il bicchiere è alto ~1.3 con origine alla base (y = 0), centrato su x/z.
 */

/**
 * Profili dei bicchieri: punti [raggio, altezza] dalla base al bordo (rivoluzione attorno a Y).
 *  - liquidFrom: altezza dove inizia la coppa (sopra lo stelo, nei calici)
 *  - fill:       altezza del liquido, come frazione dell'altezza del bicchiere
 *  - handle:     boccale con manico
 */
export const GLASS_PROFILES = {
  shaker: { points: [[0, 0], [0.3, 0], [0.31, 0.05], [0.4, 1.28], [0.41, 1.3]], liquidFrom: 0.06, fill: 0.78 },
  nonic: { points: [[0, 0], [0.31, 0], [0.32, 0.05], [0.37, 0.92], [0.43, 1.06], [0.4, 1.22], [0.4, 1.28]], liquidFrom: 0.06, fill: 0.8 },
  weizen: { points: [[0, 0], [0.25, 0], [0.25, 0.07], [0.19, 0.38], [0.27, 0.95], [0.35, 1.35], [0.33, 1.6]], liquidFrom: 0.08, fill: 0.78 },
  pilsner: { points: [[0, 0], [0.27, 0], [0.27, 0.07], [0.15, 0.16], [0.21, 0.6], [0.36, 1.48]], liquidFrom: 0.17, fill: 0.8 },
  tulip: { points: [[0, 0], [0.3, 0], [0.3, 0.04], [0.07, 0.09], [0.07, 0.3], [0.27, 0.46], [0.4, 0.78], [0.33, 1.08], [0.37, 1.24]], liquidFrom: 0.33, fill: 0.78 },
  snifter: { points: [[0, 0], [0.28, 0], [0.28, 0.04], [0.06, 0.09], [0.06, 0.3], [0.33, 0.45], [0.46, 0.72], [0.4, 0.98], [0.32, 1.1]], liquidFrom: 0.32, fill: 0.72 },
  mug: { points: [[0, 0], [0.42, 0], [0.44, 0.05], [0.44, 1.04], [0.45, 1.08]], liquidFrom: 0.08, fill: 0.8, handle: true },
  stange: { points: [[0, 0], [0.23, 0], [0.24, 0.05], [0.26, 1.45], [0.27, 1.48]], liquidFrom: 0.06, fill: 0.8 },
  tumbler: { points: [[0, 0], [0.35, 0], [0.36, 0.05], [0.45, 0.92], [0.46, 0.95]], liquidFrom: 0.06, fill: 0.78 },
};

const GLASS_THICKNESS = 0.9; // il liquido è il 90% del raggio interno: si vede il vetro attorno

/** Raggio del profilo a una certa altezza (interpolazione lineare sui tratti ascendenti). */
function radiusAt(points, y) {
  let r = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [r0, y0] = points[i];
    const [r1, y1] = points[i + 1];
    if (y1 > y0 && y >= y0 && y <= y1) r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return r;
}

function heightOf(points) {
  return points[points.length - 1][1];
}

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export class BeerAvatar {
  root = new THREE.Group(); // posizionato/animato da AvatarLineup
  body = new THREE.Group(); // contenuto (si può "squashare" senza toccare root)
  #materials = [];
  #geometries = [];

  constructor(beerId) {
    this.root.add(this.body);
    this.setBeer(beerId);
  }

  get height() {
    return this._height ?? 1.3;
  }

  /** Ricostruisce il bicchiere per un'altra birra (forma e colori). */
  setBeer(beerId) {
    if (this.beerId === beerId) return;
    this.beerId = beerId;
    this.#clear();
    const beer = getBeer(beerId);
    const profile = GLASS_PROFILES[beer.glass] ?? GLASS_PROFILES.shaker;
    const pts = profile.points;
    const H = heightOf(pts);
    this._height = H;

    // --- vetro: guscio satinato semi-trasparente
    const glassMat = this.#mat(
      new THREE.MeshStandardMaterial({
        color: 0xdfe8f2,
        roughness: 0.3,
        metalness: 0,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const glass = new THREE.Mesh(this.#geo(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40)), glassMat);
    glass.renderOrder = 2;

    // --- liquido: solido opaco dal fondo della coppa al livello di riempimento
    const yBottom = profile.liquidFrom + 0.02;
    const yTop = H * profile.fill;
    const liquidPts = [new THREE.Vector2(0, yBottom)];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const y = yBottom + ((yTop - yBottom) * i) / steps;
      liquidPts.push(new THREE.Vector2(radiusAt(pts, y) * GLASS_THICKNESS, y));
    }
    liquidPts.push(new THREE.Vector2(0, yTop));
    const liquidMat = this.#mat(
      new THREE.MeshStandardMaterial({ color: beer.liquid, roughness: 0.42, metalness: 0, emissive: beer.liquid, emissiveIntensity: 0.18 }),
    );
    const liquid = new THREE.Mesh(this.#geo(new THREE.LatheGeometry(liquidPts, 40)), liquidMat);

    // --- schiuma: cupola morbida che deborda un po' dal bordo + qualche "bolla" per l'effetto toy
    const rTop = radiusAt(pts, yTop) * GLASS_THICKNESS;
    const rRim = Math.max(radiusAt(pts, H - 0.001), rTop);
    const foamTop = Math.max(H + 0.12, yTop + 0.3);
    const foamPts = [
      [0, yTop],
      [rTop, yTop],
      [rRim * 1.02, H - 0.02],
      [rRim * 1.08, H + 0.03],
      [rRim * 0.95, foamTop - 0.08],
      [rRim * 0.6, foamTop - 0.01],
      [0, foamTop],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const foamMat = this.#mat(new THREE.MeshStandardMaterial({ color: beer.foam, roughness: 0.95, metalness: 0 }));
    const foam = new THREE.Mesh(this.#geo(new THREE.LatheGeometry(foamPts, 40)), foamMat);
    const bubbleGeo = this.#geo(new THREE.SphereGeometry(1, 16, 12));
    for (const [x, z, r] of [[-0.18, 0.08, 0.13], [0.16, -0.06, 0.15], [0.02, 0.16, 0.1]]) {
      const bubble = new THREE.Mesh(bubbleGeo, foamMat);
      bubble.scale.setScalar(r * (rRim / 0.4));
      bubble.position.set(x * (rRim / 0.4), foamTop - 0.06, z * (rRim / 0.4));
      foam.add(bubble);
    }

    this.body.add(liquid, foam, glass);

    // --- boccale: manico
    if (profile.handle) {
      const handle = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.25, 0.06, 10, 24, Math.PI)), glassMat);
      handle.rotation.z = -Math.PI / 2;
      handle.position.set(rRim + 0.02, H * 0.52, 0);
      this.body.add(handle);
    }

    // --- faccina sul davanti del liquido (verso +Z, cioè la camera)
    const faceY = yBottom + (yTop - yBottom) * 0.58;
    const faceR = radiusAt(pts, faceY) * GLASS_THICKNESS;
    const eyeColor = luminance(beer.liquid) < 0.12 ? 0xf4ead5 : 0x140c08;
    const eyeMat = this.#mat(new THREE.MeshStandardMaterial({ color: eyeColor, roughness: 0.4, metalness: 0 }));
    const sparkleMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const eyeGeo = this.#geo(new THREE.SphereGeometry(0.055, 16, 12));
    const sparkleGeo = this.#geo(new THREE.SphereGeometry(0.016, 8, 6));
    const eyeSpread = Math.min(0.13, faceR * 0.42);
    for (const side of [-1, 1]) {
      const angle = Math.asin(Math.min(0.95, (side * eyeSpread) / faceR));
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.set(1, 1.15, 0.55);
      eye.position.set(Math.sin(angle) * faceR, faceY, Math.cos(angle) * faceR);
      const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
      sparkle.position.set(0.018, 0.022, 0.05);
      eye.add(sparkle);
      this.body.add(eye);
    }
    const blushMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xff7a8a, transparent: true, opacity: 0.35, depthWrite: false }));
    const blushGeo = this.#geo(new THREE.CircleGeometry(0.045, 16));
    for (const side of [-1, 1]) {
      const angle = Math.asin(Math.min(0.95, (side * eyeSpread * 1.45) / faceR));
      const blush = new THREE.Mesh(blushGeo, blushMat);
      blush.position.set(Math.sin(angle) * faceR * 1.005, faceY - 0.09, Math.cos(angle) * faceR * 1.005);
      blush.rotation.y = angle;
      this.body.add(blush);
    }
    const smile = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.06, 0.014, 8, 20, Math.PI)), eyeMat);
    smile.rotation.z = Math.PI; // arco verso il basso = sorriso
    smile.position.set(0, faceY - 0.075, faceR + 0.005);
    this.body.add(smile);

    this.#applyDim();
  }

  /** Giocatore disconnesso: bicchiere sbiadito (l'animazione "ubriaca" la fa AvatarLineup). */
  setDimmed(dimmed) {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    this.#applyDim();
  }

  dispose() {
    this.#clear();
  }

  #applyDim() {
    for (const m of this.#materials) {
      m.userData.baseOpacity ??= m.opacity;
      m.userData.baseTransparent ??= m.transparent;
      m.transparent = this.dimmed ? true : m.userData.baseTransparent;
      m.opacity = this.dimmed ? m.userData.baseOpacity * 0.35 : m.userData.baseOpacity;
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
