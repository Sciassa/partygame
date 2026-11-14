import { Emitter } from '../shared/Emitter.js';
import { CONNECTION_TIMEOUT_MS, HEARTBEAT_MS } from '../shared/config.js';
import { MSG, PROTOCOL_VERSION, REJECT_REASON } from '../shared/protocol.js';
import { randomFloat } from '../shared/util/random.js';
import { getBeer } from '../shared/avatars/beers.js';
import { HostPeer } from './net/HostPeer.js';
import { GameState } from './state/GameState.js';
import { GameEngine } from './game/GameEngine.js';

const HELLO_TIMEOUT_MS = 8000;
/** Ogni quanto, al massimo, ritrasmettiamo lo stato (i timer dei telefoni si aggiornano localmente). */
const STATE_THROTTLE_MS = 60;

/**
 * Lato rete dell'host: connessioni, heartbeat, birre. Le regole di gioco stanno nel GameEngine.
 * Usato:
 *  - in Salotto dallo schermo TV (HostScreen lo affianca con la grafica)
 *  - in Pocket dal telefono del creatore, che in più è anche un giocatore via LocalLink
 *
 * A ogni cambiamento del motore manda:
 *  - a tutti lo snapshot pubblico (MSG.STATE)
 *  - a ciascuno i suoi dati privati (MSG.PRIVATE): parola dell'impostore, negozio, Tappi veri a
 *    classifica nascosta, timer personale e sabotaggi.
 *
 * Eventi locali: 'state' (snapshot), 'game-event' (spin, premi, toast...), 'player-joined',
 *                'player-left', 'avatar-changed', 'signaling'
 */
export class HostCore extends Emitter {
  /** @type {Set<{link, playerId:string|null, lastSeen:number, isOwner:boolean, replaced?:boolean, rtt?:number}>} */
  sessions = new Set();
  #stateTimer = null;
  #lastStateAt = 0;

  constructor({ mode }) {
    super();
    this.mode = mode;
    this.net = new HostPeer();
    this.net.on('signaling', (status) => this.emit('signaling', status));
    this.net.on('link', (link) => this.#accept(link));
  }

  async start() {
    const roomCode = await this.net.start();
    this.state = new GameState({ mode: this.mode, roomCode });
    this.engine = new GameEngine(this.state, {
      mode: this.mode,
      rng: randomFloat, // random crittografico: nessun client può prevedere esiti e Top Slot
      speed: new URLSearchParams(location.search).get('speed'), // solo per test: ?speed=4
      onChange: () => this.#scheduleState(),
      onEvent: (event) => this.#onGameEvent(event),
    });
    this.heartbeat = setInterval(() => this.#heartbeat(), HEARTBEAT_MS);
    return roomCode;
  }

  get roomCode() {
    return this.state?.roomCode;
  }

  /** Pocket: collega il giocatore locale (il creatore della stanza) senza passare dalla rete. */
  attachLocal(link) {
    this.#accept(link, { isOwner: true });
  }

  snapshot() {
    return this.engine.snapshot();
  }

  /** Azioni dallo schermo TV: avvio partita, impostazioni, lancio di prova (SPAZIO). */
  hostAction(action) {
    return this.engine.hostAction(action);
  }

  broadcast(msg) {
    for (const session of this.sessions) {
      if (session.playerId) session.link.send(msg);
    }
  }

  stop() {
    clearInterval(this.heartbeat);
    clearTimeout(this.#stateTimer);
    this.engine?.stop();
    for (const session of this.sessions) session.link.close();
    this.sessions.clear();
    this.net.destroy();
    this.removeAllListeners();
  }

  // ------------------------------------------------------------ connessioni

  #accept(link, { isOwner = false } = {}) {
    const session = { link, playerId: null, lastSeen: performance.now(), isOwner };
    this.sessions.add(session);

    const helloTimer = setTimeout(() => {
      if (!session.playerId) link.close();
    }, HELLO_TIMEOUT_MS);

    link.on('message', (msg) => {
      session.lastSeen = performance.now();
      if (!session.playerId) {
        if (msg.t === MSG.HELLO) {
          clearTimeout(helloTimer);
          this.#onHello(session, msg);
        }
        return;
      }
      this.#onMessage(session, msg);
    });
    link.on('close', () => this.#onClose(session));
  }

  #onHello(session, msg) {
    const { link } = session;
    const state = this.state;
    if (msg.v !== PROTOCOL_VERSION) return this.#reject(link, REJECT_REASON.VERSION);
    if (typeof msg.clientId !== 'string' || msg.clientId.length < 4 || msg.clientId.length > 64) {
      return this.#reject(link, REJECT_REASON.BAD_HELLO);
    }

    const existing = state.findByClientId(msg.clientId);
    // Piena = 12 connessi. Chi rientra dopo una disconnessione ha bisogno di una birra dal pool come un nuovo.
    if ((!existing || !existing.connected) && state.isFull()) return this.#reject(link, REJECT_REASON.ROOM_FULL);

    // Stesso giocatore che rientra mentre la vecchia connessione è ancora "appesa": la sostituiamo.
    if (existing) {
      for (const other of this.sessions) {
        if (other !== session && other.playerId === existing.id) {
          other.replaced = true;
          other.link.send({ t: MSG.REJECT, reason: REJECT_REASON.REPLACED });
          other.link.close();
        }
      }
    }

    const { player, rejoined } = state.joinPlayer(msg.clientId, msg.name, { isOwner: session.isOwner });
    session.playerId = player.id;
    console.info(`[birre] ${player.name} ${rejoined ? 'rientra' : 'entra'} con ${player.beer} (${state.beerPool.length} libere)`);
    link.send({ t: MSG.WELCOME, playerId: player.id, mode: this.mode, roomCode: state.roomCode, rejoined });
    this.engine.onPlayerJoined(player);
    this.#sendStateNow();
    this.emit('player-joined', player, rejoined);
  }

  #onMessage(session, msg) {
    switch (msg.t) {
      case MSG.SPIN_REQUEST:
        this.engine.handleAction(session.playerId, { kind: 'spin', force: msg.force });
        break;
      case MSG.ACTION:
        if (msg.a && typeof msg.a === 'object') this.engine.handleAction(session.playerId, msg.a);
        break;
      case MSG.AVATAR_PICK: {
        const before = this.state.getPlayer(session.playerId)?.beer;
        const outcome = this.state.setBeer(session.playerId, msg.beerId);
        if (outcome === 'ok' && before !== msg.beerId) {
          console.info(`[birre] ${this.state.getPlayer(session.playerId).name} cambia ${before} → ${msg.beerId} (${before} torna nel pool)`);
          // gli adesivi già incollati prendono il nuovo colore del proprietario
          for (const seg of this.state.segments) if (seg.sticker?.ownerId === session.playerId) seg.sticker.ownerColor = this.state.getPlayer(session.playerId).color;
        }
        if (outcome === 'taken') session.link.send({ t: MSG.TOAST, text: `${getBeer(msg.beerId).name} è già di un altro giocatore` });
        if (outcome === 'ok') {
          this.#scheduleState();
          this.emit('avatar-changed', this.state.getPlayer(session.playerId));
        }
        break;
      }
      case MSG.PONG:
        if (typeof msg.ts === 'number') session.rtt = performance.now() - msg.ts;
        break;
      default:
        break;
    }
  }

  #onClose(session) {
    if (!this.sessions.delete(session)) return;
    if (!session.playerId || session.replaced) return;
    const stillConnected = [...this.sessions].some((s) => s.playerId === session.playerId);
    if (stillConnected) return;

    // La birra del giocatore torna nel pool: potrà essere assegnata a chi entra dopo
    const player = this.state.disconnectPlayer(session.playerId);
    if (player) console.info(`[birre] ${player.name} disconnesso: ${player.lastBeer} torna nel pool (${this.state.beerPool.length} libere)`);
    this.engine.onPlayerLeft(player);
    this.emit('player-left', player);
  }

