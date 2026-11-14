import QRCode from 'qrcode';
import '../../styles/host.css';
import { joinUrl } from '../../shared/config.js';
import { MODE, PHASE } from '../../shared/protocol.js';
import { clear, h, toast } from '../../shared/util/dom.js';
import { keepScreenOn } from '../../shared/util/device.js';
import { sfx } from '../../shared/audio/sfx.js';
import { StageRenderer } from '../../shared/stage/StageRenderer.js';
import { StageSync } from '../../shared/stage/StageSync.js';
import { segmentInfo } from '../../shared/wheel/segments.js';
import { getBeer } from '../../shared/avatars/beers.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';
import { randomFloat } from '../../shared/util/random.js';
import { HostCore } from '../HostCore.js';

/**
 * Modalità SALOTTO: questo dispositivo (PC/TV/tablet) è l'host e lo schermo principale.
 * Mostra il pub 3D (ruota + birre-avatar), il QR per entrare e la classifica. I telefoni sono controller.
 *
 * Tastiera (debug/demo): SPAZIO = gira la ruota per il giocatore di turno, F = fullscreen.
 */
export async function startSalotto(root) {
  clear(root);
  root.append(h('div', { class: 'screen-center' }, h('div', { class: 'loader' }), h('p', {}, 'Apro il pub...')));

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
    QRCode.toCanvas(this.qrCanvas, url, { margin: 1, width: 240, color: { dark: '#0a0e17', light: '#f4ead5' } });

    this.stageEl = h('div', { class: 'host-wheel' });
    this.playersEl = h('ul', { class: 'player-list' });
    this.bannerEl = h('div', { class: 'host-banner' });
    this.resultEl = h('div', { class: 'result-pop', 'aria-live': 'polite' });
    this.signalEl = h('div', { class: 'signal-dot online', title: 'Signaling server' });

    clear(root).append(
      h(
        'div',
        { class: 'host-screen' },
        h('div', { class: 'host-stage' }, this.stageEl, this.bannerEl, this.resultEl),
        h(
          'aside',
          { class: 'host-panel' },
          h(
            'div',
            { class: 'room-card' },
            h('div', { class: 'eyebrow' }, 'Entra col telefono'),
            this.qrCanvas,
            h('div', { class: 'room-code', 'aria-label': 'Codice stanza' }, roomCode),
            h('div', { class: 'room-url' }, url.replace(/^https?:\/\//, '')),
          ),
          h('h3', { class: 'eyebrow' }, 'Al bancone'),
          this.playersEl,
          h('div', { class: 'host-hint' }, this.signalEl, h('span', {}, 'SPAZIO gira · F schermo intero')),
        ),
      ),
    );

    this.stage = new StageRenderer(this.stageEl, { quality: 'high' });
    this.sync = new StageSync(this.stage);
    this.stage.on('tick', () => sfx.tick());

    core.on('state', (s) => this.render(s));
    core.on('spin', ({ plan }) => {
      this.hideResult();
      this.sync.playSpin(plan, 0);
      sfx.spinStart();
    });
    core.on('result', (result) => this.showResult(result));
    core.on('player-joined', (player, rejoined) => {
      sfx.join();
      toast(rejoined ? `${player.name} è tornato al bancone` : `${player.name} ordina una ${getBeer(player.beer).name}!`);
    });
    core.on('avatar-changed', (player) => toast(`${player.name} passa a una ${getBeer(player.beer).name}`));
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
        core.requestSpin(s.turnPlayerId, 0.3 + randomFloat() * 0.7, { bypassTurn: true });
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
          beerIcon(p.beer, 'sm'),
          h('span', { class: 'player-info' }, h('span', { class: 'player-name' }, p.name), h('span', { class: 'player-beer' }, getBeer(p.beer).name)),
          h('span', { class: 'player-coins' }, `${p.coins}`, h('span', { class: 'coin' })),
        ),
      ),
    );
    if (!s.players.length) this.playersEl.append(h('li', { class: 'player empty' }, 'Il bancone è vuoto. Scansiona il QR!'));

    let banner = '';
    if (s.phase === PHASE.SPINNING) banner = 'La ruota gira...';
    else if (s.phase === PHASE.IDLE && turnPlayer) banner = `Tocca a ${turnPlayer.name} — lancia dal telefono`;
    else if (s.phase === PHASE.IDLE) banner = 'In attesa di giocatori · SPAZIO per una demo';
    this.bannerEl.textContent = banner;
    this.bannerEl.style.setProperty('--pc', turnPlayer?.color ?? '#f4ead5');
    this.bannerEl.classList.toggle('hidden', !banner);

    if (s.phase === PHASE.IDLE) this.hideResult();
  }

  showResult(result) {
    const segment = this.core.snapshot().wheel.segments[result.segmentIndex];
    const info = segmentInfo(segment);
    sfx.win();
    clear(this.resultEl).append(
      h('div', { class: 'eyebrow' }, 'La ruota ha deciso'),
      h('div', { class: 'result-label' }, info.label),
      h('div', { class: 'result-text' }, result.text),
    );
    this.resultEl.style.setProperty('--sc', info.glow);
    this.resultEl.classList.add('show');
  }

  hideResult() {
    this.resultEl.classList.remove('show');
  }
}
