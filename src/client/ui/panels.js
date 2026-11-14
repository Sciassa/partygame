import { SoundEngine } from '../../audio/SoundEngine.ts';
import { h } from '../../shared/util/dom.js';
import { vibrate } from '../../shared/util/device.js';
import { PHASE } from '../../shared/protocol.js';
import { SEGMENT_INFO, SEGMENT_TYPE, segmentInfo, segmentName } from '../../shared/wheel/segments.js';
import { eventTitle, formatNumber, scramble, signed } from '../../shared/game/display.js';
import { beerIcon } from '../../shared/ui/beerIcon.js';
import { STICKER_CATEGORIES } from '../../data/stickers.ts';
import { createSpinPad } from './SpinPad.js';

/**
 * Pannelli del telefono, uno per fase/evento di «Spin & Sip».
 * Ogni pannello è { key, render(ctx) → HTMLElement, update?(el, ctx) }:
 *  - se la `key` non cambia, il pannello NON viene ricostruito (input, slider e tasti tenuti
 *    premuti non si perdono a ogni aggiornamento di stato); al massimo si chiama update()
 *  - ctx = { s, p, meId, me, isTurn, name(id), player(id), send(action), ui, sabotage }
 */
export function panelFor(ctx) {
  const { s } = ctx;
  switch (s.phase) {
    case PHASE.LOBBY:
      return lobbyPanel(ctx);
    case PHASE.SHOP:
      return shopPanel(ctx);
    case PHASE.BETTING:
      return bettingPanel(ctx);
    case PHASE.AWAIT_SPIN:
      return awaitSpinPanel(ctx);
    case PHASE.SPINNING:
      return ctx.mode === 'salotto'
        ? infoPanel('spinning', '🎡', 'La ruota gira...', 'Guarda lo schermo')
        : { key: 'spinning:pocket', render: () => h('div', { class: 'panel panel-center panel-compact' }, h('h2', { class: 'panel-title' }, '🎡 La ruota gira...')) };
    case PHASE.LANDING:
      return landingPanel(ctx);
    case PHASE.CHOICE:
      return choicePanel(ctx);
    case PHASE.EVENT:
      return eventPanel(ctx);
    case PHASE.TURN_RESULT:
      return turnResultPanel(ctx);
    case PHASE.AWARDS:
      return awardsPanel(ctx);
    case PHASE.GAME_OVER:
      return gameOverPanel(ctx);
    default:
      return infoPanel('unknown', '⏳', '...', '');
  }
}

// ======================================================================== componenti

function infoPanel(key, icon, title, subtitle = '', extra = null) {
  return {
    key: `info:${key}:${title}:${subtitle}`,
    render: () => h('div', { class: 'panel panel-center' }, h('div', { class: 'panel-icon' }, icon), h('h2', { class: 'panel-title' }, title), subtitle && h('p', { class: 'muted' }, subtitle), extra),
  };
}

/**
 * Birra Analcolica: copre `el` con bolle di schiuma che vanno scoppiate con 2 tocchi
 * prima di poter toccare quello che c'è sotto.
 */
function foamCover(el, seed = 0, onClear = null) {
  let taps = 0;
  const bubbles = Array.from({ length: 9 }, (_, i) =>
    h('span', { class: 'foam-bubble', style: { '--x': `${(i * 37 + seed * 23) % 100}%`, '--y': `${(i * 53 + seed * 17) % 100}%`, '--s': `${0.7 + ((i + seed) % 4) * 0.18}` } }),
  );
  const foam = h('span', {
    class: 'foam',
    role: 'button',
    'aria-label': 'Schiuma: tocca due volte',
    onclick: (e) => {
      e.stopPropagation();
      taps += 1;
      SoundEngine.playPop();
      vibrate(15);
      foam.classList.add(taps >= 2 ? 'popped' : 'cracked');
      if (taps >= 2) {
        setTimeout(() => foam.remove(), 260);
        onClear?.();
      }
    },
  }, ...bubbles);
  return h('div', { class: 'foam-wrap' }, el, foam);
}

function waiting(text) {
  return h('div', { class: 'waiting' }, h('div', { class: 'loader small' }), h('span', {}, text));
}

/** Bottone che rispetta i sabotaggi: «Dito Tremante» lo fa ballare. */
function actionButton(label, onClick, cls = 'btn btn-primary btn-huge') {
  return h('button', { class: cls, type: 'button', onclick: onClick }, label);
}

