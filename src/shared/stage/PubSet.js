import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawGlow, drawHaze, drawPubBokeh } from '../wheel/wheelTexture.js';
import { STAND_FLOOR_Y } from '../wheel/WheelModel.js';
import { vinylMaterial } from './vinyl.js';

/** Colori dell'ambientazione (allineati ai token CSS in styles/base.css). */
export const PUB_COLORS = {
  night: 0x08090d, // quasi nero caldo: sfondo e nebbia
  amber: 0xffa24a,
  teal: 0x3fb8c8,
};

/**
 * Geometria del set. La ruota è centrata in (0,0,0) con raggio 3 e poggia sul suo piedistallo;
 * il bancone è il piano su cui stanno piedistallo e birre.
 */
export const SET = Object.freeze({
  counterTopY: STAND_FLOOR_Y,
  counterBackZ: -2.4,
  counterFrontZ: 5.8,
  backdropZ: -14,
});

/**
 * Il "set" del pub come nelle reference: fondale sfocato con lampade in bokeh, foschia,
 * bancone scuro che riflette la luce calda.
 *
 * Illuminazione cinematografica:
 *  - KEY:  faretto ambra morbido dall'alto, l'unico con ombre (PCF + radius = penombra larga)
 *  - RIM:  due controluce arancio/ambra radenti da dietro, che "tagliano" i bordi
 *          (più il termine di Fresnel nel materiale vinile, vedi vinyl.js)
 *  - FILL: freddo e debolissimo, per non perdere i neri
 *  - due "lampade pratiche" calde ai lati
 *
 * @param {{ shadows?: boolean }} opts ombre reali solo in qualità alta (TV/PC)
 */
