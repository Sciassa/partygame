import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Emitter } from '../Emitter.js';
import { TAU, angleAt, angularVelocityAt, segmentIndexAt } from './kinematics.js';
import { drawGlow, drawWheelFace } from './wheelTexture.js';
import { segmentInfo } from './segments.js';

const R = 3; // raggio della faccia della ruota (unità three.js)
const BULB_COUNT = 40;

/**
 * Render 3D della Ruota (Three.js), usato sia dallo schermo Salotto sia dai telefoni in Pocket.
 * È solo una "vista": non decide nulla. Riceve segmenti e piani di spin dall'host.
 *
 * Qualità:
 *  - 'high': bloom (UnrealBloom) + MSAA, DPR fino a 2 — per TV/PC/tablet
 *  - 'low' : niente post-processing, DPR fino a 1.5 — per telefoni
 * Un monitor FPS degrada automaticamente la qualità se si scende sotto ~50 fps.
 *
 * Eventi: 'tick' (il puntatore passa un piolo), 'stop' (fine spin, indice spicchio)
 */
export class WheelRenderer extends Emitter {
  constructor(container, { quality = 'high' } = {}) {
    super();
    this.container = container;
    this.quality = quality;
    this.segments = [];
    this.angle = 0;
    this.spin = null;
    this.lightMode = { mode: 'idle', color: new THREE.Color('#ffffff'), since: 0 };
    this.pointer = { angle: 0, velocity: 0 };
    this.lastIndex = -1;
    this.highlightIndex = -1;
    this.perf = { frames: 0, acc: 0, slowWindows: 0, fps: 60 };
    this.disposables = [];

    this.#initRenderer();
    this.#initScene();
    this.#initPostprocessing();

    // ?debug nell'URL: contatore FPS in sovrimpressione
    if (new URLSearchParams(location.search).has('debug')) {
      this.debugEl = document.createElement('div');
      this.debugEl.className = 'wheel-debug';
      container.append(this.debugEl);
    }

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(container);
    this.#resize();

    this.timer = new THREE.Timer();
    this.timer.connect(document); // pausa corretta quando la scheda è in background
    this.renderer.setAnimationLoop((timestamp) => this.#frame(timestamp));
  }

  // ---------------------------------------------------------------- API pubblica

  setSegments(segments) {
    this.segments = segments;
    const size = this.quality === 'high' ? 2048 : 1024;
    drawWheelFace(this.faceCanvas, segments, size);
    this.faceTexture.needsUpdate = true;
    this.#buildPegs(segments.length);
    this.lastIndex = segmentIndexAt(this.angle, segments.length);
  }

  setAngle(angle) {
    this.angle = angle;
    this.wheel.rotation.z = angle;
  }

  /**
   * Avvia l'animazione di uno spin. `elapsedMs` > 0 se ci si sincronizza a uno spin già iniziato
   * (es. un telefono che si ricollega a metà). Risolve con l'indice dello spicchio vincente.
   */
  playSpin(plan, elapsedMs = 0) {
    this.spin?.resolve?.(null);
    this.setHighlight(-1);
    this.setLights('spin');
    return new Promise((resolve) => {
      this.spin = { plan, start: performance.now() - elapsedMs, resolve };
    });
  }

  /** Effetto luci della cornice: 'idle' | 'spin' | 'win' (con colore). */
  setLights(mode, color = '#ffffff') {
    this.lightMode = { mode, color: new THREE.Color(color), since: this.timer.getElapsed() };
  }

  /** Evidenzia (pulsando) lo spicchio vincente. -1 per spegnere. */
  setHighlight(index) {
    this.highlightIndex = index;
    if (index < 0 || !this.segments.length) {
      this.highlight.visible = false;
      return;
    }
    const s = TAU / this.segments.length;
    this.highlight.geometry.dispose();
    // CircleGeometry misura thetaStart da +X: lo spicchio i parte da +Y + i*s
    this.highlight.geometry = new THREE.CircleGeometry(R * 0.985, 32, Math.PI / 2 + index * s, s);
    this.highlight.visible = true;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.spin?.resolve?.(null);
    this.scene.traverse((obj) => {
      obj.geometry?.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => m?.dispose());
    });
    this.disposables.forEach((d) => d.dispose());
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.debugEl?.remove();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------- setup

  #initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x0b0420, 1);
    renderer.domElement.classList.add('wheel-canvas');
    renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.container.append(renderer.domElement);
    this.renderer = renderer;
    this.maxDpr = this.quality === 'high' ? 2 : 1.5;
  }

  #initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0420);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

