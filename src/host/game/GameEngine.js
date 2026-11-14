import { MODE, PHASE } from '../../shared/protocol.js';
import { SEGMENT_TYPE, segmentInfo, segmentName } from '../../shared/wheel/segments.js';
import { TAU, createEasePlan, mod, segmentLayout } from '../../shared/wheel/kinematics.js';
import { planSpin, resolveStop } from '../physics/WheelPhysics.js';
import { CATEGORIES, CATEGORY_IDS, getUsedQuestionsTracker } from '../../data/questions/index.ts';
import { ROYALTIES } from '../../data/stickers.ts';
import * as stickers from './stickerEngine.js';
import { runTrivia } from './events/trivia.js';
import { runImpostor } from './events/impostor.js';
import { runPour } from './events/pour.js';
import { runAuction } from './events/auction.js';
import { runPriceIsRight } from './events/priceIsRight.js';
import { computeAwards } from './awards.js';

/** Tempi delle fasi (ms). */
export const TIMING = Object.freeze({
  shop: 25000,
  betting: 8000,
  awaitSpin: 25000,
  spinSettle: 400,
  landing: 3200,
  choice: 15000,
  turnResult: 5500,
  award: 5000,
  noPlayersRetry: 2000,
});

export const SETTINGS_LIMITS = Object.freeze({ turns: [12, 15, 20] });
export const KEG_START_PRICE = 250;
export const KEG_PRICE_STEP = 50;
export const BET_STAKES = Object.freeze([0, 15, 30]);
export const HAPPY_HOUR_TURNS = 3;
const TOP_SLOT_MULTIPLIERS = [
  { id: 'x2', label: 'x2', weight: 45 },
  { id: 'x3', label: 'x3', weight: 25 },
  { id: 'jackpot', label: '+100', weight: 30 },
];
const MINIGAMES = ['impostor', 'pour', 'auction', 'price'];
export const MINIGAME_LABELS = Object.freeze({
  impostor: "L'Impostore Flash",
  pour: 'La Spillatura Perfetta',
  auction: 'Asta al Buio',
  price: 'Higher / Lower',
});

class Aborted extends Error {}

/**
 * Motore di gioco «Spin & Sip» (solo host). Gestisce regole, fasi, timer e punteggi;
 * non sa nulla di rete né di grafica: riceve azioni (`handleAction`) e notifica i cambiamenti.
 *
 * FLUSSO DI UN TURNO (codice async lineare in #playTurn):
 *   SHOP → PRE_SPIN_BETTING (8 s) → AWAIT_SPIN → SPINNING (con Top Slot) → LANDING
 *   (scommesse sulla categoria, Top Slot, royalties, effetto adesivo, eventuali scelte)
 *   → EVENT (trivia/minigioco) o Fortuna/Fusto → TURN_RESULT (scommesse sull'esito)
 * Dopo l'ultimo turno: ENDGAME_AWARDS (3 Bonus Segreti) → GAME_OVER.
 * Negli ultimi 3 turni è attiva l'HAPPY HOUR: tutti i Tappi vinti o persi valgono doppio.
 *
 * ECONOMIA: ogni movimento di Tappi passa da award()/spend(), dove si applicano Happy Hour,
 * Top Slot, Boost, Ancora e Jackpot. Così nessuna regola è sparsa nel codice.
 *
 * Tempo e casualità sono iniettabili (`now`, `schedule`, `rng`): il simulatore
 * (scripts/simulate-game.mjs) gioca centinaia di partite con un orologio finto.
 */
export class GameEngine {
  phase = PHASE.LOBBY;
  settings = { totalTurns: 12, shopPints: true }; // Pinte anche nel negozio: con un solo Fusto sulla ruota le Pinte sarebbero troppo rare
  turnNumber = 0;
  turnPlayerId = null;
  happyHour = false;
  kegPrice = KEG_START_PRICE;
  hiddenTurns = 0;
  spin = null;
  topSlot = null;
  landing = null;
  event = null;
  choice = null;
  shop = null;
  turn = null;
  turnSummary = null;
  awards = [];
  ranking = [];
  feed = [];
  deadlineAt = null;
  playerDeadlines = null;
  pendingSabotages = [];
  activeSabotages = [];
  dictatorQueue = [];
  lastSticker = null;
  coinHistory = [];
  eventPrivate = new Map();
  #inputHandler = null;
  #waiters = new Set();
  #gen = 0;
  #spinSeq = 0;
  #spinRequest = null;
  #turnCursor = -1;

