import * as THREE from 'three';
import { BeerAvatar } from './BeerAvatar.js';
import { PHASE } from '../protocol.js';

const SPACING = 0.9; // distanza tra i bicchieri sul bancone
const AVATAR_SCALE = 0.82; // i bicchieri non devono coprire troppo la ruota
const ROW_GAP = 0.95; // distanza in profondità tra prima e seconda fila
const LABEL_FONT = '"Oswald", "Arial Narrow", system-ui, sans-serif';

function elasticOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 2 ** (-10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
}

/**
 * La fila di birre-avatar sul bancone. Riceve la lista giocatori dallo stato dell'host e:
 *  - fa "atterrare" un bicchiere quando un giocatore entra (pop elastico dall'alto)
 *  - lo cambia se il giocatore sceglie un'altra birra
 *  - fa saltellare chi è di turno (con anello luminoso sotto)
 *  - inclina e sbiadisce chi si è disconnesso
 *  - dispone i bicchieri su 1 o 2 file in base allo spazio visibile
 */
export class AvatarLineup {
  root = new THREE.Group();
  #entries = new Map();
  #order = [];
  #halfWidth = 6;
  #phase = PHASE.IDLE;
  #ringGeo = new THREE.RingGeometry(0.44, 0.56, 48);
  #glowTexture;
  #contactTexture;
  #contactGeo = new THREE.PlaneGeometry(1.3, 1.1).rotateX(-Math.PI / 2);

  /**
   * @param {{ surfaceY:number, frontZ:number }} opts  piano del bancone e Z della prima fila
   */
  constructor({ surfaceY, frontZ }) {
    this.surfaceY = surfaceY;
    this.frontZ = frontZ;
    this.#ringGeo.rotateX(-Math.PI / 2);
    this.#glowTexture = makeGlowTexture();
    this.#contactTexture = makeGlowTexture();
  }

