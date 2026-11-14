import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawBrickWall, drawGlow } from '../wheel/wheelTexture.js';
import { vinylMaterial } from './vinyl.js';

/** Colori dell'ambientazione (allineati ai token CSS in styles/base.css). */
export const PUB_COLORS = {
  night: 0x0a0e17, // blu notte: sfondo e nebbia
  amber: 0xffc27a,
  neonPink: 0xff3d7f,
  neonTeal: 0x2fd6c3,
};

/** Geometria del set: la ruota è centrata in (0,0,0) con raggio 3, il bancone le sta davanti. */
export const SET = Object.freeze({
  counterTopY: -3.05,
  counterBackZ: 0.35,
  counterFrontZ: 3.45,
  avatarFrontZ: 2.55,
  wallZ: -2.6,
});

/**
 * Il "set" del pub: muro di mattoni, bancone in legno con barra ottone e striscia LED ambra.
 *
 * Illuminazione "cinematic pub" (tre punti da set fotografico + accenti):
 *  - KEY:  faretto ambra dall'alto a sinistra, l'unica luce che proietta ombre (morbide, PCF + radius)
 *  - RIM:  due controluce arancio/ambra da dietro ai lati, che "tagliano" i bordi dei modelli
 *          (in più il termine di Fresnel nel materiale vinile, vedi vinyl.js)
 *  - FILL: freddo e debolissimo, solo per non perdere i neri
 *  - neon rosa e teal fuori campo, environment map da studio per riflessi morbidi
 *
 * @param {{ shadows?: boolean }} opts ombre reali solo in qualità alta (TV/PC)
 */
export function buildPubSet(renderer, scene, { shadows = false } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  scene.background = new THREE.Color(PUB_COLORS.night);
  scene.fog = new THREE.Fog(PUB_COLORS.night, 15, 32);

  // --- Environment map da "studio fotografico": riflessi morbidi sui materiali ruvidi
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = track(pmrem.fromScene(envScene, 0.04).texture);
  scene.environmentIntensity = 0.16;
  envScene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose?.();
  });
  pmrem.dispose();

  // --- Luci
  const hemi = new THREE.HemisphereLight(0x2a3550, 0x140b06, 0.38);

  // KEY: faretto ambra dall'alto a sinistra, come una lampada sopra il bancone
  const key = new THREE.SpotLight(0xffc98a, 3.4, 0, 0.46, 0.9, 0);
  key.position.set(-5.5, 10, 10);
  key.target.position.set(0, -0.8, 0.6);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 6;
    key.shadow.camera.far = 30;
    key.shadow.radius = 9; // penombra larga: ombre morbidissime
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
  }

  // RIM: controluce caldi da dietro, a sinistra (ambra) e a destra (arancio)
  // radenti (y bassa): tagliano le sagome senza "accendere" il piano del bancone
  const rimLeft = new THREE.DirectionalLight(0xffa64d, 2.4);
  rimLeft.position.set(-8, 1.6, -7);
  const rimRight = new THREE.DirectionalLight(0xff7a2e, 1.7);
  rimRight.position.set(8, 1.2, -6);

  // FILL: freddo e debole da destra
  const fill = new THREE.DirectionalLight(0x8aa2ff, 0.28);
  fill.position.set(9, 1, 6);

  // Accenti neon (insegne fuori campo)
  const pink = new THREE.PointLight(PUB_COLORS.neonPink, 22, 13, 2);
  pink.position.set(-5, -1.2, 1.8);
  const teal = new THREE.PointLight(PUB_COLORS.neonTeal, 16, 13, 2);
  teal.position.set(5.2, 2.6, 1.2);

  group.add(hemi, key, key.target, fill, rimLeft, rimRight, pink, teal);

  // --- Muro di mattoni
  const wallCanvas = document.createElement('canvas');
  drawBrickWall(wallCanvas, 512);
  const wallTexture = track(new THREE.CanvasTexture(wallCanvas));
  wallTexture.colorSpace = THREE.SRGBColorSpace;
  wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
  wallTexture.repeat.set(8, 4);
  const wall = new THREE.Mesh(
    track(new THREE.PlaneGeometry(64, 32)),
    track(new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.95, metalness: 0 })),
  );
  wall.position.set(0, 2, SET.wallZ);
  wall.receiveShadow = true; // l'ombra morbida della ruota sul muro dà profondità
  group.add(wall);

  // Alone ambra dietro la ruota (sprite additivo: costo quasi zero)
  const glowCanvas = document.createElement('canvas');
  drawGlow(glowCanvas, 256, 'rgba(255, 170, 90, 0.42)');
  const glowTexture = track(new THREE.CanvasTexture(glowCanvas));
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(
    track(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
  );
  glow.scale.set(13, 13, 1);
  glow.position.set(0, 0.2, SET.wallZ + 0.1);
  group.add(glow);

  // --- Bancone
  const depth = SET.counterFrontZ - SET.counterBackZ;
  const wood = track(vinylMaterial({ color: 0x1c100a, roughness: 0.55, rimStrength: 0.25 }));
  const darkWood = track(vinylMaterial({ color: 0x150c07, roughness: 0.85, rimStrength: 0.2 }));
  const top = new THREE.Mesh(track(new THREE.BoxGeometry(60, 0.2, depth)), wood);
  top.position.set(0, SET.counterTopY - 0.1, SET.counterBackZ + depth / 2);
  top.receiveShadow = true;
  const front = new THREE.Mesh(track(new THREE.BoxGeometry(60, 4, 0.2)), darkWood);
  front.position.set(0, SET.counterTopY - 2.2, SET.counterFrontZ - 0.15);
  // Barra in ottone (opaco) lungo il bordo
  const rail = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.07, 0.07, 60, 12)),
    track(vinylMaterial({ color: 0xd4a24c, roughness: 0.5, rimStrength: 1.0 })),
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, SET.counterTopY - 0.32, SET.counterFrontZ + 0.08);
  // Striscia LED ambra sotto il bordo: emissiva HDR → bloom
  const led = new THREE.Mesh(
    track(new THREE.BoxGeometry(60, 0.03, 0.03)),
    track(new THREE.MeshBasicMaterial({ color: new THREE.Color(PUB_COLORS.amber).multiplyScalar(2) })),
  );
  led.position.set(0, SET.counterTopY - 0.2, SET.counterFrontZ - 0.02);
  group.add(top, front, rail, led);

  scene.add(group);
  return {
    group,
    glow,
    key,
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
