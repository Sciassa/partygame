/**
 * Simulatore headless di «Spin & Sip»:   pnpm simulate [partite] [seed]
 *
 * Gioca partite complete con bot casuali e un orologio finto (nessun browser, nessuna rete),
 * controllando a ogni passo le invarianti del regolamento:
 *  - Tappi e Pinte mai negativi e sempre interi
 *  - ogni birra addosso a un solo giocatore connesso (pool)
 *  - la partita arriva sempre a GAME_OVER con i 3 Bonus Segreti assegnati
 *  - nessuna eccezione nel motore
 * I bot comprano adesivi, scommettono, rispondono, giocano i minigiochi, si disconnettono e rientrano.
 */
import { GameState } from '../src/host/state/GameState.js';
import { GameEngine } from '../src/host/game/GameEngine.js';
import { PHASE } from '../src/shared/protocol.js';

const GAMES = Number(process.argv[2] ?? 60);
const SEED = Number(process.argv[3] ?? 42);

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t >>> 0) / 4294967296);
  };
}

const flush = () => new Promise((r) => setImmediate(r));

async function playGame(gameIndex) {
  const rng = mulberry32(SEED * 1000 + gameIndex);
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const schedule = (fn, ms) => {
    const id = ++timerId;
    timers.set(id, { at: now + Math.max(0, ms), fn, id });
    return id;
  };
  const cancel = (id) => timers.delete(id);

  const state = new GameState({ mode: 'salotto', roomCode: 'SIMU' });
  const stats = { stickers: 0, pints: 0, events: {}, sabotages: 0, happy: false, topSlot: 0, counter: {}, emotes: 0 };
  const engine = new GameEngine(state, {
    rng,
    now: () => now,
    schedule,
    cancel,
    log: () => {},
    onEvent: (e) => {
      if (e.type === 'sticker') stats.stickers++;
      if (e.type === 'pint') stats.pints++;
      if (e.type === 'happy_hour') stats.happy = true;
      if (e.type === 'top_slot_hit') stats.topSlot++;
      if (['bounty', 'bounty_claimed', 'sneaky', 'shot', 'splash'].includes(e.type)) stats.counter[e.type] = (stats.counter[e.type] ?? 0) + 1;
    },
  });

  const nPlayers = 2 + Math.floor(rng() * 7);
  for (let i = 0; i < nPlayers; i++) state.joinPlayer(`client-${i}`, `Bot${i}`);
  engine.hostAction({ kind: 'settings', totalTurns: [12, 15, 20][Math.floor(rng() * 3)], shopPints: rng() < 0.5 });
  if (!engine.hostAction({ kind: 'start' })) throw new Error('start rifiutato');

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const act = (pid, a) => engine.handleAction(pid, a);
  let lastKey = '';

  const botsReact = () => {
    const s = engine.snapshot();
    const key = [s.phase, s.turn.number, s.event?.kind, s.event?.stage, s.choice?.playerId, s.choice?.kind].join('|');
    if (key === lastKey) return;
    lastKey = key;
    if (s.event?.kind) stats.events[s.event.kind] = (stats.events[s.event.kind] ?? 0) + (s.event.stage === 'reveal' ? 0 : 1) * 0 + 0;
    for (const p of state.players.filter((x) => x.connected)) {
      const priv = engine.privateFor(p.id);
      if (priv.sabotage && Object.values(priv.sabotage).some(Boolean)) stats.sabotages++;
      const delay = 100 + rng() * 6000;
      schedule(() => {
        const cur = engine.snapshot();
        const mine = engine.privateFor(p.id);
        if (!p.connected) return;
        // Bancone & Sottobanco: a inizio turno qualcuno trama qualcosa
        if (mine.counter?.open && rng() < 0.25) {
          const others = state.players.filter((x) => x.connected && x.id !== p.id);
          const target = others.length ? pick(others).id : null;
          const r = rng();
          if (mine.counter.canUseShot && r < 0.6) act(p.id, { kind: 'counter_use', targetId: target });
          else if (r < 0.3) act(p.id, { kind: 'counter_bounty', targetId: target });
          else if (r < 0.55) act(p.id, { kind: 'counter_slip', targetId: target, amount: pick([20, 50]) });
          else act(p.id, { kind: 'counter_buy', shot: pick(['assenzio', 'tequila', 'analcolica']) });
        }
        if (rng() < 0.2 && engine.emote(p.id, pick(['cheers', 'laugh', 'boo', 'fire']))) stats.emotes++;
        switch (cur.phase) {
          case PHASE.SHOP:
            if (cur.shop?.playerId !== p.id || !mine.shop) return;
            if (rng() < 0.25) return act(p.id, { kind: 'shop_skip' });
            if (mine.shop.canBuyPint && rng() < 0.3) return act(p.id, { kind: 'shop_pint' });
            {
              const offer = pick(mine.shop.offers);
              const options = offer.costs.map((c, i) => [c, i]).filter(([c]) => c !== null && c <= mine.coins);
              if (options.length) act(p.id, { kind: 'shop_place', stickerId: offer.id, segmentIndex: pick(options)[1] });
            }
            return;
          case PHASE.BETTING:
            if (cur.turnPlayerId === p.id || rng() < 0.2) return;
            return act(p.id, {
              kind: 'bet',
              category: pick(['trivia', 'minigame', 'fortune', 'keg', null]),
              categoryStake: pick([0, 15, 30]),
              outcome: pick(['gain', 'loss', null]),
              outcomeStake: pick([0, 15, 30]),
            });
          case PHASE.AWAIT_SPIN:
            if (cur.turnPlayerId === p.id && rng() < 0.9) act(p.id, { kind: 'spin', force: rng() });
            return;
          case PHASE.CHOICE:
            if (mine.choice) act(p.id, { kind: 'choose', value: pick(mine.choice.options).value });
            return;
          case PHASE.EVENT: {
            const ev = cur.event;
            if (!ev) return;
            if ((ev.kind === 'trivia' || ev.kind === 'duel') && ev.stage === 'question') {
              return act(p.id, ev.mode === 'TRIVIA_CHOICE' ? { kind: 'answer', choice: Math.floor(rng() * 4) } : { kind: 'answer', text: pick(['Canberra', 'Messi', 'boh', '1989', 'Napoli']) });
            }
            if (ev.kind === 'impostor' && ev.stage === 'clue') return act(p.id, { kind: 'clue', text: pick(['birra', 'rosso', 'caldo', 'veloce']) });
            if (ev.kind === 'impostor' && ev.stage === 'vote') {
              const others = state.players.filter((x) => x.connected && x.id !== p.id);
              if (others.length) act(p.id, { kind: 'vote', target: pick(others).id });
              return;
            }
            if (ev.kind === 'pour' && ev.stage === 'pour') return act(p.id, { kind: 'pour', level: 0.5 + rng() * 0.65 });
            if (ev.kind === 'auction' && ev.stage === 'bid') return act(p.id, { kind: 'bid', amount: Math.floor(rng() * (mine.coins + 1)) });
            if (ev.kind === 'price' && ev.stage === 'guess') return act(p.id, { kind: 'guess', value: ev.min + rng() * (ev.max - ev.min) });
            return;
          }
          default:
        }
      }, delay);
    }
    if (s.event?.kind && s.event.stage !== 'reveal') stats.events[s.event.kind] = (stats.events[s.event.kind] ?? 0) + 1;
  };

  const check = () => {
    const seen = new Set();
    for (const p of state.players) {
      if (!Number.isInteger(p.coins) || p.coins < 0) throw new Error(`Tappi non validi per ${p.name}: ${p.coins}`);
      if (!Number.isInteger(p.pints) || p.pints < 0) throw new Error(`Pinte non valide per ${p.name}: ${p.pints}`);
      if (p.connected) {
        if (!p.beer || seen.has(p.beer)) throw new Error(`Birra duplicata/mancante: ${p.beer}`);
        seen.add(p.beer);
      }
    }
    for (const seg of state.segments) if (![1, 2, 3].includes(seg.size)) throw new Error('size spicchio non valida');
    if (!state.beers.check()) throw new Error('Pool birre incoerente');
    for (const p of state.players) {
      if (p.connected && state.beers.beerOf(p.id) !== p.beer) throw new Error(`Birra di ${p.name} non allineata al pool`);
      if (p.shot && !['assenzio', 'tequila', 'analcolica'].includes(p.shot)) throw new Error('Shot non valido');
    }
    for (const [target, b] of engine.bounties) if (!state.getPlayer(target) || b.turnsLeft < 1 || b.turnsLeft > 2) throw new Error('Taglia non valida');
  };

  let steps = 0;
  while (engine.phase !== PHASE.GAME_OVER) {
    await flush();
    botsReact();
    check();
    // disconnessioni/rientri casuali (anche del giocatore di turno)
    if (rng() < 0.002) {
      const p = pick(state.players);
      if (p.connected && state.players.filter((x) => x.connected).length > 1) {
        state.disconnectPlayer(p.id);
        engine.onPlayerLeft(p);
      } else if (!p.connected && !state.isFull()) {
        state.joinPlayer(p.clientId, p.name);
        engine.onPlayerJoined(p);
      }
    }
    const next = [...timers.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!next) throw new Error(`Motore bloccato in fase ${engine.phase} senza timer`);
    timers.delete(next.id);
    now = next.at;
    next.fn();
    if (++steps > 200000) throw new Error('Troppi passi: partita infinita?');
  }
  await flush();
  check();
  const s = engine.snapshot();
  if (s.awards.length !== 3) throw new Error('Bonus Segreti mancanti');
  if (s.ranking.length !== state.players.length) throw new Error('Classifica incompleta');
  return { players: nPlayers, turns: s.turn.total, minutes: now / 60000, stats, winner: state.getPlayer(s.ranking[0]) };
}

