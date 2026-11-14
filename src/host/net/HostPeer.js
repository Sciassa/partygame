import { Peer } from 'peerjs';
import { Emitter } from '../../shared/Emitter.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, hostPeerId, peerOptions } from '../../shared/config.js';
import { PeerLink } from '../../shared/net/Link.js';
import { randomString } from '../../shared/util/random.js';

/**
 * Lato host della rete. Si registra sul signaling server PeerJS con un ID derivato dal codice
 * stanza (es. ABCD -> "ruotaparty-v1-abcd"), così i client lo trovano conoscendo solo il codice.
 * Il signaling serve solo per l'handshake: i messaggi di gioco viaggiano P2P sulle DataChannel.
 *
 * Eventi:
 *  - 'link' (PeerLink)       nuovo client collegato e canale aperto
 *  - 'signaling' (status)    'online' | 'reconnecting' | 'offline'
 */
export class HostPeer extends Emitter {
  peer = null;
  roomCode = null;
  #destroyed = false;
  #reconnectDelay = 1000;
  #reconnectTimer = null;

  /** Apre la stanza. Se il codice è già in uso da un'altra stanza ne prova un altro. */
  async start(preferredCode = null) {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = attempt === 0 && preferredCode ? preferredCode : randomString(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
      try {
        await this.#open(code);
        this.roomCode = code;
        return code;
      } catch (err) {
        lastError = err;
        if (err?.type !== 'unavailable-id') break;
      }
    }
    throw lastError ?? new Error('Impossibile creare la stanza');
  }

  #open(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(hostPeerId(code), peerOptions());
      let opened = false;

      peer.on('open', () => {
        opened = true;
        this.peer = peer;
        this.#reconnectDelay = 1000;
        this.emit('signaling', 'online');
        resolve();
      });

      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          reject(err);
          return;
        }
        console.warn('[host-peer]', err.type, err);
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this.#scheduleReconnect();
      });

      // Persa la connessione al signaling: i giocatori già collegati continuano a giocare (P2P),
      // ma nessuno nuovo può entrare finché non ci riconnettiamo.
      peer.on('disconnected', () => this.#scheduleReconnect());

      peer.on('connection', (conn) => {
        conn.on('open', () => this.emit('link', new PeerLink(conn)));
      });
    });
  }

  #scheduleReconnect() {
    if (this.#destroyed || !this.peer || this.peer.destroyed || this.#reconnectTimer) return;
    this.emit('signaling', 'reconnecting');
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#destroyed || !this.peer) return;
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch (err) {
          console.warn('[host-peer] reconnect fallito', err);
        }
      }
      // Se riesce, l'handler 'open' di #open() riporta lo stato a 'online';
      // altrimenti 'disconnected'/'error' ci riportano qui con un'attesa più lunga.
      this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, 15000);
    }, this.#reconnectDelay);
  }

  destroy() {
    this.#destroyed = true;
    clearTimeout(this.#reconnectTimer);
    this.peer?.destroy();
    this.peer = null;
    this.emit('signaling', 'offline');
  }
}
