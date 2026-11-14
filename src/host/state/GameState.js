import { MAX_NAME_LENGTH, MAX_PLAYERS } from '../../shared/config.js';
import { createBaseSegments } from '../../shared/wheel/segments.js';
import { getBeer } from '../../shared/avatars/beers.js';
import { BeerPoolManager } from './BeerPoolManager.ts';

export const STARTING_COINS = 100;

/**
 * Anagrafica autoritativa della stanza (vive SOLO sull'host): giocatori, pool delle birre, ruota.
 * Le regole di gioco (turni, Tappi, Pinte, adesivi...) stanno in host/game/GameEngine.js.
 * Contiene dati privati (clientId) che non escono mai.
 */
export class GameState {
  constructor({ mode, roomCode }) {
    this.mode = mode;
    this.roomCode = roomCode;
    /** @type {Array<{id:string, clientId:string, name:string, beer:string|null, lastBeer:string|null, color:string, coins:number, connected:boolean, isOwner:boolean}>} */
    this.players = [];
    /**
     * POOL DELLE BIRRE (stato globale dell'host), vedi BeerPoolManager.
     * Regola: una birra è o libera o addosso a UN SOLO giocatore connesso.
     *  - entra un giocatore      → estrazione casuale tra le libere
     *  - esce un giocatore       → la sua birra torna libera
     *  - cambio birra volontario → REQUEST_BEER_CHANGE: la vecchia si libera, la nuova viene presa
     */
    this.beers = new BeerPoolManager();
    this.segments = createBaseSegments();
    this.wheelAngle = 0;
    this.nextPlayerNumber = 1;
  }

  // ------------------------------------------------------------ giocatori

  findByClientId(clientId) {
    return this.players.find((p) => p.clientId === clientId) ?? null;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  /** Stanza piena = 12 giocatori CONNESSI (le birre sono 12: una a testa). */
  isFull() {
    return this.connectedPlayers().length >= MAX_PLAYERS;
  }

  /** Nuovo giocatore oppure rientro di uno esistente (stesso clientId). */
  joinPlayer(clientId, rawName, { isOwner = false } = {}) {
    let player = this.findByClientId(clientId);
    const name = this.#uniqueName(sanitizeName(rawName) || `Giocatore ${this.nextPlayerNumber}`, player?.id);
    if (player) {
      player.name = name;
      player.connected = true;
      // Rientro: riprende la sua vecchia birra se è ancora nel pool, altrimenti una nuova a caso
      if (!player.beer) this.#assignBeer(player, this.beers.assign(player.id, player.lastBeer));
      return { player, rejoined: true };
    }
    const n = this.nextPlayerNumber++;
    player = {
      id: `p${n}`,
      clientId,
      name,
      beer: null,
      lastBeer: null,
      color: '#f4ead5',
      coins: STARTING_COINS,
      pints: 0,
      connected: true,
      isOwner,
      joinedAt: n,
      status: emptyStatus(),
      shot: null,
      counterSlipTurn: -1,
      stats: emptyStats(),
    };
    this.#assignBeer(player, this.beers.assign(player.id));
    this.players.push(player);
    return { player, rejoined: false };
  }

  /** Disconnessione: il giocatore resta (monete, posto in classifica) ma la birra torna nel pool. */
  disconnectPlayer(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    player.connected = false;
    if (player.beer) {
      this.beers.release(player.id);
      player.lastBeer = player.beer; // preferenza per quando rientra
      player.beer = null;
    }
    return player;
  }

  /** Birre ancora libere (copia). */
  get beerPool() {
    return this.beers.free;
  }

  freeBeers() {
    return this.beers.free;
  }

  /**
   * Cambio birra richiesto dal giocatore (REQUEST_BEER_CHANGE). Ogni birra è unica nella stanza.
   * @returns {'ok'|'same'|'invalid'|'taken'}
   */
  setBeer(playerId, beerId) {
    const player = this.getPlayer(playerId);
    if (!player || !player.connected) return 'invalid';
    const outcome = this.beers.request(playerId, beerId);
    if (outcome === 'ok') this.#assignBeer(player, beerId);
    return outcome;
  }

  #assignBeer(player, beerId) {
    player.beer = beerId;
    player.color = getBeer(beerId).accent; // il colore del giocatore è quello della sua birra
  }

  connectedPlayers() {
    return this.players.filter((p) => p.connected);
  }

  /** Nuova partita con gli stessi giocatori: Tappi, Pinte, stati, statistiche e ruota da capo. */
  resetForNewGame() {
    for (const p of this.players) {
      p.coins = STARTING_COINS;
      p.pints = 0;
      p.status = emptyStatus();
      p.shot = null;
      p.counterSlipTurn = -1;
      p.stats = emptyStats();
    }
    this.segments = createBaseSegments();
  }

  /** Giocatori senza dati segreti (clientId) né interni. */
  publicPlayers() {
    return this.players.map(({ clientId: _secret, lastBeer: _last, stats: _stats, shot: _shot, counterSlipTurn: _slip, status, ...pub }) => ({
      ...pub,
      // gli effetti del Bancone in attesa (Assenzio, Tequila) restano segreti fino all'uso
      status: { shield: status.shield, anchor: status.anchor, skip: status.skip, mirror: status.mirror },
    }));
  }

  #uniqueName(name, ownId) {
    const taken = new Set(this.players.filter((p) => p.id !== ownId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, MAX_NAME_LENGTH - 2)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
}

export function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** Stati del giocatore: turni rimasti degli adesivi difensivi e effetti del Bancone in attesa. */
export function emptyStatus() {
  return { shield: 0, anchor: 0, skip: 0, mirror: 0, absinthe: false, tequila: false, wet: false };
}

/** Statistiche per i Bonus Segreti di fine partita. */
export function emptyStats() {
  return {
    triviaCorrect: 0,
    triviaTimeMs: 0, // somma dei tempi delle risposte giuste (per il tempo medio)
    stickersPlaced: 0,
    malusTaken: 0,
    spent: 0,
    pintsBought: 0,
  };
}
