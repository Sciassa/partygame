import { MAX_NAME_LENGTH, MAX_PLAYERS } from '../../shared/config.js';
import { createBaseSegments } from '../../shared/wheel/segments.js';
import { BEERS, getBeer, isBeerId } from '../../shared/avatars/beers.js';
import { randomInt } from '../../shared/util/random.js';

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
     * POOL DELLE BIRRE DISPONIBILI (stato globale dell'host).
     * Parte con tutte e 12. Regola: una birra è o nel pool o addosso a UN SOLO giocatore connesso.
     *  - entra un giocatore     → estrazione casuale dal pool (e rimozione)
     *  - esce un giocatore      → la sua birra torna nel pool
     *  - cambio birra volontario → la vecchia torna nel pool, la nuova ne esce
     */
    this.beerPool = BEERS.map((b) => b.id);
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
      if (!player.beer) this.#assignBeer(player, this.#takeBeer(player.lastBeer));
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
      status: { shield: 0, anchor: 0, skip: 0, mirror: 0 },
      stats: emptyStats(),
    };
    this.#assignBeer(player, this.#takeBeer());
    this.players.push(player);
    return { player, rejoined: false };
  }

  /** Disconnessione: il giocatore resta (monete, posto in classifica) ma la birra torna nel pool. */
  disconnectPlayer(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    player.connected = false;
    if (player.beer) {
      this.#releaseBeer(player.beer);
      player.lastBeer = player.beer; // preferenza per quando rientra
      player.beer = null;
    }
    return player;
  }

  /** Birre ancora nel pool (copia). */
  freeBeers() {
    return [...this.beerPool];
  }

  /**
   * Cambio birra richiesto dal giocatore. Ogni birra è unica nella stanza.
   * @returns {'ok'|'invalid'|'taken'}
   */
  setBeer(playerId, beerId) {
    const player = this.getPlayer(playerId);
    if (!player || !player.connected || !isBeerId(beerId)) return 'invalid';
    if (player.beer === beerId) return 'ok';
    if (!this.beerPool.includes(beerId)) return 'taken';
    this.#releaseBeer(player.beer);
    this.#assignBeer(player, this.#takeBeer(beerId));
    return 'ok';
  }

  /**
   * Toglie una birra dal pool: quella preferita se c'è, altrimenti una a caso tra le rimaste.
   * Non pesca MAI fuori dal pool: se è vuoto è un errore di logica (isFull() lo impedisce).
   */
  #takeBeer(preferred = null) {
    if (!this.beerPool.length) throw new Error('Pool delle birre vuoto: stanza piena');
    const index = preferred && this.beerPool.includes(preferred) ? this.beerPool.indexOf(preferred) : randomInt(0, this.beerPool.length - 1);
    return this.beerPool.splice(index, 1)[0];
  }

  #releaseBeer(beerId) {
    if (beerId && !this.beerPool.includes(beerId)) this.beerPool.push(beerId);
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
      p.status = { shield: 0, anchor: 0, skip: 0, mirror: 0 };
      p.stats = emptyStats();
    }
    this.segments = createBaseSegments();
  }

  /** Giocatori senza dati segreti (clientId) né interni. */
  publicPlayers() {
    return this.players.map(({ clientId: _secret, lastBeer: _last, stats: _stats, ...pub }) => pub);
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
