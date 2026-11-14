import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getBeer } from '../shared/avatars/beers.js';
import { vinylMaterial } from '../shared/stage/vinyl.js';

/**
 * BeerAvatarBuilder — costruzione geometrica dei bicchieri-avatar.
 *
 * Ogni bicchiere è un solido di rotazione (THREE.LatheGeometry, 32 segmenti) generato da un
 * profilo 2D (raggio, altezza). Lo stesso profilo guida TUTTO il resto, tramite getRadiusAtY():
 *  - il liquido (stesso profilo rimpicciolito del 7%),
 *  - la schiuma (cilindro smussato + 5 sfere, larga quanto la bocca),
 *  - gli occhi e la bocca (incollati alla superficie del vetro, mai "fluttuanti" né compenetrati),
 *  - le spalle delle braccia (perno a raggio+0.04 dalla parete, all'altezza giusta).
 *
 * Coordinate locali: y = 0 è il piano d'appoggio dei piedi; il bicchiere è sollevato di
 * BODY_Y_OFFSET (0.14) per far spazio alle gambette. +Z guarda verso la camera.
 */

export type GlassProfileId = 'PINT_GLASS' | 'MUG_STEIN' | 'TULIP_STEM' | 'WEISS_TALL';

interface GlassProfile {
  /** Contorno esterno dal fondo (y=0) alla bocca: coppie [raggio, y]. */
  points: ReadonlyArray<readonly [number, number]>;
  height: number;
  /** Da dove parte il liquido (y locale al bicchiere): sopra il fondo spesso o sopra lo stelo. */
  liquidFrom: number;
  /** Altezza normalizzata della faccina e delle spalle. */
  faceY: number;
  armY: number;
}

export const GLASS_PROFILES: Record<GlassProfileId, GlassProfile> = {
  // Pinta "nonic": base 0.28 che si allarga fino alla bocca, rigonfiamento a y 0.85 (r 0.38)
  PINT_GLASS: {
    points: [
      [0.26, 0],
      [0.28, 0.025],
      [0.29, 0.2],
      [0.31, 0.45],
      [0.34, 0.68],
      [0.37, 0.8],
      [0.38, 0.85],
      [0.365, 0.9],
      [0.355, 1.0],
      [0.36, 1.1],
    ],
    height: 1.1,
    liquidFrom: 0.07,
    faceY: 0.5,
    armY: 0.42,
  },
  // Boccale: cilindro dritto r 0.36 (il manico è aggiunto a parte)
  MUG_STEIN: {
    points: [
      [0.34, 0],
      [0.36, 0.03],
      [0.36, 0.2],
      [0.36, 0.5],
      [0.36, 0.8],
      [0.365, 0.92],
      [0.37, 0.95],
    ],
    height: 0.95,
    liquidFrom: 0.08,
    faceY: 0.52,
    armY: 0.45,
  },
  // Calice a tulipano: piede r 0.25, stelo r 0.07 fino a y 0.35, coppa r 0.37 a y 0.65, bocca 0.30
  TULIP_STEM: {
    points: [
      [0.25, 0],
      [0.25, 0.025],
      [0.13, 0.05],
      [0.07, 0.09],
      [0.07, 0.35],
      [0.17, 0.4],
      [0.29, 0.5],
      [0.355, 0.58],
      [0.37, 0.65],
      [0.355, 0.76],
      [0.32, 0.88],
      [0.3, 0.98],
      [0.305, 1.04],
    ],
    height: 1.04,
    liquidFrom: 0.39,
    faceY: 0.66,
    armY: 0.6,
  },
  // Weizen alto: 1.25, base 0.24, vita 0.22, bocca 0.34
  WEISS_TALL: {
    points: [
      [0.24, 0],
      [0.245, 0.04],
      [0.23, 0.25],
      [0.22, 0.45],
      [0.24, 0.65],
      [0.28, 0.82],
      [0.32, 1.0],
      [0.34, 1.15],
      [0.335, 1.25],
    ],
    height: 1.25,
    liquidFrom: 0.08,
    faceY: 0.5,
    armY: 0.44,
  },
};

