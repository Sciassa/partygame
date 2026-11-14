import QRCode from 'qrcode';
import '../../styles/host.css';
import { joinUrl } from '../../shared/config.js';
import { MODE, PHASE } from '../../shared/protocol.js';
import { clear, fill, h, toast } from '../../shared/util/dom.js';
import { keepScreenOn } from '../../shared/util/device.js';
import { sfx } from '../../shared/audio/sfx.js';
import { StageRenderer } from '../../shared/stage/StageRenderer.js';
import { StageSync } from '../../shared/stage/StageSync.js';
import { segmentInfo } from '../../shared/wheel/segments.js';
import { getBeer } from '../../shared/avatars/beers.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';
import { createTopSlot } from '../../shared/ui/topSlot.js';
import { eventTitle, formatNumber, phaseLabel, signed } from '../../shared/game/display.js';
import { randomFloat } from '../../shared/util/random.js';
import { HostCore } from '../HostCore.js';

/**
 * Modalità SALOTTO: questo dispositivo (PC/TV/tablet) è l'host e il tabellone di «Spin & Sip».
 * Mostra il pub 3D (ruota + birre), il Top Slot, la carta dell'evento in corso, la classifica
 * (Pinte d'Oro, Tappi, stati) e il registro del turno. I telefoni sono i controller.
 *
 * Tastiera: INVIO = avvia la partita (in lobby), SPAZIO = lancio di prova, F = fullscreen.
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
  #deadline = null;

  constructor(root, core, roomCode) {
    this.core = core;
    this.roomCode = roomCode;

    const url = joinUrl(roomCode);
    this.qrCanvas = h('canvas', { class: 'qr', 'aria-label': `QR code per entrare: ${url}` });
    QRCode.toCanvas(this.qrCanvas, url, { margin: 1, width: 240, color: { dark: '#0a0e17', light: '#f4ead5' } });

    this.stageEl = h('div', { class: 'host-wheel' });
    this.bannerEl = h('div', { class: 'host-banner' });
    this.cardEl = h('div', { class: 'stage-card', 'aria-live': 'polite' });
    this.topSlot = createTopSlot();
    this.playersEl = h('ul', { class: 'player-list' });
    this.lobbyEl = h('div', { class: 'lobby-box' });
    this.feedEl = h('div', { class: 'host-feed' });
    this.signalEl = h('div', { class: 'signal-dot online', title: 'Signaling server' });
    this.roomCard = h(
      'div',
      { class: 'room-card' },
      h('div', { class: 'eyebrow' }, 'Entra col telefono'),
      this.qrCanvas,
      h('div', { class: 'room-code', 'aria-label': 'Codice stanza' }, roomCode),
      h('div', { class: 'room-url' }, url.replace(/^https?:\/\//, '')),
    );

    clear(root).append(
      h(
        'div',
        { class: 'host-screen' },
        h('div', { class: 'host-stage' }, this.stageEl, this.bannerEl, h('div', { class: 'host-topslot' }, this.topSlot.el), this.cardEl),
        h(
          'aside',
          { class: 'host-panel' },
          this.roomCard,
          this.lobbyEl,
          h('h3', { class: 'eyebrow' }, 'Classifica'),
          this.playersEl,
          this.feedEl,
          h('div', { class: 'host-hint' }, this.signalEl, h('span', {}, 'INVIO avvia · SPAZIO lancio di prova · F schermo intero')),
        ),
      ),
    );

    this.stage = new StageRenderer(this.stageEl, { quality: 'high' });
    this.sync = new StageSync(this.stage, { topSlot: this.topSlot });
    this.stage.on('tick', () => sfx.tick());

    core.on('state', (s) => this.render(s));
    core.on('game-event', (e) => this.#onGameEvent(e));
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
        core.hostAction({ kind: 'debug_spin', force: 0.3 + randomFloat() * 0.7 });
      } else if (e.key === 'Enter') {
        core.hostAction({ kind: 'start' });
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
    });
    setInterval(() => this.#tickTimer(), 250);

    this.render(core.snapshot());
  }

  #name(id) {
    return this.s?.players.find((p) => p.id === id)?.name ?? '—';
  }

  #player(id) {
    return this.s?.players.find((p) => p.id === id);
  }

  #onGameEvent(e) {
    this.sync.handleEvent(e);
    if (e.type === 'spin') {
      if (!e.nudge) sfx.spinStart();
      this.sync.playSpin(e.plan, 0, e.topSlot);
    } else if (e.type === 'top_slot_hit' || e.type === 'pint' || e.type === 'award') {
      sfx.win();
    } else if (e.type === 'happy_hour') {
      toast('🟣 HAPPY HOUR! Tappi doppi negli ultimi 3 turni');
    }
  }

  render(s) {
    this.s = s;
    this.sync.applyState(s);
    document.body.classList.toggle('happy-hour', Boolean(s.turn?.happyHour));
    this.roomCard.classList.toggle('compact', s.phase !== PHASE.LOBBY);

    // timer
    if (s.deadline) {
      const key = `${s.phase}|${s.turn.number}|${s.event?.stage}`;
      const at = performance.now() + s.deadline;
      if (!this.#deadline || this.#deadline.key !== key) this.#deadline = { key, at, total: s.deadline };
      else this.#deadline.at = at;
    } else this.#deadline = null;

    this.#renderBanner(s);
    this.#renderLobby(s);
    this.#renderPlayers(s);
    this.#renderCard(s);
    fill(this.feedEl, ...s.feed.slice(-4).map((l) => h('div', { class: `feed-line tone-${l.tone}` }, l.text)));
  }

  #renderBanner(s) {
    const turnPlayer = this.#player(s.turnPlayerId);
    const turn = s.phase === PHASE.LOBBY || s.phase === PHASE.GAME_OVER ? null : h('span', { class: `banner-turn ${s.turn.happyHour ? 'hh' : ''}` }, s.turn.happyHour ? `🟣 HAPPY HOUR · ${s.turn.number}/${s.turn.total}` : `Turno ${s.turn.number}/${s.turn.total}`);
    fill(this.bannerEl, turn, h('span', {}, phaseLabel(s, (id) => this.#name(id))));
    this.bannerEl.style.setProperty('--pc', turnPlayer?.color ?? '#f4ead5');
  }

  #renderLobby(s) {
    if (s.phase !== PHASE.LOBBY) {
      this.lobbyEl.classList.add('hidden');
      return;
    }
    this.lobbyEl.classList.remove('hidden');
    const pick = (values, current, apply, fmt = (v) => v) => h('div', { class: 'segmented' }, values.map((v) => h('button', { type: 'button', class: `seg-btn ${v === current ? 'active' : ''}`, onclick: () => this.core.hostAction({ kind: 'settings', ...apply(v) }) }, fmt(v))));
    const players = s.players.filter((p) => p.connected).length;
    fill(this.lobbyEl, 
      h('div', { class: 'setting' }, h('span', {}, 'Turni'), pick([12, 15, 20], s.settings.totalTurns, (v) => ({ totalTurns: v }))),
      h('div', { class: 'setting' }, h('span', {}, 'Pinte nel negozio'), pick([true, false], s.settings.shopPints, (v) => ({ shopPints: v }), (v) => (v ? 'Sì' : 'No'))),
      h('button', { class: `btn btn-primary ${players ? '' : 'disabled'}`, onclick: () => this.core.hostAction({ kind: 'start' }) }, players ? `Inizia con ${players} ${players === 1 ? 'giocatore' : 'giocatori'}` : 'Aspetto i giocatori...'),
    );
  }

  #renderPlayers(s) {
    const ranked = [...s.players].sort((a, b) => (b.pints ?? 0) - (a.pints ?? 0) || (b.coins ?? 0) - (a.coins ?? 0) || 0);
    fill(this.playersEl, 
      ...ranked.map((p, i) => {
        const st = p.status ?? {};
        const badges = [st.shield > 0 && '🛡️', st.anchor > 0 && '⚓', st.mirror > 0 && '🪞', st.skip > 0 && '🕳️', p.betPlaced && '🎲'].filter(Boolean).join(' ');
        return h(
          'li',
          { class: `player ${p.connected ? '' : 'offline'} ${p.id === s.turnPlayerId ? 'turn' : ''}`, style: { '--pc': p.color } },
          h('span', { class: 'player-rank' }, `${i + 1}`),
          beerIcon(p.beer, 'sm'),
          h('span', { class: 'player-info' }, h('span', { class: 'player-name' }, p.name), h('span', { class: 'player-beer' }, badges || (p.beer ? getBeer(p.beer).name : 'Fuori dal pub'))),
          h('span', { class: 'player-score' }, h('span', { class: 'player-pints' }, s.hidden ? '🍺 ?' : `🍺 ${p.pints}`), h('span', { class: 'player-coins' }, s.hidden ? '?' : `${p.coins}`, h('span', { class: 'coin' }))),
        );
      }),
    );
    if (!s.players.length) this.playersEl.append(h('li', { class: 'player empty' }, 'Il bancone è vuoto. Scansiona il QR!'));
    if (s.hidden) this.playersEl.prepend(h('li', { class: 'player empty' }, '🙈 Voto Segreto: classifica nascosta'));
  }

  /** Carta in sovrimpressione sul palco: cosa sta succedendo adesso. */
  #renderCard(s) {
    const card = this.#cardContent(s);
    this.cardEl.classList.toggle('show', Boolean(card));
    this.cardEl.classList.toggle('wide', Boolean(card?.wide));
    if (!card) return clear(this.cardEl);
    this.cardEl.style.setProperty('--sc', card.color ?? 'var(--amber)');
    fill(this.cardEl, 
      h('div', { class: 'card-head' }, h('div', { class: 'eyebrow' }, card.eyebrow ?? ''), h('div', { class: 'card-timer' })),
      card.title ? h('div', { class: 'card-title' }, card.title) : null,
      ...(card.body ?? []),
    );
    this.#tickTimer();
  }

  #cardContent(s) {
    const name = (id) => this.#name(id);
    const row = (playerId, text, delta) => {
      const p = this.#player(playerId);
      return h('div', { class: 'card-row' }, beerIcon(p?.beer, 'xs'), h('span', { class: 'card-row-name', style: { color: p?.color } }, p?.name ?? '?'), h('span', { class: 'card-row-text' }, text ?? ''), delta ? h('span', { class: `card-row-delta ${delta > 0 ? 'pos' : 'neg'}` }, signed(delta)) : null);
    };
    const lines = (list = []) => h('div', { class: 'card-lines' }, list.slice(-5).map((l) => h('div', { class: `feed-line tone-${l.tone}` }, l.text)));

    switch (s.phase) {
      case PHASE.LOBBY:
        return {
          eyebrow: 'Spin & Sip',
          title: 'Benvenuti al pub',
          wide: true,
          body: [
            h(
              'ul',
              { class: 'card-rules' },
              h('li', {}, "Vince chi ha più Pinte d'Oro (a parità contano i Tappi)."),
              h('li', {}, 'Compra adesivi e incollali sulla ruota: incassi royalties e tendi trappole.'),
              h('li', {}, 'Scommetti quando lanciano gli altri. Top Slot moltiplica i premi.'),
              h('li', {}, 'Ultimi 3 turni: HAPPY HOUR, Tappi doppi. A fine partita, 3 Bonus Segreti.'),
            ),
          ],
        };
      case PHASE.SHOP:
        return { eyebrow: 'Negozio Adesivi', title: `${name(s.turnPlayerId)} sta facendo shopping` };
      case PHASE.BETTING: {
        const placed = s.players.filter((p) => p.betPlaced).length;
        return { eyebrow: 'Bets are open', title: `Scommesse su ${name(s.turnPlayerId)}`, body: [h('p', { class: 'muted' }, `${placed} scommesse piazzate · categoria x3 · esito x2`)] };
      }
      case PHASE.LANDING: {
        const info = segmentInfo(s.wheel.segments[s.landing?.segmentIndex]);
        return { eyebrow: `${name(s.turnPlayerId)} si ferma su`, title: info.label, color: info.glow, body: [lines(s.landing?.lines)] };
      }
      case PHASE.CHOICE:
        return { eyebrow: `${name(s.choice?.playerId)} sceglie`, title: s.choice?.title };
      case PHASE.EVENT:
        return this.#eventCard(s, row);
      case PHASE.TURN_RESULT: {
        const sum = s.turnSummary;
        return {
          eyebrow: `Fine turno ${s.turn.number}/${s.turn.total}`,
          title: sum ? `${name(sum.playerId)}: ${signed(sum.net)} Tappi` : 'Riepilogo',
          body: [lines(sum?.lines), sum?.bets?.length ? h('p', { class: 'muted small' }, `Scommesse sull'esito: ${sum.bets.filter((b) => b.result === 'win').length} vinte, ${sum.bets.filter((b) => b.result === 'lose').length} perse`) : null],
        };
      }
      case PHASE.AWARDS:
        return {
          eyebrow: 'Bonus Segreti',
          title: "+1 Pinta d'Oro",
          wide: true,
          body: s.awards.map((a) => h('div', { class: 'award-line' }, h('span', { class: 'award-icon' }, a.icon), h('span', { class: 'award-title' }, a.title), h('span', { class: 'award-who' }, a.winners.length ? a.winners.map(name).join(', ') : 'nessuno'), a.value ? h('span', { class: 'muted small' }, a.value) : null)),
        };
      case PHASE.GAME_OVER:
        return {
          eyebrow: 'Classifica finale',
          title: `🏆 ${name(s.ranking[0])}`,
          wide: true,
          body: [h('div', { class: 'podium' }, s.ranking.slice(0, 8).map((id, i) => {
            const p = this.#player(id);
            return h('div', { class: `podium-row pos-${i + 1}` }, h('span', { class: 'rank' }, `${i + 1}`), beerIcon(p?.beer, 'sm'), h('span', { class: 'card-row-name', style: { color: p?.color } }, p?.name), h('span', { class: 'podium-score' }, `🍺 ${p?.pints} · ${p?.coins} Tappi`));
          })), h('p', { class: 'muted small' }, `${name(s.vipId)} può avviare una nuova partita dal telefono`)],
        };
      default:
        return null;
    }
  }

  #eventCard(s, row) {
    const ev = s.event;
    if (!ev) return null;
    const name = (id) => this.#name(id);
    const total = s.players.filter((p) => p.connected).length;
    switch (ev.kind) {
      case 'trivia':
      case 'duel': {
        const reveal = ev.stage === 'reveal';
        const body = [h('div', { class: 'card-question' }, ev.question)];
        if (ev.mode === 'TRIVIA_CHOICE') {
          body.push(h('div', { class: 'card-options' }, ev.options.map((o, i) => h('div', { class: `card-option ${reveal ? (i === ev.correctIndex ? 'right' : 'wrong') : ''}` }, h('span', { class: 'opt-letter' }, 'ABCD'[i]), o))));
        } else if (reveal) {
          body.push(h('div', { class: 'card-answer' }, ev.answer));
        } else {
          body.push(h('p', { class: 'muted' }, 'Risposta aperta: scrivetela sul telefono'));
        }
        if (reveal) {
          if (ev.kind === 'duel') body.push(h('p', { class: 'card-answer small' }, ev.winnerId ? `⚔️ ${name(ev.winnerId)} vince ${ev.transferred} Tappi` : '⚔️ Nessuno indovina'));
          else body.push(h('div', { class: 'card-rows' }, ev.results.filter((r) => r.correct || r.delta).slice(0, 6).map((r) => row(r.playerId, r.correct ? `${(r.timeMs / 1000).toFixed(1)} s` : 'sbagliato', r.delta))));
          if (ev.note) body.push(h('p', { class: 'note' }, ev.note));
        } else {
          body.push(h('p', { class: 'muted small' }, ev.kind === 'duel' ? `${name(ev.duelists[0])} contro ${name(ev.duelists[1])}` : `Hanno risposto: ${ev.answered.length}/${total}`));
        }
        return { eyebrow: eventTitle(ev), wide: true, body };
      }
      case 'impostor': {
        if (ev.stage === 'clue') return { eyebrow: eventTitle(ev), title: `Tema: ${ev.theme}`, body: [h('p', { class: 'muted' }, 'Tutti hanno la parola segreta... tranne uno. Scrivete un indizio sul telefono.'), h('p', { class: 'muted small' }, `Indizi: ${ev.submitted.length}/${total}`)] };
        if (ev.stage === 'vote') return { eyebrow: eventTitle(ev), title: 'Chi è l\'impostore?', wide: true, body: [h('div', { class: 'card-rows' }, ev.clues.map((c) => row(c.playerId, `«${c.text}»`))), h('p', { class: 'muted small' }, `Voti: ${ev.voted.length}/${total}`)] };
        return { eyebrow: eventTitle(ev), title: ev.caught ? `Preso! Era ${name(ev.impostorId)}` : `${name(ev.impostorId)} l'ha fatta franca!`, body: [h('div', { class: 'card-answer' }, ev.word), h('div', { class: 'card-rows' }, ev.results.map((r) => row(r.playerId, '', r.delta)))] };
      }
      case 'pour':
        if (ev.stage !== 'reveal') return { eyebrow: eventTitle(ev), title: 'Spillate fino al 95%!', body: [h('p', { class: 'muted' }, 'Tenete premuto sul telefono. Oltre il 40% il livello sparisce. Sopra il 100% si trabocca.'), h('p', { class: 'muted small' }, `Hanno spillato: ${ev.done.length}/${total}`)] };
        return { eyebrow: eventTitle(ev), title: 'Il boccale perfetto', body: [h('div', { class: 'card-rows' }, [...ev.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => row(r.playerId, r.level === null ? '—' : `${Math.round(r.level * 100)}%${r.overflow ? ' trabocca' : ''}`, r.delta)))] };
      case 'auction':
        if (ev.stage !== 'reveal') return { eyebrow: eventTitle(ev), title: `In palio ${ev.prize} Tappi`, body: [h('p', { class: 'muted' }, 'Puntate in segreto. Il primo vince (e paga), il SECONDO perde la puntata!'), h('p', { class: 'muted small' }, `Puntate: ${ev.done.length}/${total}`)] };
        return { eyebrow: eventTitle(ev), title: ev.winnerId ? `Vince ${name(ev.winnerId)}` : 'Nessuna puntata', body: [h('div', { class: 'card-rows' }, [...ev.bids].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1)).map((b) => row(b.playerId, b.amount === null ? '—' : `${b.amount}${b.playerId === ev.secondId ? ' · perde' : ''}`)))] };
      case 'price':
        if (ev.stage !== 'reveal') return { eyebrow: eventTitle(ev), wide: true, body: [h('div', { class: 'card-question' }, ev.question), h('p', { class: 'muted small' }, `Risposte: ${ev.done.length}/${total}`)] };
        return { eyebrow: eventTitle(ev), wide: true, body: [h('div', { class: 'card-question' }, ev.question), h('div', { class: 'card-answer' }, `${formatNumber(ev.answer, ev.step)} ${ev.unit}`), h('div', { class: 'card-rows' }, [...ev.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 6).map((r) => row(r.playerId, r.guess === null ? '—' : formatNumber(r.guess, ev.step), r.delta)))] };
      case 'fortune':
        return { eyebrow: 'Fortuna', title: `${name(ev.playerId)} ${ev.delta >= 0 ? `trova ${ev.delta}` : `perde ${-ev.delta}`} Tappi`, color: ev.delta >= 0 ? '#57d982' : '#ff5a5a' };
      default:
        return { eyebrow: eventTitle(ev) };
    }
  }

  #tickTimer() {
    const el = this.cardEl.querySelector('.card-timer');
    if (!el) return;
    const d = this.#deadline;
    if (!d) return (el.textContent = '');
    const left = Math.max(0, d.at - performance.now());
    el.textContent = `${Math.ceil(left / 1000)}s`;
    el.classList.toggle('urgent', left < 4000);
  }
}