/** Selettore a pillole (0 / 15 / 30 ecc.). */
function segmented(values, current, onPick, format = (v) => v) {
  return h(
    'div',
    { class: 'segmented' },
    values.map((v) => h('button', { type: 'button', class: `seg-btn ${v === current ? 'active' : ''}`, onclick: () => onPick(v) }, format(v))),
  );
}

function resultLine(ctx, playerId, text, delta) {
  const p = ctx.player(playerId);
  return h(
    'div',
    { class: `result-row ${playerId === ctx.meId ? 'me' : ''}` },
    beerIcon(p?.beer, 'xs'),
    h('span', { class: 'result-name', style: { color: p?.color } }, p?.name ?? '?'),
    h('span', { class: 'result-text' }, text ?? ''),
    delta ? h('span', { class: `result-delta ${delta > 0 ? 'pos' : 'neg'}` }, signed(delta)) : null,
  );
}

function feedLines(lines = []) {
  return h('div', { class: 'feed' }, lines.slice(-6).map((l) => h('div', { class: `feed-line tone-${l.tone}` }, l.text)));
}

// ======================================================================== LOBBY

function lobbyPanel(ctx) {
  const { s, meId } = ctx;
  const vip = s.vipId === meId;
  return {
    key: `lobby:${vip}:${s.settings.totalTurns}:${s.settings.shopPints}:${s.players.length}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, 'Lobby · Spin & Sip'),
        h('h2', { class: 'panel-title' }, vip ? 'Sei tu a dare il via' : 'Si aspetta il via'),
        h('p', { class: 'muted' }, `${s.players.filter((p) => p.connected).length} birre al bancone`),
        h(
          'div',
          { class: 'settings-card' },
          h('div', { class: 'setting' }, h('span', {}, 'Turni totali'), vip ? segmented([12, 15, 20], s.settings.totalTurns, (v) => ctx.send({ kind: 'settings', totalTurns: v })) : h('b', {}, s.settings.totalTurns)),
          h(
            'div',
            { class: 'setting' },
            h('span', {}, "Pinte d'Oro nel negozio"),
            vip
              ? segmented([true, false], s.settings.shopPints, (v) => ctx.send({ kind: 'settings', shopPints: v }), (v) => (v ? 'Sì' : 'No'))
              : h('b', {}, s.settings.shopPints ? 'Sì' : 'No'),
          ),
          h('p', { class: 'small muted' }, 'Gli ultimi 3 turni sono HAPPY HOUR: Tappi raddoppiati.'),
        ),
        vip ? actionButton('INIZIA PARTITA', () => ctx.send({ kind: 'start' })) : waiting(`In attesa che ${ctx.name(s.vipId)} avvii la partita`),
        h('details', { class: 'rules' }, h('summary', {}, 'Come si gioca'), rulesText()),
      ),
  };
}

function rulesText() {
  return h(
    'ul',
    {},
    h('li', {}, 'Vince chi ha più Pinte d\'Oro; a parità contano i Tappi.'),
    h('li', {}, "Il Fusto d'Oro (e il negozio, se attivo) converte Tappi in Pinte: il prezzo sale a ogni acquisto."),
    h('li', {}, 'Prima di lanciare puoi comprare un adesivo e incollarlo su uno spicchio: incassi 15 Tappi ogni volta che qualcuno ci capita.'),
    h('li', {}, 'Quando lancia un altro, hai 8 secondi per scommettere su categoria (x3) ed esito (x2).'),
    h('li', {}, 'Top Slot: se la ruota si ferma sullo spicchio estratto, i premi del turno si moltiplicano.'),
    h('li', {}, 'A fine partita 3 Bonus Segreti regalano Pinte extra.'),
  );
}

// ======================================================================== NEGOZIO

function shopPanel(ctx) {
  const { s, p, meId } = ctx;
  if (s.shop?.playerId !== meId || !p?.shop) {
    return infoPanel('shop-wait', '🛒', `${ctx.name(s.turnPlayerId)} è al Negozio Adesivi`, 'Tra poco si scommette: tieni pronti i Tappi');
  }
  const shop = p.shop;
  const selected = ctx.ui.selected ? shop.offers.find((o) => o.id === ctx.ui.selected) : null;
  if (shop.purchased) return infoPanel('shop-done', '✅', 'Acquisto fatto!', 'Guarda la ruota');

  if (!selected) {
    return {
      key: `shop:offers:${shop.offers.map((o) => o.id).join()}:${p.coins}:${shop.pintPrice}`,
      render: () =>
        h(
          'div',
          { class: 'panel' },
          h('div', { class: 'eyebrow' }, 'Negozio Adesivi'),
          h('h2', { class: 'panel-title' }, 'Scegli un adesivo'),
          h(
            'div',
            { class: 'sticker-cards' },
            shop.offers.map((o) => {
              const cheapest = Math.min(...o.costs.filter((c) => c !== null));
              const affordable = Number.isFinite(cheapest) && cheapest <= p.coins;
              return h(
                'button',
                {
                  type: 'button',
                  class: `sticker-card ${affordable ? '' : 'disabled'}`,
                  style: { '--cat': STICKER_CATEGORIES[o.category].color },
                  onclick: () => {
                    if (!affordable) return;
                    ctx.ui.selected = o.id;
                    ctx.refresh();
                  },
                },
                h('div', { class: 'sticker-top' }, h('span', { class: 'sticker-icon' }, o.icon), h('span', { class: 'sticker-cat' }, `#${o.number} · ${STICKER_CATEGORIES[o.category].label}`)),
                h('div', { class: 'sticker-name' }, o.name),
                h('div', { class: 'sticker-desc' }, o.description),
                h('div', { class: 'sticker-foot' }, h('span', { class: 'small muted' }, `Lv.2: ${o.level2}`), h('span', { class: 'price' }, `${o.cost}`, h('span', { class: 'coin' }))),
              );
            }),
          ),
          shop.pintPrice !== null
            ? h('button', { type: 'button', class: `btn btn-gold ${shop.canBuyPint ? '' : 'disabled'}`, onclick: () => shop.canBuyPint && ctx.send({ kind: 'shop_pint' }) }, `🍺 Pinta d'Oro · ${shop.pintPrice} Tappi`)
            : null,
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => ctx.send({ kind: 'shop_skip' }) }, 'Salta il negozio'),
        ),
    };
  }

  // scelta dello spicchio
  return {
    key: `shop:place:${selected.id}:${p.coins}:${JSON.stringify(selected.costs)}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, `${selected.icon} ${selected.name}`),
        h('h2', { class: 'panel-title' }, 'Su quale spicchio?'),
        h('p', { class: 'small muted' }, 'Tuo = potenzi al Lv.2 · di un altro = +50% · 🔒 = protetto'),
        h(
          'div',
          { class: 'segment-grid' },
          s.wheel.segments.map((seg, i) => {
            const cost = selected.costs[i];
            const ok = cost !== null && cost <= p.coins;
            const owner = seg.sticker ? ctx.player(seg.sticker.ownerId) : null;
            return h(
              'button',
              {
                type: 'button',
                class: `segment-btn ${ok ? '' : 'disabled'}`,
                style: { '--seg': segmentInfo(seg).glow, '--owner': seg.sticker?.ownerColor ?? 'transparent' },
                onclick: () => ok && ctx.send({ kind: 'shop_place', stickerId: selected.id, segmentIndex: i }),
              },
              h('span', { class: 'segment-label' }, segmentName(seg, i)),
              seg.sticker ? h('span', { class: 'segment-sticker' }, `${seg.sticker.icon} ${owner?.name ?? ''}${seg.sticker.level > 1 ? ' II' : ''}${seg.sticker.lockedTurns > 0 ? ' 🔒' : ''}`) : h('span', { class: 'segment-sticker muted' }, 'libero'),
              h('span', { class: 'segment-cost' }, cost === null ? '—' : `${cost}`),
            );
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost',
            onclick: () => {
              ctx.ui.selected = null;
              ctx.refresh();
            },
          },
          '← Altri adesivi',
        ),
      ),
  };
}

// ======================================================================== SCOMMESSE

const BET_CATEGORIES = [SEGMENT_TYPE.TRIVIA, SEGMENT_TYPE.MINIGAME, SEGMENT_TYPE.FORTUNE, SEGMENT_TYPE.KEG];

function bettingPanel(ctx) {
  const { s, p, isTurn } = ctx;
  if (isTurn) return infoPanel('bet-spinner', '🎲', 'Scommesse aperte su di te', 'Tra pochi secondi lanci la ruota');
  const ui = ctx.ui;
  ui.bet ??= { category: null, categoryStake: 15, outcome: null, outcomeStake: 15 };
  const placed = p?.bet;
  return {
    key: `bet:${JSON.stringify(ui.bet)}:${JSON.stringify(placed)}:${p?.coins}`,
    render: () => {
      const b = ui.bet;
      const set = (patch) => {
        Object.assign(b, patch);
        ctx.refresh();
      };
      return h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, `Scommesse su ${ctx.name(s.turnPlayerId)}`),
        h('h2', { class: 'panel-title' }, 'Bets are open!'),
        h('div', { class: 'bet-block' }, h('div', { class: 'bet-title' }, 'Dove si ferma la ruota? ', h('b', {}, 'x3')),
          h('div', { class: 'bet-options' }, BET_CATEGORIES.map((type) => h('button', {
            type: 'button',
            class: `bet-option ${b.category === type ? 'active' : ''}`,
            style: { '--seg': SEGMENT_INFO[type].glow },
            onclick: () => set({ category: b.category === type ? null : type }),
          }, SEGMENT_INFO[type].label))),
          b.category ? segmented([15, 30], b.categoryStake, (v) => set({ categoryStake: v }), (v) => `${v} Tappi`) : null,
        ),
        h('div', { class: 'bet-block' }, h('div', { class: 'bet-title' }, `${ctx.name(s.turnPlayerId)} in questo turno... `, h('b', {}, 'x2')),
          h('div', { class: 'bet-options two' },
            h('button', { type: 'button', class: `bet-option ${b.outcome === 'gain' ? 'active' : ''}`, style: { '--seg': '#57d982' }, onclick: () => set({ outcome: b.outcome === 'gain' ? null : 'gain' }) }, '📈 Guadagna'),
            h('button', { type: 'button', class: `bet-option ${b.outcome === 'loss' ? 'active' : ''}`, style: { '--seg': '#ff5a5a' }, onclick: () => set({ outcome: b.outcome === 'loss' ? null : 'loss' }) }, '📉 Perde'),
          ),
          b.outcome ? segmented([15, 30], b.outcomeStake, (v) => set({ outcomeStake: v }), (v) => `${v} Tappi`) : null,
        ),
        actionButton(placed ? 'Aggiorna scommessa' : 'Scommetti', () => {
          vibrate(25);
          ctx.send({ kind: 'bet', category: b.category, categoryStake: b.category ? b.categoryStake : 0, outcome: b.outcome, outcomeStake: b.outcome ? b.outcomeStake : 0 });
        }),
        placed ? h('p', { class: 'small ok' }, `✓ Puntati ${placed.categoryStake + placed.outcomeStake} Tappi`) : h('p', { class: 'small muted' }, 'Nessuna scommessa = 0 Tappi'),
      );
    },
  };
}

// ======================================================================== LANCIO

function awaitSpinPanel(ctx) {
  const { s, isTurn } = ctx;
  if (!isTurn) {
    const bet = ctx.p?.bet;
    return infoPanel('await-other', '⏳', `Tocca a ${ctx.name(s.turnPlayerId)}`, bet ? `Le tue puntate: ${bet.categoryStake + bet.outcomeStake} Tappi` : 'Preparati, il prossimo potresti essere tu');
  }
  return {
    key: `spin:${s.turn.number}`,
    render: () => {
      const pad = createSpinPad({ onSpin: (force) => ctx.send({ kind: 'spin', force }) });
      return h('div', { class: 'panel panel-fill' }, h('div', { class: 'eyebrow' }, s.turn.happyHour ? '🟣 Happy Hour · tocca a te' : 'Tocca a te'), pad);
    },
  };
}

// ======================================================================== ATTERRAGGIO / SCELTE

function landingPanel(ctx) {
  const { s } = ctx;
  const seg = s.wheel.segments[s.landing?.segmentIndex];
  const info = segmentInfo(seg);
  return {
    key: `landing:${s.turn.number}`,
    render: () => h('div', { class: 'panel', style: { '--sc': info.glow } }, h('div', { class: 'eyebrow' }, `${ctx.name(s.turnPlayerId)} si ferma su`), h('h2', { class: 'panel-title landing-title' }, info.label), h('div', { class: 'feed-holder' })),
    update: (el, c) => el.querySelector('.feed-holder').replaceChildren(feedLines(c.s.landing?.lines)),
  };
}

function choicePanel(ctx) {
  const { s, p } = ctx;
  if (!p?.choice) return infoPanel(`choice-wait-${s.choice?.kind}`, '🤔', `${ctx.name(s.choice?.playerId)} sta scegliendo`, s.choice?.title ?? '');
  return {
    key: `choice:${p.choice.kind}:${p.choice.options.map((o) => o.value).join()}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, p.choice.title),
        h('div', { class: 'choice-list' }, p.choice.options.map((o) => actionButton(o.label, () => ctx.send({ kind: 'choose', value: o.value }), 'btn btn-choice'))),
      ),
  };
}