/** Birra → forma del bicchiere. */
export const BEER_PROFILE: Record<string, GlassProfileId> = {
  stout: 'PINT_GLASS',
  redale: 'PINT_GLASS',
  porter: 'PINT_GLASS',
  lager: 'MUG_STEIN',
  bock: 'MUG_STEIN',
  ipa: 'TULIP_STEM',
  sour: 'TULIP_STEM',
  barleywine: 'TULIP_STEM',
  weiss: 'WEISS_TALL',
  pilsner: 'WEISS_TALL',
  blanche: 'WEISS_TALL',
  neipa: 'WEISS_TALL',
};

export function profileForBeer(beerId: string | null | undefined): GlassProfileId {
  return (beerId && BEER_PROFILE[beerId]) || 'PINT_GLASS';
}

/**
 * Raggio esterno del vetro a un'altezza normalizzata (0 = fondo, 1 = bocca),
 * interpolando linearmente il profilo.
 */
export function getRadiusAtY(profileId: GlassProfileId, normalizedY: number): number {
  const profile = GLASS_PROFILES[profileId];
  const y = Math.max(0, Math.min(1, normalizedY)) * profile.height;
  const pts = profile.points;
  for (let i = 1; i < pts.length; i++) {
    const [r1, y1] = pts[i];
    if (y <= y1) {
      const [r0, y0] = pts[i - 1];
      const k = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * k;
    }
  }
  return pts[pts.length - 1][0];
}

/** Sollevamento del bicchiere per le gambette. */
export const BODY_Y_OFFSET = 0.14;
const LATHE_SEGMENTS = 32;
const FOAM_COLOR = 0xfff8e7;
const EYE_ANGLE = 0.22;

export interface BuiltBeerAvatar {
  root: THREE.Group;
  /** Tutto ciò che sta sopra le gambe: squash, dondolio e inclinazioni si applicano qui. */
  body: THREE.Group;
  /** Gruppo occhi, centrato all'altezza degli occhi: scale.y → palpebre. */
  eyes: THREE.Group;
  /** Perni delle spalle [sinistra, destra]: rotation.z alza di lato, rotation.x negativa porta in avanti. */
  arms: THREE.Group[];
  /** Posa a riposo delle braccia (le animazioni si sommano a questa). */
  armRest: Array<{ x: number; z: number }>;
  /** Perni delle anche [sinistra, destra]: rotation.x negativa = calcio in avanti. */
  legs: THREE.Group[];
  profile: GlassProfileId;
  beerId: string | null;
  /** Altezza totale (piedi → cima della schiuma). */
  height: number;
  /** Altezza della bocca del bicchiere (sopra i piedi). */
  glassTop: number;
  /** Fascia di liquido, in coordinate di `body` (per le bollicine). */
  liquid: { bottom: number; top: number };
  /** Raggio interno utile a un'altezza di `body`. */
  innerRadiusAt(y: number): number;
  setDimmed(dimmed: boolean): void;
  /** 0..1: bagnato dalla Birra Analcolica (grigio, lucido, gocce). */
  setWet(amount: number): void;
  dispose(): void;
}

