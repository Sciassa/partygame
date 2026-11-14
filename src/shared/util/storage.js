import { randomString } from './random.js';

/** localStorage può lanciare eccezioni (Safari privato, storage pieno): sempre in try/catch. */
export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignorato */
  }
}

/**
 * ID persistente del dispositivo: permette all'host di riconoscere un giocatore che si ricollega
 * (app chiusa, schermo spento, cambio rete) e restituirgli monete e posto.
 * Con ?multi nell'URL l'ID vale solo per la scheda: utile per testare più client nello stesso browser.
 */
export function getClientId() {
  const perTab = new URLSearchParams(location.search).has('multi');
  const store = perTab ? sessionStorage : localStorage;
  try {
    let id = store.getItem('ruota.clientId');
    if (!id) {
      id = randomString(16);
      store.setItem('ruota.clientId', id);
    }
    return id;
  } catch {
    return randomString(16);
  }
}
