import QRCode from 'qrcode';
import '../../styles/host.css';
import { joinUrl } from '../../shared/config.js';
import { MODE, PHASE } from '../../shared/protocol.js';
import { clear, h, toast } from '../../shared/util/dom.js';
import { keepScreenOn } from '../../shared/util/device.js';
import { sfx } from '../../shared/audio/sfx.js';
import { WheelRenderer } from '../../shared/wheel/WheelRenderer.js';
import { WheelSync } from '../../shared/wheel/WheelSync.js';
import { segmentInfo } from '../../shared/wheel/segments.js';
import { randomFloat } from '../../shared/util/random.js';
import { HostCore } from '../HostCore.js';

/**
 * Modalità SALOTTO: questo dispositivo (PC/TV/tablet) è l'host e lo schermo principale.
 * Mostra la ruota 3D, il QR per entrare e la lista giocatori. I telefoni sono solo controller.
 *
 * Tastiera (debug/demo): SPAZIO = gira la ruota per il giocatore di turno, F = fullscreen.
 */
export async function startSalotto(root) {
  clear(root);
  root.append(h('div', { class: 'screen-center' }, h('div', { class: 'loader' }), h('p', {}, 'Creo la stanza...')));

  const core = new HostCore({ mode: MODE.SALOTTO });
  let roomCode;
  try {
    roomCode = await core.start();
  } catch (err) {
    console.error(err);
    clear(root).append(
      h(
        'div',
        { class: 'screen-center' },
        h('h2', {}, 'Impossibile creare la stanza'),
        h('p', { class: 'muted' }, 'Controlla la connessione e riprova.'),
        h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Riprova'),
      ),
    );
    return;
  }

  keepScreenOn();
  new HostScreen(root, core, roomCode);
}

class HostScreen {
  constructor(root, core, roomCode) {
    this.core = core;
    this.roomCode = roomCode;

    const url = joinUrl(roomCode);
    this.qrCanvas = h('canvas', { class: 'qr', 'aria-label': `QR code per entrare: ${url}` });
    QRCode.toCanvas(this.qrCanvas, url, { margin: 1, width: 240, color: { dark: '#0b0420', light: '#ffffff' } });

    this.wheelEl = h('div', { class: 'host-wheel' });
    this.playersEl = h('ul', { class: 'player-list' });
    this.bannerEl = h('div', { class: 'host-banner' });
    this.resultEl = h('div', { class: 'result-pop', 'aria-live': 'polite' });
    this.signalEl = h('div', { class: 'signal-dot online', title: 'Signaling server' });

    clear(root).append(
      h(
        'div',
        { class: 'host-screen' },
        h('div', { class: 'host-stage' }, this.wheelEl, this.bannerEl, this.resultEl),
        h(
          'aside',
          { class: 'host-panel' },
          h(
            'div',
            { class: 'room-card' },
            h('div', { class: 'room-card-title' }, 'Entra col telefono'),
            this.qrCanvas,
            h('div', { class: 'room-code', 'aria-label': 'Codice stanza' }, roomCode),
            h('div', { class: 'room-url' }, url.replace(/^https?:\/\//, '')),
          ),
          h('h3', { class: 'panel-title' }, 'Giocatori'),
          this.playersEl,
          h('div', { class: 'host-hint' }, this.signalEl, h('span', {}, 'SPAZIO = gira · F = schermo intero')),
        ),
      ),
    );

    this.wheel = new WheelRenderer(this.wheelEl, { quality: 'high' });
    this.sync = new WheelSync(this.wheel);
    this.wheel.on('tick', () => sfx.tick());

    core.on('state', (s) => this.render(s));
    core.on('spin', ({ plan }) => {
      this.hideResult();
      this.sync.playSpin(plan, 0);
      sfx.spinStart();
    });
    core.on('result', (result) => this.showResult(result));
    core.on('player-joined', (player, rejoined) => {
      sfx.join();
      toast(rejoined ? `${player.name} è rientrato` : `${player.name} è entrato!`);
    });
    core.on('player-left', (player) => player && toast(`${player.name} si è disconnesso`));
    core.on('signaling', (status) => {
      this.signalEl.className = `signal-dot ${status}`;
      if (status === 'reconnecting') toast('Connessione al server persa, riprovo... (chi è dentro continua a giocare)');
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const s = core.snapshot();
        core.requestSpin(s.turnPlayerId, 0.4 + randomFloat() * 0.6, { force: true });
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
    });

    this.render(core.snapshot());
  }

  render(s) {
    this.sync.applyState(s);

    const turnPlayer = s.players.find((p) => p.id === s.turnPlayerId);
    clear(this.playersEl).append(
      ...s.players.map((p) =>
        h(
          'li',
          { class: `player ${p.connected ? '' : 'offline'} ${p.id === s.turnPlayerId ? 'turn' : ''}`, style: { '--pc': p.color } },
          h('span', { class: 'player-dot' }),
          h('span', { class: 'player-name' }, p.name),
          h('span', { class: 'player-coins' }, `🪙 ${p.coins}`),
        ),
      ),
    );
    if (!s.players.length) this.playersEl.append(h('li', { class: 'player empty' }, 'In attesa di giocatori...'));

    let banner = '';
    if (s.phase === PHASE.SPINNING) banner = 'La ruota gira...';
    else if (s.phase === PHASE.IDLE && turnPlayer) banner = `Tocca a ${turnPlayer.name}: swipa sul telefono!`;
    else if (s.phase === PHASE.IDLE) banner = 'Scansiona il QR per entrare · SPAZIO per una demo';
    this.bannerEl.textContent = banner;
    this.bannerEl.style.setProperty('--pc', turnPlayer?.color ?? '#ffffff');
    this.bannerEl.classList.toggle('hidden', !banner);

    if (s.phase === PHASE.IDLE) this.hideResult();
  }

  showResult(result) {
    const segment = this.core.snapshot().wheel.segments[result.segmentIndex];
    const info = segmentInfo(segment);
    sfx.win();
    clear(this.resultEl).append(
      h('div', { class: 'result-emoji' }, info.emoji),
      h('div', { class: 'result-label' }, info.label),
      h('div', { class: 'result-text' }, result.text),
    );
    this.resultEl.style.setProperty('--sc', info.color);
    this.resultEl.classList.add('show');
  }

  hideResult() {
    this.resultEl.classList.remove('show');
  }
}
