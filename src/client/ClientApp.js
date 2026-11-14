import '../styles/client.css';
import { CONNECTION_TIMEOUT_MS, joinUrl } from '../shared/config.js';
import { MODE, MSG, PHASE, PROTOCOL_VERSION, REJECT_REASON, rejectMessage } from '../shared/protocol.js';
import { clear, fill, h, toast } from '../shared/util/dom.js';
import { keepScreenOn, vibrate } from '../shared/util/device.js';
import { getClientId, save } from '../shared/util/storage.js';
import { sfx } from '../shared/audio/sfx.js';
import { getBeer } from '../shared/avatars/beers.js';
import { beerIcon } from '../shared/ui/beerIcon.js';
import { createTopSlot } from '../shared/ui/topSlot.js';
import { phaseLabel, topSlotRevealMs } from '../shared/game/display.js';
import { openBeerPicker } from './ui/BeerPicker.js';
import { panelFor } from './ui/panels.js';
import { ClientPeer, RoomNotFoundError } from './net/ClientPeer.js';

const WELCOME_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 8000;
const SABOTAGE_DELAY_MS = 1000; // «Sabotaggio»: ritardo su ogni tocco del primo in classifica

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
 * Mostra un pannello per ogni fase di «Spin & Sip» (client/ui/panels.js), il timer della fase,
 * il Top Slot, la classifica e applica i sabotaggi ricevuti dall'host (Blackout, Dito Tremante,
 * Dislessia, Sabotaggio). In Pocket carica on-demand il palco 3D.
 */
export class ClientApp {
  link = null;
  snapshot = null;
  priv = null;
  playerId = null;
  mode = null;
  #stopped = false;
  #retryDelay = 1000;
  #retryTimer = null;
  #lastHostMessage = 0;
  #panel = null;
  #panelKey = null;
  #panelEl = null;
  #ui = {};
  #uiScope = null;
  #stageSync = null;
  #wheelLoading = false;
  #pendingPicker = false;
  #deadline = null;
  #lastPhase = null;

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

    // Timer della fase: aggiornato in locale, senza aspettare messaggi
    this.timerLoop = setInterval(() => this.#updateTimer(), 200);

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

  /** Invio di un'azione di gioco (con il ritardo del «Sabotaggio» se colpiti). */
  send(action) {
    const go = () => this.link?.send({ t: MSG.ACTION, a: action });
    if (this.priv?.sabotage?.delay) setTimeout(go, SABOTAGE_DELAY_MS);
    else go();
  }

  #onMessage(msg) {
    this.#lastHostMessage = performance.now();
    switch (msg.t) {
      case MSG.PING:
        this.link?.send({ t: MSG.PONG, ts: msg.ts });
        break;
      case MSG.WELCOME:
        this.#onWelcome(msg);
        break;
      case MSG.STATE:
        this.#onState(msg.s);
        break;
      case MSG.PRIVATE:
        this.priv = msg.p;
        this.#render();
        break;
      case MSG.SPIN_START:
        this.#stageSync?.playSpin(msg.plan, msg.elapsed, msg.topSlot);
        if (!this.#stageSync && msg.topSlot && !msg.plan.kind) this.topSlot?.spin(msg.topSlot, topSlotRevealMs(msg.plan) - msg.elapsed);
        if (this.mode === MODE.POCKET) sfx.spinStart();
        vibrate(30);
        break;
      case MSG.EVENT:
        this.#onGameEvent(msg.e);
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
      this.#renderShell();
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
    this.#render();

    if (s.phase !== this.#lastPhase) {
      this.#lastPhase = s.phase;
      if (s.phase === PHASE.AWAIT_SPIN && s.turnPlayerId === this.playerId) vibrate([60, 40, 60]);
      if (s.phase === PHASE.BETTING && s.turnPlayerId !== this.playerId) vibrate(25);
      if (s.phase === PHASE.EVENT) vibrate(40);
    }
    if (prev && !prev.turn?.happyHour && s.turn?.happyHour) toast('🟣 HAPPY HOUR! Tappi doppi negli ultimi 3 turni');
    if (this.#pendingPicker && s.phase === PHASE.LOBBY) {
      this.#pendingPicker = false;
      this.#openPicker(true);
    }
  }

  #onGameEvent(e) {
    this.#stageSync?.handleEvent(e);
    switch (e.type) {
      case 'top_slot_hit':
        this.topSlot?.hit();
        if (e.playerId === this.playerId) vibrate([100, 50, 100]);
        break;
      case 'pint':
        if (e.playerId === this.playerId) {
          vibrate([80, 40, 160]);
          sfx.win();
        }
        break;
      case 'award':
        if (e.award.winners.includes(this.playerId)) {
          toast(`${e.award.icon} ${e.award.title}: +1 Pinta d'Oro!`);
          vibrate([80, 40, 160]);
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- UI

  #renderConnecting(text) {
    fill(this.root, 
      h('div', { class: 'screen-center' }, h('div', { class: 'loader' }), h('p', {}, text), h('p', { class: 'muted' }, `Stanza ${this.roomCode}`)),
    );
  }

  #fatal(text, canGoHome = true) {
    this.#stopped = true;
    clearInterval(this.watchdog);
    clearInterval(this.timerLoop);
    clearTimeout(this.#retryTimer);
    this.link?.close();
    fill(this.root, 
      h(
        'div',
        { class: 'screen-center' },
        h('div', { class: 'eyebrow' }, 'Ops'),
        h('p', {}, text),
        canGoHome && h('button', { class: 'btn btn-primary', onclick: () => (location.href = './') }, 'Torna alla home'),
      ),
    );
  }

  #renderShell() {
    this.headerEl = h('header', { class: 'ctl-header' });
    this.statusEl = h('div', { class: 'ctl-status' });
    this.timerEl = h('div', { class: 'ctl-timer' }, h('div', { class: 'ctl-timer-fill' }), h('span', { class: 'ctl-timer-text' }));
    this.playersEl = h('div', { class: 'ctl-players' });
    this.panelHost = h('main', { class: 'ctl-panel' });
    this.reconnectEl = h('div', { class: 'ctl-reconnect' }, h('div', { class: 'loader' }), h('p', {}, 'Riconnessione...'));
    this.topSlot = createTopSlot();
    const pocket = this.mode === MODE.POCKET;
    this.wheelEl = pocket ? h('section', { class: 'ctl-wheel' }, this.topSlot.el) : null;

    this.shellEl = h(
      'div',
      { class: `ctl ${pocket ? 'ctl-pocket' : 'ctl-salotto'}` },
      this.headerEl,
      this.statusEl,
      this.wheelEl,
      pocket ? null : h('div', { class: 'ctl-topslot' }, this.topSlot.el),
      this.timerEl,
      this.panelHost,
      this.playersEl,
      this.reconnectEl,
    );
    fill(this.root, this.shellEl);
    if (pocket) this.#loadWheel();
    if (this.snapshot) this.#onState(this.snapshot);
  }

  /** Pocket: Three.js viene scaricato solo qui (i controller Salotto non lo caricano mai). */
  async #loadWheel() {
    if (this.#wheelLoading) return;
    this.#wheelLoading = true;
    const [{ StageRenderer }, { StageSync }] = await Promise.all([import('../shared/stage/StageRenderer.js'), import('../shared/stage/StageSync.js')]);
    const stage = new StageRenderer(this.wheelEl, { quality: 'low' });
    stage.on('tick', () => sfx.tick());
    this.#stageSync = new StageSync(stage, { topSlot: this.topSlot });
    if (this.snapshot) this.#stageSync.applyState(this.snapshot);
  }

  #openPicker(firstTime = false) {
    if (!this.snapshot || document.querySelector('.modal')) return;
    openBeerPicker({
      players: this.snapshot.players,
      myId: this.playerId,
      firstTime,
      onPick: (beerId) => this.link?.send({ t: MSG.AVATAR_PICK, beerId }),
    });
  }

  #me() {
    return this.snapshot?.players.find((p) => p.id === this.playerId);
  }