let totalMinutes = 0;
const agg = { stickers: 0, pints: 0, sabotages: 0, happy: 0, topSlot: 0, events: {}, counter: {}, emotes: 0 };
for (let g = 0; g < GAMES; g++) {
  const r = await playGame(g);
  totalMinutes += r.minutes;
  agg.stickers += r.stats.stickers;
  agg.pints += r.stats.pints;
  agg.sabotages += r.stats.sabotages;
  agg.topSlot += r.stats.topSlot;
  agg.happy += r.stats.happy ? 1 : 0;
  for (const [k, v] of Object.entries(r.stats.events)) agg.events[k] = (agg.events[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.stats.counter)) agg.counter[k] = (agg.counter[k] ?? 0) + v;
  agg.emotes += r.stats.emotes;
}
console.log(`OK: ${GAMES} partite simulate senza errori.`);
console.log(`Durata media (tempo di gioco simulato): ${(totalMinutes / GAMES).toFixed(1)} min`);
console.log(`Adesivi piazzati: ${agg.stickers} · Pinte comprate: ${agg.pints} · Top Slot centrati: ${agg.topSlot} · Happy Hour in ${agg.happy}/${GAMES} partite`);
console.log(`Eventi giocati: ${JSON.stringify(agg.events)}`);
console.log(`Bancone: ${JSON.stringify(agg.counter)} · emote accettate: ${agg.emotes}`);
