import * as THREE from 'three';
import { BeerAvatarBuilder } from '../../three/BeerAvatarBuilder.ts';
import { PHASE } from '../protocol.js';

/** Fasi in cui chi è di turno saltella e sbraccia («tocca a me!»). */
const TURN_READY_PHASES = new Set([PHASE.SHOP, PHASE.BETTING, PHASE.AWAIT_SPIN]);
/** Fasi in cui il giocatore di turno sta sulla Pedana di Lancio. */
const PAD_PHASES = new Set([PHASE.SHOP, PHASE.BETTING, PHASE.AWAIT_SPIN, PHASE.SPINNING, PHASE.LANDING, PHASE.CHOICE, PHASE.EVENT, PHASE.TURN_RESULT]);

const LABEL_FONT = '"Oswald", "Arial Narrow", system-ui, sans-serif';
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Anfiteatro: le birre stanno su archi concentrici davanti alla ruota, centrati in ARC_CENTER.
 *  - fino a 6 giocatori: un arco (R 3.2) da -70° a +70°
 *  - oltre: due archi sfalsati (R1 3.2 dietro, R2 4.1 davanti)
 * La finestra centrale -18°..+18° resta libera: lì si vede il piedistallo della ruota.
 */
const ARC_CENTER_Z = 0.8;
const ARC_R1 = 3.2;
const ARC_R2 = 4.1;
const ARC_MAX = 70 * DEG;
const ARC_WINDOW = 18 * DEG;
const BEER_SWAP_MS = 350;

/**
 * Posizione (x, z) della Pedana di Lancio sul bancone: al centro, nella finestra libera
 * dell'anfiteatro davanti al piedistallo (così non si sovrappone mai ai posti a sedere).
 */
export const LAUNCH_PAD = Object.freeze({ x: 0, z: 3.7 });

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

/** Ease "backOut": supera leggermente il valore finale e torna indietro (effetto molla). */
function backOut(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const k = Math.min(1, Math.max(0, x)) - 1;
  return 1 + c3 * k ** 3 + c1 * k ** 2;
}

/** Inviluppo morbido 0→1→0 per entrare e uscire da un'azione senza scatti. */
function envelope(k, edge = 0.18) {
  if (k <= 0 || k >= 1) return 0;
  return Math.min(1, k / edge, (1 - k) / edge);
}

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Angoli (da +Z) per n posti su un arco, saltando la finestra centrale e alternando destra/sinistra.
 * `stagger`: posti a metà tra quelli dell'arco "pieno" (seconda fila sfalsata, non coperta dalla prima).
 */
function arcAngles(n, stagger = false) {
  if (n <= 0) return [];
  const span = ARC_MAX - ARC_WINDOW;
  const right = Math.ceil(n / 2);
  const left = n - right;
  const side = (count, sign) =>
    Array.from({ length: count }, (_, i) => {
      let k;
      if (stagger) k = (i + 0.5) / count;
      else k = count === 1 ? 0.4 : i / (count - 1);
      return sign * (ARC_WINDOW + span * k);
    });
  const r = side(right, 1);
  const l = side(left, -1);
  const out = [];
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if (i < r.length) out.push(r[i]);
    if (i < l.length) out.push(l[i]);
  }
  return out;
}

/**
 * Punto dell'anfiteatro all'angolo `ang` sull'arco di raggio `r`.
 * `stretch` allarga l'arco in x sugli schermi larghi (TV) e lo stringe sui telefoni.
 */
export function arcPoint(ang, r, stretch = 1) {
  return {
    x: Math.sin(ang) * r * stretch,
    z: ARC_CENTER_Z + Math.cos(ang) * r * (0.75 + 0.25 * Math.min(1, stretch)),
    pad: false,
  };
}

/**
 * Le birre-avatar sul bancone, vive.
 *
 * DISPOSIZIONE ad anfiteatro davanti alla ruota (vedi arcAngles), rivolte verso la camera.
 * Il giocatore di turno cammina sulla Pedana di Lancio, illuminata da un occhio di bue.
 *
 * COMPORTAMENTI (cosa fanno, in ordine di priorità)
 *  - disconnesso:      bicchiere vuoto, accasciato, braccia a penzoloni
 *  - esultanza:        salto con giravolta e braccia al cielo (vince monete)
 *  - spin in corso:    si girano verso la ruota, tifano a braccia alzate, saltellano,
 *                      fanno un "sobbalzo" a ogni scatto del puntatore
 *  - risultato:        applaudono
 *  - è il suo turno:   saltella e sbraccia ("tocca a me!") dalla pedana, braccia al doppio della velocità
 *  - attesa:           respirano (squash & stretch), dondolano, sbattono le palpebre, bollicine nel
 *                      bicchiere e ogni tanto un'azione a caso: saluto, calcio, mani sui fianchi,
 *                      guardano la ruota, saltello, brindisi, ruttino, ballo
 *  - emote:            salto balistico + fumetto (gestiti da JuiceDirector)
 * Segni sul bicchiere: 🎯 TAGLIA ATTIVA (cartellino sopra la testa), bagnato (grigio con gocce).
 */