// ======================================================================== EVENTI

function eventPanel(ctx) {
  const ev = ctx.s.event;
  if (!ev) return infoPanel('event-wait', '⏳', '...', '');
  switch (ev.kind) {
    case 'trivia':
    case 'duel':
      return triviaPanel(ctx, ev);
    case 'impostor':
      return impostorPanel(ctx, ev);
    case 'pour':
      return pourPanel(ctx, ev);
    case 'auction':
      return auctionPanel(ctx, ev);
    case 'price':
      return pricePanel(ctx, ev);
    case 'fortune':
      return infoPanel(`fortune`, ev.delta >= 0 ? '🍀' : '💀', ev.delta >= 0 ? `+${ev.delta} Tappi` : `${ev.delta} Tappi`, `${ctx.name(ev.playerId)} ${ev.delta >= 0 ? 'trova Tappi per terra' : 'rovescia la birra'}`);
    default:
      return infoPanel('event-unknown', '⚡', eventTitle(ev), '');
  }
}

function header(ev, extra = null) {
  return h('div', { class: 'event-header' }, h('div', { class: 'eyebrow' }, eventTitle(ev)), extra);
}

function triviaPanel(ctx, ev) {
  const { p, meId, sabotage } = ctx;
  const isDuelist = ev.kind !== 'duel' || ev.duelists.includes(meId);
  const answered = p?.event?.answered;
  const show = (text) => (sabotage.dyslexia ? scramble(text) : text);

  if (ev.stage === 'reveal') {
    const mine = ev.results?.find((r) => r.playerId === meId);
    return {
      key: `trivia:reveal:${ev.question}`,
      render: () =>
        h(
          'div',
          { class: 'panel' },
          header(ev),
          h('p', { class: 'question small-q' }, ev.question),
          h('div', { class: 'answer-reveal' }, h('span', { class: 'muted small' }, 'Risposta'), h('b', {}, ev.answer)),
          mine ? h('div', { class: `my-result ${mine.correct ? 'ok' : 'ko'}` }, mine.correct ? `Giusto! ${signed(mine.delta)} Tappi` : mine.delta ? `Sbagliato: ${signed(mine.delta)} Tappi` : 'Niente punti stavolta') : null,
          ev.kind === 'duel' ? h('div', { class: 'my-result' }, ev.winnerId ? `⚔️ Vince ${ctx.name(ev.winnerId)} (+${ev.transferred})` : '⚔️ Nessun vincitore') : null,
          ev.note ? h('p', { class: 'note' }, ev.note) : null,
        ),
    };
  }

  if (!isDuelist) {
    return infoPanel(`duel-watch:${ev.question}`, '⚔️', `Sfida: ${ctx.name(ev.duelists[0])} vs ${ctx.name(ev.duelists[1])}`, ev.question);
  }
  if (answered) {
    return { key: `trivia:answered:${ev.question}`, render: () => h('div', { class: 'panel panel-center' }, header(ev), h('p', { class: 'question' }, ev.question), h('div', { class: 'sent' }, `Risposta inviata: «${p.event.given}»`), waiting('Aspettiamo gli altri...')) };
  }

  if (ev.mode === 'TRIVIA_CHOICE') {
    return {
      key: `trivia:choice:${ev.question}:${sabotage.dyslexia}:${sabotage.foam}`,
      render: () =>
        h(
          'div',
          { class: 'panel' },
          header(ev),
          h('p', { class: 'question' }, ev.question),
          sabotage.foam ? h('p', { class: 'foam-hint' }, '🫗 Ti hanno lanciato una Birra Analcolica: scoppia la schiuma (2 tocchi)!') : null,
          h(
            'div',
            { class: 'options' },
            ev.options.map((opt, i) => {
              const btn = h('button', { type: 'button', class: `option opt-${i}`, onclick: () => { vibrate(20); ctx.send({ kind: 'answer', choice: i }); } }, h('span', { class: 'opt-letter' }, 'ABCD'[i]), h('span', {}, show(opt)));
              return sabotage.foam ? foamCover(btn, i) : btn;
            }),
          ),
        ),
    };
  }

  return {
    key: `trivia:open:${ev.question}:${sabotage.foam}`,
    render: () => {
      const input = h('input', { class: 'input', type: 'text', placeholder: 'Scrivi la risposta', maxLength: 60, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'send' });
      const submit = () => input.value.trim() && ctx.send({ kind: 'answer', text: input.value.trim() });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      if (!sabotage.foam) setTimeout(() => input.focus(), 50);
      const field = sabotage.foam ? foamCover(h('div', { class: 'foam-field' }, input, actionButton('INVIA', submit)), 0, () => input.focus()) : h('div', { class: 'foam-field' }, input, actionButton('INVIA', submit));
      return h('div', { class: 'panel' }, header(ev), h('p', { class: 'question' }, ev.question), h('p', { class: 'small muted' }, 'Risposta aperta: basta anche il cognome, i refusi piccoli sono perdonati'), field);
    },
  };
}

