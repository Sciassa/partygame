import { Emitter } from '../shared/Emitter.js';
import { CONNECTION_TIMEOUT_MS, HEARTBEAT_MS } from '../shared/config.js';
import { MSG, PHASE, PROTOCOL_VERSION, REJECT_REASON } from '../shared/protocol.js';
import { segmentIndexAt } from '../shared/wheel/kinematics.js';
import { SEGMENT_TYPE, segmentInfo } from '../shared/wheel/segments.js';
import { randomInt } from '../shared/util/random.js';
import { HostPeer } from './net/HostPeer.js';
import { GameState } from './state/GameState.js';
import { planSpin } from './physics/WheelPhysics.js';

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
   * Richiesta di girare la ruota. Accettata solo se siamo in IDLE e chi chiede è di turno.
   * `force` (tastiera dello schermo Salotto) bypassa il controllo del turno: utile per demo/test.
   */
  requestSpin(playerId, power, { force = false } = {}) {
    const state = this.state;
    if (state.phase !== PHASE.IDLE) return false;
    if (!force && playerId !== state.turnPlayerId) return false;

    const plan = { id: ++this.#spinSeq, ...planSpin(state.wheelAngle, power, state.segments.length) };
    const spinner = force ? (state.turnPlayerId ?? null) : playerId;
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
    if (!existing && state.isFull()) return this.#reject(link, REJECT_REASON.ROOM_FULL);

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
    link.send({ t: MSG.WELCOME, playerId: player.id, mode: this.mode, roomCode: state.roomCode });
    this.#broadcastState();
    this.emit('player-joined', player, rejoined);
  }

  #onMessage(session, msg) {
    switch (msg.t) {
      case MSG.SPIN_REQUEST:
        this.requestSpin(session.playerId, msg.power);
        break;
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

    const player = this.state.setConnected(session.playerId, false);
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
    const index = segmentIndexAt(plan.to, state.segments.length);
    if (index !== plan.targetIndex) console.error('[host] spin atterrato su uno spicchio inatteso', index, plan);

    const segment = state.segments[index];
    const info = segmentInfo(segment);
    const player = state.getPlayer(playerId);
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