export class AvatarLineup {
  root = new THREE.Group();
  #entries = new Map();
  #order = [];
  #arcScale = 1;
  #phase = PHASE.LOBBY;
  #phaseSince = 0;
  #lastTick = -10;
  #ringGeo = new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2);
  #softTexture = makeSoftTexture();
  #contactGeo = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
  #bountyTexture = makeBountyTexture();
  #bubbles;
  #juice;
  #cameraPos = new THREE.Vector3(0, 2, 30);
  #padOwner = null;

  /**
   * @param {{ surfaceY: number, juice: import('../../three/JuiceDirector.ts').JuiceDirector }} opts
   */
  constructor({ surfaceY, juice }) {
    this.surfaceY = surfaceY;
    this.#juice = juice;
    this.#bubbles = new BubbleSystem(this.#softTexture);
    this.root.add(this.#bubbles.points);
  }

  get softTexture() {
    return this.#softTexture;
  }

  /** Fattore di scala dell'anfiteatro (schermi stretti → archi più raccolti). */
  setArcScale(scale) {
    if (Math.abs(scale - this.#arcScale) < 0.01) return;
    this.#arcScale = scale;
    this.#layout();
  }

  /** Posizione della camera: le birre si voltano verso chi guarda. */
  setCameraPosition(position) {
    this.#cameraPos.copy(position);
  }

  /** Estensione (x, z) massima dei posti attuali, per inquadrarli tutti. */
  extents() {
    const pts = [];
    for (const entry of this.#entries.values()) pts.push({ x: entry.target.x, z: entry.target.z, s: entry.scale, h: entry.avatar.height });
    return pts;
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
        this.#juice.detach(id);
        this.#entries.delete(id);
      }
    }

    players.forEach((player, index) => {
      let entry = this.#entries.get(player.id);
      if (!entry) {
        entry = this.#create(player, index, now);
        this.#entries.set(player.id, entry);
      }
      if (entry.avatar.beerId !== (player.beer ?? null)) this.#swapBeer(entry, player, index, now);
      if (entry.name !== player.name || entry.color !== player.color) this.#updateLabel(entry, player);
      entry.connected = player.connected;
      entry.isTurn = player.id === turnPlayerId;
      entry.avatar.setDimmed(!player.connected);
      entry.ring.material.color.set(player.color).multiplyScalar(1.5);
      entry.glow.material.color.set(player.color);
      entry.bountyTarget = player.marks?.bounty ? 1 : 0;
      entry.wetTarget = player.marks?.wet ? 1 : 0;
    });

    const order = players.map((p) => p.id);
    const padOwner = PAD_PHASES.has(phase) ? turnPlayerId : null;
    if (order.join() !== this.#order.join() || padOwner !== this.#padOwner) {
      this.#order = order;
      this.#padOwner = padOwner;
      this.#layout();
    }
    const padEntry = padOwner ? this.#entries.get(padOwner) : null;
    this.#juice.pad.setOccupied(Boolean(padEntry?.connected), padEntry?.color);
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

  /** Emote di un giocatore: salto, fumetto, schiuma, suono. */
  emote(playerId, emoteId, now, playSound = true) {
    const entry = this.#entries.get(playerId);
    if (!entry) return;
    this.#juice.emote(playerId, emoteId, () => this.headPosition(playerId), now, playSound);
  }

  /** Posizione mondo appena sopra la testa (per fumetti e particelle). */
  headPosition(playerId, target = new THREE.Vector3()) {
    const entry = this.#entries.get(playerId);
    if (!entry) return null;
    return target.set(entry.group.position.x, entry.group.position.y + (entry.avatar.height + 0.12) * entry.scale, entry.group.position.z);
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
    for (const [id, entry] of this.#entries) {
      this.#disposeEntry(entry);
      this.#juice.detach(id);
    }
    this.#entries.clear();
    this.#ringGeo.dispose();
    this.#softTexture.dispose();
    this.#contactGeo.dispose();
    this.#bountyTexture.dispose();
    this.#bubbles.dispose();
  }

  // ------------------------------------------------------------------ animazione

  #animate(entry, t, dt) {
    const { group } = entry;
    const avatar = entry.avatar;
    const side = group.position.x < -0.01 ? -1 : group.position.x > 0.01 ? 1 : 0;
    const s = entry.seed;
    const onPad = entry.target.pad;
    const juice = entry.juice.update(t, dt, { active: onPad && entry.connected, alive: entry.connected });
    const ta = entry.juice.armClock + s; // orologio delle braccia (2x sulla pedana)

    // si gira verso la camera (yaw) con un filo di inclinazione verso chi guarda
    const faceYaw = Math.atan2(this.#cameraPos.x - group.position.x, this.#cameraPos.z - group.position.z);

    // ---- posa di base (in piedi, in attesa)
    const pose = {
      lift: 0,
      yaw: faceYaw,
      pitch: 0,
      roll: 0,
      squash: 1,
      armL: { x: 0, z: -0.32 - Math.sin(ta * 1.5) * 0.07 },
      armR: { x: 0, z: 0.32 + Math.sin(ta * 1.5 + 1) * 0.07 },
      legL: Math.sin(t * 2.3 + s) * 0.04,
      legR: Math.sin(t * 2.3 + s + Math.PI) * 0.04,
    };
    const lookAtWheel = () => {
      pose.yaw = faceYaw + (side === 0 ? 0 : -side * 0.75);
      pose.pitch = -0.2;
    };

    const phaseTime = t - this.#phaseSince;
    const celebrating = entry.celebrateAt && t - entry.celebrateAt < 1.6;
    const dx = entry.target.x - group.position.x;
    const dz = entry.target.z - group.position.z;
    const walking = Math.hypot(dx, dz) > 0.06 && t - entry.spawnAt > 0.9;

    if (!entry.connected) {
      // "è crollato": accasciato di lato, braccia a penzoloni, gambe ferme
      pose.roll = 0.3 * (side || 1);
      pose.pitch = 0.1;
      pose.armL = { x: 0.1, z: -0.05 };
      pose.armR = { x: 0.1, z: 0.05 };
      pose.legL = 0;
      pose.legR = 0;
      pose.squash = 0.97;
    } else if (walking) {
      // cammina verso il nuovo posto (es. la pedana): passo alternato e braccia che pendolano
      const step = Math.sin(t * 13 + s);
      pose.yaw = Math.atan2(dx, dz) * 0.6 + faceYaw * 0.4;
      pose.legL = step * 0.55;
      pose.legR = -step * 0.55;
      pose.armL = { x: -step * 0.6, z: -0.3 };
      pose.armR = { x: step * 0.6, z: 0.3 };
      pose.lift = Math.abs(Math.cos(t * 13 + s)) * 0.07;
      pose.roll = step * 0.05;
    } else if (celebrating) {
      const k = (t - entry.celebrateAt) / 1.6;
      pose.lift = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 1.0;
      pose.yaw += k < 0.72 ? (k / 0.72) * TAU : 0;
      pose.armL = { x: -0.2, z: -2.7 + Math.sin(ta * 14) * 0.2 };
      pose.armR = { x: -0.2, z: 2.7 + Math.sin(ta * 14 + 1) * 0.2 };
      pose.legL = -0.7;
      pose.legR = -0.7;
    } else if (this.#phase === PHASE.SPINNING) {
      // tifo: guardano la ruota, braccia su, saltellano
      lookAtWheel();
      const amp = entry.isTurn ? 2.6 : 1.5;
      pose.armL = { x: -0.3, z: -amp - Math.sin(ta * 13) * 0.25 };
      pose.armR = { x: -0.3, z: amp + Math.sin(ta * 13 + 1.3) * 0.25 };
      const bounce = Math.abs(Math.sin(t * 7 + s));
      pose.legL = -0.25 * bounce;
      pose.legR = -0.25 * bounce;
      pose.lift = (entry.isTurn ? 0.15 : 0.06) * bounce;
    } else if (this.#phase === PHASE.LANDING && phaseTime < 2.6) {
      // applauso
      const clap = Math.sin(ta * 15 + s * 0.3);
      pose.armL = { x: -1.25, z: 0.45 + clap * 0.3 };
      pose.armR = { x: -1.25, z: -0.45 - clap * 0.3 };
      pose.pitch = -0.06;
    } else if (entry.isTurn && TURN_READY_PHASES.has(this.#phase)) {
      // "tocca a me!": saltella e sbraccia
      const hop = Math.abs(Math.sin(t * 4.4 + s));
      pose.lift = hop * 0.28;
      pose.squash = 1 + (hop - 0.5) * 0.08;
      pose.armL = { x: -0.2, z: -2.3 - Math.sin(ta * 10) * 0.35 };
      pose.armR = { x: -0.2, z: 2.3 + Math.sin(ta * 10 + 1.5) * 0.35 };
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
    const limbRate = 16 * juice.armSpeed;
    const bodyRate = 7;
    const [armL, armR] = avatar.arms;
    const [legL, legR] = avatar.legs;
    const [restL, restR] = avatar.armRest;
    if (armL && armR) {
      armL.rotation.x = damp(armL.rotation.x, pose.armL.x + restL.x, limbRate, dt);
      armL.rotation.z = damp(armL.rotation.z, pose.armL.z, limbRate, dt);
      armR.rotation.x = damp(armR.rotation.x, pose.armR.x + restR.x, limbRate, dt);
      armR.rotation.z = damp(armR.rotation.z, pose.armR.z, limbRate, dt);
    }
    if (legL && legR) {
      legL.rotation.x = damp(legL.rotation.x, pose.legL, 18, dt);
      legR.rotation.x = damp(legR.rotation.x, pose.legR, 18, dt);
    }
    entry.yaw = celebrating ? pose.yaw : damp(entry.yaw, pose.yaw, bodyRate, dt);
    group.rotation.y = entry.yaw;
    avatar.body.rotation.x = damp(avatar.body.rotation.x, pose.pitch, bodyRate, dt);
    entry.roll = damp(entry.roll, pose.roll, bodyRate, dt);
    avatar.body.rotation.z = entry.roll + juice.sway;
    entry.squash = damp(entry.squash, pose.squash, 20, dt);
    const sq = entry.squash;
    avatar.body.scale.set(juice.scaleX / Math.sqrt(sq), juice.scaleY * sq, juice.scaleX / Math.sqrt(sq));

    // bagnato (Birra Analcolica) e cartellino della taglia
    entry.wet = damp(entry.wet, entry.wetTarget, 3, dt);
    avatar.setWet(entry.wet);
    entry.bounty = damp(entry.bounty, entry.bountyTarget, 6, dt);
    entry.bountyTag.visible = entry.bounty > 0.02;
    if (entry.bountyTag.visible) {
      const k = entry.bounty;
      entry.bountyTag.scale.set(0.95 * k, 0.32 * k, 1);
      entry.bountyTag.position.y = entry.labelY + 0.3 + Math.sin(t * 3) * 0.03;
      entry.bountyTag.material.rotation = Math.sin(t * 2.2) * 0.06;
    }

    // posizione: cammina al proprio posto, entrata con caduta elastica
    const followK = 1 - Math.exp(-dt * (walking ? 2.6 : 5));
    group.position.x += dx * followK;
    group.position.z += dz * followK;
    const spawn = elasticOut(sinceSpawn / 0.9);
    const swapK = entry.swapAt ? backOut((t - entry.swapAt) / (BEER_SWAP_MS / 1000)) : 1;
    group.scale.setScalar(entry.scale * Math.max(0.01, spawn) * Math.max(0.01, swapK));
    const fall = (1 - Math.min(1, sinceSpawn / 0.45)) * 2.6;
    entry.lift = damp(entry.lift, pose.lift, 18, dt);
    group.position.y = this.surfaceY + entry.lift + fall + juice.jump;

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
    const floorY = this.surfaceY + (onPad && !walking ? 0.085 : 0);
    entry.ring.position.set(x, floorY + 0.012, z);
    entry.glow.position.set(x, floorY + 0.01, z);
    entry.ring.scale.setScalar(entry.scale);
    entry.glow.scale.setScalar(entry.scale);
    const air = entry.lift + fall + juice.jump;
    const k = 1 / (1 + air * 1.6);
    entry.contact.position.set(x, floorY + 0.008, z + 0.05 * entry.scale);
    entry.contact.scale.setScalar(entry.scale * Math.max(0.001, spawn) * (0.6 + 0.2 * k));
    entry.contact.material.opacity = (entry.connected ? 0.75 : 0.4) * k;
    if (onPad && !walking) group.position.y += 0.085;
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

    // i posti dipendono dal numero TOTALE di giocatori: chi va sulla pedana lascia il suo posto vuoto
    const a = this.#arcScale;
    let slots;
    if (n <= 6) {
      slots = arcAngles(n).map((ang) => ({ ang, r: ARC_R1 }));
    } else {
      // due file: dietro (R1) i primi, davanti (R2) gli altri, sfalsati per non coprirsi
      const back = Math.ceil(n / 2);
      const front = n - back;
      const backSlots = arcAngles(back).map((ang) => ({ ang, r: ARC_R1 }));
      const frontSlots = arcAngles(front, true).map((ang) => ({ ang, r: ARC_R2 }));
      slots = [];
      for (let i = 0; i < Math.max(back, front); i++) {
        if (i < backSlots.length) slots.push(backSlots[i]);
        if (i < frontSlots.length) slots.push(frontSlots[i]);
      }
    }
    const scale = (n > 6 ? 0.92 : 1.05) * (0.85 + 0.15 * Math.min(1, a));
    const positions = slots.map(({ ang, r }) => arcPoint(ang, r, a));

    ids.forEach((id) => {
      const entry = this.#entries.get(id);
      entry.homeIndex = this.#order.indexOf(id);
    });
    // il posto "di casa" di ciascuno è fisso (ordine di ingresso), anche quando è sulla pedana
    for (const id of ids) {
      const entry = this.#entries.get(id);
      const home = positions[entry.homeIndex] ?? positions[0];
      entry.target = id === this.#padOwner ? { x: LAUNCH_PAD.x * Math.min(1, a), z: LAUNCH_PAD.z, pad: true } : home;
      entry.scale = id === this.#padOwner ? scale * 1.12 : scale;
      if (!entry.placed) {
        entry.placed = true;
        entry.group.position.x = entry.target.x;
        entry.group.position.z = entry.target.z;
      }
    }
  }

  // ------------------------------------------------------------------ creazione

  #create(player, index, now) {
    const avatar = BeerAvatarBuilder.build(player.beer ?? null);
    const group = new THREE.Group();
    group.add(avatar.root);

    const labelCanvas = document.createElement('canvas');
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false, transparent: true }));
    group.add(label);

    const bountyTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#bountyTexture, depthWrite: false, transparent: true }));
    bountyTag.visible = false;
    group.add(bountyTag);

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
      labelY: 0,
      bountyTag,
      ring,
      glow,
      contact,
      juice: this.#juice.attach(player.id, avatar, index, now),
      seed: Math.random() * 10,
      spawnAt: now,
      swapAt: 0,
      celebrateAt: 0,
      scale: 1,
      squash: 1,
      roll: 0,
      lift: 0,
      yaw: 0,
      wet: 0,
      wetTarget: 0,
      bounty: 0,
      bountyTarget: 0,
      homeIndex: index,
      target: { x: 0, z: ARC_CENTER_Z + ARC_R1, pad: false },
      placed: false,
      connected: true,
      isTurn: false,
      action: null,
      nextActionAt: now + 1.5 + Math.random() * 3,
    };
    this.#updateLabel(entry, player);
    return entry;
  }