function impostorPanel(ctx, ev) {
  const { p, meId } = ctx;
  const role = p?.event;
  if (ev.stage === 'reveal') {
    const mine = ev.results?.find((r) => r.playerId === meId);
    return {
      key: 'impostor:reveal',
      render: () =>
        h(
          'div',
          { class: 'panel panel-center' },
          header(ev),
          h('div', { class: 'panel-icon' }, ev.caught ? '🕵️' : '🎭'),
          h('h2', { class: 'panel-title' }, ev.caught ? `Preso! Era ${ctx.name(ev.impostorId)}` : `${ctx.name(ev.impostorId)} l'ha fatta franca`),
          h('p', { class: 'muted' }, `La parola era «${ev.word}»`),
          mine?.delta ? h('div', { class: `my-result ${mine.delta > 0 ? 'ok' : 'ko'}` }, `${signed(mine.delta)} Tappi`) : null,
        ),
    };
  }
  const roleCard = role
    ? role.role === 'impostor'
      ? h('div', { class: 'role-card impostor' }, h('div', { class: 'eyebrow' }, 'Sei l\'IMPOSTORE'), h('div', { class: 'role-word' }, `Tema: ${role.theme}`), h('p', { class: 'small' }, 'Bluffa: scrivi un indizio credibile'))
      : h('div', { class: 'role-card' }, h('div', { class: 'eyebrow' }, `Tema: ${role.theme}`), h('div', { class: 'role-word' }, role.word), h('p', { class: 'small' }, 'Dai un indizio, ma non troppo facile!'))
    : null;

  if (ev.stage === 'clue') {
    if (ev.submitted.includes(meId)) return { key: 'impostor:clue-sent', render: () => h('div', { class: 'panel panel-center' }, header(ev), roleCard, waiting(`Indizi inviati: ${ev.submitted.length}`)), update: (el, c) => (el.querySelector('.waiting span').textContent = `Indizi inviati: ${c.s.event?.submitted.length ?? 0}`) };
    return {
      key: 'impostor:clue',
      render: () => {
        const input = h('input', { class: 'input', type: 'text', placeholder: 'Il tuo indizio (una parola)', maxLength: 24, autocomplete: 'off', enterKeyHint: 'send' });
        const submit = () => input.value.trim() && ctx.send({ kind: 'clue', text: input.value.trim() });
        input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
        return h('div', { class: 'panel' }, header(ev), roleCard, input, actionButton('INVIA INDIZIO', submit));
      },
    };
  }
  // voto
  const voted = ev.voted.includes(meId);
  return {
    key: `impostor:vote:${voted}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        header(ev),
        h('h2', { class: 'panel-title' }, voted ? 'Voto inviato' : 'Chi è l\'impostore?'),
        h(
          'div',
          { class: 'clue-list' },
          ev.clues.map((c) =>
            h(
              'button',
              {
                type: 'button',
                class: 'clue-btn',
                disabled: voted || c.playerId === meId,
                onclick: () => ctx.send({ kind: 'vote', target: c.playerId }),
              },
              beerIcon(ctx.player(c.playerId)?.beer, 'xs'),
              h('span', { class: 'clue-name' }, ctx.name(c.playerId)),
              h('span', { class: 'clue-text' }, `«${c.text}»`),
            ),
          ),
        ),
      ),
  };
}

function pourPanel(ctx, ev) {
  const { meId } = ctx;
  if (ev.stage === 'reveal') {
    const sorted = [...ev.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return {
      key: 'pour:reveal',
      render: () =>
        h(
          'div',
          { class: 'panel' },
          header(ev),
          h('p', { class: 'small muted' }, 'Obiettivo: 95% senza traboccare'),
          h('div', { class: 'results' }, sorted.map((r) => resultLine(ctx, r.playerId, r.level === null ? 'non ha spillato' : r.overflow ? `${Math.round(r.level * 100)}% · trabocca!` : `${Math.round(r.level * 100)}%`, r.delta))),
        ),
    };
  }
  if (ev.done.includes(meId)) return infoPanel('pour-done', '🍺', 'Spillata!', 'Vediamo chi ha la mano più ferma...');
  return {
    key: 'pour:play',
    render: () => {
      const liquid = h('div', { class: 'pour-liquid' });
      const foam = h('div', { class: 'pour-foam' });
      const mask = h('div', { class: 'pour-mask' }, '?');
      const target = h('div', { class: 'pour-target' });
      const glass = h('div', { class: 'pour-glass' }, liquid, foam, mask, target);
      const label = h('div', { class: 'pour-label' }, 'Tieni premuto per spillare');
      const btn = h('button', { type: 'button', class: 'btn btn-gold btn-huge pour-btn' }, 'TIENI PREMUTO');
      let start = 0;
      let raf = 0;
      let sent = false;
      const levelAt = (now) => (now - start) / ev.fillMs;
      const draw = (level) => {
        const visible = Math.min(level, 1.05);
        liquid.style.height = `${visible * 82}%`;
        foam.style.bottom = `${visible * 82}%`;
        mask.classList.toggle('show', level > ev.hideAfter);
        glass.classList.toggle('overflow', level > 1);
      };
      const loop = (now) => {
        draw(levelAt(now));
        raf = requestAnimationFrame(loop);
      };
      btn.addEventListener('pointerdown', (e) => {
        if (sent) return;
        btn.setPointerCapture(e.pointerId);
        start = performance.now();
        label.textContent = 'Spillando... rilascia al momento giusto';
        vibrate(15);
        raf = requestAnimationFrame(loop);
      });
      const release = () => {
        if (!start || sent) return;
        cancelAnimationFrame(raf);
        sent = true;
        const level = levelAt(performance.now());
        draw(level);
        vibrate(level > 1 ? [60, 40, 60] : 30);
        ctx.send({ kind: 'pour', level });
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      return h('div', { class: 'panel panel-center' }, header(ev), glass, label, btn);
    },
  };
}

function auctionPanel(ctx, ev) {
  const { p, meId } = ctx;
  if (ev.stage === 'reveal') {
    return {
      key: 'auction:reveal',
      render: () =>
        h(
          'div',
          { class: 'panel' },
          header(ev),
          h('h2', { class: 'panel-title' }, ev.winnerId ? `Vince ${ctx.name(ev.winnerId)}` : 'Nessuna puntata'),
          h(
            'div',
            { class: 'results' },
            [...ev.bids].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1)).map((b) => resultLine(ctx, b.playerId, b.amount === null ? 'non ha puntato' : `${b.amount} Tappi${b.playerId === ev.winnerId ? ' · VINCE 200' : b.playerId === ev.secondId ? ' · secondo, perde tutto' : ''}`)),
          ),
        ),
    };
  }
  if (ev.done.includes(meId)) return infoPanel('auction-done', '🔨', `Hai puntato ${p?.event?.bid ?? ''} Tappi`, 'Occhio: il secondo perde la puntata!');
  ctx.ui.bid ??= 0;
  return {
    key: 'auction:bid',
    render: () => {
      const max = p?.coins ?? 0;
      const value = h('div', { class: 'bid-value' }, `${ctx.ui.bid}`);
      const slider = h('input', { class: 'slider', type: 'range', min: 0, max, step: 5, value: ctx.ui.bid });
      const setBid = (v) => {
        ctx.ui.bid = Math.max(0, Math.min(max, v));
        slider.value = ctx.ui.bid;
        value.textContent = `${ctx.ui.bid}`;
      };
      slider.addEventListener('input', () => setBid(Number(slider.value)));
      return h(
        'div',
        { class: 'panel' },
        header(ev),
        h('p', { class: 'muted small' }, `In palio ${ev.prize} Tappi. Chi punta di più li vince (pagando la puntata), il secondo perde la sua.`),
        value,
        slider,
        h('div', { class: 'quick-row' }, [10, 50, 100].map((d) => h('button', { type: 'button', class: 'btn btn-small', onclick: () => setBid(ctx.ui.bid + d) }, `+${d}`)), h('button', { type: 'button', class: 'btn btn-small', onclick: () => setBid(0) }, 'Zero')),
        actionButton('PUNTA', () => ctx.send({ kind: 'bid', amount: ctx.ui.bid })),
      );
    },
  };
}

function pricePanel(ctx, ev) {
  const { meId } = ctx;
  if (ev.stage === 'reveal') {
    const sorted = [...ev.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return {
      key: 'price:reveal',
      render: () =>
        h(
          'div',
          { class: 'panel' },
          header(ev),
          h('p', { class: 'question small-q' }, ev.question),
          h('div', { class: 'answer-reveal' }, h('span', { class: 'muted small' }, 'Risposta'), h('b', {}, `${formatNumber(ev.answer, ev.step)} ${ev.unit}`)),
          h('div', { class: 'results' }, sorted.map((r) => resultLine(ctx, r.playerId, r.guess === null ? '—' : `${formatNumber(r.guess, ev.step)} ${ev.unit}`, r.delta))),
          ev.note ? h('p', { class: 'note' }, ev.note) : null,
        ),
    };
  }
  if (ev.done.includes(meId)) return infoPanel('price-done', '📏', 'Valore inviato', ev.question);
  ctx.ui.guess ??= Math.round((ev.min + ev.max) / 2 / ev.step) * ev.step;
  return {
    key: `price:guess:${ev.question}`,
    render: () => {
      const number = h('input', { class: 'input input-number', type: 'number', inputMode: 'decimal', min: ev.min, max: ev.max, step: ev.step, value: ctx.ui.guess });
      const slider = h('input', { class: 'slider', type: 'range', min: ev.min, max: ev.max, step: ev.step, value: ctx.ui.guess });
      slider.addEventListener('input', () => {
        ctx.ui.guess = Number(slider.value);
        number.value = slider.value;
      });
      number.addEventListener('input', () => {
        ctx.ui.guess = Number(number.value);
        slider.value = number.value;
      });
      return h(
        'div',
        { class: 'panel' },
        header(ev),
        h('p', { class: 'question' }, ev.question),
        h('div', { class: 'number-row' }, number, ev.unit ? h('span', { class: 'unit' }, ev.unit) : null),
        slider,
        h('div', { class: 'range-labels' }, h('span', {}, formatNumber(ev.min, ev.step)), h('span', {}, formatNumber(ev.max, ev.step))),
        actionButton('CONFERMA', () => ctx.send({ kind: 'guess', value: ctx.ui.guess })),
      );
    },
  };
}

// ======================================================================== FINE TURNO / PARTITA

function turnResultPanel(ctx) {
  const { s, meId } = ctx;
  const sum = s.turnSummary;
  const myBets = sum?.bets?.filter((b) => b.playerId === meId) ?? [];
  return {
    key: `turn-result:${s.turn.number}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, `Fine turno ${s.turn.number}/${s.turn.total}`),
        h('h2', { class: 'panel-title' }, sum ? `${ctx.name(sum.playerId)}: ${signed(sum.net)} Tappi` : 'Riepilogo'),
        myBets.map((b) => h('div', { class: `my-result ${b.result === 'win' ? 'ok' : b.result === 'lose' ? 'ko' : ''}` }, `Scommessa «${b.outcome === 'gain' ? 'guadagna' : 'perde'}»: ${b.result === 'win' ? `vinta (${signed(b.delta)})` : b.result === 'lose' ? `persa (${signed(b.delta)})` : 'annullata'}`)),
        feedLines(sum?.lines),
      ),
  };
}