export function buildPubSet(renderer, scene, { shadows = false } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  scene.background = new THREE.Color(PUB_COLORS.night);
  scene.fog = new THREE.Fog(PUB_COLORS.night, 18, 40);

  // --- Environment map da studio: riflessi morbidi sui materiali opachi
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = track(pmrem.fromScene(envScene, 0.04).texture);
  scene.environmentIntensity = 0.2;
  envScene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose?.();
  });
  pmrem.dispose();

  // --- Luci
  const hemi = new THREE.HemisphereLight(0x3a4766, 0x0b0705, 0.5);

  const key = new THREE.SpotLight(0xffdcb4, 2.5, 0, 0.5, 0.95, 0);
  key.position.set(-3, 11, 9);
  key.target.position.set(0, -1.2, 0.8);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 6;
    key.shadow.camera.far = 32;
    key.shadow.radius = 10; // penombra larga: ombre morbidissime
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
  }

  // controluce radenti: tagliano le sagome senza accendere il piano del bancone
  const rimRight = new THREE.DirectionalLight(0xff8a2e, 2.2);
  rimRight.position.set(9, 1.8, -6);
  const rimLeft = new THREE.DirectionalLight(0xffb062, 1.0);
  rimLeft.position.set(-9, 1.4, -7);

  const fill = new THREE.DirectionalLight(0x7f93c8, 0.22);
  fill.position.set(6, 2, 9);

  // lampade "pratiche" del locale (fuori campo ai lati), calde
  const lampLeft = new THREE.PointLight(PUB_COLORS.amber, 9, 12, 2);
  lampLeft.position.set(-7, -1.5, 1.5);
  const lampRight = new THREE.PointLight(PUB_COLORS.amber, 7, 12, 2);
  lampRight.position.set(7, 2.5, 0.5);

  group.add(hemi, key, key.target, rimRight, rimLeft, fill, lampLeft, lampRight);

  // --- Fondale fuori fuoco (non illuminato: è "lontano")
  const bokehCanvas = document.createElement('canvas');
  drawPubBokeh(bokehCanvas, 1536, 768);
  const bokehTexture = track(new THREE.CanvasTexture(bokehCanvas));
  bokehTexture.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(
    track(new THREE.PlaneGeometry(76, 38)),
    track(new THREE.MeshBasicMaterial({ map: bokehTexture, fog: false })),
  );
  backdrop.position.set(0, 2, SET.backdropZ);
  group.add(backdrop);

  // alone caldo dietro la ruota
  const glowCanvas = document.createElement('canvas');
  drawGlow(glowCanvas, 256, 'rgba(255, 150, 70, 0.16)');
  const glowTexture = track(new THREE.CanvasTexture(glowCanvas));
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(
    track(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
  );
  glow.scale.set(15, 15, 1);
  glow.position.set(0, 0.2, -4);
  group.add(glow);

  // --- Foschia del locale: poche nuvole additive che scorrono lentissime
  const hazeCanvas = document.createElement('canvas');
  drawHaze(hazeCanvas, 256);
  const hazeTexture = track(new THREE.CanvasTexture(hazeCanvas));
  const hazes = [];
  for (const [x, y, z, sc, op] of [
    [-6, 2.5, -6, 16, 0.16],
    [5, 4, -7, 18, 0.13],
    [1, -1, -3.5, 12, 0.06],
  ]) {
    const sprite = new THREE.Sprite(
      track(new THREE.SpriteMaterial({ map: hazeTexture, color: 0xffdcb8, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
    );
    sprite.scale.set(sc, sc * 0.6, 1);
    sprite.position.set(x, y, z);
    sprite.userData.base = { x, op };
    hazes.push(sprite);
    group.add(sprite);
  }

  // --- Bancone: legno scuro con un filo di riflesso caldo e bordo oro
  const depth = SET.counterFrontZ - SET.counterBackZ;
  const top = new THREE.Mesh(
    track(new THREE.BoxGeometry(80, 0.24, depth)),
    track(vinylMaterial({ color: 0x141821, roughness: 0.5, rimStrength: 0.12 })),
  );
  top.position.set(0, SET.counterTopY - 0.12, SET.counterBackZ + depth / 2);
  top.receiveShadow = true;
  const edge = new THREE.Mesh(
    track(new THREE.BoxGeometry(80, 0.05, 0.05)),
    track(vinylMaterial({ color: 0xd9a94f, roughness: 0.5, rimStrength: 0.8 })),
  );
  edge.position.set(0, SET.counterTopY - 0.02, SET.counterFrontZ);
  const front = new THREE.Mesh(track(new THREE.BoxGeometry(80, 4, 0.2)), track(vinylMaterial({ color: 0x0f0d0b, roughness: 0.85, rimStrength: 0.1 })));
  front.position.set(0, SET.counterTopY - 2.2, SET.counterFrontZ - 0.1);
  group.add(top, edge, front);

  scene.add(group);

  // --- Atmosfere: 'normal' (pub caldo) e 'happy' (Happy Hour: neon viola e oro intenso).
  // Ogni luce sfuma verso il colore/intensità dell'atmosfera corrente (niente stacchi bruschi).
  const moodLights = [
    { light: hemi, normal: [0x3a4766, 0.5], happy: [0x5a2a8a, 0.75], ground: true },
    { light: key, normal: [0xffdcb4, 2.5], happy: [0xffcf6a, 3.2] },
    { light: rimRight, normal: [0xff8a2e, 2.2], happy: [0xb44dff, 3.6] },
    { light: rimLeft, normal: [0xffb062, 1.0], happy: [0xffc23a, 2.4] },
    { light: lampLeft, normal: [PUB_COLORS.amber, 9], happy: [0xb44dff, 22] },
    { light: lampRight, normal: [PUB_COLORS.amber, 7], happy: [0xffc23a, 16] },
  ].map((m) => ({ ...m, normalColor: new THREE.Color(m.normal[0]), happyColor: new THREE.Color(m.happy[0]) }));
  const glowNormal = new THREE.Color(0xffffff);
  const glowHappy = new THREE.Color(0xc77dff);
  const hazeNormal = new THREE.Color(0xffdcb8);
  const hazeHappy = new THREE.Color(0xc89bff);
  let mood = 'normal';
  let moodMix = 0; // 0 = normale, 1 = happy hour
  const tmp = new THREE.Color();

  return {
    group,
    glow,
    key,
    setMood(next) {
      mood = next;
    },
    update(t, dt = 0.016) {
      moodMix += ((mood === 'happy' ? 1 : 0) - moodMix) * (1 - Math.exp(-dt * 1.5));
      for (const m of moodLights) {
        m.light.color.copy(tmp.copy(m.normalColor).lerp(m.happyColor, moodMix));
        m.light.intensity = m.normal[1] + (m.happy[1] - m.normal[1]) * moodMix;
      }
      glow.material.color.copy(tmp.copy(glowNormal).lerp(glowHappy, moodMix));
      hazes.forEach((h) => h.material.color.copy(tmp.copy(hazeNormal).lerp(hazeHappy, moodMix)));
      glow.material.opacity = (0.85 + 0.15 * Math.sin(t * (0.9 + moodMix * 2))) * (1 + moodMix * 0.6);
      hazes.forEach((h, i) => {
        h.position.x = h.userData.base.x + Math.sin(t * 0.05 + i * 2) * 1.8;
        h.material.opacity = h.userData.base.op * (0.8 + 0.2 * Math.sin(t * 0.3 + i));
      });
    },
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