    // Luci: ambient + key frontale + due colorate pop ai lati
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 4, 8);
    scene.add(key);
    const magenta = new THREE.PointLight(0xff2bd6, 40, 18);
    magenta.position.set(-5, 2, 4);
    scene.add(magenta);
    const cyan = new THREE.PointLight(0x00e5ff, 40, 18);
    cyan.position.set(5, -2, 4);
    scene.add(cyan);

    // Alone dietro la ruota
    const glowCanvas = document.createElement('canvas');
    drawGlow(glowCanvas, 256, 'rgba(255, 60, 220, 0.9)');
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(glowTexture);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.scale.set(R * 3.4, R * 3.4, 1);
    this.glow.position.z = -1.2;
    scene.add(this.glow);

    // ---- Parte che ruota
    const wheel = new THREE.Group();
    this.wheel = wheel;
    scene.add(wheel);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.97, 0.4, 96, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a0b52, metalness: 0.6, roughness: 0.35 }),
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.2;
    wheel.add(body);

    this.faceCanvas = document.createElement('canvas');
    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTexture.colorSpace = THREE.SRGBColorSpace;
    this.faceTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.disposables.push(this.faceTexture);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(R, 128),
      new THREE.MeshStandardMaterial({
        map: this.faceTexture,
        emissive: 0xffffff,
        emissiveMap: this.faceTexture,
        emissiveIntensity: 0.55,
        roughness: 0.45,
        metalness: 0.05,
      }),
    );
    face.position.z = 0.001;
    wheel.add(face);

    this.highlight = new THREE.Mesh(
      new THREE.CircleGeometry(R, 8, 0, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.highlight.position.z = 0.01;
    this.highlight.visible = false;
    wheel.add(this.highlight);

    const gold = new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 0.9, roughness: 0.25, emissive: 0x6b4500, emissiveIntensity: 0.4 });
    this.pegMaterial = gold;
    this.pegGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12);
    this.pegGeometry.rotateX(Math.PI / 2);
    this.disposables.push(this.pegGeometry);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.32, 48), gold);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.16;
    wheel.add(hub);
    const hubCap = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 48),
      new THREE.MeshStandardMaterial({ color: 0xff2bd6, emissive: 0xff2bd6, emissiveIntensity: 1.2, roughness: 0.3 }),
    );
    hubCap.position.z = 0.325;
    wheel.add(hubCap);

    // ---- Parte fissa: cornice, lampadine, puntatore
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.12, 0.17, 20, 160),
      new THREE.MeshStandardMaterial({ color: 0x8a2be2, metalness: 0.8, roughness: 0.25, emissive: 0x3a0a6a, emissiveIntensity: 0.6 }),
    );
    rim.position.z = 0.02;
    scene.add(rim);

    const neonRing = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.48, 0.045, 12, 180),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    neonRing.position.z = -0.05;
    scene.add(neonRing);

    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), BULB_COUNT);
    const m = new THREE.Matrix4();
    for (let i = 0; i < BULB_COUNT; i++) {
      const a = (i / BULB_COUNT) * TAU;
      m.makeTranslation(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0.19);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.bulbs = bulbs;
    scene.add(bulbs);

    // Puntatore (flapper) in alto: un "goccia" rivolta verso il basso, imperniata in alto
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.95);
    shape.bezierCurveTo(0.12, -0.6, 0.38, -0.25, 0.36, 0.02);
    shape.absarc(0, 0.02, 0.36, 0, Math.PI, false);
    shape.bezierCurveTo(-0.38, -0.25, -0.12, -0.6, 0, -0.95);
    const pointerGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 });
    pointerGeo.translate(0, 0, -0.09);
    const pointerMesh = new THREE.Mesh(
      pointerGeo,
      new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0xff1144, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3 }),
    );
    const pointerJewel = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    pointerJewel.position.set(0, 0.02, 0.17);
    this.pointerPivot = new THREE.Group();
    this.pointerPivot.position.set(0, R + 0.38, 0.42);
    this.pointerPivot.add(pointerMesh, pointerJewel);
    scene.add(this.pointerPivot);
  }

  #initPostprocessing() {
    if (this.quality !== 'high') return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  #buildPegs(count) {
    if (this.pegs) {
      this.wheel.remove(this.pegs);
      this.pegs.dispose();
    }
    const pegs = new THREE.InstancedMesh(this.pegGeometry, this.pegMaterial, count);
    const m = new THREE.Matrix4();
    const s = TAU / count;
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + i * s; // confine dello spicchio i (da +X)
      m.makeTranslation(Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94, 0.11);
      pegs.setMatrixAt(i, m);
    }
    this.pegs = pegs;
    this.wheel.add(pegs);
  }

  #resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(width, height);

    // Inquadra tutta la ruota (puntatore incluso) in qualsiasi aspect ratio
    const aspect = width / height;
    this.camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfH = R + 1.0;
    const halfW = R + 0.65;
    const distance = Math.max(halfH / tan, halfW / (tan * aspect)) * 1.04;
    this.camera.position.set(0, -0.9, distance);
    this.camera.lookAt(0, 0.3, 0);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- loop

  #frame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();

    this.#updateSpin();
    this.#updatePointer(dt);
    this.#updateLights(t);
    if (this.highlight.visible) this.highlight.material.opacity = 0.18 + 0.14 * Math.sin(t * 8);
    this.glow.material.opacity = 0.75 + 0.15 * Math.sin(t * 1.3);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.#monitorPerformance(dt);
  }

  #updateSpin() {
    if (!this.spin) return;
    const { plan, start } = this.spin;
    const elapsed = performance.now() - start;
    this.setAngle(angleAt(plan, elapsed));

    const n = this.segments.length;
    if (n) {
      const index = segmentIndexAt(this.angle, n);
      if (index !== this.lastIndex) {
        this.lastIndex = index;
        // Il piolo spinge il puntatore nel verso di rotazione, più forte a velocità alta
        const speed = Math.abs(angularVelocityAt(plan, elapsed)) * 1000; // rad/s
        this.pointer.angle = Math.min(0.55, this.pointer.angle + 0.12 + speed * 0.03);
        this.emit('tick', index);
      }
    }

    if (elapsed >= plan.duration) {
      const { resolve } = this.spin;
      this.spin = null;
      const index = n ? segmentIndexAt(this.angle, n) : -1;
      if (index >= 0) {
        this.setHighlight(index);
        this.setLights('win', segmentInfo(this.segments[index]).color);
      }
      resolve(index);
      this.emit('stop', index);
    }
  }

  /** Molla smorzata per il rimbalzo del puntatore. */
  #updatePointer(dt) {
    const p = this.pointer;
    const stiffness = 180;
    const damping = 14;
    p.velocity += (-stiffness * p.angle - damping * p.velocity) * dt;
    p.angle += p.velocity * dt;
    this.pointerPivot.rotation.z = p.angle;
  }

  #updateLights(t) {
    const { mode, color, since } = this.lightMode;
    const c = new THREE.Color();
    const white = new THREE.Color(1, 1, 1);
    const pink = new THREE.Color('#ff2bd6');
    const cyan = new THREE.Color('#00e5ff');
    for (let i = 0; i < BULB_COUNT; i++) {
      let k;
      if (mode === 'spin') {
        // inseguimento veloce
        k = (Math.sin(i * 0.9 - t * 22) + 1) / 2;
        c.copy(i % 2 ? pink : cyan).lerp(white, k);
        c.multiplyScalar(0.35 + 0.9 * k);
      } else if (mode === 'win') {
        // lampeggio di tutte le luci nel colore dello spicchio vincente
        const blink = Math.floor((t - since) * 6) % 2 === 0 ? 1.4 : 0.35;
        c.copy(color).lerp(white, 0.3).multiplyScalar(blink);
      } else {
        // idle: respiro lento alternato
        k = (Math.sin(t * 2.2 + (i % 2) * Math.PI) + 1) / 2;
        c.copy(white).multiplyScalar(0.45 + 0.85 * k);
      }
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor.needsUpdate = true;
  }

  /** Se per ~2s di fila la media è sotto ~50fps, togliamo prima il bloom poi risoluzione. */
  #monitorPerformance(dt) {
    const perf = this.perf;
    perf.frames++;
    perf.acc += dt;
    if (perf.acc < 2) return;
    perf.fps = perf.frames / perf.acc;
    perf.frames = 0;
    perf.acc = 0;
    if (this.debugEl) this.debugEl.textContent = `${perf.fps.toFixed(0)} fps · ${this.composer ? 'bloom' : 'no-bloom'} · dpr ${this.renderer.getPixelRatio()}`;
    if (document.visibilityState !== 'visible') return;
    if (perf.fps < 50) perf.slowWindows++;
    else perf.slowWindows = 0;
    if (perf.slowWindows < 2) return;
    perf.slowWindows = 0;
    if (this.composer) {
      console.info('[wheel] fps bassi: disattivo il bloom');
      this.composer.dispose();
      this.composer = null;
    } else if (this.maxDpr > 1) {
      console.info('[wheel] fps bassi: riduco la risoluzione');
      this.maxDpr = 1;
      this.#resize();
    }
  }
}
