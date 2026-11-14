import { MAX_NAME_LENGTH, MAX_PLAYERS } from '../../shared/config.js';
import { PHASE } from '../../shared/protocol.js';
import { createBaseSegments } from '../../shared/wheel/segments.js';
import { TAU, mod } from '../../shared/wheel/kinematics.js';
import { BEERS, getBeer, isBeerId } from '../../shared/avatars/beers.js';
import { randomInt } from '../../shared/util/random.js';

const STARTING_COINS = 100;

/**
 * Stato autoritativo della partita (vive SOLO sull'host).
 * Contiene anche dati privati (clientId) che non escono mai: ai client va toPublic().
 */
export class GameState {
  constructor({ mode, roomCode }) {
    this.mode = mode;
    this.roomCode = roomCode;
    this.phase = PHASE.IDLE;
    /** @type {Array<{id:string, clientId:string, name:string, beer:string, color:string, coins:number, connected:boolean, isOwner:boolean}>} */
    this.players = [];
    this.turnPlayerId = null;
    this.segments = createBaseSegments();
    this.wheelAngle = 0;
    this.spin = null; // { plan, startedAt (performance.now dell'host), playerId }
    this.lastResult = null;
    this.nextPlayerNumber = 1;
  }

  // ------------------------------------------------------------ giocatori

  findByClientId(clientId) {
    return this.players.find((p) => p.clientId === clientId) ?? null;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  isFull() {
    return this.players.length >= MAX_PLAYERS;
  }

  /** Nuovo giocatore oppure rientro di uno esistente (stesso clientId). */
  joinPlayer(clientId, rawName, { isOwner = false } = {}) {
    let player = this.findByClientId(clientId);
    const name = this.#uniqueName(sanitizeName(rawName) || `Giocatore ${this.nextPlayerNumber}`, player?.id);
    if (player) {
      player.name = name;
      player.connected = true;
      return { player, rejoined: true };
    }
    const n = this.nextPlayerNumber++;
    const beer = this.#randomFreeBeer();
    player = {
      id: `p${n}`,
      clientId,
      name,
      beer: beer.id,
      color: beer.accent, // il colore del giocatore è quello della sua birra
      coins: STARTING_COINS,
      connected: true,
      isOwner,
    };
    this.players.push(player);
    if (!this.turnPlayerId) this.turnPlayerId = player.id;
    return { player, rejoined: false };
  }

  setConnected(playerId, connected) {
    const player = this.getPlayer(playerId);
    if (player) player.connected = connected;
    return player;
  }

  /** Birre non ancora prese da nessuno (anche da giocatori momentaneamente disconnessi). */
  freeBeers() {
    const taken = new Set(this.players.map((p) => p.beer));
    return BEERS.filter((b) => !taken.has(b.id));
  }

  /**
   * Cambio birra richiesto dal giocatore. Ogni birra è unica nella stanza.
   * @returns {'ok'|'invalid'|'taken'}
   */
  setBeer(playerId, beerId) {
    const player = this.getPlayer(playerId);
    if (!player || !isBeerId(beerId)) return 'invalid';
    if (player.beer === beerId) return 'ok';
    if (this.players.some((p) => p.id !== playerId && p.beer === beerId)) return 'taken';
    player.beer = beerId;
    player.color = getBeer(beerId).accent;
    return 'ok';
  }

  #randomFreeBeer() {
    const free = this.freeBeers();
    // MAX_PLAYERS === BEERS.length, quindi c'è sempre una birra libera
    return free.length ? free[randomInt(0, free.length - 1)] : BEERS[randomInt(0, BEERS.length - 1)];
  }

  connectedPlayers() {
    return this.players.filter((p) => p.connected);
  }

  // ------------------------------------------------------------ turni

  /** Passa al prossimo giocatore connesso (in ordine di arrivo). */
  advanceTurn() {
    if (!this.players.length) {
      this.turnPlayerId = null;
      return null;
    }
    const start = Math.max(0, this.players.findIndex((p) => p.id === this.turnPlayerId));
    for (let step = 1; step <= this.players.length; step++) {
      const candidate = this.players[(start + step) % this.players.length];
      if (candidate.connected) {
        this.turnPlayerId = candidate.id;
        return candidate;
      }
    }
    return this.getPlayer(this.turnPlayerId);
  }

  // ------------------------------------------------------------ ruota

  startSpin(plan, playerId, now) {
    this.phase = PHASE.SPINNING;
    this.spin = { plan, startedAt: now, playerId };
    this.lastResult = null;
  }

  finishSpin(result) {
    this.wheelAngle = mod(this.spin.plan.to, TAU);
    this.spin = null;
    this.phase = PHASE.RESULT;
    this.lastResult = result;
  }

  backToIdle() {
    this.phase = PHASE.IDLE;
  }

  // ------------------------------------------------------------ serializzazione

  toPublic(now) {
    return {
      mode: this.mode,
      roomCode: this.roomCode,
      phase: this.phase,
      players: this.players.map(({ clientId: _secret, ...pub }) => pub),
      turnPlayerId: this.turnPlayerId,
      wheel: { segments: this.segments, angle: this.wheelAngle },
      spin: this.spin ? { plan: this.spin.plan, elapsed: now - this.spin.startedAt, playerId: this.spin.playerId } : null,
      lastResult: this.lastResult,
    };
  }

  #uniqueName(name, ownId) {
    const taken = new Set(this.players.filter((p) => p.id !== ownId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, MAX_NAME_LENGTH - 2)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
}

export function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