  #name(id) {
    return this.snapshot?.players.find((p) => p.id === id)?.name ?? '—';
  }

  /** Ridisegna intestazione, classifica e pannello (quest'ultimo solo se cambia la sua chiave). */
  #render() {
    const s = this.snapshot;
    if (!s || !this.playerId || !this.headerEl) return;
    const me = this.#me();
    if (!me) return;
    const priv = this.priv ?? {};
    const sabotage = priv.sabotage ?? {};

    // sabotaggi sul DOM: scala di grigi e bottoni tremanti
    this.shellEl.classList.toggle('sab-blackout', Boolean(sabotage.blackout));
    this.shellEl.classList.toggle('sab-shaky', Boolean(sabotage.shaky));
    this.shellEl.classList.toggle('sab-delay', Boolean(sabotage.delay));
    document.body.classList.toggle('happy-hour', Boolean(s.turn?.happyHour));
    this.root.style.setProperty('--me', me.color);

    this.#updateHeader(s, me, priv);
    this.#updateStatus(s, sabotage);
    this.#updatePlayers(s);
    this.#updatePanel(s, priv, sabotage);

    // timer: scadenza personale (Fuso Orario) o della fase
    const remaining = priv.deadline ?? s.deadline;
    if (remaining !== null && remaining !== undefined && remaining > 0) {
      const at = performance.now() + remaining;
      const key = `${s.phase}|${s.turn?.number}|${s.event?.stage}`;
      if (!this.#deadline || this.#deadline.key !== key) this.#deadline = { key, at, total: remaining };
      else this.#deadline.at = at;
    } else {
      this.#deadline = null;
    }
    this.#updateTimer();

    // Top Slot visibile su tutti i telefoni durante lancio e risoluzione
    if (this.mode !== MODE.POCKET) {
      if (s.topSlot && [PHASE.LANDING, PHASE.CHOICE, PHASE.EVENT].includes(s.phase)) this.topSlot.show(s.topSlot);
      else if (s.phase !== PHASE.SPINNING) this.topSlot.hide();
    }
  }

  #updateHeader(s, me, priv) {
    const st = priv.status ?? me.status ?? {};
    const badges = [st.shield > 0 && '🛡️', st.anchor > 0 && '⚓', st.mirror > 0 && '🪞', st.skip > 0 && '🕳️'].filter(Boolean).join(' ');
    fill(this.headerEl, 
      h(
        'button',
        { class: 'me', type: 'button', title: 'Cambia birra', onclick: () => s.phase === PHASE.LOBBY && this.#openPicker() },
        beerIcon(me.beer, 'sm'),
        h('span', { class: 'me-text' }, h('span', { class: 'me-name' }, me.name), h('span', { class: 'me-beer' }, `${getBeer(me.beer).name}${s.phase === PHASE.LOBBY ? ' ▾' : ''}${badges ? ` · ${badges}` : ''}`)),
      ),
      h('div', { class: 'wallet' }, h('span', { class: 'pints' }, `🍺 ${priv.pints ?? me.pints ?? 0}`), h('span', { class: 'coins' }, `${priv.coins ?? me.coins ?? 0}`, h('span', { class: 'coin' }))),
      this.isOwner ? h('button', { class: 'btn btn-small', onclick: () => this.#showInvite() }, `+ ${this.roomCode}`) : h('div', { class: 'room-badge' }, this.roomCode),
    );
  }

  #updateStatus(s, sabotage) {
    const turn = s.phase === PHASE.LOBBY || s.phase === PHASE.GAME_OVER ? '' : `Turno ${s.turn.number}/${s.turn.total}`;
    const sab = [sabotage.blackout && '🌑 Blackout', sabotage.shaky && '🫨 Dito Tremante', sabotage.dyslexia && '🔀 Dislessia', sabotage.halfTime && '⏱️ Fuso Orario', sabotage.delay && '🐌 Sabotaggio'].filter(Boolean);
    fill(this.statusEl, 
      h('span', { class: 'status-phase' }, phaseLabel(s, (id) => this.#name(id))),
      turn ? h('span', { class: `status-turn ${s.turn.happyHour ? 'hh' : ''}` }, s.turn.happyHour ? `🟣 HAPPY HOUR · ${turn}` : turn) : null,
      sab.length ? h('span', { class: 'status-sab' }, `Sabotato: ${sab.join(', ')}`) : null,
      s.hidden ? h('span', { class: 'status-hidden' }, '🙈 Classifica nascosta') : null,
    );
  }

  #updatePlayers(s) {
    const ranking = [...s.players].filter((p) => p.connected).sort((a, b) => (b.pints ?? 0) - (a.pints ?? 0) || (b.coins ?? 0) - (a.coins ?? 0));
    fill(this.playersEl, 
      ...ranking.map((p) =>
        h(
          'div',
          { class: `chip ${p.id === s.turnPlayerId ? 'turn' : ''} ${p.id === this.playerId ? 'mine' : ''}`, style: { '--pc': p.color } },
          beerIcon(p.beer, 'xs'),
          p.name,
          h('span', { class: 'chip-score' }, s.hidden ? '🍺? · ?' : `🍺${p.pints} · ${p.coins}`),
          p.betPlaced ? h('span', { class: 'chip-bet' }, '🎲') : null,
        ),
      ),
    );
  }

  #updatePanel(s, priv, sabotage) {
    // stato locale dei pannelli (selezioni, slider) che vive finché resta la stessa fase/evento
    const scope = `${s.phase}|${s.turn?.number}|${s.event?.kind}|${s.event?.stage}`;
    if (scope !== this.#uiScope) {
      this.#uiScope = scope;
      this.#ui = {};
    }
    const ctx = {
      s,
      p: priv,
      meId: this.playerId,
      me: this.#me(),
      isTurn: s.turnPlayerId === this.playerId,
      mode: this.mode,
      sabotage,
      ui: this.#ui,
      name: (id) => this.#name(id),
      player: (id) => s.players.find((p) => p.id === id),
      send: (a) => this.send(a),
      refresh: () => {
        this.#panelKey = null;
        this.#updatePanel(this.snapshot, this.priv ?? {}, this.priv?.sabotage ?? {});
      },
    };
    const panel = panelFor(ctx);
    if (panel.key !== this.#panelKey) {
      this.#panelKey = panel.key;
      this.#panel = panel;
      this.#panelEl = panel.render(ctx);
      fill(this.panelHost, this.#panelEl);
    }
    this.#panel.update?.(this.#panelEl, ctx);
  }

  #updateTimer() {
    if (!this.timerEl) return;
    const d = this.#deadline;
    if (!d) {
      this.timerEl.classList.remove('show');
      return;
    }
    const left = Math.max(0, d.at - performance.now());
    this.timerEl.classList.add('show');
    this.timerEl.classList.toggle('urgent', left < 4000);
    this.timerEl.firstChild.style.transform = `scaleX(${d.total ? Math.min(1, left / d.total) : 0})`;
    this.timerEl.lastChild.textContent = `${Math.ceil(left / 1000)}s`;
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
