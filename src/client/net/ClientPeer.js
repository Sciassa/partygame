import { Peer } from 'peerjs';
import { hostPeerId, peerOptions } from '../../shared/config.js';
import { PeerLink } from '../../shared/net/Link.js';

const OPEN_TIMEOUT_MS = 12000;

export class RoomNotFoundError extends Error {
  constructor() {
    super('Stanza non trovata');
    this.name = 'RoomNotFoundError';
  }
}

/**
 * Lato client della rete: un Peer con ID casuale che apre una DataConnection verso l'host
 * della stanza. Riutilizza lo stesso Peer per le riconnessioni.
 */
export class ClientPeer {
  peer = null;
  #pending = null; // { reject } della connessione in corso, per instradare 'peer-unavailable'

  async connect(roomCode) {
    await this.#ensurePeer();
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(hostPeerId(roomCode), { reliable: true, serialization: 'json' });
      const fail = (err) => {
        clearTimeout(timer);
        this.#pending = null;
        try {
          conn.close();
        } catch {
          /* ignorato */
        }
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('Timeout di connessione')), OPEN_TIMEOUT_MS);
      this.#pending = { reject: fail };
      conn.on('open', () => {
        clearTimeout(timer);
        this.#pending = null;
        resolve(new PeerLink(conn));
      });
      conn.on('error', fail);
    });
  }

  #ensurePeer() {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected && this.peer.open) return Promise.resolve();
    if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
      return this.#waitOpen(() => this.peer.reconnect());
    }
    this.peer?.destroy();
    this.peer = new Peer(peerOptions());
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') this.#pending?.reject(new RoomNotFoundError());
      else this.#pending?.reject(err);
    });
    return this.#waitOpen();
  }

  #waitOpen(kick) {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      const timer = setTimeout(() => cleanup(reject, new Error('Signaling server non raggiungibile')), OPEN_TIMEOUT_MS);
      const onOpen = () => cleanup(resolve);
      const onError = (err) => cleanup(reject, err);
      const cleanup = (fn, arg) => {
        clearTimeout(timer);
        peer.off('open', onOpen);
        peer.off('error', onError);
        fn(arg);
      };
      peer.on('open', onOpen);
      peer.on('error', onError);
      kick?.();
    });
  }

  destroy() {
    this.peer?.destroy();
    this.peer = null;
  }
}
