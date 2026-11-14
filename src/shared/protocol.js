/**
 * Protocollo di rete Host <-> Client.
 * Ogni messaggio è un oggetto JSON con un campo `t` (tipo). I messaggi nuovi in MAIUSCOLO
 * (REQUEST_BEER_CHANGE, BEER_POOL_SYNC, PLAYER_EMOTE) portano il tipo anche in `type`.
 * L'host è l'unica fonte di verità: i client inviano solo "intenzioni" (es. SPIN_REQUEST)
 * e ricevono lo stato autoritativo.
 */
export const PROTOCOL_VERSION = 4;

export const MODE = Object.freeze({
  /** Schermo grande (TV/PC) = host + render 3D; i telefoni sono solo controller. */
  SALOTTO: 'salotto',
  /** Niente schermo centrale: il telefono del creatore fa da host invisibile, tutti vedono la ruota. */
  POCKET: 'pocket',
});

/**
 * Fasi della partita «Spin & Sip» (macchina a stati in host/game/GameEngine.js).
 * L'Happy Hour non è una fase ma una modalità (`turn.happyHour`) che vale negli ultimi 3 turni.
 */
export const PHASE = Object.freeze({
  LOBBY: 'lobby', // giocatori in arrivo, impostazioni, «Inizia partita»
  SHOP: 'shop', // il giocatore di turno può comprare e incollare un adesivo (o una Pinta)
  BETTING: 'pre_spin_betting', // 8 s: gli altri scommettono su categoria ed esito
  AWAIT_SPIN: 'await_spin', // il giocatore di turno lancia la ruota
  SPINNING: 'spinning', // ruota + Top Slot in movimento
  LANDING: 'landing', // royalties, Top Slot, effetto adesivo, scommesse sulla categoria
  CHOICE: 'choice', // scelta del giocatore: Fusto d'Oro, rivale della Sfida, Dittatura
  EVENT: 'event', // trivia o minigioco sui telefoni (dettagli in snapshot.event)
  TURN_RESULT: 'turn_result', // riepilogo del turno e scommesse sull'esito
  AWARDS: 'endgame_awards', // Bonus Segreti di fine partita
  GAME_OVER: 'game_over',
});

export const MSG = Object.freeze({
  // client -> host
  HELLO: 'hello', // { v, clientId, name }
  SPIN_REQUEST: 'spin:req', // { force: 0..1 } forza del lancio (swipe o tasto)
  /** { type, peerId, newBeerId } cambio birra (in lobby e prima del primo lancio) */
  REQUEST_BEER_CHANGE: 'REQUEST_BEER_CHANGE',
  /** { type, peerId, emote } reazione dal telefono (cooldown 2.5 s); l'host la ritrasmette a tutti */
  PLAYER_EMOTE: 'PLAYER_EMOTE',
  ACTION: 'action', // { a: { kind, ... } } qualsiasi azione di gioco (scommessa, risposta, acquisto...)
  PONG: 'pong', // { ts }

  // host -> client
  WELCOME: 'welcome', // { playerId, mode, roomCode, rejoined }
  REJECT: 'reject', // { reason }
  STATE: 'state', // { s: snapshot pubblico }
  SPIN_START: 'spin:start', // { plan, elapsed, playerId } plan = parametri fisici dello spin
  EVENT: 'event', // { e: { type, ... } } notifiche istantanee (suoni, toast, animazioni)
  PRIVATE: 'private', // { p } dati riservati al singolo giocatore (parola dell'impostore, negozio...)
  PING: 'ping', // { ts }
  TOAST: 'toast', // { text }
  /** { type, assigned: { peerId: beerId }, free: beerId[] } pool delle birre dopo ogni modifica */
  BEER_POOL_SYNC: 'BEER_POOL_SYNC',
});

/** Costruttori dei messaggi "tipizzati" (campo `t` per il router, `type` per leggibilità/debug). */
export const message = {
  requestBeerChange: (peerId, newBeerId) => ({ t: MSG.REQUEST_BEER_CHANGE, type: MSG.REQUEST_BEER_CHANGE, peerId, newBeerId }),
  beerPoolSync: (assigned, free) => ({ t: MSG.BEER_POOL_SYNC, type: MSG.BEER_POOL_SYNC, assigned, free }),
  playerEmote: (peerId, emote) => ({ t: MSG.PLAYER_EMOTE, type: MSG.PLAYER_EMOTE, peerId, emote }),
};

export const REJECT_REASON = Object.freeze({
  ROOM_FULL: 'room_full',
  VERSION: 'version_mismatch',
  BAD_HELLO: 'bad_hello',
  REPLACED: 'replaced', // stesso giocatore si è ricollegato da un'altra connessione
});

export function rejectMessage(reason) {
  switch (reason) {
    case REJECT_REASON.ROOM_FULL:
      return 'La stanza è piena (max 12 giocatori).';
    case REJECT_REASON.VERSION:
      return "Versione dell'app diversa da quella dell'host: ricarica la pagina.";
    case REJECT_REASON.REPLACED:
      return 'Ti sei collegato da un altro dispositivo/scheda.';
    default:
      return 'Connessione rifiutata.';
  }
}
