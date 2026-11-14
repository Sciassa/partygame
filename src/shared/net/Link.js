import { Emitter } from '../Emitter.js';

/**
 * Un "Link" è un canale bidirezionale di messaggi JSON, indipendente dal trasporto.
 * Eventi: 'message' (msg), 'close' ().
 * Implementazioni:
 *  - PeerLink:  sopra una DataConnection PeerJS (WebRTC)
 *  - LocalLink: in memoria, per il giocatore che in modalità Pocket è anche host
 * Così HostCore e ClientApp non sanno (e non devono sapere) quale trasporto stanno usando.
 */
export class Link extends Emitter {
  constructor(id) {
    super();
    this.id = id;
    this.open = true;
  }

  send(_msg) {
    throw new Error('not implemented');
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
}

/** Adattatore per una DataConnection PeerJS già aperta. */
export class PeerLink extends Link {
  #conn;

  constructor(conn) {
    super(conn.peer);
    this.#conn = conn;
    conn.on('data', (data) => {
      if (this.open && data && typeof data === 'object' && typeof data.t === 'string') this.emit('message', data);
    });
    conn.on('close', () => super.close());
    conn.on('error', (err) => {
      console.warn('[link] errore connessione', err);
      this.close();
    });
    // iOS/Safari a volte non emette 'close': osserviamo anche lo stato ICE.
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const state = conn.peerConnection?.iceConnectionState;
      if (state === 'failed' || state === 'closed') this.close();
    });
  }

  send(msg) {
    if (!this.open) return;
    try {
      this.#conn.send(msg);
    } catch (err) {
      console.warn('[link] send fallito', err);
      this.close();
    }
  }

  close() {
    if (!this.open) return;
    try {
      this.#conn.close();
    } catch {
      /* già chiusa */
    }
    super.close();
  }
}

/** Coppia di Link in memoria collegati tra loro (consegna asincrona, come la rete vera). */
export function createLocalLinkPair(idA = 'local-host', idB = 'local-client') {
  const a = new LocalLink(idA);
  const b = new LocalLink(idB);
  a.remote = b;
  b.remote = a;
  return [a, b];
}

class LocalLink extends Link {
  remote = null;

  send(msg) {
    if (!this.open) return;
    // Copia profonda: stessa semantica della serializzazione di rete (niente riferimenti condivisi).
    const copy = structuredClone(msg);
    queueMicrotask(() => this.remote?.open && this.remote.emit('message', copy));
  }

  close() {
    if (!this.open) return;
    super.close();
    this.remote?.close();
  }
}