  /** Mezza larghezza visibile (unità mondo) all'altezza delle file: decide quante birre per fila. */
  setVisibleHalfWidth(halfWidth) {
    if (Math.abs(halfWidth - this.#halfWidth) < 0.01) return;
    this.#halfWidth = halfWidth;
    this.#layout();
  }

  /** @param {Array} players snapshot pubblico dei giocatori */
  sync(players, turnPlayerId, phase, now) {
    this.#phase = phase;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, entry] of this.#entries) {
      if (!ids.has(id)) {
        this.root.remove(entry.group);
        this.root.remove(entry.ring, entry.glow, entry.contact);
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
        entry.swapAt = now; // piccolo "boing" di cambio birra
        this.#placeLabel(entry);
      }
      if (entry.name !== player.name || entry.color !== player.color) this.#updateLabel(entry, player);
      entry.connected = player.connected;
      entry.isTurn = player.id === turnPlayerId;
      entry.avatar.setDimmed(!player.connected);
      entry.ring.material.color.set(player.color).multiplyScalar(1.6);
      entry.glow.material.color.set(player.color);
    }

    const order = players.map((p) => p.id);
    if (order.join() !== this.#order.join()) {
      this.#order = order;
      this.#layout();
    }
  }

  /** Ridisegna le etichette (es. quando il web font è finalmente caricato). */
  refreshLabels() {
    for (const entry of this.#entries.values()) this.#updateLabel(entry, { name: entry.name, color: entry.color });
  }

  /** Esultanza (salto con giravolta), es. quando vince monete. */
  celebrate(playerId, now) {
    const entry = this.#entries.get(playerId);
    if (entry) entry.celebrateAt = now;
  }

  update(t, dt) {
    const follow = 1 - Math.exp(-dt * 6);
    for (const entry of this.#entries.values()) {
      const { group, avatar } = entry;
      // posizione: scivola verso il posto assegnato
      group.position.x += (entry.target.x - group.position.x) * follow;
      group.position.z += (entry.target.z - group.position.z) * follow;

      // entrata: caduta dall'alto con rimbalzo elastico
      const spawn = elasticOut((t - entry.spawnAt) / 0.9);
      const swap = entry.swapAt ? 1 + 0.25 * Math.sin(Math.min(1, (t - entry.swapAt) / 0.4) * Math.PI) : 1;
      group.scale.setScalar(entry.scale * Math.max(0.001, spawn) * swap);
      let y = this.surfaceY + (1 - Math.min(1, (t - entry.spawnAt) / 0.5)) * 2.5;

      // stati: idle, turno, disconnesso, esultanza
      const body = avatar.body;
      let tilt = Math.sin(t * 1.3 + entry.seed) * 0.035;
      let squash = 1;
      if (!entry.connected) {
        tilt = 0.32; // "è crollato"
      } else if (entry.isTurn && this.#phase === PHASE.IDLE) {
        const hop = Math.abs(Math.sin(t * 4.2 + entry.seed));
        y += hop * 0.24;
        squash = 1 + (hop - 0.5) * 0.1;
      } else {
        y += Math.sin(t * 2.1 + entry.seed) * 0.02;
      }
      if (entry.celebrateAt) {
        const k = (t - entry.celebrateAt) / 1.4;
        if (k < 1) {
          y += Math.sin(k * Math.PI) * 0.9;
          body.rotation.y = k * Math.PI * 2;
        } else {
          entry.celebrateAt = 0;
          body.rotation.y = 0;
        }
      }
      // durante lo spin tutti "guardano su" verso la ruota
      const lookUp = this.#phase === PHASE.SPINNING && entry.connected ? -0.14 : 0;
      body.rotation.x += (lookUp - body.rotation.x) * follow;
      body.rotation.z += (tilt - body.rotation.z) * follow;
      body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      group.position.y = y;

      // anello e alone del turno restano appoggiati al bancone
      const showRing = entry.isTurn && entry.connected;
      entry.ring.visible = showRing;
      entry.glow.visible = showRing;
      if (showRing) {
        const pulse = 0.75 + 0.25 * Math.sin(t * 5);
        entry.ring.material.opacity = pulse;
        entry.glow.material.opacity = 0.55 * pulse;
      }
      entry.ring.position.set(group.position.x, this.surfaceY + 0.01, group.position.z);
      entry.glow.position.set(group.position.x, this.surfaceY + 0.008, group.position.z);

      // ombra di contatto: più piccola e chiara quando il bicchiere è in aria
      const lift = Math.max(0, y - this.surfaceY);
      const k = 1 / (1 + lift * 1.6);
      entry.contact.position.set(group.position.x, this.surfaceY + 0.006, group.position.z + 0.04);
      entry.contact.scale.setScalar(entry.scale * Math.max(0.001, spawn) * (0.75 + 0.25 * k));
      entry.contact.material.opacity = (entry.connected ? 0.7 : 0.35) * k;
    }
  }

  dispose() {
    for (const entry of this.#entries.values()) this.#disposeEntry(entry);
    this.#entries.clear();
    this.#ringGeo.dispose();
    this.#glowTexture.dispose();
    this.#contactTexture.dispose();
    this.#contactGeo.dispose();
  }

  // ------------------------------------------------------------------

  #disposeEntry(entry) {
    entry.avatar.dispose();
    entry.label.material.map.dispose();
    entry.label.material.dispose();
    entry.ring.material.dispose();
    entry.glow.geometry.dispose();
    entry.glow.material.dispose();
    entry.contact.material.dispose();
  }

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
      new THREE.CircleGeometry(0.9, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.#glowTexture, color: player.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    // ombra di contatto sfumata (economica: c'è anche sui telefoni, dove le ombre reali sono spente)
    const contact = new THREE.Mesh(
      this.#contactGeo,
      new THREE.MeshBasicMaterial({ map: this.#contactTexture, color: 0x000000, transparent: true, depthWrite: false }),
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
      target: { x: 0, z: this.frontZ },
      connected: true,
      isTurn: false,
    };
    // il nuovo arrivato nasce già nella sua colonna (niente scivolata dal centro)
    this.#updateLabel(entry, player);
    this.#placeLabel(entry);
    return entry;
  }

  #updateLabel(entry, player) {
    entry.name = player.name;
    entry.color = player.color;
    const canvas = entry.label.material.map.image;
    const ctx = canvas.getContext('2d');
    const fontSize = 44;
    ctx.font = `600 ${fontSize}px ${LABEL_FONT}`;
    const text = player.name.toUpperCase();
    const w = Math.ceil(ctx.measureText(text).width) + 56;
    canvas.width = w;
    canvas.height = 76;
    const c2 = canvas.getContext('2d');
    c2.font = `600 ${fontSize}px ${LABEL_FONT}`;
    c2.fillStyle = 'rgba(10, 13, 20, 0.82)';
    c2.strokeStyle = player.color;
    c2.lineWidth = 4;
    c2.beginPath();
    c2.roundRect(2, 2, w - 4, 72, 36);
    c2.fill();
    c2.stroke();
    c2.fillStyle = '#f4ead5';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(text, w / 2, 40);
    entry.label.material.map.needsUpdate = true;
    const h = 0.26;
    entry.label.scale.set((h * w) / 76, h, 1);
  }

  #placeLabel(entry) {
    entry.label.position.set(0, entry.avatar.height + 0.62, 0);
  }

  #layout() {
    const ids = this.#order.filter((id) => this.#entries.has(id));
    const n = ids.length;
    if (!n) return;
    const usable = Math.max(SPACING, this.#halfWidth * 2 - 0.5);
    const perRow = Math.max(1, Math.floor(usable / SPACING));
    const rows = n <= perRow ? 1 : 2;
    const front = rows === 1 ? n : Math.ceil(n / 2);
    // su due file c'è spazio: le allarghiamo su tutto il bancone (sfalsate, si vedono tutte)
    const spacing = Math.min(rows === 1 ? SPACING : SPACING * 1.7, usable / front);
    const scale = AVATAR_SCALE * Math.min(1, spacing / SPACING);


    ids.forEach((id, i) => {
      const entry = this.#entries.get(id);
      const inFront = rows === 1 || i % 2 === 0; // alternati: i primi arrivati restano davanti
      const indexInRow = rows === 1 ? i : Math.floor(i / 2);
      const rowCount = rows === 1 ? n : inFront ? front : n - front;
      let x = (indexInRow - (rowCount - 1) / 2) * spacing;
      // seconda fila "a quinconce": se ha tanti bicchieri quanti la prima, sfalsiamo di mezzo passo
      if (!inFront && rowCount === front) x += spacing / 2;
      entry.target = { x, z: inFront ? this.frontZ : this.frontZ - ROW_GAP };
      entry.scale = scale;
      if (entry.group.position.lengthSq() === 0) {
        entry.group.position.x = x;
        entry.group.position.z = entry.target.z;
      }
    });
  }
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