  /**
   * @param {import('../state/GameState.js').GameState} state
   * @param {{ mode?:string, rng?:()=>number, now?:()=>number, schedule?:(fn:Function, ms:number)=>any,
   *           cancel?:(h:any)=>void, onChange?:()=>void, onEvent?:(e:object)=>void, log?:(msg:string)=>void }} deps
   */
  constructor(state, deps = {}) {
    this.state = state;
    this.mode = deps.mode ?? MODE.SALOTTO;
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? (() => performance.now());
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h));
    this.onChange = deps.onChange ?? (() => {});
    this.onEvent = deps.onEvent ?? (() => {});
    this.log = deps.log ?? ((msg) => console.info(msg));
    /** Acceleratore per test/debug (?speed=4): divide tutte le attese di gioco, non le animazioni. */
    this.speed = Math.min(10, Math.max(1, Number(deps.speed) || 1));
    this.questions = getUsedQuestionsTracker({ rng: this.rng });
    this.usedWords = new Set();
    this.usedNumbers = new Set();
  }

  // =================================================================== API verso HostCore

  onPlayerJoined() {
    this.changed();
  }

  onPlayerLeft() {
    this.changed();
  }

  /** Azioni dallo schermo host (Salotto): avvio, impostazioni, lancio di prova, nuova partita. */
  hostAction(action) {
    return this.#lobbyOrGlobalAction(null, action, true);
  }

  /** Azione di un giocatore (dal telefono). Restituisce true se accettata. */
  handleAction(playerId, action) {
    if (!action || typeof action.kind !== 'string') return false;
    const player = this.state.getPlayer(playerId);
    if (!player) return false;
    if (this.#lobbyOrGlobalAction(player, action, false)) return true;

    if (action.kind === 'spin') {
      if (this.phase !== PHASE.AWAIT_SPIN || playerId !== this.turnPlayerId || !this.#spinRequest) return false;
      this.#spinRequest(clamp01(action.force));
      return true;
    }
    return this.#inputHandler ? this.#inputHandler(playerId, action) !== false : false;
  }

  /** Ferma tutto (es. l'host chiude la stanza). */
  stop() {
    this.#abort();
  }

  #lobbyOrGlobalAction(player, action, fromHost) {
    const isVip = fromHost || (player && player.id === this.vipId());
    switch (action.kind) {
      case 'settings': {
        if (this.phase !== PHASE.LOBBY || !isVip) return false;
        if (SETTINGS_LIMITS.turns.includes(action.totalTurns)) this.settings.totalTurns = action.totalTurns;
        if (typeof action.shopPints === 'boolean') this.settings.shopPints = action.shopPints;
        this.changed();
        return true;
      }
      case 'start': {
        if (this.phase !== PHASE.LOBBY || !isVip || !this.connected().length) return false;
        this.#runGame().catch((err) => console.error('[spin&sip] errore nel motore di gioco', err));
        return true;
      }
      case 'new_game': {
        if (this.phase !== PHASE.GAME_OVER || !isVip) return false;
        this.#backToLobby();
        return true;
      }
      case 'debug_spin': {
        if (!fromHost || this.phase !== PHASE.AWAIT_SPIN || !this.#spinRequest) return false;
        this.#spinRequest(clamp01(action.force ?? 0.6));
        return true;
      }
      default:
        return false;
    }
  }

  /** Il "VIP" può avviare la partita dal telefono: in Pocket il creatore, in Salotto il primo arrivato. */
  vipId() {
    const owner = this.state.players.find((p) => p.isOwner && p.connected);
    if (owner) return owner.id;
    return this.connected()[0]?.id ?? null;
  }

  // =================================================================== snapshot

  snapshot() {
    const now = this.now();
    const hidden = this.hiddenTurns > 0;
    const vipId = this.vipId();
    const betsPlaced = this.turn?.bets ? [...this.turn.bets.keys()] : [];
    return {
      mode: this.mode,
      roomCode: this.state.roomCode,
      phase: this.phase,
      deadline: this.deadlineAt ? Math.max(0, Math.round(this.deadlineAt - now)) : null,
      settings: { ...this.settings },
      turn: { number: this.turnNumber, total: this.settings.totalTurns, happyHour: this.happyHour, playerId: this.turnPlayerId },
      hidden,
      vipId,
      players: this.state.publicPlayers().map((p) => ({
        ...p,
        coins: hidden ? null : p.coins,
        pints: hidden ? null : p.pints,
        betPlaced: betsPlaced.includes(p.id),
      })),
      turnPlayerId: this.turnPlayerId,
      wheel: { segments: this.state.segments, angle: this.state.wheelAngle },
      spin: this.spin ? { plan: this.spin.plan, elapsed: now - this.spin.startedAt, playerId: this.spin.playerId, topSlot: this.topSlot } : null,
      topSlot: this.topSlot,
      kegPrice: this.kegPrice,
      shop: this.shop ? { playerId: this.shop.playerId, purchased: this.shop.purchased } : null,
      landing: this.landing,
      event: this.event,
      choice: this.choice ? { kind: this.choice.kind, playerId: this.choice.playerId, title: this.choice.title } : null,
      turnSummary: this.turnSummary,
      awards: this.awards,
      ranking: this.ranking,
      feed: this.feed.slice(-6),
    };
  }

  /** Dati riservati a un giocatore: Tappi veri anche a classifica nascosta, timer, sabotaggi, negozio... */
  privateFor(playerId) {
    const player = this.state.getPlayer(playerId);
    if (!player) return null;
    const now = this.now();
    const own = this.playerDeadlines?.get(playerId);
    return {
      coins: player.coins,
      pints: player.pints,
      status: player.status,
      deadline: own ? Math.max(0, Math.round(own - now)) : null,
      sabotage: this.sabotageFlags(playerId),
      shop: this.shop && this.shop.playerId === playerId ? this.#shopView(player) : null,
      bet: this.turn?.bets?.get(playerId) ?? null,
      event: this.eventPrivate.get(playerId) ?? null,
      choice: this.choice && this.choice.playerId === playerId ? { kind: this.choice.kind, title: this.choice.title, options: this.choice.options } : null,
    };
  }

  // =================================================================== utilità condivise

  changed() {
    this.onChange();
  }

  connected() {
    return this.state.players.filter((p) => p.connected);
  }

  /** Classifica: prima le Pinte d'Oro, a parità i Tappi, poi l'ordine di arrivo. */
  rankingOf(players = this.connected()) {
    return [...players].sort((a, b) => b.pints - a.pints || b.coins - a.coins || a.joinedAt - b.joinedAt);
  }

  pick(items) {
    return items[Math.floor(this.rng() * items.length) % items.length];
  }

  randInt(min, max) {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /** Riga del registro del turno (mostrata su TV e telefoni). */
  line(text, tone = 'info') {
    const entry = { text, tone, turn: this.turnNumber };
    this.feed.push(entry);
    if (this.feed.length > 40) this.feed.shift();
    if (this.landing) this.landing.lines.push(entry);
    if (this.turn) this.turn.lines.push(entry);
    this.log(`[spin&sip] ${text}`);
    this.changed();
  }

  toast(playerId, text) {
    this.onEvent({ type: 'toast', to: playerId, text });
  }

  emit(event) {
    this.onEvent(event);
  }

  // =================================================================== economia

  /**
   * Movimento di Tappi verso/da un giocatore. Restituisce il delta effettivamente applicato.
   * @param {object} player
   * @param {number} amount        positivo = vince, negativo = perde
   * @param {{ reason?:string, boostable?:boolean, raw?:boolean, refund?:boolean }} opts
   *   - boostable: per il giocatore di turno si applicano Top Slot (x2/x3) e Boost
   *   - raw: niente moltiplicatori (trasferimenti tra giocatori, percentuali)
   *   - refund: rimborso (non bloccato dall'Ancora, non raddoppiato, non conta come guadagno)
   *   - bypassAnchor: scambi/ridistribuzioni, che l'Ancora non deve bloccare
   */
  award(player, amount, { reason = '', boostable = false, raw = false, refund = false, bypassAnchor = false } = {}) {
    if (!player || !amount) return 0;
    let delta = Math.round(amount);
    if (delta > 0 && !refund && !bypassAnchor && player.status.anchor > 0) {
      this.line(`⚓ ${player.name} è ancorato: niente guadagno (${reason})`, 'malus');
      return 0;
    }
    if (!raw && !refund) {
      if (delta > 0 && boostable && this.turn && player.id === this.turn.landerId) delta *= this.turn.multiplier * this.turn.boost;
      if (this.happyHour) delta *= 2;
    }
    if (delta < 0) delta = Math.max(delta, -player.coins);
    player.coins += delta;
    if (this.turn) {
      this.turn.ledger.push({ playerId: player.id, delta, reason });
      if (player.id === this.turn.landerId && !refund && reason !== 'scommessa') this.turn.landerNet += delta;
    }
    this.changed();
    return delta;
  }

  /** Spesa (negozio, scommesse, Fusto, aste): non raddoppia, alimenta i Jackpot. */
  spend(player, amount, reason = '') {
    amount = Math.round(amount);
    if (!player || amount <= 0) return amount === 0;
    if (player.coins < amount) return false;
    player.coins -= amount;
    player.stats.spent += amount;
    stickers.feedJackpots(this, amount);
    if (this.turn) this.turn.ledger.push({ playerId: player.id, delta: -amount, reason });
    this.changed();
    return true;
  }

  /** Converte Tappi in una Pinta d'Oro al prezzo corrente (che poi sale di 50). */
  buyPint(player) {
    const price = this.kegPrice;
    if (!this.spend(player, price, "Pinta d'Oro")) return false;
    player.pints += 1;
    player.stats.pintsBought += 1;
    this.kegPrice += KEG_PRICE_STEP;
    this.line(`🍺 ${player.name} compra una Pinta d'Oro per ${price} Tappi (ora costa ${this.kegPrice})`, 'gold');
    this.emit({ type: 'pint', playerId: player.id });
    return true;
  }

  // =================================================================== sabotaggi

  /** Flag di sabotaggio attivi per un giocatore nell'evento in corso. */
  sabotageFlags(playerId) {
    const flags = { blackout: false, shaky: false, dyslexia: false, delay: false, halfTime: false };
    if (!this.activeSabotages.length) return flags;
    const leaderId = this.rankingOf()[0]?.id;
    for (const sab of this.activeSabotages) {
      if (sab.id === 'sabotaggio') {
        if (playerId === leaderId && playerId !== sab.ownerId) flags.delay = true;
        continue;
      }
      if (playerId === sab.ownerId) continue; // il proprietario non subisce il proprio sabotaggio
      if (sab.id === 'blackout') flags.blackout = true;
      if (sab.id === 'dito_tremante') flags.shaky = true;
      if (sab.id === 'dislessia') flags.dyslexia = true;
      if (sab.id === 'fuso_orario') flags.halfTime = true;
    }
    return flags;
  }

  /** Inizio di un evento sui telefoni: i sabotaggi in coda diventano attivi (Lv.2 = 2 eventi). */
  beginEventSabotage() {
    this.activeSabotages = this.pendingSabotages.map((s) => ({ ...s }));
    this.pendingSabotages = this.pendingSabotages.map((s) => ({ ...s, events: s.events - 1 })).filter((s) => s.events > 0);
    for (const s of this.activeSabotages) this.line(`${s.icon} Sabotaggio attivo: ${s.name}`, 'malus');
  }

  endEventSabotage() {
    this.activeSabotages = [];
  }

  // =================================================================== attese e input

  /** Pausa annullabile (se la partita viene interrotta, lancia Aborted). `real` = non accelerabile. */
  sleep(ms, real = false) {
    return this.#wait((done) => this.schedule(done, real ? ms : ms / this.speed));
  }

  /**
   * Raccoglie input dai giocatori fino a scadenza o completamento.
   * Il Fuso Orario dimezza la scadenza personale dei giocatori colpiti.
   * @param {{ ms:number, players:object[], onInput:(pid:string, action:object)=>boolean|void, isComplete?:()=>boolean }} o
   */
  collect({ ms, players, onInput, isComplete = () => false }) {
    ms /= this.speed;
    const start = this.now();
    const deadlines = new Map(players.map((p) => [p.id, start + ms * (this.sabotageFlags(p.id).halfTime ? 0.5 : 1)]));
    const end = deadlines.size ? Math.max(...deadlines.values()) : start;
    this.deadlineAt = end;
    this.playerDeadlines = deadlines;
    return this.#wait((done) => {
      const finish = () => {
        this.cancel(timer);
        if (this.#inputHandler === handler) this.#inputHandler = null;
        this.deadlineAt = null;
        this.playerDeadlines = null;
        done();
      };
      const handler = (pid, action) => {
        if (!deadlines.has(pid) || this.now() > deadlines.get(pid) + 400) return false;
        const accepted = onInput(pid, action);
        this.changed();
        if (isComplete()) finish();
        return accepted;
      };
      this.#inputHandler = handler;
      const timer = this.schedule(finish, end - start);
      if (!deadlines.size || isComplete()) finish();
      this.changed();
    });
  }

  /**
   * Scelta di un singolo giocatore (Fusto, rivale, categoria): restituisce l'opzione scelta
   * o quella di default allo scadere del tempo.
   */
  async choose({ player, kind, title, options, fallback, ms = TIMING.choice }) {
    this.choice = { kind, playerId: player.id, title, options };
    this.phase = PHASE.CHOICE;
    let picked = null;
    await this.collect({
      ms: player.connected ? ms : 0,
      players: [player],
      onInput: (pid, a) => {
        if (a.kind !== 'choose' || !options.some((o) => o.value === a.value)) return false;
        picked = a.value;
        return true;
      },
      isComplete: () => picked !== null,
    });
    this.choice = null;
    return picked ?? fallback;
  }

  #wait(executor) {
    const gen = this.#gen;
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.#waiters.delete(done);
        resolve();
      };
      this.#waiters.add(done);
      executor(done);
    }).then(() => {
      if (gen !== this.#gen) throw new Aborted();
    });
  }

  #abort() {
    this.#gen++;
    this.#inputHandler = null;
    this.#spinRequest = null;
    for (const done of [...this.#waiters]) done();
  }

  // =================================================================== partita

  async #runGame() {
    this.#resetGame();
    this.line(`🎬 Si parte! ${this.settings.totalTurns} turni, vince chi ha più Pinte d'Oro`, 'gold');
    try {
      while (this.turnNumber < this.settings.totalTurns) {
        const player = this.#nextTurnPlayer();
        if (!player) {
          await this.sleep(TIMING.noPlayersRetry); // nessuno connesso: aspettiamo
          continue;
        }
        this.turnNumber += 1;
        const wasHappy = this.happyHour;
        this.happyHour = this.turnNumber > this.settings.totalTurns - HAPPY_HOUR_TURNS;
        if (this.happyHour && !wasHappy) {
          this.line('🟣 HAPPY HOUR! Negli ultimi 3 turni tutti i Tappi vinti o persi valgono doppio', 'gold');
          this.emit({ type: 'happy_hour' });
        }
        await this.#playTurn(player);
      }
      await this.#endgameAwards();
      this.phase = PHASE.GAME_OVER;
      this.ranking = this.rankingOf(this.state.players).map((p) => p.id);
      const winner = this.state.getPlayer(this.ranking[0]);
      if (winner) this.line(`🏆 ${winner.name} vince «Spin & Sip» con ${winner.pints} Pinte d'Oro!`, 'gold');
      this.emit({ type: 'game_over', winnerId: winner?.id });
      this.changed();
    } catch (err) {
      if (!(err instanceof Aborted)) throw err;
    }
  }

  #resetGame() {
    this.state.resetForNewGame();
    this.state.wheelAngle = 0;
    this.turnNumber = 0;
    this.happyHour = false;
    this.kegPrice = KEG_START_PRICE;
    this.hiddenTurns = 0;
    this.pendingSabotages = [];
    this.activeSabotages = [];
    this.dictatorQueue = [];
    this.lastSticker = null;
    this.coinHistory = [];
    this.awards = [];
    this.ranking = [];
    this.feed = [];
    this.turnSummary = null;
    this.#turnCursor = -1;
    this.questions = getUsedQuestionsTracker({ rng: this.rng });
    this.usedWords.clear();
    this.usedNumbers.clear();
  }

  #backToLobby() {
    this.#abort();
    this.phase = PHASE.LOBBY;
    this.turnPlayerId = null;
    this.turn = null;
    this.spin = null;
    this.topSlot = null;
    this.landing = null;
    this.event = null;
    this.choice = null;
    this.shop = null;
    this.happyHour = false;
    this.awards = [];
    this.ranking = [];
    this.turnSummary = null;
    this.eventPrivate.clear();
    this.state.resetForNewGame();
    this.changed();
  }

  /** Prossimo giocatore connesso in ordine di arrivo; il Buco Nero fa saltare il turno. */
  #nextTurnPlayer() {
    const players = [...this.state.players].sort((a, b) => a.joinedAt - b.joinedAt);
    if (!players.some((p) => p.connected)) return null;
    for (let tries = 0; tries < players.length * 4; tries++) {
      this.#turnCursor = (this.#turnCursor + 1) % players.length;
      const candidate = players[this.#turnCursor];
      if (!candidate.connected) continue;
      if (candidate.status.skip > 0) {
        candidate.status.skip -= 1;
        this.line(`🕳️ ${candidate.name} è nel Buco Nero: salta il turno`, 'malus');
        continue;
      }
      return candidate;
    }
    return players.find((p) => p.connected) ?? null;
  }

  async #playTurn(player) {
    this.turnPlayerId = player.id;
    this.turnSummary = null;
    this.topSlot = null;
    this.landing = null;
    this.event = null;
    this.turn = {
      number: this.turnNumber,
      playerId: player.id,
      landerId: player.id,
      multiplier: 1,
      boost: 1,
      landerNet: 0,
      ledger: [],
      lines: [],
      bets: new Map(),
    };
    // Rewind: memoria dei Tappi all'inizio di ogni turno
    this.coinHistory.push(new Map(this.state.players.map((p) => [p.id, p.coins])));
    if (this.coinHistory.length > 4) this.coinHistory.shift();

    await this.#shopPhase(player);
    await this.#bettingPhase(player);
    const index = await this.#spinPhase(player);
    await this.#landingPhase(player, index);
    await this.#turnResultPhase(player);
    this.#endOfTurn();
  }

  // ------------------------------------------------------------------- negozio

  #shopView(player) {
    return {
      offers: this.shop.offers.map((id) => stickers.offerView(this, player, id)),
      pintPrice: this.settings.shopPints ? this.kegPrice : null,
      canBuyPint: this.settings.shopPints && player.coins >= this.kegPrice,
      purchased: this.shop.purchased,
    };
  }

  async #shopPhase(player) {
    this.shop = { playerId: player.id, offers: stickers.drawOffers(this), purchased: null };
    this.phase = PHASE.SHOP;
    let done = false;
    await this.collect({
      ms: player.connected ? TIMING.shop : 0,
      players: [player],
      onInput: (pid, a) => {
        if (a.kind === 'shop_skip') {
          done = true;
          return true;
        }
        if (a.kind === 'shop_pint' && this.settings.shopPints) {
          if (!this.buyPint(player)) return this.toast(pid, 'Tappi insufficienti'), false;
          this.shop.purchased = 'pint';
          done = true;
          return true;
        }
        if (a.kind === 'shop_place') {
          if (!this.shop.offers.includes(a.stickerId)) return false;
          const result = stickers.place(this, player, a.stickerId, Number(a.segmentIndex));
          if (!result.ok) return this.toast(pid, result.error), false;
          this.shop.purchased = a.stickerId;
          done = true;
          return true;
        }
        return false;
      },
      isComplete: () => done,
    });
    if (this.shop.purchased) await this.sleep(1200); // il tempo di vedere l'adesivo comparire sulla ruota
    this.shop = null;
  }

  // ------------------------------------------------------------------- scommesse

  async #bettingPhase(spinner) {
    const bettors = this.connected().filter((p) => p.id !== spinner.id);
    if (!bettors.length) return;
    this.phase = PHASE.BETTING;
    const submitted = new Set();
    await this.collect({
      ms: TIMING.betting,
      players: bettors,
      onInput: (pid, a) => {
        if (a.kind !== 'bet') return false;
        const player = this.state.getPlayer(pid);
        const bet = {
          category: Object.values(SEGMENT_TYPE).includes(a.category) ? a.category : null,
          categoryStake: BET_STAKES.includes(a.categoryStake) ? a.categoryStake : 0,
          outcome: a.outcome === 'gain' || a.outcome === 'loss' ? a.outcome : null,
          outcomeStake: BET_STAKES.includes(a.outcomeStake) ? a.outcomeStake : 0,
        };
        if (!bet.category) bet.categoryStake = 0;
        if (!bet.outcome) bet.outcomeStake = 0;
        // ripuntare: rimborso della scommessa precedente
        const previous = this.turn.bets.get(pid);
        if (previous) this.award(player, previous.categoryStake + previous.outcomeStake, { reason: 'rimborso scommessa', refund: true });
        const total = bet.categoryStake + bet.outcomeStake;
        if (total > 0 && !this.spend(player, total, 'scommessa')) {
          this.turn.bets.delete(pid);
          this.toast(pid, 'Tappi insufficienti per questa scommessa');
          return false;
        }
        if (total > 0) this.turn.bets.set(pid, bet);
        else this.turn.bets.delete(pid);
        submitted.add(pid);
        return true;
      },
      isComplete: () => submitted.size >= bettors.length,
    });
    const count = this.turn.bets.size;
    if (count) this.line(`🎲 ${count} ${count === 1 ? 'scommessa piazzata' : 'scommesse piazzate'}`, 'info');
  }

  #resolveCategoryBets(type) {
    for (const [pid, bet] of this.turn.bets) {
      if (!bet.categoryStake) continue;
      const player = this.state.getPlayer(pid);
      if (bet.category === type) {
        const won = this.award(player, bet.categoryStake * 3, { reason: 'scommessa categoria' });
        this.line(`🎯 ${player.name} indovina la categoria: +${won} Tappi`, 'bonus');
      }
    }
  }

  #resolveOutcomeBets(net) {
    const results = [];
    for (const [pid, bet] of this.turn.bets) {
      if (!bet.outcomeStake) continue;
      const player = this.state.getPlayer(pid);
      if (net === 0) {
        this.award(player, bet.outcomeStake, { reason: 'scommessa annullata', refund: true });
        results.push({ playerId: pid, outcome: bet.outcome, result: 'push', delta: 0 });
        continue;
      }
      const happened = net > 0 ? 'gain' : 'loss';
      if (bet.outcome === happened) {
        const won = this.award(player, bet.outcomeStake * 2, { reason: 'scommessa esito' });
        results.push({ playerId: pid, outcome: bet.outcome, result: 'win', delta: won - bet.outcomeStake });
      } else {
        results.push({ playerId: pid, outcome: bet.outcome, result: 'lose', delta: -bet.outcomeStake });
      }
    }
    return results;
  }

  // ------------------------------------------------------------------- lancio

  async #spinPhase(player) {
    this.phase = PHASE.AWAIT_SPIN;
    let force = null;
    await this.#wait((done) => {
      const timer = this.schedule(() => {
        force ??= 0.3 + this.rng() * 0.5; // lancio automatico se il giocatore non tira
        done();
      }, player.connected ? TIMING.awaitSpin / this.speed : 600);
      this.deadlineAt = this.now() + (player.connected ? TIMING.awaitSpin / this.speed : 600);
      this.#spinRequest = (f) => {
        force = f;
        this.cancel(timer);
        done();
      };
      this.changed();
    });
    this.#spinRequest = null;
    this.deadlineAt = null;

    // Top Slot: spicchio + moltiplicatore, estratti adesso e svelati mentre la ruota gira
    const segments = this.state.segments;
    const slotIndex = this.randInt(0, segments.length - 1);
    const mult = weightedPick(TOP_SLOT_MULTIPLIERS, this.rng);
    this.topSlot = { segmentIndex: slotIndex, segmentLabel: segmentName(segments[slotIndex], slotIndex), multiplier: mult.id, multiplierLabel: mult.label };

    const plan = { id: ++this.#spinSeq, ...planSpin(this.state.wheelAngle, force) };
    this.spin = { plan, startedAt: this.now(), playerId: player.id };
    this.phase = PHASE.SPINNING;
    this.log(`[ruota] lancio #${plan.id}: forza ${(plan.force * 100).toFixed(0)}% → ω0 ${plan.omega0.toFixed(2)} rad/s, arresto in ${(plan.duration / 1000).toFixed(2)} s`);
    this.emit({ type: 'spin', plan, playerId: player.id, topSlot: this.topSlot });
    this.changed();
    await this.sleep(plan.duration + TIMING.spinSettle, true);

    let angle = plan.to;
    let { index } = resolveStop(angle, segments);
    const info = segmentInfo(segments[index]);
    this.log(`[ruota] lancio #${plan.id} FERMO sullo spicchio #${index} → ${info.label}`);

    // Calamita: la ruota può "scivolare" sullo spicchio magnetico accanto
    const magnet = stickers.magnetPull(this, index);
    if (magnet !== null) {
      const layout = segmentLayout(segments);
      const center = (layout[magnet].start + layout[magnet].end) / 2;
      const nudge = { id: ++this.#spinSeq, ...createEasePlan(angle, center, 1100) };
      this.line(`🧲 La Calamita attira la ruota su ${segmentName(segments[magnet], magnet)}!`, 'info');
      this.spin = { plan: nudge, startedAt: this.now(), playerId: player.id };
      this.emit({ type: 'spin', plan: nudge, playerId: player.id, topSlot: this.topSlot, nudge: true });
      this.changed();
      await this.sleep(nudge.duration + 300, true);
      angle = nudge.to;
      index = magnet;
    }
    this.state.wheelAngle = mod(angle, TAU);
    this.spin = null;
    return index;
  }

  // ------------------------------------------------------------------- atterraggio

  async #landingPhase(player, index) {
    const segment = this.state.segments[index];
    const info = segmentInfo(segment);
    this.phase = PHASE.LANDING;
    this.landing = { segmentIndex: index, type: segment.type, lines: [] };
    this.line(`🎡 ${player.name} si ferma su ${segmentName(segment, index)}`, 'info');
    this.emit({ type: 'landed', segmentIndex: index, playerId: player.id });

    // 1. scommesse sulla categoria (pagano x3)
    this.#resolveCategoryBets(segment.type);

    // 2. Top Slot: se la ruota si ferma proprio sullo spicchio estratto
    if (this.topSlot && this.topSlot.segmentIndex === index) {
      if (this.topSlot.multiplier === 'jackpot') {
        const won = this.award(player, 100, { reason: 'Top Slot' });
        this.line(`🎰 TOP SLOT! Jackpot per ${player.name}: +${won} Tappi`, 'gold');
      } else {
        this.turn.multiplier = this.topSlot.multiplier === 'x3' ? 3 : 2;
        this.line(`🎰 TOP SLOT! I premi di ${player.name} in questo turno valgono ${this.topSlot.multiplierLabel}`, 'gold');
      }
      this.emit({ type: 'top_slot_hit', playerId: player.id });
    }

    // 3. royalties e 4. effetto dell'adesivo
    if (segment.sticker) {
      const owner = this.state.getPlayer(segment.sticker.ownerId);
      if (owner && owner.id !== player.id) {
        const paid = this.award(owner, ROYALTIES * segment.sticker.level, { reason: 'royalties', raw: true });
        if (paid) this.line(`👑 Royalties: ${owner.name} incassa ${paid} Tappi`, 'bonus');
      }
      await stickers.onLand(this, index, player);
    }
    await this.sleep(TIMING.landing);

    // 5. evento dello spicchio
    switch (segment.type) {
      case SEGMENT_TYPE.TRIVIA:
        await this.runTriviaEvent(player);
        break;
      case SEGMENT_TYPE.MINIGAME:
        await this.#minigame(player);
        break;
      case SEGMENT_TYPE.FORTUNE:
        await this.#fortune(player);
        break;
      case SEGMENT_TYPE.KEG:
        await this.#kegOffer(player);
        break;
      default:
        this.line(`${info.label}: nessun evento`, 'info');
    }
  }

  /** Trivia: la Dittatura in coda fa scegliere la categoria al proprietario (o a chi è di turno). */
  async runTriviaEvent(lander) {
    let category = null;
    const dictator = this.dictatorQueue.shift();
    if (dictator) {
      const chooser = [this.state.getPlayer(dictator.ownerId), lander].find((p) => p?.connected) ?? lander;
      category = await this.choose({
        player: chooser,
        kind: 'dictator',
        title: '👑 Dittatura: scegli la categoria del Trivia',
        options: CATEGORY_IDS.map((c) => ({ value: c, label: CATEGORIES[c].label })),
        fallback: this.pick(CATEGORY_IDS),
      });
      this.line(`👑 ${chooser.name} impone la categoria ${CATEGORIES[category].label}`, 'info');
      if (dictator.count > 1) this.dictatorQueue.unshift({ ...dictator, count: dictator.count - 1 });
    }
    await runTrivia(this, { lander, category });
  }

  async #minigame(lander) {
    const players = this.connected();
    const pool = MINIGAMES.filter((m) => m !== 'impostor' || players.length >= 3);
    const kind = this.pick(pool);
    this.line(`⚡ Minigioco: ${MINIGAME_LABELS[kind]}`, 'info');
    if (kind === 'impostor') await runImpostor(this, { lander });
    else if (kind === 'pour') await runPour(this, { lander });
    else if (kind === 'auction') await runAuction(this, { lander });
    else await runPriceIsRight(this, { lander });
  }

  async #fortune(player) {
    this.phase = PHASE.EVENT;
    const lucky = this.rng() < 0.7;
    const amount = lucky ? this.randInt(2, 9) * 10 : -this.randInt(2, 5) * 10;
    const delta = this.award(player, amount, { reason: 'Fortuna', boostable: true });
    this.event = { kind: 'fortune', playerId: player.id, delta };
    this.line(delta >= 0 ? `🍀 Fortuna: ${player.name} trova ${delta} Tappi` : `🍀 Sfortuna: ${player.name} perde ${-delta} Tappi`, delta >= 0 ? 'bonus' : 'malus');
    this.changed();
    await this.sleep(3500);
    this.event = null;
  }

  async #kegOffer(player) {
    const price = this.kegPrice;
    if (player.coins < price) {
      this.line(`🍺 Fusto d'Oro: a ${player.name} servono ${price} Tappi per una Pinta (ne ha ${player.coins})`, 'info');
      await this.sleep(2500);
      return;
    }
    const buy = await this.choose({
      player,
      kind: 'keg',
      title: `🍺 Fusto d'Oro: una Pinta per ${price} Tappi?`,
      options: [
        { value: 'yes', label: `Sì, compra (${price})` },
        { value: 'no', label: 'No, tengo i Tappi' },
      ],
      fallback: 'no',
    });
    if (buy === 'yes') this.buyPint(player);
    else this.line(`🍺 ${player.name} rinuncia alla Pinta d'Oro`, 'info');
    await this.sleep(1500);
  }

  // ------------------------------------------------------------------- fine turno

  async #turnResultPhase(player) {
    const net = this.turn.landerNet;
    const bets = this.#resolveOutcomeBets(net);
    this.phase = PHASE.TURN_RESULT;
    this.event = null;
    this.eventPrivate.clear();
    this.turnSummary = {
      playerId: player.id,
      net,
      bets,
      lines: this.turn.lines.slice(-8),
    };
    this.deadlineAt = this.now() + TIMING.turnResult / this.speed;
    this.changed();
    await this.sleep(TIMING.turnResult);
    this.deadlineAt = null;
  }

  #endOfTurn() {
    for (const p of this.state.players) {
      for (const key of ['shield', 'anchor', 'mirror']) if (p.status[key] > 0) p.status[key] -= 1;
    }
    if (this.hiddenTurns > 0) this.hiddenTurns -= 1;
    for (const s of this.state.segments) if (s.sticker?.lockedTurns > 0) s.sticker.lockedTurns -= 1;
    this.turn = null;
    this.landing = null;
    this.topSlot = null;
    this.changed();
  }

  // ------------------------------------------------------------------- premi finali

  async #endgameAwards() {
    this.phase = PHASE.AWARDS;
    this.turnPlayerId = null;
    this.happyHour = false;
    this.hiddenTurns = 0; // la classifica torna visibile per il gran finale
    this.awards = [];
    this.line('🏅 Bonus Segreti: 3 Pinte d\'Oro extra in palio!', 'gold');
    for (const award of computeAwards(this.state.players)) {
      for (const id of award.winners) {
        const p = this.state.getPlayer(id);
        if (p) p.pints += 1;
      }
      this.awards.push(award);
      const names = award.winners.map((id) => this.state.getPlayer(id)?.name).filter(Boolean);
      this.line(`${award.icon} ${award.title}: ${names.length ? names.join(', ') : 'nessuno'}`, 'gold');
      this.emit({ type: 'award', award });
      this.changed();
      await this.sleep(TIMING.award);
    }
  }
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

function weightedPick(items, rng) {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r < 0) return item;
  }
  return items[items.length - 1];
}
