import { BEERS, isBeerId } from '../../shared/avatars/beers.js';
import { randomInt } from '../../shared/util/random.js';

/**
 * BeerPoolManager — registro autoritativo (solo host) di chi beve cosa.
 *
 * Invariante: ogni birra è assegnata ad AL MASSIMO un giocatore connesso; tutte le altre sono libere.
 *   assignedBeers: Map<peerId, beerId>      (peerId = id del giocatore nella stanza, es. "p3")
 *
 *  - entra un giocatore         → assign(): estrazione casuale tra le libere (o la sua preferita se libera)
 *  - esce un giocatore          → release(): la birra torna libera
 *  - REQUEST_BEER_CHANGE        → request(): valida che la nuova sia libera, poi scambia
 * Dopo ogni modifica l'host trasmette BEER_POOL_SYNC con snapshot().
 */
export type BeerChangeOutcome = 'ok' | 'same' | 'invalid' | 'taken';

export class BeerPoolManager {
  readonly assignedBeers = new Map<string, string>();
  readonly #all: readonly string[];
  readonly #pick: (min: number, max: number) => number;

  constructor({ beers = BEERS.map((b) => b.id), pick = randomInt }: { beers?: readonly string[]; pick?: (min: number, max: number) => number } = {}) {
    this.#all = beers;
    this.#pick = pick;
  }

  /** Birre libere, nell'ordine canonico (stabile per l'interfaccia). */
  get free(): string[] {
    const taken = new Set(this.assignedBeers.values());
    return this.#all.filter((id) => !taken.has(id));
  }

  ownerOf(beerId: string): string | null {
    for (const [peerId, beer] of this.assignedBeers) if (beer === beerId) return peerId;
    return null;
  }

  beerOf(peerId: string): string | null {
    return this.assignedBeers.get(peerId) ?? null;
  }

  /**
   * Assegna una birra al giocatore: la preferita se è libera, altrimenti una a caso tra le libere.
   * Non pesca MAI una birra occupata: se non ce ne sono è un errore di logica (stanza piena).
   */
  assign(peerId: string, preferred: string | null = null): string {
    const current = this.assignedBeers.get(peerId);
    if (current) return current;
    const free = this.free;
    if (!free.length) throw new Error('Pool delle birre vuoto: stanza piena');
    const beer = preferred && free.includes(preferred) ? preferred : free[this.#pick(0, free.length - 1)];
    this.assignedBeers.set(peerId, beer);
    return beer;
  }

  /** Il giocatore esce: la sua birra torna libera. Restituisce la birra liberata. */
  release(peerId: string): string | null {
    const beer = this.assignedBeers.get(peerId) ?? null;
    this.assignedBeers.delete(peerId);
    return beer;
  }

  /** Richiesta di cambio: valida (esiste ed è libera) e poi aggiorna la mappa. */
  request(peerId: string, newBeerId: unknown): BeerChangeOutcome {
    if (typeof newBeerId !== 'string' || !isBeerId(newBeerId) || !this.assignedBeers.has(peerId)) return 'invalid';
    const current = this.assignedBeers.get(peerId);
    if (current === newBeerId) return 'same';
    const owner = this.ownerOf(newBeerId);
    if (owner && owner !== peerId) return 'taken';
    this.assignedBeers.set(peerId, newBeerId);
    return 'ok';
  }

  /** Mappa serializzabile per BEER_POOL_SYNC. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.assignedBeers);
  }

  /** Controllo d'integrità (usato dai test): nessuna birra assegnata due volte, tutte valide. */
  check(): boolean {
    const values = [...this.assignedBeers.values()];
    return new Set(values).size === values.length && values.every((b) => this.#all.includes(b));
  }
}