interface Palette {
  liquid: THREE.Color;
  foam: THREE.Color;
  limb: THREE.Color;
  shoe: THREE.Color;
  dark: boolean;
}

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Rimuove gli attributi extra e converte in non indicizzata: mergeGeometries vuole attributi identici. */
function normalizeForMerge(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

export class BeerAvatarBuilder {
  /** Costruisce l'avatar della birra `beerId` (null = bicchiere vuoto: giocatore disconnesso). */
  static build(beerId: string | null): BuiltBeerAvatar {
    return new BeerAvatarBuild(beerId).result();
  }
}

class BeerAvatarBuild {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly eyes = new THREE.Group();
  readonly arms: THREE.Group[] = [];
  readonly armRest: Array<{ x: number; z: number }> = [];
  readonly legs: THREE.Group[] = [];
  readonly materials: THREE.Material[] = [];
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly profileId: GlassProfileId;
  readonly profile: GlassProfile;
  readonly palette: Palette;
  readonly beerId: string | null;
  readonly wetDrops = new THREE.Group();
  #tintable: Array<{ mat: THREE.MeshStandardMaterial; base: THREE.Color; baseRough: number }> = [];
  #dimmed = false;
  #wet = 0;
  #foamTop = 0;
  #liquid = { bottom: 0, top: 0 };

  constructor(beerId: string | null) {
    this.beerId = beerId;
    this.profileId = profileForBeer(beerId);
    this.profile = GLASS_PROFILES[this.profileId];
    const beer = beerId ? getBeer(beerId) : null;
    this.palette = this.#paletteFor(beer);

    this.root.add(this.body);
    this.body.position.y = BODY_Y_OFFSET;
    this.#buildGlass();
    if (beer) {
      this.#buildLiquid();
      this.#buildFoam();
    }
    this.#buildFace(Boolean(beer));
    this.#buildArms();
    this.#buildLegs();
    this.#buildWetDrops();

    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
    });
  }

  result(): BuiltBeerAvatar {
    const self = this;
    const height = BODY_Y_OFFSET + (this.beerId ? this.#foamTop : this.profile.height + 0.02);
    return {
      root: this.root,
      body: this.body,
      eyes: this.eyes,
      arms: this.arms,
      armRest: this.armRest,
      legs: this.legs,
      profile: this.profileId,
      beerId: this.beerId,
      height,
      glassTop: BODY_Y_OFFSET + this.profile.height,
      liquid: { ...this.#liquid },
      innerRadiusAt: (y: number) => this.#radius(y / this.profile.height) * 0.86,
      setDimmed(dimmed: boolean) {
        self.#setDimmed(dimmed);
      },
      setWet(amount: number) {
        self.#setWet(amount);
      },
      dispose() {
        self.materials.forEach((m) => m.dispose());
        self.geometries.forEach((g) => g.dispose());
        self.root.removeFromParent();
        self.root.clear();
      },
    };
  }

  // ------------------------------------------------------------------ materiali

  #paletteFor(beer: ReturnType<typeof getBeer> | null): Palette {
    const liquid = new THREE.Color(beer?.liquid ?? '#8a8f99');
    const dark = luminance(liquid) < 0.06;
    const accent = new THREE.Color(beer?.accent ?? '#8a8f99');
    return {
      liquid,
      foam: new THREE.Color(FOAM_COLOR).lerp(new THREE.Color(beer?.foam ?? '#ffffff'), 0.35),
      limb: dark ? new THREE.Color('#1c1d22') : liquid.clone().offsetHSL(0, 0.05, -0.05),
      shoe: accent.clone().multiplyScalar(0.55),
      dark,
    };
  }

  #mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  #geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  #tint(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.#tintable.push({ mat, base: mat.color.clone(), baseRough: mat.roughness });
    return mat;
  }

  #radius(normalizedY: number): number {
    return getRadiusAtY(this.profileId, normalizedY);
  }

  // ------------------------------------------------------------------ vetro

  #buildGlass(): void {
    const { points, height } = this.profile;
    const outline = [new THREE.Vector2(0, 0), ...points.map(([r, y]) => new THREE.Vector2(r, y))];
    const lathe = this.#geo(new THREE.LatheGeometry(outline, LATHE_SEGMENTS));
    const glass = this.#mat(
      vinylMaterial({ color: 0xe4ebf2, roughness: 0.45, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, rimStrength: 1.15, rimPower: 2.2 }),
    );
    const shell = new THREE.Mesh(lathe, glass);
    shell.renderOrder = 2;
    this.body.add(shell);

    // fondo spesso smerigliato + bordo della bocca
    const frost = this.#mat(vinylMaterial({ color: 0xdfe6ee, roughness: 0.6, transparent: true, opacity: 0.42, rimStrength: 0.9 }));
    const parts: THREE.BufferGeometry[] = [];
    const rimR = points[points.length - 1][0];
    const rim = new THREE.TorusGeometry(rimR, 0.022, 8, LATHE_SEGMENTS);
    parts.push(normalizeForMerge(rim, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, height, 0)));
    rim.dispose();
    const baseR = points[0][0];
    const base = new THREE.CylinderGeometry(baseR * 1.01, baseR * 1.03, 0.05, LATHE_SEGMENTS);
    parts.push(normalizeForMerge(base, new THREE.Matrix4().makeTranslation(0, 0.025, 0)));
    base.dispose();

    if (this.profileId === 'PINT_GLASS') {
      // anello del rigonfiamento "nonic"
      const y = 0.85;
      const ring = new THREE.TorusGeometry(this.#radius(y / height) + 0.005, 0.022, 8, LATHE_SEGMENTS);
      parts.push(normalizeForMerge(ring, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, y, 0)));
      ring.dispose();
    }
    if (this.profileId === 'TULIP_STEM') {
      // stelo pieno (il lathe è solo la pelle)
      const stem = new THREE.CylinderGeometry(0.06, 0.065, 0.3, 14);
      parts.push(normalizeForMerge(stem, new THREE.Matrix4().makeTranslation(0, 0.22, 0)));
      stem.dispose();
    }
    if (this.profileId === 'MUG_STEIN') {
      // manico: Torus(0.18, 0.04, 12, 24, π) a x 0.36, y 0.55, ruotato di -π/2 su Z
      const handle = new THREE.TorusGeometry(0.18, 0.04, 12, 24, Math.PI);
      const m = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(0.36, 0.55 * (height / 0.95) - 0.07, 0);
      parts.push(normalizeForMerge(handle, m));
      handle.dispose();
      // bugne ovali del boccale
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        if (Math.abs(Math.sin(a)) > 0.92 && Math.sin(a) > 0) continue; // lascia libero il manico
        const bump = new THREE.CapsuleGeometry(0.06, 0.28, 4, 10);
        const mm = new THREE.Matrix4()
          .makeRotationY(a)
          .multiply(new THREE.Matrix4().makeScale(1, 1, 0.35))
          .setPosition(Math.sin(a) * 0.362, 0.36, Math.cos(a) * 0.362);
        parts.push(normalizeForMerge(bump, mm));
        bump.dispose();
      }
    }
    const merged = this.#geo(mergeGeometries(parts));
    parts.forEach((p) => p.dispose());
    const frostMesh = new THREE.Mesh(merged, frost);
    frostMesh.renderOrder = 2;
    this.body.add(frostMesh);
  }

  // ------------------------------------------------------------------ liquido e schiuma

  #buildLiquid(): void {
    const { height, liquidFrom } = this.profile;
    const top = height * 0.8;
    const bottom = liquidFrom;
    this.#liquid = { bottom, top };
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, bottom)];
    const STEPS = 14;
    for (let i = 0; i <= STEPS; i++) {
      const y = bottom + ((top - bottom) * i) / STEPS;
      pts.push(new THREE.Vector2(this.#radius(y / height) * 0.93, y));
    }
    pts.push(new THREE.Vector2(0, top));
    const geo = this.#geo(new THREE.LatheGeometry(pts, LATHE_SEGMENTS));

    // gradiente verticale per vertice: più profondo sul fondo, più chiaro in alto
    const { liquid, dark } = this.palette;
    const deep = liquid.clone().multiplyScalar(dark ? 0.6 : 0.62);
    const light = liquid.clone().lerp(new THREE.Color(0xffffff), dark ? 0.06 : 0.16);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = (pos.getY(i) - bottom) / Math.max(1e-6, top - bottom);
      c.copy(deep).lerp(light, Math.max(0, Math.min(1, k)) ** 0.9).toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = this.#tint(
      this.#mat(vinylMaterial({ vertexColors: true, roughness: 0.55, emissive: liquid, emissiveIntensity: 0.1, envMapIntensity: 0.3, rimStrength: 0.6 })),
    );
    this.body.add(new THREE.Mesh(geo, mat));
  }

  /** Schiuma: cilindro smussato dal livello del liquido fino a sopra la bocca + 5 sfere morbide. */
  #buildFoam(): void {
    const { height } = this.profile;
    const from = this.#liquid.top;
    const rimR = this.#radius(1);
    const parts: THREE.BufferGeometry[] = [];
    const push = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
      parts.push(normalizeForMerge(g, m));
      g.dispose();
    };
    // fascia dentro il vetro (segue il profilo)
    const bandPts: THREE.Vector2[] = [];
    const STEPS = 6;
    for (let i = 0; i <= STEPS; i++) {
      const y = from + ((height - from) * i) / STEPS;
      bandPts.push(new THREE.Vector2(this.#radius(y / height) * 0.95, y));
    }
    push(new THREE.LatheGeometry(bandPts, LATHE_SEGMENTS), new THREE.Matrix4());

    // cappello: cilindro un filo più largo della bocca, spigolo smussato con un toro
    const capR = rimR * 1.04;
    const capH = 0.1;
    push(new THREE.CylinderGeometry(capR - 0.04, capR, capH, LATHE_SEGMENTS), new THREE.Matrix4().makeTranslation(0, height + capH / 2 - 0.02, 0));
    push(new THREE.TorusGeometry(capR - 0.04, 0.04, 10, LATHE_SEGMENTS), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, height + capH - 0.02, 0));

    // 5 sfere: quattro intorno e una al centro, più alta (la "nuvola" di schiuma)
    const topY = height + capH - 0.02;
    const blobs: Array<[number, number, number, number]> = [
      [0, 0.06, 0, rimR * 0.55],
      [rimR * 0.48, 0.02, rimR * 0.18, rimR * 0.36],
      [-rimR * 0.46, 0.025, rimR * 0.22, rimR * 0.38],
      [rimR * 0.2, 0.01, -rimR * 0.45, rimR * 0.34],
      [-rimR * 0.25, 0.015, -rimR * 0.42, rimR * 0.33],
    ];
    let maxY = topY;
    for (const [x, dy, z, r] of blobs) {
      const s = new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      push(s, new THREE.Matrix4().makeScale(1, 0.62, 1).setPosition(x, topY + dy - 0.01, z));
      maxY = Math.max(maxY, topY + dy + r * 0.62);
    }
    this.#foamTop = maxY;

    const mat = this.#tint(this.#mat(vinylMaterial({ color: this.palette.foam.clone().multiplyScalar(0.9), roughness: 0.9, envMapIntensity: 0.5, rimStrength: 0.7, rimPower: 2.4 })));
    const merged = this.#geo(mergeGeometries(parts));
    parts.forEach((p) => p.dispose());
    this.body.add(new THREE.Mesh(merged, mat));
  }

  // ------------------------------------------------------------------ faccina

  /**
   * Occhi: Sphere(0.038) schiacciate in z (0.5), a ±0.22 rad attorno all'asse, su un cilindro di
   * raggio getRadiusAtY(faceY) + 0.025 → appoggiati al vetro, mai dentro. Riflesso r 0.012.
   * Bocca: Torus(0.035, 0.012, 8, 16, π) 0.07 sotto gli occhi.
   */
  #buildFace(full: boolean): void {
    const { height, faceY } = this.profile;
    const yEyes = height * faceY;
    const R = this.#radius(faceY) + 0.025;
    const ink = this.#mat(vinylMaterial({ color: 0x0b0b0d, roughness: 0.22, rimStrength: 0.2 }));

    this.eyes.position.set(0, yEyes, 0);
    this.body.add(this.eyes);

    if (full) {
      const eyeGeo = this.#geo(new THREE.SphereGeometry(0.038, 16, 16));
      const sparkleGeo = this.#geo(new THREE.SphereGeometry(0.012, 8, 6));
      const sparkleMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      for (const side of [-1, 1]) {
        const a = side * EYE_ANGLE;
        const eye = new THREE.Mesh(eyeGeo, ink);
        eye.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
        eye.rotation.y = a; // la faccia piatta dell'ellissoide segue la curvatura
        eye.scale.set(1, 1.1, 0.5);
        const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
        sparkle.position.set(0.012, 0.014, 0.02 / 0.5);
        eye.add(sparkle);
        this.eyes.add(eye);
      }
      const mouth = new THREE.Mesh(this.#geo(new THREE.TorusGeometry(0.035, 0.012, 8, 16, Math.PI)), ink);
      const yMouth = yEyes - 0.07;
      const Rm = this.#radius(yMouth / height) + 0.025;
      mouth.rotation.z = Math.PI; // arco rivolto in giù = sorriso
      mouth.position.set(0, yMouth, Rm);
      this.body.add(mouth);
    } else {
      // bicchiere vuoto: occhi chiusi ad archetto
      const lidGeo = this.#geo(new THREE.TorusGeometry(0.032, 0.009, 6, 12, Math.PI));
      for (const side of [-1, 1]) {
        const a = side * EYE_ANGLE;
        const lid = new THREE.Mesh(lidGeo, ink);
        lid.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
        lid.rotation.set(0, a, Math.PI);
        this.eyes.add(lid);
      }
    }
  }

  // ------------------------------------------------------------------ arti

  #limbMaterial(): THREE.MeshStandardMaterial {
    return this.#tint(this.#mat(vinylMaterial({ color: this.palette.limb, roughness: this.palette.dark ? 0.5 : 0.45, rimStrength: 1.2 })));
  }

  /**
   * Braccia: Capsule(0.03, 0.18) con il perno sulla spalla, a x = ±(raggio(armY) + 0.04).
   * Il boccale ha il manico a destra: le braccia sono portate avanti di ~25° per non compenetrarlo.
   */
  #buildArms(): void {
    const { height, armY } = this.profile;
    const y = height * armY;
    const shoulderX = this.#radius(armY) + 0.04;
    const mat = this.#limbMaterial();
    const armGeo = this.#geo(new THREE.CapsuleGeometry(0.03, 0.18, 8, 8).translate(0, -0.12, 0));
    const handGeo = this.#geo(new THREE.SphereGeometry(0.045, 14, 10).translate(0, -0.23, 0.005));
    const isMug = this.profileId === 'MUG_STEIN';
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * shoulderX, y, isMug ? 0.1 : 0.02);
      pivot.add(new THREE.Mesh(armGeo, mat), new THREE.Mesh(handGeo, mat));
      const rest = { x: isMug ? -0.44 : -0.08, z: side * 0.32 };
      pivot.rotation.set(rest.x, 0, rest.z);
      this.body.add(pivot);
      this.arms.push(pivot);
      this.armRest.push(rest);
    }
  }

  /** Gambe a (±0.12, 0.07, 0.05) sotto il bicchiere sollevato, scarpette Capsule(0.045, 0.08) verso +Z. */
  #buildLegs(): void {
    const mat = this.#limbMaterial();
    const shoeMat = this.#tint(this.#mat(vinylMaterial({ color: this.palette.shoe, roughness: 0.55, rimStrength: 1 })));
    const legGeo = this.#geo(new THREE.CapsuleGeometry(0.034, 0.08, 6, 8).translate(0, -0.07, 0));
    const shoeGeo = this.#geo(new THREE.CapsuleGeometry(0.045, 0.08, 6, 10).rotateX(Math.PI / 2).translate(0, -0.1, 0.045));
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, 0.145, 0.05);
      hip.add(new THREE.Mesh(legGeo, mat), new THREE.Mesh(shoeGeo, shoeMat));
      this.root.add(hip);
      this.legs.push(hip);
    }
  }

  /** Gocce sul vetro, visibili solo quando bagnato (Birra Analcolica). */
  #buildWetDrops(): void {
    const mat = this.#mat(new THREE.MeshStandardMaterial({ color: 0xbfd6e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85 }));
    const geo = this.#geo(new THREE.SphereGeometry(0.022, 8, 6));
    const { height } = this.profile;
    for (let i = 0; i < 9; i++) {
      const ny = 0.25 + ((i * 0.37) % 0.7);
      const a = -1.1 + ((i * 0.83) % 2.2);
      const r = this.#radius(ny) + 0.012;
      const drop = new THREE.Mesh(geo, mat);
      drop.position.set(Math.sin(a) * r, ny * height, Math.cos(a) * r);
      drop.scale.set(1, 1.5, 0.6);
      this.wetDrops.add(drop);
    }
    this.wetDrops.visible = false;
    this.body.add(this.wetDrops);
  }

  // ------------------------------------------------------------------ stati

  #setDimmed(dimmed: boolean): void {
    if (this.#dimmed === dimmed) return;
    this.#dimmed = dimmed;
    for (const m of this.materials) {
      m.userData.baseOpacity ??= m.opacity;
      m.userData.baseTransparent ??= m.transparent;
      m.transparent = dimmed ? true : m.userData.baseTransparent;
      m.opacity = dimmed ? m.userData.baseOpacity * 0.4 : m.userData.baseOpacity;
      m.needsUpdate = true;
    }
  }

  #setWet(amount: number): void {
    const k = Math.max(0, Math.min(1, amount));
    if (Math.abs(k - this.#wet) < 0.004) return;
    this.#wet = k;
    const grey = new THREE.Color(0x7d848f);
    for (const { mat, base, baseRough } of this.#tintable) {
      mat.color.copy(base).lerp(grey, k * 0.75);
      mat.roughness = baseRough + (0.15 - baseRough) * k * 0.8; // bagnato = lucido
      if (mat.emissive && mat.emissiveIntensity) mat.emissiveIntensity = 0.1 * (1 - k);
    }
    this.wetDrops.visible = k > 0.05;
  }
}
