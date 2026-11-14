import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Emitter } from '../Emitter.js';
import { angleAt, angularVelocityAt, pointerLocalAngle } from '../wheel/kinematics.js';
import { WHEEL_FONT } from '../wheel/wheelTexture.js';
import { WHEEL_RADIUS, WheelModel } from '../wheel/WheelModel.js';
import { segmentInfo } from '../wheel/segments.js';
import { AvatarLineup, LAUNCH_PAD, arcPoint } from '../avatars/AvatarLineup.js';
import { SET, buildPubSet } from './PubSet.js';
import { JuiceDirector } from '../../three/JuiceDirector.ts';

/**
 * Il "palco" 3D: pub + ruota + birre-avatar sul bancone.
 * Usato dallo schermo Salotto e, in Pocket, da ogni telefono. È solo una vista: non decide nulla,
 * riceve segmenti, giocatori e piani di spin dall'host.
 *
 * Loop (requestAnimationFrame via renderer.setAnimationLoop):
 *   angolo = angleAt(piano, tempo trascorso)  ← fisica ad attrito in forma chiusa (kinematics.js)
 *   → puntatore che sbatte sui pioli, luci, avatar → render (con bloom se 'high')
 *
 * Qualità:
 *  - 'high': bloom + MSAA, DPR fino a 2 — TV/PC/tablet
 *  - 'low' : niente post-processing né ombre, DPR fino a 2 — telefoni
 * Un monitor FPS degrada da solo (prima il bloom, poi la risoluzione) se si scende sotto ~50 fps.
 *
 * Regia e "juice" (src/three/JuiceDirector.ts): telecamera dinamica (campo largo → carrellata →
 * zoom di suspense sul puntatore quando la ruota rallenta), puntatore a molla con clack audio a ogni
 * piolo, pedana di lancio con occhio di bue, emote con salto e fumetto.
 *
 * Eventi: 'tick' (il puntatore passa un piolo), 'stop' (fine spin, indice spicchio)
 */
export class StageRenderer extends Emitter {
  spin = null;
  #inset = { current: 0, target: 0 };
  #probe = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  perf = { frames: 0, acc: 0, slowWindows: 0, fps: 60 };