  /**
   * Cambio birra: via le mesh vecchie (geometrie e materiali liberati), entra la nuova
   * con una scala 0.01 → 1 in 350 ms (backOut) e uno sbuffo di bollicine.
   */
  #swapBeer(entry, player, index, now) {
    const old = entry.avatar;
    const next = BeerAvatarBuilder.build(player.beer ?? null);
    entry.group.remove(old.root);
    old.dispose();
    entry.group.add(next.root);
    entry.avatar = next;
    entry.juice = this.#juice.attach(player.id, next, index, now);
    entry.wet = -1; // forza la riapplicazione dello stato "bagnato" sul nuovo materiale
    entry.swapAt = now;
    if (player.beer) this.#bubbles.emit(entry.group.position, 14, next.height * entry.scale);
    this.#updateLabel(entry, player);
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
    // badge del nome sopra il bicchiere: altezza del vetro + 0.45
    entry.labelY = entry.avatar.glassTop + 0.45;
    entry.label.position.set(0, entry.labelY, 0);
  }

  #disposeEntry(entry) {
    entry.avatar.dispose();
    entry.juice.dispose();
    entry.label.material.map.dispose();
    entry.label.material.dispose();
    entry.bountyTag.material.dispose();
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

/** Cartellino "🎯 TAGLIA ATTIVA" che fluttua sopra chi ha una taglia sulla testa. */
function makeBountyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(120, 14, 20, 0.92)';
  ctx.beginPath();
  ctx.roundRect(6, 10, 372, 108, 26);
  ctx.fill();
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#ffe9b8';
  ctx.font = `700 54px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎯 TAGLIA', 192, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
