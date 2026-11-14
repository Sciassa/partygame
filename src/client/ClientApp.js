import '../styles/client.css';
import { CONNECTION_TIMEOUT_MS, joinUrl } from '../shared/config.js';
import { MODE, MSG, PHASE, PROTOCOL_VERSION, REJECT_REASON, rejectMessage } from '../shared/protocol.js';
import { clear, h, toast } from '../shared/util/dom.js';
import { keepScreenOn, vibrate } from '../shared/util/device.js';
import { getClientId, save } from '../shared/util/storage.js';
import { sfx } from '../shared/audio/sfx.js';
import { segmentInfo } from '../shared/wheel/segments.js';
import { createSpinPad } from './ui/SpinPad.js';
import { openBeerPicker } from './ui/BeerPicker.js';
import { getBeer } from '../shared/avatars/beers.js';
import { beerIcon } from '../shared/ui/beerIcon.js';
import { ClientPeer, RoomNotFoundError } from './net/ClientPeer.js';

const WELCOME_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 8000;

/** Telefono che entra in una stanza esistente (Salotto o Pocket) tramite WebRTC. */
export function startRemoteClient(root, { roomCode, name }) {
  const peer = new ClientPeer();
  const app = new ClientApp(root, { roomCode, name, connect: () => peer.connect(roomCode), canReconnect: true });
  history.replaceState(null, '', `?room=${roomCode}`);
  app.start();
  return app;
}

/**
 * UI del giocatore sul telefono. Non sa se parla con l'host via WebRTC o in memoria (Pocket owner):
 * riceve una funzione `connect()` che restituisce un Link.
 *
 * In Salotto è un controller leggero (niente Three.js). In Pocket carica on-demand il render 3D
 * della ruota e lo sincronizza con gli eventi dell'host.
 */
export class ClientApp {
  link = null;
  snapshot = null;
  playerId = null;
  mode = null;
  #stopped = false;
  #retryDelay = 1000;
  #retryTimer = null;
  #lastHostMessage = 0;
  #viewKey = null;
  #stageSync = null;
  #wheelLoading = false;
  #spinPad = null;
  #pendingPicker = false;

  constructor(root, { roomCode, name, connect, canReconnect = true, isOwner = false }) {
    this.root = root;
    this.roomCode = roomCode;
    this.name = name;
    this.connectFn = connect;
    this.canReconnect = canReconnect;
    this.isOwner = isOwner;
    this.clientId = getClientId();
  }