function awardsPanel(ctx) {
  const { s } = ctx;
  return {
    key: `awards:${s.awards.length}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, 'Bonus Segreti'),
        h('h2', { class: 'panel-title' }, '+1 Pinta d\'Oro a testa'),
        s.awards.map((a) =>
          h(
            'div',
            { class: 'award-card' },
            h('div', { class: 'award-icon' }, a.icon),
            h('div', {}, h('div', { class: 'award-title' }, a.title), h('div', { class: 'small muted' }, a.description), h('div', { class: 'award-winners' }, a.winners.length ? `${a.winners.map((id) => ctx.name(id)).join(', ')}${a.value ? ` · ${a.value}` : ''}` : 'Nessuno')),
          ),
        ),
      ),
  };
}

function gameOverPanel(ctx) {
  const { s, meId } = ctx;
  const vip = s.vipId === meId;
  return {
    key: `gameover:${s.ranking.join()}`,
    render: () =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'eyebrow' }, 'Classifica finale'),
        h('h2', { class: 'panel-title' }, `🏆 ${ctx.name(s.ranking[0])}`),
        h(
          'div',
          { class: 'results' },
          s.ranking.map((id, i) => {
            const p = ctx.player(id);
            return h('div', { class: `result-row ${id === meId ? 'me' : ''}` }, h('span', { class: 'rank' }, `${i + 1}`), beerIcon(p?.beer, 'xs'), h('span', { class: 'result-name', style: { color: p?.color } }, p?.name), h('span', { class: 'result-text' }, `🍺 ${p?.pints ?? 0} · ${p?.coins ?? 0} Tappi`));
          }),
        ),
        vip ? actionButton('NUOVA PARTITA', () => ctx.send({ kind: 'new_game' })) : waiting(`${ctx.name(s.vipId)} può avviare una nuova partita`),
      ),
  };
}
