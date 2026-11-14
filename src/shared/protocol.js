/**
 * Protocollo di rete Host <-> Client.
 * Ogni messaggio è un oggetto JSON con un campo `t` (tipo). L'host è l'unica fonte di verità:
 * i client inviano solo "intenzioni" (es. SPIN_REQUEST) e ricevono lo stato autoritativo.
 */
export const PROTOCOL_VERSION = 1;

export const MODE = Object.freeze({
  /** Schermo grande (TV/PC) = host + render 3D; i telefoni sono solo controller. */
  SALOTTO: 'salotto',
  /** Niente schermo centrale: il telefono del creatore fa da host invisibile, tutti vedono la ruota. */
  POCKET: 'pocket',
});

export const PHASE = Object.freeze({
  IDLE: 'idle', // in attesa che il giocatore di turno giri la ruota
  SPINNING: 'spinning',
  RESULT: 'result', // risultato mostrato, a breve si passa al turno successivo
});

export const MSG = Object.freeze({
  // client -> host
  HELLO: 'hello', // { v, clientId, name }
  SPIN_REQUEST: 'spin:req', // { power: 0..1 }
  PONG: 'pong', // { ts }

  // host -> client
  WELCOME: 'welcome', // { playerId, mode, roomCode }
  REJECT: 'reject', // { reason }
  STATE: 'state', // { s: snapshot pubblico }
  SPIN_START: 'spin:start', // { plan, elapsed }
  SPIN_RESULT: 'spin:result', // { result }
  PING: 'ping', // { ts }
  TOAST: 'toast', // { text }
});

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
