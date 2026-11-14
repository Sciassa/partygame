import * as THREE from 'three';
import { BeerAvatar } from './BeerAvatar.js';
import { PHASE } from '../protocol.js';

/** Fasi in cui chi è di turno saltella e sbraccia («tocca a me!»). */
const TURN_READY_PHASES = new Set([PHASE.SHOP, PHASE.BETTING, PHASE.AWAIT_SPIN]);

const LABEL_FONT = '"Oswald", "Arial Narrow", system-ui, sans-serif';
const TAU = Math.PI * 2;

/** Quanto spazio lasciare libero attorno al piedistallo della ruota (x). */
const WHEEL_CLEAR_X = 2.85;
const SIDE_SPACING = 1.1;
const SIDE_SCALE = 1.15; // ai lati c'è spazio: birre grandi, protagoniste come nella reference
const SIDE_ROWS_Z = [1.75, 0.6]; // prima fila (davanti), seconda fila
const FRONT_SPACING = 0.95;

/**
 * Repertorio di azioni "da toy" che i bicchieri fanno da soli quando sono in attesa.
 * Ogni azione dura `dur` secondi e restituisce una posa parziale in funzione del tempo locale.
 */
const IDLE_ACTIONS = ['wave', 'kick', 'hips', 'look', 'hop', 'cheers', 'bubbles', 'sway'];

function elasticOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 2 ** (-10 * x) * Math.sin(((x * 10 - 0.75) * TAU) / 3) + 1;
}

/** Inviluppo morbido 0→1→0 per entrare e uscire da un'azione senza scatti. */
function envelope(k, edge = 0.18) {
  if (k <= 0 || k >= 1) return 0;
  return Math.min(1, k / edge, (1 - k) / edge);
}

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Le birre-avatar sul bancone, vive.
 *
 * DISPOSIZIONE
 *  - schermi larghi (TV): sedute ai due lati della ruota, su due file sfalsate
 *  - schermi stretti (telefoni in Pocket): in fila davanti al piedistallo
 *
 * COMPORTAMENTI (cosa fanno, in ordine di priorità)
 *  - disconnesso:      bicchiere vuoto, accasciato, braccia a penzoloni
 *  - esultanza:        salto con giravolta e braccia al cielo (vince monete)
 *  - spin in corso:    si girano verso la ruota, tifano a braccia alzate, calciano veloci,
 *                      fanno un "sobbalzo" a ogni scatto del puntatore
 *  - risultato:        applaudono
 *  - è il suo turno:   saltella e sbraccia ("tocca a me!")
 *  - attesa:           dondolano le gambe, respirano, sbattono le palpebre e ogni tanto fanno
 *                      un'azione a caso: saluto, calcio, mani sui fianchi, guardano la ruota,
 *                      saltello, brindisi, bollicine, dondolio
 */
export class AvatarLineup {
  root = new THREE.Group();
  #entries = new Map();
  #order = [];
  #halfWidth = 6;
  #phase = PHASE.LOBBY;
  #phaseSince = 0;
  #lastTick = -10;
  #ringGeo = new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2);
  #softTexture = makeSoftTexture();
  #contactGeo = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
  #bubbles;