  start() {
    keepScreenOn();
    this.#renderConnecting('Connessione alla stanza...');
    this.#connect();

    // Il watchdog chiude la connessione se l'host tace (es. Safari che non segnala la chiusura)
    this.watchdog = setInterval(() => {
      if (this.link && performance.now() - this.#lastHostMessage > CONNECTION_TIMEOUT_MS) this.link.close();
    }, 1000);

    // Tornando sull'app dopo averla messa in background: riconnessione immediata
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.link && !this.#stopped && this.canReconnect) {
        clearTimeout(this.#retryTimer);
        this.#retryDelay = 1000;
        this.#connect();
      }
    });
  }

  // ---------------------------------------------------------------- rete

  async #connect() {
    if (this.#stopped || this.link) return;
    let link;
    try {
      link = await this.connectFn();
    } catch (err) {
      if (err instanceof RoomNotFoundError && !this.playerId) {
        return this.#fatal(`Stanza ${this.roomCode} non trovata. Controlla il codice o chiedi all'host se è ancora aperta.`);
      }
      console.warn('[client] connessione fallita', err);
      return this.#scheduleReconnect();
    }
    if (this.#stopped) return link.close();

    this.link = link;
    this.#lastHostMessage = performance.now();
    link.on('message', (msg) => this.#onMessage(msg));
    link.on('close', () => this.#onLinkClosed(link));
    link.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, clientId: this.clientId, name: this.name });

    this.welcomeTimer = setTimeout(() => {
      if (this.link === link && !this.welcomed) link.close();
    }, WELCOME_TIMEOUT_MS);
  }

  #onLinkClosed(link) {
    if (this.link !== link) return;
    this.link = null;
    this.welcomed = false;
    clearTimeout(this.welcomeTimer);
    if (this.#stopped) return;
    if (!this.canReconnect) return this.#fatal("La partita è terminata: l'host si è disconnesso.");
    this.#showReconnecting(true);
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.#stopped || !this.canReconnect) return;
    if (!this.playerId) this.#renderConnecting('Non riesco a collegarmi, riprovo...');
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => this.#connect(), this.#retryDelay);
    this.#retryDelay = Math.min(this.#retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  #send(msg) {
    this.link?.send(msg);
  }

  #onMessage(msg) {
    this.#lastHostMessage = performance.now();
    switch (msg.t) {
      case MSG.PING:
        this.#send({ t: MSG.PONG, ts: msg.ts });
        break;
      case MSG.WELCOME:
        this.#onWelcome(msg);
        break;
      case MSG.STATE:
        this.#onState(msg.s);
        break;
      case MSG.SPIN_START:
        this.#stageSync?.playSpin(msg.plan, msg.elapsed);
        if (this.mode === MODE.POCKET) sfx.spinStart();
        vibrate(30);
        break;
      case MSG.SPIN_RESULT:
        vibrate(msg.result.playerId === this.playerId ? [80, 50, 120] : 60);
        break;
      case MSG.TOAST:
        toast(msg.text);
        break;
      case MSG.REJECT:
        this.#stopped = true;
        this.#fatal(rejectMessage(msg.reason), msg.reason !== REJECT_REASON.REPLACED);
        break;
      default:
        break;
    }
  }

  #onWelcome(msg) {
    this.welcomed = true;
    clearTimeout(this.welcomeTimer);
    const firstTime = !this.playerId;
    this.playerId = msg.playerId;
    this.mode = msg.mode;
    this.roomCode = msg.roomCode;
    this.#retryDelay = 1000;
    // Ricordiamo la sessione: ricaricando la pagina (o riaprendo la PWA) si rientra da soli
    if (this.canReconnect) save('ruota.session', { roomCode: this.roomCode, name: this.name, at: Date.now() });
    if (firstTime) {
      this.#renderPlay();
      sfx.join();
      // Primo ingresso: l'host ci ha servito una birra a caso, proponiamo di cambiarla
      if (!msg.rejoined) this.#pendingPicker = true;
    }
    this.#showReconnecting(false);
  }

  #onState(s) {
    const prev = this.snapshot;
    this.snapshot = s;
    if (!this.playerId) return;
    this.#stageSync?.applyState(s);
    this.#updateHeader();
    this.#updatePlayers();
    this.#updatePanel();
    if (this.#pendingPicker) {
      this.#pendingPicker = false;
      this.#openPicker(true);
    }

    const myTurnNow = s.phase === PHASE.IDLE && s.turnPlayerId === this.playerId;
    const myTurnBefore = prev && prev.phase === PHASE.IDLE && prev.turnPlayerId === this.playerId;
    if (myTurnNow && !myTurnBefore) vibrate([60, 40, 60]);
  }

  // ---------------------------------------------------------------- UI

  #renderConnecting(text) {
    clear(this.root).append(
      h('div', { class: 'screen-center' }, h('div', { class: 'loader' }), h('p', {}, text), h('p', { class: 'muted' }, `Stanza ${this.roomCode}`)),
    );
  }

  #fatal(text, canGoHome = true) {
    this.#stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.#retryTimer);
    this.link?.close();
    clear(this.root).append(
      h(
        'div',
        { class: 'screen-center' },
        h('div', { class: 'eyebrow' }, 'Ops'),
        h('p', {}, text),
        canGoHome && h('button', { class: 'btn btn-primary', onclick: () => (location.href = './') }, 'Torna alla home'),
      ),
    );
  }

  #renderPlay() {
    this.headerEl = h('header', { class: 'ctl-header' });
    this.playersEl = h('div', { class: 'ctl-players' });
    this.panelEl = h('main', { class: 'ctl-panel' });
    this.reconnectEl = h('div', { class: 'ctl-reconnect' }, h('div', { class: 'loader' }), h('p', {}, 'Riconnessione...'));
    const pocket = this.mode === MODE.POCKET;
    this.wheelEl = pocket ? h('section', { class: 'ctl-wheel' }) : null;

    clear(this.root).append(
      h('div', { class: `ctl ${pocket ? 'ctl-pocket' : 'ctl-salotto'}` }, this.headerEl, this.wheelEl, this.panelEl, this.playersEl, this.reconnectEl),
    );
    if (pocket) this.#loadWheel();
    if (this.snapshot) this.#onState(this.snapshot);
  }

  /** Pocket: Three.js viene scaricato solo qui (i controller Salotto non lo caricano mai). */
  async #loadWheel() {
    if (this.#wheelLoading) return;
    this.#wheelLoading = true;
    const [{ StageRenderer }, { StageSync }] = await Promise.all([
      import('../shared/stage/StageRenderer.js'),
      import('../shared/stage/StageSync.js'),
    ]);
    const stage = new StageRenderer(this.wheelEl, { quality: 'low' });
    stage.on('tick', () => sfx.tick());
    this.#stageSync = new StageSync(stage);
    if (this.snapshot) this.#stageSync.applyState(this.snapshot);
  }

  #openPicker(firstTime = false) {
    if (!this.snapshot || document.querySelector('.modal')) return;
    openBeerPicker({
      players: this.snapshot.players,
      myId: this.playerId,
      firstTime,
      onPick: (beerId) => this.#send({ t: MSG.AVATAR_PICK, beerId }),
    });
  }

  #me() {
    return this.snapshot?.players.find((p) => p.id === this.playerId);
  }

  #updateHeader() {
    const me = this.#me();
    if (!me) return;
    this.root.style.setProperty('--me', me.color);
    clear(this.headerEl).append(
      h(
        'button',
        { class: 'me', type: 'button', title: 'Cambia birra', onclick: () => this.#openPicker() },
        beerIcon(me.beer, 'sm'),
        h('span', { class: 'me-text' }, h('span', { class: 'me-name' }, me.name), h('span', { class: 'me-beer' }, `${getBeer(me.beer).name} ▾`)),
      ),
      h('div', { class: 'coins' }, `${me.coins}`, h('span', { class: 'coin' })),
      this.isOwner
        ? h('button', { class: 'btn btn-small', onclick: () => this.#showInvite() }, `+ ${this.roomCode}`)
        : h('div', { class: 'room-badge' }, this.roomCode),
    );
  }

  #updatePlayers() {
    const s = this.snapshot;
    clear(this.playersEl).append(
      ...s.players.map((p) =>
        h(
          'div',
          { class: `chip ${p.connected ? '' : 'offline'} ${p.id === s.turnPlayerId ? 'turn' : ''}`, style: { '--pc': p.color } },
          beerIcon(p.beer, 'xs'),
          `${p.name} · ${p.coins}`,
        ),
      ),
    );
  }

  #updatePanel() {
    const s = this.snapshot;
    const myTurn = s.turnPlayerId === this.playerId;
    const key = `${s.phase}|${myTurn}|${s.turnPlayerId}|${s.lastResult?.spinId ?? ''}`;
    if (key === this.#viewKey) return;
    this.#viewKey = key;
    this.#spinPad?.destroy();
    this.#spinPad = null;

    const turnPlayer = s.players.find((p) => p.id === s.turnPlayerId);
    const lookAt = this.mode === MODE.SALOTTO ? 'Guarda lo schermo' : 'Guarda la ruota';
    let content;

    if (s.phase === PHASE.IDLE && myTurn) {
      this.#spinPad = createSpinPad({
        onSpin: (force) => {
          // Il payload è solo la forza del lancio: fisica ed esito li calcola l'host
          this.#send({ t: MSG.SPIN_REQUEST, force });
          // Se l'host ignora la richiesta (turno cambiato nel frattempo) il pad torna attivo
          setTimeout(() => {
            if (this.#viewKey === key) {
              this.#viewKey = null;
              this.#updatePanel();
            }
          }, 3000);
        },
      });
      content = [h('div', { class: 'eyebrow' }, 'Tocca a te'), this.#spinPad];
    } else if (s.phase === PHASE.IDLE) {
      content = [
        turnPlayer ? beerIcon(turnPlayer.beer, 'xl') : null,
        h('div', { class: 'eyebrow' }, 'Turno di'),
        h('h2', { class: 'panel-title' }, turnPlayer ? h('span', { style: { color: turnPlayer.color } }, turnPlayer.name) : 'In attesa di giocatori'),
        h('p', { class: 'muted' }, 'Preparati, il prossimo potresti essere tu.'),
      ];
    } else if (s.phase === PHASE.SPINNING) {
      content = [
        h('div', { class: 'spinner-ring' }),
        h('h2', { class: 'panel-title' }, myTurn ? 'Hai lanciato' : 'La ruota gira'),
        h('p', { class: 'muted' }, lookAt),
      ];
    } else if (s.phase === PHASE.RESULT && s.lastResult) {
      const info = segmentInfo(s.wheel.segments[s.lastResult.segmentIndex]);
      const mine = s.lastResult.playerId === this.playerId;
      content = [
        h(
          'div',
          { class: 'result-card', style: { '--sc': info.glow } },
          h('div', { class: 'eyebrow' }, 'La ruota ha deciso'),
          h('div', { class: 'result-label' }, info.label),
          h('div', { class: 'result-text' }, s.lastResult.text),
          mine && s.lastResult.coinsDelta ? h('div', { class: 'result-coins' }, `+${s.lastResult.coinsDelta}`, h('span', { class: 'coin coin-lg' })) : null,
        ),
      ];
    } else {
      content = [h('p', { class: 'muted' }, '...')];
    }
    clear(this.panelEl).append(...content);
  }

  #showReconnecting(show) {
    this.reconnectEl?.classList.toggle('show', show);
  }

  /** Pocket owner: invita gli amici (Web Share sui telefoni, altrimenti QR + codice). */
  async #showInvite() {
    const url = joinUrl(this.roomCode);
    const { default: QRCode } = await import('qrcode');
    const canvas = h('canvas', { class: 'qr' });
    QRCode.toCanvas(canvas, url, { margin: 1, width: 220, color: { dark: '#0a0e17', light: '#f4ead5' } });
    const close = () => modal.remove();
    const modal = h(
      'div',
      { class: 'modal', onclick: (e) => e.target === modal && close() },
      h(
        'div',
        { class: 'modal-card' },
        h('h2', {}, 'Invita amici'),
        canvas,
        h('div', { class: 'room-code' }, this.roomCode),
        navigator.share
          ? h('button', { class: 'btn btn-primary', onclick: () => navigator.share({ title: 'Ruota Party', text: `Entra nella stanza ${this.roomCode}!`, url }).catch(() => {}) }, 'Condividi link')
          : h('button', { class: 'btn btn-primary', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Link copiato!')) }, 'Copia link'),
        h('button', { class: 'btn btn-ghost', onclick: close }, 'Chiudi'),
      ),
    );
    document.body.append(modal);
  }
}