  #reject(link, reason) {
    link.send({ t: MSG.REJECT, reason });
    setTimeout(() => link.close(), 300);
  }

  #heartbeat() {
    const now = performance.now();
    for (const session of this.sessions) {
      if (now - session.lastSeen > CONNECTION_TIMEOUT_MS) {
        session.link.close(); // -> #onClose
      } else {
        session.link.send({ t: MSG.PING, ts: now });
      }
    }
  }

  // ------------------------------------------------------------ stato ed eventi

  /** Accorpa le modifiche ravvicinate (un award dopo l'altro) in un solo invio. */
  #scheduleState() {
    if (this.#stateTimer) return;
    const wait = Math.max(0, STATE_THROTTLE_MS - (performance.now() - this.#lastStateAt));
    this.#stateTimer = setTimeout(() => this.#sendStateNow(), wait);
  }

  #sendStateNow() {
    clearTimeout(this.#stateTimer);
    this.#stateTimer = null;
    this.#lastStateAt = performance.now();
    const snapshot = this.engine.snapshot();
    for (const session of this.sessions) {
      if (!session.playerId) continue;
      session.link.send({ t: MSG.STATE, s: snapshot });
      session.link.send({ t: MSG.PRIVATE, p: this.engine.privateFor(session.playerId) });
    }
    this.emit('state', snapshot);
  }

  #onGameEvent(event) {
    if (event.type === 'toast' && event.to) {
      for (const session of this.sessions) if (session.playerId === event.to) session.link.send({ t: MSG.TOAST, text: event.text });
      return;
    }
    if (event.type === 'spin') {
      // lo stato aggiornato parte subito, così il Top Slot è già nello snapshot
      this.#sendStateNow();
      this.broadcast({ t: MSG.SPIN_START, plan: event.plan, elapsed: 0, playerId: event.playerId, topSlot: event.topSlot });
    } else {
      this.broadcast({ t: MSG.EVENT, e: event });
    }
    this.emit('game-event', event);
  }
}
