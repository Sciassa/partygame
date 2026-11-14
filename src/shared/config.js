/** Configurazione condivisa tra Host e Client. */

export const APP_NAME = 'Ruota Party';

/** Prefisso degli ID PeerJS: l'host si registra come `${PEER_ID_PREFIX}-${codice}`. */
export const PEER_ID_PREFIX = 'ruotaparty-v1';

/** Niente I/O/0/1 per evitare errori di lettura dal TV. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 14;

/** Heartbeat: l'host fa ping ogni HEARTBEAT_MS; senza risposta per TIMEOUT_MS la connessione è morta. */
export const HEARTBEAT_MS = 2000;
export const CONNECTION_TIMEOUT_MS = 7000;

const env = import.meta.env;

function iceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  if (env.VITE_TURN_URL) {
    servers.push({
      urls: env.VITE_TURN_URL,
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/**
 * Opzioni passate a `new Peer(id, options)`.
 * Default: cloud pubblico PeerJS (solo signaling; i dati viaggiano P2P via WebRTC).
 * Con VITE_PEER_HOST si può puntare a un PeerServer self-hosted.
 */
export function peerOptions() {
  const options = {
    debug: env.DEV ? 1 : 0,
    config: { iceServers: iceServers() },
  };
  if (env.VITE_PEER_HOST) {
    options.host = env.VITE_PEER_HOST;
    options.port = Number(env.VITE_PEER_PORT || 443);
    options.path = env.VITE_PEER_PATH || '/';
    options.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return options;
}

export function hostPeerId(roomCode) {
  return `${PEER_ID_PREFIX}-${roomCode.toLowerCase()}`;
}

export function normalizeRoomCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

/** URL che il QR code apre sui telefoni: stessa origine/percorso dell'host + ?room=CODE */
export function joinUrl(roomCode) {
  const url = new URL(window.location.href);
  url.search = `?room=${roomCode}`;
  url.hash = '';
  return url.href;
}
