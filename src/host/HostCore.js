import { Emitter } from '../shared/Emitter.js';
import { CONNECTION_TIMEOUT_MS, HEARTBEAT_MS } from '../shared/config.js';
import { MSG, PHASE, PROTOCOL_VERSION, REJECT_REASON } from '../shared/protocol.js';
import { SEGMENT_TYPE, segmentInfo } from '../shared/wheel/segments.js';
import { randomInt } from '../shared/util/random.js';
import { HostPeer } from './net/HostPeer.js';
import { GameState } from './state/GameState.js';
import { planSpin, resolveStop } from './physics/WheelPhysics.js';
import { getBeer } from '../shared/avatars/beers.js';

const HELLO_TIMEOUT_MS = 8000;
const RESULT_HOLD_MS = 4500;
const SPIN_SETTLE_MS = 350; // margine per far finire l'animazione sui client prima del risultato
const DISCONNECTED_TURN_GRACE_MS = 8000;

/**
 * Cervello del gioco, headless (nessun DOM): rete, stato, turni, ruota.
 * Viene usato:
 *  - in Salotto dallo schermo TV (HostScreen lo affianca con la grafica)
 *  - in Pocket dal telefono del creatore, che in più è anche un giocatore via LocalLink
 *
 * Eventi: 'state' (snapshot), 'spin' ({plan, playerId}), 'result' (result),
 *         'player-joined' (player, rejoined), 'player-left' (player), 'signaling' (status)
 */
export class HostCore extends Emitter {
  /** @type {Set<{link, playerId:string|null, lastSeen:number, isOwner:boolean, replaced?:boolean, rtt?:number}>} */
  sessions = new Set();
  #timers = new Set();
  #spinSeq = 0;

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
    return this.state.toPublic(performance.now());
  }

  /**
   * Richiesta di girare la ruota con una certa forza (0..1).
   * Accettata solo se siamo in IDLE e chi chiede è di turno.
   * `bypassTurn` (tastiera dello schermo Salotto) salta il controllo del turno: utile per demo/test.
   */
  requestSpin(playerId, force, { bypassTurn = false } = {}) {
    const state = this.state;
    if (state.phase !== PHASE.IDLE) return false;
    if (!bypassTurn && playerId !== state.turnPlayerId) return false;

    const plan = { id: ++this.#spinSeq, ...planSpin(state.wheelAngle, force) };
    const spinner = bypassTurn ? (state.turnPlayerId ?? null) : playerId;
    console.info(
      `[ruota] lancio #${plan.id}: forza ${(plan.force * 100).toFixed(0)}% → ω0 ${plan.omega0.toFixed(2)} rad/s, ` +
        `arresto previsto in ${(plan.duration / 1000).toFixed(2)} s dopo ${(Math.abs(plan.to - plan.from) / (2 * Math.PI)).toFixed(2)} giri`,
    );
    state.startSpin(plan, spinner, performance.now());

    this.broadcast({ t: MSG.SPIN_START, plan, elapsed: 0, playerId: spinner });
    this.#broadcastState();
    this.emit('spin', { plan, playerId: spinner });

    this.#later(() => this.#resolveSpin(), plan.duration + SPIN_SETTLE_MS);
    return true;
  }

  broadcast(msg) {
    for (const session of this.sessions) {
      if (session.playerId) session.link.send(msg);
    }
  }

  stop() {
    clearInterval(this.heartbeat);
    this.#timers.forEach(clearTimeout);
    this.#timers.clear();
    for (const session of this.sessions) session.link.close();
    this.sessions.clear();
    this.net.destroy();
    this.removeAllListeners();
  }

  // ------------------------------------------------------------ connessioni

  #accept(link, { isOwner = false } = {}) {
    const session = { link, playerId: null, lastSeen: performance.now(), isOwner };
    this.sessions.add(session);

    const helloTimer = this.#later(() => {
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
    this.#broadcastState();
    this.emit('player-joined', player, rejoined);
  }

  #onMessage(session, msg) {
    switch (msg.t) {
      case MSG.SPIN_REQUEST:
        this.requestSpin(session.playerId, msg.force);
        break;
      case MSG.AVATAR_PICK: {
        const before = this.state.getPlayer(session.playerId)?.beer;
        const outcome = this.state.setBeer(session.playerId, msg.beerId);
        if (outcome === 'ok' && before !== msg.beerId) {
          console.info(`[birre] ${this.state.getPlayer(session.playerId).name} cambia ${before} → ${msg.beerId} (${before} torna nel pool)`);
        }
        if (outcome === 'taken') session.link.send({ t: MSG.TOAST, text: `${getBeer(msg.beerId).name} è già di un altro giocatore` });
        if (outcome === 'ok') {
          this.#broadcastState();
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
    this.#broadcastState();
    this.emit('player-left', player);

    // Se era il suo turno, gli diamo qualche secondo per rientrare, poi si passa oltre.
    if (player && this.state.turnPlayerId === player.id) {
      this.#later(() => {
        if (!player.connected && this.state.turnPlayerId === player.id && this.state.phase === PHASE.IDLE) {
          this.state.advanceTurn();
          this.#broadcastState();
        }
      }, DISCONNECTED_TURN_GRACE_MS);
    }
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

  // ------------------------------------------------------------ gioco

  #resolveSpin() {
    const state = this.state;
    const { plan, playerId } = state.spin;
    const stop = resolveStop(plan.to, state.segments.length);
    const index = stop.index;

    const segment = state.segments[index];
    const info = segmentInfo(segment);
    const player = state.getPlayer(playerId);
    console.info(
      `[ruota] lancio #${plan.id} FERMO sullo spicchio #${index} → ${info.label}` +
        (player ? ` (lanciato da ${player.name})` : ' (demo)') +
        ` | angolo ruota ${plan.to.toFixed(4)} rad, puntatore a ${stop.pointerLocalDeg.toFixed(2)}° sulla ruota` +
        `, ${(stop.offsetInSegment * 100).toFixed(1)}% dentro lo spicchio${stop.nearEdge ? ' (sul filo!)' : ''}`,
    );
    const result = { spinId: plan.id, segmentIndex: index, type: segment.type, playerId, coinsDelta: 0, text: info.description };

    // Placeholder di risoluzione: i veri eventi (trivia, minigiochi, adesivi) arriveranno nei prossimi step.
    if (segment.type === SEGMENT_TYPE.FORTUNE && player) {
      result.coinsDelta = randomInt(1, 5) * 10;
      player.coins += result.coinsDelta;
      result.text = `${player.name} vince ${result.coinsDelta} monete!`;
    } else if (player) {
      result.text = `${info.label} per ${player.name}! (in arrivo nei prossimi step)`;
    }

    state.finishSpin(result);
    this.broadcast({ t: MSG.SPIN_RESULT, result });
    this.#broadcastState();
    this.emit('result', result);

    this.#later(() => {
      state.backToIdle();
      state.advanceTurn();
      this.#broadcastState();
    }, RESULT_HOLD_MS);
  }

  #broadcastState() {
    const snapshot = this.snapshot();
    this.broadcast({ t: MSG.STATE, s: snapshot });
    this.emit('state', snapshot);
  }

  #later(fn, ms) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      fn();
    }, ms);
    this.#timers.add(timer);
    return timer;
  }
}
