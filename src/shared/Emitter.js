/** Event emitter minimale. on() restituisce la funzione per disiscriversi. */
export class Emitter {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  off(event, handler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event, ...args) {
    for (const handler of [...(this.#handlers.get(event) ?? [])]) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[emitter] errore nel listener di "${event}"`, err);
      }
    }
  }

  removeAllListeners() {
    this.#handlers.clear();
  }
}