  constructor({ surfaceY, frontZ }) {
    this.surfaceY = surfaceY;
    this.frontZ = frontZ;
    this.#bubbles = new BubbleSystem(this.#softTexture);
    this.root.add(this.#bubbles.points);
  }

  /** Mezza larghezza visibile (unità mondo) all'altezza delle birre: decide la disposizione. */
  setVisibleHalfWidth(halfWidth) {
    if (Math.abs(halfWidth - this.#halfWidth) < 0.01) return;
    this.#halfWidth = halfWidth;
    this.#layout();
  }

  sync(players, turnPlayerId, phase, now) {
    if (phase !== this.#phase) {
      this.#phase = phase;
      this.#phaseSince = now;
    }
    const ids = new Set(players.map((p) => p.id));
    for (const [id, entry] of this.#entries) {
      if (!ids.has(id)) {
        this.root.remove(entry.group, entry.ring, entry.glow, entry.contact);
        this.#disposeEntry(entry);
        this.#entries.delete(id);
      }
    }

    for (const player of players) {
      let entry = this.#entries.get(player.id);
      if (!entry) {
        entry = this.#create(player, now);
        this.#entries.set(player.id, entry);
      }
      if (entry.avatar.beerId !== player.beer) {
        entry.avatar.setBeer(player.beer);
        entry.swapAt = now;
        if (player.beer) this.#bubbles.emit(entry.group.position, 10, entry.avatar.height * entry.scale);
      }
      if (entry.name !== player.name || entry.color !== player.color) this.#updateLabel(entry, player);
      entry.connected = player.connected;
      entry.isTurn = player.id === turnPlayerId;
      entry.avatar.setDimmed(!player.connected);
      entry.ring.material.color.set(player.color).multiplyScalar(1.5);
      entry.glow.material.color.set(player.color);
    }

    const order = players.map((p) => p.id);
    if (order.join() !== this.#order.join()) {
      this.#order = order;
      this.#layout();
    }
  }

  refreshLabels() {
    for (const entry of this.#entries.values()) this.#updateLabel(entry, { name: entry.name, color: entry.color });
  }

  /** Esultanza (vince monete). */
  celebrate(playerId, now) {
    const entry = this.#entries.get(playerId);
    if (!entry) return;
    entry.celebrateAt = now;
    this.#bubbles.emit(entry.group.position, 26, entry.avatar.height * entry.scale);
  }

  /** Scatto del puntatore sulla borchia: tutti fanno un piccolo sobbalzo a tempo. */
  tick(now) {
    this.#lastTick = now;
  }

  update(t, dt) {
    for (const entry of this.#entries.values()) this.#animate(entry, t, dt);
    this.#bubbles.update(dt);
  }

  dispose() {
    for (const entry of this.#entries.values()) this.#disposeEntry(entry);
    this.#entries.clear();
    this.#ringGeo.dispose();
    this.#softTexture.dispose();
    this.#contactGeo.dispose();
    this.#bubbles.dispose();
  }

  // ------------------------------------------------------------------ animazione

  #animate(entry, t, dt) {
    const { group, avatar } = entry;
    const side = entry.target.x < -0.01 ? -1 : entry.target.x > 0.01 ? 1 : 0;
    const s = entry.seed;

    // ---- posa di base (seduto, in attesa)
    const pose = {
      lift: 0,
      yaw: entry.target.yaw,
      pitch: 0,
      roll: Math.sin(t * 1.1 + s) * 0.025,
      squash: 1 + Math.sin(t * 2 + s) * 0.015,
      armL: { x: 0, z: -0.2 - Math.sin(t * 1.5 + s) * 0.07 },
      armR: { x: 0, z: 0.2 + Math.sin(t * 1.5 + s + 1) * 0.07 },
      legL: -0.12 - 0.12 * (1 + Math.sin(t * 2.3 + s)),
      legR: -0.12 - 0.12 * (1 + Math.sin(t * 2.3 + s + Math.PI)),
    };
    const lookAtWheel = () => {
      pose.yaw = side === 0 ? 0 : -side * 1.0;
      pose.pitch = -0.16;
    };

    const phaseTime = t - this.#phaseSince;
    const celebrating = entry.celebrateAt && t - entry.celebrateAt < 1.6;

    if (!entry.connected) {
      // "è crollato": accasciato di lato, braccia a penzoloni, gambe ferme
      pose.roll = 0.3 * (side || 1);
      pose.pitch = 0.1;
      pose.armL = { x: 0.1, z: -0.05 };
      pose.armR = { x: 0.1, z: 0.05 };
      pose.legL = 0;
      pose.legR = 0;
      pose.squash = 0.97;
    } else if (celebrating) {
      const k = (t - entry.celebrateAt) / 1.6;
      pose.lift = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 1.0;
      pose.yaw += k < 0.72 ? (k / 0.72) * TAU : 0;
      pose.armL = { x: -0.2, z: -2.7 + Math.sin(t * 14) * 0.2 };
      pose.armR = { x: -0.2, z: 2.7 + Math.sin(t * 14 + 1) * 0.2 };
      pose.legL = -0.7;
      pose.legR = -0.7;
    } else if (this.#phase === PHASE.SPINNING) {
      // tifo: guardano la ruota, braccia su, calci veloci
      lookAtWheel();
      const amp = entry.isTurn ? 2.6 : 1.5;
      pose.armL = { x: -0.3, z: -amp - Math.sin(t * 13 + s) * 0.25 };
      pose.armR = { x: -0.3, z: amp + Math.sin(t * 13 + s + 1.3) * 0.25 };
      pose.legL = -0.2 - 0.3 * (1 + Math.sin(t * 7 + s));
      pose.legR = -0.2 - 0.3 * (1 + Math.sin(t * 7 + s + Math.PI));
      pose.lift = entry.isTurn ? Math.abs(Math.sin(t * 5)) * 0.15 : 0;
    } else if (this.#phase === PHASE.LANDING && phaseTime < 2.6) {
      // applauso
      const clap = Math.sin(t * 15 + s * 0.3);
      pose.armL = { x: -1.25, z: 0.45 + clap * 0.3 };
      pose.armR = { x: -1.25, z: -0.45 - clap * 0.3 };
      pose.pitch = -0.06;
    } else if (entry.isTurn && TURN_READY_PHASES.has(this.#phase)) {
      // "tocca a me!": saltella e sbraccia
      const hop = Math.abs(Math.sin(t * 4.4 + s));
      pose.lift = hop * 0.28;
      pose.squash = 1 + (hop - 0.5) * 0.08;
      pose.armL = { x: -0.2, z: -2.3 - Math.sin(t * 10) * 0.35 };
      pose.armR = { x: -0.2, z: 2.3 + Math.sin(t * 10 + 1.5) * 0.35 };
      pose.legL = -0.5 * hop;
      pose.legR = -0.5 * hop;
    } else {
      this.#idleAction(entry, pose, t, side);
    }

    // saluto di benvenuto appena atterrato
    const sinceSpawn = t - entry.spawnAt;
    if (entry.connected && sinceSpawn > 0.55 && sinceSpawn < 2.2) {
      const e = envelope((sinceSpawn - 0.55) / 1.65);
      pose.armR.z += (2.5 + Math.sin(t * 12) * 0.35 - pose.armR.z) * e;
      pose.armR.x += (-0.3 - pose.armR.x) * e;
    }

    // sobbalzo a ogni scatto del puntatore
    const nod = Math.exp(-(t - this.#lastTick) * 14);
    if (entry.connected) pose.squash *= 1 - 0.06 * nod;

    // ---- applica con smorzamento (niente scatti tra un comportamento e l'altro)
    const limbRate = 16;
    const bodyRate = 7;
    const [armL, armR] = avatar.arms;
    const [legL, legR] = avatar.legs;
    if (armL) {
      armL.rotation.x = damp(armL.rotation.x, pose.armL.x, limbRate, dt);
      armL.rotation.z = damp(armL.rotation.z, pose.armL.z, limbRate, dt);
      armR.rotation.x = damp(armR.rotation.x, pose.armR.x, limbRate, dt);
      armR.rotation.z = damp(armR.rotation.z, pose.armR.z, limbRate, dt);
      legL.rotation.x = damp(legL.rotation.x, pose.legL, limbRate, dt);
      legR.rotation.x = damp(legR.rotation.x, pose.legR, limbRate, dt);
    }
    entry.yaw = celebrating ? pose.yaw : damp(entry.yaw, pose.yaw, bodyRate, dt);
    group.rotation.y = entry.yaw;
    avatar.body.rotation.x = damp(avatar.body.rotation.x, pose.pitch, bodyRate, dt);
    avatar.body.rotation.z = damp(avatar.body.rotation.z, pose.roll, bodyRate, dt);
    entry.squash = damp(entry.squash, pose.squash, 20, dt);
    avatar.body.scale.set(1 / Math.sqrt(entry.squash), entry.squash, 1 / Math.sqrt(entry.squash));

    // palpebre
    if (t > entry.blinkAt) entry.blinkAt = t + 2.2 + Math.random() * 3.5;
    const blinking = entry.blinkAt - t > 0 && entry.blinkAt - t < 0.11;
    avatar.eyes.scale.y = blinking ? 0.12 : 1;

    // posizione: scivola al proprio posto, entrata con caduta elastica
    const follow = 1 - Math.exp(-dt * 5);
    group.position.x += (entry.target.x - group.position.x) * follow;
    group.position.z += (entry.target.z - group.position.z) * follow;
    const spawn = elasticOut(sinceSpawn / 0.9);
    const swap = entry.swapAt ? 1 + 0.22 * Math.sin(Math.min(1, (t - entry.swapAt) / 0.45) * Math.PI) : 1;
    group.scale.setScalar(entry.scale * Math.max(0.001, spawn) * swap);
    const fall = (1 - Math.min(1, sinceSpawn / 0.45)) * 2.6;
    entry.lift = damp(entry.lift, pose.lift, 18, dt);
    group.position.y = this.surfaceY + entry.lift + fall;

    // anello del turno, alone e ombra di contatto restano appoggiati al bancone
    const showRing = entry.isTurn && entry.connected;
    entry.ring.visible = showRing;
    entry.glow.visible = showRing;
    if (showRing) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 5);
      entry.ring.material.opacity = pulse;
      entry.glow.material.opacity = 0.5 * pulse;
    }
    const x = group.position.x;
    const z = group.position.z;
    entry.ring.position.set(x, this.surfaceY + 0.012, z);
    entry.glow.position.set(x, this.surfaceY + 0.01, z);
    entry.ring.scale.setScalar(entry.scale);
    entry.glow.scale.setScalar(entry.scale);
    const k = 1 / (1 + (entry.lift + fall) * 1.6);
    entry.contact.position.set(x, this.surfaceY + 0.008, z + 0.12 * entry.scale);
    entry.contact.scale.setScalar(entry.scale * Math.max(0.001, spawn) * (0.75 + 0.25 * k));
    entry.contact.material.opacity = (entry.connected ? 0.75 : 0.4) * k;
  }

  /** Azioni casuali in attesa: ognuno ha i suoi tempi, così il bancone sembra vivo. */
  #idleAction(entry, pose, t, side) {
    if (!entry.action || t > entry.action.start + entry.action.dur) {
      if (!entry.action || t > entry.nextActionAt) {
        const type = IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)];
        const dur = { wave: 1.8, kick: 1.6, hips: 2.8, look: 2.4, hop: 0.9, cheers: 1.4, bubbles: 1.2, sway: 2.6 }[type];
        entry.action = { type, start: t, dur };
        entry.nextActionAt = t + dur + 1.5 + Math.random() * 4.5;
        if (type === 'bubbles') this.#bubbles.emit(entry.group.position, 12, entry.avatar.height * entry.scale);
      } else {
        return;
      }
    }
    const { type, start, dur } = entry.action;
    const k = (t - start) / dur;
    const e = envelope(k);
    const mix = (obj, key, value) => (obj[key] += (value - obj[key]) * e);

    switch (type) {
      case 'wave': // saluta con la destra
        mix(pose.armR, 'z', 2.5 + Math.sin(t * 12) * 0.38);
        mix(pose.armR, 'x', -0.25);
        break;
      case 'kick': // calcia forte con le gambine
        mix(pose, 'legL', -0.3 - 0.45 * (1 + Math.sin(t * 9)));
        mix(pose, 'legR', -0.3 - 0.45 * (1 + Math.sin(t * 9 + Math.PI)));
        break;
      case 'hips': // mani sui fianchi, come la stout della reference
        mix(pose.armL, 'z', -0.95);
        mix(pose.armL, 'x', 0.55);
        mix(pose.armR, 'z', 0.95);
        mix(pose.armR, 'x', 0.55);
        mix(pose, 'roll', Math.sin(t * 2) * 0.06);
        break;
      case 'look': // si gira a guardare la ruota
        mix(pose, 'yaw', side === 0 ? 0 : -side * 1.0);
        mix(pose, 'pitch', -0.18);
        break;
      case 'hop': // saltello sul posto
        pose.lift = Math.sin(Math.min(1, k) * Math.PI) * 0.35;
        mix(pose, 'legL', -0.6);
        mix(pose, 'legR', -0.6);
        break;
      case 'cheers': // brindisi: braccia al cielo
        mix(pose.armL, 'z', -2.6);
        mix(pose.armR, 'z', 2.6);
        mix(pose, 'squash', 1.05);
        break;
      case 'bubbles': // "ruttino" di bollicine
        mix(pose, 'squash', 1 + Math.sin(k * Math.PI * 3) * 0.06);
        break;
      case 'sway': // dondola a tempo di musica
        mix(pose, 'roll', Math.sin(t * 4.5) * 0.14);
        mix(pose.armL, 'z', -0.6 + Math.sin(t * 4.5) * 0.3);
        mix(pose.armR, 'z', 0.6 + Math.sin(t * 4.5) * 0.3);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ disposizione

  #layout() {
    const ids = this.#order.filter((id) => this.#entries.has(id));
    const n = ids.length;
    if (!n) return;

    // posti ai lati della ruota: dall'interno verso l'esterno, prima fila prima, alternando i lati
    const room = this.#halfWidth - WHEEL_CLEAR_X - 0.3;
    const cols = room >= 0 ? Math.floor(room / SIDE_SPACING) + 1 : 0;
    const sideSlots = [];
    for (let col = 0; col < cols; col++) {
      SIDE_ROWS_Z.forEach((z, row) => {
        for (const side of [1, -1]) {
          const x = side * (WHEEL_CLEAR_X + col * SIDE_SPACING + (row ? SIDE_SPACING * 0.5 : 0));
          if (Math.abs(x) <= this.#halfWidth - 0.25) sideSlots.push({ x, z, yaw: -side * 0.3, order: col * 4 + row * 2 + (side > 0 ? 0 : 1) });
        }
      });
    }
    sideSlots.sort((a, b) => a.order - b.order);

    let slots;
    let scale;
    if (sideSlots.length >= n) {
      slots = sideSlots;
      scale = SIDE_SCALE;
    } else {
      // telefoni: in fila davanti al piedistallo, su una o due file
      const usable = Math.max(FRONT_SPACING, this.#halfWidth * 2 - 0.4);
      const perRow = Math.max(1, Math.floor(usable / FRONT_SPACING));
      const rows = n <= perRow ? 1 : 2;
      const front = rows === 1 ? n : Math.ceil(n / 2);
      const spacing = Math.min(FRONT_SPACING * (rows === 1 ? 1 : 1.5), usable / front);
      scale = Math.min(0.85, spacing / FRONT_SPACING);
      slots = ids.map((_, i) => {
        const inFront = rows === 1 || i % 2 === 0;
        const indexInRow = rows === 1 ? i : Math.floor(i / 2);
        const rowCount = rows === 1 ? n : inFront ? front : n - front;
        let x = (indexInRow - (rowCount - 1) / 2) * spacing;
        if (!inFront && rowCount === front) x += spacing / 2;
        return { x, z: inFront ? this.frontZ : this.frontZ - 0.9, yaw: 0 };
      });
    }

    ids.forEach((id, i) => {
      const entry = this.#entries.get(id);
      entry.target = slots[i];
      entry.scale = scale;
      if (!entry.placed) {
        entry.placed = true;
        entry.group.position.x = slots[i].x;
        entry.group.position.z = slots[i].z;
        entry.yaw = slots[i].yaw;
      }
    });
  }

  // ------------------------------------------------------------------ creazione

  #create(player, now) {
    const avatar = new BeerAvatar(player.beer);
    const group = new THREE.Group();
    group.add(avatar.root);

    const labelCanvas = document.createElement('canvas');
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false, transparent: true }));
    group.add(label);

    const ring = new THREE.Mesh(
      this.#ringGeo,
      new THREE.MeshBasicMaterial({ color: player.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.#softTexture, color: player.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const contact = new THREE.Mesh(
      this.#contactGeo,
      new THREE.MeshBasicMaterial({ map: this.#softTexture, color: 0x000000, transparent: true, depthWrite: false }),
    );
    contact.renderOrder = 1;
    this.root.add(group, ring, glow, contact);

    const entry = {
      group,
      avatar,
      label,
      ring,
      glow,
      contact,
      seed: Math.random() * 10,
      spawnAt: now,
      swapAt: 0,
      celebrateAt: 0,
      scale: 1,
      squash: 1,
      lift: 0,
      yaw: 0,
      target: { x: 0, z: this.frontZ, yaw: 0 },
      placed: false,
      connected: true,
      isTurn: false,
      action: null,
      nextActionAt: now + 1.5 + Math.random() * 3,
      blinkAt: now + 1 + Math.random() * 3,
    };
    this.#updateLabel(entry, player);
    return entry;
  }

  #updateLabel(entry, player) {
    entry.name = player.name;
    entry.color = player.color;
    const canvas = entry.label.material.map.image;
    const fontSize = 42;
    const measure = canvas.getContext('2d');
    measure.font = `500 ${fontSize}px ${LABEL_FONT}`;
    const text = player.name.toUpperCase();
    const w = Math.ceil(measure.measureText(text).width) + 52;
    canvas.width = w;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    ctx.font = `500 ${fontSize}px ${LABEL_FONT}`;
    ctx.fillStyle = 'rgba(20, 24, 36, 0.86)';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, 66, 33);
    ctx.fill();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#f3d595';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, 37);
    entry.label.material.map.needsUpdate = true;
    const h = 0.22;
    entry.label.scale.set((h * w) / 70, h, 1);
    entry.label.position.set(0, entry.avatar.height + 0.32, 0);
  }

  #disposeEntry(entry) {
    entry.avatar.dispose();
    entry.label.material.map.dispose();
    entry.label.material.dispose();
    entry.ring.material.dispose();
    entry.glow.geometry.dispose();
    entry.glow.material.dispose();
    entry.contact.material.dispose();
  }
}

/** Bollicine dorate che salgono (un unico THREE.Points per tutte le birre: 1 draw call). */
class BubbleSystem {
  static MAX = 160;

  constructor(texture) {
    const max = BubbleSystem.MAX;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.life = new Float32Array(max); // secondi rimasti (0 = libera)
    this.maxLife = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.09,
        map: texture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.base = new THREE.Color('#ffd89a');
  }

  /** Emette `count` bollicine sopra la birra che sta in `origin`, alta `height`. */
  emit(origin, count, height = 1.3) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % BubbleSystem.MAX;
      this.positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.35;
      this.positions[i * 3 + 1] = origin.y + height + Math.random() * 0.15;
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.35;
      this.velocity[i * 3] = (Math.random() - 0.5) * 0.15;
      this.velocity[i * 3 + 1] = 0.45 + Math.random() * 0.5;
      this.velocity[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
      this.maxLife[i] = this.life[i] = 1.1 + Math.random() * 0.9;
    }
  }

  update(dt) {
    for (let i = 0; i < BubbleSystem.MAX; i++) {
      if (this.life[i] <= 0) {
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const wobble = Math.sin(this.life[i] * 9 + i) * 0.12;
      this.positions[i * 3] += (this.velocity[i * 3] + wobble) * dt;
      this.positions[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      // con il blending additivo, "spegnere" il colore = dissolvenza
      const fade = Math.max(0, this.life[i] / this.maxLife[i]);
      this.colors[i * 3] = this.base.r * fade;
      this.colors[i * 3 + 1] = this.base.g * fade;
      this.colors[i * 3 + 2] = this.base.b * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function makeSoftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