  constructor(container, { quality = 'high' } = {}) {
    super();
    this.container = container;
    this.quality = quality;
    this.maxDpr = 2; // i telefoni hanno DPR 3: 2 basta per testi nitidi, il monitor FPS scende se serve

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping "cinematografico": alte luci morbide, neri profondi
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Ombre morbide: in three r187 PCFSoftShadowMap è stato rimosso (ripiega su PCF con un avviso);
    // PCFShadowMap + shadow.radius (campionamento a disco di Vogel) dà la penombra larga.
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.classList.add('wheel-canvas');
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    this.pub = buildPubSet(this.renderer, this.scene, { shadows: quality === 'high' });

    this.wheel = new WheelModel({
      textureSize: quality === 'high' ? 2048 : 1024,
      anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    });
    this.scene.add(this.wheel.root);

    this.wheel.externalPointer = true; // il puntatore lo muove la fisica del JuiceDirector

    this.softTexture = makeSoftTexture();
    this.juice = new JuiceDirector({
      scene: this.scene,
      camera: this.camera,
      overlay: container,
      padPosition: new THREE.Vector3(LAUNCH_PAD.x, SET.counterTopY, LAUNCH_PAD.z),
      softTexture: this.softTexture,
      shadows: quality === 'high',
    });
    this.avatars = new AvatarLineup({ surfaceY: SET.counterTopY, juice: this.juice });
    this.scene.add(this.avatars.root);
    this.playerCount = 0;

    if (quality === 'high') {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82));
      this.composer.addPass(new OutputPass());
    }

    // Web font (Oswald) per texture ed etichette: appena è pronto, ridisegniamo
    document.fonts?.load(`700 64px ${WHEEL_FONT}`).then(() => {
      this.wheel.redraw();
      this.avatars.refreshLabels();
    });

    if (new URLSearchParams(location.search).has('debug')) {
      window.__stage = this; // ispezione da console/test
      this.debugEl = document.createElement('div');
      this.debugEl.className = 'wheel-debug';
      container.append(this.debugEl);
    }

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(container);
    this.#resize();

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.renderer.setAnimationLoop((timestamp) => this.#frame(timestamp));
  }

  // ---------------------------------------------------------------- ruota

  setSegments(segments) {
    this.wheel.setSegments(segments);
  }

  setAngle(angle) {
    this.wheel.setAngle(angle);
  }

  /**
   * Avvia l'animazione di uno spin. `elapsedMs` > 0 se ci si sincronizza a uno spin già iniziato
   * (es. un telefono che si ricollega a metà). Risolve con l'indice dello spicchio vincente.
   */
  playSpin(plan, elapsedMs = 0) {
    this.spin?.resolve?.(null);
    this.wheel.setHighlight(-1);
    this.setLights('spin');
    return new Promise((resolve) => {
      this.spin = { plan, start: performance.now() - elapsedMs, resolve };
    });
  }

  /** Luci della cornice: 'idle' | 'spin' | 'win' (con colore). */
  setLights(mode, color) {
    this.wheel.setLights(mode, color, this.timer.getElapsed());
  }

  setHighlight(index) {
    this.wheel.setHighlight(index);
  }

  /** Top Slot: evidenzia lo spicchio estratto (-1 per togliere). */
  setTopSlot(index) {
    this.wheel.setTopSlot(index);
  }

  /** Happy Hour: luci della scena e neon della ruota in viola/oro. */
  setHappyHour(on) {
    if (this.happyHour === on) return;
    this.happyHour = on;
    this.pub.setMood(on ? 'happy' : 'normal');
    this.wheel.setHappyHour(on);
  }

  // ---------------------------------------------------------------- avatar

  setPlayers(players, turnPlayerId, phase) {
    this.avatars.sync(players, turnPlayerId, phase, this.timer.getElapsed());
    if ((players.length > 6) !== (this.playerCount > 6)) {
      this.playerCount = players.length;
      this.#resize();
    }
    this.playerCount = players.length;
  }

  /** Emote di un giocatore (salto + fumetto + schiuma + suono). */
  emote(playerId, emoteId, playSound = true) {
    this.avatars.emote(playerId, emoteId, this.timer.getElapsed(), playSound);
  }

  celebrate(playerId) {
    this.avatars.celebrate(playerId, this.timer.getElapsed());
  }

  // ---------------------------------------------------------------- ciclo di vita

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.spin?.resolve?.(null);
    this.wheel.dispose();
    this.avatars.dispose();
    this.juice.dispose();
    this.softTexture.dispose();
    this.pub.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.debugEl?.remove();
    this.removeAllListeners();
  }

  #resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(width, height);

    this.width = width;
    this.height = height;
    this.#frameShots();
  }

  /**
   * Inquadrature per il formato corrente: su schermi stretti (telefono) l'anfiteatro si raccoglie
   * e la camera cerca la distanza minima che contiene ruota, puntatore, birre e pedana.
   */
  #frameShots() {
    const inset = this.#inset.current;
    // Con la carta evento a destra (TV) inquadriamo come se lo schermo fosse largo w·(1+inset) e ne
    // mostriamo la parte destra: lo spazio libero [0, (1-inset)·w] finisce al centro dell'inquadratura
    // "virtuale", quindi la scena va fatta stare in una mezza larghezza NDC di (1-inset)/(1+inset).
    const fullWidth = this.width * (1 + inset);
    const freeHalf = (1 - inset) / (1 + inset);
    const aspect = fullWidth / this.height;
    const freeAspect = (this.width * (1 - inset)) / this.height;
    const stretch = THREE.MathUtils.clamp(0.62 + (freeAspect - 0.6) * 1.0, 0.62, 1.45);
    this.avatars.setArcScale(stretch);
    const R = WHEEL_RADIUS;
    const floor = SET.counterTopY;
    const lampTop = new THREE.Vector3(0, R * 1.1 + 0.32, 0.5);

    // inviluppo dei posti (non dipende da chi c'è ora: niente salti di camera a ogni ingresso)
    const radii = this.playerCount > 6 ? [3.2, 4.1] : [3.2];
    const seat = [];
    for (const r of radii) {
      for (const deg of [-70, -44, -18, 18, 44, 70]) {
        const { x, z } = arcPoint(THREE.MathUtils.degToRad(deg), r, stretch);
        seat.push(new THREE.Vector3(x + Math.sign(x) * 0.45, floor - 0.05, z), new THREE.Vector3(x, floor + 2.0, z));
      }
    }
    const padX = LAUNCH_PAD.x * Math.min(1, stretch);
    const pad = [new THREE.Vector3(padX + 0.7, floor - 0.05, LAUNCH_PAD.z + 0.6), new THREE.Vector3(padX - 0.7, floor - 0.05, LAUNCH_PAD.z + 0.6), new THREE.Vector3(padX, floor + 2.1, LAUNCH_PAD.z)];
    const basePoints = [new THREE.Vector3(R * 1.06, 0, 0), new THREE.Vector3(-R * 1.06, 0, 0), lampTop, ...seat, ...pad];
    const probe = this.#probe;
    probe.aspect = aspect;
    const base = fitCamera(probe, { eyeY: 2.6, targetY: -1.1, points: basePoints, margin: [0.96 * freeHalf, 0.95, 0.97] });

    // suspense: metà alta della ruota e il puntatore
    const suspensePoints = [new THREE.Vector3(R * 1.04, R * 0.15, 0), new THREE.Vector3(-R * 1.04, R * 0.15, 0), lampTop];
    const suspense = fitCamera(probe, { eyeY: R * 0.78, targetY: R * 0.6, points: suspensePoints, margin: [0.97 * freeHalf, 0.9, 0.92] });
    this.juice.cameraDirector.setFraming(base, suspense);

    if (inset > 0.001) this.camera.setViewOffset(fullWidth, this.height, fullWidth - this.width, 0, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Spazio occupato a destra da un pannello HTML sopra la scena (frazione della larghezza, 0..0.5):
   * la scena si sposta a sinistra con una transizione morbida.
   */
  setRightInset(fraction) {
    this.#inset.target = THREE.MathUtils.clamp(fraction, 0, 0.5);
  }

  #stepInset(dt) {
    const inset = this.#inset;
    if (Math.abs(inset.target - inset.current) < 0.0005) return;
    inset.current += (inset.target - inset.current) * (1 - Math.exp(-dt * 3));
    if (Math.abs(inset.target - inset.current) < 0.0005) inset.current = inset.target;
    this.#frameShots();
  }

  #frame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();

    this.#stepInset(dt);
    const speed = this.#updateSpin();
    this.juice.cameraDirector.setSpin(speed, t);
    this.wheel.pointerPivot.rotation.z = this.juice.flapper.update(dt);
    this.wheel.update(t, dt);
    this.juice.update(t, dt, this.camera, this.width, this.height);
    this.avatars.setCameraPosition(this.camera.position);
    this.avatars.update(t, dt);
    this.pub.update(t, dt);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.#monitorPerformance(dt);
  }

  /**
   * Campiona la fisica dello spin al tempo corrente: niente integrazione, niente drift.
   * Restituisce la velocità angolare con segno (rad/s) o null se la ruota è ferma.
   */
  #updateSpin() {
    if (!this.spin) return null;
    const { plan, start } = this.spin;
    const elapsed = performance.now() - start;
    const angle = angleAt(plan, elapsed);
    const direction = plan.kind === 'ease' ? Math.sign(plan.to - plan.from) || -1 : plan.direction;
    const speed = direction * angularVelocityAt(plan, elapsed);
    this.wheel.setAngle(angle);
    // pioli = confini degli spicchi: li contiamo tutti, anche se in un frame ne passano diversi
    const crossings = this.juice.flapper.countCrossings(pointerLocalAngle(angle), this.wheel.layout.map((l) => l.start));
    if (crossings > 0) {
      this.juice.flapper.hit(speed);
      this.wheel.kickPointer(Math.abs(speed));
      this.avatars.tick(this.timer.getElapsed());
      this.emit('tick', this.wheel.lastIndex);
    }

    if (elapsed >= plan.duration) {
      const { resolve } = this.spin;
      this.spin = null;
      this.juice.flapper.resetTracking();
      const index = this.wheel.lastIndex;
      if (index >= 0) {
        this.wheel.setHighlight(index);
        this.setLights('win', segmentInfo(this.wheel.segments[index]).glow);
      }
      resolve(index);
      this.emit('stop', index);
      return null;
    }
    return speed;
  }

  #monitorPerformance(dt) {
    const perf = this.perf;
    perf.frames++;
    perf.acc += dt;
    if (perf.acc < 2) return;
    perf.fps = perf.frames / perf.acc;
    perf.frames = 0;
    perf.acc = 0;
    if (this.debugEl) {
      const shadows = this.pub.key.castShadow ? 'ombre' : 'no-ombre';
      this.debugEl.textContent = `${perf.fps.toFixed(0)} fps · ${shadows} · ${this.composer ? 'bloom' : 'no-bloom'} · dpr ${this.renderer.getPixelRatio()}`;
    }
    if (document.visibilityState !== 'visible') return;
    perf.slowWindows = perf.fps < 50 ? perf.slowWindows + 1 : 0;
    if (perf.slowWindows < 2) return;
    perf.slowWindows = 0;
    if (this.pub.key.castShadow) {
      console.info('[stage] fps bassi: disattivo le ombre');
      this.pub.key.castShadow = false;
    } else if (this.composer) {
      console.info('[stage] fps bassi: disattivo il bloom');
      this.composer.dispose();
      this.composer = null;
    } else if (this.maxDpr > 1) {
      console.info('[stage] fps bassi: riduco la risoluzione');
      this.maxDpr = 1;
      this.#resize();
    }
  }
}

/**
 * Distanza minima della camera (sull'asse z, alla quota `eyeY`, che guarda (0, targetY, 0))
 * perché tutti i `points` cadano dentro l'inquadratura con i margini [x, yTop, yBottom] in NDC.
 */
function fitCamera(camera, { eyeY, targetY, points, margin }) {
  const probe = camera.clone();
  probe.clearViewOffset();
  probe.updateProjectionMatrix();
  const target = new THREE.Vector3(0, targetY, 0);
  const v = new THREE.Vector3();
  const fits = (d) => {
    probe.position.set(0, eyeY, d);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    for (const p of points) {
      v.copy(p).project(probe);
      if (v.z > 1 || Math.abs(v.x) > margin[0] || v.y > margin[1] || v.y < -margin[2]) return false;
    }
    return true;
  };
  let lo = 4;
  let hi = 120;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { position: new THREE.Vector3(0, eyeY, hi), target };
}

function makeSoftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
