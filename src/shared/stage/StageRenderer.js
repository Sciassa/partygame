import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Emitter } from '../Emitter.js';
import { angleAt, angularVelocityAt } from '../wheel/kinematics.js';
import { WHEEL_FONT } from '../wheel/wheelTexture.js';
import { WHEEL_RADIUS, WheelModel } from '../wheel/WheelModel.js';
import { segmentInfo } from '../wheel/segments.js';
import { AvatarLineup } from '../avatars/AvatarLineup.js';
import { SET, buildPubSet } from './PubSet.js';

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
 *  - 'low' : niente post-processing, DPR fino a 1.5 — telefoni
 * Un monitor FPS degrada da solo (prima il bloom, poi la risoluzione) se si scende sotto ~50 fps.
 *
 * Eventi: 'tick' (il puntatore passa un piolo), 'stop' (fine spin, indice spicchio)
 */
export class StageRenderer extends Emitter {
  spin = null;
  perf = { frames: 0, acc: 0, slowWindows: 0, fps: 60 };

  constructor(container, { quality = 'high' } = {}) {
    super();
    this.container = container;
    this.quality = quality;
    this.maxDpr = quality === 'high' ? 2 : 1.5;

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

    this.avatars = new AvatarLineup({ surfaceY: SET.counterTopY, frontZ: SET.avatarFrontZ });
    this.scene.add(this.avatars.root);

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

  // ---------------------------------------------------------------- avatar

  setPlayers(players, turnPlayerId, phase) {
    this.avatars.sync(players, turnPlayerId, phase, this.timer.getElapsed());
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

    // Inquadratura: dal puntatore in cima alla ruota fino al bordo del bancone, in ogni aspect ratio.
    const aspect = width / height;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // dal lampione del puntatore (y≈3.6) al bancone col piedistallo (y≈-4.4)
    // (le birre sedute sul bancone stanno più vicine alla camera: serve margine in basso)
    const halfH = WHEEL_RADIUS + 2.0;
    const halfW = WHEEL_RADIUS + 0.85;
    const distance = Math.max(halfH / tan, halfW / (tan * aspect));
    this.camera.aspect = aspect;
    this.camera.position.set(0, 0.5, distance);
    this.camera.lookAt(0, -0.85, 0);
    this.camera.updateProjectionMatrix();

    // Quante birre stanno in una fila: larghezza visibile alla profondità della prima fila
    const halfWidthAtAvatars = (distance - SET.avatarFrontZ) * tan * aspect;
    this.avatars.setVisibleHalfWidth(halfWidthAtAvatars - 0.3);
  }

  #frame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();

    this.#updateSpin();
    this.wheel.update(t, dt);
    this.avatars.update(t, dt);
    this.pub.update(t);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.#monitorPerformance(dt);
  }

  /** Campiona la fisica dello spin al tempo corrente: niente integrazione, niente drift. */
  #updateSpin() {
    if (!this.spin) return;
    const { plan, start } = this.spin;
    const elapsed = performance.now() - start;
    const crossedPeg = this.wheel.setAngle(angleAt(plan, elapsed));
    if (crossedPeg) {
      this.wheel.kickPointer(angularVelocityAt(plan, elapsed));
      this.avatars.tick(this.timer.getElapsed());
      this.emit('tick', this.wheel.lastIndex);
    }

    if (elapsed >= plan.duration) {
      const { resolve } = this.spin;
      this.spin = null;
      const index = this.wheel.lastIndex;
      if (index >= 0) {
        this.wheel.setHighlight(index);
        this.setLights('win', segmentInfo(this.wheel.segments[index]).glow);
      }
      resolve(index);
      this.emit('stop', index);
    }
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
